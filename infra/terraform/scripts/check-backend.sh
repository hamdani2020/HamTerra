#!/usr/bin/env bash
# Static checks for the Terraform backend and repository files.
# Needs no AWS credentials and no network; uses only grep, awk and find.
# Prints "<file>: <rule>" to stderr for every violation and exits 1 if any.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
SELF="check-backend.sh"
rc=0

fail() {
  echo "$1: $2" >&2
  rc=1
}

# Body of the first backend "s3" block (assumes terraform fmt layout: block ends at "  }").
block() {
  awk '/backend "s3"/{f=1;next} f&&/^  }/{exit} f' "$1"
}

# 1. Exactly one root file with exactly one backend "s3" block and the required arguments.
roots=""
for f in "$ROOT"/*.tf; do
  [ -e "$f" ] || continue
  if grep -q 'backend "s3"' "$f"; then
    roots+="$f"$'\n'
  fi
done
roots="${roots%$'\n'}"
if [ -z "$roots" ] || [ "$(printf '%s\n' "$roots" | wc -l | tr -d ' ')" -ne 1 ]; then
  fail "$ROOT" 'rule 1: expected exactly one root .tf file with a backend "s3" block'
else
  count="$(grep -c 'backend "s3"' "$roots" || true)"
  if [ "$count" -ne 1 ]; then
    fail "$roots" 'rule 1: expected exactly one backend "s3" block'
  fi
  body="$(block "$roots")"
  printf '%s\n' "$body" | grep -Eq '^[[:space:]]*use_lockfile[[:space:]]*=[[:space:]]*true' \
    || fail "$roots" 'rule 1: use_lockfile = true missing in backend "s3" block'
  printf '%s\n' "$body" | grep -Eq '^[[:space:]]*encrypt[[:space:]]*=[[:space:]]*true' \
    || fail "$roots" 'rule 1: encrypt = true missing in backend "s3" block'
  if printf '%s\n' "$body" | grep -Eq '^[[:space:]]*(bucket|key|region)[[:space:]]*='; then
    fail "$roots" 'rule 1: bucket/key/region must come from backend.hcl, not the backend block'
  fi
fi

# 2. Forbidden strings in any .tf file outside .terraform/.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if grep -q 'backend "local"' "$f"; then fail "$f" 'rule 2: forbidden backend "local"'; fi
  if grep -q 'dynamodb_table' "$f"; then fail "$f" 'rule 2: forbidden dynamodb_table'; fi
  if grep -q 'dynamodb_endpoint' "$f"; then fail "$f" 'rule 2: forbidden dynamodb_endpoint'; fi
  if grep -Eq 'resource[[:space:]]+"aws_dynamodb_table"' "$f"; then
    fail "$f" 'rule 2: forbidden DynamoDB table resource'
  fi
  if grep -Eq 'resource[[:space:]]+"aws_s3_bucket[A-Za-z0-9_]*"' "$f"; then
    fail "$f" 'rule 2: forbidden S3 bucket resource (the state bucket is created outside Terraform)'
  fi
done < <(find "$ROOT" -type f -name '*.tf' -not -path '*/.terraform/*')

# 3. -migrate-state only on a line that forbids it.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  bad="$(grep -n -- '-migrate-state' "$f" | grep -viE 'never|not|no |zero|forbid|must' || true)"
  if [ -n "$bad" ]; then
    fail "$f" "rule 3: -migrate-state on a line that does not forbid it: $bad"
  fi
done < <(find "$ROOT" "$REPO/.kiro/specs/eco-sentinel-infrastructure" -type f \
  \( -name '*.md' -o -name '*.sh' -o -name '*.tf' \) \
  -not -path '*/.terraform/*' -not -name "$SELF")

# 4. No state files outside .terraform/.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  fail "$f" 'rule 4: stray Terraform state file'
done < <(find "$REPO" -type f \( -name '*.tfstate' -o -name '*.tfstate.*' \) \
  -not -path '*/.terraform/*' -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/.venv/*')

# 5. backend.hcl.example holds placeholders only.
f="$ROOT/backend.hcl.example"
if [ -e "$f" ]; then
  entries="$(grep -E '^(bucket|key|region)[[:space:]]*=' "$f" || true)"
  n="$(printf '%s\n' "$entries" | grep -c . || true)"
  if [ "$n" -ne 3 ]; then
    fail "$f" 'rule 5: expected exactly 3 entries (bucket, key, region)'
  fi
  if [ -n "$entries" ] && printf '%s\n' "$entries" | grep -Evq '"[^"]*<[^">]+>[^"]*"'; then
    fail "$f" 'rule 5: non-placeholder value (expected "<...>" placeholders)'
  fi
  if grep -Eq '[0-9]{12}' "$f"; then
    fail "$f" 'rule 5: contains a 12-digit number (possible account ID)'
  fi
fi

# 6. Required files exist.
for p in versions.tf backend.tf providers.tf variables.tf main.tf outputs.tf terraform.tfvars.example \
  backend.hcl.example README.md .terraform.lock.hcl \
  scripts/print-env.sh scripts/check-backend.sh scripts/create-state-bucket.sh scripts/check-state-bucket.sh \
  modules/cognito/main.tf modules/cognito/variables.tf modules/cognito/outputs.tf modules/cognito/versions.tf; do
  [ -e "$ROOT/$p" ] || fail "$ROOT/$p" 'rule 6: required file missing'
done

exit "$rc"
