// Concept-confidence wizard for reading areas (CS Fundamentals). After a
// session you rate the topic's key concepts — Solid / Shaky / Not yet — so the
// dashboard can show where you're strong vs need review. Pure taps, no typing.
import { el } from '../util.js';

export const CONFIDENCE = [
  { key: 'solid', label: 'Solid' },
  { key: 'shaky', label: 'Shaky' },
  { key: 'noyet', label: 'Not yet' },
];
export const CONFIDENCE_LABEL = Object.fromEntries(CONFIDENCE.map((c) => [c.key, c.label]));

// Opens the wizard. onSave(ratings) fires with [{concept, confidence}] on Save.
export function openConceptWizard({ concepts = [], initial = [], onSave } = {}) {
  const rating = new Map();
  (initial || []).forEach((r) => { if (r && r.concept) rating.set(r.concept, r.confidence); });

  const rows = concepts.map((concept) => {
    const chips = el('div', { class: 'lc-chips cw-chips' });
    const paint = () => chips.querySelectorAll('.lc-chip').forEach((x) => x.classList.toggle('on', x.dataset.k === String(rating.get(concept) || '')));
    CONFIDENCE.forEach((o) => chips.append(el('button', {
      class: `lc-chip cw-chip cw-${o.key}`, type: 'button', dataset: { k: o.key }, text: o.label,
      onclick: () => { if (rating.get(concept) === o.key) rating.delete(concept); else rating.set(concept, o.key); paint(); sync(); },
    })));
    return el('div', { class: 'cw-row' }, [el('div', { class: 'cw-concept', text: concept }), chips]);
  });

  const saveBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => {
    close(); if (onSave) onSave([...rating.entries()].map(([concept, confidence]) => ({ concept, confidence })));
  } });
  const sync = () => { saveBtn.textContent = rating.size ? `Save · ${rating.size}` : 'Save'; };

  const card = el('div', { class: 'lc-card' }, [
    el('div', { class: 'lc-head' }, [
      el('div', { class: 'lc-title', text: 'How solid are these?' }),
      el('button', { class: 'lc-close', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => close() }),
    ]),
    el('p', { class: 'cw-hint', text: 'Rate the concepts for this topic — honestly. Skip any you didn’t get to.' }),
    el('div', { class: 'cw-list' }, rows),
    saveBtn,
  ]);
  const overlay = el('div', { class: 'lc-overlay' }, [card]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  sync();

  function close() { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); }
}
