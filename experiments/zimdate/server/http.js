/**
 * A deliberately small HTTP layer over node:http.
 *
 * No framework, because the interesting parts of this project are the domain rules; a dependency
 * would hide them behind middleware. What we do need is here and explicit:
 *   - JSON body parsing with a hard size cap
 *   - consistent error envelope { error: { code, message, ...extra } }
 *   - security headers, including a strict CSP
 *   - static file serving with path traversal protection and ETags
 *   - cookie parsing and CSRF enforcement for unsafe methods
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB: enough for a base64 photo, small enough to be safe

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Frame embedding.
 *
 * `X-Frame-Options: SAMEORIGIN` and CSP `frame-ancestors 'self'` are the correct defaults, and
 * they are what a real deployment wants: clickjacking is a real attack and a dating site is a
 * tempting target. But they also mean the app cannot be shown inside an iframe on another origin,
 * which is exactly how hosted preview environments (and embedding a demo in a portfolio page) work.
 *
 * So this is a decision, not a default: `ZIMDATE_FRAME_ANCESTORS` overrides the allowlist. Set it to
 * `'none'` for production, or to the specific origins allowed to frame the app.
 *
 * @param {string | undefined} ancestors
 */
export function securityHeaders(ancestors = process.env.ZIMDATE_FRAME_ANCESTORS) {
  const allow = ancestors === undefined ? "'self'" : ancestors;
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    'Content-Security-Policy':
      `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; ` +
      `script-src 'self'; connect-src 'self'; frame-ancestors ${allow}; base-uri 'self'; form-action 'self'`,
  };
  // X-Frame-Options has no origin allowlist worth using (the grammar is broken in every browser)
  // and it *overrides* frame-ancestors wherever both are sent. Send it only when we are refusing
  // all framing; otherwise let CSP do the work.
  if (allow.replace(/\s/g, '') === "'none'" || allow.replace(/\s/g, '') === "'self'") {
    headers['X-Frame-Options'] = allow.replace(/\s/g, '') === "'none'" ? 'DENY' : 'SAMEORIGIN';
  }
  return Object.freeze(headers);
}

/** Headers computed once per process from the environment. */
export const SECURITY_HEADERS = securityHeaders();

export function sendJson(res, status, payload, extraHeaders = {}, baseHeaders = SECURITY_HEADERS) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...baseHeaders,
    ...extraHeaders,
  });
  res.end(body);
}

export function sendError(res, error, baseHeaders = SECURITY_HEADERS) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal_error';
  const message =
    error instanceof HttpError
      ? error.message
      : process.env.ZIMDATE_DEBUG === '1'
        ? String(error?.message ?? error)
        : 'Something went wrong on our side.';
  if (!(error instanceof HttpError) && process.env.ZIMDATE_QUIET !== '1') {
    console.error('[zimdate] unhandled error', error);
  }
  sendJson(res, status, { error: { code, message, ...(error?.extra ?? {}) } }, {}, baseHeaders);
}

export async function readJsonBody(req, options = {}) {
  const limit = options.limit ?? MAX_BODY_BYTES;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'body_too_large', 'That request is too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'invalid_body', 'Expected a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_json', 'That request body is not valid JSON.');
  }
}

/** Static serving with traversal guards. Returns false when the file does not exist. */
export async function serveStatic(res, absolutePath, mimeType, req, options = {}) {
  const baseHeaders = options.headers ?? SECURITY_HEADERS;
  const { readFile, stat } = await import('node:fs/promises');
  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, ...baseHeaders });
    res.end();
    return true;
  }

  const bytes = await readFile(absolutePath);
  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': bytes.length,
    ETag: etag,
    'Cache-Control': options.cacheControl ?? 'public, max-age=0, must-revalidate',
    ...baseHeaders,
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(bytes);
  return true;
}

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
});

export function mimeFor(pathname) {
  const index = pathname.lastIndexOf('.');
  if (index === -1) return 'application/octet-stream';
  return MIME_TYPES[pathname.slice(index).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a URL path inside a root directory, rejecting traversal attempts.
 * Returns null when the path escapes the root or contains a null byte.
 */
export function safeJoin(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\0')) return null;
  const normalised = decoded.replace(/\\/g, '/');
  if (normalised.split('/').includes('..')) return null;
  const relative = normalised.replace(/^\/+/, '');
  const full = `${root}/${relative}`;
  if (!full.startsWith(`${root}/`)) return null;
  return full;
}

export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export function isSecureRequest(req, trustProxy = false) {
  if (req.socket?.encrypted) return true;
  if (trustProxy) {
    const proto = req.headers['x-forwarded-proto'];
    if (typeof proto === 'string') return proto.split(',')[0].trim() === 'https';
  }
  return false;
}
