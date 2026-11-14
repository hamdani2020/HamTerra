#!/usr/bin/env bash
# Scans authored source for wording that would present evidence as a conclusion.
# Allowed: the forbidden-term lists themselves and the tests that check them.
# Exit 0 = clean, 1 = matches found (listed on stdout).
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

PATTERN='illegal mining|illegal|deforestation|destruction|destroyed|recovery|recovered'
TARGETS=()
[ -d backend/app ] && TARGETS+=(backend/app)
[ -d frontend/src ] && TARGETS+=(frontend/src)
[ ${#TARGETS[@]} -eq 0 ] && { echo "No backend/app or frontend/src yet; nothing to scan."; exit 0; }

MATCHES=$(grep -rniE "$PATTERN" "${TARGETS[@]}" \
  --include='*.py' --include='*.ts' --include='*.tsx' --include='*.css' --include='*.json' \
  | grep -v -e 'backend/app/domain/constants.py' -e 'frontend/src/lib/evidence.ts' || true)

if [ -n "$MATCHES" ]; then
  echo "Forbidden evidence wording found (see product steering):"
  echo "$MATCHES"
  exit 1
fi
echo "Evidence language scan: clean."
