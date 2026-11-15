locals {
  name_prefix = "${var.project_name}-${var.environment}"
  groups      = { admin = 1, researcher = 2 }
}

resource "aws_cognito_user_pool" "this" {
  name                     = "${local.name_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.deletion_protection ? "ACTIVE" : "INACTIVE"
  mfa_configuration        = var.mfa_configuration
  user_pool_tier           = var.user_pool_tier

  admin_create_user_config {
    allow_admin_create_user_only = !var.allow_self_signup
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  dynamic "software_token_mfa_configuration" {
    for_each = var.mfa_configuration == "OFF" ? [] : [1]
    content {
      enabled = true
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls

  # Refresh token rotation applies to the OAuth token endpoint and is rejected
  # when ALLOW_REFRESH_TOKEN_AUTH is listed, so no explicit flows are set (U3).
  explicit_auth_flows           = []
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = var.access_token_validity_minutes
  id_token_validity      = var.id_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  refresh_token_rotation {
    feature                    = "ENABLED"
    retry_grace_period_seconds = 10
  }
  # read_attributes / write_attributes intentionally unset (Req. 6.11)
}

resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.cognito_domain_prefix # no certificate_arn
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = var.managed_login_version
}

resource "aws_cognito_user_group" "role" {
  for_each     = local.groups
  name         = each.key
  user_pool_id = aws_cognito_user_pool.this.id
  precedence   = each.value
  description  = "Backend role: ${each.key}"
  # role_arn unset: group membership grants no AWS credentials
}

data "aws_iam_policy_document" "group_admin" {
  count = var.enable_group_admin_policy ? 1 : 0

  statement {
    sid    = "ManageRoleGroupMembership"
    effect = "Allow"
    actions = [
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminListGroupsForUser",
    ]
    resources = [aws_cognito_user_pool.this.arn]
  }
}

resource "aws_iam_policy" "group_admin" {
  count       = var.enable_group_admin_policy ? 1 : 0
  name        = "${local.name_prefix}-cognito-group-admin"
  description = "Add, remove and list Cognito group membership on the ${local.name_prefix} user pool only."
  policy      = data.aws_iam_policy_document.group_admin[0].json
}
