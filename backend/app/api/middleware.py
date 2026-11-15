"""Pure ASGI middleware: request IDs and the request body size limit.

Both are plain ASGI callables (not ``BaseHTTPMiddleware``) so that they see
error responses and streamed bodies.
"""

from __future__ import annotations

import re
import uuid

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import ErrorCode, PayloadTooLarge, error_response
from app.core.logging import request_id_var

REQUEST_ID_HEADER = "X-Request-ID"
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def resolve_request_id(candidate: str | None) -> str:
    """Return the candidate if it is well formed, otherwise a new UUID4 hex."""
    if candidate is not None and REQUEST_ID_PATTERN.fullmatch(candidate):
        return candidate
    return uuid.uuid4().hex


class RequestIdMiddleware:
    """Accept or generate ``X-Request-ID`` and echo it on every response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        incoming: str | None = None
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                incoming = value.decode("latin-1")
                break
        request_id = resolve_request_id(incoming)
        scope.setdefault("state", {})["request_id"] = request_id
        token = request_id_var.set(request_id)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"
                ]
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(token)


class BodySizeLimitMiddleware:
    """Reject bodies above ``max_bytes`` with a 413 Error_Envelope before parsing."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    break
                if declared > self.max_bytes:
                    await self._reject(scope, receive, send)
                    return
                break

        received = 0
        rejected = False
        response_started = False

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            if rejected:
                return  # the 413 is already sent; drop whatever the app emits afterwards
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        async def counting_receive() -> Message:
            nonlocal received, rejected
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes and not response_started:
                    # Send the 413 now and tell the app the client is gone, so the
                    # app stops parsing. Raising here would be caught by body parsing.
                    rejected = True
                    await self._reject(scope, receive, send)
                    return {"type": "http.disconnect"}
            return message

        await self.app(scope, counting_receive, guarded_send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = error_response(
            Request(scope, receive),
            PayloadTooLarge.status_code,
            ErrorCode.PAYLOAD_TOO_LARGE,
            PayloadTooLarge.default_message,
            {"max_bytes": self.max_bytes},
        )
        await response(scope, receive, send)
