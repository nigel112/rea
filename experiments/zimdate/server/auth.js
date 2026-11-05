/**
 * Authentication and session handling.
 *
 * Choices that matter:
 *   - scrypt from node:crypto (no bcrypt dependency, no naive SHA-256 password hashing)
 *   - sessions are stored as SHA-256 hashes of the token: a database dump cannot be replayed
 *   - CSRF: double-submit token bound to the session row, required on every mutating request
 *   - httpOnly, SameSite=Lax cookies; `Secure` is set when the request arrived over https
 *   - login attempts are rate limited per email+IP with a lockout window
 */
import { scryptSync, randomBytes } from 'node:crypto';
import { get, run, all } from './db/index.js';
import { sha256, constantTimeEqual, id } from './lib/ids.js';
import { nowIso, addDays, addMs, isPast } from './lib/time.js';

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });
export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE = 'zimdate_session';
export const CSRF_HEADER = 'x-zimdate-csrf';
export const LOCKOUT = Object.freeze({ maxAttempts: 8, windowMs: 15 * 60_000 });

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const derived = scryptSync(password, salt, expected.length, { N, r, p });
  return derived.length === expected.length && constantTimeEqual(derived.toString('base64'), expected.toString('base64'));
}

export function createSession(db, user, userAgent = '', now = nowIso()) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const expiresAt = addDays(now, SESSION_TTL_DAYS);
  run(
    db,
    `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    sha256(token),
    user.id,
    csrf,
    now,
    expiresAt,
    String(userAgent).slice(0, 300),
  );
  return { token, csrf, expiresAt };
}

export function sessionFromToken(db, token, now = nowIso()) {
  if (!token || typeof token !== 'string') return null;
  const row = get(db, `SELECT * FROM sessions WHERE token_hash = ?`, sha256(token));
  if (!row) return null;
  if (isPast(row.expires_at, now)) {
    run(db, `DELETE FROM sessions WHERE token_hash = ?`, row.token_hash);
    return null;
  }
  return row;
}

export function destroySession(db, token) {
  if (!token) return { destroyed: false };
  const result = run(db, `DELETE FROM sessions WHERE token_hash = ?`, sha256(token));
  return { destroyed: result.changes > 0 };
}

export function destroyAllSessions(db, userId) {
  const result = run(db, `DELETE FROM sessions WHERE user_id = ?`, userId);
  return { destroyed: result.changes };
}

/** Extract a cookie value without pulling in a parser dependency. */
export function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of String(cookieHeader).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function sessionCookie(token, options = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAge ?? SESSION_TTL_DAYS * 86_400}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(options = {}) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/* ---------------------------------------------------------------- rate limiting */

/**
 * In-memory sliding-window limiter for auth endpoints. Keyed by an explicit string so the caller
 * owns the policy (per-IP for signup, per-email+IP for login).
 */
export function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    hit(key, now = Date.now()) {
      const cutoff = now - windowMs;
      const list = (hits.get(key) ?? []).filter((time) => time > cutoff);
      list.push(now);
      hits.set(key, list);
      if (hits.size > 5000) {
        // Bound memory: drop the oldest keys rather than growing without limit.
        for (const [staleKey, times] of hits) {
          if (times.length === 0 || times.at(-1) < cutoff) hits.delete(staleKey);
          if (hits.size <= 4000) break;
        }
      }
      return { allowed: list.length <= max, remaining: Math.max(0, max - list.length), retryAfterMs: allowed(list, max) ? 0 : windowMs };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

function allowed(list, max) {
  return list.length <= max;
}

export const loginLimiter = createLimiter({
  max: LOCKOUT.maxAttempts,
  windowMs: LOCKOUT.windowMs,
});

export function loginLockoutFor(email, ip, now = nowIso()) {
  const key = `${String(email).toLowerCase()}|${ip}`;
  const state = loginLimiter.hit(key, new Date(now).getTime());
  return state;
}

export function resetLoginLockout(email, ip) {
  loginLimiter.reset(`${String(email).toLowerCase()}|${ip}`);
}

export const signupLimiter = createLimiter({ max: 5, windowMs: 60 * 60_000 });
export const writeLimiter = createLimiter({ max: 240, windowMs: 60_000 });

/** Admin gate for the moderation endpoints. Seeded demo admin only; no privilege escalation path. */
export function requireAdmin(user) {
  return Boolean(user?.isAdmin);
}

export function auditAdmin(db, actorId, action, targetType, targetId, notes = '', now = nowIso()) {
  run(
    db,
    `INSERT INTO moderation_log (id, actor_id, target_type, target_id, action, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id('mod'),
    actorId,
    targetType,
    targetId,
    action,
    notes,
    now,
  );
}

export function recentAudit(db, limit = 50) {
  return all(
    db,
    `SELECT m.*, u.name AS actor_name FROM moderation_log m
       LEFT JOIN users u ON u.id = m.actor_id
      ORDER BY m.created_at DESC LIMIT ?`,
    Math.min(Math.max(Number(limit) || 50, 1), 200),
  );
}

export { addMs };
