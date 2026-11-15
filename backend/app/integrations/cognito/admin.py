"""Cognito group membership changes (Requirements 12.3 to 12.5, 20.14).

Only ``AdminAddUserToGroup`` and ``AdminRemoveUserFromGroup`` are called. The backend never
creates, changes or deletes pools, clients, groups or users. The IAM permissions for these
calls are assumed, not verified (design U7).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol

from app.core.config import Settings
from app.core.errors import CognitoAdminNotEnabled, UpstreamError, UpstreamTimeout
from app.core.security import Role

logger = logging.getLogger(__name__)

COGNITO_TIMEOUT_S = 10.0
_DENIED = {"AccessDeniedException", "NotAuthorizedException", "UnrecognizedClientException"}


class CognitoAdmin(Protocol):
    enabled: bool

    async def set_group_membership(self, username: str, group: Role, add: bool) -> None: ...


class DisabledCognitoAdmin:
    """``COGNITO_ADMIN_ENABLED=false``: every change is refused with 501."""

    enabled = False

    async def set_group_membership(self, username: str, group: Role, add: bool) -> None:
        raise CognitoAdminNotEnabled()


class BotoCognitoAdmin:
    enabled = True

    def __init__(self, settings: Settings, *, timeout_s: float = COGNITO_TIMEOUT_S) -> None:
        self._settings = settings
        self._timeout_s = timeout_s
        self._client: Any = None

    def _boto_client(self) -> Any:
        if self._client is None:
            import boto3
            from botocore.config import Config

            s = self._settings

            def secret(value: Any) -> str | None:
                text = value.get_secret_value() if value is not None else ""
                return text or None

            # Explicit credentials when configured; otherwise boto3's default chain (env).
            self._client = boto3.client(
                "cognito-idp",
                region_name=s.cognito_region,
                aws_access_key_id=secret(s.aws_access_key_id),
                aws_secret_access_key=secret(s.aws_secret_access_key),
                aws_session_token=secret(s.aws_session_token),
                config=Config(connect_timeout=5, read_timeout=10, retries={"max_attempts": 1}),
            )
        return self._client

    def _call(self, username: str, group: Role, add: bool) -> None:
        client = self._boto_client()
        operation = client.admin_add_user_to_group if add else client.admin_remove_user_from_group
        operation(
            UserPoolId=self._settings.cognito_user_pool_id,
            Username=username,
            GroupName=group.value,
        )

    async def set_group_membership(self, username: str, group: Role, add: bool) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            async with asyncio.timeout(self._timeout_s):
                await asyncio.to_thread(self._call, username, group, add)
        except TimeoutError:
            raise UpstreamTimeout("Cognito did not respond in time.") from None
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", "Unknown"))
            logger.warning("cognito_group_change_failed", extra={"error_code": code})
            if code in _DENIED:
                raise CognitoAdminNotEnabled() from None
            raise UpstreamError("Cognito rejected the group change.") from None
        except BotoCoreError:
            logger.warning("cognito_group_change_failed", extra={"error_code": "BotoCoreError"})
            raise UpstreamError("Cognito could not be reached.") from None


def build_cognito_admin(settings: Settings) -> CognitoAdmin:
    return BotoCognitoAdmin(settings) if settings.cognito_admin_enabled else DisabledCognitoAdmin()
