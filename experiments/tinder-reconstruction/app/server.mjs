#!/usr/bin/env node
// Tinder reconstruction backend — Node host.
//
// Everything that defines the mock (routes, sessions, quotas, matching, chat)
// lives in ./mock-core.mjs so the identical code can run inside the Android
// WebView. This file only adds what a browser build cannot have: a static file
// server, a real RFC 6455 socket, and fs access to the Evidence files.
//
// It never contacts Tinder, and it reproduces route shapes, envelopes and quota
// fields rather than any Tinder server behaviour. Reconstruction-only endpoints
// live under /demo/*.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import {
  claimSocketToken,
  configureMock,
  handleApi,
  notifySocketOpen,
  sessionCount,
} from "./mock-core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "public");
const EVIDENCE_DIR = join(HERE, "..", "evidence");

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 4317);

// ---------------------------------------------------------------------------
// Realtime channel (a small RFC 6455 server, mirroring /ws/generate + /ws)

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const sockets = new Set();

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

// Core publishes domain events; the Node host puts them on the wire.
configureMock({
  publish: (session, event) => {
    const frame = encodeFrame(JSON.stringify({ ...event, at: new Date().toISOString() }));
    for (const entry of sockets) {
      if (entry.session !== session || entry.socket.destroyed) continue;
      entry.socket.write(frame);
    }
  },
  readEvidence: async (name) => {
    try {
      return await readFile(join(EVIDENCE_DIR, name), "utf8");
    } catch {
      return null;
    }
  },
  uptime: () => process.uptime(),
});

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
  const entry = { socket, session };
  sockets.add(entry);
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
    sockets.delete(entry);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  notifySocketOpen(session);
}

const heartbeat = setInterval(() => {
  for (const entry of sockets) {
    if (!entry.socket.destroyed) entry.socket.write(encodeFrame(Buffer.alloc(0), 0x9));
  }
}, 30000);
heartbeat.unref();

// ---------------------------------------------------------------------------
// Static assets

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
]);

async function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(PUBLIC_DIR, relative));
  if (!candidate.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    const data = await readFile(candidate);
    const extension = extname(candidate).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME.get(extension) ?? "application/octet-stream",
      "cache-control": extension === ".html" ? "no-store" : "public, max-age=300",
      "content-length": data.length,
    });
    res.end(data);
  } catch {
    if (extname(candidate) === "") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
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
    const session = claimSocketToken(token);
    if (session === null) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("invalid socket token");
      return;
    }
    attachSocket(req, req.socket, session);
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
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: 500, error: "internal_error" }));
    } else {
      res.end();
    }
    return;
  }

  if (
    /^\/(v2|v3|like|pass|user|boost|report|media|updates)(\/|$)/.test(
      url.pathname,
    )
  ) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: 404,
        error: "not_found",
        detail: "No reconstruction route matches this path.",
      }),
    );
    return;
  }
  await serveStatic(res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Tinder reconstruction listening on http://${HOST}:${PORT}`);
  console.log(`Contract: /demo/contract · Health: /demo/health`);
  console.log(`Sessions: ${sessionCount()}`);
});
