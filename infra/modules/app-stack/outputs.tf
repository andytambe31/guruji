output "api_endpoint" {
  description = "Base URL of the HTTP API."
  value       = module.api.api_endpoint
}

output "table_name" {
  value = module.dynamodb.table_name
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_client_id" {
  value = module.cognito.client_id
}

output "cognito_issuer" {
  value = module.cognito.issuer
}

output "cognito_region" {
  value = module.cognito.region
}

output "cognito_hosted_ui_domain" {
  description = "Hosted UI host — the `domain` value for the front-end auth-config."
  value       = module.cognito.hosted_ui_domain
}

output "cognito_hosted_ui_url" {
  value = module.cognito.hosted_ui_url
}

# Everything the front-end js/auth-config.js needs, in one place. After apply:
#   terraform output -json frontend_auth_config
output "frontend_auth_config" {
  description = "Paste these into js/auth-config.js (BUILTIN) or the login screen's Configure form."
  value = {
    region     = module.cognito.region
    userPoolId = module.cognito.user_pool_id
    clientId   = module.cognito.client_id
    domain     = module.cognito.hosted_ui_domain
  }
}

output "frontend_domain" {
  description = "CloudFront domain serving the PWA (null if frontend disabled)."
  value       = var.enable_frontend ? module.frontend[0].distribution_domain : null
}

output "frontend_bucket" {
  value = var.enable_frontend ? module.frontend[0].bucket_name : null
}

output "frontend_distribution_id" {
  value = var.enable_frontend ? module.frontend[0].distribution_id : null
}
