output "instance_id" {
  value = aws_instance.backend.id
}

output "public_ip" {
  description = "Elastic IP. Point the backend domain's A record at it."
  value       = aws_eip.backend.public_ip
}

output "domain_name" {
  value = var.domain_name
}

output "security_group_id" {
  value = aws_security_group.backend.id
}

output "instance_role_name" {
  value = aws_iam_role.backend.name
}

output "instance_role_arn" {
  value = aws_iam_role.backend.arn
}

output "ssm_parameter_path" {
  description = "SSM Parameter Store path for the backend's runtime secrets."
  value       = local.ssm_parameter_path
}

output "app_dir" {
  description = "Directory on the instance that deployments write the repository to."
  value       = local.app_dir
}
