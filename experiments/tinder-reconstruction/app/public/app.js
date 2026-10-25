// Tinder reconstruction client.
//
// Every network call goes through the local mock backend in ../server.mjs,
// which implements the contract recovered in ../../evidence/api-contract.json.
// Nothing here contacts Tinder.

const PHOTO_INTERVAL_MS = 6500;
const SWIPE_THRESHOLD = 110;
const SUPER_THRESHOLD = 120;
const CALL_LIMIT = 60;

const $ = (selector) => document.querySelector(selector);

const state = {
  token: localStorage.getItem("rea.tinder.token"),
  deviceId: localStorage.getItem("TinderWeb/uuid") ?? createDeviceId(),
  viewer: null,
  globals: null,
  profile: null,
  contract: null,
  evidence: null,
  view: "discover",
  recs: [],
  matches: [],
  likes: { items: [], count: 0, premium_required: true },
  activeMatchId: null,
  chat: [],
  chatPerson: null,
  typing: false,
  typingTimer: 0,
  unreadMatches: 0,
  calls: [],
  selectedCallId: null,
  inspectorOpen: false,
  inspectorTab: "network",
  busy: false,
  premium: false,
  socket: null,
  socketStatus: "offline",
  socketAttempts: 0,
  draft: "",
  openRouteId: null,
  challenge: null,
};

let photoTimer = 0;
let liveTimer = 0;

// ---------------------------------------------------------------------------
// Utilities

function createDeviceId() {
  const value =
    globalThis.crypto?.randomUUID?.() ??
    `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  localStorage.setItem("TinderWeb/uuid", value);
  return value;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ageFrom(birthDate) {
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (
    monthDelta < 0 ||
    (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())
  )
    age -= 1;
  return age;
}

function kmFromMiles(miles) {
  if (miles === null || miles === undefined) return null;
  return Math.max(1, Math.round(miles * 1.60934));
}

function distanceLabel(rec) {
  const km = kmFromMiles(rec.distance_mi);
  if (km !== null) return `${km} km away`;
  return rec.user.city?.name
    ? `Visiting from ${rec.user.city.name}`
    : "Distance hidden";
}

function timeAgo(iso) {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 45) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.round(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function clockTime(iso) {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function photoUrl(photo) {
  return photo?.processedFiles?.[0]?.url ?? photo?.url ?? "";
}

const ICONS = {
  flame:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.7 3.3 2.6 4.7 4.4 6.6C18.7 11 20.4 13.3 20.4 16.3c0 3.7-3.4 6.2-8.4 6.2s-8.4-2.4-8.4-6.1c0-2.3 1.1-4.4 3-6.3.3 1.4.8 2.4 2 3.1C8.8 9 10.5 5.7 12 2Z"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.5s-7.8-4.6-7.8-10A4.7 4.7 0 0 1 12 7.3a4.7 4.7 0 0 1 7.8 3.2c0 5.4-7.8 10-7.8 10Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8.4 8.4 0 0 1-9 8.4 9.7 9.7 0 0 1-3.2-.6L3 21l1.3-4.2A8.3 8.3 0 0 1 3 12a8.4 8.4 0 0 1 9-8.4A8.4 8.4 0 0 1 21 12Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.8 2.7 5.7 6.2.8-4.6 4.3 1.2 6.2L12 16.9l-5.5 2.9 1.2-6.2L3.1 9.3l6.2-.8L12 2.8Z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.4 2 4 13.6h5.7L8.6 22 20 9.9h-6.1L13.4 2Z"/></svg>',
  rewind:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h9a6 6 0 1 1-6 6"/><path d="m4 4 0 5h5"/></svg>',
  verified:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 2.6 2 3.2-.3 1 3.1 2.8 1.6-1.2 3 1.2 3-2.8 1.6-1 3.1-3.2-.3L12 22l-2.6-2-3.2.3-1-3.1L2.4 15.6l1.2-3-1.2-3 2.8-1.6 1-3.1 3.2.3L12 2Zm-1 13.4 5-5-1.4-1.4-3.6 3.6-1.7-1.7L7.9 12l3.1 3.4Z"/></svg>',
  arrowRight:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13m-5-6 6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H6m5-6-6 6 6 6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>',
  sparkle:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5 13.6 9l6.4 1.6-6.4 1.6L12 18.7l-1.6-6.5L4 10.6 10.4 9 12 2.5Zm7 12 1 3.4 3.3 1-3.3 1-1 3.4-1-3.4-3.3-1 3.3-1 1-3.4Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',
};

function icon(name) {
  return ICONS[name] ?? "";
}

// ---------------------------------------------------------------------------
// API client + call log

class ApiError extends Error {
  constructor(status, data) {
    super(`HTTP ${status}`);
    this.status = status;
    this.data = data;
  }
}

async function api(method, path, { body = null, auth = true } = {}) {
  const started = performance.now();
  const headers = { "persistent-device-id": state.deviceId };
  if (body !== null) headers["content-type"] = "application/json";
  if (auth && state.token) headers["x-auth-token"] = state.token;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    logCall({
      method,
      path,
      status: 0,
      ms: Math.round(performance.now() - started),
      request: body,
      response: { error: "network" },
    });
    throw new ApiError(0, { error: "network" });
  }
  const text = await response.text();
  let data;
  try {
    data = text === "" ? null : JSON.parse(text);
  } catch {
    data = text;
  }
  const entry = {
    id: `call_${Math.random().toString(36).slice(2, 9)}`,
    method,
    path,
    status: response.status,
    ms: Math.round(performance.now() - started),
    request: body,
    response: data,
    at: new Date().toISOString(),
  };
  logCall(entry);
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

function logCall(entry) {
  state.calls.unshift(entry);
  if (state.calls.length > CALL_LIMIT) state.calls.pop();
  if (state.inspectorOpen && state.inspectorTab === "network")
    renderInspector();
}

// ---------------------------------------------------------------------------
// Session

async function login() {
  const payload = await api("POST", "/v2/auth/login/guest", {
    auth: false,
    body: { device_id: state.deviceId },
  });
  state.token = payload.token;
  state.viewer = payload.user;
  state.deviceId = payload.device_id ?? state.deviceId;
  localStorage.setItem("rea.tinder.token", state.token);
  localStorage.setItem("TinderWeb/uuid", state.deviceId);
  await start();
}

async function restoreSession() {
  if (!state.token) return false;
  try {
    const meta = await api("GET", "/v2/meta");
    state.globals = meta.globals;
    const profile = await api(
      "GET",
      "/v2/profile?include=user,likes,boost,super_likes,travel,feature_access",
    );
    state.viewer = profile.data.user;
    state.premium = profile.data.feature_access?.can_see_likes === true;
    return true;
  } catch {
    state.token = null;
    localStorage.removeItem("rea.tinder.token");
    return false;
  }
}

async function start() {
  $("#login").classList.add("hidden");
  $("#shell").classList.remove("hidden");
  await refreshMeta();
  await refreshMatches();
  await refreshLikes();
  await loadRecs();
  connectSocket();
  render();
  startLiveTicker();
}

function logoutToLogin() {
  state.socket?.close();
  localStorage.removeItem("rea.tinder.token");
  state.token = null;
  $("#shell").classList.add("hidden");
  $("#login").classList.remove("hidden");
  closeInspector();
}

// ---------------------------------------------------------------------------
// Data refresh

async function refreshMeta() {
  const meta = await api("GET", "/v2/meta");
  state.globals = meta.globals;
}

async function refreshMatches() {
  const payload = await api(
    "GET",
    "/v2/matches?count=60&message=1&is_tinder_u=false",
  );
  state.matches = payload.data.matches;
  state.unreadMatches =
    payload.rea?.unread ??
    state.matches.filter((match) => !match.seen.match_seen).length;
  if (
    state.activeMatchId !== null &&
    !state.matches.some((match) => match._id === state.activeMatchId)
  ) {
    state.activeMatchId = null;
  }
}

async function refreshLikes() {
  const payload = await api("GET", "/demo/likes");
  state.likes = {
    items: payload.likes,
    count: payload.count,
    premium_required: payload.premium_required,
  };
}

async function refreshProfile() {
  const payload = await api(
    "GET",
    "/v2/profile?include=user,likes,boost,super_likes,travel,feature_access",
  );
  state.profile = payload.data;
  state.premium = payload.data.feature_access?.can_see_likes === true;
}

async function loadRecs() {
  try {
    const payload = await api("GET", "/v2/recs/core?locale=en-ZW&duos=0");
    state.recs = payload.data.results;
  } catch (error) {
    if (error.status === 429) {
      state.recs = [];
      openOutOfLikesModal(error.data);
      return;
    }
    throw error;
  }
}

async function loadChat(matchId) {
  state.activeMatchId = matchId;
  const payload = await api(
    "GET",
    `/v2/matches/${matchId}/messages?locale=en-ZW&count=100`,
  );
  state.chat = payload.data.messages;
  state.chatPerson = payload.data.person;
  state.typing = false;
  clearTimeout(state.typingTimer);
  await refreshMatches();
  markChatRead(matchId);
}

function markChatRead(matchId) {
  const match = state.matches.find((candidate) => candidate._id === matchId);
  if (match && !match.seen.match_seen) {
    match.seen.match_seen = true;
    state.unreadMatches = Math.max(0, state.unreadMatches - 1);
  }
}

// ---------------------------------------------------------------------------
// Actions

async function swipe(action) {
  if (state.busy || state.recs.length === 0) return;
  const rec = state.recs[0];
  const card = $(".deck .card");
  if (!card) return;
  state.busy = true;
  clearInterval(photoTimer);
  const profileId = rec.user._id;
  const flyClass =
    action === "pass"
      ? "fly-left"
      : action === "super"
        ? "fly-up"
        : "fly-right";
  card.classList.remove("dragging", "spring-back");
  card.style.transform = "";
  card.classList.add(flyClass);

  let request;
  if (action === "pass") {
    request = api(
      "GET",
      `/pass/${encodeURIComponent(profileId)}?locale=en-ZW&s_number=${rec.s_number}`,
    );
  } else {
    const suffix = action === "super" ? "/super" : "";
    request = api(
      "POST",
      `/like/${encodeURIComponent(profileId)}${suffix}?locale=en-ZW`,
      {
        body: {
          s_number: rec.s_number,
          liked_content_id: rec.user.photos?.[0]?.id ?? "",
          liked_content_type: "photo",
        },
      },
    );
  }

  try {
    const [response] = await Promise.all([request, delay(300)]);
    state.recs.shift();
    if (typeof response.likes_remaining === "number" && state.globals) {
      state.globals.likes_remaining = response.likes_remaining;
    }
    if (response.super_likes && state.globals) {
      state.globals.super_likes = response.super_likes;
    }
    await refreshMeta().catch(() => {});
    if (response.match === true) {
      toast(`It's a match with ${rec.user.name}`, "heart");
      burstHearts();
    }
    await refreshMatches().catch(() => {});
    render();
    if (response.match === true) {
      const match = state.matches.find(
        (candidate) => candidate.person._id === profileId,
      );
      openMatchModal(rec, match);
    }
    if (state.recs.length === 0) {
      await loadRecs().catch(() => {});
      render();
    }
  } catch (error) {
    card.classList.remove(flyClass);
    card.classList.add("spring-back");
    card.style.transform = "";
    if (error.status === 429 && error.data?.error === "out_of_likes") {
      openOutOfLikesModal(error.data);
    } else if (error.status === 403 && error.data?.error === "no_super_likes") {
      openUpgradeModal(
        "Super Likes are spent",
        "You are out of Super Likes for today. Gold includes 5 Super Likes every week.",
      );
    } else {
      toast(error.data?.error ?? "Swipe failed", "x");
    }
    render();
  } finally {
    state.busy = false;
  }
}

async function likeProfile(profileId, action = "like") {
  const suffix = action === "super" ? "/super" : "";
  let response;
  try {
    response = await api(
      "POST",
      `/like/${encodeURIComponent(profileId)}${suffix}?locale=en-ZW`,
      {
        body: {
          s_number: 0,
          liked_content_id: "",
          liked_content_type: "photo",
        },
      },
    );
  } catch (error) {
    if (error.status === 429) openOutOfLikesModal(error.data);
    else toast(error.data?.error ?? "Like failed", "x");
    return;
  }
  await Promise.all([
    refreshMeta().catch(() => {}),
    refreshMatches().catch(() => {}),
    refreshLikes().catch(() => {}),
  ]);
  render();
  if (response.match === true) {
    const match = state.matches.find(
      (candidate) => candidate.person._id === profileId,
    );
    if (match) {
      const rec = {
        user: match.person,
        distance_mi: match.rea?.distance_mi ?? null,
      };
      openMatchModal(rec, match);
      burstHearts();
    }
  } else {
    toast("Like sent", "heart");
  }
}

async function sendMessage(text) {
  const body = text.trim();
  if (body === "" || state.activeMatchId === null) return;
  state.draft = "";
  const matchId = state.activeMatchId;
  try {
    const message = await api("POST", `/user/matches/${matchId}?locale=en-ZW`, {
      body: { message: body },
    });
    state.chat.push(message);
    const match = state.matches.find((candidate) => candidate._id === matchId);
    if (match) {
      match.rea.last_message_text = message.message;
      match.rea.last_message_from = "me";
      match.last_activity_date = message.sent_date;
    }
    state.typing = true;
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      state.typing = false;
      if (state.view === "messages") render();
    }, 6000);
    render();
    scheduleChatRefresh(matchId);
  } catch (error) {
    toast(error.data?.error ?? "Message failed", "x");
  }
}

// The socket normally delivers the reply. This bounded re-read keeps the chat
// correct when the realtime channel is unavailable or still connecting.
function scheduleChatRefresh(matchId) {
  setTimeout(async () => {
    if (state.activeMatchId !== matchId || state.view !== "messages") return;
    try {
      const payload = await api(
        "GET",
        `/v2/matches/${matchId}/messages?count=100`,
      );
      state.chat = payload.data.messages;
      state.chatPerson = payload.data.person;
      state.typing = false;
      render();
    } catch {
      // A failed refresh is not fatal; the socket or the next open will reload.
    }
  }, 4200);
}

async function activateBoost() {
  try {
    const boost = await api("POST", "/boost?locale=en-ZW", { body: {} });
    toast(
      `Boost active · ${Math.round(boost.duration / 60)} min · ${boost.multiplier}× visibility`,
      "bolt",
    );
    await refreshMeta();
    render();
  } catch (error) {
    if (error.status === 403)
      openUpgradeModal(
        "No boosts left",
        "You have used every boost on this account. Gold gives you one boost per month.",
      );
    else toast(error.data?.error ?? "Boost failed", "x");
  }
}

async function setDiscoverable(enabled) {
  try {
    const payload = await api("POST", "/v2/profile?locale=en-ZW", {
      body: { user: { discoverable: enabled } },
    });
    if (state.profile) state.profile.discoverable = payload.data.discoverable;
    toast(
      enabled
        ? "You are visible in Discovery"
        : "You are hidden from Discovery",
      "sparkle",
    );
  } catch {
    toast("Could not update discovery", "x");
  }
  render();
}

async function setPreferenceBio(enabled) {
  try {
    const payload = await api("POST", "/v2/profile/user?locale=en-ZW", {
      body: { preference_filters: { preference_has_bio_filter: enabled } },
    });
    if (state.profile)
      state.profile.preference_filters = payload.data.preference_filters;
    toast("Preference filter saved", "sparkle");
  } catch (error) {
    if (error.status === 403) {
      openUpgradeModal(
        "Preference filters are Gold-only",
        "The analyzed client maps HTTP 403 on POST /v2/profile/user to a premium-required error. This mock returns the same gate.",
      );
    } else {
      toast("Could not save the filter", "x");
    }
  }
  render();
}

async function rewind() {
  try {
    const payload = await api("POST", "/demo/rewind");
    state.recs.unshift(payload.restored);
    await Promise.all([
      refreshMatches().catch(() => {}),
      refreshMeta().catch(() => {}),
    ]);
    toast("Rewound the last swipe", "rewind");
    render();
  } catch (error) {
    if (error.status === 403)
      openUpgradeModal(
        "Rewind is a Gold feature",
        "This demo gives you one free rewind. Gold would make it unlimited.",
      );
    else toast("Nothing to rewind", "x");
  }
}

async function changeLocation(name) {
  const locations = {
    Harare: { lat: -17.8252, lon: 31.0335 },
    Bulawayo: { lat: -20.1325, lon: 28.6265 },
    "Victoria Falls": { lat: -17.9243, lon: 25.8572 },
    "Cape Town": { lat: -33.9249, lon: 18.4241 },
    Nairobi: { lat: -1.2921, lon: 36.8219 },
    London: { lat: 51.5074, lon: -0.1278 },
    Lisbon: { lat: 38.7223, lon: -9.1393 },
    Tokyo: { lat: 35.6762, lon: 139.6503 },
  };
  const target = locations[name];
  if (!target) return;
  try {
    await api("POST", "/v2/meta?locale=en-ZW", { body: target });
    toast(`Location set to ${name}`, "sparkle");
    await refreshMeta();
    await loadRecs();
    await refreshProfile().catch(() => {});
    render();
  } catch (error) {
    if (error.status === 429) {
      const minutes = Math.max(
        1,
        Math.ceil((error.data.retry_at - Date.now()) / 60000),
      );
      toast(`Passport cooldown: ${minutes} min left`, "x");
    } else {
      toast("Location update failed", "x");
    }
  }
}

async function togglePremium(enabled) {
  await api("POST", "/demo/premium", { body: { enabled } });
  state.premium = enabled;
  await Promise.all([
    refreshLikes().catch(() => {}),
    refreshProfile().catch(() => {}),
  ]);
  render();
}

async function resetDemo() {
  const payload = await api("POST", "/demo/reset");
  state.token = payload.token;
  state.viewer = payload.user;
  state.recs = [];
  state.matches = [];
  state.chat = [];
  state.activeMatchId = null;
  state.calls = [];
  localStorage.setItem("rea.tinder.token", state.token);
  state.socket?.close();
  state.socket = null;
  await start();
  toast("Demo reset", "rewind");
}

// ---------------------------------------------------------------------------
// Realtime socket

async function connectSocket() {
  if (!state.token) return;
  try {
    const { token } = await api("GET", "/ws/generate");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`,
    );
    state.socket = socket;
    socket.addEventListener("open", () => {
      state.socketStatus = "online";
      state.socketAttempts = 0;
      updateLiveBits();
    });
    socket.addEventListener("close", () => {
      state.socketStatus = "offline";
      updateLiveBits();
      if (state.token && state.socketAttempts < 4) {
        state.socketAttempts += 1;
        setTimeout(
          () => connectSocket().catch(() => {}),
          1500 * state.socketAttempts,
        );
      }
    });
    socket.addEventListener("message", (event) =>
      handleSocketEvent(event.data),
    );
  } catch {
    state.socketStatus = "offline";
  }
}

function handleSocketEvent(raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  switch (event.type) {
    case "socket.open":
      state.socketStatus = "online";
      updateLiveBits();
      break;
    case "match.created": {
      refreshMatches()
        .then(() => render())
        .catch(() => {});
      break;
    }
    case "message.created": {
      const match = state.matches.find(
        (candidate) => candidate._id === event.matchId,
      );
      refreshMatches()
        .then(() => {
          if (state.activeMatchId === event.matchId) {
            if (
              !state.chat.some((message) => message._id === event.message._id)
            ) {
              state.chat.push(event.message);
            }
            state.typing = false;
          } else if (match) {
            toast(`${match.person.name} sent a message`, "chat");
          }
          if (state.view === "messages") render();
          else renderShell();
        })
        .catch(() => {});
      break;
    }
    case "message.typing": {
      if (state.activeMatchId === event.matchId) {
        state.typing = true;
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(() => {
          state.typing = false;
          if (state.view === "messages") render();
        }, 8000);
        if (state.view === "messages") render();
      }
      break;
    }
    case "like.received": {
      refreshLikes()
        .then(() => {
          toast("Someone new likes you", "heart");
          renderShell();
          if (state.view === "likes") render();
        })
        .catch(() => {});
      break;
    }
    case "boost.activated":
      refreshMeta()
        .then(() => {
          toast("Boost is live. More people will see you.", "bolt");
          render();
        })
        .catch(() => {});
      break;
    case "boost.expired":
      refreshMeta()
        .then(() => {
          toast("Your boost has ended", "bolt");
          render();
        })
        .catch(() => {});
      break;
    case "location.updated":
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Rendering: shell

function navItems() {
  const likes = state.likes.count;
  const unread = state.unreadMatches;
  return [
    { view: "discover", label: "Discover", icon: "flame", badge: 0 },
    { view: "likes", label: "Likes", icon: "heart", badge: likes },
    { view: "messages", label: "Messages", icon: "chat", badge: unread },
    { view: "profile", label: "Profile", icon: "gear", badge: 0 },
  ];
}

function renderShell() {
  const topbar = $("#topbar");
  if (!topbar) return;
  const items = navItems();
  const boost = state.globals?.boost;
  const boostActive = boost && boost.expires_at > Date.now();
  const boostRemaining = boostActive
    ? `${Math.max(0, Math.ceil((boost.expires_at - Date.now()) / 60000))} min`
    : `${state.globals?.boost?.allotment_remaining ?? 0} boosts`;
  topbar.innerHTML = `
    <div class="topbar-brand">
      <span class="brand-mark" aria-hidden="true">${icon("flame")}</span>
      <span>rea<span class="brand-dot">.</span> tinder</span>
      <small>reconstruction</small>
    </div>
    <nav class="topnav" aria-label="Primary">
      ${items
        .slice(0, 3)
        .map(
          (item) => `
          <button type="button" class="nav-item ${state.view === item.view ? "active" : ""}" data-view="${item.view}">
            ${icon(item.icon)}
            <span class="nav-label">${item.label}</span>
            ${item.badge > 0 ? `<span class="nav-badge">${item.badge}</span>` : ""}
          </button>`,
        )
        .join("")}
    </nav>
    <span class="topbar-spacer"></span>
    <div class="topbar-right">
      <button type="button" class="boost-pill ${boostActive ? "active" : ""}" data-action="boost" title="Activate a boost (POST /boost)">
        ${icon("bolt")}
        <span data-live="boost">${boostActive ? `Boosted · ${boostRemaining}` : boostRemaining}</span>
      </button>
      <button type="button" class="contract-button" data-action="inspector" aria-label="Open the contract inspector">
        <span class="dot" aria-hidden="true"></span><span class="label">Contract</span>
      </button>
      <button type="button" class="avatar-button" data-view="profile" aria-label="Your profile">
        <img src="/img/you.jpg" alt="" onerror="this.style.opacity=0" />
      </button>
    </div>
  `;

  const tabbar = $("#tabbar");
  tabbar.innerHTML = items
    .map(
      (item) => `
      <button type="button" class="nav-item ${state.view === item.view ? "active" : ""}" data-view="${item.view}">
        ${icon(item.icon)}
        <span>${item.label}</span>
        ${item.badge > 0 ? `<span class="nav-badge">${item.badge}</span>` : ""}
      </button>`,
    )
    .join("");
}

function render() {
  const view = $("#view");
  if (!view) return;
  renderShell();
  if (state.view === "discover") renderDiscover(view);
  else if (state.view === "likes") renderLikes(view);
  else if (state.view === "messages") renderMessages(view);
  else if (state.view === "profile") renderProfile(view);
  updateLiveBits();
  if (state.inspectorOpen) renderInspector();
}

function updateLiveBits() {
  const boost = state.globals?.boost;
  const target = document.querySelector("[data-live='boost']");
  if (target && boost) {
    const active = boost.expires_at > Date.now();
    target.textContent = active
      ? `Boosted · ${Math.max(0, Math.ceil((boost.expires_at - Date.now()) / 60000))} min`
      : `${boost.allotment_remaining ?? 0} boosts`;
  }
}

// ---------------------------------------------------------------------------
// Rendering: discover

function renderDiscover(view) {
  if (state.recs.length === 0) {
    view.innerHTML = `
      <div class="discover">
        <div class="empty-state">
          <span class="empty-icon">${icon("flame")}</span>
          <h3>You've seen everyone nearby</h3>
          <p>That's the whole fictional deck. Widen the search from your profile, or reset the demo to start over.</p>
          <div class="modal-actions">
            <button class="btn btn-primary" type="button" data-action="reload-recs">Look again</button>
            <button class="btn btn-ghost" type="button" data-view="profile">Open settings</button>
          </div>
        </div>
      </div>`;
    return;
  }

  const cards = state.recs
    .slice(0, 3)
    .map((rec, index) => cardMarkup(rec, index))
    .join("");

  const likesRemaining = state.globals?.likes_remaining ?? 0;
  const superLikes = state.globals?.super_likes?.remaining ?? 0;

  view.innerHTML = `
    <div class="discover">
      <div class="deck" id="deck">${cards}</div>
      <div class="deck-actions">
        <button class="action-button small action-rewind" type="button" data-action="rewind" aria-label="Rewind last swipe" title="Rewind">${icon("rewind")}</button>
        <button class="action-button action-pass" type="button" data-action="pass" aria-label="Pass" title="Pass (left arrow)">${icon("x")}</button>
        <button class="action-button action-super" type="button" data-action="super" aria-label="Super Like" title="Super Like (up arrow)">${icon("star")}</button>
        <button class="action-button action-like" type="button" data-action="like" aria-label="Like" title="Like (right arrow)">${icon("heart")}</button>
        <button class="action-button small action-boost" type="button" data-action="boost" aria-label="Activate boost" title="Boost">${icon("bolt")}</button>
      </div>
      <div class="quota-line">
        <span><strong>${likesRemaining}</strong> likes left</span>
        <span class="quota-meter"><span style="width:${Math.min(100, (likesRemaining / 100) * 100)}%"></span></span>
        <span><strong>${superLikes}</strong> super likes</span>
      </div>
      <div class="deck-hint">
        <span><kbd>←</kbd> pass</span>
        <span><kbd>→</kbd> like</span>
        <span><kbd>↑</kbd> super like</span>
        <span>drag the card</span>
      </div>
    </div>`;

  bindCardGestures();
  startPhotoTimer();
}

function cardMarkup(rec, index) {
  const photos = rec.user.photos ?? [];
  const verified = rec.user.is_verified === true;
  const distance = distanceLabel(rec);
  const interests = rec.rea?.interests ?? [];
  const prompts = rec.rea?.prompts ?? [];
  const passport = rec.distance_mi === null;
  return `
    <article class="card ${index === 1 ? "behind-1" : index === 2 ? "behind-2" : ""}" data-id="${esc(rec.user._id)}" data-index="${index}" style="z-index:${3 - index}">
      <div class="card-photo">
        <img src="${esc(photoUrl(photos[0]))}" alt="${esc(photos[0]?.alt ?? rec.user.name)}" draggable="false" onerror="this.style.opacity=0" />
        <div class="photo-bars">
          ${photos
            .map(
              (_, photoIndex) =>
                `<span class="photo-bar ${photoIndex === 0 ? "current" : ""}" data-bar="${photoIndex}"><span></span></span>`,
            )
            .join("")}
        </div>
        <button class="photo-hit left" type="button" data-photo="prev" aria-label="Previous photo"></button>
        <button class="photo-hit right" type="button" data-photo="next" aria-label="Next photo"></button>
        <div class="card-top-badges">
          ${verified ? `<span class="pill-badge verified">${icon("verified")} Verified</span>` : ""}
          ${passport ? `<span class="pill-badge passport">${icon("sparkle")} Passport</span>` : ""}
          ${rec.user.active_now ? `<span class="pill-badge active">Active now</span>` : ""}
        </div>
        <div class="card-overlay-name">
          <h2>${esc(rec.user.name)} <span>${ageFrom(rec.user.birth_date) ?? ""}</span></h2>
          <p>${esc(rec.rea?.occupation ?? "")}<span class="sep"></span>${esc(distance)}</p>
        </div>
        <div class="stamps">
          <span class="stamp stamp-like">LIKE</span>
          <span class="stamp stamp-nope">NOPE</span>
          <span class="stamp stamp-super">SUPER LIKE</span>
        </div>
      </div>
      <div class="card-body">
        <p class="bio">${esc(rec.user.bio ?? "")}</p>
        <div class="chips">${interests.map((interest) => `<span class="chip">${esc(interest)}</span>`).join("")}</div>
        ${prompts
          .slice(0, 1)
          .map(
            (prompt) => `
          <div class="prompt">
            <span>${esc(prompt.prompt)}</span>
            <p>${esc(prompt.answer)}</p>
          </div>`,
          )
          .join("")}
      </div>
    </article>`;
}

function setCardPhoto(card, index) {
  const rec = state.recs.find(
    (candidate) => candidate.user._id === card.dataset.id,
  );
  if (!rec) return;
  const photos = rec.user.photos ?? [];
  const bounded = Math.max(0, Math.min(photos.length - 1, index));
  card.dataset.photoIndex = String(bounded);
  const img = card.querySelector(".card-photo img");
  if (img) {
    img.src = photoUrl(photos[bounded]);
    img.style.opacity = "1";
  }
  card.querySelectorAll(".photo-bar").forEach((bar, barIndex) => {
    bar.classList.toggle("done", barIndex < bounded);
    bar.classList.toggle("current", barIndex === bounded);
  });
}

function startPhotoTimer() {
  clearInterval(photoTimer);
  const card = $(".deck .card");
  if (!card) return;
  const rec = state.recs[0];
  if (!rec) return;
  const total = rec.user.photos?.length ?? 0;
  if (total < 2) return;
  if (Number(card.dataset.photoIndex ?? 0) !== 0) setCardPhoto(card, 0);
  card.dataset.photoIndex = "0";
  photoTimer = setInterval(() => {
    const active = $(".deck .card");
    if (!active || state.busy) return;
    const current = Number(active.dataset.photoIndex ?? 0);
    const next = (current + 1) % total;
    setCardPhoto(active, next);
  }, PHOTO_INTERVAL_MS);
}

function bindCardGestures() {
  const card = $(".deck .card");
  if (!card) return;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let dragging = false;

  const stamps = {
    like: card.querySelector(".stamp-like"),
    nope: card.querySelector(".stamp-nope"),
    super: card.querySelector(".stamp-super"),
  };

  card.addEventListener("pointerdown", (event) => {
    if (state.busy) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    dy = 0;
    dragging = false;
  });

  card.addEventListener("pointermove", (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    dx = event.clientX - startX;
    dy = event.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 8) {
      dragging = true;
      card.classList.add("dragging");
      // Pointer capture is an enhancement; some embedded engines do not expose it.
      card.setPointerCapture?.(pointerId);
      clearInterval(photoTimer);
    }
    if (!dragging) return;
    const rotate = dx * 0.055;
    card.style.transform = `translate(${dx}px, ${Math.min(40, dy * 0.35)}px) rotate(${rotate}deg)`;
    const superIntent = dy < -60 && Math.abs(dy) > Math.abs(dx);
    stamps.like.style.opacity = String(Math.min(1, Math.max(0, dx / 90)));
    stamps.nope.style.opacity = String(Math.min(1, Math.max(0, -dx / 90)));
    stamps.super.style.opacity = String(
      superIntent ? Math.min(1, Math.abs(dy) / 120) : 0,
    );
  });

  const finish = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    pointerId = null;
    card.classList.remove("dragging");
    if (card.hasPointerCapture?.(event.pointerId))
      card.releasePointerCapture?.(event.pointerId);
    const superIntent = dy < -SUPER_THRESHOLD && Math.abs(dy) > Math.abs(dx);
    const horizontal =
      Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.2;
    const tap = !dragging && Math.hypot(dx, dy) < 8;
    dragging = false;
    if (superIntent) {
      swipe("super");
    } else if (horizontal && dx > 0) {
      swipe("like");
    } else if (horizontal && dx < 0) {
      swipe("pass");
    } else {
      card.classList.add("spring-back");
      card.style.transform = "";
      stamps.like.style.opacity = "0";
      stamps.nope.style.opacity = "0";
      stamps.super.style.opacity = "0";
      setTimeout(() => card.classList.remove("spring-back"), 340);
      if (tap) {
        const hit = event.target.closest?.("[data-photo]");
        if (hit) {
          const current = Number(card.dataset.photoIndex ?? 0);
          const total = state.recs[0]?.user.photos?.length ?? 1;
          setCardPhoto(
            card,
            hit.dataset.photo === "next"
              ? (current + 1) % total
              : (current - 1 + total) % total,
          );
          startPhotoTimer();
        }
      } else {
        startPhotoTimer();
      }
    }
  };

  card.addEventListener("pointerup", finish);
  card.addEventListener("pointercancel", finish);
}

// ---------------------------------------------------------------------------
// Rendering: likes

function renderLikes(view) {
  const items = state.likes.items;
  const count = state.likes.count;
  const locked = !state.premium;
  view.innerHTML = `
    <section>
      <header class="section-head">
        <div>
          <p class="eyebrow">Likes you</p>
          <h1>${count} ${count === 1 ? "person likes" : "people like"} you</h1>
          <p>${locked ? "Gold reveals who they are. This reconstruction simulates the gate instead of charging you." : "Unlocked in this demo session."}</p>
        </div>
        <span class="premium-pill">${icon("sparkle")} ${state.premium ? "Gold (simulated)" : "Free tier"}</span>
      </header>
      ${
        items.length === 0
          ? `<div class="empty-state">
               <span class="empty-icon">${icon("heart")}</span>
               <h3>No likes yet</h3>
               <p>Activate a boost or reset the demo to seed new incoming likes.</p>
               <button class="btn btn-primary" type="button" data-action="boost">Boost my profile</button>
             </div>`
          : `<div class="likes-grid">
              ${items
                .map(
                  (like, index) => `
                <button class="like-card ${locked && index > 0 ? "locked" : ""}" type="button" data-like-id="${esc(like.profileId)}" aria-label="${locked ? "Locked like" : `Open ${esc(like.name)}`}">
                  <img src="${esc(like.photo)}" alt="" onerror="this.style.opacity=0" />
                  <span class="like-meta">
                    <strong>${esc(like.name)}, ${like.age}</strong>
                    <span>${esc(like.city)}${like.distance_mi !== null ? ` · ${kmFromMiles(like.distance_mi)} km` : ""}</span>
                  </span>
                </button>`,
                )
                .join("")}
            </div>
            ${
              locked
                ? `<div class="likes-gate">
                    <div>
                      <h3>See who likes you</h3>
                      <p>In the real product this grid is behind Tinder Gold. Here you can flip the simulated subscription from your profile, or unlock it right now.</p>
                    </div>
                    <div class="likes-gate-actions">
                      <button class="btn btn-primary" type="button" data-action="gold">Simulate Gold</button>
                      <button class="btn btn-ghost" type="button" data-action="inspector">See the evidence</button>
                    </div>
                  </div>`
                : ""
            }`
      }
    </section>`;
}

// ---------------------------------------------------------------------------
// Rendering: messages

function renderMessages(view) {
  const active =
    state.matches.find((match) => match._id === state.activeMatchId) ?? null;
  const chatOpen = active !== null;
  view.innerHTML = `
    <section>
      <header class="section-head">
        <div>
          <p class="eyebrow">Matches</p>
          <h1>Messages</h1>
          <p>${state.matches.length} matches · live updates arrive on the recovered <code>/ws</code> channel.</p>
        </div>
      </header>
      <div class="messages-layout ${chatOpen ? "chat-open" : ""}">
        <div class="panel list-panel">
          <div class="panel-head">
            <h2>Your matches</h2>
            <span class="count">${state.matches.length}</span>
          </div>
          <div class="match-list">
            ${
              state.matches.length === 0
                ? `<p class="inspector-note" style="padding:16px">No matches yet. Swipe right on someone who already liked you.</p>`
                : state.matches.map((match) => matchRowMarkup(match)).join("")
            }
          </div>
        </div>
        <div class="panel chat-panel">
          ${
            active === null
              ? `<div class="chat-empty">
                   <div>
                     <p class="eyebrow" style="margin-bottom:8px">Select a match</p>
                     <p>Chat history is served from <code>GET /v2/matches/{match_id}/messages</code>.</p>
                   </div>
                 </div>`
              : chatMarkup(active)
          }
        </div>
      </div>
    </section>`;
  const scroll = $(".chat-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  const input = $(".chat-compose input");
  if (input) {
    input.value = state.draft;
    if (state.chatFocus) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      state.chatFocus = false;
    }
  }
}

function matchRowMarkup(match) {
  const person = match.person;
  const last = match.rea?.last_message_text ?? "Say hello";
  const from = match.rea?.last_message_from === "me" ? "You: " : "";
  const unread = !match.seen.match_seen;
  return `
    <button type="button" class="match-row ${state.activeMatchId === match._id ? "active" : ""}" data-match-id="${esc(match._id)}">
      <span class="match-avatar">
        <img src="${esc(photoUrl(person.photos?.[0]))}" alt="" onerror="this.style.opacity=0" />
      </span>
      <span class="match-row-main">
        <span class="match-row-name">
          ${esc(person.name)}
          ${person.is_verified ? icon("verified") : ""}
          ${match.is_super_like ? `<span class="match-tag">${icon("star")} Super</span>` : ""}
          ${match.is_boost_match ? `<span class="match-tag">${icon("bolt")} Boost</span>` : ""}
        </span>
        <span class="match-row-last">${esc(from + last)}</span>
      </span>
      <span class="match-row-side">
        <time>${timeAgo(match.last_activity_date)}</time>
        ${unread ? `<span class="unread-dot" aria-label="Unread"></span>` : ""}
      </span>
    </button>`;
}

function chatMarkup(match) {
  const person = match.person;
  return `
    <div class="chat-head">
      <button class="icon-button back-button" type="button" data-action="chat-back" aria-label="Back to matches">${icon("back")}</button>
      <span class="match-avatar">
        <img src="${esc(photoUrl(person.photos?.[0]))}" alt="" onerror="this.style.opacity=0" />
      </span>
      <span class="chat-head-main">
        <strong>${esc(person.name)}</strong>
        <span>${person.active_now ? "Active now" : "Matched " + timeAgo(match.created_date) + " ago"} · ${esc(match.rea?.city ?? "")}</span>
      </span>
      <span class="chat-head-actions">
        <button class="icon-button" type="button" data-action="inspector" aria-label="Inspect this conversation's routes">${icon("sparkle")}</button>
      </span>
    </div>
    <div class="chat-scroll">
      <div class="chat-intro">
        <span class="match-avatar">
          <img src="${esc(photoUrl(person.photos?.[0]))}" alt="" onerror="this.style.opacity=0" />
        </span>
        <strong>You matched with ${esc(person.name)}</strong>
        <p>${match.is_super_like ? "They sent a Super Like. " : ""}${match.is_boost_match ? "This match arrived during a boost. " : ""}Say something better than "hey".</p>
      </div>
      ${state.chat
        .map(
          (message) => `
        <div class="bubble ${message.from === state.viewer?._id ? "me" : "them"}">
          ${esc(message.message)}
          <span class="bubble-meta">${clockTime(message.sent_date)}${message.is_seen && message.from === state.viewer?._id ? " · Seen" : ""}</span>
        </div>`,
        )
        .join("")}
      ${state.typing ? `<div class="typing" aria-label="${esc(person.name)} is typing"><span></span><span></span><span></span></div>` : ""}
    </div>
    <form class="chat-compose" data-form="message">
      <input type="text" name="message" placeholder="Message ${esc(person.name)}…" autocomplete="off" maxlength="500" aria-label="Message ${esc(person.name)}" />
      <button class="send-button" type="submit" aria-label="Send message">${icon("arrowRight")}</button>
    </form>`;
}

// ---------------------------------------------------------------------------
// Rendering: profile

function renderProfile(view) {
  const viewer = state.viewer ?? {};
  const globals = state.globals ?? {};
  const boost = globals.boost ?? {};
  const superLikes = globals.super_likes ?? {};
  const location = state.profile?.travel?.travel_location ?? "Harare";
  const profile = state.profile?.likes ?? {};
  const travel = state.profile?.travel ?? {};
  view.innerHTML = `
    <section>
      <header class="section-head">
        <div>
          <p class="eyebrow">Your account</p>
          <h1>Profile &amp; settings</h1>
          <p>Reconstruction controls. Quota values come from the same fields the real clients read.</p>
        </div>
        <span class="premium-pill">${icon("sparkle")} ${state.premium ? "Gold (simulated)" : "Free tier"}</span>
      </header>
      <div class="profile-layout">
        <article class="profile-card">
          <div class="profile-photo">
            <img src="/img/you.jpg" alt="Alex" onerror="this.style.opacity=0" />
            <div class="profile-photo-meta">
              <h2>${esc(viewer.name ?? "Alex")} <span>${ageFrom(viewer.birth_date) ?? 27}</span></h2>
              <p>${esc(viewer.job ?? "")} · ${esc(viewer.city?.name ?? "Harare")}</p>
            </div>
          </div>
          <div class="profile-body">
            <p class="profile-bio">${esc(viewer.bio ?? "")}</p>
            <div class="stat-grid">
              <div class="stat"><span>Likes left</span><strong>${globals.likes_remaining ?? "–"}</strong><small>daily quota</small></div>
              <div class="stat"><span>Super Likes</span><strong>${superLikes.remaining ?? "–"}</strong><small>of ${superLikes.allotment ?? 3}</small></div>
              <div class="stat"><span>Boosts</span><strong>${boost.allotment_remaining ?? "–"}</strong><small>${boost.multiplier && boost.expires_at > Date.now() ? `${boost.multiplier}× active` : "ready"}</small></div>
              <div class="stat"><span>Search</span><strong>${esc(location)}</strong><small>${travel.is_traveling ? "passport" : "home"}</small></div>
            </div>
          </div>
        </article>
        <div class="settings">
          <div class="settings-head">
            <div>
              <h2>Discovery</h2>
              <p>Some controls are simulated locally; the API contract is shown in the inspector.</p>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-main">
              <strong>Passport location</strong>
              <span>POST /v2/meta with { lat, lon }. The analyzed client documents a 10-minute cooldown; this mock enforces it.</span>
            </div>
            <div class="setting-control">
              <select class="select" data-action="location" aria-label="Search location">
                ${[
                  "Harare",
                  "Bulawayo",
                  "Victoria Falls",
                  "Cape Town",
                  "Nairobi",
                  "London",
                  "Lisbon",
                  "Tokyo",
                ]
                  .map(
                    (name) =>
                      `<option ${name === location ? "selected" : ""}>${name}</option>`,
                  )
                  .join("")}
              </select>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-main">
              <strong>Tinder Gold (simulated)</strong>
              <span>Unlocks the likes grid in this demo. Real gating and pricing are server-driven and unknown.</span>
            </div>
            <div class="setting-control">
              <button class="switch" type="button" role="switch" aria-checked="${state.premium}" data-action="toggle-gold" aria-label="Toggle simulated Gold"></button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-main">
              <strong>Discoverable</strong>
              <span>POST /v2/profile with a snake_case <code>{ user: { discoverable } }</code> partial body.</span>
            </div>
            <div class="setting-control">
              <button class="switch" type="button" role="switch" aria-checked="${state.profile?.discoverable !== false}" data-action="toggle-discoverable" aria-label="Toggle discoverable"></button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-main">
              <strong>Only show profiles with a bio</strong>
              <span>POST /v2/profile/user with <code>preference_filters</code>. Premium-gated: the mock returns 403 until Gold is simulated.</span>
            </div>
            <div class="setting-control">
              <button class="switch" type="button" role="switch" aria-checked="${state.profile?.preference_filters?.preference_has_bio_filter === true}" data-action="toggle-bio-filter" aria-label="Toggle bio filter"></button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-main">
              <strong>Rewind</strong>
              <span>One free rewind, then a simulated premium gate. POST /demo/rewind is reconstruction-only.</span>
            </div>
            <div class="setting-control">
              <button class="btn btn-ghost" type="button" data-action="rewind">Rewind last swipe</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-main">
              <strong>Boost</strong>
              <span>POST /boost returns allotment, duration, multiplier and expiry. The mock schedules incoming likes while active.</span>
            </div>
            <div class="setting-control">
              <button class="btn btn-ghost" type="button" data-action="boost">${boost.expires_at > Date.now() ? "Boosted" : "Activate boost"}</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-main">
              <strong>Realtime channel</strong>
              <span>GET /ws/generate issues a token; the browser then upgrades /ws. Status: <strong>${state.socketStatus}</strong></span>
            </div>
            <div class="setting-control">
              <span class="badge ${state.socketStatus === "online" ? "observed" : "unknown"}">${state.socketStatus}</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-main">
              <strong>Reset the reconstruction</strong>
              <span>Creates a new local session and re-seeds matches, likes and quotas.</span>
            </div>
            <div class="setting-control">
              <button class="btn btn-ghost" type="button" data-action="reset">Reset demo</button>
              <button class="btn btn-ghost" type="button" data-action="logout">Sign out</button>
            </div>
          </div>
          <div class="about-note">
            Likes field from the API: <code>likes_remaining ${profile.likes_remaining ?? "?"}</code>. Evidence:
            <code>${esc(state.evidence?.subjects?.modern?.analysis_evidence_id ?? "loading…")}</code>.
            <button class="btn btn-ghost" type="button" data-action="inspector" style="margin-left:8px;padding:6px 12px">Open inspector</button>
          </div>
        </div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Inspector

async function ensureEvidence() {
  if (state.contract === null) {
    try {
      state.contract = await (await fetch("/demo/contract")).json();
    } catch {
      state.contract = null;
    }
  }
  if (state.evidence === null) {
    try {
      state.evidence = await (await fetch("/demo/evidence")).json();
    } catch {
      state.evidence = null;
    }
  }
}

async function openInspector(tab = "network") {
  state.inspectorOpen = true;
  state.inspectorTab = tab;
  $("#inspector").classList.add("open");
  $("#inspector").setAttribute("aria-hidden", "false");
  await ensureEvidence();
  renderInspector();
}

function closeInspector() {
  state.inspectorOpen = false;
  $("#inspector").classList.remove("open");
  $("#inspector").setAttribute("aria-hidden", "true");
}

function renderInspector() {
  const body = $("#inspector-body");
  if (!body) return;
  document.querySelectorAll("#inspector-tabs button").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.tab === state.inspectorTab,
    );
  });
  if (state.inspectorTab === "network") body.innerHTML = inspectorNetwork();
  else if (state.inspectorTab === "routes") body.innerHTML = inspectorRoutes();
  else if (state.inspectorTab === "evidence")
    body.innerHTML = inspectorEvidence();
  else body.innerHTML = inspectorAbout();
}

function inspectorNetwork() {
  if (state.calls.length === 0) {
    return `<p class="inspector-note">No calls yet. Swipe a card or open a chat; each request appears here with its exact status and payload.</p>`;
  }
  const selected =
    state.calls.find((call) => call.id === state.selectedCallId) ??
    state.calls[0];
  const detail = selected
    ? `<div>
         <p class="eyebrow" style="margin-bottom:6px">${esc(selected.method)} ${esc(selected.path)}</p>
         <pre class="code-block">${esc(
           JSON.stringify(
             {
               status: selected.status,
               duration_ms: selected.ms,
               request_body: selected.request,
               response: selected.response,
             },
             null,
             2,
           ).slice(0, 6000),
         )}</pre>
       </div>`
    : "";
  return `
    <p class="inspector-note">Live requests to the local mock, shaped like the recovered contract. Click a row for the payload.</p>
    ${state.calls
      .map(
        (call) => `
      <button class="call-row ${selected?.id === call.id ? "selected" : ""}" type="button" data-call-id="${esc(call.id)}">
        <span class="call-row-top">
          <span class="method ${call.method === "POST" ? "method-post" : "method-get"}">${call.method}</span>
          <span class="call-path">${esc(call.path)}</span>
          <span class="call-status ${call.status >= 400 || call.status === 0 ? "error" : ""}">${call.status === 0 ? "ERR" : call.status}</span>
        </span>
        <span class="call-meta"><span>${call.ms} ms</span><span>${clockTime(call.at)}</span></span>
      </button>`,
      )
      .join("")}
    ${detail}`;
}

function inspectorRoutes() {
  const contract = state.contract;
  if (contract === null)
    return `<p class="inspector-note">Contract evidence is unavailable. Run the server from the experiment directory.</p>`;
  return `
    <p class="inspector-note">${esc(contract.disclaimer)}</p>
    ${contract.endpoints
      .map((endpoint) => {
        const open = state.openRouteId === endpoint.id;
        const fidelity = endpoint.fidelity.includes("observed")
          ? "observed"
          : endpoint.fidelity.includes("documented")
            ? "documented"
            : "unknown";
        return `
        <article class="route-card">
          <button class="route-head" type="button" data-route-id="${esc(endpoint.id)}" aria-expanded="${open}">
            <span class="route-title">
              <span class="method ${endpoint.method === "POST" ? "method-post" : "method-get"}">${endpoint.method}</span>
              ${esc(endpoint.path)}
            </span>
            <span class="route-summary">${esc(endpoint.summary)}</span>
            <span class="route-badges">
              <span class="badge ${fidelity}">${fidelity}</span>
              ${endpoint.rea?.status === "ambiguous" ? `<span class="badge unknown">ambiguous match</span>` : ""}
              ${endpoint.rea?.trace_evidence_id ? `<span class="badge">REA trace</span>` : ""}
            </span>
          </button>
          ${
            open
              ? `<div class="route-body">
                  <dl class="kv">
                    <dt>Sources</dt><dd>${esc((endpoint.sources ?? []).join(" · "))}</dd>
                    <dt>REA trace</dt><dd>${esc(endpoint.rea?.trace_evidence_id ?? "none (documentation only)")}</dd>
                    <dt>Recovered literal</dt><dd>${esc(endpoint.rea?.literal ?? "n/a")}${endpoint.rea?.slot ? ` → ${esc(endpoint.rea.slot)}` : ""}</dd>
                  </dl>
                  <p class="eyebrow">Request</p>
                  <pre class="code-block">${esc(JSON.stringify(endpoint.request ?? {}, null, 2))}</pre>
                  <p class="eyebrow">Response</p>
                  <pre class="code-block">${esc(JSON.stringify(endpoint.response ?? {}, null, 2))}</pre>
                  <p class="inspector-note">${esc((endpoint.notes ?? []).join(" "))}</p>
                </div>`
              : ""
          }
        </article>`;
      })
      .join("")}`;
}

function inspectorEvidence() {
  const evidence = state.evidence;
  const modern = evidence?.subjects?.modern;
  if (modern === undefined)
    return `<p class="inspector-note">Evidence extract unavailable. Run the server from this experiment directory.</p>`;
  const comparison = evidence.version_comparison;
  return `
    <p class="inspector-note">Static analysis of public third-party clients with REA. No Tinder code, credentials, or live traffic.</p>
    <div class="evidence-grid">
      <div class="evidence-tile"><span>Files analyzed</span><strong>${modern.statistics.relevant_files}</strong><small>${modern.statistics.parsed_javascript_files} JS parsed · ${modern.statistics.parse_failures} failures</small></div>
      <div class="evidence-tile"><span>AST nodes</span><strong>${modern.statistics.visited_ast_nodes.toLocaleString()}</strong><small>${modern.statistics.findings} static findings</small></div>
      <div class="evidence-tile"><span>Semantic nodes</span><strong>${modern.semantic.nodes.toLocaleString()}</strong><small>${modern.semantic.relations.toLocaleString()} relations</small></div>
      <div class="evidence-tile"><span>Literals</span><strong>${modern.semantic.literals.toLocaleString()}</strong><small>${modern.semantic.unknowns.toLocaleString()} unknowns retained</small></div>
    </div>
    <p class="eyebrow" style="margin-top:8px">Recovered route constants</p>
    ${(evidence.route_recovery ?? [])
      .map(
        (row) => `
      <div class="route-card">
        <div class="route-head">
          <span class="route-title"><span class="method method-get">STR</span>${esc(row.literal)}</span>
          <span class="route-summary">property slot <strong>${esc(row.slot ?? "?")}</strong> · ${esc(row.status)} · ${row.seeds} seed${row.seeds === 1 ? "" : "s"}</span>
          <span class="route-badges"><span class="badge ${row.status === "found" ? "observed" : "unknown"}">${esc(row.status)}</span></span>
        </div>
      </div>`,
      )
      .join("")}
    ${
      comparison
        ? `<p class="eyebrow" style="margin-top:8px">Client generation comparison</p>
           <div class="evidence-tile">
             <span>legacy tinder 1.19.0 → modern tinder-api-ts 0.5.0</span>
             <strong>${comparison.summary.added} added</strong>
             <small>${comparison.summary.unchanged} unchanged · ${comparison.summary.removed} removed · ${comparison.summary.changed} changed · ${comparison.summary.unknown} unknown</small>
           </div>
           <p class="inspector-note">Only ${comparison.matching.semantic_key} entity paired, across ${comparison.matching.unmatched} unmatched. These are independent packages, not two versions of one app, so pairing fails by design.</p>`
        : ""
    }
    <p class="inspector-note">Analysis evidence: <code>${esc(modern.analysis_evidence_id)}</code><br />Semantic graph: <code>${esc(modern.graph_id)}</code><br />Artifact sha256: <code>${esc(modern.artifact_sha256)}</code></p>
    <p class="inspector-note">Coverage is ${esc(modern.coverage)}. Missing relations are not proof of absence; ranking, moderation and pricing remain unknown.</p>`;
}

function inspectorAbout() {
  return `
    <p class="inspector-note">
      This is a local reconstruction of the public Tinder web contract, built by running
      REA workflows over public third-party clients and a public OpenAPI description.
      It is not Tinder, does not talk to Tinder, and contains no Tinder source code.
    </p>
    <div class="evidence-grid">
      <div class="evidence-tile"><span>Backend</span><strong>${globalThis.__REA_RUNTIME__ === "on-device" ? "on-device" : "mock"}</strong><small>${globalThis.__REA_RUNTIME__ === "on-device" ? "bundled core · in-page socket" : "Node HTTP + WebSocket"}</small></div>
      <div class="evidence-tile"><span>Profiles</span><strong>fictional</strong><small>generated placeholder art</small></div>
    </div>
    <p class="eyebrow" style="margin-top:8px">Fidelity</p>
    <div class="fidelity-table">
      <div class="fidelity-row"><strong>Observed</strong><span>Route shapes, request bodies, response envelopes and quota fields typed by an analyzed client.</span></div>
      <div class="fidelity-row"><strong>Documented</strong><span>Additional routes and header names from the public OpenAPI description.</span></div>
      <div class="fidelity-row"><strong>Inferred</strong><span>Chat envelopes and error bodies composed from client types and call sites.</span></div>
      <div class="fidelity-row"><strong>Unknown</strong><span>Ranking, matching weights, moderation, pricing, experiment assignment, production limits.</span></div>
    </div>
    <p class="inspector-note">
      <a href="/demo/contract" target="_blank" rel="noreferrer">Contract JSON</a> ·
      <a href="/demo/evidence" target="_blank" rel="noreferrer">REA extract</a>
    </p>
    <p class="inspector-note">Keyboard: ← pass · → like · ↑ super like · Esc close.</p>`;
}

// ---------------------------------------------------------------------------
// Modals

function closeModals() {
  $("#modal-root").innerHTML = "";
  $("#overlay").classList.add("hidden");
  $("#overlay").onclick = null;
}

function openModal(markup, { dismissible = true } = {}) {
  $("#modal-root").innerHTML =
    `<div class="modal-wrap"><div class="modal">${markup}</div></div>`;
  const overlay = $("#overlay");
  overlay.classList.remove("hidden");
  overlay.onclick = dismissible ? closeModals : null;
}

function openMatchModal(rec, match) {
  const photo = photoUrl(rec.user.photos?.[0]);
  openModal(
    `<div class="match-modal">
      <div class="match-avatars">
        <span class="match-avatar"><img src="/img/you.jpg" alt="You" onerror="this.style.opacity=0" /></span>
        <span class="heart-bubble">${icon("heart")}</span>
        <span class="match-avatar"><img src="${esc(photo)}" alt="" onerror="this.style.opacity=0" /></span>
      </div>
      <h2>It's a Match!</h2>
      <p>You and <strong>${esc(rec.user.name)}</strong> liked each other.${match?.is_super_like ? " Their Super Like is why this one stings a little." : ""}</p>
      <div class="modal-actions">
        <button class="btn btn-primary" type="button" data-action="chat-match" data-match-id="${esc(match?._id ?? "")}">Send a message</button>
        <button class="btn btn-ghost" type="button" data-action="close-modal">Keep swiping</button>
      </div>
    </div>`,
  );
}

function openUpgradeModal(title, description) {
  openModal(
    `<div class="upgrade-modal">
      <span class="premium-pill">${icon("sparkle")} Tinder Gold (simulated)</span>
      <h2>${esc(title)}</h2>
      <p>${esc(description)}</p>
      <ul class="upgrade-list">
        <li>${icon("heart")} See everyone who likes you</li>
        <li>${icon("star")} 5 Super Likes every week</li>
        <li>${icon("bolt")} One Boost every month</li>
        <li>${icon("rewind")} Unlimited rewinds</li>
      </ul>
      <p class="inspector-note">This is a reconstruction. No payment flow exists and nothing is charged.</p>
      <div class="modal-actions">
        <button class="btn btn-primary" type="button" data-action="gold">Simulate Gold</button>
        <button class="btn btn-ghost" type="button" data-action="close-modal">Not now</button>
      </div>
    </div>`,
  );
}

function openOutOfLikesModal(data) {
  const resetAt = data?.likes_reset_at ? new Date(data.likes_reset_at) : null;
  openModal(
    `<div>
      <span class="premium-pill">${icon("heart")} Out of likes</span>
      <h2 style="margin-top:10px">That's 100 likes for today</h2>
      <p>Your daily quota is empty${resetAt ? `; it resets ${resetAt.toLocaleString()}` : ""}. The mock enforces the field the contract exposes, not a hidden server rule.</p>
      <div class="modal-actions">
        <button class="btn btn-primary" type="button" data-action="gold">Simulate Gold</button>
        <button class="btn btn-ghost" type="button" data-action="close-modal">Wait it out</button>
      </div>
    </div>`,
  );
}

function openLikePreview(like) {
  openModal(
    `<div>
      <div class="match-photo"><img src="${esc(like.photo)}" alt="${esc(like.name)}" onerror="this.style.opacity=0" /></div>
      <h2 style="margin-top:14px">${esc(like.name)}, ${like.age}</h2>
      <p>${esc(like.city)}${like.distance_mi !== null ? ` · ${kmFromMiles(like.distance_mi)} km away` : ""} · liked you</p>
      <p class="inspector-note">Liking back here calls <code>POST /like/{user_id}</code> against the local mock.</p>
      <div class="modal-actions">
        <button class="btn btn-primary" type="button" data-action="like-back" data-profile-id="${esc(like.profileId)}">${icon("heart")} Like back</button>
        <button class="btn btn-ghost" type="button" data-action="close-modal">Close</button>
      </div>
    </div>`,
  );
}

function burstHearts() {
  for (let index = 0; index < 10; index += 1) {
    const heart = document.createElement("span");
    heart.className = "heart-particle";
    heart.textContent = "♥";
    heart.style.left = `${50 + (Math.random() * 30 - 15)}vw`;
    heart.style.top = `${60 + Math.random() * 10}vh`;
    heart.style.setProperty("--dx", `${Math.random() * 120 - 60}px`);
    heart.style.setProperty("--rot", `${Math.random() * 60 - 30}deg`);
    heart.style.animationDelay = `${Math.random() * 0.4}s`;
    document.body.append(heart);
    setTimeout(() => heart.remove(), 2200);
  }
}

// ---------------------------------------------------------------------------
// Toasts

function toast(message, iconName = "sparkle") {
  const host = $("#toasts");
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<span class="toast-icon">${icon(iconName)}</span><span>${esc(message)}</span>`;
  host.append(node);
  setTimeout(() => {
    node.classList.add("leaving");
    setTimeout(() => node.remove(), 220);
  }, 3400);
}

// ---------------------------------------------------------------------------
// Views + global events

async function openView(viewName) {
  state.view = viewName;
  if (viewName === "likes") await refreshLikes().catch(() => {});
  if (viewName === "messages") await refreshMatches().catch(() => {});
  if (viewName === "profile")
    await Promise.all([
      refreshProfile().catch(() => {}),
      refreshMeta().catch(() => {}),
    ]);
  if (viewName === "discover" && state.recs.length === 0)
    await loadRecs().catch(() => {});
  render();
}

async function openChat(matchId) {
  if (!matchId) return;
  state.draft = "";
  await loadChat(matchId);
  state.view = "messages";
  state.chatFocus = true;
  render();
}

function startLiveTicker() {
  clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    updateLiveBits();
    if (state.inspectorOpen && state.inspectorTab === "network") return;
    const boost = state.globals?.boost;
    if (boost && boost.expires_at > 0 && boost.expires_at - Date.now() < 1000) {
      refreshMeta()
        .then(() => render())
        .catch(() => {});
    }
  }, 1000);
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const viewTarget = event.target.closest("[data-view]");
    if (viewTarget) {
      await openView(viewTarget.dataset.view);
      return;
    }
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) {
      const action = actionTarget.dataset.action;
      if (action === "like") swipe("like");
      else if (action === "pass") swipe("pass");
      else if (action === "super") swipe("super");
      else if (action === "rewind") rewind();
      else if (action === "boost") activateBoost();
      else if (action === "inspector") openInspector("routes");
      else if (action === "close-modal") closeModals();
      else if (action === "gold") {
        await togglePremium(true);
        closeModals();
        toast("Gold simulated for this session", "sparkle");
      } else if (action === "toggle-gold") {
        await togglePremium(!state.premium);
        toast(
          state.premium ? "Gold simulated" : "Back to the free tier",
          "sparkle",
        );
      } else if (action === "toggle-discoverable") {
        await setDiscoverable(!(state.profile?.discoverable ?? true));
      } else if (action === "toggle-bio-filter") {
        await setPreferenceBio(
          state.profile?.preference_filters?.preference_has_bio_filter !== true,
        );
      } else if (action === "reset") {
        closeModals();
        await resetDemo();
      } else if (action === "logout") {
        await api("POST", "/v2/auth/logout").catch(() => {});
        logoutToLogin();
      } else if (action === "reload-recs") {
        await loadRecs().catch(() => {});
        render();
      } else if (action === "chat-back") {
        state.activeMatchId = null;
        render();
      } else if (action === "chat-match") {
        closeModals();
        if (actionTarget.dataset.matchId)
          openChat(actionTarget.dataset.matchId);
      } else if (action === "like-back") {
        const id = actionTarget.dataset.profileId;
        closeModals();
        await likeProfile(id);
      }
      return;
    }

    const matchRow = event.target.closest("[data-match-id]");
    if (matchRow && matchRow.classList.contains("match-row")) {
      await openChat(matchRow.dataset.matchId);
      return;
    }

    const likeCard = event.target.closest("[data-like-id]");
    if (likeCard) {
      const like = state.likes.items.find(
        (item) => item.profileId === likeCard.dataset.likeId,
      );
      if (like) {
        if (state.premium) openLikePreview(like);
        else
          openUpgradeModal(
            "See who likes you",
            "The likes grid is the clearest example of a server-gated feature in the recovered contract.",
          );
      }
      return;
    }

    const routeHead = event.target.closest("[data-route-id]");
    if (routeHead) {
      state.openRouteId =
        state.openRouteId === routeHead.dataset.routeId
          ? null
          : routeHead.dataset.routeId;
      renderInspector();
      return;
    }

    const callRow = event.target.closest("[data-call-id]");
    if (callRow) {
      state.selectedCallId = callRow.dataset.callId;
      renderInspector();
      return;
    }

    const tab = event.target.closest("#inspector-tabs button");
    if (tab) {
      state.inspectorTab = tab.dataset.tab;
      renderInspector();
      return;
    }

    if (event.target.closest("#inspector-close")) {
      closeInspector();
      return;
    }

    if (event.target.closest("#overlay")) {
      closeModals();
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-form='message']");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("input[name='message']");
    const value = input?.value ?? "";
    if (value.trim() === "") return;
    sendMessage(value);
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches(".chat-compose input"))
      state.draft = event.target.value;
  });

  document.addEventListener("change", (event) => {
    const select = event.target.closest("[data-action='location']");
    if (select) changeLocation(select.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if ($("#modal-root").childElementCount > 0) closeModals();
      else if (state.inspectorOpen) closeInspector();
      return;
    }
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement?.tagName ?? "",
    );
    if (typing) return;
    if (state.view !== "discover" || state.busy) return;
    if ($("#modal-root").childElementCount > 0) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      swipe("pass");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      swipe("like");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      swipe("super");
    }
  });

  $("#login-button").addEventListener("click", async () => {
    const button = $("#login-button");
    button.disabled = true;
    button.querySelector("span").textContent = "Creating a local session…";
    try {
      await login();
    } catch (error) {
      button.disabled = false;
      button.querySelector("span").textContent = "Enter the reconstruction";
      toast("Could not reach the local mock server", "x");
      console.error(error);
    }
  });

  $("#login-contract").addEventListener("click", () => openInspector("routes"));
}

// ---------------------------------------------------------------------------
// Boot

async function init() {
  bindEvents();
  if (state.token) {
    const restored = await restoreSession();
    if (restored) {
      await start();
      return;
    }
  }
  $("#login").classList.remove("hidden");
}

init();
