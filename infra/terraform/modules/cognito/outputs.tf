output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "app_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "region" {
  value = var.region
}

output "domain_url" {
  value = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${var.region}.amazoncognito.com"
}

output "issuer_url" {
  value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

output "jwks_url" {
  value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/jwks.json"
}

output "group_names" {
  value = sort(keys(aws_cognito_user_group.role)) # ["admin", "researcher"]
}

output "group_admin_policy_arn" {
  value = one(aws_iam_policy.group_admin[*].arn) # null when the policy is disabled
}
