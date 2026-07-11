// Reading — the practice, not the streak. Name the book and why you're reading
// it; after each sitting keep one line that landed and one thought in your own
// words. Over time that's a body of articulated thought you can actually speak
// from — the difference between "I read" and having a point of view.
import { el, clear, fill } from '../util.js';
import {
  getReading, setCurrentBook, updateCurrentBook, addReflection, deleteReflection,
  finishCurrentBook, removeShelfBook, getItems,
} from '../store.js';

const RATINGS = [
  { key: 'loved', label: 'Loved it' },
  { key: 'worth', label: 'Worth it' },
  { key: 'skip', label: 'Skip it' },
];
const RATING_LABEL = { loved: 'Loved it', worth: 'Worth it', skip: 'Skip it' };

export async function renderReading(mount, { arg, navigate }) {
  const wrap = el('div', { class: 'reading-wrap' });
  const expandedShelf = new Set(); // which shelf books show their notes
  mount.append(wrap);
  await paint({ reflect: arg === 'reflect' });

  async function paint(opts = {}) {
    const [r, items] = await Promise.all([getReading(), getItems()]);
    const rid = (items.find((i) => (i.area || '') === 'Reading') || {}).id || null;
    const main = r.current ? bookView(r, rid, opts) : setupView();
    fill(clear(wrap), [...main, shelfSection(r.shelf || [])]);
    if (opts.reflect) { const t = wrap.querySelector('.ref-thought'); if (t) t.focus(); }
  }

  // ---------- The shelf: finished books, your point of view ----------
  function shelfSection(shelf) {
    if (!shelf.length) return null;
    return el('div', { class: 'shelf' }, [
      el('div', { class: 'shelf-head' }, [el('h2', { text: 'Your shelf' }), el('span', { class: 'muted', text: `${shelf.length}` })]),
      el('p', { class: 'muted shelf-sub', text: `${shelf.length} book${shelf.length > 1 ? 's' : ''} you can speak to — your point of view, in one place.` }),
      ...shelf.map(shelfCard),
    ]);
  }

  function shelfCard(book) {
    const open = expandedShelf.has(book.finishedAt);
    const notes = book.reflections || [];
    return el('div', { class: 'shelf-card' }, [
      el('div', { class: 'shelf-top' }, [
        el('div', { class: 'shelf-id' }, [
          el('div', { class: 'shelf-title', text: book.title }),
          book.author ? el('div', { class: 'shelf-author', text: book.author }) : null,
        ]),
        book.rating ? el('span', { class: `shelf-rating rate-${book.rating}`, text: RATING_LABEL[book.rating] || '' }) : null,
      ]),
      book.verdict ? el('p', { class: 'shelf-verdict', text: book.verdict }) : null,
      book.recommend ? el('p', { class: 'shelf-rec' }, [el('span', { class: 'shelf-rec-k', text: 'Recommend · ' }), book.recommend]) : null,
      notes.length ? el('button', {
        class: 'shelf-toggle', text: open ? 'Hide notes' : `${notes.length} kept note${notes.length > 1 ? 's' : ''}`,
        onclick: () => { if (open) expandedShelf.delete(book.finishedAt); else expandedShelf.add(book.finishedAt); paint(); },
      }) : null,
      open ? el('div', { class: 'shelf-notes' }, notes.map((n) => el('div', { class: 'shelf-note' }, [
        n.line ? el('p', { class: 'ref-quote', text: `“${n.line}”` }) : null,
        n.thought ? el('p', { class: 'ref-thought-text', text: n.thought }) : null,
      ]))) : null,
      el('div', { class: 'shelf-cardmeta' }, [
        el('span', { class: 'muted', text: (book.finishedAt || '').slice(0, 10) }),
        el('button', { class: 'blk-act blk-x', text: 'Remove', onclick: async () => { await removeShelfBook(book.finishedAt); expandedShelf.delete(book.finishedAt); await paint(); } }),
      ]),
    ]);
  }

  function setupView() {
    const title = el('input', { class: 'r-input', type: 'text', placeholder: 'Book title' });
    const author = el('input', { class: 'r-input', type: 'text', placeholder: 'Author' });
    const intent = el('textarea', { class: 'r-area', rows: 3, placeholder: 'Why are you reading this? e.g. understand creative partnership — and what it costs' });
    return [
      el('p', { class: 'eyebrow', text: 'Reading' }),
      el('h1', { text: 'What are you reading?' }),
      el('p', { class: 'muted', text: 'Name the book — and why. The why turns pages into a search, and it’s the first thing that makes you a reader with a point of view, not someone grabbing random books.' }),
      el('div', { class: 'r-form' }, [
        title, author, intent,
        el('button', {
          class: 'btn btn-primary btn-block', text: 'Start this book',
          onclick: async () => {
            if (!title.value.trim()) { title.focus(); return; }
            await setCurrentBook({ title: title.value.trim(), author: author.value.trim(), intent: intent.value.trim() });
            await paint();
          },
        }),
      ]),
    ];
  }

  function bookView(r, rid, opts) {
    const b = r.current;
    const refs = r.reflections || [];
    const nodes = [
      el('p', { class: 'eyebrow', text: 'Reading · in progress' }),
      el('h1', { class: 'r-title', text: b.title }),
      b.author ? el('p', { class: 'r-author', text: b.author }) : null,
    ];

    // Intent — the "why", editable.
    if (opts.editIntent) {
      const ta = el('textarea', { class: 'r-area', rows: 3, text: b.intent });
      nodes.push(el('div', { class: 'r-block' }, [
        el('div', { class: 'r-block-label', text: 'Why you’re reading this' }),
        ta,
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-primary', text: 'Save', onclick: async () => { await updateCurrentBook({ intent: ta.value.trim() }); await paint(); } }),
          el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: () => paint() }),
        ]),
      ]));
    } else {
      nodes.push(el('div', { class: 'r-block' }, [
        el('div', { class: 'r-block-label', text: 'Why you’re reading this' }),
        el('p', { class: 'r-intent', text: b.intent || 'No intent yet — name what you’re after.' }),
        el('button', { class: 'btn-link r-edit', text: b.intent ? 'Edit' : 'Set your intent', onclick: () => paint({ editIntent: true }) }),
      ]));
    }

    nodes.push(el('button', { class: 'btn btn-primary btn-lg btn-block', text: 'Start reading', onclick: () => (rid ? navigate(`/prep/${rid}`) : navigate('/now')) }));

    // Reflections — the retention engine.
    nodes.push(el('div', { class: 'r-refs-head' }, [
      el('h2', { text: 'What you’re keeping' }),
      refs.length ? el('span', { class: 'muted', text: `${refs.length}` }) : null,
    ]));

    if (opts.reflect || opts.addRef) {
      nodes.push(reflectForm());
    } else {
      nodes.push(el('button', { class: 'btn btn-ghost btn-block', text: '+ Keep a line & a thought', onclick: () => paint({ addRef: true }) }));
    }
    if (!refs.length && !(opts.reflect || opts.addRef)) {
      nodes.push(el('p', { class: 'muted r-empty', text: 'After each sitting, keep one line that landed and one thought in your own words. That thought — not the page count — is what you’ll be able to speak to later.' }));
    }
    for (const ref of [...refs].reverse()) nodes.push(refCard(ref));

    nodes.push(el('button', { class: 'btn-link r-finish', text: 'Finished this book', onclick: () => paint({ finish: true }) }));
    if (opts.finish) nodes.push(finishForm());

    return nodes;

    function reflectForm() {
      const line = el('textarea', { class: 'r-area ref-line', rows: 2, placeholder: 'A line worth keeping (optional)' });
      const thought = el('textarea', { class: 'r-area ref-thought', rows: 3, placeholder: 'In your own words — what struck you? what would you tell someone?' });
      return el('div', { class: 'r-form ref-form' }, [
        el('div', { class: 'r-block-label', text: 'Keep it' }),
        line, thought,
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-primary', text: 'Save', onclick: async () => { if (!line.value.trim() && !thought.value.trim()) { thought.focus(); return; } await addReflection({ line: line.value.trim(), thought: thought.value.trim() }); await paint(); } }),
          el('button', { class: 'btn btn-ghost', text: 'Later', onclick: () => paint() }),
        ]),
      ]);
    }

    function refCard(ref) {
      return el('div', { class: 'ref-card' }, [
        ref.line ? el('p', { class: 'ref-quote', text: `“${ref.line}”` }) : null,
        ref.thought ? el('p', { class: 'ref-thought-text', text: ref.thought }) : null,
        el('div', { class: 'ref-meta' }, [
          el('span', { class: 'muted', text: ref.date }),
          el('button', { class: 'blk-act blk-x', text: 'Remove', onclick: async () => { await deleteReflection(ref.id); await paint(); } }),
        ]),
      ]);
    }

    function finishForm() {
      let rating = null;
      const verdict = el('textarea', { class: 'r-area', rows: 2, placeholder: 'Your verdict — what worked, what didn’t' });
      const rec = el('input', { class: 'r-input', type: 'text', placeholder: 'Recommend it? to whom?' });
      const chipEls = [];
      const rateRow = el('div', { class: 'rate-row' }, RATINGS.map((rr) => {
        const c = el('button', { class: 'rate-chip', text: rr.label, onclick: () => { rating = rr.key; chipEls.forEach((x) => x.classList.remove('on')); c.classList.add('on'); } });
        chipEls.push(c);
        return c;
      }));
      return el('div', { class: 'r-form' }, [
        el('div', { class: 'r-block-label', text: 'Before it goes on the shelf' }),
        rateRow, verdict, rec,
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-primary', text: 'Shelve it', onclick: async () => { await finishCurrentBook({ verdict: verdict.value.trim(), recommend: rec.value.trim(), rating }); await paint(); } }),
          el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: () => paint() }),
        ]),
      ]);
    }
  }
}
