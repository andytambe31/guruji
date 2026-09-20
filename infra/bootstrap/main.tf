provider "aws" {
  region = var.region
  default_tags {
    tags = merge({
      Project   = var.project
      ManagedBy = "terraform"
      Component = "bootstrap"
    }, var.tags)
  }
}

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# Remote state backend: a versioned, encrypted, private S3 bucket + a DynamoDB
# lock table. This is the classic "who watches the watchmen" step — created
# with local state, then every env's backend points here.
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name

  # State is precious — never let a `terraform destroy` of app resources nuke it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "locks" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# ---------------------------------------------------------------------------
# GitHub Actions -> AWS via OIDC / Workload Identity Federation. No static
# access keys ever stored in GitHub — the CI job presents a short-lived OIDC
# token and assumes this role, gated on the repo (and branch) in the sub claim.
# (This is the pattern documented in the app's own WIF study guide.)
# ---------------------------------------------------------------------------
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

locals {
  # sub claims like: repo:owner/repo:ref:refs/heads/main  (or :* for any ref)
  allowed_subs = [
    for b in var.github_branches :
    b == "*" ? "repo:${var.github_owner}/${var.github_repo}:*" : "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/${b}"
  ]
}

data "aws_iam_policy_document" "ci_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.allowed_subs
    }
  }
}

resource "aws_iam_role" "ci" {
  name               = "${var.project}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.ci_assume.json
  description        = "Assumed by GitHub Actions (OIDC) to plan/apply the ${var.project} stacks."
}

# Deliberately broad for a solo project so `terraform apply` can manage the full
# stack. TIGHTEN THIS for a shared account: scope to the specific services and
# resource ARNs the stacks manage. Kept explicit so the trade-off is visible.
resource "aws_iam_role_policy_attachment" "ci_power" {
  role       = aws_iam_role.ci.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# PowerUserAccess can't manage IAM (roles/policies the stacks create), so add a
# scoped IAM-management grant limited to this project's role name prefix.
data "aws_iam_policy_document" "ci_iam" {
  statement {
    effect = "Allow"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PassRole",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PutRolePolicy",
      "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies", "iam:TagRole", "iam:UntagRole",
      "iam:CreateServiceLinkedRole"
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project}-*"]
  }
}

resource "aws_iam_role_policy" "ci_iam" {
  name   = "${var.project}-ci-iam"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ci_iam.json
}
