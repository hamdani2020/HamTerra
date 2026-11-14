mock_provider "aws" {}

variables {
  region                = "us-east-1"
  cognito_domain_prefix = "eco-sentinel-test"
}

run "defaults" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool_client.web.generate_secret == false
    error_message = "App client must be public (generate_secret false)."
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.allowed_oauth_flows_user_pool_client == true
    error_message = "OAuth flows must be enabled on the app client."
  }

  assert {
    condition     = toset(aws_cognito_user_pool_client.web.allowed_oauth_flows) == toset(["code"]) && !contains(aws_cognito_user_pool_client.web.allowed_oauth_flows, "implicit") && !contains(aws_cognito_user_pool_client.web.allowed_oauth_flows, "client_credentials")
    error_message = "Only the authorization code flow is allowed."
  }

  assert {
    condition     = toset(aws_cognito_user_pool_client.web.allowed_oauth_scopes) == toset(["openid", "email", "profile"])
    error_message = "Scopes must be exactly openid, email, profile."
  }

  assert {
    condition     = toset(aws_cognito_user_pool_client.web.supported_identity_providers) == toset(["COGNITO"])
    error_message = "Identity providers must be exactly COGNITO."
  }

  assert {
    condition     = toset(aws_cognito_user_pool_client.web.explicit_auth_flows) == toset(["ALLOW_REFRESH_TOKEN_AUTH"])
    error_message = "explicit_auth_flows must be exactly ALLOW_REFRESH_TOKEN_AUTH."
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.prevent_user_existence_errors == "ENABLED"
    error_message = "prevent_user_existence_errors must be ENABLED."
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.enable_token_revocation == true
    error_message = "Token revocation must be enabled."
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.refresh_token_rotation[0].feature == "ENABLED" && aws_cognito_user_pool_client.web.refresh_token_rotation[0].retry_grace_period_seconds == 10
    error_message = "Refresh token rotation must be ENABLED with a 10 second grace period."
  }

  assert {
    condition     = toset(aws_cognito_user_pool_client.web.callback_urls) == toset(["http://localhost:5173/auth/callback"])
    error_message = "Default callback URL mismatch."
  }

  assert {
    condition     = toset(aws_cognito_user_pool_client.web.logout_urls) == toset(["http://localhost:5173/signed-out", "http://localhost:5173/"])
    error_message = "Default logout URLs mismatch."
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.access_token_validity == 60 && aws_cognito_user_pool_client.web.id_token_validity == 60 && aws_cognito_user_pool_client.web.refresh_token_validity == 30
    error_message = "Token validity must be 60/60/30."
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.token_validity_units[0].access_token == "minutes" && aws_cognito_user_pool_client.web.token_validity_units[0].id_token == "minutes" && aws_cognito_user_pool_client.web.token_validity_units[0].refresh_token == "days"
    error_message = "Token validity units must be minutes/minutes/days."
  }
}
