#!/usr/bin/env python3
"""PreToolUse guard for file writes.

Reads the hook context JSON on stdin and inspects every string value.
- Blocks (exit 2) when the content looks like a real credential.
- Asks for confirmation when the target is a .env file (not .env.example).
- Otherwise exits 0 silently.
"""
import json
import re
import sys

SECRET_PATTERNS = {
    "AWS access key ID": re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    "AWS secret access key": re.compile(r"aws_secret_access_key\s*[=:]\s*['\"]?[A-Za-z0-9/+]{40}"),
    "private key block": re.compile(r"-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----"),
    "AgroMonitoring/OpenWeather appid": re.compile(r"appid=[0-9a-fA-F]{32}\b"),
    "API key assignment": re.compile(
        r"(AGRO_API_KEY|WEATHER_API_KEY|POSTGRES_PASSWORD|PGADMIN_DEFAULT_PASSWORD)\s*[=:]\s*['\"]?[0-9a-fA-F]{32}\b"
    ),
}
ENV_FILE = re.compile(r"(^|[/\\])\.env(\.[A-Za-z0-9_-]+)?$")


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


def main() -> int:
    raw = sys.stdin.read()
    try:
        values = list(strings(json.loads(raw)))
    except (ValueError, TypeError):
        values = [raw]

    for text in values:
        for name, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                print(
                    f"Blocked: the write appears to contain a real credential ({name}). "
                    "Credentials belong only in the git-ignored .env file, entered by the user. "
                    "Use an environment variable reference or a placeholder instead.",
                    file=sys.stderr,
                )
                return 2

    for text in values:
        candidate = text.strip()
        if "\n" in candidate or len(candidate) > 1024:
            continue
        if ENV_FILE.search(candidate) and not candidate.endswith(".env.example"):
            print(json.dumps({
                "hookSpecificOutput": {
                    "permissionDecision": "ask",
                    "permissionDecisionReason": (
                        f"This writes to {candidate}, which holds local secrets. "
                        "Only .env.example should contain placeholders; confirm this edit."
                    ),
                }
            }))
            return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
