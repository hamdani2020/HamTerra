"""Export read-only evidence snapshots for the public project page and the demo.

The project page cannot call the API (it is public and the API needs a Cognito token), so it
shows a snapshot of real API responses for one stored area. This script produces it by calling
the API in-process (ASGI, no network hop) with a local researcher principal, and saves the JSON
bodies unchanged plus a few observation preview PNGs fetched through the backend image proxy.
Provider keys stay inside the backend: the PNG bytes are saved, never a provider URL.

Run inside the backend container:

    python scripts/export_pitch_snapshot.py --area <AREA_ID> --out /app/pitch_export \
        --date-from 2026-01-01 --date-to 2026-04-30 \
        --compare sentinel-2:2026-04-15:2026-04-20 --compare sentinel-2:2026-01-05:2026-04-30 \
        --preview sentinel-2:2026-04-15 --preview sentinel-2:2026-04-20

Writes ``snapshot.json`` and ``preview-<source>-<date>.png`` files to ``--out``; copy them to
``frontend/src/features/pitch/data/``. With ``--demo`` it also writes ``demo.json`` for the
sign-in-free demo (``frontend/src/features/demo/``): the observation lists, every observation's
preview, a comparison for each pair of consecutive observations of one sensor (plus the
``--compare`` pairs), and the stored reports. Only GET requests and comparisons (which store
nothing) are made. The one side effect is the preview proxy's usual one: it records an image's
pixel size the first time the image is fetched.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.api.deps import get_principal  # noqa: E402
from app.core.security import Principal, Role  # noqa: E402
from app.main import create_app  # noqa: E402

API = "/api/v1"


def _principal() -> Principal:
    return Principal(
        sub="pitch-snapshot-export",
        username="pitch-snapshot",
        email=None,
        # Admin only so that every stored report is listed; every call is a read.
        roles=frozenset({Role.admin, Role.researcher}),
    )


async def _get(client: httpx.AsyncClient, path: str, **params: Any) -> Any:
    response = await client.get(f"{API}{path}", params=params or None)
    response.raise_for_status()
    return response.json()


async def export(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, bytes]]:
    """Return the snapshot document and the preview PNGs by file name."""
    app = create_app()
    app.dependency_overrides[get_principal] = _principal
    images: dict[str, bytes] = {}
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://snapshot") as client:
            area = await _get(client, f"/areas/{args.area}")
            settings = await _get(client, "/settings")
            series: dict[str, Any] = {}
            observations: dict[str, list[dict[str, Any]]] = {}
            for source in ("sentinel-2", "landsat-8"):
                series[source] = await _get(
                    client,
                    f"/areas/{args.area}/ndvi/timeseries",
                    source=source,
                    date_from=args.date_from,
                    date_to=args.date_to,
                )
                page = await _get(
                    client,
                    f"/areas/{args.area}/observations",
                    source=source,
                    date_from=args.date_from,
                    date_to=args.date_to,
                    limit=200,
                )
                observations[source] = page["items"]

            async def compare(source: str, date_a: str, date_b: str) -> dict[str, Any]:
                response = await client.post(
                    f"{API}/areas/{args.area}/comparisons",
                    json={
                        "source": source,
                        "date_a": date_a,
                        "date_b": date_b,
                        "include_weather": False,
                    },
                )
                response.raise_for_status()
                result: dict[str, Any] = response.json()
                return result

            pairs = [tuple(spec.split(":")) for spec in args.compare]
            comparisons = [await compare(*pair) for pair in pairs]

            async def preview(observation: dict[str, Any]) -> str:
                name = f"preview-{observation['source']}-{observation['date']}.png"
                if name not in images:
                    response = await client.get(f"{API}/observations/{observation['id']}/preview")
                    response.raise_for_status()
                    images[name] = response.content
                return name

            previews = []
            for spec in args.preview:
                source, day = spec.split(":")
                match = next((o for o in observations[source] if o["date"] == day), None)
                if match is None:
                    sys.exit(f"no {source} observation on {day}")
                previews.append({"file": await preview(match), "observation": match})

            demo: dict[str, Any] | None = None
            if args.demo:
                pages: dict[str, Any] = {
                    "all": await _get(
                        client, f"/areas/{args.area}/observations", limit=200, offset=0
                    )
                }
                for source in ("sentinel-2", "landsat-8"):
                    pages[source] = await _get(
                        client,
                        f"/areas/{args.area}/observations",
                        source=source,
                        limit=200,
                        offset=0,
                    )
                demo_pairs = list(pairs)
                for source in ("sentinel-2", "landsat-8"):
                    dates = sorted(o["date"] for o in pages[source]["items"])
                    for a, b in zip(dates, dates[1:], strict=False):
                        if (source, a, b) not in demo_pairs:
                            demo_pairs.append((source, a, b))
                demo_comparisons = [await compare(*pair) for pair in demo_pairs]
                files = {o["id"]: await preview(o) for o in pages["all"]["items"]}
                reports_page = await _get(client, "/reports", area_id=args.area, limit=200)
                reports = []
                for summary in reports_page["items"]:
                    response = await client.get(
                        f"{API}/reports/{summary['id']}", params={"format": "json"}
                    )
                    response.raise_for_status()
                    reports.append({"summary": summary, "raw": response.text})
                demo = {
                    "area": area,
                    "area_list": await _get(client, "/areas", status="all", limit=200),
                    "area_map": await _get(client, "/areas/map", status="active"),
                    "settings": settings,
                    "observation_pages": pages,
                    "preview_files": files,
                    "timeseries": {
                        source: await _get(
                            client, f"/areas/{args.area}/ndvi/timeseries", source=source
                        )
                        for source in ("sentinel-2", "landsat-8")
                    },
                    "comparisons": demo_comparisons,
                    "reports": reports,
                }

    snapshot = {
        "exported_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "period": {"from": args.date_from, "to": args.date_to},
        "area": area,
        "settings": settings,
        "timeseries": series,
        "comparisons": comparisons,
        "previews": previews,
    }
    if demo is not None:
        snapshot["demo"] = demo
    return snapshot, images


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--area", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--date-from", required=True)
    parser.add_argument("--date-to", required=True)
    parser.add_argument("--compare", action="append", default=[], help="source:date_a:date_b")
    parser.add_argument("--preview", action="append", default=[], help="source:date")
    parser.add_argument("--demo", action="store_true", help="also write demo.json")
    args = parser.parse_args()
    snapshot, images = asyncio.run(export(args))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, content in images.items():
        (out / name).write_bytes(content)
    demo = snapshot.pop("demo", None)
    exported = {"exported_at": snapshot["exported_at"]}
    if demo is not None:
        (out / "demo.json").write_text(json.dumps({**exported, **demo}) + "\n", encoding="utf-8")
    (out / "snapshot.json").write_text(json.dumps(snapshot, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out / 'snapshot.json'}, demo={demo is not None}, {len(images)} previews")


if __name__ == "__main__":
    main()
