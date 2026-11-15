#!/usr/bin/env bash
# deploy-backend.sh: runs ON the EC2 backend host, as root, through SSM Run Command.
#
# Usage: deploy-backend.sh <app-dir> <ssm-parameter-path>
#
# Expects <app-dir> to hold a checkout of the repository at the commit to deploy (the
# GitHub workflow does the checkout before calling this script). Then it:
#   1. writes <app-dir>/.env from the SecureString parameters under <ssm-parameter-path>,
#   2. builds and starts postgis and backend with docker-compose.prod.yml,
#   3. waits for the backend health check,
#   4. enables HTTPS with certbot if no certificate exists yet,
#   5. removes dangling images.
# Parameter values are never printed.
set -euo pipefail

APP_DIR="${1:?usage: deploy-backend.sh <app-dir> <ssm-parameter-path>}"
PARAM_PATH="${2:?usage: deploy-backend.sh <app-dir> <ssm-parameter-path>}"
PARAM_PATH="${PARAM_PATH%/}"

cd "$APP_DIR"

# --- 1. .env from Parameter Store ------------------------------------------------
tmp_env="$(mktemp "$APP_DIR/.env.XXXXXX")"
trap 'rm -f "$tmp_env"' EXIT
chmod 600 "$tmp_env"

count=0
while IFS=$'\t' read -r name value; do
  [ -n "$name" ] || continue
  key="${name##*/}"
  # Single quotes stop Compose from interpolating "$" inside values. The upload script
  # rejects values that contain a single quote.
  printf "%s='%s'\n" "$key" "$value" >>"$tmp_env"
  count=$((count + 1))
done < <(aws ssm get-parameters-by-path --path "$PARAM_PATH" --recursive --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text)

if [ "$count" -eq 0 ]; then
  echo "No parameters found under $PARAM_PATH. Run infra/terraform/scripts/put-backend-params.sh first." >&2
  exit 1
fi
mv "$tmp_env" "$APP_DIR/.env"
trap - EXIT
echo "Wrote .env with $count values from $PARAM_PATH"

# --- 2. Build and start ---------------------------------------------------------------
# docker-compose.yml also defines pgAdmin, whose variables are required when Compose reads
# the file even though the "local" profile keeps pgAdmin from starting. Placeholders
# satisfy the check; nothing uses them.
export PGADMIN_DEFAULT_EMAIL="${PGADMIN_DEFAULT_EMAIL:-unused@example.invalid}"
export PGADMIN_DEFAULT_PASSWORD="${PGADMIN_DEFAULT_PASSWORD:-unused}"

compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
"${compose[@]}" up -d --build --remove-orphans

# --- 3. Health ------------------------------------------------------------------------
echo "Waiting for the backend to report healthy"
for _ in $(seq 1 60); do
  cid="$("${compose[@]}" ps -q backend)"
  status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo unknown)"
  if [ "$status" = "healthy" ]; then
    echo "Backend is healthy"
    break
  fi
  sleep 5
done
if [ "$status" != "healthy" ]; then
  echo "Backend did not become healthy (last status: $status). Recent logs:" >&2
  "${compose[@]}" logs --tail 50 backend >&2 || true
  exit 1
fi

# --- 4. HTTPS -------------------------------------------------------------------------
domain="$(awk '$1 == "server_name" { gsub(";", "", $2); print $2; exit }' /etc/nginx/sites-available/eco-backend)"
if [ -n "$domain" ] && [ ! -d "/etc/letsencrypt/live/$domain" ]; then
  echo "No certificate for $domain yet; running certbot"
  if ! /usr/local/bin/eco-enable-https; then
    echo "WARNING: certbot failed. Check that the A record for $domain points at this host's Elastic IP, then deploy again." >&2
  fi
fi

# --- 5. Clean up ----------------------------------------------------------------------
docker image prune -f >/dev/null
echo "Deploy finished at commit $(git rev-parse --short HEAD)"
