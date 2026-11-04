/**
 * API client.
 *
 * One place owns: CSRF header injection, cookie credentials, error normalisation, and the
 * "session expired" path. Every screen gets the same error shape instead of four different ones.
 */

let csrfToken = null;
const listeners = new Set();

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.fields = extra.fields ?? null;
  }
}

export function setCsrf(token) {
  csrfToken = token ?? null;
}

export function getCsrf() {
  return csrfToken;
}

/** Subscribe to auth loss (401) so the shell can route to the sign-in screen. */
export function onUnauthenticated(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function emitUnauthenticated() {
  for (const handler of listeners) handler();
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['X-ZimDate-CSRF'] = csrfToken;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(0, 'network_error', 'Cannot reach ZimDate. Check your connection.', { cause: String(error) });
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, 'bad_response', 'The server sent an unexpected response.');
    }
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    if (response.status === 401 && error.code === 'unauthenticated') emitUnauthenticated();
    throw new ApiError(
      response.status,
      error.code ?? 'http_error',
      error.message ?? `Request failed (${response.status}).`,
      error,
    );
  }
  return payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

/* ------------------------------------------------------------ endpoint sugar */

export const endpoints = {
  meta: () => api.get('/api/meta'),
  me: () => api.get('/api/auth/me'),
  login: (email, password) => api.post('/api/auth/login', { email, password }),
  signup: (payload) => api.post('/api/auth/signup', payload),
  logout: () => api.post('/api/auth/logout'),

  questions: (category) => api.get(`/api/questions${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  myAnswers: () => api.get('/api/answers'),
  saveAnswer: (payload) => api.post('/api/answers', payload),
  deleteAnswer: (questionId) => api.del(`/api/answers/${encodeURIComponent(questionId)}`),

  stack: (limit = 12) => api.get(`/api/stack?limit=${limit}`),
  discover: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
    return api.get(`/api/discover${query.toString() ? `?${query}` : ''}`);
  },
  likesYou: () => api.get('/api/likes-you'),
  like: (userId, superLike = false) => api.post(`/api/likes/${encodeURIComponent(userId)}`, { superLike }),
  pass: (userId) => api.post(`/api/passes/${encodeURIComponent(userId)}`),
  undoPass: (userId) => api.del(`/api/passes/${encodeURIComponent(userId)}`),

  matches: () => api.get('/api/matches'),
  match: (matchId) => api.get(`/api/matches/${encodeURIComponent(matchId)}`),
  messages: (matchId, before) =>
    api.get(`/api/matches/${encodeURIComponent(matchId)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  sendMessage: (matchId, body, clientId) =>
    api.post(`/api/matches/${encodeURIComponent(matchId)}/messages`, { body, clientId }),
  markRead: (matchId) => api.post(`/api/matches/${encodeURIComponent(matchId)}/read`),
  unmatch: (matchId) => api.post(`/api/matches/${encodeURIComponent(matchId)}/unmatch`),

  profile: (userId) => api.get(`/api/profile/${encodeURIComponent(userId)}`),
  score: (userId) => api.get(`/api/score/${encodeURIComponent(userId)}`),

  updateMe: (patch) => api.patch('/api/me', patch),
  verifyMe: () => api.post('/api/me/verify', {}),
  uploadPhoto: (dataUrl) => api.post('/api/me/photos', { dataUrl }),
  deletePhoto: (photoId) => api.del(`/api/me/photos/${encodeURIComponent(photoId)}`),
  views: () => api.get('/api/me/views'),

  block: (userId) => api.post(`/api/block/${encodeURIComponent(userId)}`),
  unblock: (userId) => api.del(`/api/block/${encodeURIComponent(userId)}`),
  report: (userId, reason, details) => api.post(`/api/report/${encodeURIComponent(userId)}`, { reason, details }),

  notifications: () => api.get('/api/notifications'),
  readNotifications: () => api.post('/api/notifications/read'),

  boostStatus: () => api.get('/api/boost'),
  boost: () => api.post('/api/boost'),
  checkout: (tier) => api.post('/api/billing/checkout', { tier }),

  adminStats: () => api.get('/api/admin/stats'),
  adminReports: (status) => api.get(`/api/admin/reports${status ? `?status=${status}` : ''}`),
  adminResolve: (reportId, action, notes) => api.post(`/api/admin/reports/${encodeURIComponent(reportId)}`, { action, notes }),
  adminBan: (userId, banned) => api.post(`/api/admin/users/${encodeURIComponent(userId)}/ban`, { banned }),
  adminAudit: () => api.get('/api/admin/audit'),
};
