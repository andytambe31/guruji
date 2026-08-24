// Pure study-cycle math — keeps "how much calendar has elapsed" separate from
// "where the active curriculum sequence is." A life interruption advances the
// calendar (and eats deadline runway) but should NOT compress all missed weeks
// into the remainder; instead the user re-anchors the *study* sequence to today
// while the deadline stays fixed.
//
// No I/O — takes plain values so it's trivially testable.
import { daysBetween } from './util.js';

// calendarWeek: elapsed wall-clock weeks from the plan's original start (1-based).
export function calendarWeek(startWeekOf, today) {
  if (!startWeekOf) return 1;
  return Math.max(1, Math.floor(daysBetween(startWeekOf, today) / 7) + 1);
}

// studyWeek: where the active curriculum sequence sits. With no re-entry anchor
// it equals the calendar week (identical legacy behavior). With an anchor set on
// a return, it counts forward from the chosen resume week: on the anchor day it
// IS anchorWeek, and it advances one per elapsed week thereafter.
export function studyWeek(startWeekOf, studyCycle, today) {
  const cal = calendarWeek(startWeekOf, today);
  if (!studyCycle || !studyCycle.anchorDate || !studyCycle.anchorWeek) return cal;
  const elapsed = Math.max(0, Math.floor(daysBetween(studyCycle.anchorDate, today) / 7));
  return Math.max(1, studyCycle.anchorWeek + elapsed);
}

// Both reads at once, plus whether a re-entry anchor is active and how old it is
// (drives the "rebuilding" execution grace window).
export function computeStudyCycle(startWeekOf, studyCycle, today) {
  const cal = calendarWeek(startWeekOf, today);
  const study = studyWeek(startWeekOf, studyCycle, today);
  const active = !!(studyCycle && studyCycle.anchorDate && studyCycle.anchorWeek);
  const anchorAgeDays = active ? Math.max(0, daysBetween(studyCycle.anchorDate, today)) : null;
  return {
    currentCalendarWeek: cal,
    currentStudyWeek: study,
    anchorActive: active,
    anchorAgeDays,
    // Weeks of calendar lost to the interruption (calendar ahead of study).
    weeksBehindCalendar: active ? Math.max(0, cal - study) : 0,
  };
}
