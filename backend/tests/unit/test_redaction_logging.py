import io
import json
import logging
from contextlib import redirect_stdout

from hypothesis import given
from hypothesis import strategies as st

from app.core.logging import configure_logging, request_id_var
from app.core.redaction import REDACTED, RedactionFilter, redact, redact_url


def test_redact_url_hides_key_params() -> None:
    url = "https://api.example.com/agro/1.0/polygons?appid=abc123&polyid=p1&api_key=zzz"
    out = redact_url(url)
    assert "abc123" not in out and "zzz" not in out
    assert "polyid=p1" in out
    assert f"appid={REDACTED}" in out


def test_redact_text_bearer_authorization_and_secret() -> None:
    text = "Authorization: Bearer eyJ.a.b failed; pw=hunter2 url?appid=k1&x=1"
    out = redact(text, ["hunter2"])
    for leaked in ("eyJ.a.b", "hunter2", "k1"):
        assert leaked not in out
    assert "x=1" in out


def test_logging_emits_json_with_request_id_and_redaction(
    capfd: object,
) -> None:
    buf = io.StringIO()
    with redirect_stdout(buf):
        configure_logging("info", secrets=["s3cret-value"])
        token = request_id_var.set("rid-1")
        try:
            logging.getLogger("t").info("call %s", "https://h/x?appid=KEY1 s3cret-value")
            try:
                raise ValueError("Bearer tok123")
            except ValueError:
                logging.getLogger("t").exception("boom")
        finally:
            request_id_var.reset(token)
    lines = [json.loads(line) for line in buf.getvalue().splitlines()]
    assert lines[0]["request_id"] == "rid-1"
    assert lines[0]["level"] == "INFO"
    assert "KEY1" not in lines[0]["message"] and "s3cret-value" not in lines[0]["message"]
    assert "tok123" not in lines[1]["exception"]
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING


@given(st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=8, max_size=24))
def test_property_configured_secret_never_survives(secret: str) -> None:
    record = logging.LogRecord("n", logging.INFO, "f", 1, "v=%s", (secret,), None)
    RedactionFilter([secret]).filter(record)
    assert secret not in record.getMessage()
