/**
 * ZimDate compatibility kernel — typed mirror of `compat.js`.
 *
 * This file exists because the host repository (REA) runs on a pinned Node 24 toolchain with
 * `verbatimModuleSyntax`, `exactOptionalPropertyTypes` and type stripping. ZimDate's runtime stays
 * dependency-free: this module imports nothing, and Node 24 executes it directly (erasable syntax
 * only — no enums, no parameter properties, no namespaces).
 *
 * Semantics are identical to `compat.js`; `test/compat-parity.test.js` asserts they agree.
 */

export type ImportanceKey = 'irrelevant' | 'little' | 'somewhat' | 'very' | 'mandatory';

export type ImportanceDescriptor = Readonly<{
  key: ImportanceKey;
  label: string;
  points: number;
  hint: string;
}>;

export type AnswerLike = Readonly<{
  questionId?: string;
  question_id?: string;
  answer?: string | number | null;
  accept?: readonly (string | number)[] | null;
  importance?: ImportanceKey | number | null;
  visibility?: 'public' | 'private' | string | null;
  explanation?: string | null;
}>;

export type NormalisedAnswer = Readonly<{
  questionId: string;
  answer: string;
  accept: ReadonlySet<string>;
  importance: number;
  importanceKey: ImportanceKey | null;
  visibility: 'public' | 'private';
  explanation: string;
}>;

export type QuestionLike = Readonly<{
  category: string;
  text: string;
  options: readonly string[];
}>;

export type Verdict =
  | 'aligned'
  | 'different_but_acceptable'
  | 'rejected_by_me'
  | 'rejected_by_them'
  | 'rejected_both';

export type BreakdownEntry = Readonly<{
  questionId: string;
  category: string | null;
  text: string | null;
  options: readonly string[] | null;
  mine: string;
  theirs: string;
  iAcceptThem: boolean;
  theyAcceptMe: boolean;
  sameAnswer: boolean;
  myImportance: string | number;
  theirImportance: string | number;
  verdict: Verdict;
}>;

export type ScoredResult = Readonly<{
  ok: true;
  match: number;
  friend: number;
  enemy: number;
  shared: number;
  coverage: number;
  confidence: 'low' | 'medium' | 'high';
  basis: 'mutual' | 'one_sided';
  breakdown: readonly BreakdownEntry[];
}>;

export type UnscoredResult = Readonly<{
  ok: false;
  reason: 'no_overlap' | 'no_scoreable_weight';
  shared: number;
}>;

export type ScoreResult = ScoredResult | UnscoredResult;

export type ScoreDisplay = Readonly<{
  label: string;
  tone: 'neutral' | 'great' | 'good' | 'fair' | 'low';
  detail: string;
}>;

export const IMPORTANCE: Readonly<Record<ImportanceKey, number>> = Object.freeze({
  irrelevant: 0,
  little: 1,
  somewhat: 10,
  very: 50,
  mandatory: 250,
});

export const IMPORTANCE_LEVELS: readonly ImportanceDescriptor[] = Object.freeze([
  { key: 'irrelevant', label: 'Irrelevant', points: 0, hint: 'Does not affect your match %' },
  { key: 'little', label: 'A little important', points: 1, hint: 'Barely moves the needle' },
  { key: 'somewhat', label: 'Somewhat important', points: 10, hint: 'Worth ten small dealbreakers' },
  { key: 'very', label: 'Very important', points: 50, hint: 'A strong preference' },
  { key: 'mandatory', label: 'Mandatory', points: 250, hint: 'A dealbreaker — worth 50 "somewhat"s' },
]);

export const CONFIDENCE_TARGET = 25;

export function importancePoints(level: ImportanceKey | number | string | null | undefined): number {
  if (typeof level === 'number') {
    return Number.isFinite(level) && level >= 0 ? level : 0;
  }
  if (typeof level === 'string' && Object.hasOwn(IMPORTANCE, level)) {
    return IMPORTANCE[level as ImportanceKey];
  }
  return 0;
}

function normaliseAnswer(row: AnswerLike | null | undefined): NormalisedAnswer | null {
  if (!row || typeof row !== 'object') return null;
  const rawAnswer = row.answer;
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === '') return null;
  const acceptValues = Array.isArray(row.accept) ? row.accept.map(String) : [];
  const importanceKey =
    typeof row.importance === 'string' && Object.hasOwn(IMPORTANCE, row.importance)
      ? (row.importance as ImportanceKey)
      : null;
  return {
    questionId: String(row.questionId ?? row.question_id ?? ''),
    answer: String(rawAnswer),
    accept: new Set(acceptValues),
    importance: importancePoints(row.importance ?? null),
    importanceKey,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    explanation: typeof row.explanation === 'string' ? row.explanation : '',
  };
}

export function indexAnswers(rows: readonly AnswerLike[] | null | undefined): Map<string, NormalisedAnswer> {
  const index = new Map<string, NormalisedAnswer>();
  for (const row of rows ?? []) {
    const normalised = normaliseAnswer(row);
    if (!normalised) continue;
    index.set(normalised.questionId, normalised);
  }
  return index;
}

function geometricMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const first = values[0];
  if (first === undefined) return null;
  if (values.length === 1) return first;
  const product = values.reduce((acc, value) => acc * value, 1);
  return Math.sqrt(product);
}

function confidenceFor(shared: number): 'low' | 'medium' | 'high' {
  if (shared < 5) return 'low';
  if (shared < 15) return 'medium';
  return 'high';
}

export type ScoreOptions = Readonly<{
  questions?: Map<string, QuestionLike> | null;
}>;

export function scorePair(
  viewer: ReadonlyMap<string, NormalisedAnswer>,
  candidate: ReadonlyMap<string, NormalisedAnswer>,
  options: ScoreOptions = {},
): ScoreResult {
  const questions = options.questions instanceof Map ? options.questions : null;
  const shared: { questionId: string; mine: NormalisedAnswer; theirs: NormalisedAnswer }[] = [];
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
  const breakdown: BreakdownEntry[] = [];

  for (const { questionId, mine, theirs } of shared) {
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
    let verdict: Verdict;
    if (sameAnswer && iAcceptThem && theyAcceptMe) verdict = 'aligned';
    else if (!iAcceptThem && !theyAcceptMe) verdict = 'rejected_both';
    else if (!iAcceptThem) verdict = 'rejected_by_me';
    else if (!theyAcceptMe) verdict = 'rejected_by_them';
    else verdict = 'different_but_acceptable';

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
      verdict,
    });
  }

  const sides: number[] = [];
  if (myPossible > 0) sides.push(myEarned / myPossible);
  if (theirPossible > 0) sides.push(theirEarned / theirPossible);

  if (sides.length === 0) {
    return { ok: false, reason: 'no_scoreable_weight', shared: shared.length };
  }

  const happiness = geometricMean(sides) ?? 0;
  const match = Math.round(happiness * 1000) / 10;
  const friend = Math.round((agreed / shared.length) * 1000) / 10;
  const enemy = possiblePoints > 0 ? Math.round((enemyPoints / possiblePoints) * 1000) / 10 : 0;

  const rank: Readonly<Record<Verdict, number>> = {
    rejected_both: 0,
    rejected_by_me: 1,
    rejected_by_them: 2,
    different_but_acceptable: 3,
    aligned: 4,
  };
  breakdown.sort((left, right) => rank[left.verdict] - rank[right.verdict]);

  return {
    ok: true,
    match,
    friend,
    enemy,
    shared: shared.length,
    coverage: Math.min(1, shared.length / CONFIDENCE_TARGET),
    confidence: confidenceFor(shared.length),
    basis: sides.length === 2 ? 'mutual' : 'one_sided',
    breakdown,
  };
}

export function scoreAnswerRows(
  viewerRows: readonly AnswerLike[],
  candidateRows: readonly AnswerLike[],
  options: ScoreOptions = {},
): ScoreResult {
  return scorePair(indexAnswers(viewerRows), indexAnswers(candidateRows), options);
}

export function describeScore(result: ScoreResult | null | undefined): ScoreDisplay {
  if (!result) return { label: '—', tone: 'neutral', detail: 'No score yet' };
  if (!result.ok) {
    if (result.reason === 'no_overlap') {
      return { label: '—', tone: 'neutral', detail: 'Answer more questions to unlock a match %' };
    }
    return { label: '—', tone: 'neutral', detail: 'Not enough scored answers yet' };
  }
  const label = `${result.match % 1 === 0 ? result.match.toFixed(0) : result.match.toFixed(1)}%`;
  const tone =
    result.match >= 80 ? 'great' : result.match >= 60 ? 'good' : result.match >= 40 ? 'fair' : 'low';
  const detail = `Based on ${result.shared} shared answer${result.shared === 1 ? '' : 's'} · ${result.confidence} confidence`;
  return { label, tone, detail };
}
