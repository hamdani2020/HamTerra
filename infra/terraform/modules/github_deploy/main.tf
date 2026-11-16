locals {
  name_prefix = "${var.project_name}-${var.environment}"
  oidc_host   = "token.actions.githubusercontent.com"
  owner       = split("/", var.github_repository)[0]
  repo        = split("/", var.github_repository)[1]
  ref         = "ref:refs/heads/${var.github_branch}"
  # GitHub sends either the classic subject (owner/repo) or, when the repository uses
  # immutable identifiers, owner@<owner-id>/repo@<repo-id>. Both are exact matches.
  subjects = compact([
    "repo:${var.github_repository}:${local.ref}",
    var.github_owner_id != null && var.github_repository_id != null
    ? "repo:${local.owner}@${var.github_owner_id}/${local.repo}@${var.github_repository_id}:${local.ref}"
    : "",
  ])
  provider_arn = (
    var.create_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : data.aws_iam_openid_connect_provider.github[0].arn
  )
}

data "aws_partition" "current" {}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# One GitHub OIDC provider exists per account. Set create_oidc_provider = false when the
# account already has it, and the existing one is looked up instead.
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://${local.oidc_host}"
}

# Only workflows of this repository running for the deploy branch may assume the role.
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = local.subjects
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.name_prefix}-github-backend-deploy"
  description          = "Assumed by GitHub Actions (OIDC) in ${var.github_repository} to deploy the backend through SSM."
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
}

# Run AWS-RunShellScript on the backend instance only, and read the command's result.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid     = "RunShellScriptOnBackendInstance"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:${data.aws_partition.current.partition}:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:instance/${var.instance_id}",
      "arn:${data.aws_partition.current.partition}:ssm:${data.aws_region.current.region}::document/AWS-RunShellScript",
    ]
  }
  statement {
    sid = "ReadCommandResults"
    # These actions do not support resource-level permissions.
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-backend-via-ssm"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
