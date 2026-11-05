/** Time helpers. Every domain function takes `now` explicitly so tests are deterministic. */

export function nowIso() {
  return new Date().toISOString();
}

export function isoFrom(date) {
  return new Date(date).toISOString();
}

export function addMs(iso, ms) {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function addDays(iso, days) {
  return addMs(iso, days * 86_400_000);
}

export function hoursBetween(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000;
}

export function daysBetween(fromIso, toIso) {
  return hoursBetween(fromIso, toIso) / 24;
}

/** Whole years between a date and `now`, computed on the calendar (not on 365.25-day years). */
export function ageOn(birthDate, nowIsoValue) {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date(nowIsoValue);
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/** Start of the current UTC day, used for daily quotas. */
export function startOfUtcDay(iso) {
  const date = new Date(iso);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

export function isPast(iso, now) {
  return new Date(iso).getTime() <= new Date(now).getTime();
}

/** Human-friendly relative time for notification copy. */
export function relativeTime(fromIso, now) {
  const minutes = Math.round((new Date(now).getTime() - new Date(fromIso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(fromIso).toISOString().slice(0, 10);
}
