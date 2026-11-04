/**
 * ZimDate client shell.
 *
 * Responsibilities: boot the store, render chrome (top bar / tab bar), guard routes, dispatch to
 * screens, and own the global keyboard shortcuts. Screens are lazy-imported modules with a single
 * `render(host, context)` export so the initial payload stays small.
 */
import { icon, brandMark } from './icons.js';
import { api } from './api.js';
import { route, setNotFound, beforeEach, start, navigate, currentRoute } from './router.js';
import * as store from './store.js';
import { esc, toast, focusMain, setTitle, emptyState } from './ui.js';

const view = document.getElementById('view');
const topbar = document.getElementById('topbar');
const nav = document.getElementById('nav');
const tabbar = document.getElementById('tabbar');
const tabbarInner = document.getElementById('tabbar-inner');

/* --------------------------------------------------------------- chrome */

const NAV_ITEMS = [
  { path: '/discover', label: 'Discover', icon: 'compass', counter: null },
  { path: '/matches', label: 'Messages', icon: 'chat', counter: 'unreadMessages' },
  { path: '/questions', label: 'Questions', icon: 'sparkle', counter: null },
  { path: '/likes', label: 'Likes', icon: 'heart', counter: 'unreadLikes' },
  { path: '/me', label: 'Me', icon: 'user', counter: null },
];

function badges() {
  return store.getState().counters ?? { unreadLikes: 0, unreadMessages: 0, unreadNotifications: 0 };
}

function renderChrome() {
  const authed = store.isAuthed();
  const me = store.getState().me;
  const counts = badges();

  document.querySelector('.brand__mark') && (document.querySelector('.brand__mark').innerHTML = brandMark);
  topbar.hidden = !authed;
  tabbar.hidden = !authed;
  if (!authed) return;

  const activePath = (window.location.hash || '#/discover').replace(/^#/, '').split('?')[0].split('/')[1];

  const items = NAV_ITEMS.map((item) => {
    const count = item.counter ? counts[item.counter] : 0;
    const active = activePath === item.path.slice(1) || (item.path === '/discover' && activePath === '');
    return { ...item, count, active };
  });

  nav.innerHTML = items
    .map(
      (item) => `<a class="nav__link" href="#${item.path}" ${item.active ? 'aria-current="page"' : ''}>
        ${icon(item.icon, { size: 17 })}<span>${esc(item.label)}</span>
        ${item.count > 0 ? `<span class="nav__badge">${item.count > 9 ? '9+' : item.count}</span>` : ''}
      </a>`,
    )
    .join('') +
    `<a class="nav__link" href="#/plans" title="Plans">${icon('crown', { size: 17 })}<span>${esc(me?.tier === 'free' ? 'Go Plus' : 'Plan')}</span></a>
     <a class="nav__link" href="#/settings" title="Settings">${icon('settings', { size: 17 })}<span>Settings</span></a>`;

  tabbarInner.innerHTML = items
    .map(
      (item) => `<a class="tabbar__link" href="#${item.path}" ${item.active ? 'aria-current="page"' : ''}>
        ${icon(item.icon, { size: 22 })}
        <span>${esc(item.label === 'Messages' ? 'Chats' : item.label)}</span>
        ${item.count > 0 ? `<span class="tabbar__badge">${item.count > 9 ? '9+' : item.count}</span>` : ''}
      </a>`,
    )
    .join('');
}

/* ------------------------------------------------------------- guards */

beforeEach(async (context, options) => {
  // Screens that work signed-out declare `public: true`.
  if (options?.public) return true;
  if (!store.isAuthed()) {
    store.getState().redirectAfterAuth = `#${context.pathname}`;
    navigate('/welcome', { replace: true });
    return false;
  }
  // Signing-in screens are pointless when authed.
  if (options?.guestOnly && store.isAuthed()) {
    navigate('/discover', { replace: true });
    return false;
  }
  return true;
});

/* ------------------------------------------------------------- screens */

const screens = {
  welcome: () => import('./screens/welcome.js'),
  discover: () => import('./screens/discover.js'),
  questions: () => import('./screens/questions.js'),
  matches: () => import('./screens/matches.js'),
  likes: () => import('./screens/likes.js'),
  profile: () => import('./screens/profile.js'),
  me: () => import('./screens/me.js'),
  settings: () => import('./screens/settings.js'),
  plans: () => import('./screens/plans.js'),
  admin: () => import('./screens/admin.js'),
  notifications: () => import('./screens/notifications.js'),
};

async function mount(name, context, options = {}) {
  try {
    const module = await screens[name]();
    // A newer navigation may have started while the module was loading.
    view.innerHTML = '';
    setTitle(options.title);
    await module.render(view, { ...context, store, api, icon, esc, toast, emptyState });
    focusMain();
  } catch (error) {
    console.error(`[zimdate] failed to render ${name}`, error);
    view.innerHTML = `<div class="empty">
      ${icon('alert', { size: 52, class: 'empty__icon' })}
      <h3>That screen could not load</h3>
      <p class="muted">${esc(error?.message ?? 'Unknown error')}</p>
      <button class="btn btn--primary" onclick="location.reload()">Reload</button>
    </div>`;
  }
}

/* ------------------------------------------------------------- routes */

route('/welcome', (context) => mount('welcome', context, { public: true, guestOnly: true, title: 'Welcome' }), {
  public: true,
  guestOnly: true,
});

route('/discover', (context) => mount('discover', context, { title: 'Discover' }));
route('/questions', (context) => mount('questions', context, { title: 'Questions' }));
route('/matches', (context) => mount('matches', context, { title: 'Messages' }));
route('/matches/:matchId', (context) => mount('matches', context, { title: 'Conversation' }));
route('/likes', (context) => mount('likes', context, { title: 'Likes' }));
route('/profile/:userId', (context) => mount('profile', context, { title: 'Profile' }));
route('/me', (context) => mount('me', context, { title: 'My profile' }));
route('/settings', (context) => mount('settings', context, { title: 'Settings' }));
route('/plans', (context) => mount('plans', context, { title: 'Plans' }));
route('/notifications', (context) => mount('notifications', context, { title: 'Notifications' }));
route('/admin', (context) => mount('admin', context, { title: 'Trust & Safety' }));

setNotFound((context) => {
  setTitle('Not found');
  view.innerHTML = emptyState({
    title: 'Nothing here',
    body: 'That link does not point anywhere in ZimDate.',
    iconName: 'compass',
    action: '<a class="btn btn--primary" href="#/discover">Back to discovery</a>',
  });
});

/* ------------------------------------------------------- global behaviour */

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (typing) return;
  if (event.key === '?' && store.isAuthed()) {
    event.preventDefault();
    showShortcuts();
  }
});

function showShortcuts() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <div class="modal__body">
      <h3>Keyboard shortcuts</h3>
      <dl class="kv" style="grid-template-columns:1fr auto">
        <dt><kbd>←</kbd> / <kbd>→</kbd></dt><dd>Pass / like in discovery</dd>
        <dt><kbd>u</kbd></dt><dd>Undo the last pass</dd>
        <dt><kbd>g</kbd> then <kbd>d</kbd></dt><dd>Go to discovery</dd>
        <dt><kbd>g</kbd> then <kbd>q</kbd></dt><dd>Go to questions</dd>
        <dt><kbd>g</kbd> then <kbd>m</kbd></dt><dd>Go to messages</dd>
        <dt><kbd>?</kbd></dt><dd>This dialog</dd>
      </dl>
    </div>
    <div class="modal__foot"><button class="btn btn--primary" data-close>Close</button></div>`;
  document.body.append(dialog);
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]') || event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

// `g` prefix navigation
let pendingG = false;
document.addEventListener('keydown', (event) => {
  if (!store.isAuthed()) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  if (event.key === 'g') {
    pendingG = true;
    setTimeout(() => {
      pendingG = false;
    }, 1200);
    return;
  }
  if (!pendingG) return;
  const map = { d: '/discover', q: '/questions', m: '/matches', l: '/likes', p: '/me' };
  const destination = map[event.key.toLowerCase()];
  if (destination) {
    pendingG = false;
    navigate(destination);
  }
});

store.subscribe((event) => {
  if (event === 'me' || event === 'unauthenticated') renderChrome();
  if (event === 'unauthenticated') {
    toast('Your session ended. Sign in again to continue.', { kind: 'error' });
    navigate('/welcome', { replace: true });
  }
});

/* ------------------------------------------------------------------- boot */

async function boot() {
  try {
    await store.loadBoot();
  } catch (error) {
    console.error('[zimdate] boot failed', error);
    view.innerHTML = `<div class="empty">
      ${icon('alert', { size: 52, class: 'empty__icon' })}
      <h3>ZimDate could not start</h3>
      <p class="muted">${esc(error?.message ?? 'The server did not respond.')}</p>
      <button class="btn btn--primary" onclick="location.reload()">Try again</button>
    </div>`;
    return;
  }

  renderChrome();

  if (!store.isAuthed() && !window.location.hash) {
    window.location.replace(`${window.location.pathname}${window.location.search}#/welcome`);
    return;
  }
  if (!store.isAuthed()) {
    const hash = window.location.hash.replace('#', '').split('?')[0];
    if (!hash.startsWith('/welcome')) {
      store.getState().redirectAfterAuth = window.location.hash;
      window.location.replace(`${window.location.pathname}${window.location.search}#/welcome`);
      return;
    }
  }
  await start();
  renderChrome();

  // Poll the counters cheaply so unread badges stay truthful while the tab is open.
  setInterval(async () => {
    if (!store.isAuthed() || document.hidden) return;
    try {
      const me = await api.get('/api/auth/me');
      const before = JSON.stringify(store.getState().counters ?? {});
      store.applyMe(me);
      if (JSON.stringify(store.getState().counters ?? {}) !== before) renderChrome();
    } catch {
      // A transient failure must never break the shell; the next poll (or action) will retry.
    }
  }, 45_000);
}

window.addEventListener('hashchange', () => renderChrome());
window.addEventListener('DOMContentLoaded', renderChrome, { once: true });

boot();

export { currentRoute };
