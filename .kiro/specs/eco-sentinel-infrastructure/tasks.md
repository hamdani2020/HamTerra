# Implementation Plan: Eco-Sentinel Ghana Infrastructure

## Overview

This plan builds the Terraform root configuration, the Cognito module, four Operator scripts, the test suites and the README under `infra/terraform/`. The design uses concrete HCL and bash, so no implementation language question applies. Work proceeds in this order: scaffolding, root variables, Cognito module, root wiring, scripts, tests, README, lock file, verification of open design items.

## Plan_Stop_Rule (mandatory for every task)

No task in this plan may run any of these: `terraform apply`, `terraform destroy`, `terraform import`, `terraform force-unlock`, `terraform init` with the `-migrate-state` flag (never run it), any command with the `-auto-approve` flag, `terraform init` against a real backend, `create-state-bucket.sh` against a real AWS account, or `check-state-bucket.sh` against a real AWS account. The Operator runs those steps, not the agent.

Allowed validation commands are limited to: `terraform fmt`, `terraform init -backend=false`, `terraform providers lock`, `terraform validate`, `terraform test`, `tflint` (where installed), `shellcheck` (where installed), the stubbed script tests (`tests/scripts/run.sh`) and `scripts/check-backend.sh`. All of them need no AWS credentials. Every task ends at one of these commands, with no later step in the same task.

Design notes applied here: `backend.tf` and `tests/scripts/` are added to the layout (design "Gaps"), `tfplan` is added to `.gitignore`, and `jq` is a documented prerequisite of the state bucket scripts.

## Tasks

- [ ] 1. Repository scaffolding
  - [ ] 1.1 Create the directory layout and `.gitignore` entries
    - Create `infra/terraform/{modules/cognito/tests,scripts,tests/scripts}` (placeholder-free; files come in later tasks)
    - Append the Terraform block of the design (`.terraform/`, `*.tfstate`, `*.tfstate.*`, `crash.log`, `crash.*.log`, `*.tfvars`, `*.tfvars.json`, `*.tfplan`, `tfplan`, `backend.hcl`, and the `!terraform.tfvars.example`, `!backend.hcl.example`, `!.terraform.lock.hcl` negations) to the root `.gitignore`, creating it if absent and keeping existing entries
    - _Requirements: 1.1, 1.2, 2.8_

  - [ ] 1.2 Write `versions.tf`, `backend.tf` and `providers.tf`
    - Root and module `versions.tf`: `required_version = ">= 1.10.0"`, `hashicorp/aws` constrained `>= 6.6.0, < 7.0.0`
    - Root `backend.tf`: one partial `backend "s3"` block with only `use_lockfile = true` and `encrypt = true`
    - Root `providers.tf`: `provider "aws"` with `region = var.aws_region` and `default_tags` merging `Project`, `Environment`, `ManagedBy = "terraform"` with `var.tags` (later map wins)
    - The module gets no `provider` block
    - _Requirements: 1.4, 2.1, 2.2, 2.4, 2.5, 9.6, 9.7_

  - [ ] 1.3 Write `backend.hcl.example` and `terraform.tfvars.example`
    - `backend.hcl.example`: exactly the three placeholder entries `bucket`, `key` (`eco-sentinel/<environment>/cognito.tfstate`), `region`
    - `terraform.tfvars.example`: placeholders for `aws_region` and `cognito_domain_prefix`, optional overrides commented out, no real prefix, account ID or credential
    - _Requirements: 2.6, 2.7, 3.14_

- [ ] 2. Root variables
  - [ ] 2.1 Write root `variables.tf`
    - Declare `aws_region`, `environment`, `project_name`, `cognito_domain_prefix`, `callback_urls`, `logout_urls`, `allow_self_signup`, `deletion_protection`, `mfa_configuration`, `user_pool_tier`, `managed_login_version`, `access_token_validity_minutes`, `id_token_validity_minutes`, `refresh_token_validity_days`, `enable_group_admin_policy`, `tags`, each with `description` and `type`
    - No default for `aws_region` or `cognito_domain_prefix`; defaults and validation blocks exactly as in the design (URL rules, prefix rules including `aws|amazon|cognito`, enum rules, whole-number ranges)
    - Add the cross-variable check on `deletion_protection` (must stay true outside `dev`), root only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 4.2, 4.8, 5.3, 5.4, 9.1, 9.3, 11.1, 11.8_

- [ ] 3. Cognito module
  - [ ] 3.1 Write module `variables.tf`
    - Same variables, types, defaults and validations as the root, except `aws_region`, `tags` and the cross-variable `deletion_protection` check; add the module-only `region` (no default)
    - _Requirements: 3.13, 5.4, 6.12, 6.13, 7.3, 7.5, 7.6, 12.5_

  - [ ] 3.2 Write the user pool in module `main.tf`
    - `locals` for `name_prefix` and the `groups` map `{ admin = 1, researcher = 2 }`
    - `aws_cognito_user_pool.this`: email username, auto-verified email, `deletion_protection` mapped to `ACTIVE` or `INACTIVE`, `mfa_configuration`, `user_pool_tier`, `allow_admin_create_user_only = !var.allow_self_signup`, password policy (12 characters, four classes, 7 day temporary validity), `verified_email` recovery priority 1, dynamic `software_token_mfa_configuration` when MFA is not `OFF`
    - Declare no user, no SMS role, no SNS topic, no SES identity
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.5, 5.6, 5.7, 9.2_

  - [ ] 3.3 Add the app client, domain and groups to module `main.tf`
    - `aws_cognito_user_pool_client.web`: public client, `code` flow, scopes `openid`, `email`, `profile`, `COGNITO` provider, URLs from variables, `ALLOW_REFRESH_TOKEN_AUTH` only, `prevent_user_existence_errors = "ENABLED"`, token revocation, validities with units, `refresh_token_rotation` (`ENABLED`, 10 seconds), `read_attributes` and `write_attributes` unset
    - `aws_cognito_user_pool_domain.this`: prefix domain, `managed_login_version`, no `certificate_arn`
    - `aws_cognito_user_group.role` with `for_each` over the groups map, no `role_arn`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 7.1, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4_

  - [ ] 3.4 Add the optional IAM policy to module `main.tf`
    - `data.aws_iam_policy_document.group_admin` and `aws_iam_policy.group_admin`, both gated by `count` on `enable_group_admin_policy`
    - One `Allow` statement, exactly the three `cognito-idp` group actions, resource only the pool ARN, name containing project and environment
    - No IAM user, access key, role or attachment
    - _Requirements: 11.2, 11.3, 11.4, 11.6_

  - [ ] 3.5 Write module `outputs.tf`
    - `user_pool_id`, `user_pool_arn`, `app_client_id`, `region`, `domain_url`, `issuer_url`, `jwks_url`, `group_names` (sorted keys), `group_admin_policy_arn` (`one(...[*].arn)`, null when disabled)
    - No `client_secret` output and no `sensitive` output
    - _Requirements: 6.10, 7.2, 8.5, 10.1, 10.2, 10.12, 11.5_

- [ ] 4. Checkpoint - Terraform static checks
  - Run `terraform fmt -check -recursive`, `terraform init -backend=false` and `terraform validate` in `infra/terraform/`. These need no AWS credentials. Fix any finding.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Root wiring
  - [ ] 5.1 Write root `main.tf`
    - One `module "cognito"` block with a relative `source`, passing every shared variable and `region = var.aws_region`
    - _Requirements: 1.3, 3.13_

  - [ ] 5.2 Write root `outputs.tf` with `env_lines`
    - Locals `allowed_origins` (de-duplicated origins of `callback_urls`, first-appearance order, comma-joined) and `env_lines` (nine lines, joined by a single line feed)
    - `env_lines` output plus one re-export per module output; no `sensitive` output
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.7, 10.8, 10.12_

- [ ] 6. Operator scripts
  - [ ] 6.1 Write `scripts/print-env.sh`
    - `#!/usr/bin/env bash`, `set -euo pipefail`; run `terraform output -raw env_lines`, print unchanged; on failure or empty output print nothing to stdout, a message to stderr and exit 1; write no file
    - _Requirements: 10.9, 10.10, 16.17_

  - [ ] 6.2 Write `scripts/check-backend.sh`
    - Implement the six checks of the design: one `backend "s3"` block with `use_lockfile` and `encrypt` and no `bucket`/`key`/`region`; forbidden strings in `.tf` files; `-migrate-state` only on a forbidding line; no stray state files; `backend.hcl.example` placeholders only; required files exist
    - Print file and rule to stderr and exit non-zero on any violation; use no AWS credentials and no network
    - _Requirements: 1.8, 2.4, 2.5, 2.6, 2.17, 13.18, 13.19, 16.17_

  - [ ] 6.3 Write `scripts/create-state-bucket.sh`
    - Interface `<bucket-name> <region> [--noncurrent-days N]` and `--validate-only <bucket-name>`; exit codes 0, 1, 2, 3 as in the design
    - `validate_name` with every S3 naming rule; argument checks make no AWS call
    - `head-bucket` handling (404 create, 403 other account, success own bucket); `create-bucket` without `LocationConstraint` for `us-east-1`
    - One `probe_*` and `apply_*` pair per setting (versioning, encryption, public access block, ownership, TLS-only policy, lifecycle, tags with merge); status lines on stderr, three `backend.hcl` lines on stdout, no file written, no `delete` subcommand
    - Note in a header comment that `jq` is required
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.17_

  - [ ] 6.4 Write `scripts/check-state-bucket.sh`
    - Interface `<bucket-name>`; only `head-bucket` and `get-*` calls; same `probe_*` bodies as the create script; optional `NONCURRENT_DAYS`
    - One `PASS` or `FAIL` line per setting, exit 0 only when all seven pass; unreadable bucket prints a message to stderr, no `PASS` line, exit 2
    - _Requirements: 16.10, 16.11, 16.12, 16.17_

- [ ] 7. Checkpoint - Scripts and Terraform static checks
  - Run `terraform fmt -check -recursive`, `terraform init -backend=false`, `terraform validate`, and `shellcheck scripts/*.sh` where installed, in `infra/terraform/`. Run `scripts/check-backend.sh` only after task 9 and 10 add the README and lock file; at this point its missing-file report for those two files is expected.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Terraform tests (`mock_provider "aws"`, plan by default, apply only where computed values are needed)
  - [ ] 8.1 Write `modules/cognito/tests/client.tftest.hcl` default-client assertions
    - Defaults run block asserting the public PKCE client settings
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.9, 13.3, 13.4_

  - [ ]* 8.2 Write property test for the public PKCE client
    - **Property 1: Public PKCE client**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.9, 13.4**

  - [ ]* 8.3 Write property test for URL and token pass-through
    - Add to `client.tftest.hcl`: two callback URLs, two logout URLs (order kept), custom validities and units
    - **Property 2: URL and token pass-through**
    - **Validates: Requirements 6.4, 6.8, 13.5**

  - [ ]* 8.4 Write property test for the sign-up policy mapping
    - Create `modules/cognito/tests/pool.tftest.hcl` with default and `allow_self_signup = true` run blocks
    - **Property 3: Sign-up policy mapping**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.6, 13.6**

  - [ ]* 8.5 Write property test for deletion protection in the module
    - Add to `pool.tftest.hcl`: default `ACTIVE`, `false` gives `INACTIVE`
    - **Property 4: Deletion protection mapping and guard**
    - **Validates: Requirements 9.1, 9.2, 13.9**

  - [ ]* 8.6 Write property test for the MFA block
    - Add to `pool.tftest.hcl`: `OFF` (no TOTP block), `OPTIONAL` and `ON` (one block), no SMS configuration
    - **Property 7: MFA block follows the mode**
    - **Validates: Requirements 5.3, 5.5, 5.6, 5.7**

  - [ ]* 8.7 Write property test for the fixed password and recovery policy
    - Add to `pool.tftest.hcl`
    - **Property 8: Password and recovery policy is fixed**
    - **Validates: Requirements 4.1, 4.5, 5.1, 5.2**

  - [ ]* 8.8 Write property test for exactly two role groups
    - Create `modules/cognito/tests/groups_policy.tftest.hcl`
    - **Property 5: Exactly two role groups**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 13.7**

  - [ ]* 8.9 Write property test for the gated, minimal policy
    - Add to `groups_policy.tftest.hcl`: disabled (0 IAM resources, null ARN), enabled (one policy, three actions, one resource, no `*`)
    - **Property 6: Optional policy is gated and minimal**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 13.8**

  - [ ]* 8.10 Write property test for output URL formats
    - Create `modules/cognito/tests/outputs.tftest.hcl` using `command = apply` under the mock; assert `domain_url`, `issuer_url`, `jwks_url`, `group_names`, and that no `client_secret` output exists
    - **Property 11: Output URL formats**
    - **Validates: Requirements 7.1, 7.2, 10.1, 10.2, 10.12, 13.12, 13.13**

  - [ ]* 8.11 Write property test for rejected URL lists in the module
    - Create `modules/cognito/tests/validation.tftest.hcl` with one `expect_failures` run block per URL case, for `callback_urls` and `logout_urls`
    - **Property 9: Invalid URL lists are rejected**
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.13, 6.13, 13.10**

  - [ ]* 8.12 Write property test for rejected scalar inputs in the module
    - Add to the module `validation.tftest.hcl`: prefix, `environment`, `mfa_configuration`, `user_pool_tier`, `managed_login_version`, token validity bounds
    - **Property 10: Invalid scalar inputs are rejected**
    - **Validates: Requirements 3.8, 3.9, 3.10, 3.11, 3.13, 5.4, 6.12, 7.5, 7.6, 13.10**

  - [ ]* 8.13 Write property test for `env_lines`
    - Create `tests/env_lines.tftest.hcl` using `command = apply` under the mock: default URLs, two callback URLs on one origin, two origins, first-element URIs, no `secret`
    - **Property 12: env_lines shape and derivation**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.7, 10.8, 13.11, 13.12**

  - [ ]* 8.14 Write property test for the root deletion-protection guard
    - Create `tests/deletion_protection.tftest.hcl`: `prod` and `staging` with `false` fail, `dev` with `false` gives `INACTIVE`, default gives `ACTIVE`
    - **Property 4: Deletion protection mapping and guard**
    - **Validates: Requirements 9.1, 9.2, 9.3, 13.9**

  - [ ]* 8.15 Write property test for rejected URL lists in the root
    - Create `tests/validation.tftest.hcl` with the URL cases
    - **Property 9: Invalid URL lists are rejected**
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.12, 13.10**

  - [ ]* 8.16 Write property test for rejected scalar inputs and missing variables in the root
    - Add to `tests/validation.tftest.hcl`, including missing `aws_region` and `cognito_domain_prefix`; if `expect_failures` cannot catch a missing variable (T2), use the shell fallback described in the design
    - **Property 10: Invalid scalar inputs are rejected**
    - **Validates: Requirements 3.2, 3.8, 3.9, 3.10, 3.11, 3.12, 13.10, 13.14, 13.15**

- [ ] 9. Script tests with a stubbed `aws`
  - [ ] 9.1 Create `tests/scripts/stub-aws` and the `tests/scripts/run.sh` harness
    - `stub-aws` logs calls to `$STUB_DIR/calls.log`, keeps bucket state as files, and honours `STUB_MODE` (`absent`, `own`, `other`)
    - `run.sh` puts the stub first on `PATH`, needs no credentials, runs `shellcheck` on the four scripts where installed, and checks shebang, `set -euo pipefail`, no 12-digit number and no `AKIA` in each script
    - _Requirements: 13.1, 13.16, 16.17_

  - [ ]* 9.2 Write property test for bucket name validation
    - Add cases to `run.sh`: at least three valid names (including 3 and 63 characters), every invalid form of Requirement 13.16, missing argument, argument errors; assert an empty stub log
    - **Property 13: Bucket name validation**
    - **Validates: Requirements 16.1, 16.2, 16.3, 13.16**

  - [ ]* 9.3 Write property test for idempotence and no delete calls
    - Add cases to `run.sh`: absent bucket for `us-east-1` and another region, second run reports seven `already present` with no `put-*`, foreign tag kept, 403 other-account path, no `delete` in any call log
    - **Property 14: Create script is idempotent and never deletes**
    - **Validates: Requirements 16.4, 16.6, 16.7, 16.8, 16.9, 13.17**

  - [ ]* 9.4 Write property test for the check script
    - Add cases to `run.sh`: one wrong setting per case, all correct, unreadable bucket, only `head-bucket` and `get-*` calls, create-then-check gives seven `PASS`
    - **Property 15: Check script reports every setting and is read-only**
    - **Validates: Requirements 16.10, 16.11, 16.12, 13.17**

  - [ ]* 9.5 Write property test for `check-backend.sh`
    - Add cases to `run.sh` that copy the tree to a temporary directory and introduce each violation (second backend block, `backend "local"`, `dynamodb_table`, stray `.tfstate`, non-placeholder `backend.hcl.example`, missing file); assert file and rule on stderr and a non-zero exit, and exit 0 on the clean tree
    - **Property 16: Backend and repository files stay compliant**
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.17, 13.18, 13.19, 16.17**

- [ ] 10. README (`infra/terraform/README.md`)
  - [ ] 10.1 Write sections 1 to 4: prerequisites, quick start, variable table, output table
    - Prerequisites: Terraform `1.10.0` or later, AWS CLI, `jq` (required by both state bucket scripts), an AWS profile
    - Quick start: exactly six numbered steps; `-input=false` explanation; `terraform plan -out=tfplan` then `terraform apply tfplan` as the Operator procedure, `tfplan` not committed; `env_lines` retrieval and the append command; list order decides `VITE_REDIRECT_URI` and `VITE_LOGOUT_URI`
    - One table row for every declared variable and every declared output
    - _Requirements: 2.9, 10.6, 10.11, 14.4, 15.1, 15.2, 15.3, 15.4, 15.9_

  - [ ] 10.2 Write sections 5 to 7: first administrator, self-sign-up decision, feature plan and cost notes
    - AWS CLI and console steps for the first admin, with `terraform output -raw user_pool_id`, error cases for missing and existing users, temporary password and re-sign-in notes
    - Self-sign-up reasoning; `user_pool_tier` cost note and pricing-page check; table of values that match Frontend and Backend docs; adding a second environment
    - _Requirements: 4.7, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 15.1, 15.5, 15.6, 15.7_

  - [ ] 10.3 Write sections 8 to 10: state bucket and backend, optional group policy, uncertainties
    - Section 8: bucket and both scripts (arguments, flags, exit codes, example), seven settings, whole-document overwrite warning, existing-bucket check, partial backend, key naming, `.tflock` lock, no DynamoDB, `force-unlock` rule, version recovery, trade-off U13, manual bucket deletion, the `find` verification command, operating rules, deletion-protection and replacement warnings, the three permission groups
    - Section 9: policy creation, manual attach and `COGNITO_ADMIN_ENABLED=true` steps, the unverified Backend assumption
    - Section 10: U1 to U13 plus T2 to T6
    - _Requirements: 2.9, 2.10, 2.15, 2.16, 9.5, 9.8, 11.7, 14.1, 14.4, 14.5, 14.6, 15.1, 15.8, 16.13, 16.14, 16.15, 16.16_

- [ ] 11. Lock file generation
  - [ ] 11.1 Generate and verify `.terraform.lock.hcl`
    - Run `terraform init -backend=false`, then `terraform providers lock -platform=darwin_arm64 -platform=darwin_amd64 -platform=linux_amd64` in `infra/terraform/` (registry access only, no AWS)
    - Confirm one `hashicorp/aws` version that satisfies `>= 6.6.0, < 7.0.0` with hashes for the three platforms; finish with `terraform validate`
    - _Requirements: 2.2, 2.3, 2.11, 2.13_

- [ ] 12. Verify open design items (non-blocking)
  - [ ] 12.1 Check open items against current documentation and record results in `design.md`
    - Verify AWS CLI `s3api` subcommand names and argument shapes (including the `get-bucket-*` reads), IAM action names for encryption and lifecycle (T6), `head-bucket` 403/404 behaviour (T4), lifecycle `Filter` and policy normalisation (T5), whether `expect_failures` catches a missing variable (T2), and TOTP MFA on `LITE` (T3)
    - Add a "Verification Results" section to `design.md` with source links; adjust scripts or README only where a result differs, without blocking other tasks
    - _Requirements: 13.14, 14.6, 16.5_

- [ ] 13. Final checkpoint - All checks
  - Run in `infra/terraform/`: `terraform fmt -check -recursive`, `terraform init -backend=false`, `terraform validate`, `terraform test`, `tflint` where installed, `tests/scripts/run.sh`, and `scripts/check-backend.sh`. All need no AWS credentials.
  - Confirm `find infra/terraform -name '*.tfstate*' -not -path '*/.terraform/*'` prints nothing.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Property tests are `terraform test` run blocks or bash test loops over representative input tables, not generative tests.
- The Operator, not the agent, runs `terraform apply`, `terraform destroy`, `create-state-bucket.sh` and `check-state-bucket.sh` against a real account.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "12.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.1", "6.1", "6.2", "6.3"] },
    { "id": 2, "tasks": ["3.2", "6.4"] },
    { "id": 3, "tasks": ["3.3"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["3.5"] },
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["8.1", "8.4", "8.8", "8.10", "8.11", "8.13", "8.14", "8.15", "9.1", "10.1", "11.1"] },
    { "id": 9, "tasks": ["8.2", "8.5", "8.9", "8.12", "8.16", "9.2", "10.2"] },
    { "id": 10, "tasks": ["8.3", "8.6", "9.3", "10.3"] },
    { "id": 11, "tasks": ["8.7", "9.4"] },
    { "id": 12, "tasks": ["9.5"] }
  ]
}
```
