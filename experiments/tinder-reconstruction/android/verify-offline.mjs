#!/usr/bin/env node
// Verify the packaged (offline) bundle before it becomes an APK.
//
// Part 1 imports the real staged runtime — the same files that ship in the APK —
// and drives the mock API through the patched fetch() and WebSocket, with an
// asset shim standing in for the WebView. No server runs.
//
// Part 2 (optional) loads the staged index.html in jsdom and runs the real UI
// against that runtime.
//
// Usage: node android/stage.mjs && node android/verify-offline.mjs

import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, "build", "www");
const ORIGIN = "https://app.local";

let failures = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
};

// --- Browser-ish globals the runtime expects -------------------------------

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
};

Object.defineProperty(globalThis, "location", {
  value: new URL(`${ORIGIN}/index.html`),
  writable: true,
  configurable: true,
});

if (typeof globalThis.CloseEvent !== "function") {
  globalThis.CloseEvent = class CloseEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.code = init.code ?? 1000;
      this.reason = init.reason ?? "";
    }
  };
}

// Stand-in for the WebView's asset loader: every non-API request reads a file.
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
  try {
    const data = await readFile(join(WWW, url.pathname));
    return new Response(data, {
      status: 200,
      headers: { "content-type": MIME[extname(url.pathname)] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("missing", { status: 404 });
  }
};

const { default: _unused } = { default: null };

// --- Part 1: mock API over the offline transport ---------------------------

await import(pathToFileURL(join(WWW, "offline", "browser-mock.mjs")).href);
check("runtime advertises on-device mode", globalThis.__REA_RUNTIME__ === "on-device");

const call = async (method, path, body, token) => {
  const headers = { "persistent-device-id": "verify-device" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-auth-token"] = token;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
};

const health = await call("GET", "/demo/health");
check("health reachable offline", health.status === 200, `uptime ${health.data?.uptime_s}s`);

const login = await call("POST", "/v2/auth/login/guest", { device_id: "verify-device" });
check("guest login", login.status === 200 && typeof login.data.token === "string");
const token = login.data.token;

const unauth = await call("GET", "/v2/meta");
check("auth gate holds", unauth.status === 401);

const recs = await call("GET", "/v2/recs/core", undefined, token);
check("deck served", recs.status === 200 && recs.data.data.results.length > 0, `${recs.data?.data?.results?.length} cards`);
const first = recs.data.data.results[0];
check("recs carry recovered fields", typeof first.content_hash === "string" && typeof first.s_number === "number",
  `hash ${first.content_hash.slice(0, 8)}… s ${first.s_number}`);

const like = await call("POST", `/like/${first.user._id}`, { s_number: first.s_number, liked_content_id: first.user._id, liked_content_type: "photo" }, token);
check("like accepted", like.status === 200, `match=${like.data.match} remaining=${like.data.likes_remaining}`);
check("opaque padding header present", like.headers.get("x-padding") !== null);

const matches = await call("GET", "/v2/matches?count=60&message=1", undefined, token);
check("matches list", matches.status === 200 && matches.data.data.matches.length >= 2, `${matches.data?.data?.matches?.length} matches`);

const contract = await call("GET", "/demo/contract");
check("contract served from bundle", contract.status === 200 && contract.data.endpoints.length === 18, `${contract.data?.endpoints?.length} endpoints`);
const evidence = await call("GET", "/demo/evidence");
check("evidence served from bundle", evidence.status === 200 && evidence.data.route_recovery.length === 9);

// Unauthenticated API paths fail the auth gate before routing, like the server.
const unknownAnon = await call("GET", "/v2/does-not-exist");
check("unauthenticated unknown path hits the auth gate", unknownAnon.status === 401);
const unknown = await call("GET", "/v2/does-not-exist", undefined, token);
check("unknown API path 404s", unknown.status === 404 && unknown.data.error === "not_found");

// WebSocket: token -> socket -> events
const wsToken = await call("GET", "/ws/generate", undefined, token);
check("socket token issued", wsToken.status === 200 && typeof wsToken.data.token === "string");
const events = [];
const socket = new WebSocket(`wss://app.local/ws?token=${encodeURIComponent(wsToken.data.token)}`);
socket.addEventListener("message", (event) => events.push(JSON.parse(event.data)));
const opened = await new Promise((resolve) => {
  socket.addEventListener("open", () => resolve(true));
  socket.addEventListener("error", () => resolve(false));
  setTimeout(() => resolve(false), 2000);
});
check("socket opens offline", opened);
check("socket reports open event", events.some((event) => event.type === "socket.open"), events.map((e) => e.type).join(","));

const seeded = matches.data.data.matches[0];
await call("POST", `/user/matches/${seeded._id}`, { message: "offline hello" }, token);
const replied = await new Promise((resolve) => {
  const timer = setInterval(() => {
    if (events.some((event) => event.type === "message.created")) {
      clearInterval(timer);
      resolve(true);
    }
  }, 200);
  setTimeout(() => {
    clearInterval(timer);
    resolve(false);
  }, 8000);
});
check("simulated reply arrives over the local socket", replied, events.map((e) => e.type).join(","));
socket.close();

// --- Part 2: the real UI against that runtime ------------------------------

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import("jsdom"));
} catch {
  console.log("\n(jsdom not installed: skipping the DOM pass)");
}

if (JSDOM) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  virtualConsole.on("error", (...args) => errors.push(args.join(" ")));

  const html = await readFile(join(WWW, "index.html"), "utf8");
  const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/g, ""), {
    url: `${ORIGIN}/index.html`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  window.fetch = globalThis.fetch;
  window.WebSocket = globalThis.WebSocket;
  window.eval(await readFile(join(WWW, "app.js"), "utf8"));

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const doc = window.document;
  await wait(200);
  doc.querySelector("#login-button").click();
  await wait(1500);
  check("UI logs in offline", doc.querySelector("#login").classList.contains("hidden"));
  check("UI renders a deck", doc.querySelectorAll(".deck .card").length > 0, `${doc.querySelectorAll(".deck .card").length} cards`);
  doc.querySelector("[data-action='like']").click();
  await wait(1200);
  doc.querySelector("[data-action='inspector']").click();
  await wait(500);
  const inspector = doc.querySelector("#inspector-body")?.textContent ?? "";
  check("inspector shows recovered routes", inspector.includes("/v2/recs/core"));
  doc.querySelector("#inspector-body [data-route-id]")?.click();
  await wait(300);
  check(
    "inspector shows evidence ids",
    (doc.querySelector("#inspector-body")?.textContent ?? "").includes("ev_"),
  );
  doc.querySelector("#inspector-tabs [data-tab='evidence']")?.click();
  await wait(400);
  check("evidence tab renders offline", (doc.querySelector("#inspector-body")?.textContent ?? "").includes("19,000") || (doc.querySelector("#inspector-body")?.textContent ?? "").includes("14,197"));
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  window.close();
}

console.log(failures === 0 ? "\noffline bundle verification passed" : `\noffline bundle verification failed: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
