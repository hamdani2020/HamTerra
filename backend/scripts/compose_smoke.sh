#!/usr/bin/env sh
# Compose smoke check (task 16.3, Requirements 20.4, 20.11, 20.15).
# Run from the repository root on the host:  sh backend/scripts/compose_smoke.sh
#
# 1. A missing required variable stops Compose with an error that names it.
# 2. `docker compose up -d` reports the backend healthy within 120 s.
# 3. Every published port is bound to 127.0.0.1.
#
# It never removes volumes. Step 2 starts or keeps the stack running.
set -eu

fail() { echo "FAIL: $1" >&2; exit 1; }

[ -f .env ] || fail "run from the repository root with a completed .env"

# 1. Missing variable: copy .env without AGRO_API_KEY into a temp file (removed on exit).
tmp_env=$(mktemp)
trap 'rm -f "$tmp_env"' EXIT
grep -v '^AGRO_API_KEY=' .env > "$tmp_env"
if output=$(env -u AGRO_API_KEY docker compose --env-file "$tmp_env" config 2>&1); then
  fail "compose accepted a configuration without AGRO_API_KEY"
fi
echo "$output" | grep -q "AGRO_API_KEY" || fail "the error does not name AGRO_API_KEY"
echo "ok: missing AGRO_API_KEY is rejected by name"

# 2. Healthy within 120 s.
docker compose up -d postgis backend pgadmin > /dev/null
deadline=$(( $(date +%s) + 120 ))
while :; do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q backend)")
  [ "$status" = "healthy" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && fail "backend not healthy within 120 s (status: $status)"
  sleep 3
done
echo "ok: backend healthy"

# 3. Published ports bind to 127.0.0.1 only.
for service in postgis backend pgadmin; do
  ports=$(docker compose port "$service" "$(docker compose config --format json \
    | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['services']['$service']['ports'][0]['target'])")")
  case "$ports" in
    127.0.0.1:*) echo "ok: $service published on $ports" ;;
    *) fail "$service is published on $ports, not 127.0.0.1" ;;
  esac
done
echo "compose smoke check passed"
