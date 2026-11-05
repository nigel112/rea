/**
 * ZimDate compatibility kernel — pure, dependency-free, I/O-free.
 *
 * Three scores share one scan of the questions both people answered:
 *   match%  — do we make each other happy? (weighted by what each person demands)
 *   friend% — do we think alike?          (raw agreement, importance ignored)
 *   enemy%  — how much do we reject each other? (weighted disagreements)
 *
 * See ../../REVERSE_ENGINEERING.md §4 for the derivation and the evidence trail.
 *
 * Invariants this module guarantees:
 *   - deterministic: same inputs, same output, always
 *   - no clock, no randomness, no environment reads
 *   - `ok: false` with a reason instead of lying with a 0%
 *   - never throws on user-shaped input; callers validate first, this validates defensively
 */

/** Importance ladder reconstructed from public OkCupid discussions (§3.1). */
export const IMPORTANCE = Object.freeze({
  irrelevant: 0,
  little: 1,
  somewhat: 10,
  very: 50,
  mandatory: 250,
});

export const IMPORTANCE_LEVELS = Object.freeze([
  { key: 'irrelevant', label: 'Irrelevant', points: 0, hint: 'Does not affect your match %' },
  { key: 'little', label: 'A little important', points: 1, hint: 'Barely moves the needle' },
  { key: 'somewhat', label: 'Somewhat important', points: 10, hint: 'Worth ten small dealbreakers' },
  { key: 'very', label: 'Very important', points: 50, hint: 'A strong preference' },
  { key: 'mandatory', label: 'Mandatory', points: 250, hint: 'A dealbreaker — worth 50 "somewhat"s' },
]);

/** Shared answers needed before a score is treated as fully trustworthy. */
export const CONFIDENCE_TARGET = 25;

export function importancePoints(level) {
  if (typeof level === 'number') {
    return Number.isFinite(level) && level >= 0 ? level : 0;
  }
  const points = IMPORTANCE[level];
  return typeof points === 'number' ? points : 0;
}

/**
 * Normalise one stored answer row into the shape the kernel needs.
 * Keeps the caller's vocabulary (answer may be an option id or value).
 */
function normaliseAnswer(row) {
  if (!row || typeof row !== 'object') return null;
  const answer = row.answer;
  if (answer === undefined || answer === null || answer === '') return null;
  const accept = Array.isArray(row.accept) ? row.accept.map(String) : [];
  const answerKey = String(answer);
  return {
    questionId: String(row.questionId ?? row.question_id ?? ''),
    answer: answerKey,
    accept: new Set(accept.map(String)),
    importance: importancePoints(row.importance),
    // Only a recognised level may reach the breakdown: display data must not echo junk.
    importanceKey:
      typeof row.importance === 'string' && Object.hasOwn(IMPORTANCE, row.importance)
        ? row.importance
        : null,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    explanation: typeof row.explanation === 'string' ? row.explanation : '',
  };
}

/** Index an answer list by question id. Later rows win; duplicates are a caller bug. */
export function indexAnswers(rows) {
  const index = new Map();
  for (const row of rows ?? []) {
    const normalised = normaliseAnswer(row);
    if (!normalised) continue;
    index.set(normalised.questionId, normalised);
  }
  return index;
}

function geometricMean(values) {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  const product = values.reduce((acc, value) => acc * value, 1);
  // Both inputs are [0,1]; Math.sqrt is exact enough and avoids Math.pow edge cases.
  return Math.sqrt(product);
}

function confidenceFor(shared) {
  if (shared < 5) return 'low';
  if (shared < 15) return 'medium';
  return 'high';
}

/**
 * Score a viewer against a candidate.
 *
 * @param {object} viewer    parsed answers for the viewer (see indexAnswers)
 * @param {object} candidate parsed answers for the candidate
 * @param {object} [options]
 * @param {Map<string, any>} [options.questions] question catalogue, for the breakdown and categor
 * @returns {{ok:true, match:number, friend:number, enemy:number, shared:number,
 *            coverage:number, confidence:string, basis:string, breakdown:object[]}}
 *        | {{ok:false, reason:string, shared:number}}
 */
export function scorePair(viewer, candidate, options = {}) {
  const questions = options.questions instanceof Map ? options.questions : null;
  const shared = [];
  for (const [questionId, mine] of viewer) {
    const theirs = candidate.get(questionId);
    if (!theirs) continue;
    shared.push({ questionId, mine, theirs });
  }

  if (shared.length === 0) {
    return { ok: false, reason: 'no_overlap', shared: 0 };
  }

  let myPossible = 0;
  let myEarned = 0;
  let theirPossible = 0;
  let theirEarned = 0;
  let enemyPoints = 0;
  let possiblePoints = 0;
  let agreed = 0;
  const breakdown = [];

  for (const entry of shared) {
    const { questionId, mine, theirs } = entry;
    const iAcceptThem = mine.accept.has(theirs.answer);
    const theyAcceptMe = theirs.accept.has(mine.answer);
    const sameAnswer = mine.answer === theirs.answer;

    myPossible += mine.importance;
    theirPossible += theirs.importance;
    possiblePoints += mine.importance + theirs.importance;

    if (iAcceptThem) myEarned += mine.importance;
    if (theyAcceptMe) theirEarned += theirs.importance;
    if (sameAnswer) agreed += 1;
    if (!iAcceptThem) enemyPoints += mine.importance;
    if (!theyAcceptMe) enemyPoints += theirs.importance;

    const question = questions?.get(questionId) ?? null;
    breakdown.push({
      questionId,
      category: question?.category ?? null,
      text: question?.text ?? null,
      options: question?.options ?? null,
      mine: mine.answer,
      theirs: theirs.answer,
      iAcceptThem,
      theyAcceptMe,
      sameAnswer,
      myImportance: mine.importanceKey ?? mine.importance,
      theirImportance: theirs.importanceKey ?? theirs.importance,
      verdict: sameAnswer && iAcceptThem && theyAcceptMe
        ? 'aligned'
        : !iAcceptThem && !theyAcceptMe
          ? 'rejected_both'
          : !iAcceptThem
            ? 'rejected_by_me'
            : !theyAcceptMe
              ? 'rejected_by_them'
              : 'different_but_acceptable',
    });
  }

  // A side with no scoreable weight carries no information: exclude it rather than
  // reporting a fabricated 0% (a zero denominator means "I called everything irrelevant").
  const sides = [];
  if (myPossible > 0) sides.push(myEarned / myPossible);
  if (theirPossible > 0) sides.push(theirEarned / theirPossible);

  if (sides.length === 0) {
    return { ok: false, reason: 'no_scoreable_weight', shared: shared.length };
  }

  const happiness = geometricMean(sides);
  const match = Math.round(happiness * 1000) / 10; // one decimal, e.g. 87.3
  const friend = Math.round((agreed / shared.length) * 1000) / 10;
  const enemy = possiblePoints > 0 ? Math.round((enemyPoints / possiblePoints) * 1000) / 10 : 0;

  return {
    ok: true,
    match,
    friend,
    enemy,
    shared: shared.length,
    coverage: Math.min(1, shared.length / CONFIDENCE_TARGET),
    confidence: confidenceFor(shared.length),
    basis: sides.length === 2 ? 'mutual' : 'one_sided',
    breakdown: breakdown.sort((left, right) => {
      // Show the decisions that moved the score first; aligned trivia last.
      const rank = { rejected_both: 0, rejected_by_me: 1, rejected_by_them: 2, different_but_acceptable: 3, aligned: 4 };
      return rank[left.verdict] - rank[right.verdict];
    }),
  };
}

/** Convenience wrapper for callers holding rows instead of indexes. */
export function scoreAnswerRows(viewerRows, candidateRows, options = {}) {
  return scorePair(indexAnswers(viewerRows), indexAnswers(candidateRows), options);
}

/**
 * Format a score for display. Kept separate from the number so the UI never has to
 * guess whether `0` means "no overlap" or "genuinely incompatible".
 */
export function describeScore(result) {
  if (!result) return { label: '—', tone: 'neutral', detail: 'No score yet' };
  if (!result.ok) {
    if (result.reason === 'no_overlap') {
      return { label: '—', tone: 'neutral', detail: 'Answer more questions to unlock a match %' };
    }
    return { label: '—', tone: 'neutral', detail: 'Not enough scored answers yet' };
  }
  const label = `${result.match % 1 === 0 ? result.match.toFixed(0) : result.match.toFixed(1)}%`;
  const tone = result.match >= 80 ? 'great' : result.match >= 60 ? 'good' : result.match >= 40 ? 'fair' : 'low';
  const detail = `Based on ${result.shared} shared answer${result.shared === 1 ? '' : 's'} · ${result.confidence} confidence`;
  return { label, tone, detail };
}

/** Aggregate helpers used by discovery ranking. */
export function scoreMany(viewerIndex, candidates, questions) {
  return candidates.map((candidate) => {
    const result = scorePair(viewerIndex, candidate.answers, { questions });
    return { candidate, score: result };
  });
}
