"""Credential redaction for URLs, text and log records."""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from urllib.parse import parse_qsl, urlsplit, urlunsplit

REDACTED = "[REDACTED]"

_SENSITIVE_PARAMS = re.compile(
    r"(?:^|[_\-])(appid|app_id|api_?key|apikey|key|token|access_token|id_token|"
    r"refresh_token|secret|client_secret|password|passwd|pwd|auth|authorization|"
    r"signature|sig|credential|credentials)$",
    re.IGNORECASE,
)

# key=value inside free text or URLs (query strings, form bodies).
_QUERY_PARAM_RE = re.compile(
    r"(?P<name>[A-Za-z0-9_\-]*(?:appid|app_id|api_?key|apikey|key|token|secret|"
    r"password|passwd|pwd|signature|credential)[A-Za-z0-9_\-]*)=(?P<value>[^&\s\"'#]*)",
    re.IGNORECASE,
)
_BEARER_RE = re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]+")
_AUTH_HEADER_RE = re.compile(
    r"(?i)(?P<prefix>[\"']?\bauthorization[\"']?\s*[:=]\s*[\"']?)"
    r"(?:(?:bearer|basic)\s+)?[^\s\"',;}&]+"
)


def _is_sensitive(name: str) -> bool:
    return bool(_SENSITIVE_PARAMS.search(name))


def is_sensitive_param(name: str) -> bool:
    """True for query parameter names that carry credentials (``appid``, ``api_key`` ...)."""
    return _is_sensitive(name)


def redact_url(url: str) -> str:
    """Replace values of credential-like query parameters with ``[REDACTED]``."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return redact(url)
    netloc = parts.netloc
    if "@" in netloc:
        netloc = f"{REDACTED}@{netloc.rsplit('@', 1)[1]}"
    query = parts.query
    if query:
        pairs = parse_qsl(query, keep_blank_values=True)
        if pairs:
            # Rebuild without percent-encoding the placeholder.
            rebuilt = []
            for name, value in pairs:
                rebuilt.append(f"{name}={REDACTED if _is_sensitive(name) else value}")
            query = "&".join(rebuilt)
        else:
            query = _QUERY_PARAM_RE.sub(lambda m: f"{m.group('name')}={REDACTED}", query)
    return urlunsplit((parts.scheme, netloc, parts.path, query, parts.fragment))


def redact(text: str, secrets: Iterable[str] = ()) -> str:
    """Remove configured secrets, bearer tokens, Authorization values and key params."""
    result = text
    for secret in sorted({s for s in secrets if s}, key=len, reverse=True):
        result = result.replace(secret, REDACTED)
    result = _AUTH_HEADER_RE.sub(lambda m: f"{m.group('prefix')}{REDACTED}", result)
    result = _BEARER_RE.sub(lambda m: f"{m.group(1)} {REDACTED}", result)
    return _QUERY_PARAM_RE.sub(lambda m: f"{m.group('name')}={REDACTED}", result)


class RedactionFilter(logging.Filter):
    """Redacts message, arguments and exception text of every record."""

    def __init__(self, secrets: Iterable[str] = ()) -> None:
        super().__init__()
        self._secrets = tuple(s for s in secrets if s)

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # malformed format/args; never fail logging
            message = str(record.msg)
        record.msg = redact(message, self._secrets)
        record.args = None
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact(record.exc_text, self._secrets)
        if record.stack_info:
            record.stack_info = redact(record.stack_info, self._secrets)
        return True
