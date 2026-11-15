locals {
  name_prefix = "${var.project_name}-${var.environment}"
  # Runtime secrets for the backend (.env values) live under this SecureString path in
  # SSM Parameter Store. The operator creates them; Terraform never holds the values.
  ssm_parameter_path = "/${var.project_name}/${var.environment}/backend"
  app_dir            = "/opt/${var.project_name}"
}

data "aws_partition" "current" {}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# --- Network: default VPC, one default subnet in an AZ that offers the instance type ---

data "aws_vpc" "default" {
  default = true
}

data "aws_ec2_instance_type_offerings" "supported" {
  location_type = "availability-zone"
  filter {
    name   = "instance-type"
    values = [var.instance_type]
  }
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
  filter {
    name   = "availability-zone"
    values = data.aws_ec2_instance_type_offerings.supported.locations
  }
}

# Ubuntu 24.04 LTS from Canonical's public SSM parameter. The SSM agent is preinstalled.
data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# --- Security group: HTTP and HTTPS in, no SSH (access is through SSM) ---

resource "aws_security_group" "backend" {
  name        = "${local.name_prefix}-backend"
  description = "Eco-Sentinel backend: HTTP and HTTPS in, all out. No SSH."
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.backend.id
  description       = "HTTP for the Let's Encrypt challenge and the redirect to HTTPS"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.backend.id
  description       = "HTTPS to nginx"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.backend.id
  description       = "Package installs, image pulls, AgroMonitoring, Weather API, Cognito JWKS, SSM"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# --- Instance role: SSM managed node + read of the backend parameter path only ---

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backend" {
  name               = "${local.name_prefix}-backend-instance"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.backend.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "read_parameters" {
  statement {
    sid     = "ReadBackendParameters"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = [
      "arn:${data.aws_partition.current.partition}:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_parameter_path}",
      "arn:${data.aws_partition.current.partition}:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_parameter_path}/*",
    ]
  }
}

resource "aws_iam_role_policy" "read_parameters" {
  name   = "read-backend-parameters"
  role   = aws_iam_role.backend.id
  policy = data.aws_iam_policy_document.read_parameters.json
}

resource "aws_iam_role_policy_attachment" "group_admin" {
  count      = var.attach_group_admin_policy ? 1 : 0
  role       = aws_iam_role.backend.name
  policy_arn = var.group_admin_policy_arn
}

resource "aws_iam_instance_profile" "backend" {
  name = "${local.name_prefix}-backend-instance"
  role = aws_iam_role.backend.name
}

# --- Instance and Elastic IP ---

resource "aws_instance" "backend" {
  ami                    = data.aws_ssm_parameter.ubuntu_ami.insecure_value
  instance_type          = var.instance_type
  subnet_id              = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids = [aws_security_group.backend.id]
  iam_instance_profile   = aws_iam_instance_profile.backend.name

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    domain_name   = var.domain_name
    certbot_email = var.certbot_email
    app_dir       = local.app_dir
  })

  metadata_options {
    http_tokens = "required" # IMDSv2 only
    # Containers sit one network hop behind the host. Allow them to reach IMDS only when
    # the backend needs the instance role for Cognito group changes.
    http_put_response_hop_limit = var.attach_group_admin_policy ? 2 : 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_size_gb
    encrypted   = true
  }

  tags = {
    Name = "${local.name_prefix}-backend"
  }

  lifecycle {
    # A new Ubuntu release or a user_data edit must not replace the instance: the PostGIS
    # data lives on the root volume. Rebuild deliberately with `terraform apply -replace`.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "backend" {
  domain   = "vpc"
  instance = aws_instance.backend.id
  tags = {
    Name = "${local.name_prefix}-backend"
  }
}
