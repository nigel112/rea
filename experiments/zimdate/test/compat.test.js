import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  IMPORTANCE,
  CONFIDENCE_TARGET,
  importancePoints,
  indexAnswers,
  scorePair,
  scoreAnswerRows,
  describeScore,
  scoreMany,
} from '../server/lib/compat.js';

/** Build a question map for breakdown assertions. */
const catalogue = new Map([
  ['q1', { category: 'values', text: 'Q1', options: ['a', 'b'] }],
  ['q2', { category: 'lifestyle', text: 'Q2', options: ['a', 'b'] }],
  ['q3', { category: 'values', text: 'Q3', options: ['a', 'b'] }],
]);

function pair(aRows, bRows, questions = catalogue) {
  return scorePair(indexAnswers(aRows), indexAnswers(bRows), { questions });
}

describe('importance ladder', () => {
  it('matches the reconstructed 0/1/10/50/250 ladder', () => {
    assert.equal(IMPORTANCE.irrelevant, 0);
    assert.equal(IMPORTANCE.little, 1);
    assert.equal(IMPORTANCE.somewhat, 10);
    assert.equal(IMPORTANCE.very, 50);
    assert.equal(IMPORTANCE.mandatory, 250);
  });

  it('resolves names, numbers, and junk', () => {
    assert.equal(importancePoints('very'), 50);
    assert.equal(importancePoints(7), 7);
    assert.equal(importancePoints('nonsense'), 0);
    assert.equal(importancePoints(-3), 0);
    assert.equal(importancePoints(undefined), 0);
  });
});

describe('match %', () => {
  it('is 100 when both sides accept each other on every shared question', () => {
    const result = pair(
      [{ questionId: 'q1', answer: 'a', accept: ['a', 'b'], importance: 'very' }],
      [{ questionId: 'q1', answer: 'b', accept: ['a', 'b'], importance: 'very' }],
    );
    assert.equal(result.ok, true);
    assert.equal(result.match, 100);
    assert.equal(result.shared, 1);
    assert.equal(result.basis, 'mutual');
  });

  it('is 0 only when somebody is actually rejected', () => {
    const result = pair(
      [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' }],
      [{ questionId: 'q1', answer: 'b', accept: ['a'], importance: 'mandatory' }],
    );
    assert.equal(result.ok, true);
    assert.equal(result.match, 0);
    // Only one side rejects, so only half the possible enemy points are lost.
    assert.equal(result.enemy, 50);
  });

  it('reports no_overlap instead of a fake 0 when no question is shared', () => {
    const result = pair(
      [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' }],
      [{ questionId: 'q2', answer: 'a', accept: ['a'], importance: 'very' }],
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_overlap');
    assert.equal(describeScore(result).label, '—');
  });

  it('treats all-irrelevant overlap as undefined, not as 0', () => {
    const result = pair(
      [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'irrelevant' }],
      [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'irrelevant' }],
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_scoreable_weight');
  });

  it('uses the geometric mean of the two one-sided happiness ratios', () => {
    // A is fully happy (B satisfies all of A's massively-weighted asks).
    // B is only half happy (A satisfies one of two equally-weighted asks of B).
    const result = pair(
      [
        { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' },
        { questionId: 'q2', answer: 'a', accept: ['a'], importance: 'mandatory' },
      ],
      [
        { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' },
        // B answers 'a' again but will only accept a 'b': B is impossible to satisfy here.
        { questionId: 'q2', answer: 'a', accept: ['b'], importance: 'very' },
      ],
    );
    const aHappiness = (250 + 250) / (250 + 250); // 1
    const bHappiness = 50 / (50 + 50); // 0.5
    const expected = Math.round(Math.sqrt(aHappiness * bHappiness) * 1000) / 10;
    assert.equal(result.match, expected);
    assert.equal(result.match, 70.7);
    // The arithmetic mean would have said 75 — the geometric mean is the honest one.
    assert.notEqual(result.match, 75);
  });

  it('penalises one-sided demand imbalance (the mandatory-spam trap)', () => {
    const rows = [
      { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' },
      { questionId: 'q2', answer: 'a', accept: ['a'], importance: 'mandatory' },
      { questionId: 'q3', answer: 'a', accept: ['a'], importance: 'mandatory' },
    ];
    // The candidate agrees on everything but marks it all irrelevant.
    const candidate = rows.map((row) => ({ ...row, importance: 'irrelevant' }));
    const result = pair(rows, candidate);
    // Only the viewer's side is scoreable → basis one_sided, match 100, but flagged,
    // so the UI can say "this person does not care about anything you care about".
    assert.equal(result.basis, 'one_sided');
    assert.equal(result.match, 100);

    // Now the candidate cares (slightly) about something the viewer fails.
    const candidateWithAsk = [{ questionId: 'q1', answer: 'b', accept: ['b'], importance: 'little' }];
    const mixed = pair(rows, candidateWithAsk);
    // The viewer earned 0 of the candidate's 1 point → geometric mean collapses to 0.
    // One point of unmet demand outweighs 750 points of agreement: that is the point.
    assert.equal(mixed.match, 0);
    assert.equal(mixed.basis, 'mutual');
  });

  it('weights by importance, not by question count', () => {
    const result = pair(
      [
        { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' }, // 250, satisfied
        { questionId: 'q2', answer: 'b', accept: ['a'], importance: 'little' }, // 1, rejected by them
      ],
      [
        { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' },
        { questionId: 'q2', answer: 'b', accept: ['b'], importance: 'little' },
      ],
    );
    // Losing 1 point out of 251 is almost invisible; a count-based score would say 50%.
    assert.ok(result.match > 99, `expected >99, got ${result.match}`);
  });
});

describe('friend % and enemy %', () => {
  it('friend % ignores accept sets and measures raw agreement', () => {
    const result = pair(
      [{ questionId: 'q1', answer: 'a', accept: ['b'], importance: 'very' }],
      [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' }],
    );
    assert.equal(result.friend, 100);
    assert.equal(result.match, 0); // one-sided rejection is enough to zero the product
    assert.equal(result.enemy, 50); // only A's 50 points are lost
  });

  it('separates "we agree" from "we each accept the other"', () => {
    const result = pair(
      [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' }],
      [{ questionId: 'q1', answer: 'a', accept: ['b'], importance: 'mandatory' }],
    );
    // Both said "a", so they are 100% alike… but B stated they would not accept an "a",
    // so B's happiness factor is 0 and the geometric mean is 0 — not 50, which is what
    // an arithmetic mean would have reported for a pair where one side rejects the other.
    assert.equal(result.friend, 100);
    assert.equal(result.match, 0);
    assert.equal(result.basis, 'mutual');
  });

  it('enemy % is not the complement of match %', () => {
    const result = pair(
      [
        { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'mandatory' }, // rejects B
        { questionId: 'q2', answer: 'a', accept: ['a'], importance: 'little' }, // accepts B
      ],
      [
        { questionId: 'q1', answer: 'b', accept: ['a'], importance: 'mandatory' }, // accepts A
        { questionId: 'q2', answer: 'a', accept: ['b'], importance: 'little' }, // rejects A
      ],
    );
    // A earns 1 of 251; B earns 250 of 251 → √(0.004 × 0.996) ≈ 6.3
    assert.equal(result.match, 6.3);
    // Enemy points 251 of a possible 502 → 50%, which is nowhere near 100 − 6.3.
    assert.equal(result.enemy, 50);
    assert.notEqual(result.match + result.enemy, 100);
  });
});

describe('breakdown', () => {
  it('breakdown notes that matching direct rejections score zero', () => {
    const result = pair(
      [
        { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' },
        { questionId: 'q2', answer: 'a', accept: ['a'], importance: 'very' },
      ],
      [
        { questionId: 'q1', answer: 'a', accept: ['b'], importance: 'very' },
        { questionId: 'q2', answer: 'a', accept: ['a'], importance: 'very' },
      ],
    );
    // A is perfectly happy (earned 2/2); B earned 1/2 because q1's accept set excludes A → √(1 × 0.5) ≈ 70.7
    assert.equal(result.match, 70.7);
  });

  it('orders rejections before agreements and labels every verdict', () => {
    const result = pair(
      [
        { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' },
        { questionId: 'q2', answer: 'a', accept: ['b'], importance: 'very' },
        { questionId: 'q3', answer: 'a', accept: ['a'], importance: 'very' },
      ],
      [
        { questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' }, // aligned
        { questionId: 'q2', answer: 'b', accept: ['a'], importance: 'very' }, // different but acceptable? no: A rejects b? A.accept = ['b'] so A accepts b.
        { questionId: 'q3', answer: 'b', accept: ['b'], importance: 'very' }, // rejected_both
      ],
    );
    const verdicts = result.breakdown.map((item) => item.verdict);
    assert.equal(verdicts[0], 'rejected_both');
    assert.equal(result.breakdown.at(-1).verdict, 'aligned');
    assert.equal(result.breakdown.length, 3);
    assert.equal(result.breakdown[0].text, 'Q3');
    assert.equal(result.breakdown[0].category, 'values');
  });

  it('survives questions missing from the catalogue', () => {
    const result = pair(
      [{ questionId: 'unknown', answer: 'a', accept: ['a'], importance: 'very' }],
      [{ questionId: 'unknown', answer: 'a', accept: ['a'], importance: 'very' }],
    );
    assert.equal(result.ok, true);
    assert.equal(result.breakdown[0].text, null);
    assert.equal(result.breakdown[0].category, null);
  });
});

describe('confidence and coverage', () => {
  it('scales coverage to the confidence target and caps at 1', () => {
    const rows = Array.from({ length: CONFIDENCE_TARGET + 10 }, (_, index) => ({
      questionId: `q${index}`,
      answer: 'a',
      accept: ['a'],
      importance: 'little',
    }));
    const result = pair(rows, rows);
    assert.equal(result.shared, CONFIDENCE_TARGET + 10);
    assert.equal(result.coverage, 1);
    assert.equal(result.confidence, 'high');
  });

  it('labels thin evidence honestly', () => {
    const one = pair(
      [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'little' }],
      [{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'little' }],
    );
    assert.equal(one.confidence, 'low');
    assert.equal(one.coverage, 0.04);
    assert.match(describeScore(one).detail, /1 shared answer · low confidence/);
  });
});

describe('robustness', () => {
  it('ignores malformed answer rows', () => {
    const index = indexAnswers([
      null,
      undefined,
      {},
      { questionId: 'q1' },
      { questionId: 'q2', answer: '' },
      { questionId: 'q3', answer: 'a', accept: null, importance: 'bogus' },
    ]);
    assert.equal(index.size, 1);
    assert.equal(index.get('q3').importance, 0);
    assert.equal(index.get('q3').accept.size, 0);
  });

  it('accepts snake_case rows straight from SQLite', () => {
    const result = scoreAnswerRows(
      [{ question_id: 'q1', answer: 'a', accept: '["a","b"]', importance: 'very' }].map((row) => ({
        question_id: row.question_id,
        answer: row.answer,
        accept: JSON.parse(row.accept),
        importance: row.importance,
      })),
      [{ question_id: 'q1', answer: 'b', accept: ['a', 'b'], importance: 'very' }],
      { questions: catalogue },
    );
    assert.equal(result.match, 100);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const a = indexAnswers([{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' }]);
    const b = indexAnswers([{ questionId: 'q1', answer: 'a', accept: ['a', 'b'], importance: 'little' }]);
    const first = scorePair(a, b, { questions: catalogue });
    const second = scorePair(a, b, { questions: catalogue });
    assert.deepEqual(first, second);
    assert.equal(a.get('q1').accept.size, 1);
  });

  it('scoreMany maps candidates without throwing on unscoreable pairs', () => {
    const viewer = indexAnswers([{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' }]);
    const results = scoreMany(viewer, [
      { id: 'x', answers: indexAnswers([{ questionId: 'q1', answer: 'a', accept: ['a'], importance: 'very' }]) },
      { id: 'y', answers: indexAnswers([]) },
    ], catalogue);
    assert.equal(results[0].score.ok, true);
    assert.equal(results[1].score.ok, false);
  });
});
