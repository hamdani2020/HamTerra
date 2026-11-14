#!/usr/bin/env bash
# check-state-bucket.sh: read-only check of the seven settings of the Terraform State_Bucket.
#
# Usage:
#   [NONCURRENT_DAYS=N] check-state-bucket.sh <bucket-name>
#
# Prerequisites: AWS CLI v2 and jq. Credentials and region come only from the standard
# AWS CLI configuration (or AWS_REGION); the script passes no region of its own.
# Only head-bucket and get-* calls are made. Nothing is written or changed.
# NONCURRENT_DAYS is optional; when unset, any NoncurrentDays >= 1 passes the lifecycle probe.
#
# Output: one line per setting on stdout, "PASS <setting>" or "FAIL <setting>", for
# versioning, encryption, pab, ownership, policy, lifecycle, tags.
#
# Exit codes:
#   0  all seven settings pass
#   1  at least one setting fails, or bad arguments / jq missing
#   2  the bucket cannot be read (absent, other account, or no permission); no PASS line
set -euo pipefail

usage() {
  echo "usage: [NONCURRENT_DAYS=N] $(basename "$0") <bucket-name>" >&2
  exit 1
}

[ $# -eq 1 ] || usage
BUCKET="$1"
DAYS="${NONCURRENT_DAYS:-}"
if [ -n "$DAYS" ]; then
  if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "${#DAYS}" -gt 4 ] || [ "$DAYS" -lt 1 ] || [ "$DAYS" -gt 3650 ]; then
    echo "invalid NONCURRENT_DAYS '$DAYS': must be an integer from 1 to 3650" >&2
    exit 1
  fi
fi
command -v jq >/dev/null 2>&1 || {
  echo "jq is required but was not found on PATH" >&2
  exit 1
}

S3API=(aws s3api)

if ! err="$("${S3API[@]}" head-bucket --bucket "$BUCKET" 2>&1)"; then
  echo "bucket '$BUCKET' is not readable with these credentials (absent, owned by another account, or no s3:ListBucket): $err" >&2
  exit 2
fi

# ===== BEGIN probes (shared with check-state-bucket.sh) ======================
# Needs: S3API (array), BUCKET, DAYS (may be empty: any NoncurrentDays >= 1 passes),
# jq. Each probe_* is read-only (get-* only) and returns 0 when the setting is correct.
# Any failing get-* call, including "no such configuration", makes the probe return 1.

probe_versioning() {
  [ "$("${S3API[@]}" get-bucket-versioning --bucket "$BUCKET" --query Status --output text 2>/dev/null)" = "Enabled" ]
}

probe_encryption() {
  [ "$("${S3API[@]}" get-bucket-encryption --bucket "$BUCKET" \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
    --output text 2>/dev/null)" = "AES256" ]
}

probe_pab() {
  "${S3API[@]}" get-public-access-block --bucket "$BUCKET" --output json 2>/dev/null |
    jq -e '.PublicAccessBlockConfiguration
      | .BlockPublicAcls == true and .IgnorePublicAcls == true
        and .BlockPublicPolicy == true and .RestrictPublicBuckets == true' >/dev/null
}

probe_ownership() {
  [ "$("${S3API[@]}" get-bucket-ownership-controls --bucket "$BUCKET" \
    --query 'OwnershipControls.Rules[0].ObjectOwnership' --output text 2>/dev/null)" = "BucketOwnerEnforced" ]
}

# get-bucket-policy returns .Policy as a JSON string; decode it before comparing.
# Scalars and one-element arrays are normalised to arrays. Other statements are ignored.
probe_policy() {
  "${S3API[@]}" get-bucket-policy --bucket "$BUCKET" --output json 2>/dev/null |
    jq -e --arg arn "arn:aws:s3:::$BUCKET" '
      (.Policy | if type == "string" then fromjson else . end) as $p
      | [ [$p.Statement] | flatten | .[]
          | select(.Effect == "Deny"
              and (.Principal == "*"
                   or ((.Principal | type) == "object" and ([.Principal.AWS] | flatten) == ["*"]))
              and ([.Action] | flatten) == ["s3:*"]
              and ([.Resource] | flatten | sort) == ([$arn, ($arn + "/*")] | sort)
              and ([.Condition.Bool["aws:SecureTransport"]?] | flatten) == ["false"]) ]
        | length >= 1' >/dev/null
}

# Compares .Rules only (the response also holds TransitionDefaultMinimumObjectSize).
# An empty filter may come back as {} or {"Prefix": ""}; both are accepted.
probe_lifecycle() {
  "${S3API[@]}" get-bucket-lifecycle-configuration --bucket "$BUCKET" --output json 2>/dev/null |
    jq -e --arg d "${DAYS:-}" '
      (.Rules // []) as $r
      | ($r | length) == 1
        and $r[0].Status == "Enabled"
        and (($r[0].Filter // {}) as $f | ($f == {} or $f == {"Prefix": ""}))
        and ($r[0].Prefix // "") == ""
        and (if $d == ""
             then (($r[0].NoncurrentVersionExpiration.NoncurrentDays // 0) >= 1)
             else $r[0].NoncurrentVersionExpiration.NoncurrentDays == ($d | tonumber) end)
        and $r[0].AbortIncompleteMultipartUpload.DaysAfterInitiation == 7
        and ($r[0] | has("Expiration") | not)' >/dev/null
}

probe_tags() {
  "${S3API[@]}" get-bucket-tagging --bucket "$BUCKET" --output json 2>/dev/null |
    jq -e '([.TagSet[]? | {(.Key): .Value}] | add // {})
      | .Project == "eco-sentinel" and .ManagedBy == "operator-script"' >/dev/null
}
# ===== END probes ============================================================

rc=0
for s in versioning encryption pab ownership policy lifecycle tags; do
  if "probe_$s"; then echo "PASS $s"; else echo "FAIL $s"; rc=1; fi
done
exit $rc
