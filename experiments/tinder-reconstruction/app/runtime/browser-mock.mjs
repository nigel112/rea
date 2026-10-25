// Offline runtime: runs the reconstruction's mock API inside the page.
//
// The Android build ships the same mock core the web preview uses
// (../mock-core.mjs). This module supplies the two things a browser build
// lacks — a transport (window.fetch and WebSocket) and file access to the
// Evidence JSON — so the app works with no server and no network.
//
// It is only injected into the packaged build; the web preview keeps talking to
// the real Node server in app/server.mjs.

import {
  claimSocketToken,
  configureMock,
  handleApi,
  notifySocketOpen,
} from "./mock-core.mjs";

const API_PATH =
  /^\/(v2|v3|like|pass|user|boost|report|media|updates|ws|demo)(\/|$)/;

// ---------------------------------------------------------------------------
// Host hooks

/** Live sockets, kept in step with the sessions the core hands out. */
const sockets = new Set();

configureMock({
  publish: (session, event) => {
    const text = JSON.stringify(event);
    for (const entry of sockets) {
      if (entry.session === session) entry.deliver(text);
    }
  },
  // Evidence is staged under /offline/evidence in the packaged app. The path is
  // absolute because fetch() resolves against the document, not this module.
  readEvidence: async (name) => {
    const response = await rawFetch(`/offline/evidence/${name}`);
    return response.ok ? response.text() : null;
  },
  uptime: () => performance.now() / 1000,
});

// ---------------------------------------------------------------------------
// Minimal Node-style request/response pair for the core's handlers

const encoder = new TextEncoder();

function makeRequest(method, url, headers, bodyText) {
  const listeners = new Map();
  const emit = (event, payload) => {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  };
  const request = {
    method,
    url,
    headers,
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return request;
    },
    destroy() {},
  };
  // Deliver the body the way a socket would: asynchronously, after handlers attach.
  queueMicrotask(() => {
    if (bodyText !== "") emit("data", encoder.encode(bodyText));
    emit("end");
  });
  return request;
}

function makeResponse() {
  const headers = {};
  let status = 200;
  let settle;
  const done = new Promise((resolve) => {
    settle = resolve;
  });
  const response = {
    statusCode: status,
    headersSent: false,
    setHeader(name, value) {
      headers[name.toLowerCase()] = String(value);
    },
    writeHead(code, extra = {}) {
      status = code;
      response.statusCode = code;
      for (const [name, value] of Object.entries(extra)) {
        headers[name.toLowerCase()] = String(value);
      }
      response.headersSent = true;
    },
    end(payload = "") {
      response.headersSent = true;
      settle({ status, headers, body: payload });
    },
  };
  return { response, done };
}

// ---------------------------------------------------------------------------
// fetch

const rawFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init = {}) => {
  const target =
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : String(input);
  const url = new URL(target, location.href);
  if (!API_PATH.test(url.pathname)) return rawFetch(input, init);

  const headers = {};
  new Headers(init.headers ?? {}).forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  headers.host = location.host;

  const method = (init.method ?? "GET").toUpperCase();
  const body =
    typeof init.body === "string"
      ? init.body
      : init.body === undefined || init.body === null
        ? ""
        : String(init.body);

  const request = makeRequest(method, url.pathname + url.search, headers, body);
  const { response, done } = makeResponse();
  let handled = false;
  try {
    handled = await handleApi(request, response, url);
  } catch (error) {
    console.error("mock core failed", error);
    return new Response(
      JSON.stringify({ status: 500, error: "internal_error" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  if (!handled) {
    return new Response(
      JSON.stringify({
        status: 404,
        error: "not_found",
        detail: "No reconstruction route matches this path.",
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
  const captured = await done;
  return new Response(captured.body, {
    status: captured.status,
    headers: captured.headers,
  });
};

// ---------------------------------------------------------------------------
// WebSocket (the app expects GET /ws/generate then an upgrade to /ws)

class LocalWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = LocalWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.closeHandle = null;

    const parsed = new URL(this.url, location.href);
    const session = claimSocketToken(parsed.searchParams.get("token") ?? "");

    queueMicrotask(() => {
      if (session === null) {
        this.readyState = LocalWebSocket.CLOSED;
        this.dispatchEvent(new Event("error"));
        this.dispatchEvent(new CloseEvent("close"));
        return;
      }
      this.readyState = LocalWebSocket.OPEN;
      const entry = {
        session,
        deliver: (text) => {
          const event = new MessageEvent("message", { data: text });
          this.dispatchEvent(event);
          if (typeof this.onmessage === "function") this.onmessage(event);
        },
      };
      sockets.add(entry);
      this.closeHandle = () => {
        sockets.delete(entry);
        this.readyState = LocalWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
        if (typeof this.onclose === "function")
          this.onclose(new CloseEvent("close"));
      };
      notifySocketOpen(session);
      this.dispatchEvent(new Event("open"));
      if (typeof this.onopen === "function") this.onopen(new Event("open"));
    });
  }

  send() {
    // The reconstruction client never sends application frames.
  }

  close() {
    this.closeHandle?.();
  }
}

globalThis.WebSocket = LocalWebSocket;

// Tell the UI where it is running.
globalThis.__REA_RUNTIME__ = "on-device";
