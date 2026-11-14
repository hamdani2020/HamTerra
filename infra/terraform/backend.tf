# Partial configuration: bucket, key and region come from backend.hcl
# (terraform init -input=false -backend-config=backend.hcl).
terraform {
  backend "s3" {
    bucket       = "hamterra-bucket"
    key          = "hamterra-bucket/hamterra.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
