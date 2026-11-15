variable "project_name" {
  type        = string
  description = "Short project name used in resource names and the Project tag."
  default     = "eco-sentinel"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,31}$", var.project_name))
    error_message = "project_name must be 1 to 32 characters: lowercase letters, digits, hyphens, not starting with a hyphen."
  }
}

variable "environment" {
  type        = string
  description = "Environment name."
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type. The backend image build and PostGIS need at least 2 GiB of memory."
  default     = "t3.small"
}

variable "root_volume_size_gb" {
  type        = number
  description = "Root gp3 volume size in GiB. Holds Docker images and the PostGIS data volume."
  default     = 30
  validation {
    condition     = floor(var.root_volume_size_gb) == var.root_volume_size_gb && var.root_volume_size_gb >= 20 && var.root_volume_size_gb <= 500
    error_message = "root_volume_size_gb must be a whole number from 20 to 500."
  }
}

variable "domain_name" {
  type        = string
  description = "Public host name of the backend, for example api.example.com. Used by nginx and certbot."
  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.domain_name))
    error_message = "domain_name must be a lowercase host name such as api.example.com. Rejected value: ${var.domain_name}"
  }
}

variable "certbot_email" {
  type        = string
  description = "Email address Let's Encrypt uses for certificate expiry notices."
  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.certbot_email))
    error_message = "certbot_email must be an email address."
  }
}

variable "attach_group_admin_policy" {
  type        = bool
  description = "Attach group_admin_policy_arn to the instance role, so the backend can change Cognito group membership."
  default     = false
}

variable "group_admin_policy_arn" {
  type        = string
  description = "ARN of the Cognito group admin policy. Required when attach_group_admin_policy is true."
  default     = null
  validation {
    condition     = !var.attach_group_admin_policy || var.group_admin_policy_arn != null
    error_message = "group_admin_policy_arn is required when attach_group_admin_policy is true."
  }
}
