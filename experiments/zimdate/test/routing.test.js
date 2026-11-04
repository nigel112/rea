/**
 * Unit tests for the two modules extracted out of `api.js`: the route matcher and request
 * validation.
 *
 * These are tested directly rather than through HTTP because the interesting cases are
 * adversarial inputs — malformed percent-escapes, wrong-length paths, a signup payload where every
 * field is bad at once — and a test that has to boot a server to check `matchPattern` is a test
 * nobody writes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchPattern, matchRoute } from '../server/routing.js';
import {
  normaliseLookingFor,
  questionIndexMap,
  validateAnswer,
  validateSignup,
} from '../server/domain/validation.js';
import { QUESTIONS_BY_ID } from '../server/seed/questions.js';

const NOW = '2026-06-15T12:00:00.000Z';

describe('routing', () => {
  it('matches literal paths exactly', () => {
    assert.deepEqual(matchPattern('/api/health', '/api/health'), {});
    assert.equal(matchPattern('/api/health', '/api/health/'), null);
    assert.equal(matchPattern('/api/health', '/api/healthz'), null);
    // Case matters: URLs are case-sensitive and a router that is not will happily serve
    // /API/ADMIN/USERS/x/BAN to someone probing for a bypass.
    assert.equal(matchPattern('/api/health', '/API/HEALTH'), null);
  });

  it('captures :params and decodes them', () => {
    assert.deepEqual(matchPattern('/api/profile/:userId', '/api/profile/usr_0042'), { userId: 'usr_0042' });
    assert.deepEqual(matchPattern('/api/matches/:matchId/messages', '/api/matches/mch_1/messages'), {
      matchId: 'mch_1',
    });
    assert.deepEqual(matchPattern('/api/profile/:userId', '/api/profile/Rudo%20Chikafu'), {
      userId: 'Rudo Chikafu',
    });
  });

  it('rejects wrong segment counts and empty params', () => {
    assert.equal(matchPattern('/api/profile/:userId', '/api/profile'), null);
    assert.equal(matchPattern('/api/profile/:userId', '/api/profile/usr_1/extra'), null);
    assert.equal(matchPattern('/api/profile/:userId', '/api/profile/'), null);
  });

  it('treats a malformed percent-escape as no-match, not as a crash', () => {
    // decodeURIComponent throws on this. A router that lets it bubble turns a junk URL into a 500.
    assert.equal(matchPattern('/api/profile/:userId', '/api/profile/%E0%A4%A'), null);
  });

  it('serves HEAD from GET handlers', () => {
    const routes = [['GET', '/api/health', () => 'ok', { public: true }]];
    assert.equal(matchRoute(routes, 'GET', '/api/health')?.handler(), 'ok');
    assert.equal(matchRoute(routes, 'HEAD', '/api/health')?.handler(), 'ok');
    assert.equal(matchRoute(routes, 'POST', '/api/health'), null);
  });

  it('prefers the first matching route', () => {
    const routes = [
      ['GET', '/api/x/:id', () => 'param'],
      ['GET', '/api/x/special', () => 'literal'],
    ];
    // Order is declared order, which is why literal routes must be listed before parameterised
    // ones that would also match them.
    assert.equal(matchRoute(routes, 'GET', '/api/x/special')?.handler(), 'param');
  });
});

describe('signup validation', () => {
  const valid = {
    email: 'rudo@example.com',
    password: 'a-good-password',
    name: 'Rudo',
    birthDate: '1996-04-12',
    gender: 'woman',
    lookingFor: ['man'],
    city: 'Harare',
    intent: 'long-term',
  };

  it('accepts a well-formed payload', () => {
    const result = validateSignup(valid, NOW);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, {});
    assert.equal(result.value.email, 'rudo@example.com');
  });

  it('reports every bad field at once', () => {
    const result = validateSignup({}, NOW);
    assert.equal(result.ok, false);
    // A form that only reveals one error per submit is a form people abandon.
    assert.deepEqual(Object.keys(result.errors).sort(), [
      'birthDate',
      'city',
      'email',
      'gender',
      'lookingFor',
      'name',
      'password',
    ]);
  });

  it('enforces the 18+ gate on the date, not on a client-supplied age', () => {
    // 17 years and 364 days old on the reference date.
    const almost = validateSignup({ ...valid, birthDate: '2008-06-16' }, NOW);
    assert.equal(almost.ok, false);
    assert.match(almost.errors.birthDate, /18 or older/);

    const justTurned = validateSignup({ ...valid, birthDate: '2008-06-15' }, NOW);
    assert.equal(justTurned.ok, true, 'someone who turns 18 today is allowed');
  });

  it('rejects impossible and malformed dates', () => {
    for (const birthDate of ['2000-13-01', '2000-02-31', 'not-a-date', '2000/01/01', '']) {
      const result = validateSignup({ ...valid, birthDate }, NOW);
      assert.equal(result.ok, false, `expected ${birthDate} to be rejected`);
    }
  });

  it('rejects absurd ages', () => {
    assert.equal(validateSignup({ ...valid, birthDate: '1850-01-01' }, NOW).ok, false);
  });

  it('normalises email case and whitespace', () => {
    const result = validateSignup({ ...valid, email: '  Rudo@Example.COM  ' }, NOW);
    assert.equal(result.value.email, 'rudo@example.com');
  });

  it('requires at least one valid orientation and a known city', () => {
    assert.equal(validateSignup({ ...valid, lookingFor: [] }, NOW).ok, false);
    assert.equal(validateSignup({ ...valid, lookingFor: ['goblin'] }, NOW).ok, false);
    assert.equal(validateSignup({ ...valid, city: 'Atlantis' }, NOW).ok, false);
  });

  it('bounds the password without silently truncating it', () => {
    assert.equal(validateSignup({ ...valid, password: 'short' }, NOW).ok, false);
    assert.equal(validateSignup({ ...valid, password: 'x'.repeat(201) }, NOW).ok, false);
    assert.equal(validateSignup({ ...valid, password: 'x'.repeat(200) }, NOW).ok, true);
  });
});

describe('looking-for normalisation', () => {
  it('dedupes and drops unknown values', () => {
    assert.deepEqual(normaliseLookingFor(['man', 'man', 'goblin', 'nonbinary']), ['man', 'nonbinary']);
  });

  it('returns null when nothing valid survives', () => {
    assert.equal(normaliseLookingFor(['goblin']), null);
    assert.equal(normaliseLookingFor([]), null);
    assert.equal(normaliseLookingFor('man'), null, 'a bare string is not a list');
    assert.equal(normaliseLookingFor(null), null);
  });
});

describe('answer validation', () => {
  // QUESTIONS_BY_ID is a Map, not a plain object: Object.values() on it returns [] and every
  // assertion below would fail on `undefined.options` rather than on the behaviour under test.
  const question = [...QUESTIONS_BY_ID.values()][0];

  it('accepts a valid answer and normalises the accepted set', () => {
    const optionIds = question.options.map((option) => option.id);
    const result = validateAnswer(question, {
      answer: optionIds[0],
      accept: [optionIds[0], optionIds[1], optionIds[0]],
      importance: 'very',
    });
    assert.equal(result.answer, optionIds[0]);
    // Duplicates collapse; that is what "which answers would you accept" means.
    assert.deepEqual(result.accept, [optionIds[0], optionIds[1]]);
    assert.equal(result.importance, 'very');
    assert.equal(result.visibility, 'public');
  });

  it('rejects an answer the question does not offer', () => {
    assert.throws(
      () => validateAnswer(question, { answer: 'not-an-option', accept: [] }),
      /Pick one of the options/,
    );
  });

  it('requires an explicit accepted set', () => {
    const optionIds = question.options.map((option) => option.id);
    assert.throws(() => validateAnswer(question, { answer: optionIds[0] }), /would accept/);
  });

  it('rejects an unknown importance level', () => {
    const optionIds = question.options.map((option) => option.id);
    assert.throws(
      () => validateAnswer(question, { answer: optionIds[0], accept: [optionIds[0]], importance: 'critical' }),
      /importance level/,
    );
  });

  it('defaults to a little importance and public visibility', () => {
    const optionIds = question.options.map((option) => option.id);
    const result = validateAnswer(question, { answer: optionIds[0], accept: [optionIds[0]] });
    assert.equal(result.importance, 'little');
    assert.equal(result.visibility, 'public');
  });

  it('marks private answers private', () => {
    const optionIds = question.options.map((option) => option.id);
    const result = validateAnswer(question, {
      answer: optionIds[0],
      accept: [optionIds[0]],
      visibility: 'private',
    });
    assert.equal(result.visibility, 'private');
  });

  it('bounds the explanation', () => {
    const optionIds = question.options.map((option) => option.id);
    const result = validateAnswer(question, {
      answer: optionIds[0],
      accept: [optionIds[0]],
      explanation: 'x'.repeat(5000),
    });
    assert.equal(result.explanation.length, 1000);
  });

  it('exposes the question index', () => {
    const index = questionIndexMap();
    assert.equal(index.size, QUESTIONS_BY_ID.size);
  });
});
