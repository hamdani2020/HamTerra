"""Export a read-only evidence snapshot for the public project page (frontend ``/``).

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
``frontend/src/features/pitch/data/``. Only GET requests and comparisons (which store nothing)
are made. The one side effect is the preview proxy's usual one: it records an image's pixel
size the first time the image is fetched.
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
        roles=frozenset({Role.researcher}),
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

            comparisons = []
            for spec in args.compare:
                source, date_a, date_b = spec.split(":")
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
                comparisons.append(response.json())

            previews = []
            for spec in args.preview:
                source, day = spec.split(":")
                match = next((o for o in observations[source] if o["date"] == day), None)
                if match is None:
                    sys.exit(f"no {source} observation on {day}")
                response = await client.get(f"{API}/observations/{match['id']}/preview")
                response.raise_for_status()
                name = f"preview-{source}-{day}.png"
                images[name] = response.content
                previews.append({"file": name, "observation": match})

    snapshot = {
        "exported_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "period": {"from": args.date_from, "to": args.date_to},
        "area": area,
        "settings": settings,
        "timeseries": series,
        "comparisons": comparisons,
        "previews": previews,
    }
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
    args = parser.parse_args()
    snapshot, images = asyncio.run(export(args))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, content in images.items():
        (out / name).write_bytes(content)
    (out / "snapshot.json").write_text(json.dumps(snapshot, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out / 'snapshot.json'} and {len(images)} previews")


if __name__ == "__main__":
    main()
