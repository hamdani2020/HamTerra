"""JSON-lines logging on stdout with a request-scoped ``request_id``."""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import Iterable
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from app.core.redaction import RedactionFilter, redact

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_STANDARD_ATTRS = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()) | {
    "message",
    "asctime",
    "taskName",
}

_QUIET_LOGGERS = ("httpx", "httpcore")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and key not in payload:
                payload[key] = value
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            payload["exception"] = record.exc_text
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str = "INFO", secrets: Iterable[str] = ()) -> None:
    """Install one stdout JSON handler on the root logger with redaction."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactionFilter(secrets))

    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level.upper())

    # DEBUG output of these libraries prints full URLs.
    for name in _QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)


__all__ = ["JsonFormatter", "configure_logging", "redact", "request_id_var"]
