// Front-end auth: OAuth 2.0 Authorization Code + PKCE against the Cognito
// Hosted UI. Zero dependencies — crypto.subtle does the PKCE hashing and a
// plain fetch exchanges the code for tokens. No client secret (public SPA
// client), so nothing sensitive lives in the bundle.
//
// This is the LOGIN WALL for the client. Real enforcement is server-side (the
// API re-verifies every token and checks the allow-list); this module keeps the
// UI gated and holds the tokens the app will send to that API.
import { getAuthConfig, redirectUri } from './auth-config.js';

const TOKENS_KEY = 'guruji.auth.tokens';   // persisted session (localStorage)
const PKCE_KEY = 'guruji.auth.pkce';       // transient, per redirect (sessionStorage)
const BYPASS_KEY = 'guruji.auth.localbypass';
const REFRESH_MAX_MS = 30 * 24 * 3600 * 1000; // matches the pool's 30-day refresh token

// ---------- base64url + PKCE helpers ----------
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomVerifier() {
  const buf = new Uint8Array(64);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

// Decode a JWT payload without verifying (verification is the server's job; the
// client only reads display claims like email). Returns {} on any problem.
export function decodeJwt(token) {
  try {
    const p = token.split('.')[1];
    const json = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch { return {}; }
}

// ---------- token storage ----------
function readTokens() {
  try { const raw = localStorage.getItem(TOKENS_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function writeTokens(t) {
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}
function clearTokens() {
  try { localStorage.removeItem(TOKENS_KEY); } catch { /* ignore */ }
}

// ---------- local dev bypass (only meaningful before Cognito is configured) ----------
// Lets you keep using the app during development, before the pool exists. It is
// NOT security — it only unlocks the local UI, and it's refused once real
// sign-in is configured, so it can never weaken a deployed setup.
export function hasLocalBypass() {
  try { return localStorage.getItem(BYPASS_KEY) === '1' && !getAuthConfig().configured; }
  catch { return false; }
}
export function enableLocalBypass() {
  if (getAuthConfig().configured) return false; // never bypass a real setup
  try { localStorage.setItem(BYPASS_KEY, '1'); return true; } catch { return false; }
}
export function clearLocalBypass() {
  try { localStorage.removeItem(BYPASS_KEY); } catch { /* ignore */ }
}

// ---------- session state ----------
export function getSession() {
  const t = readTokens();
  if (!t || !t.obtainedAt) return null;
  if (Date.now() - t.obtainedAt > REFRESH_MAX_MS) return null; // refresh token would be dead
  return t;
}

// For the client gate: a stored, not-too-old session, or an explicit local
// bypass. Expired access tokens still count — we refresh them lazily on use.
export function isAuthenticated() {
  return !!getSession() || hasLocalBypass();
}

export function getClaims() {
  const t = getSession();
  if (!t) return hasLocalBypass() ? { local: true } : {};
  return decodeJwt(t.idToken || t.accessToken || '');
}

export function currentEmail() {
  const c = getClaims();
  return c.email || (c.local ? 'local mode' : null);
}

// ---------- the OAuth dance ----------

// Kick off login: build PKCE, stash the verifier, redirect to the Hosted UI.
export async function login() {
  const cfg = getAuthConfig();
  if (!cfg.configured) throw new Error('sign-in is not configured');
  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);
  const state = randomVerifier().slice(0, 32);
  try {
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, ts: Date.now() }));
  } catch { /* ignore */ }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    scope: cfg.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  location.assign(`https://${cfg.domain}/oauth2/authorize?${params.toString()}`);
}

// On page load: if we came back from the Hosted UI with ?code=&state=, exchange
// the code for tokens. Returns { handled, ok, error }. Always cleans the query
// off the URL so a refresh doesn't retry a spent code.
export async function handleRedirectCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (!code && !oauthError) return { handled: false };

  // Clear the query no matter what happens next.
  const clean = () => {
    url.search = '';
    history.replaceState({}, document.title, url.toString());
  };

  if (oauthError) {
    clean();
    return { handled: true, ok: false, error: url.searchParams.get('error_description') || oauthError };
  }

  let pkce = null;
  try { pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null'); } catch { /* ignore */ }
  try { sessionStorage.removeItem(PKCE_KEY); } catch { /* ignore */ }

  if (!pkce || pkce.state !== returnedState) {
    clean();
    return { handled: true, ok: false, error: 'state mismatch — please try signing in again' };
  }

  const cfg = getAuthConfig();
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: pkce.verifier,
    });
    const res = await fetch(`https://${cfg.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
    const tok = await res.json();
    persist(tok);
    clean();
    return { handled: true, ok: true };
  } catch (err) {
    clean();
    return { handled: true, ok: false, error: String(err.message || err) };
  }
}

function persist(tok, prev = readTokens()) {
  const t = {
    idToken: tok.id_token || prev?.idToken || null,
    accessToken: tok.access_token || prev?.accessToken || null,
    // Cognito omits refresh_token on a refresh grant — keep the existing one.
    refreshToken: tok.refresh_token || prev?.refreshToken || null,
    expiresAt: Date.now() + (Number(tok.expires_in || 3600) * 1000),
    obtainedAt: prev?.obtainedAt || Date.now(),
  };
  writeTokens(t);
  return t;
}

// Return a usable access token, refreshing first if it's within 60s of expiry.
// Throws if there's no session or the refresh fails — callers should route the
// user back to the login wall on failure.
export async function getFreshAccessToken() {
  const t = getSession();
  if (!t) throw new Error('not authenticated');
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;
  if (!t.refreshToken) throw new Error('session expired');

  const cfg = getAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    refresh_token: t.refreshToken,
  });
  const res = await fetch(`https://${cfg.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) { clearTokens(); throw new Error('session expired'); }
  const refreshed = persist(await res.json(), t);
  return refreshed.accessToken;
}

// Sign out. Clears local tokens; when configured (and not local-only), also
// redirects through the Hosted UI logout so the Cognito session cookie is
// cleared too.
export function logout({ local = false } = {}) {
  const cfg = getAuthConfig();
  clearTokens();
  clearLocalBypass();
  if (!local && cfg.configured) {
    const params = new URLSearchParams({ client_id: cfg.clientId, logout_uri: redirectUri() });
    location.assign(`https://${cfg.domain}/logout?${params.toString()}`);
    return;
  }
  location.reload();
}
