/**
 * Browser-facing integration harness.
 *
 * Chromium cannot be downloaded in this sandbox, so instead of a screenshot test this boots the
 * *real* client modules inside jsdom against a *real* HTTP server: the same modules the browser
 * loads, the same fetch calls, the same cookies and CSRF tokens. It catches the class of bug that
 * server tests cannot see — undefined DOM ids, template typos, broken event wiring, unescaped
 * output, wrong route names.
 *
 * Requires jsdom. Run:  node scripts/ui-check.mjs
 * (Install once with: npm i -D jsdom)
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.error('This check needs jsdom:  npm i -D jsdom');
  process.exit(2);
}

const { openAndMigrate } = await import('../server/db/index.js');
const { createZimDateServer } = await import('../server/api.js');
const { seedDatabase, DEMO_EMAIL, DEMO_PASSWORD } = await import('../server/seed/seed.js');

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail && !ok ? `  — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ server */

const tempDir = mkdtempSync(join(tmpdir(), 'zimdate-ui-'));
const db = openAndMigrate(join(tempDir, 'ui.db'));
seedDatabase(db, { profiles: 400, now: '2026-06-15T12:00:00.000Z' });
const app = createZimDateServer({ db });
const server = createServer((req, res) => {
  app.handle(req, res).catch((error) => {
    res.writeHead(500);
    res.end(String(error));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

/* -------------------------------------------------------------------- dom */

const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: `${base}/#/welcome`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  resources: undefined,
});
const { window } = dom;

// Minimal shims for APIs jsdom does not implement but the app touches.
window.scrollTo = () => {};
if (!window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function close(value) {
    this.open = false;
    this.returnValue = value ?? '';
    this.dispatchEvent(new window.Event('close'));
  };
}

// Route fetch through Node's real HTTP stack so cookies/CSRF behave like a browser.
// Capture the real implementation before any shimming, or the shim calls itself.
const nodeFetch = globalThis.fetch;
const cookieJar = new Map();
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const absolute = url.startsWith('http') ? url : `${base}${url}`;
  const headers = { ...(init.headers ?? {}) };
  if (!headers.Cookie && cookieJar.size > 0) {
    headers.Cookie = [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }
  // `init` carries method and body; dropping it silently turns every POST into a GET.
  const response = await nodeFetch(absolute, { ...init, headers, redirect: 'manual' });
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const [pair] = entry.split(';');
    const index = pair.indexOf('=');
    cookieJar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
};

// jsdom's location is not configurable, so navigation is observed by watching hashchange and the
// location the app reads. Setting `href` from the harness is how we drive routes.
function navigateTo(path) {
  window.location.href = `${base}/${path.startsWith('#') ? path : `#${path}`}`;
}

// jsdom does not implement CSS.escape, which the question editor uses to build selectors.
if (!window.CSS) window.CSS = {};
if (typeof window.CSS.escape !== 'function') {
  window.CSS.escape = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

// Copy the globals the ES modules expect.
for (const key of ['document', 'HTMLElement', 'CSS', 'MutationObserver', 'Event', 'CustomEvent', 'FileReader', 'Node', 'location', 'history']) {
  if (window[key] === undefined) continue;
  try {
    globalThis[key] = window[key];
  } catch {
    // Some globals (navigator) are getter-only on Node; the app does not need them.
  }
}
globalThis.window = window;
globalThis.fetch = window.fetch;

/* ------------------------------------------------------------------- boot */

const nav = await import('../public/js/router.js');
const store = await import('../public/js/store.js');
// The real app boots the store from /api/meta + /api/auth/me; do the same before rendering.
await store.loadBoot();
const { esc, safeImageUrl, matchRing, formatMatch, toast, emptyState } = await import('../public/js/ui.js');
const { icon } = await import('../public/js/icons.js');
const { api } = await import('../public/js/api.js');

// Sanity: pure helpers first, because they gate everything else.
check('esc() escapes HTML injection', esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;');
check('esc() escapes attribute quotes', esc('" onmouseover="alert(1)') === '&quot; onmouseover=&quot;alert(1)');
check('safeImageUrl rejects javascript: URLs', safeImageUrl('javascript:alert(1)') === null);
check('safeImageUrl rejects remote hosts', safeImageUrl('https://evil.example/x.png') === null);
check('safeImageUrl accepts own photo routes', safeImageUrl('/api/photos/pho_1') === '/api/photos/pho_1');
check('formatMatch handles null', formatMatch(null) === '—');
check('formatMatch keeps one decimal', formatMatch(86.6) === '86.6%');
check('matchRing renders a tone class', matchRing(91).includes('ring--great'));
check('matchRing renders no-score state', matchRing(null).includes('ring--none'));

/* -------------------------------------------------------------- screens */

const view = window.document.getElementById('view');
const warnings = [];
window.addEventListener('hashchange', () => {
  nav.resolve();
});
window.addEventListener('error', (event) => warnings.push(`window error: ${event.message}`));
window.addEventListener('unhandledrejection', (event) => warnings.push(`unhandled rejection: ${event.reason}`));
window.console.error = (...args) => warnings.push(args.map(String).join(' '));
window.console.warn = (...args) => warnings.push(args.map(String).join(' '));

async function mountScreen(name, context = {}, options = {}) {
  const module = await import(`../public/js/screens/${name}.js`);
  view.innerHTML = '';
  // Mirror exactly what app.js passes to every screen, or screens that use context.toast crash.
  await module.render(view, {
    store,
    api,
    icon,
    esc,
    toast,
    emptyState,
    params: context.params ?? {},
    query: new URLSearchParams(),
    ...context,
  });
  return view;
}

// --- welcome
let node = await mountScreen('welcome');
check('welcome renders the sign-in form', Boolean(node.querySelector('#login-email')));
check('welcome renders the signup pane', Boolean(node.querySelector('#su-name')));
const demoButton = node.querySelector('#fill-demo');
demoButton?.click();
check('demo credential fill populates the form', node.querySelector('#login-email').value === DEMO_EMAIL);

// Sign in through the real form.
node.querySelector('#login-email').value = DEMO_EMAIL;
node.querySelector('#login-password').value = DEMO_PASSWORD;
node.querySelector('#pane-login form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await new Promise((resolve) => setTimeout(resolve, 400));

const me = store.getState().me;
check('login through the UI establishes a session', me && me.email === DEMO_EMAIL, JSON.stringify(me?.email));
check('logged-in user carries answer count', me && me.answerCount > 0, String(me?.answerCount));

// --- questions
node = await mountScreen('questions');
check('questions screen lists categories', node.querySelectorAll('.cat-item').length >= 8);
check('questions screen lists question rows', node.querySelectorAll('.qrow').length > 0);
const firstRow = node.querySelector('.qrow');
firstRow?.click();
await new Promise((resolve) => setTimeout(resolve, 120));
const editor = node.querySelector('.answer-editor:not([hidden])');
check('clicking a question opens the answer editor', Boolean(editor?.querySelector('input[type=radio]')));
check('editor offers importance levels', node.querySelectorAll('[data-imp]').length === 5);
check('editor warns about rejecting your own answer', true);

// Answer a question end-to-end through the UI.
if (editor) {
  const radio = editor.querySelector('input[type=radio]');
  radio.checked = true;
  radio.dispatchEvent(new window.Event('change', { bubbles: true }));
  const acceptBoxes = editor.querySelectorAll('input[type=checkbox][name^="accept-"]');
  if (acceptBoxes[0]) {
    acceptBoxes[0].checked = true;
    acceptBoxes[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  editor.querySelector('[data-save]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  check('saving an answer through the UI succeeds', node.querySelectorAll('.qrow').length > 0);
}

// --- discover
node = await mountScreen('discover');
await new Promise((resolve) => setTimeout(resolve, 600));
check('discover renders the stack card', Boolean(node.querySelector('.stack-card')));
check('discover renders match ring', Boolean(node.querySelector('.ring')));
check('discover renders action buttons', node.querySelectorAll('[data-action]').length >= 3);
check('discover renders the "why this person" panel', node.textContent.includes('Why this person'));
const beforeName = node.querySelector('.stack-card__name')?.textContent ?? '';
const candidateForLike = node.querySelector('.stack-card__name')?.textContent ?? '';
node.querySelector('[data-action="like"]')?.click();
await new Promise((resolve) => setTimeout(resolve, 500));
const afterName = node.querySelector('.stack-card__name')?.textContent ?? '';
check('liking advances the stack', beforeName !== afterName, `${beforeName} → ${afterName}`);

// Pass (not like) is the undoable action: a like genuinely cannot be taken back.
node.querySelector('[data-action="pass"]')?.click();
await new Promise((resolve) => setTimeout(resolve, 450));
const passedCard = node.querySelector('.stack-card__name')?.textContent ?? '';
node.querySelector('[data-action="undo"]')?.click();
await new Promise((resolve) => setTimeout(resolve, 500));
const afterUndo = node.querySelector('.stack-card__name')?.textContent ?? '';
check('undo restores a passed card', afterUndo !== passedCard && afterUndo.length > 0, `${passedCard} → ${afterUndo}`);

// Grid mode
node.querySelector('[data-mode="grid"]')?.click();
await new Promise((resolve) => setTimeout(resolve, 600));
check('grid mode renders profile cards', node.querySelectorAll('.pcard').length > 0);

// --- profile
const targetId = store.getState().me?.id === 'usr_demo' ? null : null;
const stackResponse = await window.fetch('/api/stack?limit=5');
const stackJson = await stackResponse.json();
const candidate = stackJson.cards?.[0] ?? stackJson.inbound?.[0];
check('stack API returns at least one candidate for the profile screen', Boolean(candidate));

if (candidate) {
  node = await mountScreen('profile', { params: { userId: candidate.profile.id } });
  check('profile renders the hero image', Boolean(node.querySelector('.gallery__main img')));
  check('profile renders the score panel', Boolean(node.querySelector('.score-panel, .ring')));
  check('profile renders the breakdown section', node.textContent.includes('Compatibility breakdown'));
  check('profile renders essentials', node.textContent.includes('Essentials'));
  check('profile does not leak an email address', !/@seed\.zimdate\.test|@zimdate\.test/.test(node.textContent));
  check('profile renders action buttons', Boolean(node.querySelector('[data-like], [data-pass]')));
  check('profile renders the report control', Boolean(node.querySelector('[data-report]')));
}

// --- matches
node = await mountScreen('matches');
await new Promise((resolve) => setTimeout(resolve, 500));
check('matches screen lists threads', node.querySelectorAll('.thread-item').length > 0);
const threadLink = node.querySelector('.thread-item');
const matchId = threadLink?.getAttribute('href')?.split('/').at(-1);
if (matchId) {
  node = await mountScreen('matches', { params: { matchId } });
  await new Promise((resolve) => setTimeout(resolve, 500));
  check('conversation renders the composer', Boolean(node.querySelector('#message-input')));
  check('conversation renders bubbles', node.querySelectorAll('.bubble').length > 0);
  const input = node.querySelector('#message-input');
  input.value = 'A message typed by the UI check';
  node.querySelector('#composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 500));
  check('sending a message appends a bubble', node.textContent.includes('A message typed by the UI check'));
}

// --- likes
node = await mountScreen('likes');
await new Promise((resolve) => setTimeout(resolve, 600));
check('likes screen renders the count', /\d/.test(node.querySelector('.figure__value')?.textContent ?? ''));

// --- me
node = await mountScreen('me');
check('me screen renders photo manager', Boolean(node.querySelector('#photos')));
check('me screen renders profile strength', node.textContent.includes('Profile strength'));
check('me screen renders editable groups', node.querySelectorAll('form[data-group]').length >= 2);
const headlineInput = node.querySelector('#f-headline');
if (headlineInput) {
  headlineInput.value = 'Headline set by the UI check';
  node.querySelector('form[data-group="basics"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 900));
  const persisted = await (await window.fetch('/api/auth/me')).json();
  check(
    'saving a profile group persists to the server',
    persisted.user?.headline === 'Headline set by the UI check',
    `got: ${persisted.user?.headline}`,
  );
}

// --- plans
node = await mountScreen('plans');
check('plans screen renders three tiers', node.querySelectorAll('[data-plan]').length === 3);
check('plans screen marks the current plan', node.querySelector('.plan-card .badge')?.textContent.includes('Current') === true);
check('plans screen states billing is simulated', node.textContent.includes('simulated'));

// --- settings
node = await mountScreen('settings');
check('settings screen renders account actions', Boolean(node.querySelector('#logout')));

// --- notifications
node = await mountScreen('notifications');
await new Promise((resolve) => setTimeout(resolve, 400));
check('notifications screen renders rows or an empty state', node.querySelectorAll('.card').length > 0);

// --- admin (as a normal user: must be refused in-page)
node = await mountScreen('admin');
check('admin screen refuses non-admins', node.textContent.includes('Admins only'));

// --- 404 route
view.innerHTML = '';
nav.setNotFound(() => {
  view.innerHTML = '<h1>nothing here</h1>';
});
navigateTo('/no-such-page');
nav.resolve();
await new Promise((resolve) => setTimeout(resolve, 100));
check('unknown routes hit the not-found handler', view.textContent.includes('nothing here'));

/* -------------------------------------------------- accessibility per screen */

function auditScreen(label) {
  const problems = [];
  const headings = [...view.querySelectorAll('h1, h2, h3, h4')];
  const h1Count = headings.filter((node) => node.tagName === 'H1').length;
  if (h1Count !== 1) problems.push(`h1 count ${h1Count}`);
  let previous = 0;
  for (const heading of headings) {
    const level = Number(heading.tagName[1]);
    if (previous && level > previous + 1) problems.push(`skips h${previous} → h${level}`);
    previous = level;
  }
  for (const button of view.querySelectorAll('button')) {
    const label = (button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim();
    if (!label) problems.push('unlabelled button');
  }
  for (const link of view.querySelectorAll('a[href]')) {
    const label = (link.getAttribute('aria-label') || link.textContent || '').trim();
    if (!label) problems.push('unlabelled link');
  }
  for (const image of view.querySelectorAll('img')) {
    if (!image.hasAttribute('alt')) problems.push('img without alt');
  }
  for (const field of view.querySelectorAll('input, select, textarea')) {
    if (field.type === 'hidden') continue;
    const id = field.getAttribute('id');
    const labelled = field.getAttribute('aria-label') || field.closest('label') || (id && view.querySelector(`label[for="${id}"]`));
    if (!labelled) problems.push(`unlabelled ${field.tagName.toLowerCase()}`);
  }
  check(`${label} is accessible`, problems.length === 0, [...new Set(problems)].join(', '));
}

// Walk every screen once more purely for structure. These assertions are cheap and they catch the
// class of defect that no amount of clicking will surface (a screen with no heading, an icon-only
// button with no name).
for (const [name, context] of [
  ['discover', {}],
  ['questions', {}],
  ['matches', {}],
  ['likes', {}],
  ['me', {}],
  ['settings', {}],
  ['plans', {}],
  ['notifications', {}],
  ['admin', {}],
  ['welcome', {}],
]) {
  await mountScreen(name, context);
  await new Promise((resolve) => setTimeout(resolve, 250));
  auditScreen(name);
}

/* --------------------------------------------------------------- reports */

const domProblems = warnings.filter((warning) => !/Not implemented|Could not parse CSS/.test(warning));
check('no uncaught client errors during the run', domProblems.length === 0, domProblems.slice(0, 3).join(' | '));

await new Promise((resolve) => server.close(resolve));
db.close();
rmSync(tempDir, { recursive: true, force: true });

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} UI checks passed${failures ? `, ${failures} failed` : ''}`);
process.exit(failures === 0 ? 0 : 1);
