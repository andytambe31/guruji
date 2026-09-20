// The login wall. Rendered before the app when there's no session. Full-screen,
// no app chrome. Two paths:
//   - Configured: a "Sign in" button that redirects to the Cognito Hosted UI.
//   - Not configured yet (nothing deployed): a clearly-labeled local mode so the
//     app stays usable during development, plus a form to paste real Cognito
//     values for testing the actual flow before a deploy.
import { el, clear, fill } from '../util.js';
import { login, enableLocalBypass } from '../auth.js';
import { getAuthConfig, setAuthConfigOverride, clearAuthConfigOverride } from '../auth-config.js';

// opts: { error?: string, onAuthed: () => void }
export function renderLogin(mount, opts = {}) {
  const cfg = getAuthConfig();
  const root = clear(mount);
  root.classList.add('auth-mount');

  const card = el('div', { class: 'auth-card' });

  card.append(
    el('div', { class: 'auth-mark' }, ['Guruji']),
    el('p', { class: 'auth-sub' }, ['Your interview prep, gated to you.']),
  );

  if (opts.error) {
    card.append(el('div', { class: 'auth-error', role: 'alert' }, [opts.error]));
  }

  if (cfg.configured) {
    const signIn = el('button', { class: 'btn btn-primary btn-block btn-lg' }, ['Sign in']);
    signIn.addEventListener('click', async () => {
      signIn.disabled = true;
      signIn.textContent = 'Redirecting…';
      try { await login(); }
      catch (e) {
        signIn.disabled = false; signIn.textContent = 'Sign in';
        showInlineError(card, String(e.message || e));
      }
    });
    card.append(signIn);
    card.append(el('p', { class: 'auth-note' }, [`Sign in with your Guruji account (${cfg.region}).`]));
  } else {
    card.append(el('div', { class: 'auth-note auth-warn' }, [
      'Sign-in isn’t configured yet — the backend isn’t deployed. ',
      'You can keep working locally, or paste your Cognito settings below to test the real flow.',
    ]));

    const localBtn = el('button', { class: 'btn btn-primary btn-block btn-lg' }, ['Continue in local mode']);
    localBtn.addEventListener('click', () => {
      enableLocalBypass();
      if (typeof opts.onAuthed === 'function') opts.onAuthed();
    });
    card.append(localBtn);

    card.append(configForm());
  }

  root.append(card);
  return () => root.classList.remove('auth-mount');
}

function showInlineError(card, msg) {
  let e = card.querySelector('.auth-error');
  if (!e) { e = el('div', { class: 'auth-error', role: 'alert' }); card.insertBefore(e, card.children[2] || null); }
  e.textContent = msg;
}

// A collapsible form to set the Cognito override in localStorage.
function configForm() {
  const cfg = getAuthConfig();
  const details = el('details', { class: 'auth-config' });
  details.append(el('summary', {}, ['Configure sign-in']));

  const field = (name, label, value, placeholder) => {
    const input = el('input', {
      class: 'auth-input', type: 'text', name, value: value || '',
      placeholder: placeholder || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: false,
    });
    return { row: el('label', { class: 'auth-field' }, [el('span', {}, [label]), input]), input };
  };

  const region = field('region', 'Region', cfg.region, 'us-east-1');
  const pool = field('userPoolId', 'User pool ID', cfg.userPoolId, 'us-east-1_XXXXXXXXX');
  const client = field('clientId', 'App client ID', cfg.clientId, 'xxxxxxxxxxxxxxxxxxxxxxxxxx');
  const domain = field('domain', 'Hosted UI domain', cfg.domain, 'guruji-prod-users.auth.us-east-1.amazoncognito.com');

  const save = el('button', { class: 'btn btn-primary btn-block' }, ['Save & reload']);
  save.addEventListener('click', () => {
    setAuthConfigOverride({
      region: region.input.value.trim(),
      userPoolId: pool.input.value.trim(),
      clientId: client.input.value.trim(),
      domain: domain.input.value.trim(),
    });
    location.reload();
  });

  const reset = el('button', { class: 'btn-link' }, ['Clear saved settings']);
  reset.addEventListener('click', () => { clearAuthConfigOverride(); location.reload(); });

  fill(details, [region.row, pool.row, client.row, domain.row, save, reset]);
  return details;
}
