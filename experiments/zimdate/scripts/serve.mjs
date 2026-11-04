#!/usr/bin/env node
/**
 * ZimDate server entry point.
 *
 *   node scripts/serve.mjs                 # http://0.0.0.0:3000, seeds if the DB is missing
 *   PORT=8080 node scripts/serve.mjs
 *   ZIMDATE_DB=/tmp/x.db node scripts/serve.mjs
 *
 * Binds 0.0.0.0 so the sandbox preview proxy can reach it.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openAndMigrate, get } from '../server/db/index.js';
import { createZimDateServer } from '../server/api.js';
import { seedDatabase, DEMO_EMAIL, DEMO_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD } from '../server/seed/seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = resolve(process.env.ZIMDATE_DB ?? resolve(root, 'data', 'zimdate.db'));
const autoSeed = process.env.ZIMDATE_AUTOSEED !== '0';

mkdirSync(dirname(dbPath), { recursive: true });
const db = openAndMigrate(dbPath);

const userCount = get(db, `SELECT COUNT(*) AS count FROM users`)?.count ?? 0;
let seedSummary = null;
if (userCount <= 1 && autoSeed) {
  const started = Date.now();
  seedSummary = seedDatabase(db, { profiles: Number(process.env.ZIMDATE_PROFILES ?? 500) });
  seedSummary.elapsedMs = Date.now() - started;
}

const app = createZimDateServer({ db });

const server = createServer((req, res) => {
  app.handle(req, res).catch((error) => {
    console.error('[zimdate] fatal handler error', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong.' } }));
    } else {
      res.end();
    }
  });
});

server.listen(port, host, () => {
  const total = get(db, `SELECT COUNT(*) AS count FROM users`)?.count ?? 0;
  console.log(`ZimDate listening on http://${host}:${port}`);
  console.log(`  database : ${dbPath}`);
  console.log(`  profiles : ${total}`);
  if (seedSummary) console.log(`  seeded   : ${seedSummary.users} users, ${seedSummary.answers} answers in ${seedSummary.elapsedMs} ms`);
  console.log(`  demo     : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  admin    : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
});

function shutdown(signal) {
  console.log(`\n[zimdate] ${signal} received, shutting down`);
  server.close(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    process.exit(0);
  });
  // Do not hang forever on keep-alive connections.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
