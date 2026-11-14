#!/usr/bin/env bash
# create-state-bucket.sh: create or confirm the one S3 bucket that holds Terraform state.
#
# Usage:
#   create-state-bucket.sh <bucket-name> <region> [--noncurrent-days N]
#   create-state-bucket.sh --validate-only <bucket-name>
#
# Prerequisites: AWS CLI v2 and jq (jq is required; the probes parse JSON with it).
# Credentials come only from the standard AWS CLI credential chain.
#
# Exit codes:
#   0  success, or the name is valid (--validate-only)
#   1  rejected bucket name, bad arguments, or jq missing (usage on stderr)
#   2  the bucket exists but is not readable (probably another account, or no s3:ListBucket)
#   3  an AWS call failed, or head-bucket returned an error that is not understood
#
# Output: one status line per step on stderr; on success three backend.hcl lines on stdout.
# The script writes no file and has no delete operation. It is run by the Operator only,
# once per State_Bucket. put-bucket-policy and put-bucket-lifecycle-configuration replace
# the whole document; tags are merged with the existing tags.
set -euo pipefail

usage() {
  echo "usage: $(basename "$0") <bucket-name> <region> [--noncurrent-days N] | --validate-only <bucket-name>" >&2
  exit 1
}
status() { printf '%-20s %s\n' "$1" "$2" >&2; }

# Returns 1 and prints the rejected value and the broken rule. Never calls aws.
validate_name() {
  local n="$1" rule=""
  if [ "${#n}" -lt 3 ] || [ "${#n}" -gt 63 ]; then
    rule="must be 3 to 63 characters"
  elif [[ "$n" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    rule="must not be formatted like an IPv4 address"
  elif [[ "$n" == *.* ]]; then
    rule="must not contain a period"
  elif [[ "$n" =~ [^a-z0-9-] ]]; then
    rule="may contain only lowercase letters, digits and hyphens"
  elif [[ "$n" == -* || "$n" == *- ]]; then
    rule="must not start or end with a hyphen"
  elif [[ "$n" == xn--* ]]; then
    rule="must not start with xn--"
  elif [[ "$n" == sthree-* ]]; then
    rule="must not start with sthree-"
  elif [[ "$n" == *-s3alias ]]; then
    rule="must not end with -s3alias"
  elif [[ "$n" == *--ol-s3 ]]; then
    rule="must not end with --ol-s3"
  fi
  if [ -n "$rule" ]; then
    echo "invalid bucket name '$n': $rule" >&2
    return 1
  fi
}

# --- argument handling (no aws call before this block ends) ------------------
DAYS=90
if [ "${1:-}" = "--validate-only" ]; then
  [ $# -eq 2 ] || usage
  validate_name "$2" || exit 1
  exit 0
fi
[ $# -ge 2 ] || usage
BUCKET="$1"
REGION="$2"
shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --noncurrent-days)
      [ $# -ge 2 ] || usage
      DAYS="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done
if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "${#DAYS}" -gt 4 ] || [ "$DAYS" -lt 1 ] || [ "$DAYS" -gt 3650 ]; then
  echo "invalid --noncurrent-days '$DAYS': must be an integer from 1 to 3650" >&2
  exit 1
fi
validate_name "$BUCKET" || exit 1
if ! [[ "$REGION" =~ ^[a-z0-9]+(-[a-z0-9]+)+$ ]]; then
  echo "invalid region '$REGION'" >&2
  exit 1
fi
command -v jq >/dev/null 2>&1 || {
  echo "jq is required but was not found on PATH" >&2
  exit 1
}

S3API=(aws s3api --region "$REGION")

fail_aws() {
  echo "AWS call failed while applying '$1'; nothing further was changed." >&2
  exit 3
}

# --- existence and ownership -------------------------------------------------
# Only HTTP 404 means "absent". 400 and any unrecognised error end with exit 3 and
# never reach create-bucket.
if err="$("${S3API[@]}" head-bucket --bucket "$BUCKET" 2>&1)"; then
  status "bucket" "already present"
else
  lower="$(printf '%s' "$err" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" == *"(404)"* || "$lower" == *"not found"* ]]; then
    if [ "$REGION" = "us-east-1" ]; then
      "${S3API[@]}" create-bucket --bucket "$BUCKET" >/dev/null || fail_aws bucket
    else
      "${S3API[@]}" create-bucket --bucket "$BUCKET" \
        --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null || fail_aws bucket
    fi
    status "bucket" "applied"
  elif [[ "$lower" == *"(403)"* || "$lower" == *"forbidden"* ]]; then
    echo "bucket '$BUCKET' exists and is not readable with these credentials. It is probably owned by another account, or you lack s3:ListBucket. Choose another name." >&2
    exit 2
  else
    echo "head-bucket failed (not treated as absent): $err" >&2
    exit 3
  fi
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

# --- apply_* functions (writes; used only by this script) ---------------------
apply_versioning() {
  "${S3API[@]}" put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
}

apply_encryption() {
  "${S3API[@]}" put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
}

apply_pab() {
  "${S3API[@]}" put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
}

apply_ownership() {
  "${S3API[@]}" put-bucket-ownership-controls --bucket "$BUCKET" \
    --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
}

apply_policy() { # replaces the whole bucket policy
  local policy
  policy="$(jq -cn --arg arn "arn:aws:s3:::$BUCKET" '{Version: "2012-10-17", Statement: [{
    Sid: "DenyInsecureTransport", Effect: "Deny", Principal: "*", Action: "s3:*",
    Resource: [$arn, ($arn + "/*")], Condition: {Bool: {"aws:SecureTransport": "false"}}}]}')"
  "${S3API[@]}" put-bucket-policy --bucket "$BUCKET" --policy "$policy"
}

apply_lifecycle() { # replaces all lifecycle rules
  local lifecycle
  lifecycle="$(jq -cn --argjson d "$DAYS" '{Rules: [{ID: "state-housekeeping", Status: "Enabled",
    Filter: {Prefix: ""}, NoncurrentVersionExpiration: {NoncurrentDays: $d},
    AbortIncompleteMultipartUpload: {DaysAfterInitiation: 7}}]}')"
  "${S3API[@]}" put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "$lifecycle"
}

apply_tags() { # put-bucket-tagging replaces the whole set, so merge with the existing tags
  local merged
  merged="$("${S3API[@]}" get-bucket-tagging --bucket "$BUCKET" --output json 2>/dev/null |
    jq -c '{TagSet: ([.TagSet[]? | select(.Key != "Project" and .Key != "ManagedBy")]
      + [{Key: "Project", Value: "eco-sentinel"}, {Key: "ManagedBy", Value: "operator-script"}])}')" ||
    merged="$(jq -cn '{TagSet: [{Key: "Project", Value: "eco-sentinel"}, {Key: "ManagedBy", Value: "operator-script"}]}')"
  "${S3API[@]}" put-bucket-tagging --bucket "$BUCKET" --tagging "$merged"
}

for s in versioning encryption pab ownership policy lifecycle tags; do
  if "probe_$s"; then
    status "$s" "already present"
  else
    "apply_$s" >/dev/null || fail_aws "$s"
    status "$s" "applied"
  fi
done

printf 'bucket = "%s"\nkey    = "eco-sentinel/<environment>/cognito.tfstate"\nregion = "%s"\n' "$BUCKET" "$REGION"
