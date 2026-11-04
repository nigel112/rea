/**
 * Parity test: the TypeScript mirror must agree with the JavaScript runtime kernel.
 *
 * Node 22 cannot execute TypeScript, so on that runtime the test skips with an explicit reason
 * instead of pretending it ran. On Node >= 22.18 with type stripping (the REA pinned toolchain is
 * Node 24) it cross-checks a matrix of fixture pairs against `compat.js`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as js from '../server/lib/compat.js';

const fixtures = [
  {
    name: 'perfect mutual fit',
    a: [{ questionId: 'q1', answer: 'a', accept: ['a', 'b'], importance: 'very' }],
    b: [{ questionId: 'q1', answer: 'b', accept: ['a', 'b'], importance: 'very' }],
  },
  {
    name: 'one-sided rejection',
    a: [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' }],
    b: [{ questionId: 'q1', answer: 'b', accept: ['a'], importance: 'mandatory' }],
  },
  {
    name: 'asymmetric weights',
    a: [
      { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' },
      { questionId: 'q2', answer: 'b', accept: ['a'], importance: 'little' },
    ],
    b: [
      { questionId: 'q1', answer: 'a', accept: ['b'], importance: 'somewhat' },
      { questionId: 'q2', answer: 'b', accept: ['b'], importance: 'very' },
    ],
  },
  { name: 'no overlap', a: [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' }], b: [] },
  {
    name: 'all irrelevant',
    a: [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'irrelevant' }],
    b: [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'irrelevant' }],
  },
  {
    name: 'junk rows',
    a: [{ questionId: 'q1', answer: 'a', accept: null, importance: 'bogus' }],
    b: [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 10 }],
  },
];

describe('compat.ts mirror parity', () => {
  it('agrees with compat.js across the fixture matrix', async (t) => {
    let ts;
    try {
      ts = await import('../server/lib/compat.ts');
    } catch (error) {
      t.skip(`TypeScript execution unavailable on this runtime (${error.code ?? error.message})`);
      return;
    }

    for (const fixture of fixtures) {
      const jsResult = js.scoreAnswerRows(fixture.a, fixture.b);
      const tsResult = ts.scoreAnswerRows(fixture.a, fixture.b);
      assert.deepEqual(tsResult, jsResult, `mismatch for fixture: ${fixture.name}`);
      assert.deepEqual(ts.describeScore(tsResult), js.describeScore(jsResult));
    }
    assert.deepEqual(ts.IMPORTANCE, js.IMPORTANCE);
    assert.deepEqual(ts.IMPORTANCE_LEVELS, js.IMPORTANCE_LEVELS);
  });
});
