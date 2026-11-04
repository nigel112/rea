/**
 * Request validation.
 *
 * Every rule here is a rule the product actually enforces, so it lives in one place with the error
 * codes next to it rather than being re-derived per handler. The distinction between "throw an
 * HttpError" and "return an errors object" is deliberate: single-field edits report all their
 * problems at once (signup), while single-value submissions fail fast (answering a question).
 */
import { HttpError } from '../http.js';
import { IMPORTANCE_LEVELS } from '../lib/compat.js';
import { QUESTION_INDEX } from '../seed/questions.js';
import { CITIES, GENDERS } from './eligibility.js';
import { ageOn } from '../lib/time.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_AGE = 18;


/**
 * `new Date('2000-02-31')` is not an error in JavaScript — it silently rolls over to March 2, so a
 * naive `isNaN(getTime())` check accepts impossible birthdays and stores a date the user never
 * entered. Round-tripping through ISO catches it: the parsed date must format back to the input.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isRealCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

/**
 * Validate a signup payload.
 *
 * Returns `{ ok, errors, value }` instead of throwing so the client can highlight every bad field
 * at once — a signup form that surfaces one error per round trip is a signup form people abandon.
 *
 * @param {Record<string, unknown>} body
 * @param {string} now ISO timestamp
 */
export function validateSignup(body, now) {
  const errors = {};
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const name = String(body.name ?? '').trim();
  const birthDate = String(body.birthDate ?? '').trim();
  const gender = String(body.gender ?? '');
  const lookingFor = Array.isArray(body.lookingFor) ? body.lookingFor.map(String) : [];
  const city = String(body.city ?? '').trim();

  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'Use at least 8 characters.';
  if (password.length > 200) errors.password = 'That password is too long.';
  if (name.length < 2 || name.length > 60) errors.name = 'Enter your name (2–60 characters).';

  if (!isRealCalendarDate(birthDate)) {
    errors.birthDate = 'Use the format YYYY-MM-DD.';
  } else {
    const age = ageOn(birthDate, now);
    if (age === null || age < MIN_AGE) errors.birthDate = 'You must be 18 or older to use ZimDate.';
    else if (age > 110) errors.birthDate = 'Please check your birth date.';
  }

  if (!GENDERS.includes(gender)) errors.gender = 'Choose how you identify.';
  if (lookingFor.length === 0 || !lookingFor.every((entry) => GENDERS.includes(entry))) {
    errors.lookingFor = 'Tell us who you would like to meet.';
  }
  if (!CITIES[city]) errors.city = 'Choose your city.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { email, password, name, birthDate, gender, lookingFor, city, intent: body.intent },
  };
}

/**
 * Normalise a "looking for" list. Unknown values are dropped rather than rejected: a client that
 * sends `['man', 'goblin']` wants to meet men.
 *
 * @param {unknown} value
 * @returns {string[] | null} `null` when nothing valid survives
 */
export function normaliseLookingFor(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = [...new Set(value.map(String).filter((entry) => GENDERS.includes(entry)))];
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Validate one answer against its question definition.
 *
 * The accepted set is filtered to real options and de-duplicated; an answer the question does not
 * offer is a hard 400, because a stored answer nobody can interpret is worse than a rejection.
 *
 * @param {{options: {id: string}[]}} question
 * @param {Record<string, unknown>} body
 */
export function validateAnswer(question, body) {
  const optionIds = new Set(question.options.map((option) => option.id));
  const answer = String(body.answer ?? '');
  if (!optionIds.has(answer)) {
    throw new HttpError(400, 'invalid_answer', 'Pick one of the options for this question.');
  }
  const acceptInput = Array.isArray(body.accept) ? body.accept.map(String) : null;
  if (!acceptInput) {
    throw new HttpError(400, 'invalid_accept', 'Tell us which answers you would accept.');
  }
  const accept = [...new Set(acceptInput.filter((entry) => optionIds.has(entry)))];
  const importance = String(body.importance ?? 'little');
  if (!IMPORTANCE_LEVELS.some((level) => level.key === importance)) {
    throw new HttpError(400, 'invalid_importance', 'Choose an importance level.');
  }
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  const explanation = String(body.explanation ?? '').slice(0, 1000);
  return { answer, accept, importance, visibility, explanation };
}

/** The question index, re-exported so handlers do not import the seed bank directly. */
export function questionIndexMap() {
  return QUESTION_INDEX;
}
