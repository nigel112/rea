/**
 * Tiny client store.
 *
 * The session, the question catalogue and the meta payload are read by nearly every screen. They
 * are cached here (not in localStorage — the server is the only source of truth) and invalidated
 * explicitly after mutations that change them.
 */
import { endpoints, setCsrf, onUnauthenticated } from './api.js';

const state = {
  meta: null,
  me: null,
  questionIndex: new Map(),
  ready: false,
  csrf: null,
};

const subscribers = new Set();

export function subscribe(handler) {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

function emit(event) {
  for (const handler of subscribers) handler(event, state);
}

export function getState() {
  return state;
}

export async function loadBoot() {
  const [meta, me] = await Promise.all([endpoints.meta(), endpoints.me()]);
  state.meta = meta;
  state.questionIndex = new Map(meta.questions.map((question) => [question.id, question]));
  applyMe(me);
  state.ready = true;
  return state;
}

export function applyMe(me) {
  state.me = me?.user ?? null;
  state.csrf = me?.csrf ?? null;
  state.counters = {
    unreadLikes: me?.unreadLikes ?? 0,
    unreadMessages: me?.unreadMessages ?? 0,
    unreadNotifications: me?.unreadNotifications ?? 0,
  };
  if (state.csrf) setCsrf(state.csrf);
  emit('me');
}

export async function refreshMe() {
  const me = await endpoints.me();
  applyMe(me);
  return state.me;
}

export function isAuthed() {
  return Boolean(state.me);
}

export function questionFor(questionId) {
  return state.questionIndex.get(questionId) ?? null;
}

/** Keep the shell in sync when any request reports a lost session. */
onUnauthenticated(() => {
  if (!state.me) return;
  state.me = null;
  state.csrf = null;
  emit('unauthenticated');
});
