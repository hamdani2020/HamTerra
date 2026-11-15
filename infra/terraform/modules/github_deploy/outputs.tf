output "role_arn" {
  description = "Role for aws-actions/configure-aws-credentials (role-to-assume)."
  value       = aws_iam_role.deploy.arn
}

output "oidc_provider_arn" {
  value = local.provider_arn
}
