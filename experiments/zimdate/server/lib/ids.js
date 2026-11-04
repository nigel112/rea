/**
 * Identifiers and deterministic randomness.
 *
 * Seeded data must be *reproducible*: same seed, same 500 profiles, same answers, same scores. Any
 * PRNG drift turns every screenshot and test fixture into a lie.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish: no i, l, o, u

/** Short, sortable-ish, URL-safe id. Not a UUID, and does not pretend to be one. */
export function id(prefix = '') {
  const bytes = randomBytes(13);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Mulberry32: tiny, fast, good enough for fixtures, fully deterministic. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = seededRandom(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (probability) => next() < probability,
    shuffle: (list) => {
      const copy = [...list];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
      }
      return copy;
    },
    // Box-Muller for believable heights and response times.
    normal: (mean, deviation) => {
      const u = Math.max(next(), Number.EPSILON);
      const v = next();
      return mean + Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * deviation;
    },
  };
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
