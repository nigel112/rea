/**
 * SQLite access for ZimDate.
 *
 * Uses Node's built-in `node:sqlite` (available in Node 22.5+ / 24) so the project has zero runtime
 * dependencies. Everything that touches SQL goes through this module: callers get small helpers and
 * a transaction wrapper, never a raw handle they can leak.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(here, 'schema.sql');

/** @param {string} path */
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

/** Apply the schema. Idempotent: every statement is CREATE ... IF NOT EXISTS. */
export function migrate(db) {
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

/** Open and migrate in one step. */
export function openAndMigrate(path) {
  return migrate(openDatabase(path));
}

/** Rows as plain objects (node:sqlite returns null-prototype objects). */
export function all(db, sql, ...params) {
  return db.prepare(sql).all(...params).map(plain);
}

export function get(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? plain(row) : null;
}

export function run(db, sql, ...params) {
  return db.prepare(sql).run(...params);
}

export function pluck(db, sql, ...params) {
  const row = get(db, sql, ...params);
  if (!row) return undefined;
  const keys = Object.keys(row);
  return keys.length > 0 ? row[keys[0]] : undefined;
}

/** Run `fn` inside BEGIN/COMMIT, rolling back on throw. Not re-entrant, by design. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A rollback failure must not mask the original error.
    }
    throw error;
  }
}

/** Convert a null-prototype row into a normal object for callers and JSON serialisation. */
export function plain(row) {
  return { ...row };
}

/** Safe JSON parse that never throws on corrupt data; returns the fallback instead. */
export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJson(value) {
  return JSON.stringify(value ?? null);
}
