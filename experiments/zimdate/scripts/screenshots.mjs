/**
 * Renders the real screens to static HTML files so they can be inspected without a browser.
 *
 * Chromium cannot be downloaded in this sandbox, so "does it look right?" is answered by rendering
 * the actual client modules against a live server and writing the resulting DOM (plus the real
 * stylesheet) to `artifacts/screens/*.html`. Open one in any browser and it looks exactly like the
 * app, because it *is* the app's markup and CSS — only the event handlers are absent.
 *
 * Run:  node scripts/screenshots.mjs     (needs jsdom: npm i -D jsdom)
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'artifacts', 'screens');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.error('This script needs jsdom:  npm i -D jsdom');
  process.exit(2);
}

const { openAndMigrate } = await import('../server/db/index.js');
const { createZimDateServer } = await import('../server/api.js');
const { seedDatabase, DEMO_EMAIL, DEMO_PASSWORD } = await import('../server/seed/seed.js');

const tempDir = mkdtempSync(join(tmpdir(), 'zimdate-shots-'));
const db = openAndMigrate(join(tempDir, 'shots.db'));
seedDatabase(db, { profiles: 500, now: '2026-11-04T09:00:00.000Z' });
const app = createZimDateServer({ db });
const server = createServer((request, response) => app.handle(request, response));
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const dom = new JSDOM(readFileSync(join(root, 'public', 'index.html'), 'utf8'), {
  url: `${base}/#/welcome`,
  pretendToBeVisual: true,
});
const { window } = dom;
window.scrollTo = () => {};
if (!window.CSS) window.CSS = {};
if (typeof window.CSS.escape !== 'function') {
  window.CSS.escape = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
if (!window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
}

const nodeFetch = globalThis.fetch;
const cookieJar = new Map();
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const absolute = url.startsWith('http') ? url : `${base}${url}`;
  const headers = { ...(init.headers ?? {}) };
  if (!headers.Cookie && cookieJar.size > 0) {
    headers.Cookie = [...cookieJar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
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

for (const key of ['document', 'HTMLElement', 'Event', 'CustomEvent', 'Node', 'location', 'history', 'MutationObserver']) {
  if (window[key] === undefined) continue;
  try { globalThis[key] = window[key]; } catch { /* getter-only globals are fine */ }
}
globalThis.window = window;
globalThis.fetch = window.fetch;

const store = await import('../public/js/store.js');
const { esc, safeImageUrl, matchRing, formatMatch, toast, emptyState } = await import('../public/js/ui.js');
const { icon } = await import('../public/js/icons.js');
const { api } = await import('../public/js/api.js');
await store.loadBoot();

const loginResponse = await window.fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
});
const session = await loginResponse.json();
await store.loadBoot();
await store.refreshMe();
void session;

const stackPayload = await (await window.fetch('/api/stack?limit=30')).json();
const candidate = stackPayload.cards?.[0]?.profile?.id;
const matchPayload = await (await window.fetch('/api/matches')).json();
const matchId = matchPayload.matches?.[0]?.id;

const screens = [
  { name: '01-welcome', screen: 'welcome', signedOut: true },
  { name: '02-discover', screen: 'discover' },
  { name: '03-questions', screen: 'questions' },
  { name: '04-profile', screen: 'profile', params: { userId: candidate } },
  { name: '05-matches', screen: 'matches' },
  { name: '06-conversation', screen: 'matches', params: { matchId } },
  { name: '07-likes', screen: 'likes' },
  { name: '08-me', screen: 'me' },
  { name: '09-settings', screen: 'settings' },
  { name: '10-plans', screen: 'plans' },
  { name: '11-notifications', screen: 'notifications' },
  { name: '12-admin', screen: 'admin' },
];

const cssText = readFileSync(join(root, 'public', 'styles.css'), 'utf8');
const icons = await (await window.fetch('/favicon.svg')).text();
mkdirSync(outDir, { recursive: true });

const view = window.document.getElementById('view');
let written = 0;

for (const entry of screens) {
  const module = await import(`../public/js/screens/${entry.screen}.js`);
  view.innerHTML = '';
  try {
    await module.render(view, {
      store,
      api,
      icon,
      esc,
      toast,
      emptyState,
      params: entry.params ?? {},
      query: new URLSearchParams(),
    });
  } catch (error) {
    console.error(`render failed for ${entry.name}: ${error.message}`);
    continue;
  }
  await new Promise((resolve) => setTimeout(resolve, 450));

  // Inline every photo the screen references so the file is self-contained.
  const images = [...view.querySelectorAll('img')];
  const inlined = new Map();
  for (const image of images) {
    const source = image.getAttribute('src');
    if (!source || inlined.has(source)) continue;
    try {
      const response = await nodeFetch(`${base}${source}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      inlined.set(source, `data:${response.headers.get('content-type') ?? 'image/svg+xml'};base64,${buffer.toString('base64')}`);
    } catch { /* leave the relative URL if it cannot be read */ }
  }
  for (const [source, data] of inlined) {
    for (const image of view.querySelectorAll(`img[src="${source}"]`)) image.setAttribute('src', data);
  }

  const chrome = window.document.querySelector('.shell')?.outerHTML
    ?? `<main id="view">${view.innerHTML}</main>`;

  const html = `<!doctype html>
<html lang="en-ZW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZimDate — ${entry.name}</title>
<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(icons).toString('base64')}">
<style>${cssText}</style>
</head>
<body>
${chrome}
</body>
</html>`;
  writeFileSync(join(outDir, `${entry.name}.html`), html);
  written += 1;
  console.log(`wrote ${entry.name}.html (${Math.round(html.length / 1024)} kB)`);
}

await new Promise((resolve) => server.close(resolve));
db.close();
rmSync(tempDir, { recursive: true, force: true });
console.log(`\n${written}/${screens.length} screens rendered into artifacts/screens/`);
