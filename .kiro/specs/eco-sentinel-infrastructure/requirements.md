# Requirements Document

## Introduction

Eco-Sentinel Ghana Infrastructure is the third coordinated spec, next to `eco-sentinel-backend` and `eco-sentinel-frontend`. It defines Terraform code that provisions the AWS Cognito User Pool the other two specs depend on. In this version the spec contains a Cognito module, the minimal root configuration that calls it, and two AWS CLI scripts that create and check the S3 bucket holding the Terraform state. State is never kept locally: the root configuration uses a remote S3 backend with S3-native locking (`use_lockfile`, Terraform 1.10 or later) from the first `terraform init`, and no state migration happens at any point. Because a bucket cannot be created by Terraform and also hold that Terraform's state from the first init, the State_Bucket is created once, outside Terraform, by the Operator with a documented script (or an existing bucket is used). This is a deliberate trade-off: no state ever lives on local disk, and the cost is that the bucket settings are not managed or drift-checked by Terraform (see U13). No hosting, application database, networking or CI/CD resources are in scope. The directory layout lets later modules be added next to the Cognito module without moving existing files.

### Values Taken from the Other Specs

| Consumer | Needs | Source |
|---|---|---|
| Frontend | Public app client without client secret, Authorization Code flow with PKCE, scopes `openid`, `email`, `profile`, callback URL `http://localhost:5173/auth/callback`, sign-out URLs `http://localhost:5173/signed-out` and `http://localhost:5173/`, token renewal with the `refresh_token` grant, Cognito domain, client ID, region | Frontend requirements 3 and 22.10, Frontend design "Cognito local settings" |
| Backend | User pool ID, region, app client ID, issuer URL, JWKS URL, access tokens with `token_use=access`, roles from the groups `admin` and `researcher`, `ALLOWED_ORIGINS` containing `http://localhost:5173` | Backend requirements 2 and 12, Backend design "Settings (Environment)" |
| Backend (optional, flag `COGNITO_ADMIN_ENABLED`, default `false`) | IAM permissions for the `cognito-idp` calls `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`, `AdminListGroupsForUser` | Backend design "U7 and U8: Cognito Administration" |

### Resources Used (checked against the AWS provider documentation)

`aws_cognito_user_pool`, `aws_cognito_user_pool_client`, `aws_cognito_user_pool_domain`, `aws_cognito_user_group`, and optionally `aws_iam_policy`. No S3 resource is declared in Terraform. The S3 backend arguments relied on, checked against the Terraform S3 backend documentation, are `bucket`, `key`, `region`, `encrypt` and `use_lockfile`. The documentation marks DynamoDB-based locking as deprecated, so this spec uses none of it. The provider arguments relied on are: on the pool `username_attributes`, `auto_verified_attributes`, `deletion_protection` (`ACTIVE` or `INACTIVE`), `mfa_configuration`, `password_policy`, `account_recovery_setting`, `admin_create_user_config.allow_admin_create_user_only`, `user_pool_tier` (`LITE`, `ESSENTIALS`, `PLUS`), `software_token_mfa_configuration`, `tags`; on the client `generate_secret`, `allowed_oauth_flows_user_pool_client`, `allowed_oauth_flows`, `allowed_oauth_scopes`, `callback_urls`, `logout_urls`, `supported_identity_providers`, `explicit_auth_flows`, `prevent_user_existence_errors`, `enable_token_revocation`, `access_token_validity`, `id_token_validity`, `refresh_token_validity`, `token_validity_units`, `refresh_token_rotation` (`feature`, `retry_grace_period_seconds`); on the domain `domain`, `user_pool_id`, `managed_login_version`.

### Relationship to the Backend Rule on Cognito

The Backend spec states that the application never creates, modifies or deletes Cognito pools, clients, groups or users (Backend requirement 20.14). This spec does not change that rule. Terraform is run by a human operator outside the application, and the application runtime holds no Terraform code or state. The Backend still only calls the three group-membership APIs, and only when `COGNITO_ADMIN_ENABLED=true`.

### Technical Uncertainties

- **U1 Feature plan and price.** `user_pool_tier` accepts `LITE`, `ESSENTIALS`, `PLUS`. Which plan includes managed login version 2, refresh token rotation and password history, and the free allowance and price per monthly active user of each plan, are not verified here. Verify at the AWS Cognito feature plan and pricing pages before the first apply. The default tier is a design decision and a variable.
- **U2 Refresh token rotation.** The `refresh_token_rotation` block needs a recent AWS provider version. The minimum provider version, and whether the Cognito plan chosen supports it, are not verified. The design records the tested provider version.
- **U3 Explicit auth flows for managed login.** The exact `explicit_auth_flows` set a Cognito-hosted sign-in needs for the Authorization Code flow is not verified. The design starts from `ALLOW_REFRESH_TOKEN_AUTH` only, and the first plan or sandbox apply must confirm sign-in works.
- **U4 Domain prefix rules.** A Cognito prefix domain is unique per region across AWS, and AWS restricts reserved words in the prefix. The exact rules are not verified. The module validates only the character set and length, and a taken prefix is reported by AWS at apply time, not at plan time.
- **U5 Default email sender limit.** The built-in Cognito email sender has a low daily sending limit. The limit is not verified. SES configuration is out of scope.
- **U6 Password history.** `password_history_size` may need a paid plan. It is not configured in this version.
- **U7 Mock provider coverage.** `terraform test` with `mock_provider` needs Terraform 1.7 or later, and the `use_lockfile` backend argument needs 1.10 or later, which is the minimum for this spec. Mocked computed values (IDs, endpoints) are generated, so tests assert configuration and outputs wiring, not real AWS behaviour. `command = apply` with `mock_provider "aws"` sends no request to AWS and is allowed where computed values are needed.
- **U8 Group changes and tokens.** A group change appears in the `cognito:groups` claim only in tokens issued after the change. This matches the Frontend and Backend statement that the change takes effect after a new token is obtained.
- **U9 Bucket name uniqueness.** An S3 bucket name is unique across all AWS accounts in a partition. Whether a chosen `state_bucket_name` is free is known only at apply time. The module validates the S3 naming rules, not availability.
- **U10 Terraform version for locking.** S3-native locking needs the Operator's Terraform to be 1.10 or later. An older Terraform cannot run this configuration, and mixing versions across Operators is not supported.
- **U11 Operator permissions for the bucket.** The complete set of S3 read actions the two scripts call is not verified here. The README lists the known actions, and the first run of `check-state-bucket.sh` shows any missing one.
- **U12 Cost of state storage.** The cost of S3 storage and requests for a few small state objects and their noncurrent versions is expected to be negligible. The exact price is not verified here and is checked on the AWS S3 pricing page.
- **U13 Bucket settings drift.** Terraform does not manage the State_Bucket, so a manual change to its versioning, encryption, public access block, policy or lifecycle is detected only by `check-state-bucket.sh`, not by `terraform plan`. The Operator runs the check script after any change to the bucket and before the first apply in a new account.

### Follow-ups Outside This Spec (not edited here)

- F1 Backend and Frontend READMEs: link to `infra/terraform/README.md` and replace the manual console steps with the Terraform path, keeping the manual path as an alternative.
- F2 Root `.env.example`: add a comment that the Cognito values can be produced by `infra/terraform/scripts/print-env.sh`.
- F3 Backend requirements glossary: the line "Cognito resources are created manually by the developer and are not provisioned by this project" should read "not provisioned by the application", with a pointer to this spec.
- F4 Steering `tech.md` and `structure.md`: mention `infra/terraform/`, the Terraform commands below, and the rule that the agent never runs `terraform apply`. `security.md` should add that Terraform state, `backend.hcl` and `*.tfvars` with real values are never committed, and that state lives only in the remote S3 bucket.
- F5 Backend design "Cognito Local Development": sign-out URL `http://localhost:5173/` and `/signed-out` are both registered by this spec.

## Glossary

- **Operator**: The human who runs Terraform apply commands and the State_Bucket_Script. The Operator holds AWS credentials. The application and the agent do not.
- **Root_Configuration**: The Terraform configuration in `infra/terraform/` that declares the provider, the variables and the module call, and exposes outputs.
- **Cognito_Module**: The reusable Terraform module in `infra/terraform/modules/cognito/`.
- **User_Pool**: The `aws_cognito_user_pool` resource created by the Cognito_Module.
- **App_Client**: The `aws_cognito_user_pool_client` resource for the browser application. It is a public client.
- **Pool_Domain**: The `aws_cognito_user_pool_domain` resource that holds the Cognito-hosted domain prefix.
- **Role_Group**: An `aws_cognito_user_group` named `admin` or `researcher`.
- **Group_Admin_Policy**: The optional `aws_iam_policy` that allows the three Cognito group calls on the User_Pool.
- **Env_Printer**: The script `infra/terraform/scripts/print-env.sh` that prints environment variable lines from Terraform outputs.
- **Env_Lines**: The text output that holds the variables for the root `.env` file.
- **Local_Host**: The host name `localhost` or the address `127.0.0.1`.
- **State_Bucket**: The single S3 bucket that holds the Terraform state objects and their `.tflock` lock objects. It is not managed by Terraform.
- **State_Bucket_Script**: Either of the two AWS CLI scripts `infra/terraform/scripts/create-state-bucket.sh` (creates or confirms the State_Bucket) and `infra/terraform/scripts/check-state-bucket.sh` (read-only check).
- **Backend_Config_File**: The git-ignored file `backend.hcl` with the three entries `bucket`, `key` and `region`, passed with `-backend-config=backend.hcl` at every `terraform init`.
- **Test_Suite**: The `terraform test` files in `infra/terraform/modules/cognito/tests/` and `infra/terraform/tests/`, plus the static check script `infra/terraform/scripts/check-backend.sh` and the static script tests of Requirement 13.
- **Plan_Stop_Rule**: The rule that implementation tasks run `terraform plan` at most and never run `terraform apply`, `terraform destroy` or the `create-state-bucket.sh` script against a real account.
- **Environment_Name**: The value of the variable `environment`, for example `dev`.

## Requirements

### Requirement 1: Repository Layout and Extensibility

**User Story:** As a maintainer, I want a layout that holds more modules later, so that adding a service does not move existing code.

#### Acceptance Criteria

1. THE Root_Configuration SHALL reside in `infra/terraform/` and contain the files `versions.tf`, `backend.tf`, `providers.tf`, `variables.tf`, `main.tf`, `outputs.tf`, `terraform.tfvars.example`, `backend.hcl.example`, `README.md` and `.terraform.lock.hcl`, and the directories `modules/`, `scripts/` and `tests/`, and THE directory `scripts/` SHALL contain `print-env.sh`, `check-backend.sh`, `create-state-bucket.sh` and `check-state-bucket.sh`.
2. THE Cognito_Module SHALL reside in `infra/terraform/modules/cognito/` and contain `main.tf`, `variables.tf`, `outputs.tf` and `versions.tf`.
3. THE Root_Configuration SHALL call the Cognito_Module through exactly one `module "cognito"` block whose `source` is a relative path resolving to `infra/terraform/modules/cognito/`.
4. THE Cognito_Module SHALL contain zero `provider` blocks, so that the Root_Configuration alone selects the AWS region and credentials.
5. THE Cognito_Module SHALL declare only these resource types: the User_Pool, App_Client, Pool_Domain, Role_Groups and, WHERE enabled, the Group_Admin_Policy.
6. THE repository SHALL contain zero Terraform resources of the types S3 bucket (including bucket configuration resources), hosting, databases, networking, CI/CD, IAM users, IAM access keys or DynamoDB tables, so that Terraform manages only the Cognito resources and the optional Group_Admin_Policy.
7. WHEN a new module directory is added under `infra/terraform/modules/` and called from `main.tf` in the Root_Configuration, THE Root_Configuration SHALL leave every file and directory path of the Cognito_Module unchanged, and `terraform plan` SHALL report no change to existing Cognito_Module resources.
8. IF the Root_Configuration or the Cognito_Module lacks any file required by criterion 1 or criterion 2, THEN THE repository SHALL fail `terraform validate` or the layout check, with an error naming each missing file.

### Requirement 2: Version Pinning and Remote State

**User Story:** As an Operator, I want pinned versions and state kept only in a remote S3 bucket with S3-native locking from the first `terraform init`, so that plans are reproducible, concurrent runs cannot corrupt state, and no state file ever lives on any disk.

#### Acceptance Criteria

1. THE Root_Configuration and THE Cognito_Module SHALL each declare `required_version` as `>= 1.10.0`, because the `use_lockfile` argument of the S3 backend needs Terraform 1.10 or later.
2. THE Root_Configuration and THE Cognito_Module SHALL each declare the `hashicorp/aws` provider with a version constraint that has both a lower bound and an upper bound (for example `>= 6.0, < 7.0`), and the upper bound SHALL be an exclusive limit at the next major version.
3. THE repository SHALL contain a committed `.terraform.lock.hcl` in `infra/terraform/`, recording exactly one `hashicorp/aws` provider version and at least one hash for each of the platforms `darwin_arm64`, `darwin_amd64` and `linux_amd64`, and each recorded version SHALL satisfy the constraint declared in criterion 2.
4. THE Root_Configuration SHALL contain exactly one `backend "s3"` block, located in `backend.tf`, that is active from the first `terraform init` and sets `use_lockfile = true` and `encrypt = true`, and SHALL contain zero `backend "local"` blocks, zero `dynamodb_table` arguments, zero `dynamodb_endpoint` arguments and zero DynamoDB table resources.
5. THE `backend "s3"` block of the Root_Configuration SHALL be a partial configuration that sets none of `bucket`, `key` and `region`, so that the Backend_Config_File supplies exactly these three values at the first and at every `terraform init -backend-config=backend.hcl`.
6. THE repository SHALL contain `infra/terraform/backend.hcl.example` with exactly the three placeholder entries `bucket = "<state-bucket-name>"`, `key = "eco-sentinel/<environment>/cognito.tfstate"` and `region = "<aws-region>"`, and with no real bucket name, account ID or credential.
7. THE state key of the Root_Configuration SHALL have the form `eco-sentinel/<environment>/cognito.tfstate`, where `<environment>` is one of `dev`, `staging` or `prod` and equals the value of the variable `environment` used with that Backend_Config_File, so that each Environment_Name has its own state object and its own lock object `eco-sentinel/<environment>/cognito.tfstate.tflock`.
8. THE root `.gitignore` SHALL exclude `.terraform/`, `*.tfstate`, `*.tfstate.*`, `crash.log`, `*.tfvars`, `*.tfvars.json`, `*.tfplan`, `tfplan` and `backend.hcl`, and SHALL keep `terraform.tfvars.example`, `backend.hcl.example` and `.terraform.lock.hcl` tracked, so that `git status` lists none of the excluded patterns as untracked after `terraform init -backend-config=backend.hcl` and `terraform plan` have been run.
9. THE `infra/terraform/README.md` SHALL state that no Terraform state file is ever kept on disk or committed for the Root_Configuration, SHALL document `terraform init -input=false -backend-config=backend.hcl` as the init command, and SHALL state that `-input=false` makes a missing backend value fail instead of prompting.
10. THE `infra/terraform/README.md` SHALL state that the bucket versioning of the State_Bucket allows recovery of a previous state version, and SHALL name the S3 object versions as the recovery source.
11. WHEN `terraform init -backend=false`, `terraform validate` or `terraform test` runs in `infra/terraform/`, THE Root_Configuration SHALL complete without AWS credentials, without a Backend_Config_File and without network access to AWS.
12. IF the installed Terraform version is lower than `1.10.0`, THEN THE Root_Configuration SHALL cause `terraform init` to fail with an error that names the required version `>= 1.10.0` and leaves no state file and no changes to existing files in the working directory.
13. IF the `.terraform.lock.hcl` provider version or hashes do not match the version selected during `terraform init`, THEN THE Operator tooling SHALL fail `terraform init` with an error indicating a lock file mismatch, and SHALL NOT modify `.terraform.lock.hcl` unless the Operator runs `terraform init -upgrade`.
14. IF a second `terraform plan` or `terraform apply` starts while the lock object `<key>.tflock` exists, THEN THE S3 backend SHALL fail the second command with a lock error and SHALL leave the state object unchanged.
15. THE `infra/terraform/README.md` SHALL state that a stale lock is released with `terraform force-unlock <lock-id>` only after the Operator has confirmed that no other Terraform process is running.
16. THE `infra/terraform/README.md` SHALL state that the lock is stored as the S3 object `<key>.tflock` in the State_Bucket and that this spec creates no DynamoDB table.
17. THE repository documentation and tasks SHALL contain zero instructions to run `terraform init -migrate-state` or `terraform init -reconfigure` for a local-to-remote move, and no Terraform state SHALL exist on local disk at any point, so that `find infra/terraform -name '*.tfstate*' -not -path '*/.terraform/*'` prints no file name.

### Requirement 3: Input Variables and Validation

**User Story:** As an Operator, I want clear, validated inputs, so that mistakes fail at plan time with a readable message.

#### Acceptance Criteria

1. THE Root_Configuration SHALL declare the variables `aws_region`, `environment`, `project_name`, `cognito_domain_prefix`, `callback_urls`, `logout_urls`, `allow_self_signup`, `deletion_protection`, `mfa_configuration`, `user_pool_tier`, `managed_login_version`, `access_token_validity_minutes`, `id_token_validity_minutes`, `refresh_token_validity_days`, `enable_group_admin_policy` and `tags`, each with a non-empty `description` and an explicit `type`.
2. IF `aws_region` or `cognito_domain_prefix` has no value supplied, THEN THE Root_Configuration SHALL stop `terraform plan` with a non-zero exit and an error that names the variable, and THE Root_Configuration SHALL declare no default for either variable.
3. THE Root_Configuration SHALL default `callback_urls` to `["http://localhost:5173/auth/callback"]` and `logout_urls` to `["http://localhost:5173/signed-out", "http://localhost:5173/"]`.
4. IF `callback_urls` or `logout_urls` is an empty list, or contains more than 100 URLs, THEN THE Root_Configuration SHALL fail validation with a message that names the variable and states that 1 to 100 URLs are required.
5. IF a URL in `callback_urls` or `logout_urls` is longer than 1024 characters, is not an absolute URL, or has a scheme other than `https` or `http` with a Local_Host host, THEN THE Root_Configuration SHALL fail validation with a message that names the variable and the rejected value.
6. IF a URL in `callback_urls` or `logout_urls` contains a fragment (`#`), a wildcard (`*`), or whitespace, THEN THE Root_Configuration SHALL fail validation with a message that names the variable and the rejected value.
7. IF `callback_urls` or `logout_urls` contains the same URL twice, THEN THE Root_Configuration SHALL fail validation with a message that names the variable and the duplicate value.
8. IF `cognito_domain_prefix` is not 1 to 63 characters of lowercase letters, digits and hyphens, or starts or ends with a hyphen, THEN THE Root_Configuration SHALL fail validation with a message that names the variable and the rejected value. Uncertainty U4 applies to reserved words.
9. IF `environment` is not one of `dev`, `staging` or `prod`, THEN THE Root_Configuration SHALL fail validation with a message that names the variable and lists the allowed values.
10. IF `mfa_configuration` is not one of `OFF`, `OPTIONAL` or `ON`, or `user_pool_tier` is not one of `LITE`, `ESSENTIALS` or `PLUS`, THEN THE Root_Configuration SHALL fail validation with a message that names the variable and lists the allowed values.
11. IF `access_token_validity_minutes` or `id_token_validity_minutes` is not a whole number from 5 to 1440 inclusive, or `refresh_token_validity_days` is not a whole number from 1 to 3650 inclusive, THEN THE Root_Configuration SHALL fail validation with a message that names the variable and the allowed range.
12. WHEN validation fails for any variable, THE Root_Configuration SHALL report the failure during `terraform plan` and SHALL create, change or destroy no resource.
13. THE Cognito_Module SHALL repeat the validations of criteria 4 to 11 for its own variables, so that the module is safe when called from a future root configuration.
14. THE repository SHALL contain `terraform.tfvars.example` with a placeholder for every variable that has no default, and with no real domain prefix, account ID or credential.

### Requirement 4: User Pool Identity and Sign-up Policy

**User Story:** As a project owner, I want users created only by an administrator, so that no public path leads to access.

#### Acceptance Criteria

1. THE User_Pool SHALL use the email address as the username (`username_attributes = ["email"]`) and SHALL auto-verify the `email` attribute.
2. THE `allow_self_signup` variable SHALL be of type boolean and SHALL default to `false`.
3. IF `allow_self_signup` is `false`, THEN THE User_Pool SHALL set `allow_admin_create_user_only` to `true`, so that a public sign-up request is rejected by the User_Pool and creates no user.
4. WHERE `allow_self_signup` is `true`, THE User_Pool SHALL set `allow_admin_create_user_only` to `false`, and THE Cognito_Module SHALL still create zero users and assign zero groups, so that a self-registered user holds no Role.
5. THE User_Pool SHALL define account recovery through the verified email only (`verified_email`, priority 1) and SHALL define no other recovery mechanism.
6. THE Cognito_Module SHALL declare zero `aws_cognito_user` resources, zero user group membership resources, and zero input variables that accept a user password.
7. THE `infra/terraform/README.md` SHALL state the reason for disabled self-sign-up: the Backend grants a Role only from group membership, an administrator is the only party who assigns a group, and an open sign-up would create accounts with no Role that still appear in the user directory.
8. IF `allow_self_signup` is set to a value that is not a boolean, THEN THE Cognito_Module SHALL fail `terraform validate` or `terraform plan` with an error indicating the invalid value, and SHALL create or change no resource.

### Requirement 5: Password and Multi-Factor Policy

**User Story:** As a security reviewer, I want strong credentials with optional MFA, so that stolen passwords alone are not enough where MFA is enabled.

#### Acceptance Criteria

1. THE User_Pool SHALL set a password policy with a minimum length of 12 characters and a requirement for at least one lowercase letter, one uppercase letter, one number and one symbol.
2. THE User_Pool SHALL set the temporary password validity to a value between 1 and 7 days inclusive.
3. THE `mfa_configuration` variable SHALL default to `OPTIONAL` and SHALL accept only the values `OFF`, `OPTIONAL` and `ON`.
4. IF `mfa_configuration` is set to a value other than `OFF`, `OPTIONAL` or `ON`, THEN THE Cognito_Module SHALL fail variable validation during `terraform plan` with an error identifying `mfa_configuration` and the accepted values, and SHALL create or change no resources.
5. WHILE `mfa_configuration` is `OPTIONAL` or `ON`, THE User_Pool SHALL declare exactly one `software_token_mfa_configuration` block with software-token (TOTP) MFA enabled and SHALL declare no SMS MFA configuration.
6. WHILE `mfa_configuration` is `OFF`, THE User_Pool SHALL declare no `software_token_mfa_configuration` block.
7. THE Cognito_Module SHALL declare zero SMS roles, zero SNS topics and zero SES identities.

### Requirement 6: Public App Client for the Browser

**User Story:** As a frontend developer, I want a public client that supports the Authorization Code flow with PKCE, so that the single-page application can sign users in without a secret.

#### Acceptance Criteria

1. THE App_Client SHALL set `generate_secret` to `false`.
2. THE App_Client SHALL set `allowed_oauth_flows_user_pool_client` to `true`, `allowed_oauth_flows` to `["code"]`, `allowed_oauth_scopes` to `["openid", "email", "profile"]` and `supported_identity_providers` to `["COGNITO"]`, with no other element in any of these lists.
3. THE App_Client SHALL NOT list `implicit` or `client_credentials` in `allowed_oauth_flows`.
4. THE App_Client SHALL set `callback_urls` and `logout_urls` to exactly the values of the corresponding module variables, in the same order and with no URL added, removed or modified, so that every value on the client is traceable to a variable.
5. THE App_Client SHALL set `prevent_user_existence_errors` to `ENABLED`.
6. THE App_Client SHALL set `enable_token_revocation` to `true`.
7. THE App_Client SHALL list `ALLOW_REFRESH_TOKEN_AUTH` in `explicit_auth_flows` and SHALL NOT list `ALLOW_USER_PASSWORD_AUTH` or `ADMIN_NO_SRP_AUTH`. Uncertainty U3 applies to further flows.
8. THE App_Client SHALL set the access token validity, ID token validity and refresh token validity from the variables, with the units `minutes`, `minutes` and `days`, and the defaults 60, 60 and 30.
9. WHERE the provider supports the `refresh_token_rotation` block, THE App_Client SHALL set `feature` to `ENABLED` with `retry_grace_period_seconds` of 10. Uncertainties U1 and U2 apply.
10. THE Cognito_Module SHALL NOT expose `client_secret` as an output.
11. THE `read_attributes` and `write_attributes` of the App_Client SHALL be left unset in the configuration, so that the provider default applies and this version adds no custom attribute configuration.
12. IF a token validity variable is set outside the range allowed by Cognito (access and ID tokens: 5 to 1440 minutes; refresh token: 1 to 3650 days), THEN THE Cognito_Module SHALL reject the configuration during `terraform validate` or `terraform plan` with an error identifying the variable, and SHALL NOT create or modify the App_Client.
13. IF the `callback_urls` variable is an empty list, THEN THE Cognito_Module SHALL reject the configuration during `terraform validate` or `terraform plan` with an error identifying the variable, and SHALL NOT create or modify the App_Client.

### Requirement 7: Hosted Domain

**User Story:** As a frontend developer, I want a Cognito-hosted domain, so that the application can redirect to the sign-in page and call the token and logout endpoints.

#### Acceptance Criteria

1. THE Pool_Domain SHALL use the value of `cognito_domain_prefix` as a Cognito prefix domain and SHALL set no `certificate_arn`.
2. THE Cognito_Module SHALL output `domain_url` in the form `https://<prefix>.auth.<aws_region>.amazoncognito.com`, where `<prefix>` equals the value of `cognito_domain_prefix` and `<aws_region>` equals the AWS region of the deployed user pool.
3. THE Cognito_Module SHALL expose `managed_login_version` as a variable with a default chosen in design, SHALL accept only the integer values 1 and 2, and SHALL pass the value to the Pool_Domain. Uncertainty U1 applies.
4. THE Cognito_Module SHALL create no ACM certificate and no Route 53 record.
5. IF `cognito_domain_prefix` is not 1 to 63 characters long, contains characters other than lowercase letters, digits and hyphens, begins or ends with a hyphen, or contains the string `aws`, `amazon` or `cognito`, THEN THE Cognito_Module SHALL fail `terraform validate` or `terraform plan` with an error message identifying `cognito_domain_prefix` as invalid, and SHALL create no Pool_Domain.
6. IF `managed_login_version` is set to a value other than 1 or 2, THEN THE Cognito_Module SHALL fail `terraform validate` or `terraform plan` with an error message identifying `managed_login_version` as invalid, and SHALL create or modify no Pool_Domain.
7. IF `cognito_domain_prefix` is already in use by another AWS account in the same AWS region, THEN THE Cognito_Module SHALL fail `terraform apply` with the error returned by AWS, and SHALL leave any existing Pool_Domain unchanged.

### Requirement 8: Role Groups

**User Story:** As an administrator, I want the groups `admin` and `researcher` to exist, so that I can assign users to Roles.

#### Acceptance Criteria

1. WHEN the Terraform configuration is applied, THE Cognito_Module SHALL create exactly one Role_Group named `admin` and exactly one Role_Group named `researcher` in the User_Pool.
2. THE Role_Group `admin` SHALL have `precedence` 1 and THE Role_Group `researcher` SHALL have `precedence` 2.
3. THE Role_Groups SHALL set no `role_arn`, so that group membership grants no AWS credentials.
4. THE Cognito_Module SHALL create no group in the User_Pool other than `admin` and `researcher`, so that the User_Pool contains exactly 2 groups after apply.
5. WHEN the Terraform configuration is applied, THE Cognito_Module SHALL output the group names as `group_names`, containing exactly the 2 values `admin` and `researcher` (case-sensitive, no additional values), matching the Backend Role values.
6. IF a Role_Group named `admin` or `researcher` already exists in the User_Pool outside Terraform state, THEN THE Cognito_Module SHALL fail the apply with an error indicating the name conflict and SHALL leave the existing group unchanged.

### Requirement 9: Deletion Protection, Tags and Data Safety

**User Story:** As an Operator, I want protection against accidental deletion, so that a mistaken plan cannot remove the user directory.

#### Acceptance Criteria

1. THE `deletion_protection` variable SHALL be of type boolean and SHALL default to `true`.
2. WHEN `deletion_protection` is `true`, THE User_Pool SHALL set `deletion_protection` to `ACTIVE`, and WHEN it is `false`, THE User_Pool SHALL set it to `INACTIVE`.
3. IF `environment` is `staging` or `prod` and `deletion_protection` is `false`, THEN THE Root_Configuration SHALL fail `terraform validate` or `terraform plan` before any resource is created or changed, SHALL leave existing infrastructure and state unchanged, and SHALL return an error message stating that deletion protection must stay on outside `dev`.
4. WHILE `deletion_protection` is `true`, THE `terraform destroy` command SHALL fail at the AWS API for the User_Pool, SHALL leave the User_Pool and all of its users unchanged, and SHALL return an error that identifies the User_Pool as the resource that could not be deleted.
5. THE `infra/terraform/README.md` SHALL state that the Operator must set `deletion_protection` to `false` and run `terraform apply` successfully before a deliberate `terraform destroy`.
6. THE Root_Configuration SHALL set provider `default_tags` containing exactly the keys `Project`, `Environment` and `ManagedBy`, with `ManagedBy` set to `terraform`, merged with the `tags` variable.
7. IF a key in the `tags` variable matches `Project`, `Environment` or `ManagedBy`, THEN THE Root_Configuration SHALL apply the value from the `tags` variable for that key, and `terraform plan` SHALL complete without error.
8. THE `infra/terraform/README.md` SHALL state that destroying or replacing the User_Pool deletes every user, that a replacement changes the pool ID and the client ID, and that the Frontend and Backend settings must be updated with the new values.

### Requirement 10: Outputs and Environment Lines

**User Story:** As a developer, I want the Terraform outputs to map one-to-one to the `.env` variables, so that I copy no value by hand.

#### Acceptance Criteria

1. WHEN `terraform apply` completes successfully, THE Cognito_Module SHALL expose these eight outputs, each with a non-empty value: `user_pool_id`, `user_pool_arn`, `app_client_id`, `region`, `domain_url`, `issuer_url`, `jwks_url` and `group_names`, in addition to `group_admin_policy_arn` defined in Requirement 11.
2. WHEN `terraform apply` completes successfully, THE Cognito_Module SHALL output `issuer_url` as `https://cognito-idp.<region>.amazonaws.com/<user_pool_id>` and `jwks_url` as `<issuer_url>/.well-known/jwks.json`, with no trailing slash on either value.
3. WHEN `terraform apply` completes successfully, THE Root_Configuration SHALL output `env_lines` as a string of exactly 9 lines, separated by a single line feed, each in the form `NAME=value`, using exactly these variables once each and no others: `COGNITO_USER_POOL_ID`, `COGNITO_REGION`, `COGNITO_APP_CLIENT_ID`, `ALLOWED_ORIGINS`, `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION`, `VITE_REDIRECT_URI`, `VITE_LOGOUT_URI`.
4. WHEN `terraform apply` completes successfully, THE Root_Configuration SHALL set `COGNITO_USER_POOL_ID` to `user_pool_id`, `COGNITO_REGION` and `VITE_COGNITO_REGION` to `region`, `COGNITO_APP_CLIENT_ID` and `VITE_COGNITO_CLIENT_ID` to `app_client_id`, and `VITE_COGNITO_DOMAIN` to `domain_url`.
5. WHEN `terraform apply` completes successfully, THE Root_Configuration SHALL set `VITE_REDIRECT_URI` to the element at index 0 of `callback_urls` and `VITE_LOGOUT_URI` to the element at index 0 of `logout_urls`.
6. THE `infra/terraform/README.md` SHALL state that the order of the `callback_urls` and `logout_urls` lists decides the values of `VITE_REDIRECT_URI` and `VITE_LOGOUT_URI`.
7. WHEN `terraform apply` completes successfully, THE Root_Configuration SHALL set `ALLOWED_ORIGINS` to the origins (scheme, host and port) of all `callback_urls`, de-duplicated, in order of first appearance, joined by a single comma with no spaces, and with no path or trailing slash.
8. THE `env_lines` value SHALL contain no `client_secret`, no password, no access key and no token.
9. WHEN the developer runs the Env_Printer, THE Env_Printer SHALL run `terraform output -raw env_lines` in `infra/terraform/`, print the result unchanged to standard output, exit with code 0, and create or modify no file.
10. IF `terraform output` returns a non-zero exit code or an empty value (for example before the first apply), THEN THE Env_Printer SHALL print nothing to standard output, print to standard error a message that states that Terraform has no applied state, and exit with a non-zero code.
11. THE `infra/terraform/README.md` SHALL document `terraform output -raw env_lines` and the Env_Printer, and SHALL show a command that appends the result to the root `.env` file.
12. THE Root_Configuration SHALL NOT mark any output as `sensitive`, because no output holds a secret.

### Requirement 11: Optional Least-Privilege Policy for Backend Group Management

**User Story:** As an Operator, I want an optional IAM policy for the Backend group changes, so that I can enable role management without broad permissions.

#### Acceptance Criteria

1. THE `enable_group_admin_policy` variable SHALL be of type boolean and SHALL default to `false`.
2. WHILE `enable_group_admin_policy` is `false`, THE Cognito_Module SHALL create zero IAM resources of any type.
3. WHILE `enable_group_admin_policy` is `true`, THE Cognito_Module SHALL create exactly one `aws_iam_policy` whose name contains the project name and the Environment_Name, and whose policy document contains exactly one statement with `Effect` set to `Allow` and `Action` set to exactly `cognito-idp:AdminAddUserToGroup`, `cognito-idp:AdminRemoveUserFromGroup` and `cognito-idp:AdminListGroupsForUser`, with no other action.
4. WHILE `enable_group_admin_policy` is `true`, THE Group_Admin_Policy SHALL set `Resource` to the single ARN of the User_Pool, and SHALL contain no `*` character in `Action` or `Resource`.
5. THE Cognito_Module SHALL output `group_admin_policy_arn`, with the ARN of the Group_Admin_Policy WHILE `enable_group_admin_policy` is `true` and the value `null` WHILE `enable_group_admin_policy` is `false`.
6. THE Cognito_Module SHALL create zero `aws_iam_user`, zero `aws_iam_access_key`, zero `aws_iam_role` and zero policy attachment resources, regardless of the value of `enable_group_admin_policy`, so that the Operator decides which identity receives the policy.
7. THE `infra/terraform/README.md` SHALL state that attaching the policy to an identity, supplying that identity's credentials to the Backend, and setting `COGNITO_ADMIN_ENABLED=true` are manual steps, and SHALL state that the Backend design assumes these permissions without verifying them.
8. IF `enable_group_admin_policy` is set to a value that is not a boolean, THEN THE Cognito_Module SHALL fail variable validation during `terraform plan`, report an error identifying `enable_group_admin_policy`, and create or modify zero resources.

### Requirement 12: First Administrator Procedure

**User Story:** As an Operator, I want documented steps for the first admin, so that the first account is created without storing a password in Terraform.

#### Acceptance Criteria

1. THE `infra/terraform/README.md` SHALL document these AWS CLI commands with placeholders, in this order: first `aws cognito-idp admin-create-user` with `--user-pool-id`, `--username <email>`, `--user-attributes Name=email,Value=<email> Name=email_verified,Value=true` and `--desired-delivery-mediums EMAIL`, then `aws cognito-idp admin-add-user-to-group` with `--user-pool-id`, `--username <email>` and `--group-name admin`.
2. THE `infra/terraform/README.md` SHALL document the same two steps (create the user, then add the user to the `admin` group) through the AWS console, with one numbered instruction per step.
3. THE `infra/terraform/README.md` SHALL state that the user receives a temporary password by email, that Terraform never sees or stores it, and that the user must sign out and sign in again to obtain a new token after a group change (Uncertainty U8).
4. THE `infra/terraform/README.md` SHALL use the command `terraform output -raw user_pool_id` to supply the pool ID in every command that needs it, so that the Operator copies no value by hand.
5. THE Cognito_Module SHALL declare zero input variables that hold an email address, a user name or a password.
6. THE `infra/terraform/README.md` SHALL state that IF the `admin-add-user-to-group` command is run for a user that does not exist, THEN the command fails with an error indicating the user was not found, and that the Operator must run the `admin-create-user` step first and then repeat the failed command.
7. THE `infra/terraform/README.md` SHALL state that IF the `admin-create-user` command is run for an email address that already has an account in the user pool, THEN the command fails with an error indicating the user already exists, and that the Operator skips the create step and runs only the `admin-add-user-to-group` command.

### Requirement 13: Quality Checks and Tests

**User Story:** As a maintainer, I want tests that run without AWS credentials, so that every change is checked safely.

#### Acceptance Criteria

1. THE repository SHALL document these check commands, run from `infra/terraform/`: `terraform fmt -check -recursive`, `terraform init -backend=false`, `terraform validate`, `terraform test`, and WHERE installed `tflint`, plus `infra/terraform/scripts/check-backend.sh` and the script tests of criterion 16.
2. WHEN `terraform fmt -check -recursive` runs on the Terraform files under `infra/terraform/`, THE Terraform files SHALL produce exit code 0 and print no file names.
3. THE Test_Suite SHALL use `mock_provider "aws"` in 100% of its `terraform test` run blocks, SHALL use `command = plan` by default, and MAY use `command = apply` only in run blocks that need computed values to assert output formats and that run under `mock_provider "aws"`, so that `terraform test` needs no AWS credentials and sends no request to AWS.
4. THE Test_Suite SHALL assert that the App_Client has `generate_secret` equal to `false`, `allowed_oauth_flows` equal to `["code"]`, the three scopes of Requirement 6, `prevent_user_existence_errors` equal to `ENABLED` and `enable_token_revocation` equal to `true`.
5. THE Test_Suite SHALL assert that the App_Client callback and logout URLs equal the input lists in the same order, including one test with two callback URLs and one test with two logout URLs.
6. THE Test_Suite SHALL assert that `allow_admin_create_user_only` is `true` WHEN `allow_self_signup` is not set, and `false` WHEN `allow_self_signup` is `true`.
7. THE Test_Suite SHALL assert that exactly two groups exist, named `admin` with precedence 1 and `researcher` with precedence 2.
8. WHEN `enable_group_admin_policy` is `false`, THE Test_Suite SHALL assert that the plan contains 0 IAM resources. WHEN `enable_group_admin_policy` is `true`, THE Test_Suite SHALL assert that the policy has exactly three actions and exactly one resource, and that the resource contains no `*` character.
9. THE Test_Suite SHALL assert `deletion_protection` equal to `ACTIVE` WHEN the variable is not set and `INACTIVE` WHEN the variable is `false` in `dev`, and SHALL assert, with `expect_failures`, that the plan fails for `prod` with the variable `false` as required by Requirement 9, criterion 3.
10. THE Test_Suite SHALL use `expect_failures`, with at least one run block per case, to assert validation failures for: an empty `callback_urls`, an empty `logout_urls`, an `http://` URL with a host other than a Local_Host, a URL with a fragment, a URL with a wildcard, a duplicate URL, an invalid `cognito_domain_prefix`, an invalid `environment`, an invalid `mfa_configuration`, an invalid `managed_login_version`, a token validity below its minimum, and a token validity above its maximum.
11. THE Test_Suite SHALL assert that `env_lines` contains exactly the nine variables of Requirement 10, that `ALLOWED_ORIGINS` equals `http://localhost:5173` for the default URLs, and that `ALLOWED_ORIGINS` contains each origin exactly once for two callback URLs of the same origin.
12. THE Test_Suite SHALL assert that no output named `client_secret` exists and that `env_lines` does not contain the case-insensitive text `secret`.
13. THE Test_Suite SHALL assert that `domain_url`, `issuer_url` and `jwks_url` equal the exact formats defined in Requirements 7 and 10 for at least one set of input values.
14. IF a required variable is missing from a plan run in the Test_Suite, THEN THE Test_Suite SHALL contain a test that asserts the `terraform test` error output contains the name of that variable and that the run exits with a non-zero code.
15. WHEN `terraform test` runs with no AWS credentials and no network access to AWS, THE Test_Suite SHALL finish within 120 seconds with exit code 0 WHEN all tests pass and a non-zero exit code WHEN any test fails.

16. THE Test_Suite SHALL contain static script tests, runnable with no AWS credentials and no network access, that run `create-state-bucket.sh --validate-only <bucket-name>` and assert exit code 0 for at least 3 valid names (including a 3-character name and a 63-character name) and a non-zero exit code with a message naming the rejected value, with no AWS CLI call, for each of: uppercase letters, fewer than 3 characters, more than 63 characters, a leading hyphen, a trailing hyphen, a period, an IPv4-form name, the prefix `xn--`, the prefix `sthree-`, the suffix `-s3alias`, the suffix `--ol-s3`, and a missing argument; and SHALL run `shellcheck` on the four scripts WHERE `shellcheck` is installed.
17. THE Test_Suite SHALL assert, with a stubbed `aws` command placed first on `PATH`, that `check-state-bucket.sh` prints one pass or fail line per required setting of Requirement 16 criterion 5 and exits non-zero when any stubbed setting fails, and that `create-state-bucket.sh` calls no `aws` subcommand whose name contains `delete`.
18. THE script `infra/terraform/scripts/check-backend.sh` SHALL exit with code 0 only WHEN the Root_Configuration contains exactly one `backend "s3"` block with `use_lockfile = true` and `encrypt = true`, no `.tf` file under `infra/terraform/` contains `backend "local"`, `dynamodb_table` or `aws_dynamodb_table`, no file under `infra/terraform/` and no `tasks.md` of this spec contains `-migrate-state`, except in a line that forbids it, no file named `*.tfstate` or `*.tfstate.*` exists under the repository outside `.terraform/` directories, and the committed file `backend.hcl.example` contains only placeholders, because `terraform test` does not exercise backends.
19. IF the check script finds a violation of criterion 18, THEN THE script SHALL print the file name and the violated rule to standard error and exit with a non-zero code, and the check SHALL need no AWS credentials and no network access.

### Requirement 14: Operating Rules for Apply

**User Story:** As a project owner, I want every apply to be a deliberate human action, so that no automated process changes the identity provider.

#### Acceptance Criteria

1. THE `infra/terraform/README.md` SHALL state that `terraform apply`, `terraform destroy` and `create-state-bucket.sh` are run only by the Operator, that `create-state-bucket.sh` is run once per State_Bucket, and that `terraform apply` runs only after the Operator has read the full output of `terraform plan` for the same working directory.
2. THE Plan_Stop_Rule SHALL apply to every implementation task of this spec, and every task SHALL end at one of `terraform fmt`, `terraform validate`, `terraform test`, `terraform plan`, the static script tests of Requirement 13 or `check-backend.sh`, with no later step in the same task.
3. THE tasks of this spec SHALL contain zero steps that run `terraform apply`, `terraform destroy`, `terraform init -migrate-state`, `terraform force-unlock`, `terraform import` against a real account, `create-state-bucket.sh` or `check-state-bucket.sh` against a real account, or any command with the `-auto-approve` flag.
4. THE `infra/terraform/README.md` SHALL document `terraform plan -out=tfplan` followed by `terraform apply tfplan` as the Operator procedure, and SHALL state that the `tfplan` file is not committed to the repository.
5. THE `infra/terraform/README.md` SHALL state that the Backend and Frontend applications never run Terraform, hold no Terraform state, and never create, change or delete Cognito pools, clients, groups or users, in line with Backend requirement 20.14 (the Backend's optional admin role changes modify only group membership).
6. THE `infra/terraform/README.md` SHALL list each AWS permission the Operator needs, in three groups: (a) `cognito-idp` pool, client, domain and group management, with `iam:CreatePolicy` required only WHERE `enable_group_admin_policy` is `true`; (b) state access: `s3:ListBucket` on the State_Bucket, and `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on each state key used (`eco-sentinel/<environment>/cognito.tfstate`) and on the matching `.tflock` object; (c) State_Bucket creation by `create-state-bucket.sh`: `s3:CreateBucket`, `s3:PutBucketVersioning`, `s3:PutEncryptionConfiguration`, `s3:PutBucketPublicAccessBlock`, `s3:PutBucketOwnershipControls`, `s3:PutBucketPolicy`, `s3:PutLifecycleConfiguration`, `s3:PutBucketTagging`, and the matching `Get` read actions that `check-state-bucket.sh` needs (Uncertainty U11).
7. THE repository SHALL contain zero committed files that include an AWS access key, secret key, session token, 12-digit AWS account ID, real Cognito domain prefix, or real state bucket name.
8. IF a task of this spec contains a step that runs `terraform apply`, `terraform destroy`, `terraform import` against a real account, or a command with `-auto-approve`, THEN THE Plan_Stop_Rule check SHALL report the task as non-compliant and SHALL identify the task and the offending step.

### Requirement 15: Documentation

**User Story:** As a new contributor, I want one README, so that I can provision and connect Cognito without reading the specs.

#### Acceptance Criteria

1. THE `infra/terraform/README.md` SHALL contain the following ten sections as top-level headings, in this order: prerequisites, quick start, variable table, output table, first administrator procedure, self-sign-up decision, feature plan and cost notes, state bucket and backend, optional group policy, and the list of uncertainties U1 to U13.
2. THE `infra/terraform/README.md` prerequisites section SHALL state the minimum Terraform version `1.10.0`, the AWS CLI requirement, and that an AWS profile with permission to manage Cognito must be configured.
3. THE `infra/terraform/README.md` quick start section SHALL list exactly these six numbered steps in this order: (1) create or choose the State_Bucket with `create-state-bucket.sh`, (2) write `backend.hcl`, (3) `terraform init -input=false -backend-config=backend.hcl`, (4) `terraform plan`, (5) the Operator-run `terraform apply`, (6) retrieval of `env_lines`.
4. THE `infra/terraform/README.md` variable table SHALL contain one row for every input variable declared in the Terraform configuration, with columns for name, description, default value, and whether the variable is required. THE `infra/terraform/README.md` output table SHALL contain one row for every declared output, with columns for name and description.
5. THE `infra/terraform/README.md` SHALL state that the AWS free allowance and prices of Cognito feature plans must be checked on the AWS pricing page before apply, and SHALL name the variable `user_pool_tier` as the cost-relevant choice.
6. THE `infra/terraform/README.md` SHALL list the Cognito values that must match the Frontend and Backend documentation: callback URL, both sign-out URLs, allowed web origin, scopes, groups, and the public client with no secret. THE `infra/terraform/README.md` SHALL show, for each value, the Terraform variable or output that carries it.
7. THE `infra/terraform/README.md` SHALL describe how to add a second environment by a second tfvars file and a distinct `cognito_domain_prefix`, and SHALL state that each environment uses its own Backend_Config_File with the state key `eco-sentinel/<environment>/cognito.tfstate` in the same State_Bucket.
8. THE `infra/terraform/README.md` section on the state bucket and backend SHALL cover the State_Bucket, both State_Bucket_Scripts, the partial backend configuration, the key naming, lock handling, version recovery and the trade-off recorded in Requirement 16 criterion 14.
9. IF the Terraform configuration declares a variable or output that has no row in the corresponding README table, THEN THE documentation review SHALL record the README as non-compliant with criterion 4, and the README SHALL NOT be marked complete until every declared variable and output has a row.

### Requirement 16: State Bucket Provisioning

**User Story:** As an Operator, I want to create the state bucket once with a documented script outside Terraform, so that Terraform state is remote from the first `terraform init` and never exists on local disk.

#### Acceptance Criteria

1. THE repository SHALL contain `infra/terraform/scripts/create-state-bucket.sh`, invoked as `create-state-bucket.sh <bucket-name> <region>` with the optional flag `--noncurrent-days <n>` (whole number from 1 to 3650, default 90), and the mode `create-state-bucket.sh --validate-only <bucket-name>` that validates the name, calls no AWS CLI command, and exits with code 0 when the name is valid.
2. IF `<bucket-name>` is not 3 to 63 characters of lowercase letters, digits and hyphens, or starts or ends with a hyphen, or contains a period, or has the form of an IPv4 address, or starts with `xn--` or `sthree-`, or ends with `-s3alias` or `--ol-s3`, THEN THE `create-state-bucket.sh` script SHALL print a message that names the rejected value and the violated rule to standard error, SHALL exit with a non-zero code, and SHALL make no AWS CLI call.
3. IF `<bucket-name>` or `<region>` is missing, or `--noncurrent-days` is outside 1 to 3650 or is not a whole number, THEN THE `create-state-bucket.sh` script SHALL print a usage message to standard error, SHALL exit with a non-zero code, and SHALL make no AWS CLI call.
4. WHEN `create-state-bucket.sh` receives valid arguments and the bucket does not exist, THE `create-state-bucket.sh` script SHALL create the bucket in `<region>`, SHALL apply every setting of criterion 5, and SHALL exit with code 0.
5. THE State_Bucket SHALL have all of these settings: versioning `Enabled`; default encryption with the algorithm `AES256` (SSE-S3); all four Block Public Access settings (`BlockPublicAcls`, `BlockPublicPolicy`, `IgnorePublicAcls`, `RestrictPublicBuckets`) equal to `true`; object ownership `BucketOwnerEnforced`; a bucket policy with a `Deny` statement for principal `*`, action `s3:*`, resources the bucket ARN and the bucket ARN followed by `/*`, and the condition `Bool` `aws:SecureTransport` equal to `false`; a lifecycle configuration with one enabled rule and no prefix filter that expires noncurrent object versions after the configured days (default 90) and aborts incomplete multipart uploads after 7 days, and no rule that expires current object versions; and the tags `Project` and `ManagedBy` with `ManagedBy` equal to `operator-script`.
6. WHEN `create-state-bucket.sh` runs for a bucket that already exists and is owned by the calling AWS account, THE `create-state-bucket.sh` script SHALL apply or confirm every setting of criterion 5, SHALL exit with code 0, and SHALL print one line per setting of criterion 5 reporting it as `applied` or `already present`, so that a repeated run with the same arguments changes no setting and reports every setting as `already present` (idempotence).
7. IF the bucket name exists and is owned by another AWS account, THEN THE `create-state-bucket.sh` script SHALL print a message to standard error stating that the name is owned by another account and that another name must be chosen (Uncertainty U9), SHALL exit with a non-zero code, and SHALL change no bucket setting.
8. THE `create-state-bucket.sh` script SHALL call zero AWS CLI subcommands whose name contains `delete`, and SHALL delete no bucket, object, object version or policy.
9. WHEN `create-state-bucket.sh` completes with exit code 0, THE `create-state-bucket.sh` script SHALL print the three `backend.hcl` lines `bucket = "<bucket-name>"`, `key = "eco-sentinel/<environment>/cognito.tfstate"` (the text `<environment>` left for the Operator to replace) and `region = "<region>"` to standard output, and SHALL write no file.
10. THE repository SHALL contain `infra/terraform/scripts/check-state-bucket.sh`, invoked as `check-state-bucket.sh <bucket-name>`, which uses only AWS CLI read (`get-*`, `head-*`, `list-*`) subcommands and changes no AWS resource.
11. WHEN `check-state-bucket.sh` runs, THE `check-state-bucket.sh` script SHALL print exactly one `PASS` or `FAIL` line for each of the seven settings of criterion 5 (versioning, encryption, public access block, object ownership, TLS-only policy, lifecycle rule, tags), and SHALL exit with code 0 only WHEN all seven lines are `PASS`.
12. IF the bucket cannot be read (it does not exist or access is denied), THEN THE `check-state-bucket.sh` script SHALL print a message naming the bucket and the AWS error to standard error, SHALL print no `PASS` line, and SHALL exit with a non-zero code.
13. WHERE the Operator uses an existing bucket instead of creating one, THE `infra/terraform/README.md` SHALL instruct the Operator to run `check-state-bucket.sh` on it and to correct any `FAIL` line before the first `terraform init`.
14. THE `infra/terraform/README.md` SHALL state that the State_Bucket is deliberately not managed by Terraform, so that no Terraform state is ever kept on local disk and no migration is needed, and SHALL record the trade-off that the bucket settings are not drift-checked by Terraform and are verified only by `check-state-bucket.sh` (Uncertainty U13).
15. THE `infra/terraform/README.md` SHALL document `create-state-bucket.sh` and `check-state-bucket.sh` with their arguments, flags, exit codes and an example call, and SHALL state that deleting the State_Bucket is a manual procedure outside this spec that the scripts never perform.
16. THE `infra/terraform/README.md` SHALL document the verification command `find infra/terraform -name '*.tfstate*' -not -path '*/.terraform/*'`, SHALL state that the expected output is empty, and SHALL state that `.terraform/terraform.tfstate` holds only backend settings, is git-ignored and is not a state file.
17. THE four scripts in `infra/terraform/scripts/` SHALL start with `#!/usr/bin/env bash`, SHALL set `set -euo pipefail`, SHALL contain no AWS access key, secret key, session token or 12-digit account ID, and SHALL read credentials only from the standard AWS CLI credential chain.
