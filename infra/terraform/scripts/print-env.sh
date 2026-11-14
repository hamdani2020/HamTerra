#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."            # infra/terraform/
if ! out="$(terraform output -raw env_lines 2>/dev/null)" || [ -z "$out" ]; then
  echo "print-env.sh: Terraform has no applied state (or no env_lines output). Run init and apply first." >&2
  exit 1
fi
printf '%s' "$out"                 # unchanged; prints no trailing newline
