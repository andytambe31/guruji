// Cognito client configuration for the front-end login wall.
//
// These values come from the Terraform stack (infra/) once it's applied:
//   region      — the AWS region the pool lives in (e.g. us-east-1)
//   userPoolId  — cognito.user_pool_id output
//   clientId    — cognito.client_id output (the SPA app client, no secret)
//   domain      — the Cognito Hosted UI domain, e.g.
//                 guruji-prod-users.auth.us-east-1.amazoncognito.com
//
// Nothing is deployed yet, so the built-in values are blank. Two ways to fill
// them without a rebuild:
//   1. Edit BUILTIN below after `terraform apply` and redeploy.
//   2. Paste them into the login screen's "Configure sign-in" form, which
//      stores an override in localStorage (handy for testing before a deploy).
const BUILTIN = {
  region: '',
  userPoolId: '',
  clientId: '',
  domain: '',
  // OIDC scopes requested from the Hosted UI. openid is required; email/profile
  // let the app show who's signed in.
  scopes: ['openid', 'email', 'profile'],
};

const OVERRIDE_KEY = 'guruji.auth.config';

function readOverride() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setAuthConfigOverride(partial) {
  try {
    const next = { ...(readOverride() || {}), ...partial };
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
    return true;
  } catch { return false; }
}

export function clearAuthConfigOverride() {
  try { localStorage.removeItem(OVERRIDE_KEY); } catch { /* ignore */ }
}

export function getAuthConfig() {
  const cfg = { ...BUILTIN, ...(readOverride() || {}) };
  // Normalize: strip a protocol if someone pasted the domain with https://.
  cfg.domain = String(cfg.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  cfg.configured = !!(cfg.domain && cfg.clientId && cfg.region);
  // The issuer the tokens will carry — matches the API's COGNITO_ISSUER.
  cfg.issuer = cfg.region && cfg.userPoolId
    ? `https://cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`
    : '';
  return cfg;
}

// The redirect target registered as a Cognito callback URL. It must match one
// of the app client's callback_urls exactly. We use the app's own base URL
// (origin + path, no hash/query), which is where the PWA is served.
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}
