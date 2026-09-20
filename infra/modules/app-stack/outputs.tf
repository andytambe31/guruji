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
