variable "project_name" {
  type        = string
  description = "Short project name used in resource names."
  default     = "eco-sentinel"
}

variable "environment" {
  type        = string
  description = "Environment name."
  default     = "dev"
}

variable "github_repository" {
  type        = string
  description = "GitHub repository allowed to assume the deploy role, as owner/name."
  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "github_repository must look like owner/name. Rejected value: ${var.github_repository}"
  }
}

variable "github_branch" {
  type        = string
  description = "Branch whose workflow runs may deploy."
  default     = "main"
  validation {
    condition     = can(regex("^[A-Za-z0-9._/-]+$", var.github_branch)) && !can(regex("\\*", var.github_branch))
    error_message = "github_branch must be a single branch name without wildcards."
  }
}

variable "instance_id" {
  type        = string
  description = "ID of the backend EC2 instance the role may run commands on."
}

variable "create_oidc_provider" {
  type        = bool
  description = "Create the GitHub OIDC provider. Set false if the account already has one."
  default     = true
}
