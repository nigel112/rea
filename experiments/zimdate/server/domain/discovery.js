/**
 * Discovery: the scored candidate pool, its ranking, and the two surfaces built on it.
 *
 * Ranking is deliberately explainable (dossier §5.1). Every card returns the components of its own
 * rank score, so the UI can show "why you are seeing this person" and tests can assert on the
 * arithmetic instead of on a magic number.
 */
import { all, get, parseJson } from '../db/index.js';
import { scorePair, indexAnswers, CONFIDENCE_TARGET } from '../lib/compat.js';
import { nowIso, daysBetween } from '../lib/time.js';
import {
  eligibility,
  hydrateUser,
  ageOf,
  profileCompleteness,
  interestOverlap,
  recencyScore,
  newcomerBoost,
} from './eligibility.js';
import { publicProfile } from './profiles.js';

/** Weights are exported so the UI and the docs cannot drift from the code. */
export const RANK_WEIGHTS = Object.freeze({
  // The match weight is additionally scaled by `scoreTrust()` — the percentage counts in
  // proportion to how many answers back it.
  match: 0.7,
  recency: 0.15,
  completeness: 0.1,
  interests: 0.05,
  boost: 0.15,
});

/** Hard caps that protect both the server and the user's attention. */
export const POOL_LIMIT = 400;

function loadAnswersByUser(db, userIds) {
  if (userIds.length === 0) return new Map();
  const placeholders = userIds.map(() => '?').join(',');
  const rows = all(
    db,
    `SELECT user_id, question_id, answer, accept, importance, visibility
       FROM answers WHERE user_id IN (${placeholders})`,
    ...userIds,
  );
  /** @type {Map<string, {question_id: string, answer: string, accept: string[], importance: string, visibility: string}[]>} */
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.user_id) ?? [];
    list.push({ ...row, accept: parseJson(row.accept, []) });
    grouped.set(row.user_id, list);
  }
  return grouped;
}

function loadBlockSets(db, viewerId) {
  const outbound = new Set(
    all(db, `SELECT blocked_id FROM blocks WHERE blocker_id = ?`, viewerId).map((row) => row.blocked_id),
  );
  const inbound = new Set(
    all(db, `SELECT blocker_id FROM blocks WHERE blocked_id = ?`, viewerId).map((row) => row.blocker_id),
  );
  return { blockedIds: outbound, blockedByIds: inbound };
}

/**
 * Build the scored pool for a viewer.
 *
 * Returns candidates sorted by rank, each with the score result, the rank components, and the
 * eligibility verdict. Excluded users are counted by reason so the UI can say "12 people were
 * filtered out by your age range" instead of showing an empty screen.
 */
export function buildPool(db, viewer, options = {}) {
  const now = options.now ?? nowIso();
  const questions = options.questions ?? new Map();
  const viewerAnswers = options.viewerAnswers ?? indexAnswers(
    all(db, `SELECT question_id, answer, accept, importance, visibility FROM answers WHERE user_id = ?`, viewer.id)
      .map((row) => ({ ...row, accept: parseJson(row.accept, []) })),
  );

  const rows = all(
    db,
    `SELECT * FROM users WHERE id <> ? AND banned = 0 ORDER BY last_active_at DESC LIMIT ?`,
    viewer.id,
    POOL_LIMIT,
  );
  const candidates = rows.map(hydrateUser);
  const blocked = loadBlockSets(db, viewer.id);
  const answerMap = loadAnswersByUser(db, candidates.map((candidate) => candidate.id));
  const photoRows = all(
    db,
    `SELECT id, user_id, position FROM photos ORDER BY user_id, position`,
  );
  const photosByUser = new Map();
  for (const photo of photoRows) {
    const list = photosByUser.get(photo.user_id) ?? [];
    list.push({ id: photo.id, position: photo.position });
    photosByUser.set(photo.user_id, list);
  }
  const likeRows = all(db, `SELECT from_user, to_user FROM likes`);
  const likedByViewer = new Set();
  const likedViewer = new Set();
  for (const like of likeRows) {
    if (like.from_user === viewer.id) likedByViewer.add(like.to_user);
    if (like.to_user === viewer.id) likedViewer.add(like.from_user);
  }
  const matchRows = all(
    db,
    `SELECT user_a, user_b, closed_at FROM matches WHERE user_a = ? OR user_b = ?`,
    viewer.id,
    viewer.id,
  );
  const matchedWith = new Map();
  for (const match of matchRows) {
    const other = match.user_a === viewer.id ? match.user_b : match.user_a;
    matchedWith.set(other, match.closed_at);
  }

  // Active boosts, read in one query rather than per candidate.
  const boostedIds = new Set(
    all(db, `SELECT user_id FROM boosts WHERE expires_at > ?`, now).map((row) => row.user_id),
  );

  const excluded = {};
  const pooled = [];

  for (const candidate of candidates) {
    const verdict = eligibility(viewer, candidate, { ...blocked, now });
    if (!verdict.ok) {
      excluded[verdict.reason] = (excluded[verdict.reason] ?? 0) + 1;
      continue;
    }

    const candidateAnswers = indexAnswers(answerMap.get(candidate.id) ?? []);
    const score = scorePair(viewerAnswers, candidateAnswers, { questions });
    const components = rankComponents(viewer, candidate, score, now, { boosted: boostedIds.has(candidate.id) });
    pooled.push({
      user: candidate,
      score,
      components,
      photos: photosByUser.get(candidate.id) ?? [],
      likedByViewer: likedByViewer.has(candidate.id),
      likesViewer: likedViewer.has(candidate.id),
      matchId: matchedWith.get(candidate.id) ?? null,
      distanceKm: verdict.distanceKm,
      age: verdict.candidateAge,
    });
  }

  pooled.sort((left, right) => right.components.total - left.components.total);
  return { pool: pooled, excluded, viewerAnswers, now };
}

/**
 * How much to trust a match number given how little data produced it.
 *
 * An 86.6% built from 5 shared answers is not comparable to a 64.4% built from 36, yet a naive
 * ranker treats the first as far better and puts it at the top of the stack. That is the
 * confident-sounding-number-from-no-data failure the confidence badge warns about — so the ranker
 * has to apply the same reasoning, or the badge is decoration on a lie.
 *
 * Full credit at CONFIDENCE_TARGET shared answers, then a floor: somebody you agree with on 5
 * questions is still worth showing, just not above someone you have 36 answers of evidence for.
 *
 * @param {number} shared
 * @returns {number} 0.35 … 1
 */
export function scoreTrust(shared) {
  if (!Number.isFinite(shared) || shared <= 0) return 0.35;
  return Math.max(0.35, Math.min(1, 0.35 + 0.65 * Math.min(shared, CONFIDENCE_TARGET) / CONFIDENCE_TARGET));
}

export function rankComponents(viewer, candidate, score, now, options = {}) {
  // The match term is discounted by how much evidence backs it.
  const match = score.ok ? (score.match / 100) * scoreTrust(score.shared) : 0;
  const recency = recencyScore(candidate.last_active_at, now);
  const completeness = profileCompleteness(candidate);
  const interests = interestOverlap(viewer.interests, candidate.interests);
  const newcomer = newcomerBoost(candidate.created_at, now);
  // A paid boost is a *visibility* product: it lifts you in other people's queues. It must never
  // touch the match percentage, because the match number is a claim about compatibility and
  // buying placement must not falsify it.
  const boosted = options.boosted === true;

  const total =
    RANK_WEIGHTS.match * match +
    RANK_WEIGHTS.recency * recency +
    RANK_WEIGHTS.completeness * completeness +
    RANK_WEIGHTS.interests * interests +
    // The cold-start floor is additive but small: it can lift a new profile above a stale one,
    // never above a genuinely better match.
    0.02 * newcomer +
    // Boost: equivalent weight to recency, so it matters but cannot outrank a much better match.
    (boosted ? RANK_WEIGHTS.boost : 0);

  return {
    total: round(total),
    match: round(match),
    recency: round(recency),
    completeness: round(completeness),
    interests: round(interests),
    newcomer,
    boosted,
    weights: RANK_WEIGHTS,
    // Human-readable reasons, ordered by contribution. This is the "why am I seeing this" line.
    reasons: reasonsFor({ match, recency, completeness, interests, score, boosted }),
  };
}

function reasonsFor({ match, recency, completeness, interests, score, boosted }) {
  const reasons = [];
  if (boosted) reasons.push('Boosted right now');
  if (score.ok && score.match >= 60) reasons.push(`${score.match}% match`);
  else if (!score.ok) reasons.push('Answer more questions to compare');
  if (recency > 0.8) reasons.push('Active recently');
  if (completeness >= 0.8) reasons.push('Complete profile');
  if (interests >= 0.25) reasons.push('Shared interests');
  return reasons.slice(0, 3);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/** A card: public profile + score + action state. Never the raw user row. */
export function toCard(db, entry, viewer, context = {}) {
  const profile = publicProfile(db, entry.user, {
    now: context.now,
    photos: entry.photos,
    answerCount: context.answerCounts?.get(entry.user.id) ?? 0,
  });
  return {
    profile: { ...profile, age: entry.age, distanceKm: entry.distanceKm },
    match: entry.score.ok ? entry.score.match : null,
    friend: entry.score.ok ? entry.score.friend : null,
    enemy: entry.score.ok ? entry.score.enemy : null,
    shared: entry.score.ok ? entry.score.shared : 0,
    confidence: entry.score.ok ? entry.score.confidence : 'none',
    basis: entry.score.ok ? entry.score.basis : 'none',
    scoreNote: entry.score.ok
      ? `${entry.score.shared} shared answer${entry.score.shared === 1 ? '' : 's'} · ${entry.score.confidence} confidence`
      : 'No overlap yet — answer more questions to compare',
    rank: entry.components,
    likedByViewer: entry.likedByViewer,
    likesViewer: entry.likesViewer,
    matched: Boolean(entry.matchId),
    matchId: entry.matchId,
    why: entry.components.reasons,
  };
}

/**
 * DoubleTake stack: unseen, unliked, unpassed profiles, one at a time.
 * Seen-but-ignored candidates are demoted rather than removed (dossier §5.1).
 */
export function buildStack(db, viewer, options = {}) {
  const { pool, excluded, now } = buildPool(db, viewer, options);
  const passed = new Set(
    all(db, `SELECT to_user FROM passes WHERE from_user = ?`, viewer.id).map((row) => row.to_user),
  );
  const fresh = [];
  const seen = [];
  for (const entry of pool) {
    if (passed.has(entry.user.id) || entry.likedByViewer || entry.matchId) continue;
    if (daysBetween(entry.user.last_active_at, now) > 90) {
      seen.push(entry); // stale accounts are available but never lead the stack
      continue;
    }
    fresh.push(entry);
  }
  const ordered = [...fresh, ...seen];
  return {
    stack: ordered,
    excluded,
    total: ordered.length,
  };
}

/**
 * Discover grid: paginated, filterable, and explicitly sorted by the same rank key.
 * Filters are applied *after* scoring so the returned counts stay meaningful.
 */
export function buildGrid(db, viewer, filters = {}, options = {}) {
  const { pool, excluded, now } = buildPool(db, viewer, options);
  const minAge = numberOr(filters.minAge, 18);
  const maxAge = numberOr(filters.maxAge, 99);
  const maxDistance = numberOr(filters.maxDistance, null);
  const onlineOnly = filters.onlineOnly === true || filters.onlineOnly === 'true';
  const hasPhoto = filters.hasPhoto === true || filters.hasPhoto === 'true';
  const intent = typeof filters.intent === 'string' && filters.intent ? filters.intent : null;
  const verifiedOnly = filters.verifiedOnly === true || filters.verifiedOnly === 'true';
  const minMatch = numberOr(filters.minMatch, null);

  const filtered = pool.filter((entry) => {
    if (entry.age < minAge || entry.age > maxAge) return false;
    if (maxDistance !== null && entry.distanceKm > maxDistance) return false;
    if (onlineOnly && daysBetween(entry.user.last_active_at, now) > 1 / 24) return false;
    if (hasPhoto && entry.photos.length === 0) return false;
    if (verifiedOnly && !entry.user.verified) return false;
    if (intent && entry.user.intent !== intent) return false;
    if (minMatch !== null && (!entry.score.ok || entry.score.match < minMatch)) return false;
    return true;
  });

  const pageSize = Math.min(Math.max(numberOr(filters.pageSize, 24), 1), 60);
  const page = Math.max(numberOr(filters.page, 0), 0);
  const slice = filtered.slice(page * pageSize, page * pageSize + pageSize);
  return {
    entries: slice,
    total: filtered.length,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    excluded,
  };
}

function numberOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Admin telemetry: the health of the pool, not of individual users. */
export function poolStats(db, viewer, options = {}) {
  const { pool, excluded } = buildPool(db, viewer, options);
  const scored = pool.filter((entry) => entry.score.ok);
  const avgMatch = scored.length
    ? Math.round((scored.reduce((sum, entry) => sum + entry.score.match, 0) / scored.length) * 10) / 10
    : null;
  const buckets = { '0-39': 0, '40-59': 0, '60-79': 0, '80-100': 0, unscored: 0 };
  for (const entry of pool) {
    if (!entry.score.ok) {
      buckets.unscored += 1;
      continue;
    }
    const value = entry.score.match;
    if (value < 40) buckets['0-39'] += 1;
    else if (value < 60) buckets['40-59'] += 1;
    else if (value < 80) buckets['60-79'] += 1;
    else buckets['80-100'] += 1;
  }
  return {
    poolSize: pool.length,
    scoredSize: scored.length,
    avgMatch,
    buckets,
    excluded,
    confidenceTarget: CONFIDENCE_TARGET,
  };
}

/** Small helper used by tests and the seed reconciler. */
export function answerIndexFor(db, userId) {
  const rows = all(db, `SELECT question_id, answer, accept, importance FROM answers WHERE user_id = ?`, userId);
  return indexAnswers(rows.map((row) => ({ ...row, accept: parseJson(row.accept, []) })));
}

export function getAnswerRows(db, userId) {
  return all(db, `SELECT question_id, answer, accept, importance, visibility FROM answers WHERE user_id = ?`, userId)
    .map((row) => ({ ...row, accept: parseJson(row.accept, []) }));
}

export function countUnreadLikes(db, userId) {
  const row = get(db, `SELECT COUNT(*) AS count FROM likes WHERE to_user = ? AND seen = 0`, userId);
  return row?.count ?? 0;
}
