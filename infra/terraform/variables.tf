variable "aws_region" {
  type        = string
  description = "AWS region for all resources. No default."
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.aws_region))
    error_message = "aws_region must look like eu-west-1."
  }
}

variable "environment" {
  type        = string
  description = "Environment name. Also part of the state key."
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "project_name" {
  type        = string
  description = "Short project name used in resource names and the Project tag."
  default     = "eco-sentinel"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,31}$", var.project_name))
    error_message = "project_name must be 1 to 32 characters: lowercase letters, digits, hyphens, not starting with a hyphen."
  }
}

variable "cognito_domain_prefix" {
  type        = string
  description = "Cognito prefix domain. Unique per region across AWS. No default."

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.cognito_domain_prefix))
    error_message = "cognito_domain_prefix must be 1 to 63 characters of lowercase letters, digits and hyphens, not starting or ending with a hyphen. Rejected value: ${var.cognito_domain_prefix}"
  }

  validation {
    condition     = !can(regex("aws|amazon|cognito", var.cognito_domain_prefix))
    error_message = "cognito_domain_prefix must not contain aws, amazon or cognito. Rejected value: ${var.cognito_domain_prefix}"
  }
}

variable "callback_urls" {
  type        = list(string)
  description = "OAuth callback URLs. The first element becomes VITE_REDIRECT_URI."
  default     = ["http://localhost:5173/auth/callback"]

  validation {
    condition     = length(var.callback_urls) >= 1 && length(var.callback_urls) <= 100
    error_message = "callback_urls: 1 to 100 URLs are required."
  }

  validation {
    condition     = alltrue([for u in var.callback_urls : length(u) <= 1024])
    error_message = "callback_urls: each URL must be at most 1024 characters."
  }

  validation {
    condition     = alltrue([for u in var.callback_urls : !can(regex("[#*[:space:]]", u))])
    error_message = "callback_urls: URLs must not contain a fragment (#), a wildcard (*) or whitespace. Rejected: ${join(", ", [for u in var.callback_urls : u if can(regex("[#*[:space:]]", u))])}"
  }

  validation {
    condition = alltrue([
      for u in var.callback_urls :
      can(regex("^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(/[^[:space:]#*]*)?$", u)) ||
      can(regex("^http://(localhost|127\\.0\\.0\\.1)(:[0-9]{1,5})?(/[^[:space:]#*]*)?$", u))
    ])
    error_message = "callback_urls: each URL must be absolute https, or http with host localhost or 127.0.0.1."
  }

  validation {
    condition     = length(var.callback_urls) == length(distinct(var.callback_urls))
    error_message = "callback_urls must not contain duplicates."
  }
}

variable "logout_urls" {
  type        = list(string)
  description = "OAuth sign-out URLs. The first element becomes VITE_LOGOUT_URI."
  default     = ["http://localhost:5173/signed-out", "http://localhost:5173/"]

  validation {
    condition     = length(var.logout_urls) >= 1 && length(var.logout_urls) <= 100
    error_message = "logout_urls: 1 to 100 URLs are required."
  }

  validation {
    condition     = alltrue([for u in var.logout_urls : length(u) <= 1024])
    error_message = "logout_urls: each URL must be at most 1024 characters."
  }

  validation {
    condition     = alltrue([for u in var.logout_urls : !can(regex("[#*[:space:]]", u))])
    error_message = "logout_urls: URLs must not contain a fragment (#), a wildcard (*) or whitespace. Rejected: ${join(", ", [for u in var.logout_urls : u if can(regex("[#*[:space:]]", u))])}"
  }

  validation {
    condition = alltrue([
      for u in var.logout_urls :
      can(regex("^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(/[^[:space:]#*]*)?$", u)) ||
      can(regex("^http://(localhost|127\\.0\\.0\\.1)(:[0-9]{1,5})?(/[^[:space:]#*]*)?$", u))
    ])
    error_message = "logout_urls: each URL must be absolute https, or http with host localhost or 127.0.0.1."
  }

  validation {
    condition     = length(var.logout_urls) == length(distinct(var.logout_urls))
    error_message = "logout_urls must not contain duplicates."
  }
}

variable "allow_self_signup" {
  type        = bool
  description = "Allow public sign-up. Default false: only an administrator creates users."
  default     = false
}

variable "deletion_protection" {
  type        = bool
  description = "Protect the user pool from deletion. Must stay true outside dev."
  default     = true

  validation {
    condition     = var.environment == "dev" || var.deletion_protection
    error_message = "deletion_protection must stay true when environment is staging or prod."
  }
}

variable "mfa_configuration" {
  type        = string
  description = "User pool MFA mode: OFF, OPTIONAL or ON. TOTP only."
  default     = "OPTIONAL"

  validation {
    condition     = contains(["OFF", "OPTIONAL", "ON"], var.mfa_configuration)
    error_message = "mfa_configuration must be one of: OFF, OPTIONAL, ON."
  }
}

variable "user_pool_tier" {
  type        = string
  description = "Cognito feature plan. Cost-relevant; check the AWS pricing page."
  default     = "ESSENTIALS"

  validation {
    condition     = contains(["LITE", "ESSENTIALS", "PLUS"], var.user_pool_tier)
    error_message = "user_pool_tier must be one of: LITE, ESSENTIALS, PLUS."
  }
}

variable "managed_login_version" {
  type        = number
  description = "1 for classic hosted UI, 2 for managed login."
  default     = 2

  validation {
    condition     = contains([1, 2], var.managed_login_version)
    error_message = "managed_login_version must be 1 or 2."
  }
}

variable "access_token_validity_minutes" {
  type        = number
  description = "Access token lifetime in minutes (5 to 1440)."
  default     = 60

  validation {
    condition     = floor(var.access_token_validity_minutes) == var.access_token_validity_minutes && var.access_token_validity_minutes >= 5 && var.access_token_validity_minutes <= 1440
    error_message = "access_token_validity_minutes must be a whole number from 5 to 1440."
  }
}

variable "id_token_validity_minutes" {
  type        = number
  description = "ID token lifetime in minutes (5 to 1440)."
  default     = 60

  validation {
    condition     = floor(var.id_token_validity_minutes) == var.id_token_validity_minutes && var.id_token_validity_minutes >= 5 && var.id_token_validity_minutes <= 1440
    error_message = "id_token_validity_minutes must be a whole number from 5 to 1440."
  }
}

variable "refresh_token_validity_days" {
  type        = number
  description = "Refresh token lifetime in days (1 to 3650)."
  default     = 30

  validation {
    condition     = floor(var.refresh_token_validity_days) == var.refresh_token_validity_days && var.refresh_token_validity_days >= 1 && var.refresh_token_validity_days <= 3650
    error_message = "refresh_token_validity_days must be a whole number from 1 to 3650."
  }
}

variable "enable_group_admin_policy" {
  type        = bool
  description = "Create the optional IAM policy for Cognito group management."
  default     = false
}

variable "tags" {
  type        = map(string)
  description = "Extra tags merged over the default tags."
  default     = {}
}

variable "backend_domain_name" {
  type        = string
  description = "Public host name of the backend on EC2, for example terra.example.com. No default."
}

variable "certbot_email" {
  type        = string
  description = "Email address Let's Encrypt uses for certificate expiry notices. No default."
}

variable "backend_instance_type" {
  type        = string
  description = "EC2 instance type for the backend host."
  default     = "t3.small"
}

variable "github_repository" {
  type        = string
  description = "GitHub repository (owner/name) whose workflows may deploy the backend."
  default     = "hamdani2020/HamTerra"
}

variable "github_branch" {
  type        = string
  description = "Branch whose workflow runs may deploy the backend."
  default     = "main"
}

variable "create_github_oidc_provider" {
  type        = bool
  description = "Create the account's GitHub OIDC provider. Set false if it already exists."
  default     = true
}
