#!/usr/bin/env node
/**
 * Smoke test with no dependencies: boots a server on a temp database, walks every route, and
 * checks the reconciliation invariants between the seeded data and live recomputation.
 *
 * This is what `npm run check` runs after the unit/integration suites. It deliberately uses only
 * Node built-ins so a fresh clone can verify itself before `npm i`.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const { openAndMigrate, all, get, parseJson } = await import('../server/db/index.js');
const { createZimDateServer } = await import('../server/api.js');
const { seedDatabase, DEMO_EMAIL, DEMO_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD } = await import('../server/seed/seed.js');
const { validateQuestionBank } = await import('../server/seed/questions.js');
const compat = await import('../server/lib/compat.js');

const failures = [];
const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ setup */

const bank = validateQuestionBank();
check('question bank validates', bank.ok, bank.problems.join('; '));
check('question bank has 60 items', bank.ok && (await import('../server/seed/questions.js')).QUESTIONS.length === 60);

const tempDir = mkdtempSync(join(tmpdir(), 'zimdate-selftest-'));
const db = openAndMigrate(join(tempDir, 'selftest.db'));
const seedStarted = Date.now();
const seedSummary = seedDatabase(db, { profiles: 500, now: '2026-06-15T12:00:00.000Z' });
const seedMs = Date.now() - seedStarted;
check('seeds 500 profiles quickly', seedMs < 60_000, `${seedMs} ms`);

const counts = get(
  db,
  `SELECT (SELECT COUNT(*) FROM users) users,
          (SELECT COUNT(*) FROM questions) questions,
          (SELECT COUNT(*) FROM answers) answers,
          (SELECT COUNT(*) FROM photos) photos,
          (SELECT COUNT(*) FROM likes) likes,
          (SELECT COUNT(*) FROM matches) matches,
          (SELECT COUNT(*) FROM messages) messages,
          (SELECT COUNT(*) FROM reports) reports`,
);
check('500 profiles + demo + admin present', counts.users === 502, String(counts.users));
check('60 questions seeded', counts.questions === 60, String(counts.questions));
check('answers seeded', counts.answers > 10_000, String(counts.answers));
check('photos seeded for every profile', counts.photos >= 502, String(counts.photos));
check('matches exist between non-demo profiles', get(db, `SELECT COUNT(*) c FROM matches WHERE user_a <> 'usr_demo' AND user_b <> 'usr_demo'`).c > 0);

/* ------------------------------------------------- deterministic seeding */

const secondPath = join(tempDir, 'second.db');
const db2 = openAndMigrate(secondPath);
seedDatabase(db2, { profiles: 120, now: '2026-06-15T12:00:00.000Z' });
const thirdPath = join(tempDir, 'third.db');
const db3 = openAndMigrate(thirdPath);
seedDatabase(db3, { profiles: 120, now: '2026-06-15T12:00:00.000Z' });

function fingerprint(database) {
  const users = all(
    database,
    `SELECT id, name, birth_date, gender, looking_for, headline, bio, city, interests
       FROM users WHERE seeded = 1 ORDER BY id`,
  );
  const answers = all(
    database,
    `SELECT user_id, question_id, answer, accept, importance FROM answers
      WHERE user_id IN (SELECT id FROM users WHERE seeded = 1) ORDER BY user_id, question_id`,
  );
  return JSON.stringify({ users, answers });
}
check('seeding is deterministic (same seed → same world)', fingerprint(db2) === fingerprint(db3));
db2.close();
db3.close();

/* ----------------------------------------------------- score invariants */

const { buildPool } = await import('../server/domain/discovery.js');
const { hydrateUser, ageOf } = await import('../server/domain/eligibility.js');
const { QUESTIONS_BY_ID } = await import('../server/seed/questions.js');

const demoRow = get(db, `SELECT * FROM users WHERE id = 'usr_demo'`);
const demoUser = hydrateUser(demoRow);
check('demo profile has 46 answers', get(db, `SELECT COUNT(*) c FROM answers WHERE user_id = 'usr_demo'`).c === 46);
check('demo profile has photos', get(db, `SELECT COUNT(*) c FROM photos WHERE user_id = 'usr_demo'`).c === 4);

const pooled = buildPool(db, demoUser, { now: '2026-06-15T12:00:00.000Z', questions: QUESTIONS_BY_ID });
check('demo pool is populated', pooled.pool.length >= 10, `${pooled.pool.length} candidates`);
check('demo pool has a plausible score spread', (() => {
  const scored = pooled.pool.filter((entry) => entry.score.ok).map((entry) => entry.score.match);
  const high = scored.filter((value) => value >= 80).length;
  const low = scored.filter((value) => value < 40).length;
  return high > 0 && low > 0;
})());

// Every pooled candidate must pass eligibility — the pool must not contain people the product
// itself would hide (the classic "my filters work but I am shown to people outside theirs" bug).
const { eligibility } = await import('../server/domain/eligibility.js');
const now = '2026-06-15T12:00:00.000Z';
let eligibilityViolations = 0;
for (const entry of pooled.pool) {
  if (!eligibility(demoUser, entry.user, { now }).ok) eligibilityViolations += 1;
}
check('every pooled candidate is eligible in both directions', eligibilityViolations === 0, `${eligibilityViolations} violations`);

// Recompute a score from the database and compare with what the pool reported: the seeded data and
// the live kernel must agree, or every badge in the UI is a lie.
let scoreMismatches = 0;
for (const entry of pooled.pool.slice(0, 20)) {
  if (!entry.score.ok) continue;
  const viewerAnswers = all(db, `SELECT question_id, answer, accept, importance FROM answers WHERE user_id = 'usr_demo'`)
    .map((row) => ({ ...row, accept: parseJson(row.accept, []) }));
  const candidateAnswers = all(db, `SELECT question_id, answer, accept, importance FROM answers WHERE user_id = ?`, entry.user.id)
    .map((row) => ({ ...row, accept: parseJson(row.accept, []) }));
  const recomputed = compat.scoreAnswerRows(viewerAnswers, candidateAnswers, { questions: QUESTIONS_BY_ID });
  if (!recomputed.ok || recomputed.match !== entry.score.match) scoreMismatches += 1;
}
check('live scores reconcile with recomputation from rows', scoreMismatches === 0, `${scoreMismatches} mismatches`);

// Sanity for the kernel itself on the real question set.
check('self-score of identical answers is 100%', (() => {
  const rows = all(db, `SELECT question_id, answer, accept, importance FROM answers WHERE user_id = 'usr_demo'`)
    .map((row) => ({ ...row, accept: parseJson(row.accept, []) }));
  const selfScore = compat.scoreAnswerRows(rows, rows);
  return selfScore.ok && selfScore.match === 100;
})());

/* ------------------------------------------------------------- the API */

const app = createZimDateServer({ db });
const server = createServer((req, res) => {
  app.handle(req, res).catch((error) => {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const meta = await (await fetch(`${base}/api/meta`)).json();
const routeNames = meta.routes;
check('meta advertises every route', routeNames.length >= 40, String(routeNames.length));

// Public routes that must work signed out.
for (const path of ['/api/health', '/api/meta', '/api/questions']) {
  const response = await fetch(`${base}${path}`);
  check(`GET ${path} works signed out`, response.status === 200, String(response.status));
}

// Private routes must all refuse anonymous callers.
const privateRoutes = routeNames
  .filter((entry) => entry.startsWith('GET'))
  .map((entry) => entry.slice(4))
  .filter((path) => path.startsWith('/api/') && !path.startsWith('/api/admin'))
  .filter((path) => !['/api/health', '/api/meta', '/api/questions', '/api/auth/me'].includes(path) && !path.includes(':'));
for (const path of privateRoutes) {
  const response = await fetch(`${base}${path}`);
  if (response.status !== 401) check(`GET ${path} requires a session`, false, `got ${response.status}`);
}
check('all private GET routes require a session', true, `${privateRoutes.length} routes checked`);

// Signed-in walk over the whole surface.
const loginResponse = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
});
const cookie = loginResponse.headers.getSetCookie()[0].split(';')[0];
const login = await loginResponse.json();
const csrf = login.csrf;
check('demo login works', loginResponse.status === 200 && Boolean(login.user), String(loginResponse.status));

const authed = (path) => fetch(`${base}${path}`, { headers: { Cookie: cookie } });
const mutate = (path, body = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-ZimDate-CSRF': csrf },
    body: JSON.stringify(body),
  });

for (const path of ['/api/stack', '/api/discover', '/api/matches', '/api/likes-you', '/api/answers', '/api/notifications', '/api/me/views', '/api/boost']) {
  const response = await authed(path);
  const payload = await response.json();
  check(`GET ${path} responds for a signed-in user`, response.status === 200, `${response.status} ${payload.error?.message ?? ''}`);
}

const stackPayload = await (await authed('/api/stack?limit=5')).json();
check('stack returns ranked cards', stackPayload.cards.length > 0);
check('stack returns the inbound-like lane', Array.isArray(stackPayload.inbound), 'missing inbound lane');

// Rate-limit and quota guards must produce stable codes, not 500s.
const badLike = await mutate('/api/likes/usr_demo');
check('liking yourself is rejected with a stable code', badLike.status === 400, String(badLike.status));
const badReport = await mutate('/api/report/usr_0001', { reason: 'nope' });
check('invalid report reason is rejected', badReport.status === 400);
const unknownField = await fetch(`${base}/api/me`, {
  method: 'PATCH',
  headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-ZimDate-CSRF': csrf },
  body: JSON.stringify({ coins: 99999 }),
});
check('protected fields are rejected, not silently dropped', unknownField.status === 400);

// Admin surface.
const adminLogin = await (await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
})).json();
const adminCookie = adminLogin.user ? null : null;
const adminResponse = await fetch(`${base}/api/admin/stats`, {
  headers: { Cookie: loginResponse.headers.getSetCookie()[0].split(';')[0] },
});
check('non-admins cannot read admin stats', adminResponse.status === 403, String(adminResponse.status));

// Static surface.
for (const path of ['/', '/styles.css', '/js/app.js', '/favicon.svg', '/manifest.webmanifest']) {
  const response = await fetch(`${base}${path}`);
  check(`static ${path} is served`, response.status === 200, String(response.status));
}
const indexHtml = await (await fetch(`${base}/`)).text();
check('SPA shell references the app bundle', indexHtml.includes('/js/app.js'));
check('SPA shell declares the viewport', indexHtml.includes('width=device-width'));
const css = await (await fetch(`${base}/styles.css`)).text();
check('stylesheet defines the design tokens', css.includes('--clay-600') && css.includes('--font-display'));
check('stylesheet includes a reduced-motion guard', css.includes('prefers-reduced-motion'));

// Timing: the whole surface must stay fast enough to demo.
const started = Date.now();
for (let index = 0; index < 10; index += 1) await authed('/api/stack?limit=20');
const perRequest = (Date.now() - started) / 10;
check('stack responds under 250 ms on a 500-profile world', perRequest < 250, `${Math.round(perRequest)} ms`);

await new Promise((resolve) => server.close(resolve));
db.close();
rmSync(tempDir, { recursive: true, force: true });

/* ---------------------------------------------------------------- report */

const passed = checks.filter((entry) => entry.ok).length;
console.log(`\nZimDate selftest — ${passed}/${checks.length} checks passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`Seed time: ${seedMs} ms · stack: ${Math.round(perRequest)} ms/request · ${counts.answers} answers`);
process.exit(0);
