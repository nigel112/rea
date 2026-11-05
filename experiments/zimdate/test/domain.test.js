/**
 * Domain rules: eligibility, ranking, likes/matches, messaging, quotas.
 * Each test builds its own in-memory world so order never matters.
 */
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

import { openAndMigrate, run, get, all, toJson } from '../server/db/index.js';
import {
  eligibility,
  haversineKm,
  profileCompleteness,
  interestOverlap,
  recencyScore,
  newcomerBoost,
  hydrateUser,
  ANYWHERE_KM,
} from '../server/domain/eligibility.js';
import * as social from '../server/domain/social.js';
import { buildPool, buildGrid, scoreTrust } from '../server/domain/discovery.js';
import { QUESTIONS_BY_ID } from '../server/seed/questions.js';
import { seedDatabase } from '../server/seed/seed.js';

const NOW = '2026-06-15T12:00:00.000Z';

function makeDb() {
  return openAndMigrate(':memory:');
}

function addUser(db, overrides = {}) {
  const user = {
    id: `u_${Math.random().toString(36).slice(2, 9)}`,
    email: `${Math.random().toString(36).slice(2, 9)}@test.local`,
    name: 'Test Person',
    birthDate: '1994-05-01',
    gender: 'woman',
    lookingFor: ['man'],
    city: 'Harare',
    lat: -17.8252,
    lon: 31.0335,
    minAge: 18,
    maxAge: 99,
    maxDistanceKm: ANYWHERE_KM,
    ...overrides,
  };
  run(
    db,
    `INSERT INTO users (id, email, password_hash, name, birth_date, gender, looking_for, city,
                        lat, lon, min_age, max_age, max_distance_km, coins, last_active_at, created_at)
     VALUES (?, ?, 'x', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user.id,
    user.email,
    user.name,
    user.birthDate,
    user.gender,
    toJson(user.lookingFor),
    user.city,
    user.lat,
    user.lon,
    user.minAge,
    user.maxAge,
    user.maxDistanceKm,
    user.coins ?? 0,
    user.lastActiveAt ?? NOW,
    user.createdAt ?? '2026-01-01T00:00:00.000Z',
  );
  return hydrateUser(get(db, `SELECT * FROM users WHERE id = ?`, user.id));
}

describe('eligibility', () => {
  let db;
  before(() => {
    db = makeDb();
  });

  it('requires mutual orientation', () => {
    const woman = addUser(db, { gender: 'woman', lookingFor: ['man'] });
    const man = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    const gayMan = addUser(db, { gender: 'man', lookingFor: ['man'] });

    assert.equal(eligibility(woman, man, { now: NOW }).ok, true);
    assert.equal(eligibility(woman, gayMan, { now: NOW }).reason, 'orientation');
    assert.equal(eligibility(gayMan, woman, { now: NOW }).reason, 'orientation');
  });

  it('applies both sides age ranges', () => {
    // Both are compatible on orientation, so any rejection must come from the age rule.
    const young = addUser(db, { birthDate: '2004-05-01', minAge: 18, maxAge: 99 }); // 22
    const older = addUser(db, { gender: 'man', lookingFor: ['woman'], birthDate: '1980-05-01', minAge: 30, maxAge: 45 }); // 46
    assert.equal(eligibility(young, older, { now: NOW }).reason, 'age_range');
    assert.equal(eligibility(older, young, { now: NOW }).reason, 'age_range');

    const mid = addUser(db, { gender: 'man', lookingFor: ['woman'], birthDate: '1994-05-01', minAge: 18, maxAge: 99 });
    assert.equal(eligibility(young, mid, { now: NOW }).ok, true);
  });

  it('applies both sides distance ranges', () => {
    const harare = addUser(db, { city: 'Harare', lat: -17.8252, lon: 31.0335, maxDistanceKm: 50 });
    const bulawayo = addUser(db, { gender: 'man', lookingFor: ['woman'], city: 'Bulawayo', lat: -20.1325, lon: 28.6265, maxDistanceKm: ANYWHERE_KM });
    // Harare ↔ Bulawayo is ~360 km. Harare's 50 km filter excludes Bulawayo… 
    assert.equal(eligibility(harare, bulawayo, { now: NOW }).reason, 'distance');
    // …while Bulawayo's "anywhere" filter would allow Harare. The *pair* is still ineligible in
    // both directions, because a viewer only ever sees candidates that both sides admit: this is
    // why buildPool applies the predicate per viewer and not just once for the pair.
    assert.equal(eligibility(bulawayo, harare, { now: NOW }).ok, true);
    assert.equal(eligibility(harare, bulawayo, { now: NOW }).ok, false);
    run(db, `UPDATE users SET max_distance_km = ? WHERE id = ?`, ANYWHERE_KM, harare.id);
    const relaxed = hydrateUser(get(db, `SELECT * FROM users WHERE id = ?`, harare.id));
    assert.equal(eligibility(relaxed, bulawayo, { now: NOW }).ok, true);
  });

  it('blocks, self, and banned accounts', () => {
    const a = addUser(db);
    const b = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    assert.equal(eligibility(a, a, { now: NOW }).reason, 'self');
    assert.equal(eligibility(a, b, { now: NOW, blockedIds: new Set([b.id]) }).reason, 'blocked');
    assert.equal(eligibility(a, b, { now: NOW, blockedByIds: new Set([b.id]) }).reason, 'blocked_by');
    const banned = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    run(db, `UPDATE users SET banned = 1 WHERE id = ?`, banned.id);
    assert.equal(eligibility(a, hydrateUser(get(db, `SELECT * FROM users WHERE id = ?`, banned.id)), { now: NOW }).reason, 'banned');
  });
});

describe('geo helpers', () => {
  it('computes Harare–Bulawayo distance', () => {
    const km = haversineKm({ lat: -17.8252, lon: 31.0335 }, { lat: -20.1325, lon: 28.6265 });
    assert.ok(km > 340 && km < 400, `expected ~370, got ${km}`);
  });

  it('scores completeness and overlap', () => {
    const bare = hydrateUser({
      looking_for: '[]', languages: '[]', interests: '[]', prompts: '[]', photo_ids: '[]',
    });
    assert.equal(profileCompleteness(bare), 0);
    assert.equal(interestOverlap(['a', 'b'], ['b', 'c']), 1 / 3);
    assert.equal(interestOverlap([], ['a']), 0);
  });

  it('decays recency and expires newcomer boost', () => {
    assert.ok(recencyScore(NOW, NOW) > 0.99);
    assert.ok(recencyScore('2026-05-01T12:00:00.000Z', NOW) < 0.01);
    assert.equal(newcomerBoost('2026-06-14T12:00:00.000Z', NOW), 1);
    assert.equal(newcomerBoost('2026-01-01T00:00:00.000Z', NOW), 0);
  });
});

describe('likes and matches', () => {
  let db;
  before(() => {
    db = makeDb();
  });

  it('creates a match when likes are mutual, exactly once', () => {
    const a = addUser(db, { gender: 'woman', lookingFor: ['man'] });
    const b = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    const first = social.like(db, a, b, { now: NOW });
    assert.equal(first.matched, false);
    const second = social.like(db, b, a, { now: NOW });
    assert.equal(second.matched, true);
    assert.ok(second.match.id);
    // Repeat likes never create a second match.
    const again = social.like(db, a, b, { now: NOW });
    assert.equal(again.alreadyLiked, true);
    assert.equal(again.matched, true);
    assert.equal(all(db, `SELECT * FROM matches WHERE user_a = ? AND user_b = ?`, ...[a.id, b.id].sort()).length, 1);
  });

  it('enforces the daily like quota', () => {
    const user = addUser(db, { tier: 'free' });
    for (let index = 0; index < 25; index += 1) {
      const target = addUser(db, { gender: 'man', lookingFor: ['woman'] });
      social.like(db, user, target, { now: NOW });
    }
    const extra = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    assert.throws(() => social.like(db, user, extra, { now: NOW }), (error) => error.code === 'like_quota_exhausted');
    // Gold is unlimited.
    run(db, `UPDATE users SET tier = 'gold' WHERE id = ?`, user.id);
    const gold = hydrateUser(get(db, `SELECT * FROM users WHERE id = ?`, user.id));
    assert.equal(social.like(db, gold, extra, { now: NOW }).liked, true);
  });

  it('super likes spend coins and fail cleanly when short', () => {
    const a = addUser(db, { coins: 10 });
    const b = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    social.like(db, a, b, { now: NOW, superLike: true });
    assert.equal(get(db, `SELECT coins FROM users WHERE id = ?`, a.id).coins, 5);
    const broke = addUser(db, { coins: 0 });
    const c = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    assert.throws(
      () => social.like(db, broke, c, { now: NOW, superLike: true }),
      (error) => error.code === 'insufficient_coins',
    );
  });

  it('blocking removes likes and closes the match', () => {
    const a = addUser(db);
    const b = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    social.like(db, a, b, { now: NOW });
    const matched = social.like(db, b, a, { now: NOW }).match;
    social.block(db, a.id, b.id, NOW);
    assert.equal(social.findMatchById(db, matched.id).closed_at !== null, true);
    assert.equal(all(db, `SELECT * FROM likes WHERE from_user = ? AND to_user = ?`, a.id, b.id).length, 0);
  });

  it('cannot like or block yourself', () => {
    const a = addUser(db);
    assert.throws(() => social.like(db, a, a, { now: NOW }), (error) => error.code === 'cannot_like_self');
    assert.throws(() => social.block(db, a.id, a.id, NOW), (error) => error.code === 'cannot_block_self');
  });
});

describe('messaging', () => {
  let db;
  let match;
  let alice;
  let bob;
  before(() => {
    db = makeDb();
    alice = addUser(db);
    bob = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    social.like(db, alice, bob, { now: NOW });
    match = social.like(db, bob, alice, { now: NOW }).match;
  });

  it('is idempotent by clientId', () => {
    const first = social.sendMessage(db, alice, match.id, 'Hello', 'c1', NOW);
    const second = social.sendMessage(db, alice, match.id, 'Hello again', 'c1', NOW);
    assert.equal(second.idempotent, true);
    assert.equal(second.message.id, first.message.id);
    assert.equal(second.message.body, 'Hello');
  });

  it('rejects empty, overlong, foreign and closed conversations', () => {
    assert.throws(() => social.sendMessage(db, alice, match.id, '   ', 'c2', NOW), (error) => error.code === 'empty_message');
    assert.throws(
      () => social.sendMessage(db, alice, match.id, 'x'.repeat(2001), 'c3', NOW),
      (error) => error.code === 'message_too_long',
    );
    const stranger = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    assert.throws(
      () => social.sendMessage(db, stranger, match.id, 'hi', 'c4', NOW),
      (error) => error.code === 'not_a_participant',
    );
    assert.throws(
      () => social.sendMessage(db, alice, 'match_missing', 'hi', 'c5', NOW),
      (error) => error.code === 'match_not_found',
    );
    social.unmatch(db, match.id, alice.id, NOW);
    assert.throws(() => social.sendMessage(db, bob, match.id, 'hi', 'c6', NOW), (error) => error.code === 'match_closed');
  });

  it('rates limits a flooding thread', () => {
    const db2 = makeDb();
    const x = addUser(db2);
    const y = addUser(db2, { gender: 'man', lookingFor: ['woman'] });
    social.like(db2, x, y, { now: NOW });
    const m = social.like(db2, y, x, { now: NOW }).match;
    for (let index = 0; index < social.MESSAGE_RATE.max; index += 1) {
      social.sendMessage(db2, x, m.id, `msg ${index}`, `rate-${index}`, NOW);
    }
    assert.throws(
      () => social.sendMessage(db2, x, m.id, 'one too many', 'rate-over', NOW),
      (error) => error.code === 'rate_limited',
    );
  });

  it('tracks unread counts per participant', () => {
    const db3 = makeDb();
    const x = addUser(db3);
    const y = addUser(db3, { gender: 'man', lookingFor: ['woman'] });
    social.like(db3, x, y, { now: NOW });
    const m = social.like(db3, y, x, { now: NOW }).match;
    social.sendMessage(db3, x, m.id, 'first', 'a1', NOW);
    social.sendMessage(db3, x, m.id, 'second', 'a2', NOW);
    const summary = social.matchSummary(db3, social.findMatchById(db3, m.id), y.id);
    assert.equal(summary.unread, 2);
    social.markThreadRead(db3, m.id, y.id, NOW);
    assert.equal(social.matchSummary(db3, social.findMatchById(db3, m.id), y.id).unread, 0);
  });
});

describe('discovery', () => {
  it('excludes ineligible people and counts the reasons', () => {
    const db = makeDb();
    const viewer = addUser(db, { gender: 'woman', lookingFor: ['man'], maxDistanceKm: 60 });
    addUser(db, { gender: 'woman', lookingFor: ['woman'] }); // orientation
    addUser(db, { gender: 'man', lookingFor: ['woman'], city: 'Bulawayo', lat: -20.13, lon: 28.63 }); // distance
    const good = addUser(db, { gender: 'man', lookingFor: ['woman'], city: 'Harare' });
    assert.ok(good.id);

    const { pool, excluded } = buildPool(db, viewer, { now: NOW, questions: QUESTIONS_BY_ID });
    assert.deepEqual(pool.map((entry) => entry.user.id), [good.id]);
    assert.ok(excluded.orientation >= 1);
    assert.ok(excluded.distance >= 1);
  });

  it('ranks matches above non-matches and reports reasons', () => {
    const db = makeDb();
    const viewer = addUser(db, { gender: 'woman', lookingFor: ['man'] });
    const strong = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    const weak = addUser(db, { gender: 'man', lookingFor: ['woman'] });

    // answers.question_id has a real foreign key: the question catalogue must exist.
    run(
      db,
      `INSERT INTO questions (id, category, text, options, weight_hint, active)
       VALUES ('values_kindness', 'values', 'Test question', '["a","b","c","d"]', '', 1)`,
    );
    const answer = (user, answerId, accept, importance) =>
      run(
        db,
        `INSERT INTO answers (user_id, question_id, answer, accept, importance, created_at, updated_at)
         VALUES (?, 'values_kindness', ?, ?, ?, ?, ?)`,
        user.id, answerId, toJson(accept), importance, NOW, NOW,
      );
    answer(viewer, 'a', ['a'], 'mandatory');
    answer(strong, 'a', ['a'], 'mandatory');
    answer(weak, 'd', ['d'], 'mandatory');

    const { pool } = buildPool(db, viewer, { now: NOW, questions: QUESTIONS_BY_ID });
    assert.equal(pool[0].user.id, strong.id);
    assert.equal(pool[0].score.match, 100);
    assert.equal(pool[1].score.match, 0);
    assert.ok(pool[0].components.reasons.some((reason) => reason.includes('% match')));
    assert.ok(pool[0].components.total > pool[1].components.total);
  });

  it('applies grid filters after scoring', () => {
    const db = makeDb();
    const viewer = addUser(db, { gender: 'woman', lookingFor: ['man'] });
    addUser(db, { gender: 'man', lookingFor: ['woman'], birthDate: '2006-01-01' }); // 20
    addUser(db, { gender: 'man', lookingFor: ['woman'], birthDate: '1986-01-01' }); // 40

    const grid = buildGrid(db, viewer, { minAge: 35, maxAge: 45 }, { now: NOW, questions: QUESTIONS_BY_ID });
    assert.equal(grid.total, 1);
    assert.equal(grid.entries[0].age, 40);
  });
});

describe('reporting', () => {
  it('deduplicates identical reports and validates reasons', () => {
    const db = makeDb();
    const a = addUser(db);
    const b = addUser(db, { gender: 'man', lookingFor: ['woman'] });
    const first = social.report(db, a.id, b.id, 'spam', 'lots of links', NOW);
    const second = social.report(db, a.id, b.id, 'spam', 'again', NOW);
    assert.equal(first.id, second.id);
    assert.equal(all(db, `SELECT * FROM reports WHERE reporter_id = ?`, a.id).length, 1);
    assert.throws(() => social.report(db, a.id, b.id, 'nonsense', '', NOW), (error) => error.code === 'invalid_reason');
  });
});

describe('boosts', () => {
  it('lift a boosted profile in other people\'s ranking without touching the match score', async () => {
    const db = makeDb();
    seedDatabase(db, { profiles: 300, now: NOW });
    const viewer = hydrateUser(get(db, `SELECT * FROM users WHERE id = 'usr_demo'`));

    const before = buildPool(db, viewer, { now: NOW, questions: QUESTIONS_BY_ID });
    const target = before.pool[Math.floor(before.pool.length / 2)];
    const rankBefore = before.pool.findIndex((entry) => entry.user.id === target.user.id);
    const matchBefore = target.score.match;

    run(db, `INSERT INTO boosts (user_id, activated_at, expires_at) VALUES (?, ?, ?)`, target.user.id, NOW, '2026-06-15T12:30:00.000Z');

    const after = buildPool(db, viewer, { now: NOW, questions: QUESTIONS_BY_ID });
    const boosted = after.pool.find((entry) => entry.user.id === target.user.id);
    const rankAfter = after.pool.findIndex((entry) => entry.user.id === target.user.id);

    // A paid boost is visibility, not chemistry: it must move the rank and leave the score alone.
    assert.equal(boosted.components.boosted, true);
    assert.equal(boosted.score.match, matchBefore);
    assert.ok(rankAfter < rankBefore, `expected rank to improve: ${rankBefore} → ${rankAfter}`);
    assert.ok(boosted.components.reasons.includes('Boosted right now'));
    db.close();
  });

  it('expires', async () => {
    const db = makeDb();
    seedDatabase(db, { profiles: 60, now: NOW });
    const viewer = hydrateUser(get(db, `SELECT * FROM users WHERE id = 'usr_demo'`));
    run(db, `INSERT INTO boosts (user_id, activated_at, expires_at) VALUES (?, ?, ?)`, 'usr_0001', NOW, '2026-06-15T11:00:00.000Z');
    const pool = buildPool(db, viewer, { now: NOW, questions: QUESTIONS_BY_ID });
    const entry = pool.pool.find((row) => row.user.id === 'usr_0001');
    // An hour-old boost ended an hour ago and must not still be lifting anyone.
    assert.equal(entry?.components.boosted ?? false, false);
    db.close();
  });
});

describe('score trust', () => {
  it('scales the ranking match term by how much evidence backs it', () => {
    const db = makeDb();
    seedDatabase(db, { profiles: 200, now: NOW });
    const viewer = hydrateUser(get(db, `SELECT * FROM users WHERE id = 'usr_demo'`));
    const pool = buildPool(db, viewer, { now: NOW, questions: QUESTIONS_BY_ID });
    db.close();

    // The bug this guards against: an 86.6% built from 5 shared answers outranking a 64.4% built
    // from 36. If score trust is removed, thin-data profiles climb straight back to the top.
    const top = pool.pool.slice(0, 10);
    const thin = top.filter((entry) => entry.score.ok && entry.score.shared < 10);
    assert.equal(thin.length, 0, `thin-data profiles near the top: ${thin.map((e) => `${e.user.name}/${e.score.shared}`).join(', ')}`);
    assert.ok(top.every((entry) => entry.score.shared >= 10));
  });

  it('still gives thin-data profiles a real floor, so nobody is hidden', () => {
    // Someone you agree with on two questions should still appear — just not at the top.
    const db = makeDb();
    seedDatabase(db, { profiles: 200, now: NOW });
    const viewer = hydrateUser(get(db, `SELECT * FROM users WHERE id = 'usr_demo'`));
    const pool = buildPool(db, viewer, { now: NOW, questions: QUESTIONS_BY_ID });
    db.close();
    const scored = pool.pool.filter((entry) => entry.score.ok);
    assert.ok(scored.length > 0);
    // Every candidate keeps a positive rank contribution; trust discounts, it does not delete.
    assert.ok(scored.every((entry) => entry.components.total > 0));
  });

  it('rewards more shared answers, all else equal', () => {
    assert.ok(scoreTrust(1) < scoreTrust(10));
    assert.ok(scoreTrust(10) < scoreTrust(25));
    // Full credit at the confidence target and flat after it.
    assert.equal(scoreTrust(25), scoreTrust(60));
    assert.equal(scoreTrust(25), 1);
    // Floor for no data at all.
    assert.equal(scoreTrust(0), 0.35);
  });
});
