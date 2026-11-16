module "cognito" {
  source = "./modules/cognito"

  project_name                  = var.project_name
  environment                   = var.environment
  region                        = var.aws_region
  cognito_domain_prefix         = var.cognito_domain_prefix
  callback_urls                 = var.callback_urls
  logout_urls                   = var.logout_urls
  allow_self_signup             = var.allow_self_signup
  deletion_protection           = var.deletion_protection
  mfa_configuration             = var.mfa_configuration
  user_pool_tier                = var.user_pool_tier
  managed_login_version         = var.managed_login_version
  access_token_validity_minutes = var.access_token_validity_minutes
  id_token_validity_minutes     = var.id_token_validity_minutes
  refresh_token_validity_days   = var.refresh_token_validity_days
  enable_group_admin_policy     = var.enable_group_admin_policy
}

module "ec2" {
  source = "./modules/ec2"

  project_name              = var.project_name
  environment               = var.environment
  instance_type             = var.backend_instance_type
  domain_name               = var.backend_domain_name
  certbot_email             = var.certbot_email
  attach_group_admin_policy = var.enable_group_admin_policy
  group_admin_policy_arn    = module.cognito.group_admin_policy_arn
}

module "github_deploy" {
  source = "./modules/github_deploy"

  project_name         = var.project_name
  environment          = var.environment
  github_repository    = var.github_repository
  github_branch        = var.github_branch
  github_owner_id      = var.github_owner_id
  github_repository_id = var.github_repository_id
  create_oidc_provider = var.create_github_oidc_provider
  instance_id          = module.ec2.instance_id
}
