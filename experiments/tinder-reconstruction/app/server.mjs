#!/usr/bin/env node
// Tinder reconstruction backend.
//
// Implements the request/response contract recovered in ../evidence/api-contract.json
// with local, fictional data. It never contacts Tinder, and it intentionally
// reproduces route shapes, envelopes and quota fields rather than any Tinder
// server behaviour. Reconstruction-only endpoints live under /demo/*.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTO_REPLIES,
  LOCATIONS,
  PROFILES,
  SEEDED_MATCHES,
  VIEWER,
} from "./data/profiles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "public");
const EVIDENCE_DIR = join(HERE, "..", "evidence");

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 4317);
const DEMO_MODE = process.env.REA_TINDER_DEMO_MODE ?? "balanced";

const LIMITS = {
  likes: 100,
  superLikes: 3,
  boosts: 2,
  rewinds: 1,
  boostDurationSeconds: 1800,
  locationCooldownMs: 10 * 60 * 1000,
  recsPerPage: 10,
};

const PROFILE_BY_ID = new Map(PROFILES.map((profile) => [profile.id, profile]));
const MATCH_SEEDS = new Set(SEEDED_MATCHES.map((seed) => seed.profileId));

// ---------------------------------------------------------------------------
// Small utilities

const nowIso = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${randomBytes(9).toString("hex")}`;

function birthDateForAge(age) {
  const today = new Date();
  const year = today.getUTCFullYear() - age;
  return new Date(
    Date.UTC(year, today.getUTCMonth(), Math.max(1, today.getUTCDate())),
  ).toISOString();
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function apiError(res, status, code, extra = {}) {
  json(res, status, { status, error: code, ...extra });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

// Tinder's swipe responses carry an opaque X-Padding header. The value here is
// a deterministic placeholder of similar shape, not a copy of real padding.
function paddingHeader() {
  return randomBytes(8).toString("base64url");
}

// ---------------------------------------------------------------------------
// Serialization into the shapes recovered from the client types

function photoFor(profile, index, src) {
  return {
    id: `${profile.id}_photo_${index + 1}`,
    url: src,
    processedFiles: [{ url: src, width: 900, height: 1200 }],
    crop_info: {
      processed_by_bullseye: true,
      user_customized: false,
      algo: {
        width_pct: 0.82,
        x_offset_pct: 0.09,
        height_pct: 0.68,
        y_offset_pct: 0.08,
      },
      faces: [
        {
          algo: {
            width_pct: 0.42,
            x_offset_pct: 0.29,
            height_pct: 0.31,
            y_offset_pct: 0.12,
          },
          bounding_box_percentage: 18,
        },
      ],
    },
    type: "image",
    extension: "jpg",
    rank: index,
  };
}

function userFor(profile) {
  return {
    _id: profile.id,
    name: profile.name,
    birth_date: birthDateForAge(profile.age),
    gender: profile.gender,
    bio: profile.bio,
    photos: profile.photos.map((photo, index) =>
      photoFor(profile, index, photo.src),
    ),
    badges: profile.verified ? [{ type: "selfie_verified" }] : [],
    is_verified: profile.verified,
    // Reconstruction extension: the analyzed public types do not expose job or
    // education slots, so these are added for the profile sheet.
    job: profile.job,
    school: profile.school,
    city: { name: profile.city },
    distance_mi: profile.distance_mi,
    active_now: profile.activeNow,
  };
}

function viewerFor(session) {
  return {
    _id: session.user._id,
    name: VIEWER.name,
    birth_date: birthDateForAge(VIEWER.age),
    gender: VIEWER.gender,
    bio: VIEWER.bio,
    photos: [photoFor({ id: "u_viewer" }, 0, VIEWER.photo)],
    badges: [],
    is_verified: false,
    job: VIEWER.job,
    school: VIEWER.school,
    city: { name: VIEWER.city },
  };
}

function recsResult(session, profile) {
  const sameCity = session.location.name === profile.city;
  return {
    type: "user",
    distance_mi: sameCity ? profile.distance_mi : null,
    content_hash: createHash("sha256")
      .update(profile.id)
      .digest("hex")
      .slice(0, 16),
    s_number: Number.parseInt(
      createHash("sha256").update(`${profile.id}:s`).digest("hex").slice(0, 8),
      16,
    ),
    teaser: {
      type: "photo",
      string: `${profile.neighborhood}, ${profile.city}`,
    },
    user: userFor(profile),
    facebook: {
      common_connections: [],
      connection_count: 0,
      common_interests: [],
    },
    spotify: null,
    // Prompts are served here because the public types leave the content slots
    // opaque (`profile_detail_content.content: unknown[]`).
    profile_detail_content: profile.prompts.map((prompt) => ({
      type: "prompt",
      content: [{ prompt: prompt.prompt, answer: prompt.answer }],
    })),
    tappy_content: profile.interests.map((interest) => ({
      type: "interest",
      content: interest,
    })),
    experiment_info: {
      user_interests: {
        selected_interests: profile.interests.map((interest) => ({
          id: `it_${interest.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_")}`,
          name: interest,
          is_common: false,
        })),
      },
    },
    user_posts: [],
    is_superlike_upsell: session.quota.superLikesRemaining === 0,
    // Reconstruction extension used by the card UI.
    rea: {
      occupation: profile.job,
      prompts: profile.prompts,
      interests: profile.interests,
    },
  };
}

function messageFor(matchId, message, viewerId, personId) {
  const fromViewer = message.from === "me";
  return {
    _id: message.id,
    match_id: matchId,
    from: fromViewer ? viewerId : personId,
    to: fromViewer ? personId : viewerId,
    message: message.text,
    sent_date: message.sentAt,
    timestamp: Date.parse(message.sentAt),
    created_date: message.sentAt,
    matchId,
    is_seen: message.isSeen === true,
  };
}

function matchFor(session, match) {
  const profile = PROFILE_BY_ID.get(match.profileId);
  const messages = match.messages.map((message) =>
    messageFor(match.id, message, session.user._id, match.profileId),
  );
  const last = match.messages.at(-1);
  return {
    _id: match.id,
    id: match.id,
    closed: false,
    dead: false,
    pending: false,
    common_friend_count: 0,
    common_like_count: 0,
    created_date: match.createdAt,
    last_activity_date: match.lastActivity,
    message_count: match.messages.length,
    messages: messages.slice(-1),
    participants: [session.user._id, match.profileId],
    person: userFor(profile),
    seen: {
      match_seen: session.seenMatches.has(match.id),
      last_seen_msg_id: match.lastSeenMessageId ?? null,
    },
    readreceipt: { enabled: true },
    is_super_like: match.isSuperLike,
    is_boost_match: match.isBoostMatch,
    is_super_boost_match: false,
    is_primetime_boost_match: false,
    is_experiences_match: false,
    is_fast_match: false,
    is_preferences_match: false,
    is_matchmaker_match: false,
    is_lets_meet_match: false,
    is_opener: false,
    has_shown_initial_interest: true,
    following: false,
    following_moments: false,
    subscription_tier: "gold",
    // Reconstruction extension: distance + interests for the list UI.
    rea: {
      distance_mi: profile.distance_mi,
      city: profile.city,
      interests: profile.interests,
      last_message_text: last?.text ?? null,
      last_message_from: last?.from ?? null,
    },
  };
}

function boostState(session) {
  if (session.boost.expiresAt <= Date.now()) {
    session.boost.active = false;
  }
  return {
    allotment: LIMITS.boosts,
    allotment_used: LIMITS.boosts - session.quota.boostsRemaining,
    allotment_remaining: session.quota.boostsRemaining,
    internal_remaining: session.quota.boostsRemaining,
    is_super_boost: false,
    purchased_remaining: 0,
    resets_at: Date.now() + 24 * 60 * 60 * 1000,
    remaining: session.quota.boostsRemaining,
    duration: LIMITS.boostDurationSeconds,
    consumption_expiry: [],
    boost_refresh_amount: 1,
    boost_refresh_interval: 24,
    boost_refresh_interval_unit: "hour",
    mini_boost_remaining: 0,
    boost_type: session.boost.active ? "regular" : "none",
    compound_boost: [],
    boost_id: session.boost.id,
    multiplier: session.boost.active ? 2.5 : 1,
    consumed_from: session.quota.boostsRemaining,
    expires_at: session.boost.expiresAt || 0,
  };
}

function superLikesState(session) {
  return {
    remaining: session.quota.superLikesRemaining,
    alc_remaining: session.quota.superLikesRemaining,
    new_alc_remaining: session.quota.superLikesRemaining,
    allotment: LIMITS.superLikes,
    superlike_refresh_amount: 1,
    superlike_refresh_interval: 24,
    superlike_refresh_interval_unit: "hour",
    resets_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    consumption_expiry: [],
  };
}

function globalsFor(session) {
  return {
    status: 200,
    globals: {
      recs_size: LIMITS.recsPerPage,
      likes_remaining: session.quota.likesRemaining,
      likes_reset_at: session.likesResetAt,
      super_likes: superLikesState(session),
      boost: boostState(session),
      can_like: session.quota.likesRemaining > 0,
      can_super_like: session.quota.superLikesRemaining > 0,
      tinder_gold: session.premium,
      tinder_plus: session.premium,
      is_verified: false,
      age_filter_min: session.filters.ageFilterMin,
      age_filter_max: session.filters.ageFilterMax,
      distance_filter: session.filters.distanceFilter,
      recs_interval: 1000,
      rewind_remaining: session.quota.rewindsRemaining,
    },
  };
}

// ---------------------------------------------------------------------------
// Session lifecycle

function resetQuotasIfNeeded(session) {
  if (Date.now() >= session.likesResetAt) {
    session.quota.likesRemaining = LIMITS.likes;
    session.likesResetAt = Date.now() + 24 * 60 * 60 * 1000;
  }
}

function createSession(deviceId) {
  const session = {
    token: `rea_${randomBytes(24).toString("base64url")}`,
    deviceId: deviceId ?? `dev_${randomUUID()}`,
    createdAt: nowIso(),
    user: { _id: `u_${randomBytes(8).toString("hex")}` },
    premium: false,
    quota: {
      likesRemaining: LIMITS.likes,
      superLikesRemaining: LIMITS.superLikes,
      boostsRemaining: LIMITS.boosts,
      rewindsRemaining: LIMITS.rewinds,
    },
    likesResetAt: Date.now() + 24 * 60 * 60 * 1000,
    filters: {
      ageFilterMin: 18,
      ageFilterMax: 55,
      distanceFilter: 50,
      genderFilter: -1,
    },
    discoverable: true,
    preferenceFilters: {},
    location: { ...LOCATIONS[0] },
    locationUpdatedAt: 0,
    swiped: new Map(),
    incomingLikes: new Set(
      PROFILES.filter(
        (profile) => profile.likesYou && !MATCH_SEEDS.has(profile.id),
      ).map((profile) => profile.id),
    ),
    matches: [],
    deck: [],
    boost: { active: false, id: null, expiresAt: 0, timers: [] },
    botState: new Map(),
    sockets: new Set(),
    seenMatches: new Set(),
    events: [],
  };
  session.deck = shuffle(
    PROFILES.filter((profile) => !MATCH_SEEDS.has(profile.id)).map(
      (profile) => profile.id,
    ),
  );
  session.matches = SEEDED_MATCHES.map((seed) => {
    const created = Date.parse(nowIso()) - seed.daysAgo * 24 * 60 * 60 * 1000;
    const messages = seed.messages.map((message) => ({
      id: uid("msg"),
      from: message.from,
      text: message.text,
      sentAt: new Date(
        Date.now() - message.minutesAgo * 60 * 1000,
      ).toISOString(),
      isSeen: true,
    }));
    return {
      id: uid("match"),
      profileId: seed.profileId,
      createdAt: new Date(created).toISOString(),
      lastActivity: messages.at(-1)?.sentAt ?? new Date(created).toISOString(),
      isSuperLike: seed.isSuperLike,
      isBoostMatch: seed.isBoostMatch,
      seen: seed.seen,
      lastSeenMessageId: messages.at(-1)?.id ?? null,
      messages,
    };
  });
  for (const [index, seed] of SEEDED_MATCHES.entries()) {
    if (seed.seen) session.seenMatches.add(session.matches[index].id);
  }
  return session;
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

const sessions = new Map();

function sessionFor(req, url) {
  const token = req.headers["x-auth-token"] ?? url.searchParams.get("token");
  if (typeof token !== "string" || token === "") return null;
  return sessions.get(token) ?? null;
}

// ---------------------------------------------------------------------------
// Realtime channel (a small RFC 6455 server, mirroring /ws/generate + /ws)

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const wsTokens = new Map();

function encodeFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = body.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, body]);
}

function publish(session, event) {
  session.events.push({ ...event, at: nowIso() });
  if (session.events.length > 50) session.events.shift();
  const frame = encodeFrame(JSON.stringify({ ...event, at: nowIso() }));
  for (const socket of session.sockets) {
    if (socket.destroyed) continue;
    socket.write(frame);
  }
}

function attachSocket(req, socket, session) {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  session.sockets.add(socket);
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    // Only control frames are relevant; text frames from the client are ignored.
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) return;
      const payload = Buffer.from(
        buffer.subarray(offset + maskLength, offset + maskLength + length),
      );
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      buffer = buffer.subarray(offset + maskLength + length);
      if (opcode === 0x8) {
        socket.end(encodeFrame(Buffer.alloc(0), 0x8));
        return;
      }
      if (opcode === 0x9) {
        socket.write(encodeFrame(payload, 0xa));
      }
    }
  });
  const cleanup = () => {
    session.sockets.delete(socket);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  publish(session, { type: "socket.open" });
}

const heartbeat = setInterval(() => {
  for (const session of sessions.values()) {
    for (const socket of session.sockets) {
      if (!socket.destroyed) socket.write(encodeFrame(Buffer.alloc(0), 0x9));
    }
  }
}, 30000);
heartbeat.unref();

// ---------------------------------------------------------------------------
// Matching and chat simulation

function createMatch(session, profileId, { isSuperLike, isBoostMatch }) {
  const existing = session.matches.find(
    (match) => match.profileId === profileId,
  );
  if (existing) return existing;
  session.incomingLikes.delete(profileId);
  const match = {
    id: uid("match"),
    profileId,
    createdAt: nowIso(),
    lastActivity: nowIso(),
    isSuperLike,
    isBoostMatch,
    seen: false,
    lastSeenMessageId: null,
    messages: [],
  };
  session.matches.push(match);
  session.deck = session.deck.filter((id) => id !== profileId);
  publish(session, { type: "match.created", matchId: match.id, profileId });
  return match;
}

function scheduleBotReply(session, match) {
  const state = session.botState.get(match.id) ?? { index: 0 };
  session.botState.set(match.id, state);
  publish(session, { type: "message.typing", matchId: match.id });
  const delay = 1200 + Math.random() * 1800;
  const timer = setTimeout(() => {
    const line = AUTO_REPLIES[state.index % AUTO_REPLIES.length];
    state.index += 1;
    const message = {
      id: uid("msg"),
      from: "them",
      text: line,
      sentAt: nowIso(),
      isSeen: false,
    };
    match.messages.push(message);
    match.lastActivity = message.sentAt;
    match.seen = false;
    session.seenMatches.delete(match.id);
    publish(session, {
      type: "message.created",
      matchId: match.id,
      profileId: match.profileId,
      message: messageFor(match.id, message, session.user._id, match.profileId),
    });
  }, delay);
  timer.unref?.();
}

function scheduleBoostLikes(session) {
  const candidates = session.deck.filter(
    (id) => !session.incomingLikes.has(id) && !session.swiped.has(id),
  );
  const picks = shuffle(candidates).slice(0, Math.min(3, candidates.length));
  picks.forEach((profileId, index) => {
    const timer = setTimeout(
      () => {
        if (!session.boost.active) return;
        session.incomingLikes.add(profileId);
        publish(session, {
          type: "like.received",
          profileId,
          likes: session.incomingLikes.size,
          boost: true,
        });
      },
      5000 + index * 9000,
    );
    timer.unref?.();
    session.boost.timers.push(timer);
  });
}

function expireBoostIfNeeded(session) {
  if (session.boost.active && Date.now() >= session.boost.expiresAt) {
    session.boost.active = false;
    publish(session, { type: "boost.expired" });
  }
}

// ---------------------------------------------------------------------------
// Static files

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".webmanifest", "application/manifest+json"],
]);

async function serveStatic(res, pathname) {
  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(PUBLIC_DIR, relative));
  if (!candidate.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const data = await readFile(candidate);
    const extension = extname(candidate).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME.get(extension) ?? "application/octet-stream",
      "content-length": data.length,
      "cache-control":
        extension === ".html" ? "no-cache" : "public, max-age=300",
    });
    res.end(data);
  } catch {
    if (extname(candidate) === "") {
      await serveStatic(res, "/index.html");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

// ---------------------------------------------------------------------------
// API

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method ?? "GET";

  if (pathname === "/v2/auth/login/guest" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const session = createSession(
      typeof body.device_id === "string" ? body.device_id : undefined,
    );
    sessions.set(session.token, session);
    console.log(`[auth] new demo session ${session.token.slice(0, 12)}…`);
    json(res, 200, {
      meta: { status: 200 },
      token: session.token,
      device_id: session.deviceId,
      user: viewerFor(session),
      is_new_account: true,
      rea: {
        note: "Reconstruction stand-in for Tinder's SMS/Facebook/web login flows.",
      },
    });
    return true;
  }

  if (pathname === "/demo/health" && method === "GET") {
    json(res, 200, {
      status: 200,
      sessions: sessions.size,
      uptime_s: Math.round(process.uptime()),
      demo_mode: DEMO_MODE,
    });
    return true;
  }

  if (pathname === "/demo/contract" && method === "GET") {
    try {
      const data = await readFile(
        join(EVIDENCE_DIR, "api-contract.json"),
        "utf8",
      );
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(data);
    } catch {
      apiError(res, 500, "contract_unavailable");
    }
    return true;
  }

  if (pathname === "/demo/evidence" && method === "GET") {
    try {
      const data = await readFile(
        join(EVIDENCE_DIR, "rea-extract.json"),
        "utf8",
      );
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(data);
    } catch {
      apiError(res, 500, "evidence_unavailable");
    }
    return true;
  }

  const isApiPath =
    /^\/(v2|v3|like|pass|user|boost|report|media|updates|ws)(\/|$)/.test(
      pathname,
    ) || pathname.startsWith("/demo/");
  if (!isApiPath) return false;

  const session = sessionFor(req, url);
  if (session === null) {
    apiError(res, 401, "unauthorized", { detail: "Send X-AUTH-TOKEN." });
    return true;
  }
  resetQuotasIfNeeded(session);
  expireBoostIfNeeded(session);

  if (pathname === "/v2/auth/logout" && method === "POST") {
    sessions.delete(session.token);
    json(res, 200, { status: 200 });
    return true;
  }

  if (pathname === "/v2/meta" && method === "GET") {
    json(res, 200, globalsFor(session));
    return true;
  }

  if (pathname === "/v2/meta" && method === "POST") {
    const body = await readBody(req).catch(() => null);
    if (
      body === null ||
      typeof body.lat !== "number" ||
      typeof body.lon !== "number"
    ) {
      apiError(res, 400, "invalid_location");
      return true;
    }
    if (
      Date.now() - session.locationUpdatedAt < LIMITS.locationCooldownMs &&
      session.locationUpdatedAt !== 0
    ) {
      const retryAt = session.locationUpdatedAt + LIMITS.locationCooldownMs;
      apiError(res, 429, "location_update_too_frequent", { retry_at: retryAt });
      return true;
    }
    const known = LOCATIONS.find(
      (location) =>
        Math.abs(location.lat - body.lat) < 0.01 &&
        Math.abs(location.lon - body.lon) < 0.01,
    );
    session.location = {
      name: known?.name ?? `${body.lat.toFixed(2)}, ${body.lon.toFixed(2)}`,
      lat: body.lat,
      lon: body.lon,
    };
    session.locationUpdatedAt = Date.now();
    const excluded = new Set([
      ...session.swiped.keys(),
      ...session.matches.map((match) => match.profileId),
    ]);
    session.deck = shuffle(
      PROFILES.filter((profile) => !excluded.has(profile.id)).map(
        (profile) => profile.id,
      ),
    );
    publish(session, {
      type: "location.updated",
      location: session.location.name,
    });
    json(res, 200, {
      meta: { status: 200 },
      data: {
        readreceipts: { enabled: true },
        biometric_consent: { consents: [], needs_consent: false },
        profile: {
          can_edit_jobs: true,
          can_edit_schools: true,
          can_edit_email: true,
        },
        super_like: { enabled: true, alc_mode: 0 },
        super_boost: { enabled: false, duration: 1800, multiplier: 1 },
        travel: {
          is_traveling: session.location.name !== VIEWER.city,
          travel_location: session.location.name,
        },
        location_prechecks: { codes: [] },
        age_verification: { status: "verified" },
      },
    });
    return true;
  }

  if (pathname === "/v2/recs/core" && method === "GET") {
    if (session.quota.likesRemaining <= 0) {
      apiError(res, 429, "out_of_likes", {
        likes_reset_at: session.likesResetAt,
      });
      return true;
    }
    while (session.deck.length < LIMITS.recsPerPage) {
      const excluded = new Set([
        ...session.swiped.keys(),
        ...session.matches.map((match) => match.profileId),
        ...session.deck,
      ]);
      const recycled = shuffle(
        PROFILES.filter((profile) => !excluded.has(profile.id)),
      ).map((profile) => profile.id);
      const fresh = recycled.filter((id) => !session.deck.includes(id));
      if (fresh.length === 0) break;
      session.deck.push(...fresh);
    }
    const pageIds = session.deck.slice(0, LIMITS.recsPerPage);
    json(res, 200, {
      meta: { status: 200 },
      data: {
        results: pageIds.map((id) =>
          recsResult(session, PROFILE_BY_ID.get(id)),
        ),
      },
      rea: {
        coverage: {
          deck_remaining: session.deck.length,
          location: session.location.name,
          source: "local fictional profiles",
        },
      },
    });
    return true;
  }

  const likeMatch = /^\/like\/([^/]+?)(\/super)?$/.exec(pathname);
  if (likeMatch !== null && method === "POST") {
    const [, profileId, superSuffix] = likeMatch;
    const profile = PROFILE_BY_ID.get(profileId);
    if (profile === undefined) {
      apiError(res, 404, "unknown_user");
      return true;
    }
    const isSuper = superSuffix !== undefined;
    if (isSuper && session.quota.superLikesRemaining <= 0) {
      apiError(res, 403, "no_super_likes", {
        super_likes: superLikesState(session),
      });
      return true;
    }
    const prior = session.swiped.get(profileId);
    if (prior !== undefined) {
      json(
        res,
        200,
        {
          match: prior.match,
          likes_remaining: session.quota.likesRemaining,
          status: 200,
          match_id: prior.matchId ?? null,
        },
        {
          "x-padding": paddingHeader(),
        },
      );
      return true;
    }
    if (session.quota.likesRemaining <= 0) {
      apiError(res, 429, "out_of_likes", {
        likes_reset_at: session.likesResetAt,
      });
      return true;
    }
    const body = await readBody(req).catch(() => ({}));
    session.quota.likesRemaining -= 1;
    if (isSuper) session.quota.superLikesRemaining -= 1;
    const reciprocal = session.incomingLikes.has(profileId);
    const match = reciprocal
      ? createMatch(session, profileId, {
          isSuperLike: isSuper,
          isBoostMatch: session.boost.active,
        })
      : null;
    session.swiped.set(profileId, {
      action: isSuper ? "super" : "like",
      match: reciprocal,
      matchId: match?.id ?? null,
      s_number: body.s_number ?? null,
    });
    session.deck = session.deck.filter((id) => id !== profileId);
    const response = {
      match: reciprocal,
      likes_remaining: session.quota.likesRemaining,
      status: 200,
      ...(isSuper ? { super_likes: superLikesState(session) } : {}),
      match_id: match?.id ?? null,
    };
    json(res, 200, response, { "x-padding": paddingHeader() });
    return true;
  }

  const passMatch = /^\/pass\/([^/]+)$/.exec(pathname);
  if (passMatch !== null && method === "GET") {
    const profileId = passMatch[1];
    if (!PROFILE_BY_ID.has(profileId)) {
      apiError(res, 404, "unknown_user");
      return true;
    }
    if (!session.swiped.has(profileId)) {
      session.swiped.set(profileId, {
        action: "pass",
        match: false,
        matchId: null,
        s_number: url.searchParams.get("s_number"),
      });
      session.deck = session.deck.filter((id) => id !== profileId);
    }
    json(res, 200, { status: 200 }, { "x-padding": paddingHeader() });
    return true;
  }

  if (pathname === "/boost" && method === "POST") {
    if (session.quota.boostsRemaining <= 0) {
      apiError(res, 403, "no_boosts_available", { boost: boostState(session) });
      return true;
    }
    session.quota.boostsRemaining -= 1;
    session.boost.active = true;
    session.boost.id = uid("boost");
    session.boost.expiresAt = Date.now() + LIMITS.boostDurationSeconds * 1000;
    scheduleBoostLikes(session);
    publish(session, {
      type: "boost.activated",
      expiresAt: session.boost.expiresAt,
    });
    json(res, 200, boostState(session));
    return true;
  }

  if (pathname === "/v2/profile" && method === "GET") {
    json(res, 200, {
      meta: { status: 200 },
      data: {
        user: viewerFor(session),
        account: {
          account_phone_number: "+263 ••• ••• 000",
          account_email: "alex@example.com",
          is_email_verified: true,
        },
        likes: {
          likes_remaining: session.quota.likesRemaining,
          likes_reset_at: session.likesResetAt,
          rate_limited_until: 0,
        },
        boost: boostState(session),
        super_likes: superLikesState(session),
        travel: {
          is_traveling: session.location.name !== VIEWER.city,
          travel_location: session.location.name,
        },
        paywalls: [],
        feature_access: {
          can_see_likes: session.premium,
          can_rewind: session.premium,
          can_passport: true,
        },
        preferences: session.filters,
        discoverable: session.discoverable,
        preference_filters: session.preferenceFilters,
      },
    });
    return true;
  }

  if (pathname === "/v2/profile" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const user = body.user ?? body;
    if (user.age_filter_min !== undefined)
      session.filters.ageFilterMin = Number(user.age_filter_min);
    if (user.age_filter_max !== undefined)
      session.filters.ageFilterMax = Number(user.age_filter_max);
    if (user.distance_filter !== undefined)
      session.filters.distanceFilter = Number(user.distance_filter);
    if (user.gender_filter !== undefined)
      session.filters.genderFilter = Number(user.gender_filter);
    if (user.discoverable !== undefined)
      session.discoverable = user.discoverable === true;
    json(res, 200, {
      meta: { status: 200 },
      data: {
        user: viewerFor(session),
        preferences: session.filters,
        discoverable: session.discoverable,
      },
    });
    return true;
  }

  if (pathname === "/v2/profile/user" && method === "POST") {
    if (!session.premium) {
      // The analyzed client maps HTTP 403 on this route to a premium-required error.
      apiError(res, 403, "premium_required", {
        detail:
          "Editing profile preference filters requires a Tinder premium subscription.",
      });
      return true;
    }
    const body = await readBody(req).catch(() => ({}));
    const filters = body.preference_filters ?? {};
    session.preferenceFilters = { ...session.preferenceFilters, ...filters };
    json(res, 200, {
      meta: { status: 200 },
      data: {
        user: viewerFor(session),
        preference_filters: session.preferenceFilters,
      },
    });
    return true;
  }

  if (pathname === "/v2/matches" && method === "GET") {
    const count = Math.min(
      Number(url.searchParams.get("count") ?? 60) || 60,
      100,
    );
    const matches = [...session.matches]
      .sort(
        (left, right) =>
          Date.parse(right.lastActivity) - Date.parse(left.lastActivity),
      )
      .slice(0, count)
      .map((match) => matchFor(session, match));
    const unread = session.matches.filter(
      (match) => !session.seenMatches.has(match.id),
    ).length;
    json(res, 200, {
      meta: { status: 200 },
      data: { matches },
      rea: { unread },
    });
    return true;
  }

  const messagesMatch = /^\/v2\/matches\/([^/]+)\/messages$/.exec(pathname);
  if (messagesMatch !== null && method === "GET") {
    const match = session.matches.find(
      (candidate) => candidate.id === messagesMatch[1],
    );
    if (match === undefined) {
      apiError(res, 404, "unknown_match");
      return true;
    }
    session.seenMatches.add(match.id);
    match.seen = true;
    match.messages = match.messages.map((message) => ({
      ...message,
      isSeen: true,
    }));
    match.lastSeenMessageId = match.messages.at(-1)?.id ?? null;
    const count = Math.min(
      Number(url.searchParams.get("count") ?? 100) || 100,
      200,
    );
    json(res, 200, {
      meta: { status: 200 },
      data: {
        messages: match.messages
          .slice(-count)
          .map((message) =>
            messageFor(match.id, message, session.user._id, match.profileId),
          ),
        person: userFor(PROFILE_BY_ID.get(match.profileId)),
      },
    });
    return true;
  }

  const sendMatch = /^\/user\/matches\/([^/]+)$/.exec(pathname);
  if (sendMatch !== null && method === "POST") {
    const match = session.matches.find(
      (candidate) => candidate.id === sendMatch[1],
    );
    if (match === undefined) {
      apiError(res, 404, "unknown_match");
      return true;
    }
    const body = await readBody(req).catch(() => ({}));
    if (typeof body.message !== "string" || body.message.trim() === "") {
      apiError(res, 400, "empty_message");
      return true;
    }
    const message = {
      id: uid("msg"),
      from: "me",
      text: body.message.slice(0, 500),
      sentAt: nowIso(),
      isSeen: false,
    };
    match.messages.push(message);
    match.lastActivity = message.sentAt;
    match.seen = true;
    session.seenMatches.add(match.id);
    scheduleBotReply(session, match);
    json(
      res,
      201,
      messageFor(match.id, message, session.user._id, match.profileId),
    );
    return true;
  }

  if (pathname === "/ws/generate" && method === "GET") {
    const socketToken = uid("ws");
    wsTokens.set(socketToken, { session, expiresAt: Date.now() + 60 * 1000 });
    json(res, 200, { token: socketToken, expires_at: Date.now() + 60 * 1000 });
    return true;
  }

  // Reconstruction-only endpoints. These are deliberately namespaced so they
  // cannot be mistaken for recovered Tinder routes.
  if (pathname === "/demo/likes" && method === "GET") {
    const profiles = [...session.incomingLikes]
      .filter((profileId) => !session.swiped.has(profileId))
      .map((profileId) => {
        const profile = PROFILE_BY_ID.get(profileId);
        return {
          profileId,
          name: profile.name,
          age: profile.age,
          city: profile.city,
          distance_mi: profile.distance_mi,
          photo: profile.photos[0].src,
          blurred_photo: profile.photos[0].src,
          verified: profile.verified,
        };
      });
    json(res, 200, {
      likes: profiles,
      count: profiles.length,
      premium_required: !session.premium,
      note: "Reconstruction-only view of the likes a real client would gate behind Tinder Gold.",
    });
    return true;
  }

  if (pathname === "/demo/premium" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    session.premium = body.enabled === true;
    json(res, 200, { premium: session.premium });
    return true;
  }

  if (pathname === "/demo/rewind" && method === "POST") {
    const last = [...session.swiped.entries()]
      .filter(([, swipe]) => swipe.action !== undefined)
      .at(-1);
    if (last === undefined) {
      apiError(res, 409, "nothing_to_rewind");
      return true;
    }
    if (!session.premium && session.quota.rewindsRemaining <= 0) {
      apiError(res, 403, "premium_required", { feature: "rewind" });
      return true;
    }
    if (!session.premium) session.quota.rewindsRemaining -= 1;
    const [profileId, swipe] = last;
    session.swiped.delete(profileId);
    if (swipe.match && swipe.matchId !== null) {
      session.matches = session.matches.filter(
        (match) => match.id !== swipe.matchId,
      );
    }
    session.deck.unshift(profileId);
    json(res, 200, {
      status: 200,
      restored: recsResult(session, PROFILE_BY_ID.get(profileId)),
    });
    return true;
  }

  if (pathname === "/demo/reset" && method === "POST") {
    const deviceId = session.deviceId;
    sessions.delete(session.token);
    const fresh = createSession(deviceId);
    sessions.set(fresh.token, fresh);
    json(res, 200, { token: fresh.token, user: viewerFor(fresh) });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Server

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, x-auth-token, persistent-device-id, platform, app-version",
  );
  res.setHeader(
    "access-control-allow-methods",
    "GET, POST, DELETE, PUT, OPTIONS",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // WebSocket upgrade path, mirroring GET /ws with a token from /ws/generate.
  if (
    url.pathname === "/ws" &&
    (req.headers.upgrade ?? "").toLowerCase() === "websocket"
  ) {
    const token = url.searchParams.get("token") ?? "";
    const entry = wsTokens.get(token);
    if (entry === undefined || entry.expiresAt < Date.now()) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("invalid socket token");
      return;
    }
    wsTokens.delete(token);
    attachSocket(req, req.socket, entry.session);
    return;
  }

  try {
    const handled = await handleApi(req, res, url);
    if (handled) {
      console.log(
        `${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`,
      );
      return;
    }
  } catch (error) {
    console.error("api failure", error);
    if (!res.headersSent) apiError(res, 500, "internal_error");
    else res.end();
    return;
  }

  if (
    /^\/(v2|v3|like|pass|user|boost|report|media|updates)(\/|$)/.test(
      url.pathname,
    )
  ) {
    apiError(res, 404, "not_found", {
      detail: "No reconstruction route matches this path.",
    });
    return;
  }
  await serveStatic(res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Tinder reconstruction listening on http://${HOST}:${PORT}`);
  console.log(`Contract: /demo/contract · Health: /demo/health`);
});
