// Generate an iCalendar (.ics) file from the day's blocks so they can be
// imported into Apple/Google Calendar. One-way snapshot: reshuffling happens
// inside Guruji, then you re-export. Times are floating (local, no timezone).

function pad(n) { return String(n).padStart(2, '0'); }

// "YYYY-MM-DD" + minutes-since-midnight -> "YYYYMMDDTHHMMSS" (local/floating)
function icsLocal(date, minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${date.replace(/-/g, '')}T${pad(h)}${pad(m)}00`;
}

// UTC stamp for DTSTAMP (allowed here — this is app code, not a workflow script)
function icsStamp(d = new Date()) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// blocks: [{ id, date, start, minutes, area, title, mode }]
// reveal: include the actual topic in the event title (default: area only).
export function blocksToICS(blocks, { calName = 'Guruji', reveal = false } = {}) {
  const stamp = icsStamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Guruji//Study//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(calName)}`,
  ];
  for (const b of blocks) {
    const summary = reveal && b.title ? `${b.area}: ${b.title}` : `${b.area} — study`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.id}@guruji.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsLocal(b.date, b.start)}`,
      `DTEND:${icsLocal(b.date, b.start + b.minutes)}`,
      `SUMMARY:${esc(summary)}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Trigger a download of the .ics for a set of blocks.
export function downloadICS(blocks, filename, opts = {}) {
  const text = blocksToICS(blocks, opts);
  const blob = new Blob([text], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}
