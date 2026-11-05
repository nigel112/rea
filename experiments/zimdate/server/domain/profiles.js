/**
 * Profile reads and writes: the shape every other module agrees to render.
 *
 * Two projections exist on purpose:
 *   `publicProfile`  — what a stranger or a match may see (respects privacy flags)
 *   `selfProfile`    — what the owner sees (includes counters, quota, moderation state)
 * Mixing them is how private answers leak, so the split is enforced by distinct functions rather
 * than a `includePrivate` boolean.
 */
import { all, get, parseJson, run, toJson } from '../db/index.js';
import { hydrateUser, ageOf, profileCompleteness } from './eligibility.js';
import { id } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';

const PUBLIC_COLUMNS = `
  id, name, birth_date, gender, looking_for, intent, headline, bio, city, suburb, lat, lon,
  height_cm, education, occupation, religion, languages, drinks, smokes, cannabis, kids, pets,
  interests, prompts, photo_ids, verified, tier, last_active_at, created_at, banned
`;

export function findUserById(db, userId) {
  const row = get(db, `SELECT * FROM users WHERE id = ?`, userId);
  return hydrateUser(row);
}

export function findUserByEmail(db, email) {
  const row = get(db, `SELECT * FROM users WHERE email = ?`, String(email ?? '').toLowerCase());
  return hydrateUser(row);
}

export function listPhotos(db, userId) {
  return all(
    db,
    `SELECT id, position, mime, created_at FROM photos WHERE user_id = ? ORDER BY position ASC`,
    userId,
  );
}

/**
 * The public shape. Never includes email, password hash, quota counters, or admin flags.
 * `privacy` says *why* something is missing so the UI never shows a broken field.
 */
export function publicProfile(db, user, context = {}) {
  if (!user) return null;
  const now = context.now ?? nowIso();
  const photos = context.photos ?? listPhotos(db, user.id);
  const privacy = {};

  const showAnswerCount = true; // counts are always public; the answers themselves are not

  return {
    id: user.id,
    name: user.name,
    age: ageOf(user, now),
    gender: user.gender,
    intent: user.intent,
    headline: user.headline,
    bio: user.bio,
    city: user.city,
    suburb: user.suburb,
    heightCm: user.height_cm,
    education: user.education,
    occupation: user.occupation,
    religion: user.religion,
    languages: user.languages,
    drinks: user.drinks,
    smokes: user.smokes,
    cannabis: user.cannabis,
    kids: user.kids,
    pets: user.pets,
    interests: user.interests,
    prompts: user.prompts,
    verified: user.verified,
    photos: photos.map((photo) => ({
      id: photo.id,
      url: `/api/photos/${photo.id}`,
      position: photo.position,
    })),
    completeness: Math.round(profileCompleteness(user) * 100),
    lastActive: user.last_active_at,
    joined: user.created_at,
    answerCount: context.answerCount ?? 0,
    privacy,
    showAnswerCount,
  };
}

export function selfProfile(db, user, context = {}) {
  if (!user) return null;
  const base = publicProfile(db, user, context);
  return {
    ...base,
    email: user.email,
    tier: user.tier,
    tierUntil: user.tier_until,
    coins: user.coins,
    boostsLeft: user.boosts_left,
    interestsFilter: { minAge: user.min_age, maxAge: user.max_age, maxDistanceKm: user.max_distance_km },
    lookingFor: user.lookingFor,
    isAdmin: user.isAdmin,
    quota: context.quota ?? null,
  };
}

/** Fields a user may edit with PATCH /api/me. Anything else is rejected by the router. */
export const EDITABLE_FIELDS = Object.freeze({
  name: 'name',
  headline: 'headline',
  bio: 'bio',
  city: 'city',
  suburb: 'suburb',
  height_cm: 'height_cm',
  heightCm: 'height_cm',
  education: 'education',
  occupation: 'occupation',
  religion: 'religion',
  languages: 'languages',
  drinks: 'drinks',
  smokes: 'smokes',
  cannabis: 'cannabis',
  kids: 'kids',
  pets: 'pets',
  interests: 'interests',
  prompts: 'prompts',
  intent: 'intent',
  lookingFor: 'looking_for',
  minAge: 'min_age',
  maxAge: 'max_age',
  maxDistanceKm: 'max_distance_km',
});

const JSON_FIELDS = new Set(['languages', 'interests', 'prompts', 'looking_for']);

export function updateUser(db, userId, patch, options = {}) {
  const assignments = [];
  const params = [];
  const rejected = [];

  for (const [key, value] of Object.entries(patch ?? {})) {
    const column = EDITABLE_FIELDS[key];
    if (!column) {
      rejected.push(key);
      continue;
    }
    assignments.push(`${column} = ?`);
    params.push(JSON_FIELDS.has(column) ? toJson(value) : value);
  }

  if (assignments.length > 0) {
    params.push(userId);
    run(db, `UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, ...params);
  }
  return { updated: assignments.length, rejected };
}

export function touchActivity(db, userId, now = nowIso()) {
  run(db, `UPDATE users SET last_active_at = ? WHERE id = ?`, now, userId);
}

/** Admin/moderator action: ban or unban, always logged. */
export function setBanned(db, userId, banned, actorId, notes = '') {
  run(db, `UPDATE users SET banned = ? WHERE id = ?`, banned ? 1 : 0, userId);
  run(
    db,
    `INSERT INTO moderation_log (id, actor_id, target_type, target_id, action, notes, created_at)
     VALUES (?, ?, 'user', ?, ?, ?, ?)`,
    id('mod'),
    actorId,
    userId,
    banned ? 'ban' : 'unban',
    notes,
    nowIso(),
  );
}

export function deleteUser(db, userId) {
  // Cascades remove photos, answers, likes, matches, messages, reports, notifications.
  run(db, `DELETE FROM users WHERE id = ?`, userId);
}

export function answerCount(db, userId) {
  const row = get(db, `SELECT COUNT(*) AS count FROM answers WHERE user_id = ?`, userId);
  return row?.count ?? 0;
}

export function publicAnswers(db, subjectId, viewerId, questionsById) {
  const rows = all(
    db,
    `SELECT question_id, answer, accept, importance, explanation, visibility, updated_at
       FROM answers WHERE user_id = ? ORDER BY updated_at DESC`,
    subjectId,
  );
  return rows.map((row) => {
    const question = questionsById.get(row.question_id);
    const isSelf = subjectId === viewerId;
    const accepted = parseJson(row.accept, []);
    return {
      questionId: row.question_id,
      text: question?.text ?? 'Retired question',
      category: question?.category ?? 'other',
      options: question?.options ?? [],
      answer: row.answer,
      // A partner's acceptable-answers list is exactly what makes the score auditable, so it is
      // public; explanations and private answers are not.
      accept: row.visibility === 'private' && !isSelf ? [] : accepted,
      importance: row.importance,
      explanation: row.visibility === 'private' && !isSelf ? '' : row.explanation,
      visibility: row.visibility,
      updatedAt: row.updated_at,
    };
  });
}
