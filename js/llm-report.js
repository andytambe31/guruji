// Builds a self-contained text prompt that summarizes everything the app knows
// about your prep — goal, pacing, phase progress, this-week effort, concepts,
// reps — and asks an LLM to analyse it and propose concrete, importable updates.
// Pasted into ChatGPT/Claude, the reply is an assessment plus (optionally) a
// "guruji-patch" JSON you can load back in Data → Load.
import { todayISO, addDaysISO } from './util.js';
import {
  computeRoadmap, getItems, getLog, getStudiedConcepts, getDrillState,
  getNuggetState, getReading, getPlans, getPhases,
} from './store.js';
import { isReadySolve, normalizeOutcome } from './outcomes.js';

const pct = (n) => (n == null ? '—' : `${n}%`);
const repsIn = (st, since) => Object.values(st || {}).filter((s) => s && s.at && String(s.at) >= since).length;

export async function buildLLMReport() {
  const [r, items, log, studied, drillState, nuggetState, reading, plans, phases] = await Promise.all([
    computeRoadmap(), getItems(), getLog(), getStudiedConcepts(), getDrillState(),
    getNuggetState(), getReading(), getPlans(), getPhases(),
  ]);
  const today = todayISO();
  const weekAgo = addDaysISO(today, -6);
  const weekLog = (log || []).filter((e) => String(e.date || '') >= weekAgo);

  // ---- This week's real effort, straight from the log ----
  let focusMin = 0; const byPattern = {}; let ready = 0, nonReady = 0, attempted = 0;
  const conceptRatings = [];
  for (const e of weekLog) {
    focusMin += e.focusMinutes || 0;
    for (const p of (e.leetcode || [])) {
      const o = normalizeOutcome(p.outcome);
      if (isReadySolve(o)) ready++; else if (o === 'attempted' || !o) attempted++; else nonReady++;
      const k = p.pattern || 'unlabelled';
      byPattern[k] = (byPattern[k] || 0) + 1;
    }
    for (const c of (e.concepts || [])) if (c && c.concept) conceptRatings.push(`${c.concept}:${c.confidence || '?'}`);
  }
  const sessions = weekLog.length;
  const studiedKeys = Object.keys(studied || {}).filter((k) => studied[k]);

  // ---- Per-area overall progress ----
  const areaAgg = {};
  for (const it of items) {
    const a = it.area || 'Other';
    (areaAgg[a] = areaAgg[a] || { done: 0, total: 0 });
    areaAgg[a].total++;
    if (it.status === 'done') areaAgg[a].done++;
  }

  // ---- The primary (job-switch) plan's curriculum, so suggestions use real ids ----
  const primary = (plans || []).find((p) => /offer|job|fang|faang/i.test(`${p.goal || ''} ${p.id}`)) || (plans || [])[0];
  const primaryId = primary ? primary.id : null;
  const phasesOfPrimary = (phases || []).filter((ph) => !primaryId || ph.track === primaryId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const itemsByPhase = new Map();
  for (const it of items) { if (!itemsByPhase.has(it.phase)) itemsByPhase.set(it.phase, []); itemsByPhase.get(it.phase).push(it); }

  const L = []; // output lines
  const p = r.pacing || {};
  L.push('You are an expert FAANG software-engineering interview-prep coach. Below is a structured export from "Guruji", a personal study-tracking app. Analyse where this candidate stands against their timeline, then give a sharp assessment and concrete, prioritised changes to make in the app.');
  L.push('');
  L.push('== GOAL & TIMELINE ==');
  L.push(`Target: ${r.goalLabel || 'the goal'}${r.goalDate ? ` by ${r.goalDate}` : ''}`);
  if (r.target) L.push(`Stated aim: ${r.target}`);
  L.push(`Now: week ${r.currentWeek}, ${r.daysLeft ?? '—'} days left, ${pct(r.pctTime)} of the runway used.`);
  L.push(`Self-assessed on-track: ${r.onTrack ? 'yes' : 'NO — behind pace'}.`);
  L.push('');
  L.push('== PACING (remaining work vs the deadline) ==');
  if (p.lc) L.push(`LeetCode: ${p.lc.done}/${p.lc.goal} attempted (volume); ${p.lc.ready ?? '?'} solved independently+ (readiness); ${p.lc.remaining} to goal; need ~${p.lc.perWeek || 0}/wk; did ${p.lc.actualPerWeek || 0} this week.`);
  if (p.topics) L.push(`Topics: ${p.topics.done}/${p.topics.total} done (${pct(p.topics.pct)}); ${p.topics.remaining} left; need ~${p.topics.perWeek || 0}/wk.`);
  if (p.concepts) L.push(`Concepts: ${p.concepts.solid} solid · ${p.concepts.shaky} shaky · ${p.concepts.noyet} not-yet-rated (of ${p.concepts.total}).`);
  if (p.hours) L.push(`Study time: ~${p.hours.actual}h logged this week vs ~${p.hours.needed ?? '—'}h/wk needed.`);
  L.push('');
  L.push('== PHASES (primary plan) ==');
  for (const ph of (r.phases || [])) {
    L.push(`- ${ph.name} [${ph.status}] weeks ${ph.weekStart ?? '?'}-${ph.weekEnd ?? '?'}: ${ph.done}/${ph.total} done (${pct(ph.pct)})${ph.areas && ph.areas.length ? ` · ${ph.areas.join(', ')}` : ''}`);
  }
  L.push('');
  L.push('== THIS WEEK’S ACTUAL EFFORT (last 7 days, from the log) ==');
  L.push(`Logged sessions: ${sessions}; focus time: ${Math.round(focusMin)} min.`);
  L.push(`LeetCode: ${ready} solved independently+ (counts toward readiness), ${nonReady} solved with hints/solution, ${attempted} attempted.`);
  const patLines = Object.entries(byPattern).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`);
  L.push(`By pattern: ${patLines.length ? patLines.join(', ') : '—'}`);
  L.push(`Concepts rated: ${conceptRatings.length ? conceptRatings.join(', ') : '—'}`);
  L.push('');
  L.push('== OVERALL PROGRESS BY AREA ==');
  for (const [a, v] of Object.entries(areaAgg).sort((x, y) => y[1].total - x[1].total)) L.push(`- ${a}: ${v.done}/${v.total} done`);
  L.push('');
  L.push('== REPETITION & COVERAGE ==');
  L.push(`Drills reviewed this week: ${repsIn(drillState, weekAgo)}; nuggets: ${repsIn(nuggetState, weekAgo)}.`);
  L.push(`Concepts marked studied (${studiedKeys.length}): ${studiedKeys.length ? studiedKeys.join(', ') : '—'}`);
  if (reading && reading.current) L.push(`Reading: "${reading.current.title || '?'}"${reading.current.author ? ` by ${reading.current.author}` : ''}.`);
  L.push('');
  if ((r.nextTopics || []).length) {
    L.push('== NEXT UP (unblocked to-do) ==');
    for (const t of r.nextTopics) L.push(`- ${t.title} (${t.area || '?'}${t.est ? `, ~${t.est}m` : ''})`);
    L.push('');
  }

  // Curriculum listing so the LLM can reference real ids in a patch.
  L.push('== CURRICULUM (primary plan — use these exact ids in any patch) ==');
  L.push(`plan id: ${primaryId || '(none)'}`);
  for (const ph of phasesOfPrimary) {
    L.push(`phase "${ph.id}" (${ph.name}):`);
    const its = (itemsByPhase.get(ph.id) || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const it of its) L.push(`  ${it.id} [${it.status}] ${it.title} · ${it.area || '?'}${it.week ? ` · wk${it.week}` : ''}`);
  }
  L.push('');

  L.push('== WHAT I NEED FROM YOU ==');
  L.push('1. A short, honest assessment: am I on track for the target date? Name the 2–3 biggest risks or gaps (volume, a weak area, uneven pacing, thin repetition, etc.).');
  L.push('2. A prioritised, concrete action list for the next 1–2 weeks — what to add, drop, reorder, or focus on, and why.');
  L.push('3. OPTIONAL but preferred: if you recommend curriculum changes, output an importable "content patch" JSON I can paste into the app under Data → Load. Use ONLY the real plan/phase/item ids listed above. Shape:');
  L.push('```json');
  L.push('{');
  L.push('  "app": "guruji-patch",');
  L.push('  "id": "llm-review-YYYY-MM-DD",');
  L.push('  "description": "one line on what this changes",');
  L.push('  "ops": [');
  L.push('    {"op":"add-item","plan":"<planId>","phase":"<phaseId>","item":{"id":"unique-id","title":"...","area":"DSA|System Design|CS Fundamentals|Behavioral","group":"...","mode":"DESK","estMinutes":60,"week":2,"dependsOn":[],"status":"todo"}},');
  L.push('    {"op":"update-item","id":"<existingItemId>","set":{"week":3,"estMinutes":90}},');
  L.push('    {"op":"remove-item","id":"<existingItemId>"}');
  L.push('  ]');
  L.push('}');
  L.push('```');
  L.push('Keep the JSON strictly valid, ids unique, and every id referenced real. Explain the reasoning above the JSON; put the JSON last so it is easy to copy.');

  return L.join('\n');
}
