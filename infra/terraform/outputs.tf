locals {
  # scheme://host[:port] of each callback URL, de-duplicated, first appearance order
  allowed_origins = join(",", distinct([
    for u in var.callback_urls : regex("^(https?://[^/]+)", u)[0]
  ]))

  env_lines = join("\n", [
    "COGNITO_USER_POOL_ID=${module.cognito.user_pool_id}",
    "COGNITO_REGION=${module.cognito.region}",
    "COGNITO_APP_CLIENT_ID=${module.cognito.app_client_id}",
    "ALLOWED_ORIGINS=${local.allowed_origins}",
    "VITE_COGNITO_DOMAIN=${module.cognito.domain_url}",
    "VITE_COGNITO_CLIENT_ID=${module.cognito.app_client_id}",
    "VITE_COGNITO_REGION=${module.cognito.region}",
    "VITE_REDIRECT_URI=${var.callback_urls[0]}",
    "VITE_LOGOUT_URI=${var.logout_urls[0]}",
  ])
}

output "env_lines" {
  value = local.env_lines
}

# re-exports: one output per module output, same names and values
output "user_pool_id" {
  value = module.cognito.user_pool_id
}

output "user_pool_arn" {
  value = module.cognito.user_pool_arn
}

output "app_client_id" {
  value = module.cognito.app_client_id
}

output "region" {
  value = module.cognito.region
}

output "domain_url" {
  value = module.cognito.domain_url
}

output "issuer_url" {
  value = module.cognito.issuer_url
}

output "jwks_url" {
  value = module.cognito.jwks_url
}

output "group_names" {
  value = module.cognito.group_names
}

output "group_admin_policy_arn" {
  value = module.cognito.group_admin_policy_arn
}
