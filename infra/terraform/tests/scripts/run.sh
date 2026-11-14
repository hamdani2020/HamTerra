#!/usr/bin/env bash
# run.sh: script tests for infra/terraform/scripts/*.sh using the stubbed `aws`.
#
# Usage: tests/scripts/run.sh
# Needs bash and jq. shellcheck is used when installed. No credentials, no network:
# the stub is first on PATH as `aws`, and the run aborts if `aws` resolves elsewhere.
#
# How to add cases (tasks 9.2 to 9.5): append a function named case_<something> at the
# end of this file. Every case_* function is run automatically, each in a fresh STUB_DIR,
# when the script ends (see the EXIT trap at the bottom of the harness section).
# Inside a case use: new_stub [mode], run_script <script> [args...], then the assert_*
# helpers. After run_script: $RC, $OUT (stdout), $ERR (stderr); the stub log is
# "$STUB_DIR/calls.log". Existing helpers must not be changed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPTS_DIR="$TF_ROOT/scripts"
SCRIPT_FILES=(create-state-bucket.sh check-state-bucket.sh check-backend.sh print-env.sh)

# --- environment: stub first on PATH, no credentials -------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/eco-script-tests.XXXXXX")"
mkdir -p "$WORK/bin"
ln -s "$HERE/stub-aws" "$WORK/bin/aws"
export PATH="$WORK/bin:$PATH"
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION
export AWS_EC2_METADATA_DISABLED=true
export AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null
if [ "$(command -v aws)" != "$WORK/bin/aws" ]; then
  echo "refusing to run: 'aws' does not resolve to the stub" >&2
  exit 99
fi
command -v jq >/dev/null 2>&1 || {
  echo "jq is required to run these tests" >&2
  exit 99
}

# --- counters and reporting ---------------------------------------------------
PASSED=0
FAILED=0
CURRENT="(none)"

pass() { PASSED=$((PASSED + 1)); }
fail() { # fail <message>
  FAILED=$((FAILED + 1))
  echo "FAIL [$CURRENT] $1" >&2
}

# --- per-case stub state --------------------------------------------------------
STUB_DIR=""
RC=0 OUT="" ERR=""

# new_stub [mode]: fresh STUB_DIR and STUB_MODE (default absent). Keeps the old dir when
# called with the second argument "keep" (for two runs against the same state).
new_stub() {
  local mode="${1:-absent}"
  if [ "${2:-}" != "keep" ] || [ -z "$STUB_DIR" ]; then
    STUB_DIR="$(mktemp -d "$WORK/stub.XXXXXX")"
  fi
  export STUB_DIR
  export STUB_MODE="$mode"
}

# run_script <script-name> [args...]: run one of scripts/ and capture RC, OUT, ERR.
run_script() {
  local name="$1" errf
  shift
  errf="$STUB_DIR/.stderr"
  set +e
  OUT="$(bash "$SCRIPTS_DIR/$name" "$@" 2>"$errf")"
  RC=$?
  set -e
  ERR="$(cat "$errf")"
}

# log_lines: number of lines in the stub call log (0 when absent).
log_lines() {
  if [ -f "$STUB_DIR/calls.log" ]; then wc -l <"$STUB_DIR/calls.log" | tr -d ' '; else echo 0; fi
}

# --- assertions -------------------------------------------------------------------
assert_eq() { # assert_eq <expected> <actual> <label>
  if [ "$1" = "$2" ]; then pass; else fail "$3: expected '$1', got '$2'"; fi
}
assert_rc() { assert_eq "$1" "$RC" "${2:-exit code}"; }
assert_rc_nonzero() {
  if [ "$RC" -ne 0 ]; then pass; else fail "${1:-exit code}: expected non-zero, got 0"; fi
}
assert_contains() { # assert_contains <haystack> <needle> <label>
  if [[ "$1" == *"$2"* ]]; then pass; else fail "$3: '$2' not found in: $1"; fi
}
assert_not_contains() {
  if [[ "$1" != *"$2"* ]]; then pass; else fail "$3: '$2' unexpectedly found in: $1"; fi
}
assert_log_empty() {
  assert_eq 0 "$(log_lines)" "${1:-stub log is empty}"
}
assert_log_contains() { # assert_log_contains <needle> [label]
  local log=""
  [ -f "$STUB_DIR/calls.log" ] && log="$(cat "$STUB_DIR/calls.log")"
  assert_contains "$log" "$1" "${2:-stub log}"
}
assert_log_lacks() { # assert_log_lacks <needle> [label]
  local log=""
  [ -f "$STUB_DIR/calls.log" ] && log="$(cat "$STUB_DIR/calls.log")"
  assert_not_contains "$log" "$1" "${2:-stub log}"
}
assert_no_delete() {
  local log=""
  [ -f "$STUB_DIR/calls.log" ] && log="$(cat "$STUB_DIR/calls.log")"
  if printf '%s' "$log" | grep -qi delete; then fail "${1:-no delete call}: found a delete call"; else pass; fi
}

# --- static checks on the four scripts (Requirements 13.1, 16.17) -----------------
check_static() {
  local f path
  for f in "${SCRIPT_FILES[@]}"; do
    CURRENT="static:$f"
    path="$SCRIPTS_DIR/$f"
    if [ ! -f "$path" ]; then
      fail "script is missing"
      continue
    fi
    case "$(head -n 1 "$path")" in
      '#!/usr/bin/env bash' | '#!/bin/bash') pass ;;
      *) fail "first line is not a bash shebang" ;;
    esac
    if grep -qx 'set -euo pipefail' "$path"; then pass; else fail "missing 'set -euo pipefail'"; fi
    if grep -Eq '(^|[^0-9])[0-9]{12}([^0-9]|$)' "$path"; then fail "contains a 12-digit number"; else pass; fi
    if grep -q 'AKIA' "$path"; then fail "contains AKIA"; else pass; fi
    if [ -x "$path" ]; then pass; else fail "script is not executable"; fi
    if command -v shellcheck >/dev/null 2>&1; then
      if shellcheck "$path"; then pass; else fail "shellcheck reported findings"; fi
    fi
  done
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "note: shellcheck not installed; skipped" >&2
  fi
}

# --- stub self-check: a few calls prove the stub behaves as the scripts expect --------
case_stub_roundtrip() {
  new_stub own
  aws --region eu-west-1 s3api put-bucket-versioning --bucket b --versioning-configuration Status=Enabled
  assert_eq Enabled "$(aws s3api get-bucket-versioning --bucket b --query Status --output text)" "versioning"
  aws s3api put-bucket-policy --bucket b --policy '{"Version":"2012-10-17","Statement":[]}'
  assert_eq string "$(aws s3api get-bucket-policy --bucket b --output json | jq -r '.Policy | type')" "policy is a string"
  aws s3api put-bucket-lifecycle-configuration --bucket b --lifecycle-configuration '{"Rules":[]}'
  assert_contains "$(aws s3api get-bucket-lifecycle-configuration --bucket b --output json)" \
    TransitionDefaultMinimumObjectSize "lifecycle extra field"
  assert_eq 6 "$(log_lines)" "log lines"
}

# --- main: runs when the script exits, so cases appended below are included ---------
run_all_cases() {
  local rc=$? fn
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 99 ] && [ "$FAILED" -eq 0 ]; then
    echo "harness aborted with exit code $rc" >&2
    rm -rf "$WORK"
    exit "$rc"
  fi
  [ "$rc" -eq 99 ] && { rm -rf "$WORK"; exit 99; }
  check_static
  for fn in $(declare -F | awk '{print $3}' | grep '^case_' || true); do
    CURRENT="$fn"
    new_stub absent
    "$fn"
  done
  rm -rf "$WORK"
  echo "passed: $PASSED, failed: $FAILED"
  [ "$FAILED" -eq 0 ] || exit 1
  exit 0
}
trap run_all_cases EXIT

# --- cases (append new case_* functions below this line) --------------------------
