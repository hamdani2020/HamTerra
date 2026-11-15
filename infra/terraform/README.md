# Eco Sentinel: Cognito infrastructure (Terraform)

This directory provisions the Amazon Cognito user pool, app client, domain and groups for Eco Sentinel. Only the Operator runs `terraform apply`, `terraform destroy` and `create-state-bucket.sh`. Run every command below from `infra/terraform/` unless a path says otherwise.

No Terraform state file is ever kept on local disk or committed to the repository. State lives only in the S3 State_Bucket, which `scripts/create-state-bucket.sh` creates once, outside Terraform. The `tfplan` file written by `terraform plan -out=tfplan` is not committed either.

## 1. Prerequisites

- Terraform `>= 1.10.0`. Older versions fail at `terraform init`. This version is needed for the S3 lockfile (`use_lockfile`).
- AWS CLI v2.
- `jq`. Both state bucket scripts (`scripts/create-state-bucket.sh` and `scripts/check-state-bucket.sh`) require it to compare JSON documents.
- An AWS profile, selected with `AWS_PROFILE` or the standard AWS CLI credential chain, that may manage Cognito and the State_Bucket. Credentials are never written to files in this repository.

## 2. Quick start

1. Create or choose the State_Bucket. For a new bucket run `scripts/create-state-bucket.sh <bucket-name> <region>` once. For an existing bucket run `scripts/check-state-bucket.sh <bucket-name>` and correct every `FAIL` line before the first `terraform init`.
2. Copy `backend.hcl.example` to `backend.hcl` (git-ignored) and fill in `bucket`, `key` and `region` from the lines the create script printed. In the key `eco-sentinel/<environment>/cognito.tfstate`, replace `<environment>` with the value of the `environment` variable. Terraform cannot check that the two match. Copy `terraform.tfvars.example` to `terraform.tfvars` (git-ignored) and set at least `aws_region` and `cognito_domain_prefix`.
3. Initialise the backend:

   ```sh
   terraform init -input=false -backend-config=backend.hcl
   ```

   `-input=false` makes Terraform fail with an error when a backend value is missing, instead of stopping to ask for it at a prompt. A run therefore never hangs and never stores a value typed by hand.
4. Write the plan to a file and read all of its output:

   ```sh
   terraform plan -out=tfplan
   ```

5. Operator only: after reading the full plan for this same working directory, apply exactly that plan:

   ```sh
   terraform apply tfplan
   ```

   `tfplan` is not committed to the repository (it is git-ignored). Do not use `-auto-approve`.
6. Retrieve `env_lines` and append it to the repository `.env`. `env_lines` is a nine-line block of Cognito settings for the Backend and Frontend. Print it with `terraform output -raw env_lines`, or append it with:

   ```sh
   { scripts/print-env.sh; echo; } >> ../../.env
   ```

   `scripts/print-env.sh` writes the output unchanged to stdout and writes no file. It prints no final line feed, so the `echo` ends the last `.env` line. This is the same as `scripts/print-env.sh >> ../../.env` plus the final newline.

The order of the lists decides two values. The first element of `callback_urls` becomes `VITE_REDIRECT_URI`, and the first element of `logout_urls` becomes `VITE_LOGOUT_URI`. `ALLOWED_ORIGINS` is the de-duplicated scheme and host of the `callback_urls`, in order of first appearance.

## 3. Variables

Defined in `variables.tf`. A variable without a default is required.

| Name | Description | Default | Required |
| --- | --- | --- | --- |
| `aws_region` | AWS region for all resources. Must look like `eu-west-1`. | none | yes |
| `environment` | Environment name: `dev`, `staging` or `prod`. Also part of the state key. | `"dev"` | no |
| `project_name` | Short project name used in resource names and the `Project` tag. 1 to 32 characters: lowercase letters, digits, hyphens, not starting with a hyphen. | `"eco-sentinel"` | no |
| `cognito_domain_prefix` | Cognito prefix domain. Unique per region across AWS. 1 to 63 characters of lowercase letters, digits and hyphens, no leading or trailing hyphen, must not contain `aws`, `amazon` or `cognito`. | none | yes |
| `callback_urls` | OAuth callback URLs, 1 to 100 entries, no duplicates. https, or http only for `localhost` or `127.0.0.1`. No fragment, wildcard or whitespace. The first element becomes `VITE_REDIRECT_URI`. | `["http://localhost:5173/auth/callback"]` | no |
| `logout_urls` | OAuth sign-out URLs, same rules as `callback_urls`. The first element becomes `VITE_LOGOUT_URI`. | `["http://localhost:5173/signed-out", "http://localhost:5173/"]` | no |
| `allow_self_signup` | Allow public sign-up. When `false`, only an administrator creates users. | `false` | no |
| `deletion_protection` | Protect the user pool from deletion. Must stay `true` when `environment` is `staging` or `prod`. | `true` | no |
| `mfa_configuration` | User pool MFA mode: `OFF`, `OPTIONAL` or `ON`. TOTP only. | `"OPTIONAL"` | no |
| `user_pool_tier` | Cognito feature plan: `LITE`, `ESSENTIALS` or `PLUS`. Cost-relevant; check the AWS pricing page before apply. | `"ESSENTIALS"` | no |
| `managed_login_version` | `1` for the classic hosted UI, `2` for managed login. | `2` | no |
| `access_token_validity_minutes` | Access token lifetime in minutes, whole number from 5 to 1440. | `60` | no |
| `id_token_validity_minutes` | ID token lifetime in minutes, whole number from 5 to 1440. | `60` | no |
| `refresh_token_validity_days` | Refresh token lifetime in days, whole number from 1 to 3650. | `30` | no |
| `enable_group_admin_policy` | Create the optional IAM policy for Cognito group management. | `false` | no |
| `tags` | Extra tags merged over the default tags. | `{}` | no |

## 4. Outputs

Defined in `outputs.tf`. No output is `sensitive`, and no output carries a client secret.

| Name | Description |
| --- | --- |
| `env_lines` | Nine `KEY=value` lines (`COGNITO_*`, `ALLOWED_ORIGINS`, `VITE_*`) joined by single line feeds, ready to append to `.env`. |
| `user_pool_id` | ID of the Cognito user pool. |
| `user_pool_arn` | ARN of the Cognito user pool. |
| `app_client_id` | ID of the public app client. |
| `region` | AWS region of the user pool. |
| `domain_url` | Hosted domain URL, `https://<prefix>.auth.<region>.amazoncognito.com`. |
| `issuer_url` | Token issuer URL, `https://cognito-idp.<region>.amazonaws.com/<pool_id>`. |
| `jwks_url` | JWKS URL, `<issuer_url>/.well-known/jwks.json`. |
| `group_names` | Names of the user pool groups, sorted. |
| `group_admin_policy_arn` | ARN of the optional group-management IAM policy, or `null` when `enable_group_admin_policy` is `false`. |

## 5. First administrator

Terraform creates no user, no group membership and no password (the module has no `aws_cognito_user` resource and no password variable). The Operator creates the first administrator after `terraform apply`, using the pool ID from the Terraform output so that no value is copied by hand. Run these commands from `infra/terraform/`. Replace `<email>` with the administrator's email address.

### AWS CLI

1. Create the user. Cognito emails a temporary password to the address. Terraform never sees or stores it.

   ```sh
   aws cognito-idp admin-create-user \
     --user-pool-id "$(terraform output -raw user_pool_id)" \
     --username <email> \
     --user-attributes Name=email,Value=<email> Name=email_verified,Value=true \
     --desired-delivery-mediums EMAIL
   ```

2. Add the user to the `admin` group.

   ```sh
   aws cognito-idp admin-add-user-to-group \
     --user-pool-id "$(terraform output -raw user_pool_id)" \
     --username <email> \
     --group-name admin
   ```

### AWS console

1. Open Amazon Cognito, select the user pool, open **Users**, choose **Create user**, enter the email address, tick "Mark email address as verified", choose to send an email invitation, and confirm.
2. Open **Groups**, select `admin`, choose **Add user to group**, select the user, and confirm.

### Error cases

- If `admin-add-user-to-group` runs for a user that does not exist, it fails with a `UserNotFoundException` error. Run the `admin-create-user` step first, then repeat the failed command.
- If `admin-create-user` runs for an email address that already has an account in the pool, it fails with a `UsernameExistsException` error. Skip the create step and run only `admin-add-user-to-group`.

### Temporary password and sign-in

The temporary password is valid for 7 days. The user must sign in with it and then set a new password that meets the policy (at least 12 characters with a lowercase letter, an uppercase letter, a number and a symbol). After any group change, the user must sign out and sign in again to receive a new token that carries the new group (uncertainty U8). Tokens issued earlier keep the old groups until they expire.

## 6. Self-sign-up decision

`allow_self_signup` defaults to `false`. In that case the user pool sets `allow_admin_create_user_only = true`, so a public sign-up request is rejected and creates no user. Only an administrator creates accounts.

Reason: the Backend grants a Role only from group membership, and an administrator is the only party who assigns a group. An open sign-up would create accounts that hold no Role but still appear in the user directory.

Consequence: every user, including the first administrator, needs the procedure in section 5 (or the Backend group management, when enabled). If you set `allow_self_signup = true`, the module still creates no users and no group memberships, so a self-registered user has no Role until an administrator adds the user to a group.

## 7. Feature plan and cost notes

- `user_pool_tier` is the cost-relevant choice. It accepts `LITE`, `ESSENTIALS` (default) or `PLUS`. Before apply, check the free allowance and the prices of the Cognito feature plans on the AWS pricing page for Amazon Cognito. This README states no prices.
- `managed_login_version` is `2` (managed login) by default, or `1` (classic hosted UI). Managed login requires `ESSENTIALS` or `PLUS`. The classic hosted UI is available on every plan. Do not combine `user_pool_tier = "LITE"` with `managed_login_version = 2`: the combination is invalid, and the failure appears at apply time unless a variable validation rejects it earlier (design.md, "Verification Results", finding F1). With `LITE`, set `managed_login_version = 1`.
- MFA uses authenticator apps (TOTP) only. `mfa_configuration` defaults to `OPTIONAL`. When it is `OPTIONAL` or `ON`, the pool enables software-token MFA. No SMS role, SNS topic or SES identity is created. TOTP is listed for all three plans. Email one-time-code MFA needs `ESSENTIALS` or `PLUS` and is not used. Whether the AWS provider accepts the TOTP block with `OPTIONAL` on `LITE` is unverified until the first apply (uncertainty T3).

### Values that must match the Frontend and Backend documentation

| Value | Terraform variable or output | `.env` line |
| --- | --- | --- |
| Callback URL | first element of `callback_urls` | `VITE_REDIRECT_URI` |
| Sign-out URL | first element of `logout_urls` | `VITE_LOGOUT_URI` |
| Second sign-out URL | remaining elements of `logout_urls` (registered on the app client) | none |
| Allowed web origin | scheme and host of each `callback_urls` entry | `ALLOWED_ORIGINS` |
| Scopes | fixed in the module: `openid`, `email`, `profile` (Authorization Code flow with PKCE) | none |
| Groups | output `group_names`: `admin`, `researcher` | none |
| Public client, no secret | output `app_client_id`; the module sets `generate_secret = false` and has no secret output | `COGNITO_*` and `VITE_*` client ID lines |
| Hosted domain | output `domain_url` | `env_lines` |
| Issuer and JWKS | outputs `issuer_url`, `jwks_url` | `env_lines` |

### Adding a second environment

1. Copy `terraform.tfvars` to a second file, for example `staging.tfvars`. Set `environment`, a distinct `cognito_domain_prefix` (prefixes are unique per region across AWS), and that environment's URLs.
2. Copy `backend.hcl` to a second Backend_Config_File, for example `backend-staging.hcl`. Keep the same `bucket` and use the key `eco-sentinel/<environment>/cognito.tfstate`, for example `eco-sentinel/staging/cognito.tfstate`, in the same State_Bucket.
3. Use a separate working copy of `infra/terraform/` for each environment, so each has its own `.terraform` directory. In that copy run `terraform init -input=false -backend-config=backend-staging.hcl`, then `terraform plan -var-file=staging.tfvars -out=tfplan`, and apply as in section 2. For `staging` and `prod`, `deletion_protection` must stay `true`.

## 8. State bucket and backend

### The State_Bucket and why Terraform does not manage it

All Terraform state lives in one S3 bucket, the State_Bucket. The bucket is deliberately not managed by Terraform. A bucket created by Terraform cannot hold that same Terraform's state from the first `terraform init` without a local-state phase and a later state migration. Creating the bucket with a script outside Terraform removes both. No Terraform state file is ever kept on local disk, and no state migration is ever needed.

Trade-off (uncertainty U13): Terraform does not drift-check the bucket. A manual change to versioning, encryption, public access block, policy or lifecycle shows up only in `scripts/check-state-bucket.sh`, never in `terraform plan`. Run the check script after any change to the bucket and before the first apply in a new account.

### Who runs what

- Only the Operator runs `terraform apply`, `terraform destroy` and `scripts/create-state-bucket.sh`.
- `create-state-bucket.sh` runs once per State_Bucket. It is safe to repeat, but there is no reason to.
- `terraform apply` runs only after the Operator has read the full output of `terraform plan` for the same working directory, using `terraform apply tfplan` (section 2). Never pass `-auto-approve`.
- The Backend and Frontend applications never run Terraform, hold no Terraform state, and never create, change or delete Cognito pools, clients, groups or users. This matches Backend requirement 20.14. The Backend's optional admin role (section 9) changes only group membership.

### The seven bucket settings

| Setting | Value |
| --- | --- |
| versioning | `Enabled` |
| encryption | default encryption with SSE-S3 (`AES256`) |
| public access block | `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy` and `RestrictPublicBuckets` all `true` |
| object ownership | `BucketOwnerEnforced` |
| TLS-only policy | one `Deny` statement for principal `*`, action `s3:*`, on the bucket ARN and the bucket ARN followed by `/*`, with the condition `Bool` `aws:SecureTransport` equal to `false` |
| lifecycle | one enabled rule with no prefix filter: expire noncurrent object versions after N days (default 90) and abort incomplete multipart uploads after 7 days. No rule expires current versions. |
| tags | `Project=eco-sentinel` and `ManagedBy=operator-script` |

### `scripts/create-state-bucket.sh`

```sh
scripts/create-state-bucket.sh <bucket-name> <region> [--noncurrent-days <n>]
scripts/create-state-bucket.sh --validate-only <bucket-name>
```

- `<bucket-name>`: 3 to 63 characters of lowercase letters, digits and hyphens. No period, no leading or trailing hyphen, not formatted like an IPv4 address, not starting with `xn--` or `sthree-`, not ending with `-s3alias` or `--ol-s3`. A bucket name is unique across all AWS accounts (uncertainty U9), so availability is known only when the script runs.
- `<region>`: the AWS region of the bucket, for example `eu-west-1`. The script passes it on every AWS CLI call. For `us-east-1` it omits the `LocationConstraint`.
- `--noncurrent-days <n>`: whole number from 1 to 3650 (default 90). Days after which noncurrent object versions expire.
- `--validate-only <bucket-name>`: checks the name only. It makes no AWS call and exits `0` for a valid name.

For a missing bucket the script creates it and applies the seven settings. For a bucket you own it reads each setting first and changes only what differs. It prints one status line per step on standard error, `applied` or `already present`. A repeated run with the same arguments reports `already present` for all seven settings and makes no change. The script never deletes anything: it calls no `delete` subcommand and has no bucket, object, version or policy removal.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success, or (with `--validate-only`) the name is valid. |
| `1` | Rejected bucket name, region or `--noncurrent-days`, bad arguments, or `jq` missing. The message names the rejected value and the rule. No AWS call was made. |
| `2` | The bucket exists but is not readable with these credentials. It is probably owned by another account, or you lack `s3:ListBucket`. No setting was changed. Choose another name or fix the permission. |
| `3` | An AWS call failed, or `head-bucket` returned an error the script does not understand (for example HTTP 400). The script stops and never treats such an error as "bucket absent" (finding F2 in section 10). |

Example:

```sh
scripts/create-state-bucket.sh my-eco-sentinel-tfstate eu-west-1 > backend.hcl
```

Status lines go to standard error and only the three `backend.hcl` lines go to standard output, so the redirect captures just those lines. The script itself writes no file. The output is:

```hcl
bucket = "my-eco-sentinel-tfstate"
key    = "eco-sentinel/<environment>/cognito.tfstate"
region = "eu-west-1"
```

Replace `<environment>` in `backend.hcl` by hand (see "Backend configuration" below). `my-eco-sentinel-tfstate` is a placeholder. Never commit a real bucket name.

Whole-document overwrite warning: `put-bucket-policy` and `put-bucket-lifecycle-configuration` replace the complete document. If the bucket already has other policy statements or lifecycle rules, the script overwrites them. Tags are the exception: the script merges `Project` and `ManagedBy` into the existing tags and keeps the others. Before running the create script on an existing bucket that carries other policies or rules, run `check-state-bucket.sh` and review the bucket by hand.

### `scripts/check-state-bucket.sh`

```sh
scripts/check-state-bucket.sh <bucket-name>
NONCURRENT_DAYS=30 scripts/check-state-bucket.sh <bucket-name>
```

The script is read-only. It calls only `head-bucket` and `get-*` subcommands and changes nothing. It takes the region from your AWS CLI configuration or `AWS_REGION`. It prints one line on standard output for each of the seven settings, `PASS <setting>` or `FAIL <setting>`, for `versioning`, `encryption`, `pab`, `ownership`, `policy`, `lifecycle` and `tags`. `NONCURRENT_DAYS` is optional. When it is unset, the lifecycle check accepts any noncurrent expiry of 1 day or more. When it is set, the lifecycle check requires exactly that value.

| Code | Meaning |
| --- | --- |
| `0` | All seven lines are `PASS`. |
| `1` | At least one line is `FAIL`, or the arguments are bad, or `jq` is missing. |
| `2` | The bucket cannot be read (it does not exist, or access is denied). The message names the bucket and the AWS error. No `PASS` line is printed. |

Using an existing bucket: run `check-state-bucket.sh <bucket-name>` on it and correct every `FAIL` line before the first `terraform init`. The first run also shows any missing read permission (uncertainty U11).

### Backend configuration

`backend.tf` is committed and holds only the non-secret backend arguments `use_lockfile = true` and `encrypt = true`. The values `bucket`, `key` and `region` come from the git-ignored `backend.hcl`, a partial backend configuration. Create it by copying `backend.hcl.example` or from the lines the create script printed. Replace `<environment>` in the key with the value of the `environment` variable. Terraform cannot check that the two match, so this is an Operator rule.

Every init is:

```sh
terraform init -input=false -backend-config=backend.hcl
```

`-input=false` makes a missing backend value fail with an error instead of a prompt. For checks that need no backend (validation and tests) use `terraform init -backend=false`. That needs no credentials, no `backend.hcl` and no access to AWS.

This setup needs no state migration. Do not run `terraform init -migrate-state` or `terraform init -reconfigure` to move state from local disk to S3. There is no local state to move.

Key naming. Each environment has its own state object and lock object in the same bucket:

| Object | Purpose |
| --- | --- |
| `eco-sentinel/<environment>/cognito.tfstate` | State of that environment (`dev`, `staging` or `prod`). |
| `eco-sentinel/<environment>/cognito.tfstate.tflock` | Lock object. It exists only while a Terraform command runs. |

### Locking

The lock is the S3 object `<key>.tflock` in the State_Bucket (S3-native locking, `use_lockfile`). This setup creates no DynamoDB table. A second `terraform plan` or `terraform apply` that starts while the lock exists fails with a lock error and leaves the state unchanged.

If a run was interrupted and left a stale lock, release it with `terraform force-unlock <lock-id>`, using the lock ID from the error message. Do this only after you have confirmed that no other Terraform process is running for that key. Unlocking under a live process can corrupt the state.

### Recovering a previous state version

Bucket versioning keeps earlier versions of every state object. To recover, list the S3 object versions of `eco-sentinel/<environment>/cognito.tfstate`, choose the version you want, and restore it by copying that version over the current object or by downloading it and uploading it as the new current version. The S3 object versions are the recovery source. Noncurrent versions expire after the configured days (default 90), so recover within that period.

### Deleting the bucket

Deleting the State_Bucket is a manual procedure outside this spec. The scripts never delete the bucket, its objects, its versions or its policy. Delete the bucket only after every environment's resources are destroyed and you no longer need the state history.

### Verify that no state is on disk

From the repository root:

```sh
find infra/terraform -name '*.tfstate*' -not -path '*/.terraform/*'
```

The expected output is empty. The file `.terraform/terraform.tfstate` holds only backend settings, is git-ignored, and is not a state file.

### Warnings: deletion protection and replacement

- `deletion_protection` defaults to `true`. For `staging` and `prod` it must stay `true`, and a plan with `false` fails.
- While protection is on, `terraform destroy` fails at the AWS API for the user pool and leaves the pool and its users unchanged. To destroy on purpose, set `deletion_protection = false` and run `terraform apply` successfully first, then run `terraform destroy`.
- Destroying or replacing the user pool deletes every user. A replacement also changes the pool ID and the client ID. Update the Frontend and Backend settings with the new values (print them again with `scripts/print-env.sh`).
- Read the whole `terraform plan` output before every apply. Look for `must be replaced` and `destroy` lines on the user pool and the app client.

### Operator permissions

The Operator's AWS identity needs these permissions in three groups. Replace `<state-bucket>` and `<environment>` with real values at use time and never commit them. The exact set that the AWS provider calls on refresh is not verified, so the first `terraform plan` shows any gap.

**(a) Cognito.** `cognito-idp:CreateUserPool`, `UpdateUserPool`, `DeleteUserPool`, `DescribeUserPool`, `SetUserPoolMfaConfig`, `GetUserPoolMfaConfig`, `CreateUserPoolClient`, `UpdateUserPoolClient`, `DeleteUserPoolClient`, `DescribeUserPoolClient`, `CreateUserPoolDomain`, `UpdateUserPoolDomain`, `DeleteUserPoolDomain`, `DescribeUserPoolDomain`, `CreateGroup`, `UpdateGroup`, `DeleteGroup`, `GetGroup`, `TagResource`, `UntagResource` and `ListTagsForResource`. Add `iam:CreatePolicy`, `GetPolicy`, `GetPolicyVersion`, `ListPolicyVersions`, `DeletePolicy`, `TagPolicy` and `ListPolicyTags` only when `enable_group_admin_policy` is `true`.

**(b) State access**, for each state key in use:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<state-bucket>",
      "Condition": { "StringLike": { "s3:prefix": ["eco-sentinel/*"] } } },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::<state-bucket>/eco-sentinel/<environment>/cognito.tfstate" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<state-bucket>/eco-sentinel/<environment>/cognito.tfstate.tflock" }
  ]
}
```

**(c) State bucket scripts.** For `create-state-bucket.sh`: `s3:CreateBucket`, `s3:PutBucketVersioning`, `s3:PutEncryptionConfiguration`, `s3:PutBucketPublicAccessBlock`, `s3:PutBucketOwnershipControls`, `s3:PutBucketPolicy`, `s3:PutLifecycleConfiguration` and `s3:PutBucketTagging`. For both scripts, the matching reads: `s3:ListBucket` (needed by `head-bucket`), `s3:GetBucketVersioning`, `s3:GetEncryptionConfiguration`, `s3:GetBucketPublicAccessBlock`, `s3:GetBucketOwnershipControls`, `s3:GetBucketPolicy`, `s3:GetLifecycleConfiguration` and `s3:GetBucketTagging`. The IAM names for encryption and lifecycle differ from the AWS CLI names. They were checked against the AWS documentation (uncertainty T6, section 10). The first run of `check-state-bucket.sh` shows any action that is still missing (uncertainty U11).

## 9. Optional group policy

With `enable_group_admin_policy = true`, the module creates one IAM policy named `<project_name>-<environment>-cognito-group-admin`. It allows exactly three actions, `cognito-idp:AdminAddUserToGroup`, `cognito-idp:AdminRemoveUserFromGroup` and `cognito-idp:AdminListGroupsForUser`, on this user pool's ARN only. It has no `Condition`. The default is `false`, and then no IAM object exists.

The ARN is available as the output `group_admin_policy_arn` (`null` while the variable is `false`):

```sh
terraform output -raw group_admin_policy_arn
```

The module creates no IAM user, no access key, no role and no policy attachment. Attaching the policy is a manual step, so that the Operator decides which identity receives it.

Steps:

1. Set `enable_group_admin_policy = true` in `terraform.tfvars`, then run `terraform plan -out=tfplan`, read the full output, and run `terraform apply tfplan` (Operator only). This creates the policy and nothing else.
2. Attach the policy to the IAM identity the Backend will use, with the ARN from `terraform output -raw group_admin_policy_arn`. For example, with the AWS CLI for an IAM user: `aws iam attach-user-policy --user-name <backend-user> --policy-arn "$(terraform output -raw group_admin_policy_arn)"`. Use a role instead if your deployment runs the Backend under a role.
3. Supply that identity's credentials to the Backend through the standard AWS credential chain for the Backend's environment. Never put keys in this repository.
4. Set `COGNITO_ADMIN_ENABLED=true` in the Backend settings. Its default is `false`.

Security note: anyone who can run `AdminAddUserToGroup` on the pool can add any user to the `admin` group. Give the policy only to an identity you trust with that.

Unverified Backend assumption: the Backend design assumes these three permissions are enough for its optional group management, and the Backend design does not verify them. Test the Backend's group calls once with the attached identity before relying on them.

## 10. Uncertainties

U1 to U13 come from the requirements. T2 to T6 come from the design, and the design findings F1 and F2 (not the follow-up items F1 to F3 of the requirements) record results of checking public AWS documentation. No check ran against a real AWS account. Verify the items marked open at the first real apply or on a scratch account.

### U1 to U13

- **U1 Feature plan and price.** `user_pool_tier` accepts `LITE`, `ESSENTIALS` and `PLUS`. Which plan includes managed login version 2, refresh token rotation and password history, and the free allowance and price per monthly active user, are not verified here. Check the AWS Cognito feature plan and pricing pages before the first apply. The default plan is a design decision and a variable.
- **U2 Refresh token rotation.** The `refresh_token_rotation` block needs a recent AWS provider version. The minimum provider version, and whether your chosen plan supports it, are not verified. The lock file records the tested provider version.
- **U3 Explicit auth flows for managed login.** The exact `explicit_auth_flows` set that a Cognito-hosted sign-in needs for the Authorization Code flow is not verified. The configuration lists only `ALLOW_REFRESH_TOKEN_AUTH`. The first apply must confirm that sign-in works.
- **U4 Domain prefix rules.** A Cognito prefix domain is unique per region across AWS, and AWS restricts reserved words in the prefix. The exact rules are not verified. The module validates only the character set, the length and the words `aws`, `amazon` and `cognito`. A taken prefix is reported by AWS at apply time, not at plan time.
- **U5 Default email sender limit.** The built-in Cognito email sender has a low daily sending limit. The limit is not verified. SES configuration is out of scope.
- **U6 Password history.** `password_history_size` may need a paid plan. It is not configured in this version.
- **U7 Mock provider coverage.** `terraform test` with `mock_provider` needs Terraform 1.7 or later (this configuration needs 1.10 or later). Mocked computed values such as IDs and endpoints are generated, so tests check configuration and output wiring, not real AWS behaviour. `command = apply` under `mock_provider "aws"` sends no request to AWS.
- **U8 Group changes and tokens.** A group change appears in the `cognito:groups` claim only in tokens issued after the change. The user must sign out and sign in again.
- **U9 Bucket name uniqueness.** An S3 bucket name is unique across all AWS accounts in a partition. Whether a name is free is known only when `create-state-bucket.sh` runs. The script validates the S3 naming rules, not availability.
- **U10 Terraform version for locking.** S3-native locking needs Terraform 1.10 or later. An older Terraform cannot run this configuration, and mixing versions across Operators is not supported.
- **U11 Operator permissions for the bucket.** The complete set of S3 read actions the two scripts call is not verified. Section 8 lists the known actions, and the first run of `check-state-bucket.sh` shows any missing one.
- **U12 Cost of state storage.** The cost of S3 storage and requests for a few small state objects and their noncurrent versions is expected to be negligible. The exact price is not verified. Check the AWS S3 pricing page.
- **U13 Bucket settings drift.** Terraform does not manage the State_Bucket. A manual change to its versioning, encryption, public access block, policy or lifecycle is detected only by `check-state-bucket.sh`, not by `terraform plan`. Run the check script after any change to the bucket and before the first apply in a new account.

### T2 to T6 (design)

- **T2 Missing-variable test.** Whether `expect_failures = [var.aws_region]` in `terraform test` catches a missing required variable is open. The Terraform test documentation says `expect_failures` applies only to custom conditions, and a missing variable has none. This is inferred from the documentation and was not run. The tests use a shell check for the two missing-variable cases.
- **T3 TOTP MFA on `LITE`.** The AWS documentation lists authenticator-app MFA for all three plans, so the TOTP-only choice stands. Whether the AWS provider accepts `software_token_mfa_configuration` with `mfa_configuration = "OPTIONAL"` on `LITE` without an API error is open until the first apply on that plan.
- **T4 `head-bucket` error mapping.** The AWS CLI reference documents only the status codes 400, 403 and 404 and gives no message body. A 403 also occurs for your own bucket when you lack `s3:ListBucket`. The scripts match the code or the words `Not Found` and `Forbidden` in the CLI error text. The exact error text is not documented. Only a 404 leads to bucket creation.
- **T5 Read-command names and server normalisation.** The names and arguments of the 16 `s3api` subcommands the scripts use were confirmed in the AWS CLI reference. How S3 stores and returns an empty lifecycle `Filter` (`{}` or `{"Prefix": ""}`) and the key order and single-element arrays of a bucket policy is not documented. The probes accept both filter forms, decode and compare the policy semantically, and compare only the `Rules` of the lifecycle response. This is open until a real bucket is read.
- **T6 IAM action names.** Confirmed against the AWS documentation of S3 policy actions: `s3:PutEncryptionConfiguration`, `s3:GetEncryptionConfiguration`, `s3:PutLifecycleConfiguration` and `s3:GetLifecycleConfiguration` are the correct names, and `head-bucket` needs `s3:ListBucket`.

### Design findings F1 and F2

- **F1 `LITE` with managed login.** Managed login (`managed_login_version = 2`) is available on `ESSENTIALS` and `PLUS` only. The classic hosted UI is available on every plan. The combination `user_pool_tier = "LITE"` with `managed_login_version = 2` is invalid. A variable validation may reject it at plan time. If it does not, the failure appears at apply time. With `LITE`, set `managed_login_version = 1` (see section 7).
- **F2 `head-bucket` errors other than 404.** A `400` or an unrecognised error can mean the name is unusable. `create-state-bucket.sh` ends with exit code `3` and the raw message in that case. It never tries to create the bucket on an error it does not understand.

## 11. Backend host on EC2 (`modules/ec2`)

The `ec2` module runs the Backend and PostGIS with Docker Compose on one Ubuntu 24.04 instance in the default VPC. It creates:

- one `t3.small` instance (`backend_instance_type`) with an encrypted 30 GiB gp3 root volume and IMDSv2 required,
- an Elastic IP attached to it (output `backend_public_ip`),
- a security group with inbound TCP 80 and 443 only. There is no SSH and no key pair; use SSM Session Manager,
- an instance role with `AmazonSSMManagedInstanceCore` and read access to the SSM Parameter Store path `/<project_name>/<environment>/backend` only (output `backend_ssm_parameter_path`). With `enable_group_admin_policy = true` the Cognito group policy from section 9 is attached to this role as well.

First boot installs Docker with the Compose plugin, nginx, certbot and the AWS CLI, adds 2 GiB of swap, creates the app directory (output `backend_app_dir`), and configures nginx to proxy `backend_domain_name` to `127.0.0.1:8000`.

New required variables: `backend_domain_name` and `certbot_email`.

### Enable HTTPS (once, after the first apply)

1. In Route 53, create an `A` record for `backend_domain_name` with the value of `terraform output -raw backend_public_ip`.
2. Wait until the name resolves to that address (`dig +short <backend_domain_name>`).
3. Run the certbot helper on the instance:
   ```sh
   aws ssm send-command --instance-ids "$(terraform output -raw backend_instance_id)" \
     --document-name AWS-RunShellScript --parameters 'commands=["/usr/local/bin/eco-enable-https"]'
   ```
   It requests a Let's Encrypt certificate, switches nginx to HTTPS and redirects HTTP to HTTPS. It is safe to run again. The certbot package renews certificates with a systemd timer.

### Data and rebuilds

The PostGIS data lives in a Docker volume on the root volume, as in local development. Terminating or replacing the instance deletes it. Terraform ignores changes to the AMI and the user data, so a new Ubuntu release does not replace the instance; rebuild deliberately with `terraform apply -replace=module.ec2.aws_instance.backend`. There are no automatic backups.
