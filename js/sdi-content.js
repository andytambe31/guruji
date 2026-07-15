// System Design Interview — a bundled content pack (ByteByteGo course outline).
//
// Seeded once into its own isolated "System Design Interview" track so the 31
// chapters are browsable as study guides in the desktop Plan view without
// touching your real curriculum. Items are appended AFTER everything else in
// `order`, so the Now coach and the day-planner keep preferring your own
// System Design topics first — these only surface once those run dry.
//
// Idempotent + re-import-tolerant: keyed on the track's phase existing, so a
// fresh boot re-adds the pack if a bare re-import ever wiped it, and never
// double-adds or clobbers a chapter whose guide you've since edited.
import { STORES, getAll, put, bulkPut } from './db.js';
import { CH02_SCALE_GUIDE } from './sdi-ch02.js';
import { SDI_CDC_PATTERN_GUIDE } from './sdi-cdc-pattern.js';

const TRACK_ID = 'sdi';
const PHASE_ID = 'sdi-book';

// Foreword + chapters 01–30, exactly as the course lists them (0/31).
const CHAPTERS = [
  'Foreword',
  'Join the Community',
  'Scale From Zero To Millions Of Users',
  'Back-of-the-envelope Estimation',
  'A Framework For System Design Interviews',
  'Design A Rate Limiter',
  'Design Consistent Hashing',
  'Design A Key-value Store',
  'Design A Unique ID Generator In Distributed Systems',
  'Design A URL Shortener',
  'Design A Web Crawler',
  'Design A Notification System',
  'Design A News Feed System',
  'Design A Chat System',
  'Design A Search Autocomplete System',
  'Design YouTube',
  'Design Google Drive',
  'Proximity Service',
  'Nearby Friends',
  'Google Maps',
  'Distributed Message Queue',
  'Metrics Monitoring and Alerting System',
  'Ad Click Event Aggregation',
  'Hotel Reservation System',
  'Distributed Email Service',
  'S3-like Object Storage',
  'Real-time Gaming Leaderboard',
  'Payment System',
  'Digital Wallet',
  'Stock Exchange',
  'The Learning Continues',
];

// The one chapter that ships with a full authored study guide today.
const GUIDES = { 2: CH02_SCALE_GUIDE };

// Standalone architecture-pattern guides (not book chapters) under a "Patterns"
// group in the same track. Kept in their own list so new ones seed into an
// existing install, not just a fresh one.
const PATTERN_GUIDES = [
  { id: 'sdi-cdc-pattern', title: 'Pattern: NoSQL → Warehouse CDC Pipeline', group: 'Patterns', notes: SDI_CDC_PATTERN_GUIDE },
];

const pad = (n) => String(n).padStart(2, '0');
// idx 0 is the un-numbered Foreword; 1..30 are chapters "01".."30".
const chapterId = (idx) => `sdi-${pad(idx)}`;
const chapterTitle = (idx, name) => (idx === 0 ? name : `${pad(idx)} · ${name}`);

export async function seedSystemDesignContent() {
  try {
    const [phases, plansRec, items] = await Promise.all([
      getAll(STORES.phases),
      getAll(STORES.kv).then((rows) => rows.find((r) => r.k === 'plans')),
      getAll(STORES.items),
    ]);
    const existingIds = new Set(items.map((it) => it.id));
    // Cheap early out once the phase exists AND every chapter + pattern guide is
    // present — but new pattern guides added in later versions still get seeded
    // into an existing install.
    const allPresent = CHAPTERS.every((_, idx) => existingIds.has(chapterId(idx)))
      && PATTERN_GUIDES.every((g) => existingIds.has(g.id));
    if (phases.some((p) => p.id === PHASE_ID) && allPresent) return { ran: false };

    // Append after everything else so our chapters never outrank real topics.
    const maxItemOrder = items.reduce((m, it) => Math.max(m, it.order ?? 0), 0);
    const maxPhaseOrder = phases.reduce((m, p) => Math.max(m, p.order ?? 0), 0);

    // 1) Ensure the track exists in the plans list.
    const plans = (plansRec && Array.isArray(plansRec.v)) ? plansRec.v.slice() : [];
    if (!plans.some((p) => p.id === TRACK_ID)) {
      const maxPlanOrder = plans.reduce((m, p) => Math.max(m, p.order ?? 0), -1);
      plans.push({ id: TRACK_ID, name: 'System Design Interview', goal: 'ByteByteGo course — read + internalize each design.', order: maxPlanOrder + 1 });
      await put(STORES.kv, { k: 'plans', v: plans });
    }

    // 2) Ensure the phase (the book itself) exists — but don't re-put an existing
    // one, which would reshuffle its order when we're only adding a new guide.
    if (!phases.some((p) => p.id === PHASE_ID)) {
      await put(STORES.phases, {
        id: PHASE_ID, name: 'System Design Interview', weeks: [], dateRange: '',
        track: TRACK_ID, order: maxPhaseOrder + 1,
      });
    }

    // 3) Add each chapter as an item (skip any that already exist).
    const newItems = [];
    let order = maxItemOrder + 1;
    CHAPTERS.forEach((name, idx) => {
      const id = chapterId(idx);
      if (existingIds.has(id)) return;
      newItems.push({
        id,
        title: chapterTitle(idx, name),
        phase: PHASE_ID,
        track: TRACK_ID,
        week: null,
        area: 'System Design',
        group: 'System Design Interview',
        mode: 'TRANSIT', // reading / concept work — fits a commute or a light slot
        estMinutes: 45,
        recurring: false,
        dependsOn: [],
        status: 'todo',
        notes: GUIDES[idx] || '',
        coach: null,
        doneObjectives: [],
        objectives: undefined,
        order: order++,
      });
    });

    // 4) Add each standalone pattern guide (skip any that already exist).
    for (const g of PATTERN_GUIDES) {
      if (existingIds.has(g.id)) continue;
      newItems.push({
        id: g.id,
        title: g.title,
        phase: PHASE_ID,
        track: TRACK_ID,
        week: null,
        area: 'System Design',
        group: g.group,
        mode: 'TRANSIT',
        estMinutes: 30,
        recurring: false,
        dependsOn: [],
        status: 'todo',
        notes: g.notes,
        coach: null,
        doneObjectives: [],
        objectives: undefined,
        order: order++,
      });
    }
    if (newItems.length) await bulkPut(STORES.items, newItems);

    return { ran: true, added: newItems.length };
  } catch {
    return { ran: false };
  }
}
