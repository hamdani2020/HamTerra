#!/usr/bin/env bash
# put-backend-params.sh: copy backend settings from an env file into SSM Parameter Store.
#
# Usage: scripts/put-backend-params.sh <env-file> <parameter-path> <region>
#   e.g. scripts/put-backend-params.sh ../../.env.prod /eco-sentinel/dev/backend us-east-1
#
# Each KEY=VALUE line becomes a SecureString parameter <parameter-path>/<KEY>, overwriting
# an existing one. The deploy script on the EC2 host turns them back into .env.
# Skipped keys (never uploaded):
#   VITE_*                       frontend build values (Amplify has its own)
#   AWS_*                        static credentials; the instance role is used instead
#   PGADMIN_*, BIND_ADDRESS, *_PORT, CHOKIDAR_USEPOLLING
#                                local development only; ports must stay on 127.0.0.1
# Values are never printed. They reach the AWS CLI through a mode-600 temporary JSON file,
# not the command line. Keys present in Parameter Store but absent from the file are left
# alone; delete them with `aws ssm delete-parameter` if no longer needed.
set -euo pipefail

usage() {
  echo "usage: $0 <env-file> <parameter-path> <region>" >&2
  exit 2
}
[ "$#" -eq 3 ] || usage
ENV_FILE="$1"
PARAM_PATH="${2%/}"
REGION="$3"

[ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE" >&2; exit 2; }
[[ "$PARAM_PATH" =~ ^/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$ ]] || {
  echo "parameter path must look like /eco-sentinel/dev/backend: $PARAM_PATH" >&2
  exit 2
}
[[ "$REGION" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]$ ]] || { echo "region must look like us-east-1: $REGION" >&2; exit 2; }
command -v aws >/dev/null 2>&1 || { echo "aws CLI is required" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }

skip_key() {
  case "$1" in
    VITE_* | AWS_* | PGADMIN_* | BIND_ADDRESS | *_PORT | CHOKIDAR_USEPOLLING) return 0 ;;
    *) return 1 ;;
  esac
}

# Strip one pair of matching surrounding quotes, as Compose does.
unquote() {
  local v="$1"
  if [[ ${#v} -ge 2 && ( ( "${v:0:1}" == '"' && "${v: -1}" == '"' ) || ( "${v:0:1}" == "'" && "${v: -1}" == "'" ) ) ]]; then
    v="${v:1:${#v}-2}"
  fi
  printf '%s' "$v"
}

req="$(mktemp "${TMPDIR:-/tmp}/eco-param.XXXXXX")"
chmod 600 "$req"
trap 'rm -f "$req"' EXIT

uploaded=0 skipped=0 failed=0 lineno=0
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))
  line="${line%$'\r'}"
  # Blank lines and comments.
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  line="${line#export }"
  if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    echo "line $lineno: not KEY=VALUE, ignored" >&2
    continue
  fi
  key="${BASH_REMATCH[1]}"
  value="$(unquote "${BASH_REMATCH[2]}")"

  if skip_key "$key"; then
    skipped=$((skipped + 1))
    continue
  fi
  if [ -z "$value" ]; then
    echo "$key: empty, skipped (Parameter Store cannot hold an empty value)" >&2
    skipped=$((skipped + 1))
    continue
  fi
  if [[ "$value" == *"'"* ]]; then
    echo "$key: value contains a single quote, which the deploy script cannot write to .env; not uploaded" >&2
    failed=$((failed + 1))
    continue
  fi

  # The value goes through the environment into jq, so it never appears in argv.
  ECO_VALUE="$value" jq -n --arg name "$PARAM_PATH/$key" \
    '{Name: $name, Value: env.ECO_VALUE, Type: "SecureString", Overwrite: true}' >"$req"
  if aws ssm put-parameter --region "$REGION" --cli-input-json "file://$req" --output text >/dev/null; then
    echo "$PARAM_PATH/$key: stored"
    uploaded=$((uploaded + 1))
  else
    echo "$PARAM_PATH/$key: FAILED" >&2
    failed=$((failed + 1))
  fi
done <"$ENV_FILE"

echo "uploaded: $uploaded, skipped: $skipped, failed: $failed"
[ "$failed" -eq 0 ]
