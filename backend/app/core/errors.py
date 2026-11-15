"""Error codes, the ``AppError`` hierarchy and the Error_Envelope handlers.

Every error response has the shape
``{"error": {"code", "message", "details", "request_id"}}``. Messages are fixed
text. Stack traces, SQL, constraint names and upstream bodies never reach the
response body.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from enum import StrEnum
from typing import Any, cast

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

logger = logging.getLogger(__name__)


class ErrorCode(StrEnum):
    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    REFRESH_IN_PROGRESS = "REFRESH_IN_PROGRESS"
    LAST_ADMIN = "LAST_ADMIN"
    SELF_ROLE_CHANGE = "SELF_ROLE_CHANGE"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    GEOMETRY_OUTSIDE_GHANA = "GEOMETRY_OUTSIDE_GHANA"
    AREA_OUT_OF_RANGE = "AREA_OUT_OF_RANGE"
    CROSS_SENSOR_COMPARISON = "CROSS_SENSOR_COMPARISON"
    NO_OBSERVATIONS = "NO_OBSERVATIONS"
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
    COGNITO_ADMIN_NOT_ENABLED = "COGNITO_ADMIN_NOT_ENABLED"
    UPSTREAM_ERROR = "UPSTREAM_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    # Generic fallback for framework 4xx responses with no contract code
    # (for example 400 or 405). Not part of the design table.
    BAD_REQUEST = "BAD_REQUEST"


class AppError(Exception):
    """Base class for expected, client-visible errors."""

    status_code: int = 500
    code: ErrorCode = ErrorCode.INTERNAL_ERROR
    default_message: str = "An internal error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        details: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.message = message or self.default_message
        self.details: dict[str, Any] = dict(details) if details else {}
        self.headers: dict[str, str] = dict(headers) if headers else {}
        super().__init__(self.message)


class Unauthenticated(AppError):
    status_code = 401
    code = ErrorCode.UNAUTHENTICATED
    default_message = "Authentication is required or the token is invalid."

    def __init__(
        self,
        message: str | None = None,
        *,
        details: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        merged = {"WWW-Authenticate": "Bearer"}
        merged.update(headers or {})
        super().__init__(message, details=details, headers=merged)


class Forbidden(AppError):
    status_code = 403
    code = ErrorCode.FORBIDDEN
    default_message = "You do not have permission to perform this action."


class NotFound(AppError):
    status_code = 404
    code = ErrorCode.NOT_FOUND
    default_message = "The requested resource was not found."


class Conflict(AppError):
    status_code = 409
    code = ErrorCode.CONFLICT
    default_message = "The request conflicts with the current state."


class RefreshInProgress(Conflict):
    code = ErrorCode.REFRESH_IN_PROGRESS
    default_message = "A refresh for this area is already running."


class LastAdmin(Conflict):
    code = ErrorCode.LAST_ADMIN
    default_message = "The last administrator cannot be removed."


class SelfRoleChange(Conflict):
    code = ErrorCode.SELF_ROLE_CHANGE
    default_message = "You cannot change your own roles."


class PayloadTooLarge(AppError):
    status_code = 413
    code = ErrorCode.PAYLOAD_TOO_LARGE
    default_message = "The request body is too large."


class ValidationFailed(AppError):
    status_code = 422
    code = ErrorCode.VALIDATION_ERROR
    default_message = "The request is not valid."


class GeometryOutsideGhana(ValidationFailed):
    code = ErrorCode.GEOMETRY_OUTSIDE_GHANA
    default_message = "The geometry is not inside the Ghana boundary."


class AreaOutOfRange(ValidationFailed):
    code = ErrorCode.AREA_OUT_OF_RANGE
    default_message = "The area is outside the permitted size range."


class CrossSensorComparison(ValidationFailed):
    code = ErrorCode.CROSS_SENSOR_COMPARISON
    default_message = "Observations from different sensors cannot be compared."


class NoObservations(ValidationFailed):
    code = ErrorCode.NO_OBSERVATIONS
    default_message = "No observations exist for the requested selection."


class NotImplementedFeature(AppError):
    status_code = 501
    code = ErrorCode.NOT_IMPLEMENTED
    default_message = "This feature is not implemented."


class CognitoAdminNotEnabled(NotImplementedFeature):
    code = ErrorCode.COGNITO_ADMIN_NOT_ENABLED
    default_message = "Role changes are not enabled on this deployment."


class UpstreamError(AppError):
    status_code = 502
    code = ErrorCode.UPSTREAM_ERROR
    default_message = "An upstream service failed."


class ServiceUnavailable(AppError):
    status_code = 503
    code = ErrorCode.SERVICE_UNAVAILABLE
    default_message = "The service is temporarily unavailable."


class UpstreamTimeout(AppError):
    status_code = 504
    code = ErrorCode.UPSTREAM_TIMEOUT
    default_message = "An upstream service timed out."


class InternalError(AppError):
    status_code = 500
    code = ErrorCode.INTERNAL_ERROR
    default_message = "An internal error occurred."


_HTTP_STATUS_CODES: dict[int, tuple[ErrorCode, str]] = {
    401: (ErrorCode.UNAUTHENTICATED, Unauthenticated.default_message),
    403: (ErrorCode.FORBIDDEN, Forbidden.default_message),
    404: (ErrorCode.NOT_FOUND, NotFound.default_message),
    409: (ErrorCode.CONFLICT, Conflict.default_message),
    413: (ErrorCode.PAYLOAD_TOO_LARGE, PayloadTooLarge.default_message),
    422: (ErrorCode.VALIDATION_ERROR, ValidationFailed.default_message),
    501: (ErrorCode.NOT_IMPLEMENTED, NotImplementedFeature.default_message),
    502: (ErrorCode.UPSTREAM_ERROR, UpstreamError.default_message),
    503: (ErrorCode.SERVICE_UNAVAILABLE, ServiceUnavailable.default_message),
    504: (ErrorCode.UPSTREAM_TIMEOUT, UpstreamTimeout.default_message),
}

# PostgreSQL SQLSTATE class 23 values.
_SQLSTATE_UNIQUE = "23505"
_SQLSTATE_FOREIGN_KEY = "23503"
_SQLSTATE_CHECK = "23514"
_SQLSTATE_NOT_NULL = "23502"

_INTERNAL_MESSAGE = "An internal error occurred."


def _request_id(request: Request) -> str | None:
    rid = request_id_var.get()
    if rid:
        return rid
    state_rid = getattr(request.state, "request_id", None)
    return state_rid if isinstance(state_rid, str) else None


def error_response(
    request: Request,
    status_code: int,
    code: ErrorCode | str,
    message: str,
    details: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    body = {
        "error": {
            "code": str(code),
            "message": message,
            "details": dict(details) if details else {},
            "request_id": _request_id(request),
        }
    }
    response_headers = dict(headers) if headers else {}
    if status_code == 401:
        response_headers.setdefault("WWW-Authenticate", "Bearer")
    return JSONResponse(body, status_code=status_code, headers=response_headers)


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    exc = cast(AppError, exc)
    if exc.status_code >= 500:
        logger.error("app_error", extra={"error_code": str(exc.code), "status": exc.status_code})
    return error_response(request, exc.status_code, exc.code, exc.message, exc.details, exc.headers)


def _field_name(loc: tuple[Any, ...]) -> str:
    parts = [str(p) for p in loc]
    if parts and parts[0] in {"body", "query", "path", "header", "cookie"}:
        parts = parts[1:] or [str(loc[0])]
    return ".".join(parts)


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    exc = cast(RequestValidationError, exc)
    fields = [
        {"field": _field_name(tuple(err.get("loc", ()))), "reason": str(err.get("msg", "invalid"))}
        for err in exc.errors()
    ]
    return error_response(
        request,
        422,
        ErrorCode.VALIDATION_ERROR,
        ValidationFailed.default_message,
        {"fields": fields},
    )


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    exc = cast(StarletteHTTPException, exc)
    status = exc.status_code
    mapped = _HTTP_STATUS_CODES.get(status)
    if mapped is not None:
        code, message = mapped
    elif status >= 500:
        code, message = ErrorCode.INTERNAL_ERROR, _INTERNAL_MESSAGE
    else:
        code, message = ErrorCode.BAD_REQUEST, "The request could not be processed."
    # exc.detail is never echoed: it may carry internal text.
    return error_response(request, status, code, message, headers=exc.headers)


def _sqlstate(exc: IntegrityError) -> str | None:
    orig: BaseException | None = exc.orig
    for _ in range(3):
        if orig is None:
            return None
        for attr in ("sqlstate", "pgcode"):
            value = getattr(orig, attr, None)
            if isinstance(value, str):
                return value
        orig = orig.__cause__
    return None


async def integrity_error_handler(request: Request, exc: Exception) -> JSONResponse:
    exc = cast(IntegrityError, exc)
    state = _sqlstate(exc)
    if state == _SQLSTATE_UNIQUE:
        return error_response(
            request,
            409,
            ErrorCode.CONFLICT,
            Conflict.default_message,
            {"constraint_type": "unique"},
        )
    kinds = {
        _SQLSTATE_FOREIGN_KEY: "foreign_key",
        _SQLSTATE_CHECK: "check",
        _SQLSTATE_NOT_NULL: "not_null",
    }
    return error_response(
        request,
        422,
        ErrorCode.VALIDATION_ERROR,
        ValidationFailed.default_message,
        {"constraint_type": kinds.get(state or "", "other")},
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Logged through the root handler, which applies the redaction filter.
    logger.error("unhandled_exception", exc_info=exc)
    return error_response(request, 500, ErrorCode.INTERNAL_ERROR, _INTERNAL_MESSAGE)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(IntegrityError, integrity_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
