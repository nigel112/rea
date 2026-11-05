/**
 * Route matching.
 *
 * Kept separate from the server factory because it is the one piece of the HTTP layer that is pure:
 * give it the route table, a method and a pathname, get back a handler + params. That makes the
 * matcher directly testable without booting anything, and keeps `api.js` about handlers rather than
 * about string slicing.
 */

/**
 * @typedef {[string, string, Function, {public?: boolean}]} Route
 */

/**
 * Find the route for a request. `HEAD` is served by the `GET` handler, which is what every HTTP
 * server should do and what `node:http` will not do for you.
 *
 * @param {Route[]} routes
 * @param {string} method
 * @param {string} pathname
 * @returns {{handler: Function, options: object, params: Record<string,string>, pattern: string} | null}
 */
export function matchRoute(routes, method, pathname) {
  for (const [routeMethod, pattern, handler, options] of routes) {
    if (routeMethod !== method && !(method === 'HEAD' && routeMethod === 'GET')) continue;
    const params = matchPattern(pattern, pathname);
    if (params) return { handler, options, params, pattern };
  }
  return null;
}

/**
 * Match `:param` segments. Returns `null` on no match, `{}` for a literal match.
 *
 * A malformed percent-escape is treated as "no route" rather than as a 500: the URL is attacker
 * controlled and `decodeURIComponent` throws on input like `%E0%A4%A`.
 *
 * @param {string} pattern
 * @param {string} pathname
 * @returns {Record<string,string> | null}
 */
export function matchPattern(pattern, pathname) {
  if (!pattern.includes(':')) return pattern === pathname ? {} : null;
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
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
