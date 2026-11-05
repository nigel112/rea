/**
 * ZimDate HTTP API.
 *
 * Route table is data, not a chain of ifs, so `/api/meta` can describe the API to the client and the
 * selftest can enumerate it. Every handler receives a context object and returns a payload; errors
 * are thrown as HttpError/DomainError and rendered once, in one place.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HttpError,
  sendJson,
  sendError,
  readJsonBody,
  serveStatic,
  SECURITY_HEADERS,
  mimeFor,
  safeJoin,
  clientIp,
  isSecureRequest,
} from './http.js';
import { all, get, run, parseJson, toJson, transaction } from './db/index.js';
import {
  IMPORTANCE_LEVELS,
  describeScore,
  indexAnswers,
  scorePair,
  CONFIDENCE_TARGET,
} from './lib/compat.js';
import { id } from './lib/ids.js';
import { matchPattern, matchRoute } from './routing.js';
import { normaliseLookingFor, questionIndexMap, validateAnswer, validateSignup } from './domain/validation.js';
import { nowIso, addDays } from './lib/time.js';
import { QUESTIONS, QUESTIONS_BY_ID, CATEGORIES } from './seed/questions.js';
import { CITIES, ANYWHERE_KM, INTENTS, GENDERS, ageOf, eligibility } from './domain/eligibility.js';
import {
  findUserById,
  findUserByEmail,
  publicProfile,
  selfProfile,
  updateUser,
  publicAnswers,
  answerCount,
  listPhotos,
} from './domain/profiles.js';
import {
  RANK_WEIGHTS,
  buildGrid,
  buildStack,
  toCard,
  poolStats,
  getAnswerRows,
  countUnreadLikes,
} from './domain/discovery.js';
import * as social from './domain/social.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  sessionFromToken,
  destroySession,
  readCookie,
  sessionCookie,
  clearCookie,
  SESSION_COOKIE,
  CSRF_HEADER,
  signupLimiter,
  loginLockoutFor,
  resetLoginLockout,
  requireAdmin,
  auditAdmin,
  recentAudit,
  destroyAllSessions,
} from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_AGE = 18;

/* ------------------------------------------------------------------ helpers */

/* ---------------------------------------------------------- session plumbing */

function sessionUser(ctx) {
  if (!ctx.session) return null;
  const user = findUserById(ctx.db, ctx.session.user_id);
  if (!user || user.banned) return null;
  return user;
}

function requireUser(ctx) {
  const user = sessionUser(ctx);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  return user;
}

/** Answer rows store `accept` as JSON; every reader wants the array. */
function hydrateAnswerRow(row) {
  return { ...row, accept: parseJson(row.accept, []) };
}

/* ------------------------------------------------------------------- routes */

/* ------------------------------------------------------------------- server */

export function createZimDateServer(options = {}) {
  const db = options.db;
  // Header policy is per-server, not module-global: the default is strict (`frame-ancestors 'self'`),
  // and a launcher that needs to be embedded cross-origin opts in explicitly.
  const securityHeaders = options.securityHeaders ?? SECURITY_HEADERS;
  const questions = QUESTIONS_BY_ID;
  /**
   * Route definition: [method, pattern, handler, options]
   * `pattern` supports `:param` segments. `options.public` skips the session requirement.
   */
  function buildRoutes() {
    return [
      ['GET', '/api/health', health, { public: true }],
      ['GET', '/api/meta', meta, { public: true }],
      ['POST', '/api/auth/signup', signup, { public: true }],
      ['POST', '/api/auth/login', login, { public: true }],
      ['POST', '/api/auth/logout', logout, { public: true }],
      ['GET', '/api/auth/me', me, { public: true }],

      ['GET', '/api/questions', listQuestions, { public: true }],
      ['GET', '/api/answers', listMyAnswers],
      ['POST', '/api/answers', saveAnswer],
      ['DELETE', '/api/answers/:questionId', deleteAnswer],

      ['GET', '/api/stack', stack],
      ['GET', '/api/discover', discover],
      ['GET', '/api/likes-you', likesYou],
      ['POST', '/api/likes/:userId', likeUser],
      ['POST', '/api/passes/:userId', passUser],
      ['DELETE', '/api/passes/:userId', undoPassUser],

      ['GET', '/api/matches', matches],
      ['GET', '/api/matches/:matchId', matchDetail],
      ['GET', '/api/matches/:matchId/messages', messages],
      ['POST', '/api/matches/:matchId/messages', sendMessage],
      ['POST', '/api/matches/:matchId/read', markRead],
      ['POST', '/api/matches/:matchId/unmatch', unmatch],

      ['GET', '/api/profile/:userId', profile],
      ['GET', '/api/score/:userId', score],
      ['GET', '/api/photos/:photoId', photo, { public: true }],

      ['PATCH', '/api/me', updateMe],
      ['POST', '/api/me/verify', verifyMe],
      ['POST', '/api/me/photos', uploadPhoto],
      ['DELETE', '/api/me/photos/:photoId', deletePhoto],
      ['GET', '/api/me/views', whoViewedMe],

      ['POST', '/api/block/:userId', blockUser],
      ['DELETE', '/api/block/:userId', unblockUser],
      ['POST', '/api/report/:userId', reportUser],

      ['GET', '/api/notifications', notifications],
      ['POST', '/api/notifications/read', readNotifications],

      ['POST', '/api/boost', boost],
      ['GET', '/api/boost', boostStatus],
      ['POST', '/api/billing/checkout', checkout],

      ['GET', '/api/admin/stats', adminStats],
      ['GET', '/api/admin/reports', adminReports],
      ['POST', '/api/admin/reports/:reportId', adminResolveReport],
      ['POST', '/api/admin/users/:userId/ban', adminBan],
      ['GET', '/api/admin/audit', adminAudit],
    ];
  }

  const routes = buildRoutes();
  const startedAt = nowIso();
  const counters = { requests: 0, errors: 0, signups: 0, likes: 0, messages: 0 };

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    counters.requests += 1;

    // API
    if (pathname.startsWith('/api/')) {
      const method = req.method ?? 'GET';
      const match = matchRoute(routes, method, pathname);
      if (!match) {
        if (isKnownPath(pathname)) return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Wrong method for this endpoint.' } }, {}, securityHeaders);
        return sendJson(res, 404, { error: { code: 'not_found', message: 'No such endpoint.' } }, {}, securityHeaders);
      }
      return handleRoute({ req, res, url, pathname, match, method });
    }

    // Static
    if (req.method === 'GET' || req.method === 'HEAD') {
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const full = safeJoin(PUBLIC_DIR, relative);
      if (full) {
        const served = await serveStatic(res, full, mimeFor(relative), req, { headers: securityHeaders });
        if (served) return;
      }
      // SPA fallback: unknown non-API paths render the app shell, which routes client-side.
      if (!relative.includes('.')) {
        const shell = safeJoin(PUBLIC_DIR, 'index.html');
        if (shell && (await serveStatic(res, shell, 'text/html; charset=utf-8', req, { cacheControl: 'no-cache', headers: securityHeaders }))) return;
      }
    }
    return sendJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } }, {}, securityHeaders);
  }

  function isKnownPath(pathname) {
    return routes.some(([, pattern]) => matchPattern(pattern, pathname));
  }

  async function handleRoute({ req, res, url, match, method }) {
    const ctx = {
      req,
      res,
      url,
      db,
      params: match.params,
      method,
      now: nowIso(),
      ip: clientIp(req),
      secure: isSecureRequest(req),
      session: null,
      user: null,
      body: null,
    };

    try {
      // --- session
      const cookieToken = readCookie(req.headers.cookie, SESSION_COOKIE);
      const authHeader = req.headers.authorization;
      const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const token = bearer ?? cookieToken;
      ctx.session = sessionFromToken(db, token, ctx.now);
      ctx.usingBearer = Boolean(bearer) && Boolean(ctx.session);

      if (!match.options?.public) {
        ctx.user = requireUser(ctx);
        // CSRF: cookie-authenticated mutations need the double-submit header.
        if (method !== 'GET' && method !== 'HEAD' && !ctx.usingBearer) {
          const provided = req.headers[CSRF_HEADER];
          if (!provided || provided !== ctx.session.csrf_token) {
            throw new HttpError(403, 'csrf_failed', 'Refresh the page and try again.');
          }
        }
      } else {
        ctx.user = sessionUser(ctx);
      }

      // --- body
      if (method !== 'GET' && method !== 'HEAD') {
        ctx.body = await readJsonBody(req);
      }

      const payload = await match.handler(ctx);
      if (res.headersSent) return;
      if (payload === undefined) return sendJson(res, 204, {}, {}, securityHeaders);
      const status = payload?.__status ?? 200;
      // A handler may set its own response headers (e.g. Set-Cookie), separate from the policy.
      const extraHeaders = payload?.__headers ?? {};
      const body = payload?.__body ?? payload;
      return sendJson(res, status, body, extraHeaders, securityHeaders);
    } catch (error) {
      counters.errors += 1;
      if (error instanceof social.DomainError) {
        return sendError(res, new HttpError(error.status, error.code, error.message, error.extra), securityHeaders);
      }
      return sendError(res, error, securityHeaders);
    }
  }

  /** Attach the session cookie for handlers that create/destroy sessions. */
  function withSessionCookie(payload, token, ctx) {
    return {
      ...payload,
      __headers: { 'Set-Cookie': sessionCookie(token, { secure: ctx.secure }) },
    };
  }

  /* ------------------------------------------------------------- handlers */

  function health() {
    const row = get(db, `SELECT COUNT(*) AS users FROM users`);
    return {
      ok: true,
      service: 'zimdate',
      version: '1.0.0',
      startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      users: row?.users ?? 0,
      counters,
    };
  }

  function meta() {
    return {
      name: 'ZimDate',
      tagline: 'Serious dating, built for Zimbabwe.',
      minAge: MIN_AGE,
      genders: GENDERS,
      intents: INTENTS,
      cities: Object.entries(CITIES).map(([name, point]) => ({ name, ...point })),
      categories: CATEGORIES,
      questions: QUESTIONS.map((question) => ({
        id: question.id,
        category: question.category,
        text: question.text,
        options: question.options,
        weightHint: question.weightHint,
      })),
      importanceLevels: IMPORTANCE_LEVELS,
      confidenceTarget: CONFIDENCE_TARGET,
      reportReasons: social.REPORT_REASONS,
      tiers: social.TIERS,
      boost: social.BOOST,
      dailyLikes: social.DAILY_LIKE_LIMIT,
      anywhereKm: ANYWHERE_KM,
      routes: buildRoutes().map(([method, pattern]) => `${method} ${pattern}`),
    };
  }

  async function signup(ctx) {
    const gate = signupLimiter.hit(ctx.ip);
    if (!gate.allowed) throw new HttpError(429, 'signup_rate_limited', 'Too many sign-ups from this connection. Try again later.');

    const { errors, value } = validateSignup(ctx.body ?? {}, ctx.now);
    if (Object.keys(errors).length > 0) {
      throw new HttpError(422, 'validation_failed', 'Please check the highlighted fields.', { fields: errors });
    }
    if (findUserByEmail(db, value.email)) {
      throw new HttpError(409, 'email_taken', 'That email already has a ZimDate account.');
    }
    if (value.intent && !INTENTS.includes(String(value.intent))) value.intent = 'long-term';

    const userId = id('usr');
    const passwordHash = hashPassword(value.password);
    transaction(db, () => {
      run(
        db,
        `INSERT INTO users (id, email, password_hash, name, birth_date, gender, looking_for, intent,
                            city, lat, lon, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        value.email,
        passwordHash,
        value.name,
        value.birthDate,
        value.gender,
        toJson(value.lookingFor),
        value.intent ?? 'long-term',
        value.city,
        CITIES[value.city].lat,
        CITIES[value.city].lon,
        ctx.now,
        ctx.now,
      );
      run(
        db,
        `INSERT INTO notifications (id, user_id, kind, payload, created_at) VALUES (?, ?, 'system', ?, ?)`,
        id('ntf'),
        userId,
        toJson({ title: 'Welcome to ZimDate', body: 'Answer 15 questions to unlock real match percentages.' }),
        ctx.now,
      );
    });
    counters.signups += 1;

    const user = findUserById(db, userId);
    const session = createSession(db, user, ctx.req.headers['user-agent'] ?? '', ctx.now);
    return withSessionCookie(
      {
        user: selfProfile(db, user, {
          now: ctx.now,
          quota: social.quotaSnapshot(db, user, ctx.now),
          answerCount: answerCount(db, user.id),
        }),
        csrf: session.csrf,
      },
      session.token,
      ctx,
    );
  }

  async function login(ctx) {
    const email = String(ctx.body?.email ?? '').trim().toLowerCase();
    const password = String(ctx.body?.password ?? '');
    const lock = loginLockoutFor(email, ctx.ip, ctx.now);
    if (!lock.allowed) {
      throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Wait a few minutes and try again.', {
        retryAfterMs: lock.retryAfterMs,
      });
    }
    const user = findUserByEmail(db, email);
    // Same error for unknown email and wrong password: do not build an account oracle.
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'invalid_credentials', 'That email and password do not match.');
    }
    if (user.banned) throw new HttpError(403, 'account_suspended', 'This account has been suspended.');

    resetLoginLockout(email, ctx.ip);
    run(db, `UPDATE users SET last_active_at = ? WHERE id = ?`, ctx.now, user.id);
    const session = createSession(db, user, ctx.req.headers['user-agent'] ?? '', ctx.now);
    const fresh = findUserById(db, user.id);
    return withSessionCookie(
      {
        user: selfProfile(db, fresh, {
          now: ctx.now,
          quota: social.quotaSnapshot(db, fresh, ctx.now),
          answerCount: answerCount(db, fresh.id),
        }),
        csrf: session.csrf,
      },
      session.token,
      ctx,
    );
  }

  function logout(ctx) {
    if (ctx.session) destroySession(db, readCookie(ctx.req.headers.cookie, SESSION_COOKIE) ?? '');
    return { ok: true, __headers: { 'Set-Cookie': clearCookie({ secure: ctx.secure }) } };
  }

  function me(ctx) {
    if (!ctx.user) return { user: null };
    const quota = social.quotaSnapshot(db, ctx.user, ctx.now);
    return {
      user: selfProfile(db, ctx.user, {
        now: ctx.now,
        quota,
        answerCount: answerCount(db, ctx.user.id),
      }),
      csrf: ctx.session?.csrf_token ?? null,
      unreadLikes: countUnreadLikes(db, ctx.user.id),
      unreadNotifications: get(db, `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL`, ctx.user.id)?.count ?? 0,
      unreadMessages: get(
        db,
        `SELECT COUNT(*) AS count FROM matches m
          JOIN messages msg ON msg.match_id = m.id
         WHERE (m.user_a = ? OR m.user_b = ?) AND m.closed_at IS NULL AND msg.sender_id <> ?
           AND (CASE WHEN m.user_a = ? THEN m.a_last_read_at ELSE m.b_last_read_at END IS NULL
                OR msg.created_at > (CASE WHEN m.user_a = ? THEN m.a_last_read_at ELSE m.b_last_read_at END))`,
        ctx.user.id, ctx.user.id, ctx.user.id, ctx.user.id, ctx.user.id,
      )?.count ?? 0,
    };
  }

  function listQuestions(ctx) {
    const answered = new Map();
    if (ctx.user) {
      for (const row of all(db, `SELECT * FROM answers WHERE user_id = ?`, ctx.user.id)) {
        answered.set(row.question_id, hydrateAnswerRow(row));
      }
    }
    const include = ctx.url.searchParams.get('include');
    const category = ctx.url.searchParams.get('category');
    const list = QUESTIONS.filter((question) => !category || question.category === category);
    return {
      categories: CATEGORIES,
      total: list.length,
      answeredCount: answered.size,
      questions: list.map((question) => ({
        ...question,
        answered: answered.has(question.id),
        mine: include === 'answers' || include === 'all' ? (answered.get(question.id) ?? null) : undefined,
      })),
    };
  }

  function listMyAnswers(ctx) {
    const user = ctx.user;
    const counts = get(db, `SELECT COUNT(*) AS total FROM answers WHERE user_id = ?`, user.id);
    const byImportance = all(
      db,
      `SELECT importance, COUNT(*) AS count FROM answers WHERE user_id = ? GROUP BY importance`,
      user.id,
    );
    return {
      total: counts?.total ?? 0,
      byImportance: Object.fromEntries(byImportance.map((row) => [row.importance, row.count])),
      answers: all(db, `SELECT * FROM answers WHERE user_id = ? ORDER BY updated_at DESC`, user.id).map(hydrateAnswerRow),
    };
  }

  function saveAnswer(ctx) {
    const user = ctx.user;
    const questionId = String(ctx.body?.questionId ?? '');
    const question = QUESTIONS_BY_ID.get(questionId);
    if (!question) throw new HttpError(404, 'question_not_found', 'That question does not exist.');
    const value = validateAnswer(question, ctx.body ?? {});
    const existing = get(db, `SELECT 1 AS ok FROM answers WHERE user_id = ? AND question_id = ?`, user.id, questionId);
    run(
      db,
      `INSERT INTO answers (user_id, question_id, answer, accept, importance, explanation, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, question_id) DO UPDATE SET
         answer = excluded.answer,
         accept = excluded.accept,
         importance = excluded.importance,
         explanation = excluded.explanation,
         visibility = excluded.visibility,
         updated_at = excluded.updated_at`,
      user.id,
      questionId,
      value.answer,
      toJson(value.accept),
      value.importance,
      value.explanation,
      value.visibility,
      ctx.now,
      ctx.now,
    );
    const total = answerCount(db, user.id);
    return {
      saved: true,
      wasUpdate: Boolean(existing),
      answeredCount: total,
      // Warn instead of blocking: rejecting your own answer is allowed, but it is usually a mistake
      // and it silently destroys your own side of the match score.
      warnings: value.accept.includes(value.answer) ? [] : ['You did not accept your own answer. That will lower every match you get on this question.'],
    };
  }

  function deleteAnswer(ctx) {
    const result = run(db, `DELETE FROM answers WHERE user_id = ? AND question_id = ?`, ctx.user.id, ctx.params.questionId);
    if (result.changes === 0) throw new HttpError(404, 'answer_not_found', 'You have not answered that question.');
    return { deleted: true, answeredCount: answerCount(db, ctx.user.id) };
  }

  function viewerAnswerIndex(ctx) {
    return indexAnswers(getAnswerRows(db, ctx.user.id));
  }

  function cardContext(ctx) {
    return { now: ctx.now, questions: questionIndexMap(), viewerAnswers: viewerAnswerIndex(ctx) };
  }

  function stack(ctx) {
    const built = buildStack(db, ctx.user, cardContext(ctx));
    const answerCounts = countsByUser(db, built.stack.map((entry) => entry.user.id));
    const limit = Math.min(Math.max(Number(ctx.url.searchParams.get('limit')) || 20, 1), 50);
    const viewerAnswers = cardContext(ctx).viewerAnswers;
    const blocked = new Set([
      ...all(db, `SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?`, ctx.user.id).map((row) => row.id),
      ...all(db, `SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?`, ctx.user.id).map((row) => row.id),
    ]);

    // People who liked you but whom you have not seen yet, in a separate lane. Their *position* in
    // your stack is suppressed (a like does not buy placement), but they are never invisible: a
    // like you cannot find is a like you cannot reciprocate.
    const inStack = new Set(built.stack.map((entry) => entry.user.id));
    const inbound = all(
      db,
      `SELECT l.from_user, u.id FROM likes l JOIN users u ON u.id = l.from_user
        WHERE l.to_user = ? AND u.banned = 0
          AND NOT EXISTS (SELECT 1 FROM passes p WHERE p.from_user = ? AND p.to_user = l.from_user)
          AND NOT EXISTS (SELECT 1 FROM likes mine WHERE mine.from_user = ? AND mine.to_user = l.from_user)
        ORDER BY l.created_at DESC`,
      ctx.user.id,
      ctx.user.id,
      ctx.user.id,
    )
      .map((row) => row.from_user)
      // Deliberately NOT filtered by `inStack`: someone who liked you must always be reachable,
      // even if they also happen to be in your stack. The stack copy is the one that is hidden —
      // showing the same person twice (once as a card, once as an inbound like) would be worse
      // than either alone, so the inbound lane wins.
      .filter((userId) => !blocked.has(userId));

    const inboundCards = [];
    for (const userId of inbound) {
      const candidate = findUserById(db, userId);
      if (!candidate) continue;
      const verdict = eligibility(ctx.user, candidate, {
        now: ctx.now,
        blockedIds: new Set(),
        blockedByIds: blocked,
      });
      if (!verdict.ok) continue;
      const score = scorePair(viewerAnswers, indexAnswers(getAnswerRows(db, candidate.id)), {
        questions: questionIndexMap(),
      });
      inboundCards.push({
        profile: publicProfile(db, candidate, { now: ctx.now }),
        match: score.ok ? score.match : null,
        friend: score.ok ? score.friend : null,
        enemy: score.ok ? score.enemy : null,
        shared: score.ok ? score.shared : 0,
        confidence: score.ok ? score.confidence : 'none',
        basis: score.ok ? score.basis : 'none',
        scoreNote: score.ok
          ? `${score.shared} shared answer${score.shared === 1 ? '' : 's'} · ${score.confidence} confidence`
          : 'No overlap yet — answer more questions to compare',
        likedByViewer: false,
        likesViewer: true,
        matched: false,
        matchId: null,
        distanceKm: Math.round(verdict.distanceKm ?? 0),
        why: ['They already liked you'],
      });
    }

    const inboundLikes = new Set(inbound);

    return {
      total: Math.max(0, built.total - inboundLikes.size),
      excluded: built.excluded,
      quota: social.quotaSnapshot(db, ctx.user, ctx.now),
      cards: built.stack
        .filter((entry) => !inboundLikes.has(entry.user.id))
        .slice(0, limit)
        .map((entry) => toCard(db, entry, ctx.user, { now: ctx.now, answerCounts })),
      remaining: Math.max(0, built.stack.length - limit),
      inbound: inboundCards,
    };
  }

  function discover(ctx) {
    const params = Object.fromEntries(ctx.url.searchParams.entries());
    const result = buildGrid(db, ctx.user, params, cardContext(ctx));
    const answerCounts = countsByUser(db, result.entries.map((entry) => entry.user.id));
    const boosts = new Set(
      all(db, `SELECT user_id FROM boosts WHERE expires_at > ?`, ctx.now).map((row) => row.user_id),
    );
    return {
      ...result,
      cards: result.entries.map((entry) => ({
        ...toCard(db, entry, ctx.user, { now: ctx.now, answerCounts }),
        boosted: boosts.has(entry.user.id),
      })),
      entries: undefined,
    };
  }

  function countsByUser(db, userIds) {
    if (userIds.length === 0) return new Map();
    const placeholders = userIds.map(() => '?').join(',');
    const rows = all(
      db,
      `SELECT user_id, COUNT(*) AS count FROM answers WHERE user_id IN (${placeholders}) GROUP BY user_id`,
      ...userIds,
    );
    return new Map(rows.map((row) => [row.user_id, row.count]));
  }

  function likesYou(ctx) {
    const result = social.likesYou(db, ctx.user);
    if (!result.visible) {
      // Obfuscated premium view: exact count, no identities.
      return {
        count: result.count,
        visible: false,
        hint: result.hint,
        people: [],
        blurred: result.people.slice(0, 6).map((person, index) => ({
          index,
          city: person.city,
          initials: person.name.split(' ').map((part) => part[0]).slice(0, 2).join(''),
        })),
      };
    }
    const photos = new Map();
    for (const person of result.people) {
      const photo = get(db, `SELECT id FROM photos WHERE user_id = ? ORDER BY position ASC LIMIT 1`, person.id);
      if (photo) photos.set(person.id, photo.id);
    }
    return {
      count: result.count,
      visible: true,
      people: result.people.map((person) => ({
        id: person.id,
        name: person.name,
        city: person.city,
        headline: person.headline,
        verified: person.verified,
        photo: photos.get(person.id) ? `/api/photos/${photos.get(person.id)}` : null,
        likedAt: person.likedAt,
      })),
    };
  }

  function loadTarget(ctx, userId) {
    const target = findUserById(db, userId);
    if (!target || target.banned) throw new HttpError(404, 'profile_not_found', 'That profile is no longer available.');
    return target;
  }

  function likeUser(ctx) {
    const target = loadTarget(ctx, ctx.params.userId);
    // Liking yourself is a caller mistake (400), not an authorisation failure (403). Check it
    // before eligibility so the error code means the same thing on every route.
    if (target.id === ctx.user.id) {
      throw new HttpError(400, 'cannot_like_self', 'You cannot like yourself.');
    }
    // Eligibility is enforced on writes too, not just on reads: you cannot like someone who has
    // filtered you out, blocked you, or is outside your stated range.
    const verdict = eligibility(ctx.user, target, {
      now: ctx.now,
      blockedIds: blockedIdsFor(db, ctx.user.id),
      blockedByIds: blockedByIdsFor(db, ctx.user.id),
    });
    if (!verdict.ok) throw new HttpError(403, 'not_eligible', 'You cannot like this profile.', { reason: verdict.reason });
    const result = social.like(db, ctx.user, target, { now: ctx.now, superLike: ctx.body?.superLike === true });
    counters.likes += 1;
    return result;
  }

  function passUser(ctx) {
    const target = loadTarget(ctx, ctx.params.userId);
    return social.pass(db, ctx.user, target, ctx.now);
  }

  function undoPassUser(ctx) {
    const target = loadTarget(ctx, ctx.params.userId);
    return social.undoPass(db, ctx.user, target);
  }

  function matches(ctx) {
    const list = social.listMatches(db, ctx.user.id, { includeClosed: false });
    const profiles = new Map();
    for (const match of list) {
      const other = findUserById(db, match.withUserId);
      if (!other) continue;
      const photo = get(db, `SELECT id FROM photos WHERE user_id = ? ORDER BY position ASC LIMIT 1`, other.id);
      const scored = scorePair(viewerAnswerIndex(ctx), indexAnswers(getAnswerRows(db, other.id)), {
        questions: questionIndexMap(),
      });
      profiles.set(match.withUserId, {
        id: other.id,
        name: other.name,
        age: ageOf(other, ctx.now),
        city: other.city,
        verified: other.verified,
        photo: photo ? `/api/photos/${photo.id}` : null,
        headline: other.headline,
        match: scored.ok ? scored.match : null,
        online: addDays(other.last_active_at, 1 / 24) > ctx.now,
      });
    }
    return {
      matches: list.map((match) => ({ ...match, profile: profiles.get(match.withUserId) ?? null })),
      count: list.length,
    };
  }

  function matchDetail(ctx) {
    const match = social.findMatchById(db, ctx.params.matchId);
    if (!match) throw new HttpError(404, 'match_not_found', 'That conversation does not exist.');
    if (!social.isParticipant(match, ctx.user.id)) throw new HttpError(403, 'not_a_participant', 'You are not part of that match.');
    const summary = social.matchSummary(db, match, ctx.user.id);
    const other = findUserById(db, summary.withUserId);
    return {
      ...summary,
      profile: other ? publicProfile(db, other, { now: ctx.now }) : null,
      messages: social.listMessages(db, match.id, ctx.user.id, { limit: 50 }),
    };
  }

  function messages(ctx) {
    return {
      messages: social.listMessages(db, ctx.params.matchId, ctx.user.id, {
        limit: ctx.url.searchParams.get('limit'),
        before: ctx.url.searchParams.get('before'),
      }),
    };
  }

  function sendMessage(ctx) {
    const result = social.sendMessage(
      db,
      ctx.user,
      ctx.params.matchId,
      ctx.body?.body,
      ctx.body?.clientId,
      ctx.now,
    );
    counters.messages += 1;
    return {
      message: {
        id: result.message.id,
        sender: 'me',
        body: result.message.body,
        createdAt: result.message.created_at,
      },
      idempotent: result.idempotent,
      __status: result.idempotent ? 200 : 201,
    };
  }

  function markRead(ctx) {
    return social.markThreadRead(db, ctx.params.matchId, ctx.user.id, ctx.now);
  }

  function unmatch(ctx) {
    return social.unmatch(db, ctx.params.matchId, ctx.user.id, ctx.now);
  }

  function profile(ctx) {
    const subject = findUserById(db, ctx.params.userId);
    if (!subject) throw new HttpError(404, 'profile_not_found', 'That profile does not exist.');
    if (subject.banned && subject.id !== ctx.user?.id) {
      throw new HttpError(404, 'profile_not_found', 'That profile is no longer available.');
    }

    const isSelf = subject.id === ctx.user?.id;
    if (!isSelf && ctx.user) {
      const blocked = isBlockedEitherWay(db, ctx.user.id, subject.id);
      if (blocked) throw new HttpError(404, 'profile_not_found', 'That profile is no longer available.');
      run(
        db,
        `INSERT INTO profile_views (viewer_id, viewed_id, viewed_at) VALUES (?, ?, ?)
         ON CONFLICT (viewer_id, viewed_id) DO UPDATE SET viewed_at = excluded.viewed_at`,
        ctx.user.id,
        subject.id,
        ctx.now,
      );
    }

    const subjectAnswers = getAnswerRows(db, subject.id);
    const viewerAnswers = ctx.user ? viewerAnswerIndex(ctx) : indexAnswers([]);
    const scored = ctx.user
      ? scorePair(viewerAnswers, indexAnswers(subjectAnswers), { questions: questionIndexMap() })
      : { ok: false, reason: 'no_viewer', shared: 0 };

    const matchRow = ctx.user ? social.findMatchBetween(db, ctx.user.id, subject.id) : null;
    const liked = ctx.user
      ? Boolean(get(db, `SELECT 1 AS ok FROM likes WHERE from_user = ? AND to_user = ?`, ctx.user.id, subject.id))
      : false;
    const likesYou = ctx.user
      ? Boolean(get(db, `SELECT 1 AS ok FROM likes WHERE from_user = ? AND to_user = ?`, subject.id, ctx.user.id))
      : false;

    return {
      profile: isSelf
        ? selfProfile(db, subject, { now: ctx.now })
        : publicProfile(db, subject, { now: ctx.now, answerCount: subjectAnswers.length }),
      score: scored.ok
        ? {
            ok: true,
            ...trimScore(scored),
            display: describeScore(scored),
            breakdown: scored.breakdown.map((entry) => {
              const mine = viewerAnswers.get(entry.questionId);
              // The other person's private answers stay private; the verdict alone is shown.
              const theirsPrivate = subjectAnswers.find((row) => row.question_id === entry.questionId)?.visibility === 'private';
              return {
                ...entry,
                mine: mine?.answer ?? null,
                theirs: theirsPrivate ? null : entry.theirs,
              };
            }),
          }
        : {
            ok: false,
            reason: scored.reason,
            shared: scored.shared,
            display: describeScore(scored),
            message:
              scored.reason === 'no_overlap'
                ? 'You have not answered any of the same questions yet.'
                : 'Neither of you has weighted your shared answers, so there is nothing to score.',
          },
      answers: publicAnswers(db, subject.id, ctx.user?.id ?? '', questionIndexMap()),
      state: {
        liked,
        likesYou,
        matched: Boolean(matchRow && !matchRow.closed_at),
        matchId: matchRow?.id ?? null,
        blocked: ctx.user ? isBlockedEitherWay(db, ctx.user.id, subject.id) : false,
        canMessage: Boolean(matchRow && !matchRow.closed_at),
      },
      isSelf,
    };
  }

  function trimScore(score) {
    return {
      match: score.match,
      friend: score.friend,
      enemy: score.enemy,
      shared: score.shared,
      coverage: score.coverage,
      confidence: score.confidence,
      basis: score.basis,
    };
  }

  function score(ctx) {
    const subject = loadTarget(ctx, ctx.params.userId);
    const viewerAnswers = viewerAnswerIndex(ctx);
    const subjectAnswers = indexAnswers(getAnswerRows(db, subject.id));
    const result = scorePair(viewerAnswers, subjectAnswers, { questions: questionIndexMap() });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        display: describeScore(result),
        message:
          result.reason === 'no_overlap'
            ? 'You have not answered any of the same questions yet.'
            : 'Neither of you has weighted your shared answers, so there is nothing to score.',
      };
    }
    return {
      ok: true,
      ...trimScore(result),
      display: describeScore(result),
      breakdown: result.breakdown,
      explain: explainScore(result),
    };
  }

  /** Plain-language arithmetic, because a number nobody can check is a number nobody trusts. */
  function explainScore(result) {
    return {
      formula: 'match% = 100 × √(how well you satisfy them × how well they satisfy you)',
      sharedQuestions: result.shared,
      note:
        result.basis === 'one_sided'
          ? 'One of you marked every shared question irrelevant, so only one side carries weight.'
          : 'Both sides carry weight, so the score reflects mutual satisfaction.',
    };
  }

  function photo(ctx) {
    const row = get(db, `SELECT * FROM photos WHERE id = ?`, ctx.params.photoId);
    if (!row) throw new HttpError(404, 'photo_not_found', 'That photo does not exist.');
    const owner = findUserById(db, row.user_id);
    if (owner?.banned && owner.id !== ctx.user?.id) throw new HttpError(404, 'photo_not_found', 'That photo does not exist.');
    ctx.res.writeHead(200, {
      'Content-Type': row.mime,
      'Content-Length': row.bytes.length,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
    ctx.res.end(row.bytes);
    return undefined;
  }

  /**
   * Photo/identity verification. In a production product this calls a vendor's liveness check;
   * here it records the request and grants the flag, because a demo that says "verify" must
   * actually change something observable. Idempotent: verifying twice is not an error.
   */
  function verifyMe(ctx) {
    if (ctx.user.verified) {
      return { verified: true, alreadyVerified: true, user: selfProfile(db, ctx.user) };
    }
    // `users` has no updated_at column: created_at/last_active_at are the only timestamps.
    run(db, `UPDATE users SET verified = 1 WHERE id = ?`, ctx.user.id);
    run(
      db,
      `INSERT INTO events (id, user_id, kind, meta, created_at) VALUES (?, ?, 'verification', ?, ?)`,
      id('evt'),
      ctx.user.id,
      toJson({ simulated: true }),
      nowIso(),
    );
    const user = findUserById(db, ctx.user.id);
    return {
      verified: true,
      alreadyVerified: false,
      simulated: true,
      user: selfProfile(db, user),
    };
  }

  function updateMe(ctx) {
    const patch = { ...(ctx.body ?? {}) };
    // Reject rather than silently drop: a client that "successfully" sets coins and gets 200 has
    // been lied to, and will report a bug that is ours.
    const protectedFields = ['email', 'tier', 'tierUntil', 'coins', 'isAdmin', 'id', 'verified', 'banned', 'passwordHash'];
    const attempted = protectedFields.filter((field) => Object.hasOwn(patch, field));
    if (attempted.length > 0) {
      throw new HttpError(400, 'forbidden_field', `These fields cannot be edited here: ${attempted.join(', ')}`);
    }

    if (patch.lookingFor !== undefined) {
      const normalised = normaliseLookingFor(patch.lookingFor);
      if (!normalised) throw new HttpError(400, 'invalid_looking_for', 'Choose at least one gender.');
      patch.lookingFor = normalised;
    }
    if (patch.intent !== undefined && !INTENTS.includes(String(patch.intent))) {
      throw new HttpError(400, 'invalid_intent', 'Unknown intent.');
    }
    if (patch.minAge !== undefined || patch.maxAge !== undefined) {
      const minAge = Number(patch.minAge ?? ctx.user.min_age);
      const maxAge = Number(patch.maxAge ?? ctx.user.max_age);
      if (!Number.isFinite(minAge) || !Number.isFinite(maxAge) || minAge < 18 || maxAge > 99 || minAge > maxAge) {
        throw new HttpError(400, 'invalid_age_range', 'Age range must be 18–99 with min ≤ max.');
      }
      patch.minAge = Math.round(minAge);
      patch.maxAge = Math.round(maxAge);
    }
    if (patch.maxDistanceKm !== undefined) {
      const distance = Number(patch.maxDistanceKm);
      if (!Number.isFinite(distance) || distance < 1 || distance > ANYWHERE_KM) {
        throw new HttpError(400, 'invalid_distance', 'Distance must be between 1 and 20,000 km.');
      }
      patch.maxDistanceKm = Math.round(distance);
    }
    if (patch.bio !== undefined && String(patch.bio).length > 5000) {
      throw new HttpError(400, 'bio_too_long', 'Keep your bio under 5,000 characters.');
    }
    if (patch.headline !== undefined && String(patch.headline).length > 160) {
      throw new HttpError(400, 'headline_too_long', 'Keep your headline under 160 characters.');
    }
    if (patch.heightCm !== undefined && patch.heightCm !== null) {
      const height = Number(patch.heightCm);
      if (!Number.isFinite(height) || height < 120 || height > 220) {
        throw new HttpError(400, 'invalid_height', 'Height must be between 120 and 220 cm.');
      }
      patch.heightCm = Math.round(height);
    }
    if (patch.city !== undefined && !CITIES[String(patch.city)]) {
      throw new HttpError(400, 'invalid_city', 'Choose one of the listed cities.');
    }
    if (patch.city !== undefined) {
      patch.lat = CITIES[String(patch.city)].lat;
      patch.lon = CITIES[String(patch.city)].lon;
    }

    const result = updateUser(db, ctx.user.id, patch);
    if (result.rejected.length > 0) {
      throw new HttpError(400, 'unknown_fields', `These fields cannot be edited: ${result.rejected.join(', ')}`);
    }
    const fresh = findUserById(db, ctx.user.id);
    return {
      user: selfProfile(db, fresh, {
        now: ctx.now,
        quota: social.quotaSnapshot(db, fresh, ctx.now),
        answerCount: answerCount(db, fresh.id),
      }),
      updated: result.updated,
    };
  }

  function uploadPhoto(ctx) {
    const dataUrl = String(ctx.body?.dataUrl ?? '');
    const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new HttpError(400, 'invalid_photo', 'Upload a PNG, JPEG, WebP or SVG image.');
    const mime = match[1];
    let bytes;
    try {
      bytes = Buffer.from(match[2], 'base64');
    } catch {
      throw new HttpError(400, 'invalid_photo', 'That image could not be decoded.');
    }
    if (bytes.length > 1_500_000) throw new HttpError(413, 'photo_too_large', 'Keep photos under 1.5 MB.');
    const existing = listPhotos(db, ctx.user.id);
    if (existing.length >= 8) throw new HttpError(409, 'photo_limit', 'You can have up to 8 photos.');

    const photoId = id('pho');
    const position = existing.length;
    run(
      db,
      `INSERT INTO photos (id, user_id, position, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      photoId,
      ctx.user.id,
      position,
      mime,
      bytes,
      ctx.now,
    );
    const ids = all(db, `SELECT id FROM photos WHERE user_id = ? ORDER BY position ASC`, ctx.user.id).map((row) => row.id);
    run(db, `UPDATE users SET photo_ids = ? WHERE id = ?`, toJson(ids), ctx.user.id);
    return { photo: { id: photoId, url: `/api/photos/${photoId}`, position }, __status: 201 };
  }

  function deletePhoto(ctx) {
    const row = get(db, `SELECT * FROM photos WHERE id = ? AND user_id = ?`, ctx.params.photoId, ctx.user.id);
    if (!row) throw new HttpError(404, 'photo_not_found', 'That photo is not yours.');
    run(db, `DELETE FROM photos WHERE id = ?`, row.id);
    // Re-pack positions so there is never a gap (gap = a card with a missing first image).
    const remaining = all(db, `SELECT id FROM photos WHERE user_id = ? ORDER BY position ASC`, ctx.user.id);
    transaction(db, () => {
      remaining.forEach((photo, index) => run(db, `UPDATE photos SET position = ? WHERE id = ?`, index, photo.id));
      run(db, `UPDATE users SET photo_ids = ? WHERE id = ?`, toJson(remaining.map((photo) => photo.id)), ctx.user.id);
    });
    return { deleted: true };
  }

  function whoViewedMe(ctx) {
    const premium = ctx.user.tier === 'plus' || ctx.user.tier === 'gold';
    const rows = all(
      db,
      `SELECT pv.viewer_id, pv.viewed_at, u.name, u.city
         FROM profile_views pv JOIN users u ON u.id = pv.viewer_id
        WHERE pv.viewed_id = ? AND u.banned = 0
        ORDER BY pv.viewed_at DESC LIMIT 30`,
      ctx.user.id,
    );
    return {
      count: rows.length,
      visible: premium,
      hint: premium ? null : 'ZimDate Plus shows you who viewed your profile.',
      viewers: premium
        ? rows.map((row) => ({ id: row.viewer_id, name: row.name, city: row.city, viewedAt: row.viewed_at }))
        : [],
    };
  }

  function blockUser(ctx) {
    const target = loadTarget(ctx, ctx.params.userId);
    return social.block(db, ctx.user.id, target.id, ctx.now);
  }

  function unblockUser(ctx) {
    return social.unblock(db, ctx.user.id, ctx.params.userId);
  }

  function reportUser(ctx) {
    const target = loadTarget(ctx, ctx.params.userId);
    const reason = String(ctx.body?.reason ?? '');
    if (!social.REPORT_REASONS.includes(reason)) {
      throw new HttpError(400, 'invalid_reason', 'Choose a reason for the report.');
    }
    const row = social.report(db, ctx.user.id, target.id, reason, ctx.body?.details ?? '', ctx.now);
    return { reported: true, reportId: row?.id ?? null, status: row?.status ?? 'open' };
  }

  function notifications(ctx) {
    return {
      notifications: social.listNotifications(db, ctx.user.id, { limit: ctx.url.searchParams.get('limit') }),
    };
  }

  function readNotifications(ctx) {
    return social.markNotificationsRead(db, ctx.user.id, ctx.now);
  }

  function boost(ctx) {
    return social.startBoost(db, ctx.user, ctx.now);
  }

  function boostStatus(ctx) {
    const active = social.activeBoost(db, ctx.user.id, ctx.now);
    const minutesLeft = active
      ? Math.max(0, Math.round((new Date(active.expires_at).getTime() - new Date(ctx.now).getTime()) / 60_000))
      : 0;
    return {
      active,
      minutesLeft,
      // A boost lifts you in *other people's* ranking; it is not a multiplier on your own match
      // percentages, and it never inflates the score. Report the ranking weight, not a 2.5×.
      rankBonus: active ? RANK_WEIGHTS.boost : 0,
      cost: social.BOOST,
      boostsLeft: ctx.user.boosts_left,
      coins: ctx.user.coins,
    };
  }

  /**
   * Local, simulated checkout. There is no payment processor here and the response says so —
   * pretending otherwise would be the one dishonest thing in an otherwise honest demo.
   */
  function checkout(ctx) {
    const tier = String(ctx.body?.tier ?? '');
    if (!social.TIERS[tier]) throw new HttpError(400, 'invalid_tier', 'Choose a plan: plus or gold.');
    if (tier === 'free') {
      const result = social.setTier(db, ctx.user.id, 'free', ctx.now);
      return { ...result, simulated: true, note: 'Plan cancelled. You keep your matches and messages.' };
    }
    const result = social.setTier(db, ctx.user.id, tier, ctx.now);
    run(db, `UPDATE users SET coins = coins + 50 WHERE id = ?`, ctx.user.id);
    return {
      ...result,
      simulated: true,
      note: 'Simulated checkout: no card was charged. Tiers unlock premium views for 30 days.',
      tierInfo: social.TIERS[tier],
    };
  }

  function adminStats(ctx) {
    if (!requireAdmin(ctx.user)) throw new HttpError(403, 'admin_only', 'Admins only.');
    const stats = poolStats(db, ctx.user, { now: ctx.now, questions: questionIndexMap() });
    const counts = get(db, `SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE banned = 1) AS banned,
        (SELECT COUNT(*) FROM answers) AS answers,
        (SELECT COUNT(*) FROM likes) AS likes,
        (SELECT COUNT(*) FROM matches WHERE closed_at IS NULL) AS matches,
        (SELECT COUNT(*) FROM messages) AS messages,
        (SELECT COUNT(*) FROM reports WHERE status = 'open') AS openReports,
        (SELECT COUNT(*) FROM reports) AS reports`);
    const activity = all(
      db,
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS likes FROM likes
        GROUP BY day ORDER BY day DESC LIMIT 14`,
    );
    return {
      counts,
      pool: stats,
      activity: activity.reverse(),
      questions: QUESTIONS.length,
      uptimeSeconds: Math.round(process.uptime()),
      counters,
      // Honest about what this endpoint cannot know.
      limitations: [
        'No moderation model is applied to photos or bios beyond explicit reports.',
        'Discovery excludes no one for desirability balancing — by design.',
      ],
    };
  }

  function adminReports(ctx) {
    if (!requireAdmin(ctx.user)) throw new HttpError(403, 'admin_only', 'Admins only.');
    const status = ctx.url.searchParams.get('status');
    const rows = all(
      db,
      `SELECT r.*, reporter.name AS reporter_name, target.name AS target_name
         FROM reports r
         JOIN users reporter ON reporter.id = r.reporter_id
         JOIN users target ON target.id = r.target_id
        ${status ? 'WHERE r.status = ?' : ''}
        ORDER BY r.created_at DESC LIMIT 100`,
      ...(status ? [status] : []),
    );
    return {
      reports: rows.map((row) => ({
        id: row.id,
        reason: row.reason,
        details: row.details,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        action: row.action,
        reporter: { id: row.reporter_id, name: row.reporter_name },
        target: { id: row.target_id, name: row.target_name },
      })),
      counts: all(db, `SELECT status, COUNT(*) AS count FROM reports GROUP BY status`),
    };
  }

  function adminResolveReport(ctx) {
    if (!requireAdmin(ctx.user)) throw new HttpError(403, 'admin_only', 'Admins only.');
    const row = get(db, `SELECT * FROM reports WHERE id = ?`, ctx.params.reportId);
    if (!row) throw new HttpError(404, 'report_not_found', 'That report does not exist.');
    const action = String(ctx.body?.action ?? '');
    const allowed = ['dismiss', 'warn', 'remove', 'ban'];
    if (!allowed.includes(action)) throw new HttpError(400, 'invalid_action', `Action must be one of: ${allowed.join(', ')}`);
    const status = action === 'dismiss' ? 'dismissed' : 'actioned';
    transaction(db, () => {
      run(
        db,
        `UPDATE reports SET status = ?, action = ?, resolved_at = ? WHERE id = ?`,
        status,
        action,
        ctx.now,
        row.id,
      );
      auditAdmin(db, ctx.user.id, action, 'report', row.id, String(ctx.body?.notes ?? ''), ctx.now);
      if (action === 'ban') {
        run(db, `UPDATE users SET banned = 1 WHERE id = ?`, row.target_id);
        run(db, `DELETE FROM sessions WHERE user_id = ?`, row.target_id);
        auditAdmin(db, ctx.user.id, 'ban', 'user', row.target_id, `Auto-ban via report ${row.id}`, ctx.now);
      }
      if (action === 'warn' || action === 'remove') {
        run(
          db,
          `INSERT INTO notifications (id, user_id, kind, payload, created_at) VALUES (?, ?, 'moderation', ?, ?)`,
          id('ntf'),
          row.target_id,
          toJson({ title: action === 'warn' ? 'Community guidelines warning' : 'Content removed', reportId: row.id }),
          ctx.now,
        );
      }
    });
    return { resolved: true, status, action };
  }

  function adminBan(ctx) {
    if (!requireAdmin(ctx.user)) throw new HttpError(403, 'admin_only', 'Admins only.');
    const banned = ctx.body?.banned !== false;
    const target = findUserById(db, ctx.params.userId);
    if (!target) throw new HttpError(404, 'user_not_found', 'No such user.');
    if (target.isAdmin) throw new HttpError(400, 'cannot_ban_admin', 'Admins cannot be banned from the API.');
    transaction(db, () => {
      run(db, `UPDATE users SET banned = ? WHERE id = ?`, banned ? 1 : 0, target.id);
      if (banned) destroyAllSessions(db, target.id);
      auditAdmin(db, ctx.user.id, banned ? 'ban' : 'unban', 'user', target.id, String(ctx.body?.notes ?? ''), ctx.now);
    });
    return { banned, userId: target.id };
  }

  function adminAudit(ctx) {
    if (!requireAdmin(ctx.user)) throw new HttpError(403, 'admin_only', 'Admins only.');
    return { entries: recentAudit(db, ctx.url.searchParams.get('limit') ?? 50) };
  }

  return { handle, db, routes, counters };
}

/* --------------------------------------------------------------- utilities */

function blockedIdsFor(db, userId) {
  return new Set(all(db, `SELECT blocked_id FROM blocks WHERE blocker_id = ?`, userId).map((row) => row.blocked_id));
}

function blockedByIdsFor(db, userId) {
  return new Set(all(db, `SELECT blocker_id FROM blocks WHERE blocked_id = ?`, userId).map((row) => row.blocker_id));
}

function isBlockedEitherWay(db, left, right) {
  const row = get(
    db,
    `SELECT 1 AS ok FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    left,
    right,
    right,
    left,
  );
  return Boolean(row);
}

export { QUESTIONS, CITIES };
