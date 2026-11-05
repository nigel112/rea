/**
 * Likes, passes, matches, blocks, reports and messages.
 *
 * Every write here is idempotent or explicitly rejected — never "sometimes works". The invariants:
 *   - a like is a row; liking twice is a no-op that returns the same state
 *   - a match exists once per pair, canonical-ordered, and only when both likes exist
 *   - you cannot message a closed, blocked or non-existent match
 *   - sending the same `clientId` twice returns the first message
 */
import { all, get, run, transaction, toJson, parseJson } from '../db/index.js';
import { id } from '../lib/ids.js';
import { nowIso, addDays, addMs, startOfUtcDay, isPast } from '../lib/time.js';

export const DAILY_LIKE_LIMIT = Object.freeze({ free: 25, plus: 100, gold: Infinity });
export const SUPER_LIKE_COST = 5; // coins
export const REPORT_REASONS = Object.freeze([
  'fake_profile',
  'harassment',
  'spam',
  'inappropriate_photos',
  'underage',
  'scam',
  'offline_behaviour',
  'other',
]);
export const MESSAGE_LIMIT = 2000;
export const MESSAGE_RATE = Object.freeze({ windowMs: 5 * 60_000, max: 20 });

/** Canonical pair ordering lives in one place so SQL and code cannot disagree. */
export function canonicalPair(left, right) {
  return left < right ? [left, right] : [right, left];
}

export function likeState(db, fromUser, toUser) {
  const mine = get(db, `SELECT 1 AS ok FROM likes WHERE from_user = ? AND to_user = ?`, fromUser, toUser);
  const theirs = get(db, `SELECT 1 AS ok FROM likes WHERE from_user = ? AND to_user = ?`, toUser, fromUser);
  const blocked = get(db, `SELECT 1 AS ok FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`, fromUser, toUser, toUser, fromUser);
  return { liked: Boolean(mine), likesYou: Boolean(theirs), blocked: Boolean(blocked) };
}

export function findMatchBetween(db, left, right) {
  const [a, b] = canonicalPair(left, right);
  return get(db, `SELECT * FROM matches WHERE user_a = ? AND user_b = ?`, a, b);
}

export function findMatchById(db, matchId) {
  return get(db, `SELECT * FROM matches WHERE id = ?`, matchId);
}

export function otherParticipant(match, userId) {
  return match.user_a === userId ? match.user_b : match.user_a;
}

export function isParticipant(match, userId) {
  return Boolean(match) && (match.user_a === userId || match.user_b === userId);
}

export function quotaSnapshot(db, user, now = nowIso()) {
  const limit = DAILY_LIKE_LIMIT[user.tier] ?? DAILY_LIKE_LIMIT.free;
  const dayStart = startOfUtcDay(now);
  const row = get(
    db,
    `SELECT COUNT(*) AS count FROM likes WHERE from_user = ? AND created_at >= ?`,
    user.id,
    dayStart,
  );
  const used = row?.count ?? 0;
  return {
    limit: Number.isFinite(limit) ? limit : null,
    used,
    remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : null,
    resetsAt: addDays(dayStart, 1),
    unlimited: !Number.isFinite(limit),
  };
}

export class DomainError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Record a like. Returns the resulting state so the client never has to guess.
 * `superLike` spends coins and is surfaced in the target's notifications.
 */
export function like(db, fromUser, toUser, options = {}) {
  const now = options.now ?? nowIso();
  if (fromUser.id === toUser.id) throw new DomainError('cannot_like_self', 'You cannot like yourself.', 400);
  if (toUser.banned) throw new DomainError('target_unavailable', 'That profile is no longer available.', 404);

  const state = likeState(db, fromUser.id, toUser.id);
  if (state.blocked) throw new DomainError('blocked', 'You cannot interact with this person.', 403);

  const existing = get(db, `SELECT 1 AS ok FROM likes WHERE from_user = ? AND to_user = ?`, fromUser.id, toUser.id);
  if (existing) {
    const match = findMatchBetween(db, fromUser.id, toUser.id);
    const live = match && !match.closed_at ? match : null;
    // Same shape as a first-time like: clients must not have to branch on "already liked".
    return { liked: true, alreadyLiked: true, matched: Boolean(live), match: live, quota: quotaSnapshot(db, fromUser, now) };
  }

  const quota = quotaSnapshot(db, fromUser, now);
  if (!quota.unlimited && quota.remaining <= 0) {
    throw new DomainError('like_quota_exhausted', 'You are out of likes for today.', 429, { quota });
  }

  if (options.superLike) {
    if (fromUser.coins < SUPER_LIKE_COST) {
      throw new DomainError('insufficient_coins', `A super like costs ${SUPER_LIKE_COST} ZimCoins.`, 402);
    }
  }

  const result = transaction(db, () => {
    run(
      db,
      `INSERT INTO likes (from_user, to_user, created_at, seen) VALUES (?, ?, ?, 0)`,
      fromUser.id,
      toUser.id,
      now,
    );
    if (options.superLike) {
      run(db, `UPDATE users SET coins = coins - ? WHERE id = ?`, SUPER_LIKE_COST, fromUser.id);
      notify(db, toUser.id, 'like', { from: fromUser.id, fromName: fromUser.name, super: true }, now);
    } else {
      notify(db, toUser.id, 'like', { from: fromUser.id, fromName: fromUser.name }, now);
    }

    let match = null;
    const reciprocal = get(db, `SELECT 1 AS ok FROM likes WHERE from_user = ? AND to_user = ?`, toUser.id, fromUser.id);
    if (reciprocal) {
      match = createMatch(db, fromUser.id, toUser.id, now);
    }
    return { liked: true, matched: Boolean(match), match, quota: quotaSnapshot(db, fromUser, now) };
  });
  return result;
}

export function pass(db, fromUser, toUser, now = nowIso()) {
  run(
    db,
    `INSERT INTO passes (from_user, to_user, created_at) VALUES (?, ?, ?)
     ON CONFLICT (from_user, to_user) DO UPDATE SET created_at = excluded.created_at`,
    fromUser.id,
    toUser.id,
    now,
  );
  return { passed: true };
}

export function undoPass(db, fromUser, toUser) {
  const result = run(db, `DELETE FROM passes WHERE from_user = ? AND to_user = ?`, fromUser.id, toUser.id);
  return { undone: result.changes > 0 };
}

export function createMatch(db, left, right, now = nowIso()) {
  const [a, b] = canonicalPair(left, right);
  const existing = get(db, `SELECT * FROM matches WHERE user_a = ? AND user_b = ?`, a, b);
  if (existing) return existing;
  const matchId = id('match');
  run(
    db,
    `INSERT INTO matches (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)`,
    matchId,
    a,
    b,
    now,
  );
  notify(db, a, 'match', { matchId, with: b }, now);
  notify(db, b, 'match', { matchId, with: a }, now);
  return get(db, `SELECT * FROM matches WHERE id = ?`, matchId);
}

/** Unmatch. One-sided in effect; the other party is *not* notified (safety, not politeness). */
export function unmatch(db, matchId, userId, now = nowIso()) {
  const match = findMatchById(db, matchId);
  if (!match) throw new DomainError('match_not_found', 'That match no longer exists.', 404);
  if (!isParticipant(match, userId)) throw new DomainError('not_a_participant', 'You are not part of that match.', 403);
  if (match.closed_at) return { closed: true, alreadyClosed: true };
  run(db, `UPDATE matches SET closed_at = ?, closed_by = ? WHERE id = ?`, now, userId, matchId);
  return { closed: true, alreadyClosed: false };
}

export function block(db, blockerId, blockedId, now = nowIso()) {
  if (blockerId === blockedId) throw new DomainError('cannot_block_self', 'You cannot block yourself.', 400);
  transaction(db, () => {
    run(db, `INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`, blockerId, blockedId, now);
    // Blocking also removes any likes in both directions and closes an open match.
    run(db, `DELETE FROM likes WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)`, blockerId, blockedId, blockedId, blockerId);
    const match = findMatchBetween(db, blockerId, blockedId);
    if (match && !match.closed_at) {
      run(db, `UPDATE matches SET closed_at = ?, closed_by = ? WHERE id = ?`, now, blockerId, match.id);
    }
  });
  return { blocked: true };
}

export function unblock(db, blockerId, blockedId) {
  const result = run(db, `DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, blockerId, blockedId);
  return { unblocked: result.changes > 0 };
}

export function report(db, reporterId, targetId, reason, details = '', now = nowIso()) {
  if (!REPORT_REASONS.includes(reason)) throw new DomainError('invalid_reason', 'Unknown report reason.', 400);
  if (reporterId === targetId) throw new DomainError('cannot_report_self', 'You cannot report yourself.', 400);
  run(
    db,
    `INSERT INTO reports (id, reporter_id, target_id, reason, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)
     ON CONFLICT (reporter_id, target_id, reason) DO NOTHING`,
    id('rep'),
    reporterId,
    targetId,
    reason,
    String(details).slice(0, 2000),
    now,
  );
  const row = get(
    db,
    `SELECT * FROM reports WHERE reporter_id = ? AND target_id = ? AND reason = ?`,
    reporterId,
    targetId,
    reason,
  );
  return row;
}

export function notify(db, userId, kind, payload, now = nowIso()) {
  run(
    db,
    `INSERT INTO notifications (id, user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    id('ntf'),
    userId,
    kind,
    toJson(payload),
    now,
  );
}

export function listNotifications(db, userId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
  const rows = all(
    db,
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    limit,
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: parseJson(row.payload, {}),
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  }));
}

export function markNotificationsRead(db, userId, now = nowIso()) {
  const result = run(db, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, now, userId);
  return { marked: result.changes };
}

/** Both participants' view of a match, including unread counts and the last message. */
export function matchSummary(db, match, userId) {
  const otherId = otherParticipant(match, userId);
  const lastReadAt = match.user_a === userId ? match.a_last_read_at : match.b_last_read_at;
  const lastMessage = get(
    db,
    `SELECT id, sender_id, body, created_at FROM messages WHERE match_id = ? ORDER BY created_at DESC LIMIT 1`,
    match.id,
  );
  const unreadRow = get(
    db,
    `SELECT COUNT(*) AS count FROM messages
      WHERE match_id = ? AND sender_id <> ? AND (? IS NULL OR created_at > ?)`,
    match.id,
    userId,
    lastReadAt,
    lastReadAt,
  );
  return {
    id: match.id,
    withUserId: otherId,
    createdAt: match.created_at,
    lastMessageAt: match.last_message_at,
    closed: Boolean(match.closed_at),
    closedByMe: match.closed_by === userId,
    lastReadAt,
    unread: unreadRow?.count ?? 0,
    preview: lastMessage
      ? {
          body: lastMessage.body.length > 140 ? `${lastMessage.body.slice(0, 137)}…` : lastMessage.body,
          fromMe: lastMessage.sender_id === userId,
          at: lastMessage.created_at,
        }
      : null,
  };
}

export function listMatches(db, userId, options = {}) {
  const includeClosed = options.includeClosed === true;
  const rows = all(
    db,
    `SELECT * FROM matches WHERE (user_a = ? OR user_b = ?) ${includeClosed ? '' : 'AND closed_at IS NULL'}
      ORDER BY COALESCE(last_message_at, created_at) DESC`,
    userId,
    userId,
  );
  return rows.map((match) => matchSummary(db, match, userId));
}

/** Rate limiting is a domain rule, not a middleware accident: it is part of the contract. */
export function assertMessageRate(db, matchId, senderId, now = nowIso()) {
  const since = addMs(now, -MESSAGE_RATE.windowMs);
  const row = get(
    db,
    `SELECT COUNT(*) AS count FROM messages WHERE match_id = ? AND sender_id = ? AND created_at >= ?`,
    matchId,
    senderId,
    since,
  );
  if ((row?.count ?? 0) >= MESSAGE_RATE.max) {
    throw new DomainError('rate_limited', 'Slow down a little — try again in a few minutes.', 429, {
      windowMs: MESSAGE_RATE.windowMs,
      max: MESSAGE_RATE.max,
    });
  }
}

export function sendMessage(db, user, matchId, body, clientId, now = nowIso()) {
  const text = String(body ?? '').trim();
  if (text.length === 0) throw new DomainError('empty_message', 'Say something first.', 400);
  if (text.length > MESSAGE_LIMIT) {
    throw new DomainError('message_too_long', `Messages are limited to ${MESSAGE_LIMIT} characters.`, 400);
  }

  const match = findMatchById(db, matchId);
  if (!match) throw new DomainError('match_not_found', 'That conversation does not exist.', 404);
  if (!isParticipant(match, user.id)) throw new DomainError('not_a_participant', 'You are not part of that match.', 403);
  if (match.closed_at) throw new DomainError('match_closed', 'This conversation has ended.', 403);

  const otherId = otherParticipant(match, user.id);
  const blocked = get(
    db,
    `SELECT 1 AS ok FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    user.id,
    otherId,
    otherId,
    user.id,
  );
  if (blocked) throw new DomainError('blocked', 'You cannot message this person.', 403);

  if (clientId) {
    const existing = get(
      db,
      `SELECT * FROM messages WHERE match_id = ? AND sender_id = ? AND client_id = ?`,
      matchId,
      user.id,
      clientId,
    );
    if (existing) return { message: existing, idempotent: true };
  }

  assertMessageRate(db, matchId, user.id, now);

  const messageId = id('msg');
  transaction(db, () => {
    run(
      db,
      `INSERT INTO messages (id, match_id, sender_id, body, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      messageId,
      matchId,
      user.id,
      text,
      clientId ?? null,
      now,
    );
    run(db, `UPDATE matches SET last_message_at = ? WHERE id = ?`, now, matchId);
    // Mark my own side read immediately; the other side stays unread until they open it.
    const column = match.user_a === user.id ? 'a_last_read_at' : 'b_last_read_at';
    run(db, `UPDATE matches SET ${column} = ? WHERE id = ?`, now, matchId);
    notify(db, otherId, 'message', { matchId, from: user.id, fromName: user.name, preview: text.slice(0, 80) }, now);
  });

  return { message: get(db, `SELECT * FROM messages WHERE id = ?`, messageId), idempotent: false };
}

export function listMessages(db, matchId, userId, options = {}) {
  const match = findMatchById(db, matchId);
  if (!match) throw new DomainError('match_not_found', 'That conversation does not exist.', 404);
  if (!isParticipant(match, userId)) throw new DomainError('not_a_participant', 'You are not part of that match.', 403);
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 200);
  const before = options.before ? String(options.before) : null;
  const rows = all(
    db,
    `SELECT * FROM messages WHERE match_id = ? ${before ? 'AND created_at < ?' : ''}
      ORDER BY created_at DESC LIMIT ?`,
    ...(before ? [matchId, before, limit] : [matchId, limit]),
  );
  return rows
    .map((row) => ({
      id: row.id,
      sender: row.sender_id === userId ? 'me' : 'them',
      senderId: row.sender_id,
      body: row.body,
      createdAt: row.created_at,
      readAt: row.read_at,
    }))
    .reverse();
}

export function markThreadRead(db, matchId, userId, now = nowIso()) {
  const match = findMatchById(db, matchId);
  if (!match) throw new DomainError('match_not_found', 'That conversation does not exist.', 404);
  if (!isParticipant(match, userId)) throw new DomainError('not_a_participant', 'You are not part of that match.', 403);
  const column = match.user_a === userId ? 'a_last_read_at' : 'b_last_read_at';
  const now2 = now;
  run(db, `UPDATE matches SET ${column} = ? WHERE id = ?`, now2, matchId);
  run(
    db,
    `UPDATE messages SET read_at = ? WHERE match_id = ? AND sender_id <> ? AND read_at IS NULL`,
    now2,
    matchId,
    userId,
  );
  return { read: true };
}

/** "Who likes you": the count is always exact; the list is a premium view. */
export function likesYou(db, user, options = {}) {
  const rows = all(
    db,
    `SELECT l.from_user, l.created_at, u.name, u.city, u.birth_date, u.gender, u.headline, u.photo_ids, u.verified
       FROM likes l JOIN users u ON u.id = l.from_user
      WHERE l.to_user = ? AND u.banned = 0
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = l.from_user) OR (b.blocker_id = l.from_user AND b.blocked_id = ?))
      ORDER BY l.created_at DESC`,
    user.id,
    user.id,
    user.id,
  );
  const canSee = user.tier === 'plus' || user.tier === 'gold' || options.reveal === true;
  return {
    count: rows.length,
    visible: canSee,
    // Even when hidden we return *who* liked you to the server; the API layer decides what to send.
    people: rows.map((row) => ({
      id: row.from_user,
      name: row.name,
      city: row.city,
      headline: row.headline,
      verified: Boolean(row.verified),
      photoIds: parseJson(row.photo_ids, []),
      likedAt: row.created_at,
    })),
    hint: canSee ? null : 'ZimDate Plus shows you everyone who liked you.',
  };
}

/** Boost: 30 minutes of stack priority, paid in coins or from a purchased bundle. */
export const BOOST = Object.freeze({ minutes: 30, cost: 20 });

export function activeBoost(db, userId, now = nowIso()) {
  const row = get(
    db,
    `SELECT * FROM boosts WHERE user_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`,
    userId,
    now,
  );
  return row ?? null;
}

export function startBoost(db, user, now = nowIso()) {
  const existing = activeBoost(db, user.id, now);
  if (existing) throw new DomainError('boost_active', 'A boost is already running.', 409, { expiresAt: existing.expires_at });
  if (user.boosts_left > 0) {
    run(db, `UPDATE users SET boosts_left = boosts_left - 1 WHERE id = ?`, user.id);
  } else if (user.coins >= BOOST.cost) {
    run(db, `UPDATE users SET coins = coins - ? WHERE id = ?`, BOOST.cost, user.id);
  } else {
    throw new DomainError('insufficient_coins', `A boost costs ${BOOST.cost} ZimCoins.`, 402);
  }
  const expiresAt = addMs(now, BOOST.minutes * 60_000);
  run(db, `INSERT INTO boosts (user_id, activated_at, expires_at) VALUES (?, ?, ?)`, user.id, now, expiresAt);
  notify(db, user.id, 'boost', { expiresAt }, now);
  return { started: true, expiresAt };
}

/**
 * A boost used to be sold and never applied. It is now a ranking input
 * (`RANK_WEIGHTS.boost` in discovery.js, driven by the `boosts` table), so there is no
 * multiplier to return here — the visibility lift is the product, applied to everyone else's
 * view of you rather than to your own numbers.
 */

/** Tier changes are simulated locally; there is no payment processor in this build. */
export const TIERS = Object.freeze({
  free: { id: 'free', name: 'ZimDate Free', priceUsd: 0, likes: 25, seeLikes: false, readReceipts: false },
  plus: { id: 'plus', name: 'ZimDate Plus', priceUsd: 9, likes: 100, seeLikes: true, readReceipts: true },
  gold: { id: 'gold', name: 'ZimDate Gold', priceUsd: 19, likes: null, seeLikes: true, readReceipts: true },
});

export function setTier(db, userId, tier, now = nowIso()) {
  if (!TIERS[tier]) throw new DomainError('invalid_tier', 'Unknown plan.', 400);
  const until = tier === 'free' ? null : addDays(now, 30);
  run(db, `UPDATE users SET tier = ?, tier_until = ? WHERE id = ?`, tier, until, userId);
  return { tier, until };
}

export function expireSubscriptions(db, now = nowIso()) {
  const result = run(
    db,
    `UPDATE users SET tier = 'free', tier_until = NULL WHERE tier <> 'free' AND tier_until IS NOT NULL AND tier_until < ?`,
    now,
  );
  return { expired: result.changes };
}

export function purgeExpiredSessions(db, now = nowIso()) {
  const result = run(db, `DELETE FROM sessions WHERE expires_at < ?`, now);
  return { purged: result.changes };
}

export { isPast };
