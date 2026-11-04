#!/usr/bin/env node
/**
 * Seed the ZimDate database.
 *
 *   node scripts/seed.mjs             # add the demo world if it is missing
 *   node scripts/seed.mjs --fresh     # wipe and rebuild from scratch
 *   node scripts/seed.mjs --profiles 200
 *
 * Output is a small JSON summary so the command is scriptable and CI-friendly.
 */
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { openAndMigrate, get } from '../server/db/index.js';
import { seedDatabase, DEFAULT_SEED, DEMO_EMAIL, DEMO_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD } from '../server/seed/seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const { values } = parseArgs({
  options: {
    fresh: { type: 'boolean', default: false },
    profiles: { type: 'string' },
    seed: { type: 'string' },
    db: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const dbPath = resolve(values.db ?? process.env.ZIMDATE_DB ?? resolve(root, 'data', 'zimdate.db'));
const profiles = values.profiles ? Number(values.profiles) : 500;
const seed = values.seed ? Number(values.seed) : DEFAULT_SEED;

if (!Number.isFinite(profiles) || profiles < 1 || profiles > 5000) {
  console.error(JSON.stringify({ ok: false, error: 'profiles must be between 1 and 5000' }));
  process.exit(2);
}
if (!Number.isFinite(seed)) {
  console.error(JSON.stringify({ ok: false, error: 'seed must be a number' }));
  process.exit(2);
}

if (values.fresh) {
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    if (existsSync(target)) rmSync(target, { force: true });
  }
}
mkdirSync(dirname(dbPath), { recursive: true });

const db = openAndMigrate(dbPath);
const existing = get(db, `SELECT COUNT(*) AS count FROM users`);

if (!values.fresh && (existing?.count ?? 0) > 1) {
  if (!values.quiet) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'database already seeded — use --fresh to rebuild',
      users: existing.count,
      db: dbPath,
    }, null, 2));
  }
  db.close();
  process.exit(0);
}

const started = Date.now();
const summary = seedDatabase(db, { seed, profiles });
const elapsedMs = Date.now() - started;

const totals = get(db, `SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM answers) AS answers,
    (SELECT COUNT(*) FROM photos) AS photos,
    (SELECT COUNT(*) FROM likes) AS likes,
    (SELECT COUNT(*) FROM matches) AS matches,
    (SELECT COUNT(*) FROM messages) AS messages,
    (SELECT COUNT(*) FROM blocks) AS blocks,
    (SELECT COUNT(*) FROM reports) AS reports,
    (SELECT COUNT(*) FROM notifications) AS notifications`);

if (!values.quiet) {
  console.log(JSON.stringify({
    ok: true,
    db: dbPath,
    seed: summary.seed,
    digest: summary.digest,
    elapsedMs,
    archetypes: summary.archetypes,
    totals,
    demo: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  }, null, 2));
}

db.close();
