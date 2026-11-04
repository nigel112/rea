/**
 * End-to-end HTTP tests: a real server on an ephemeral port, a real SQLite file, real cookies.
 *
 * Deliberately *not* mocking the database or the router — most of the bugs this suite has already
 * caught (undefined variables in eligibility, response-shape drift, silent field drops) only appear
 * when the whole stack runs.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openAndMigrate, get } from '../server/db/index.js';
import { createZimDateServer } from '../server/api.js';
import { seedDatabase, DEMO_EMAIL, DEMO_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD } from '../server/seed/seed.js';

let server;
let baseUrl;
let db;
let tempDir;

/* ------------------------------------------------------------------ client */

function makeClient() {
  const cookies = new Map();
  let csrf = null;

  function cookieHeader() {
    return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  function absorb(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const [key, ...rest] = pair.split('=');
      cookies.set(key.trim(), rest.join('=').trim());
    }
  }

  async function call(method, path, body, options = {}) {
    const headers = { Accept: 'application/json' };
    if (cookies.size) headers.Cookie = cookieHeader();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf && method !== 'GET' && !options.omitCsrf) headers['X-ZimDate-CSRF'] = csrf;
    if (options.authorization) headers.Authorization = options.authorization;

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    absorb(response);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (json?.csrf) csrf = json.csrf;
    return { status: response.status, body: json, headers: response.headers };
  }

  return {
    call,
    get: (path, options) => call('GET', path, undefined, options),
    post: (path, body = {}, options) => call('POST', path, body, options),
    patch: (path, body = {}, options) => call('PATCH', path, body, options),
    del: (path, options) => call('DELETE', path, undefined, options),
    async login(email = DEMO_EMAIL, password = DEMO_PASSWORD) {
      const result = await call('POST', '/api/auth/login', { email, password });
      assert.equal(result.status, 200, `login failed: ${JSON.stringify(result.body)}`);
      return result.body;
    },
    get csrf() {
      return csrf;
    },
    set csrf(value) {
      csrf = value;
    },
  };
}

/* -------------------------------------------------------------------- setup */

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'zimdate-test-'));
  db = openAndMigrate(join(tempDir, 'test.db'));
  // A smaller world keeps the suite fast while exercising the same code paths.
  seedDatabase(db, { profiles: 120, now: '2026-06-15T12:00:00.000Z' });
  const app = createZimDateServer({ db });
  server = createServer((req, res) => {
    app.handle(req, res).catch((error) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: String(error) } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------- tests */

describe('public endpoints', () => {
  it('serves health and metadata without a session', async () => {
    const client = makeClient();
    const health = await client.get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.service, 'zimdate');

    const meta = await client.get('/api/meta');
    assert.equal(meta.body.questions.length, 60);
    assert.equal(meta.body.minAge, 18);
    assert.ok(meta.body.routes.length >= 35);
  });

  it('serves the SPA shell and static assets', async () => {
    const html = await fetch(baseUrl + '/');
    assert.equal(html.status, 200);
    const text = await html.text();
    assert.match(text, /ZimDate/);
    assert.match(text, /js\/app\.js/);

    const css = await fetch(baseUrl + '/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.match(css.headers.get('content-security-policy'), /default-src 'self'/);
  });

  it('refuses path traversal', async () => {
    const response = await fetch(`${baseUrl}/../server/api.js`);
    assert.ok([404, 400].includes(response.status));
    const encoded = await fetch(`${baseUrl}/%2e%2e%2fserver%2fapi.js`);
    assert.ok([404, 400].includes(encoded.status));
  });

  it('404s unknown API routes and 405s wrong methods', async () => {
    const client = makeClient();
    assert.equal((await client.get('/api/nope')).status, 404);
    assert.equal((await client.del('/api/health')).status, 405);
  });
});

describe('auth', () => {
  it('rejects bad credentials and bad signups with field errors', async () => {
    const client = makeClient();
    const bad = await client.post('/api/auth/login', { email: DEMO_EMAIL, password: 'wrong' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'invalid_credentials');

    const unknown = await client.post('/api/auth/login', { email: 'nobody@zimdate.test', password: 'x' });
    assert.equal(unknown.status, 401);
    // Same code for unknown email and wrong password: no account oracle.
    assert.equal(unknown.body.error.code, 'invalid_credentials');

    const signup = await client.post('/api/auth/signup', {
      email: 'not-an-email',
      password: 'short',
      name: 'A',
      birthDate: '2020-01-01',
      gender: 'alien',
      lookingFor: [],
      city: 'Atlantis',
    });
    assert.equal(signup.status, 422);
    assert.ok(signup.body.error.fields.email);
    assert.ok(signup.body.error.fields.password);
    assert.ok(signup.body.error.fields.birthDate);
    assert.ok(signup.body.error.fields.gender);
    assert.ok(signup.body.error.fields.lookingFor);
    assert.ok(signup.body.error.fields.city);
  });

  it('signs up, persists a session cookie, and reports the current user', async () => {
    const client = makeClient();
    const result = await client.post('/api/auth/signup', {
      email: `new-${Date.now()}@example.com`,
      password: 'a-good-password',
      name: 'Nyasha Test',
      birthDate: '1996-03-14',
      gender: 'woman',
      lookingFor: ['man'],
      city: 'Harare',
      intent: 'long-term',
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.user.name, 'Nyasha Test');
    assert.equal(result.body.user.answerCount, 0);
    assert.ok(result.body.csrf);

    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email.startsWith('new-'), true);
    assert.equal(me.body.user.tier, 'free');
  });

  it('requires CSRF for cookie-authenticated writes but not for bearer tokens', async () => {
    const client = makeClient();
    await client.login();
    const noCsrf = await client.post('/api/notifications/read', {}, { omitCsrf: true });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.body.error.code, 'csrf_failed');

    const withCsrf = await client.post('/api/notifications/read', {});
    assert.equal(withCsrf.status, 200);

    // Bearer auth is not cookie-authenticated, so CSRF does not apply to it.
    const bearerClient = makeClient();
    const login = await bearerClient.post('/api/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const token = login.headers.getSetCookie().find((cookie) => cookie.startsWith('zimdate_session='));
    const value = decodeURIComponent(token.split(';')[0].split('=')[1]);
    const bearer = await bearerClient.post('/api/notifications/read', {}, { omitCsrf: true, authorization: `Bearer ${value}` });
    assert.equal(bearer.status, 200);
  });

  it('locks out repeated failed logins', async () => {
    const client = makeClient();
    let last;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      last = await client.post('/api/auth/login', { email: 'lockout@example.com', password: `bad-${attempt}` });
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'too_many_attempts');
  });

  it('rejects unauthenticated access to private endpoints', async () => {
    const client = makeClient();
    for (const path of ['/api/stack', '/api/matches', '/api/answers', '/api/me/views']) {
      const response = await client.get(path);
      assert.equal(response.status, 401, `expected 401 for ${path}`);
      assert.equal(response.body.error.code, 'unauthenticated');
    }
  });
});

describe('questions and answers', () => {
  it('saves, updates, warns, and deletes an answer', async () => {
    const client = makeClient();
    await client.login();

    const saved = await client.post('/api/answers', {
      questionId: 'fun_dancing',
      answer: 'a',
      accept: ['a', 'b'],
      importance: 'somewhat',
      explanation: 'Wedding season is my sport.',
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.saved, true);
    assert.deepEqual(saved.body.warnings, []);

    const warned = await client.post('/api/answers', {
      questionId: 'fun_dancing',
      answer: 'a',
      accept: ['b'],
      importance: 'somewhat',
    });
    assert.equal(warned.body.wasUpdate, true);
    assert.match(warned.body.warnings[0], /did not accept your own answer/);

    const listed = await client.get('/api/answers');
    const stored = listed.body.answers.find((answer) => answer.question_id === 'fun_dancing');
    assert.deepEqual(stored.accept, ['b']);

    const removed = await client.del('/api/answers/fun_dancing');
    assert.equal(removed.status, 200);
    assert.equal((await client.del('/api/answers/fun_dancing')).status, 404);
  });

  it('validates answers against the question definition', async () => {
    const client = makeClient();
    await client.login();
    const badOption = await client.post('/api/answers', { questionId: 'fun_dancing', answer: 'zz', accept: ['a'] });
    assert.equal(badOption.status, 400);
    assert.equal(badOption.body.error.code, 'invalid_answer');

    const badQuestion = await client.post('/api/answers', { questionId: 'not_a_question', answer: 'a', accept: ['a'] });
    assert.equal(badQuestion.status, 404);

    const badImportance = await client.post('/api/answers', {
      questionId: 'fun_dancing', answer: 'a', accept: ['a'], importance: 'insane',
    });
    assert.equal(badImportance.body.error.code, 'invalid_importance');
  });
});

describe('discovery', () => {
  it('returns a scored, ranked stack', async () => {
    const client = makeClient();
    await client.login();
    const result = await client.get('/api/stack?limit=5');
    assert.equal(result.status, 200);
    assert.ok(result.body.cards.length > 0);
    assert.ok(result.body.quota.limit >= 25);

    const scores = result.body.cards.map((card) => card.match ?? -1);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'stack must be ranked by match');

    for (const card of result.body.cards) {
      assert.ok(card.profile.id);
      assert.equal(card.profile.email, undefined, 'public profiles must not leak email');
      assert.ok(card.scoreNote.length > 0);
    }
  });

  it('never returns the viewer, or anyone blocked', async () => {
    const client = makeClient();
    const me = await client.login();
    const stack = await client.get('/api/stack?limit=50');
    assert.equal(stack.body.cards.some((card) => card.profile.id === me.user.id), false);
  });

  it('filters the grid and paginates honestly', async () => {
    const client = makeClient();
    await client.login();
    const wide = await client.get('/api/discover?pageSize=5');
    assert.equal(wide.status, 200);
    assert.ok(wide.body.total >= wide.body.cards.length);
    assert.ok(wide.body.pages >= 1);

    const narrow = await client.get('/api/discover?minAge=60&maxAge=99');
    assert.equal(narrow.body.total, 0);
    assert.equal(narrow.body.cards.length, 0);
  });
});

describe('profiles and scoring', () => {
  it('computes an auditable score with hidden private answers', async () => {
    const client = makeClient();
    await client.login();
    const stack = await client.get('/api/stack?limit=20');
    const all = [...stack.body.cards, ...(stack.body.inbound ?? [])];
    const target = all.find((card) => card.shared >= 3) ?? all[0];
    assert.ok(target, 'expected at least one candidate');

    const profile = await client.get(`/api/profile/${target.profile.id}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.isSelf, false);
    assert.ok(Array.isArray(profile.body.answers));

    if (profile.body.score.ok) {
      assert.ok(profile.body.score.match >= 0 && profile.body.score.match <= 100);
      assert.ok(profile.body.score.breakdown.length === profile.body.score.shared);
      assert.ok(profile.body.score.display.label.endsWith('%'));
      for (const entry of profile.body.score.breakdown) {
        assert.ok(['aligned', 'different_but_acceptable', 'rejected_by_me', 'rejected_by_them', 'rejected_both'].includes(entry.verdict));
      }
      // Private answers must never appear as content.
      const privates = profile.body.answers.filter((answer) => answer.visibility === 'private');
      for (const answer of privates) {
        assert.deepEqual(answer.accept, []);
        assert.equal(answer.explanation, '');
      }
    } else {
      assert.ok(['no_overlap', 'no_scoreable_weight'].includes(profile.body.score.reason));
      assert.equal(profile.body.score.display.label, '—');
    }
  });
});

describe('likes, matches and messaging', () => {
  it('runs the full like → match → message → unmatch flow', async () => {
    const client = makeClient();
    await client.login();
    const stack = await client.get('/api/stack?limit=40');
    // Someone who already likes the viewer is offered in the inbound lane: liking back must match.
    const mutual = (stack.body.inbound ?? [])[0];
    assert.ok(mutual, 'demo account should have inbound likes from eligible people');
    assert.equal(mutual.likesViewer, true);
    assert.equal(mutual.likedByViewer, false);

    const liked = await client.post(`/api/likes/${mutual.profile.id}`);
    assert.equal(liked.status, 200);
    assert.equal(liked.body.matched, true);
    const matchId = liked.body.match.id;

    // Repeat like: same shape, still matched, no duplicate match.
    const again = await client.post(`/api/likes/${mutual.profile.id}`);
    assert.equal(again.body.alreadyLiked, true);
    assert.equal(again.body.matched, true);
    assert.equal(again.body.match.id, matchId);

    const sent = await client.post(`/api/matches/${matchId}/messages`, { body: 'Hello from the test suite', clientId: 'suite-1' });
    assert.equal(sent.status, 201);
    const duplicate = await client.post(`/api/matches/${matchId}/messages`, { body: 'different text', clientId: 'suite-1' });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.idempotent, true);
    assert.equal(duplicate.body.message.id, sent.body.message.id);

    const thread = await client.get(`/api/matches/${matchId}/messages`);
    assert.equal(thread.body.messages.at(-1).body, 'Hello from the test suite');
    assert.equal(thread.body.messages.at(-1).sender, 'me');

    const read = await client.post(`/api/matches/${matchId}/read`);
    assert.equal(read.body.read, true);

    const closed = await client.post(`/api/matches/${matchId}/unmatch`);
    assert.equal(closed.body.closed, true);
    const afterClosure = await client.post(`/api/matches/${matchId}/messages`, { body: 'still there?', clientId: 'suite-2' });
    assert.equal(afterClosure.status, 403);
    assert.equal(afterClosure.body.error.code, 'match_closed');
  });

  it('refuses to message someone else’s conversation', async () => {
    const client = makeClient();
    await client.login();
    const matches = await client.get('/api/matches');
    const foreignMatch = get(db, `SELECT * FROM matches WHERE user_a <> 'usr_demo' AND user_b <> 'usr_demo' LIMIT 1`);
    assert.ok(foreignMatch, 'the seeded world should contain other matches');
    const attempt = await client.get(`/api/matches/${foreignMatch.id}`);
    assert.equal(attempt.status, 403);
    assert.equal(attempt.body.error.code, 'not_a_participant');
    assert.ok(matches.status === 200);
  });

  it('gates "who likes you" behind a plan but keeps the count exact', async () => {
    const client = makeClient();
    const login = await client.login();
    const free = await client.get('/api/likes-you');
    assert.equal(free.body.visible, false);
    assert.equal(free.body.people.length, 0);
    const expected = get(db, `SELECT COUNT(*) AS count FROM likes WHERE to_user = 'usr_demo'`).count;
    assert.equal(free.body.count, expected);

    const checkout = await client.post('/api/billing/checkout', { tier: 'plus' });
    assert.equal(checkout.body.simulated, true);
    const plus = await client.get('/api/likes-you');
    assert.equal(plus.body.visible, true);
    assert.equal(plus.body.count, expected);
    assert.equal(plus.body.people.length, expected);
    assert.equal(login.user.tier, 'free');
  });

  it('enforces blocks everywhere', async () => {
    const client = makeClient();
    await client.login();
    const stack = await client.get('/api/stack?limit=10');
    const target = stack.body.cards[0];
    const blocked = await client.post(`/api/block/${target.profile.id}`);
    assert.equal(blocked.body.blocked, true);

    const after = await client.get('/api/stack?limit=50');
    assert.equal(after.body.cards.some((card) => card.profile.id === target.profile.id), false);

    const profile = await client.get(`/api/profile/${target.profile.id}`);
    assert.equal(profile.status, 404);

    const like = await client.post(`/api/likes/${target.profile.id}`);
    assert.equal(like.status, 403);

    await client.del(`/api/block/${target.profile.id}`);
    const restored = await client.get(`/api/profile/${target.profile.id}`);
    assert.equal(restored.status, 200);
  });
});

describe('profile editing', () => {
  it('accepts editable fields and rejects protected ones', async () => {
    const client = makeClient();
    await client.login();
    const updated = await client.patch('/api/me', {
      headline: 'Testing in production, professionally',
      maxDistanceKm: 150,
      minAge: 25,
      maxAge: 40,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.headline, 'Testing in production, professionally');
    assert.equal(updated.body.user.interestsFilter.maxDistanceKm, 150);
    assert.ok(Number.isInteger(updated.body.user.answerCount), 'PATCH must return answerCount like /auth/me');

    const forbidden = await client.patch('/api/me', { coins: 999999, tier: 'gold' });
    assert.equal(forbidden.status, 400);
    assert.equal(forbidden.body.error.code, 'forbidden_field');
    const balance = await client.get('/api/auth/me');
    assert.equal(balance.body.user.tier, 'plus', 'tier unchanged by the rejected patch');
    assert.notEqual(balance.body.user.coins, 999999);
  });

  it('validates ranges and lengths', async () => {
    const client = makeClient();
    await client.login();
    assert.equal((await client.patch('/api/me', { minAge: 50, maxAge: 30 })).body.error.code, 'invalid_age_range');
    assert.equal((await client.patch('/api/me', { maxDistanceKm: 0 })).body.error.code, 'invalid_distance');
    assert.equal((await client.patch('/api/me', { city: 'Atlantis' })).body.error.code, 'invalid_city');
    assert.equal((await client.patch('/api/me', { headline: 'x'.repeat(200) })).body.error.code, 'headline_too_long');
  });
});

describe('verification', () => {
  it('is a real, idempotent state change', async () => {
    const client = makeClient();
    await client.login(DEMO_EMAIL, DEMO_PASSWORD);
    // The demo account ships unverified so the Settings flow is reachable on a fresh seed.
    const before = await client.get('/api/auth/me');
    assert.equal(before.body.user.verified, false);

    const first = await client.post('/api/me/verify', {});
    assert.equal(first.status, 200);
    assert.equal(first.body.verified, true);
    assert.equal(first.body.alreadyVerified, false);
    assert.equal(first.body.user.verified, true);

    // Verifying twice is not an error, and it must not claim to have changed anything.
    const second = await client.post('/api/me/verify', {});
    assert.equal(second.status, 200);
    assert.equal(second.body.alreadyVerified, true);
  });

  it('requires a session', async () => {
    const anonymous = makeClient();
    assert.equal((await anonymous.post('/api/me/verify', {})).status, 401);
  });
});

describe('admin', () => {
  it('is closed to normal users and open to admins', async () => {
    const user = makeClient();
    await user.login();
    assert.equal((await user.get('/api/admin/stats')).status, 403);

    const admin = makeClient();
    await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const stats = await admin.get('/api/admin/stats');
    assert.equal(stats.status, 200);
    assert.ok(stats.body.counts.users > 100);
    assert.ok(stats.body.pool.poolSize >= 0);
    assert.ok(Array.isArray(stats.body.limitations) && stats.body.limitations.length > 0);

    const reports = await admin.get('/api/admin/reports?status=open');
    assert.equal(reports.status, 200);
    assert.ok(Array.isArray(reports.body.reports));
  });

  it('resolves a report and writes an audit entry', async () => {
    const admin = makeClient();
    await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const open = await admin.get('/api/admin/reports?status=open');
    const report = open.body.reports[0];
    if (!report) return; // seeded world had no open reports
    const resolved = await admin.post(`/api/admin/reports/${report.id}`, { action: 'warn', notes: 'Test warning' });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.action, 'warn');
    const audit = await admin.get('/api/admin/audit');
    assert.ok(audit.body.entries.some((entry) => entry.target_id === report.id));
  });

  it('cannot ban another admin', async () => {
    const admin = makeClient();
    await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const attempt = await admin.post('/api/admin/users/usr_admin/ban', { banned: true });
    assert.equal(attempt.status, 400);
    assert.equal(attempt.body.error.code, 'cannot_ban_admin');
  });
});
