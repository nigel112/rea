/**
 * Who may see whom.
 *
 * This is the most consequential function in the product. Every listing, every card, every
 * "who liked you" entry and every message send has to agree with it, or the app leaks people who
 * filtered you out (or people who blocked you). See ../../../REVERSE_ENGINEERING.md §2.2.
 */
import { ageOn, daysBetween } from '../lib/time.js';
import { parseJson } from '../db/index.js';

export const GENDERS = Object.freeze(['woman', 'man', 'nonbinary']);
export const INTENTS = Object.freeze(['long-term', 'short-term', 'friends', 'figuring-it-out']);

/** Zimbabwe + diaspora anchors. Coordinates are approximate city centres. */
export const CITIES = Object.freeze({
  Harare: { lat: -17.8252, lon: 31.0335, country: 'ZW' },
  Bulawayo: { lat: -20.1325, lon: 28.6265, country: 'ZW' },
  Chitungwiza: { lat: -18.0127, lon: 31.0756, country: 'ZW' },
  Mutare: { lat: -18.9707, lon: 32.6709, country: 'ZW' },
  Gweru: { lat: -19.45, lon: 29.8167, country: 'ZW' },
  Kwekwe: { lat: -18.9281, lon: 29.8149, country: 'ZW' },
  Masvingo: { lat: -20.0637, lon: 30.8277, country: 'ZW' },
  Kadoma: { lat: -18.3333, lon: 29.9167, country: 'ZW' },
  Chinhoyi: { lat: -17.3667, lon: 30.2, country: 'ZW' },
  'Victoria Falls': { lat: -17.9243, lon: 25.8572, country: 'ZW' },
  Hwange: { lat: -18.3647, lon: 26.4983, country: 'ZW' },
  Marondera: { lat: -18.1853, lon: 31.5519, country: 'ZW' },
  Bindura: { lat: -17.3019, lon: 31.3306, country: 'ZW' },
  Beitbridge: { lat: -22.2167, lon: 30.0, country: 'ZW' },
  Johannesburg: { lat: -26.2041, lon: 28.0473, country: 'ZA' },
  'Cape Town': { lat: -33.9249, lon: 18.4241, country: 'ZA' },
  London: { lat: 51.5072, lon: -0.1276, country: 'GB' },
  Dubai: { lat: 25.2048, lon: 55.2708, country: 'AE' },
  Perth: { lat: -31.9523, lon: 115.8613, country: 'AU' },
  Toronto: { lat: 43.6532, lon: -79.3832, country: 'CA' },
});

/** "Anywhere" is an explicit radius, not a special case buried in the query. */
export const ANYWHERE_KM = 20_000;

export function nearestCity(lat, lon) {
  let best = null;
  let bestDistance = Infinity;
  for (const [name, point] of Object.entries(CITIES)) {
    const distance = haversineKm({ lat, lon }, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return { city: best, distanceKm: Math.round(bestDistance) };
}

export function haversineKm(a, b) {
  if (!a || !b) return null;
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  if (typeof b.lat !== 'number' || typeof b.lon !== 'number') return null;
  const R = 6371;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Normalise a stored user row into the shape the domain rules expect. */
export function hydrateUser(row) {
  if (!row) return null;
  return {
    ...row,
    lookingFor: parseJson(row.looking_for, []),
    languages: parseJson(row.languages, []),
    interests: parseJson(row.interests, []),
    prompts: parseJson(row.prompts, []),
    photoIds: parseJson(row.photo_ids, []),
    verified: Boolean(row.verified),
    banned: Boolean(row.banned),
    isAdmin: Boolean(row.is_admin),
    seeded: Boolean(row.seeded),
    lat: typeof row.lat === 'number' ? row.lat : CITIES[row.city]?.lat ?? null,
    lon: typeof row.lon === 'number' ? row.lon : CITIES[row.city]?.lon ?? null,
  };
}

export function ageOf(user, now) {
  return ageOn(user.birth_date, now);
}

function orientationMatches(viewer, candidate) {
  const viewerWants = viewer.lookingFor;
  const candidateWants = candidate.lookingFor;
  if (!Array.isArray(viewerWants) || viewerWants.length === 0) return false;
  if (!Array.isArray(candidateWants) || candidateWants.length === 0) return false;
  return viewerWants.includes(candidate.gender) && candidateWants.includes(viewer.gender);
}

function ageWithin(viewer, candidate, candidateAge, viewerAge) {
  if (candidateAge === null || viewerAge === null) return false;
  // Each side's stated range is applied to the other person. Non-negotiable, both ways.
  if (candidateAge < viewer.min_age || candidateAge > viewer.max_age) return false;
  if (viewerAge < candidate.min_age || viewerAge > candidate.max_age) return false;
  return true;
}

function distanceWithin(viewer, candidate) {
  const km = haversineKm(viewer, candidate);
  if (km === null) return false; // unknown location never passes a distance filter
  if (viewer.max_distance_km >= ANYWHERE_KM) return true;
  // Distance is filtered from both sides, for the same reason as age.
  const viewerOk = km <= viewer.max_distance_km;
  const candidateOk = candidate.max_distance_km >= ANYWHERE_KM || km <= candidate.max_distance_km;
  return viewerOk && candidateOk;
}

/**
 * Reason codes make "why am I not seeing this person?" answerable instead of mysterious.
 * Returning the *first* failing reason keeps the API cheap and the UI honest.
 */
export function eligibility(viewer, candidate, context = {}) {
  if (!viewer || !candidate) return { ok: false, reason: 'missing_user' };
  if (viewer.id === candidate.id) return { ok: false, reason: 'self' };
  if (candidate.banned) return { ok: false, reason: 'banned' };
  if (viewer.banned) return { ok: false, reason: 'viewer_banned' };

  const blocked = context.blockedIds;
  if (blocked?.has(candidate.id)) return { ok: false, reason: 'blocked' };
  const blockedBy = context.blockedByIds;
  if (blockedBy?.has(candidate.id)) return { ok: false, reason: 'blocked_by' };

  if (!orientationMatches(viewer, candidate)) return { ok: false, reason: 'orientation' };

  const now = context.now ?? new Date().toISOString();
  const viewerAge = ageOf(viewer, now);
  const candidateAge = ageOf(candidate, now);
  if (!ageWithin(viewer, candidate, candidateAge, viewerAge)) return { ok: false, reason: 'age_range' };

  if (!distanceWithin(viewer, candidate)) return { ok: false, reason: 'distance' };

  return { ok: true, reason: null, viewerAge, candidateAge, distanceKm: Math.round(haversineKm(viewer, candidate) ?? 0) };
}

/** How complete a profile is, 0..1. Used by ranking and by the "finish your profile" nudge. */
export function profileCompleteness(user) {
  const checks = [
    Boolean(user.headline && user.headline.trim().length >= 4),
    Boolean(user.bio && user.bio.trim().length >= 40),
    user.photoIds.length > 0,
    user.photoIds.length >= 3,
    user.interests.length >= 3,
    Boolean(user.occupation),
    Boolean(user.education),
    Boolean(user.languages.length),
    Boolean(user.height_cm),
    user.prompts.length >= 2,
    Boolean(user.verified),
  ];
  return checks.filter(Boolean).length / checks.length;
}

/** Jaccard overlap of interest sets, 0..1. */
export function interestOverlap(left, right) {
  const a = new Set(left ?? []);
  const b = new Set(right ?? []);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Recency signal: 1.0 for active in the last hour, decaying over a week. */
export function recencyScore(lastActiveIso, now) {
  const hours = Math.max(0, daysBetween(lastActiveIso, now) * 24);
  return Math.exp(-hours / 168);
}

/** First-72-hours exposure floor (see dossier §5.1). */
export function newcomerBoost(createdAtIso, now) {
  return daysBetween(createdAtIso, now) < 3 ? 1 : 0;
}
