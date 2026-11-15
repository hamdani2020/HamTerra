mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "000000000000" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_data "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com" }
  }
}

variables {
  github_repository = "owner/repo"
  instance_id       = "i-0123456789abcdef0"
}

run "creates_provider_by_default" {
  command = plan
  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 1 && length(data.aws_iam_openid_connect_provider.github) == 0
    error_message = "The OIDC provider is created by default."
  }
  assert {
    condition     = toset(aws_iam_openid_connect_provider.github[0].client_id_list) == toset(["sts.amazonaws.com"])
    error_message = "The provider audience must be sts.amazonaws.com."
  }
  assert {
    condition = anytrue([
      for c in data.aws_iam_policy_document.trust.statement[0].condition :
      c.variable == "token.actions.githubusercontent.com:sub" && c.test == "StringEquals" && toset(c.values) == toset(["repo:owner/repo:ref:refs/heads/main"])
    ])
    error_message = "The trust policy must allow only owner/repo on refs/heads/main (exact match)."
  }
  assert {
    condition = anytrue([
      for s in data.aws_iam_policy_document.deploy.statement :
      toset(s.actions) == toset(["ssm:SendCommand"]) && contains(s.resources, "arn:aws:ec2:us-east-1:000000000000:instance/i-0123456789abcdef0")
    ])
    error_message = "SendCommand must be limited to the backend instance."
  }
}

run "uses_existing_provider" {
  command = plan
  variables {
    create_oidc_provider = false
  }
  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0 && length(data.aws_iam_openid_connect_provider.github) == 1
    error_message = "The existing provider is looked up when create_oidc_provider is false."
  }
}

run "rejects_wildcard_branch" {
  command = plan
  variables {
    github_branch = "*"
  }
  expect_failures = [var.github_branch]
}

run "rejects_bad_repository" {
  command = plan
  variables {
    github_repository = "https://github.com/owner/repo"
  }
  expect_failures = [var.github_repository]
}
