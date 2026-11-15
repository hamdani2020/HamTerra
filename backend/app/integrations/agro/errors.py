"""Typed provider errors (Requirements 5.5, 5.6).

Messages are fixed text. They never contain the upstream body, the request URL or a key.
The classes extend the API error types, so an unhandled one maps to 502 or 504.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.core.errors import UpstreamError, UpstreamTimeout


class AgroClientError(UpstreamError):
    """The provider rejected the request with a non-retryable 4xx status."""

    default_message = "The satellite data provider rejected the request."

    def __init__(
        self,
        status: int,
        message: str | None = None,
        *,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        self.upstream_status = status
        super().__init__(message, details={"upstream_status": status, **(details or {})})


class AgroUpstreamError(UpstreamError):
    """Retries were exhausted on a retryable status, or the response was unusable."""

    default_message = "The satellite data provider failed."

    def __init__(
        self,
        message: str | None = None,
        *,
        status: int | None = None,
    ) -> None:
        self.upstream_status = status
        super().__init__(message, details={"upstream_status": status} if status else None)


class AgroTimeoutError(UpstreamTimeout):
    default_message = "The satellite data provider timed out."


class InvalidProviderRef(ValueError):  # noqa: N818 - not an API error
    """A stored image or statistics URL does not point at the provider host."""
