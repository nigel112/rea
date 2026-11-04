/**
 * Hash router.
 *
 * Hash routing (not History API) because the app is served from a single directory with no server
 * rewrite rules — deep links have to survive a plain static host and any sub-path prefix.
 *
 * Routes are matched most-specific first; a `:param` segment captures the decoded value.
 */
const routes = [];
let notFound = null;
let current = null;
const beforeHooks = [];

export function route(pattern, handler, options = {}) {
  routes.push({ pattern, handler, options, parts: pattern.split('/').filter(Boolean) });
}

export function setNotFound(handler) {
  notFound = handler;
}

/** Guard: return false (or throw) to abort navigation. */
export function beforeEach(hook) {
  beforeHooks.push(hook);
}

function currentPath() {
  const hash = window.location.hash || '#/';
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathname, query = ''] = path.split('?');
  return { pathname: pathname || '/', query: new URLSearchParams(query) };
}

function match(parts, pathParts) {
  if (parts.length !== pathParts.length) return null;
  const params = {};
  for (let index = 0; index < parts.length; index += 1) {
    const expected = parts[index];
    const actual = pathParts[index];
    if (expected.startsWith(':')) {
      if (!actual) return null;
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

let renderToken = 0;

export async function resolve() {
  const { pathname, query } = currentPath();
  const pathParts = pathname.split('/').filter(Boolean);
  for (const candidate of routes) {
    const params = match(candidate.parts, pathParts);
    if (!params) continue;
    const context = { params, query, pathname };
    for (const hook of beforeHooks) {
      const verdict = await hook(context, candidate.options);
      if (verdict === false) return;
    }
    current = candidate;
    const token = ++renderToken;
    const result = await candidate.handler(context);
    // A slower earlier navigation must not overwrite a newer one.
    if (token !== renderToken) return;
    return result;
  }
  if (notFound) return notFound({ params: {}, query, pathname });
  const view = document.getElementById('view');
  if (view) view.innerHTML = '<div class="empty"><h2>Page not found</h2><p class="muted">That page does not exist.</p><a class="btn btn--primary" href="#/discover">Go to discovery</a></div>';
}

export function navigate(path, options = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === target) {
    if (options.replace) return;
    return resolve();
  }
  if (options.replace) {
    window.location.replace(`${window.location.pathname}${window.location.search}${target}`);
    return;
  }
  window.location.hash = target;
}

export function currentRoute() {
  return current;
}

export function start() {
  window.addEventListener('hashchange', () => {
    resolve();
  });
  if (!window.location.hash) {
    window.location.replace(`${window.location.pathname}${window.location.search}#/discover`);
  }
  return resolve();
}
