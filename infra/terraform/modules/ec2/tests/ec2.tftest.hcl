mock_provider "aws" {
  mock_data "aws_ssm_parameter" {
    defaults = {
      insecure_value = "ami-0123456789abcdef0"
    }
  }
  mock_data "aws_subnets" {
    defaults = {
      ids = ["subnet-bbbb", "subnet-aaaa"]
    }
  }
  mock_data "aws_region" {
    defaults = {
      region = "us-east-1"
    }
  }
  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "000000000000"
    }
  }
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{}"
    }
  }
}

variables {
  domain_name   = "api.example.com"
  certbot_email = "ops@example.com"
}

run "defaults" {
  command = plan

  assert {
    condition     = aws_instance.backend.instance_type == "t3.small"
    error_message = "Default instance type must be t3.small."
  }
  assert {
    condition     = aws_instance.backend.metadata_options[0].http_tokens == "required"
    error_message = "IMDSv2 must be required."
  }
  assert {
    condition     = aws_instance.backend.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "Containers must not reach IMDS unless the group admin policy is attached."
  }
  assert {
    condition     = aws_instance.backend.root_block_device[0].encrypted == true && aws_instance.backend.root_block_device[0].volume_type == "gp3"
    error_message = "Root volume must be encrypted gp3."
  }
  assert {
    condition     = aws_instance.backend.subnet_id == "subnet-aaaa"
    error_message = "The subnet choice must be stable (first sorted id)."
  }
  assert {
    condition     = toset([aws_vpc_security_group_ingress_rule.http.from_port, aws_vpc_security_group_ingress_rule.https.from_port]) == toset([80, 443])
    error_message = "Only ports 80 and 443 are open."
  }
  assert {
    condition     = length(aws_iam_role_policy_attachment.group_admin) == 0
    error_message = "The group admin policy is not attached by default."
  }
  assert {
    condition     = output.ssm_parameter_path == "/eco-sentinel/dev/backend"
    error_message = "Parameter path must be /<project>/<environment>/backend."
  }
  assert {
    condition     = strcontains(aws_instance.backend.user_data, "server_name api.example.com;")
    error_message = "nginx must serve the configured domain."
  }
  assert {
    condition     = aws_eip.backend.domain == "vpc"
    error_message = "The Elastic IP must be a VPC address."
  }
}

run "group_admin_attached" {
  command = plan
  variables {
    attach_group_admin_policy = true
    group_admin_policy_arn    = "arn:aws:iam::000000000000:policy/test"
  }
  assert {
    condition     = length(aws_iam_role_policy_attachment.group_admin) == 1
    error_message = "The group admin policy must be attached when requested."
  }
  assert {
    condition     = aws_instance.backend.metadata_options[0].http_put_response_hop_limit == 2
    error_message = "Containers need hop limit 2 to use the instance role."
  }
}

run "rejects_bad_domain" {
  command = plan
  variables {
    domain_name = "https://api.example.com"
  }
  expect_failures = [var.domain_name]
}

run "requires_policy_arn_when_attaching" {
  command = plan
  variables {
    attach_group_admin_policy = true
  }
  expect_failures = [var.group_admin_policy_arn]
}
