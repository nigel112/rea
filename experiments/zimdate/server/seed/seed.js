/**
 * Deterministic world generation.
 *
 * Same seed → byte-identical database (modulo photo blobs, which are generated from the same RNG
 * and are therefore stable too). This is what makes "500 profiles" a fixture rather than a
 * campfire story: every screenshot, test and demo run sees the same people, the same answers and
 * the same scores.
 */
import { run, transaction, toJson, all } from '../db/index.js';
import { makeRng, id, sha256 } from '../lib/ids.js';
import { nowIso, addDays, addMs } from '../lib/time.js';
import { QUESTIONS } from './questions.js';
import { CITIES, ANYWHERE_KM, haversineKm } from '../domain/eligibility.js';
import { hashPassword } from '../auth.js';
import {
  FIRST_NAMES_WOMAN,
  FIRST_NAMES_MAN,
  FIRST_NAMES_NONBINARY,
  SURNAMES,
  SUBURBS,
  INTERESTS,
  OCCUPATIONS,
  EDUCATION,
  RELIGIONS,
  LANGUAGES,
  HEIGHTS,
  HEADLINES,
  BIO_TEMPLATES,
  PROMPT_TEXTS,
  ALCOHOL,
  SMOKING,
  CANNABIS,
  KIDS,
  PETS,
  PHOTO_PALETTES,
} from './data.js';

export const DEFAULT_SEED = 20261104;
export const DEMO_EMAIL = 'demo@zimdate.test';
export const DEMO_PASSWORD = 'ZimDate2026!';
export const ADMIN_EMAIL = 'admin@zimdate.test';
export const ADMIN_PASSWORD = 'ZimDateAdmin2026!';

/** One shared password hash for all seeded accounts: scrypt is deliberately slow. */
function sharedSeedHash() {
  return hashPassword('seeded-profile-not-for-login');
}

const GENDERS = ['woman', 'woman', 'woman', 'woman', 'woman', 'man', 'man', 'man', 'man', 'nonbinary'];

function pickCity(rng) {
  // Zimbabwe-weighted: 62% Harare metro, then the other cities, then diaspora.
  const roll = rng.next();
  if (roll < 0.34) return 'Harare';
  if (roll < 0.44) return 'Chitungwiza';
  if (roll < 0.56) return 'Bulawayo';
  if (roll < 0.62) return 'Mutare';
  if (roll < 0.68) return 'Gweru';
  if (roll < 0.72) return 'Masvingo';
  if (roll < 0.76) return 'Kwekwe';
  if (roll < 0.79) return 'Kadoma';
  if (roll < 0.82) return 'Chinhoyi';
  if (roll < 0.85) return 'Marondera';
  if (roll < 0.87) return 'Bindura';
  if (roll < 0.89) return 'Victoria Falls';
  if (roll < 0.90) return 'Hwange';
  if (roll < 0.91) return 'Beitbridge';
  if (roll < 0.95) return 'Johannesburg';
  if (roll < 0.97) return 'Cape Town';
  if (roll < 0.98) return 'London';
  if (roll < 0.99) return 'Dubai';
  if (roll < 0.995) return 'Perth';
  return 'Toronto';
}

function jitter(rng, city) {
  const centre = CITIES[city];
  if (!centre) return { lat: null, lon: null };
  return {
    lat: Number((centre.lat + rng.normal(0, 0.035)).toFixed(5)),
    lon: Number((centre.lon + rng.normal(0, 0.035)).toFixed(5)),
  };
}

function makeName(rng, gender) {
  const pool =
    gender === 'woman' ? FIRST_NAMES_WOMAN : gender === 'man' ? FIRST_NAMES_MAN : FIRST_NAMES_NONBINARY;
  return `${rng.pick(pool)} ${rng.pick(SURNAMES)}`;
}

function emailFor(name, index) {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, '.');
  return `${slug}${index}@seed.zimdate.test`;
}

function birthDateFor(rng, age) {
  const year = new Date().getUTCFullYear() - age;
  const month = rng.int(1, 12);
  const day = rng.int(1, 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lookingForFor(rng, gender) {
  if (gender === 'woman') return rng.chance(0.86) ? ['man'] : ['woman'];
  if (gender === 'man') return rng.chance(0.9) ? ['woman'] : ['man'];
  return rng.chance(0.5) ? ['man', 'woman'] : ['nonbinary', 'woman', 'man'];
}

function ageRangeFor(rng, age) {
  const min = Math.max(18, age - rng.int(3, 12));
  const max = Math.min(99, age + rng.int(3, 15));
  return { min, max };
}

function distanceFor(rng, city) {
  const isDiaspora = CITIES[city]?.country !== 'ZW';
  if (isDiaspora) return rng.pick([ANYWHERE_KM, ANYWHERE_KM, 500]);
  return rng.pick([25, 40, 60, 80, 120, ANYWHERE_KM, ANYWHERE_KM]);
}

/**
 * Generate coherent answers.
 *
 * A purely random answer matrix produces nonsense: people who "strongly want children" and "do not
 * want children" on adjacent questions. Instead every profile gets a latent archetype that biases
 * its choices, so the resulting scores have structure — high matches exist, low matches exist, and
 * they are explicable.
 */
const ARCHETYPES = {
  family_focused: { family: 3, faith: 2, values: 1.5, lifestyle: -0.5, fun: -0.5, love: 0.5, culture: 2, money: 0.5 },
  career_driven: { money: 3, values: 1, lifestyle: 1, family: 0, culture: 0, faith: -0.5, love: -1, fun: 1 },
  creative_free: { fun: 3, culture: 2, lifestyle: 1.5, values: 0, family: -1, faith: -1, money: -1.5, love: 0.5 },
  traditionalist: { culture: 3, faith: 3, family: 2, values: 1, lifestyle: -1, money: 0, love: 0, fun: -1 },
  progressive: { values: 3, lifestyle: 2, love: 1.5, money: 1, culture: -1, faith: -1.5, family: -0.5, fun: 1.5 },
  homebody: { family: 2, lifestyle: -1, fun: -2, faith: 1, culture: 1, love: 1.5, values: 0.5, money: 0 },
  adventurer: { fun: 3, lifestyle: 2.5, culture: 1, money: -1, family: -1, faith: -1, values: 0.5, love: 1 },
};

const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

function chooseArchetype(rng) {
  // Weight so the population is dominated by the mainstream archetypes.
  const roll = rng.next();
  if (roll < 0.2) return 'family_focused';
  if (roll < 0.38) return 'career_driven';
  if (roll < 0.52) return 'creative_free';
  if (roll < 0.66) return 'traditionalist';
  if (roll < 0.8) return 'progressive';
  if (roll < 0.9) return 'homebody';
  return 'adventurer';
}

function generateAnswers(rng, archetype, answeredCount, userId) {
  const weights = ARCHETYPES[archetype];
  const chosen = rng.shuffle(QUESTIONS).slice(0, answeredCount);
  return chosen.map((question) => {
    const bias = weights[question.category] ?? 0;
    // Answer index: archetype-positive categories lean toward the first (usually the committed)
    // option; negative categories lean toward the last (usually the casual) option.
    const optionCount = question.options.length;
    let index;
    if (bias > 0) {
      const lean = Math.min(optionCount - 1, Math.floor(rng.next() * optionCount * (1 - Math.min(0.55, bias * 0.15))));
      index = lean;
    } else if (bias < 0) {
      const lean = Math.max(0, Math.ceil((optionCount - 1) - rng.next() * optionCount * (1 - Math.min(0.5, -bias * 0.14))));
      index = lean;
    } else {
      index = rng.int(0, optionCount - 1);
    }
    const answer = question.options[Math.min(Math.max(index, 0), optionCount - 1)].id;

    // Acceptable answers: usually includes own answer, sometimes a broader set, occasionally a
    // deliberately narrow set (the "you must be exactly like me" user).
    const accept = new Set([answer]);
    if (rng.chance(0.55)) accept.add(question.options[rng.int(0, optionCount - 1)].id);
    if (rng.chance(0.18)) for (const option of question.options) if (rng.chance(0.4)) accept.add(option.id);
    if (accept.size === 1 && rng.chance(0.25)) {
      // Narrow: exclude your own answer entirely (people really do this, and it is why the
      // "you rejected your own answer" warning exists in the answer editor).
      accept.clear();
      accept.add(question.options[(optionCount > 1 ? 1 : 0)].id);
    }

    let importance;
    const roll = rng.next();
    if (roll < 0.08) importance = 'mandatory';
    else if (roll < 0.3) importance = 'very';
    else if (roll < 0.62) importance = 'somewhat';
    else if (roll < 0.85) importance = 'little';
    else importance = 'irrelevant';

    // Correlate importance with the archetype's strong categories.
    if (bias >= 2 && rng.chance(0.45)) importance = rng.chance(0.35) ? 'mandatory' : 'very';

    return {
      userId,
      questionId: question.id,
      answer,
      accept: [...accept],
      importance,
      explanation: rng.chance(0.12) ? rng.pick([
        'This one is non-negotiable for me.',
        'I have learned this the hard way.',
        'Ask me about this on a date.',
        'I changed my mind on this after my twenties.',
      ]) : '',
      visibility: rng.chance(0.15) ? 'private' : 'public',
      createdAt: addDays(nowIso(), -rng.int(1, 300)),
      updatedAt: addDays(nowIso(), -rng.int(0, 1)),
    };
  });
}

/**
 * Generate a placeholder photo as a tiny SVG. Deterministic from the seed and the profile id.
 * Real uploads are accepted too (POST /api/photos), this is only for the demo population.
 */
export function placeholderSvg(name, paletteIndex, initials) {
  const [start, end] = PHOTO_PALETTES[paletteIndex % PHOTO_PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${start}"/>
      <stop offset="100%" stop-color="${end}"/>
    </linearGradient>
    <radialGradient id="v" cx="50%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.25"/>
    </radialGradient>
  </defs>
  <rect width="600" height="800" fill="url(#g)"/>
  <rect width="600" height="800" fill="url(#v)"/>
  <circle cx="300" cy="330" r="120" fill="#ffffff" fill-opacity="0.18"/>
  <text x="300" y="345" text-anchor="middle" font-family="Georgia, serif" font-size="96"
        fill="#ffffff" fill-opacity="0.9">${initials}</text>
  <text x="300" y="700" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="24" fill="#ffffff" fill-opacity="0.75" letter-spacing="6">ZIMDATE</text>
</svg>`;
  return Buffer.from(svg, 'utf8');
}

function initialsOf(name) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/** Build the in-memory world first (fast), then write it in one transaction. */
export function buildWorld(options = {}) {
  const seed = options.seed ?? DEFAULT_SEED;
  const profileCount = options.profiles ?? 500;
  const rng = makeRng(seed);
  const now = options.now ?? nowIso();
  const world = { users: [], answers: [], photos: [], likes: [], passes: [], blocks: [], reports: [] };

  // The demo account is hand-written so the buyer sees a deliberate, well-populated profile.
  const demoAge = 29;
  const demo = {
    id: 'usr_demo',
    email: DEMO_EMAIL,
    name: 'Rudo Chikafu',
    birthDate: birthDateFor(rng, demoAge),
    gender: 'woman',
    lookingFor: ['man'],
    city: 'Harare',
    suburb: 'Avondale',
    archetype: 'family_focused',
    // Filters live on the demo record so the social-graph generator below can apply exactly the
    // same eligibility rules the product does. Duplicating these numbers is how the generator and
    // the product drift apart.
    minAge: 27,
    maxAge: 40,
    maxDistanceKm: 400,
    isDiaspora: false,
  };

  const archetypeCounts = {};
  for (let index = 0; index < profileCount; index += 1) {
    const gender = rng.pick(GENDERS);
    const name = makeName(rng, gender);
    const age = Math.round(Math.min(58, Math.max(19, rng.normal(31, 6.5))));
    const city = pickCity(rng);
    const suburbList = SUBURBS[city] ?? ['Central'];
    const suburb = rng.pick(suburbList);
    const coordinates = jitter(rng, city);
    const archetype = chooseArchetype(rng);
    archetypeCounts[archetype] = (archetypeCounts[archetype] ?? 0) + 1;
    const range = ageRangeFor(rng, age);
    const isDiaspora = CITIES[city]?.country !== 'ZW';

    const interestCount = rng.int(3, 8);
    const interests = rng.shuffle(INTERESTS).slice(0, interestCount);
    const languages = ['English', ...rng.shuffle(LANGUAGES.filter((language) => language !== 'English')).slice(0, rng.int(1, 2))];

    const userId = `usr_${String(index + 1).padStart(4, '0')}`;
    const bio = rng
      .pick(BIO_TEMPLATES)
      .replaceAll('{suburb}', suburb)
      .replaceAll('{city}', city)
      .replaceAll('{occupation}', rng.pick(OCCUPATIONS).toLowerCase())
      .replaceAll('{education}', rng.pick(EDUCATION).toLowerCase())
      .replaceAll('{interest1}', interests[0] ?? 'good conversation')
      .replaceAll('{interest2}', interests[1] ?? 'music');

    const prompts = rng.shuffle(PROMPT_TEXTS).slice(0, rng.int(1, 3)).map((prompt) => ({
      prompt: prompt.prompt,
      answer: prompt.answerSeed,
    }));

    const heightProfile = HEIGHTS[gender] ?? HEIGHTS.nonbinary;
    const height = Math.round(Math.min(200, Math.max(145, rng.normal(heightProfile.mean, heightProfile.sd))));
    const lastActive = addMs(now, -Math.round(Math.abs(rng.normal(0, 1)) * 86_400_000 * (rng.chance(0.25) ? 20 : 2)));
    const createdAt = addDays(now, -rng.int(0, 700));
    const verified = rng.chance(0.38);
    const answeredCount = Math.round(Math.min(60, Math.max(6, rng.normal(31, 14))));

    world.users.push({
      id: userId,
      email: emailFor(name, index + 1),
      name,
      birthDate: birthDateFor(rng, age),
      gender,
      lookingFor: lookingForFor(rng, gender),
      intent: rng.pick(['long-term', 'long-term', 'long-term', 'short-term', 'friends', 'figuring-it-out']),
      headline: rng.pick(HEADLINES),
      bio,
      city,
      suburb,
      lat: coordinates.lat,
      lon: coordinates.lon,
      heightCm: height,
      education: rng.pick(EDUCATION),
      occupation: rng.pick(OCCUPATIONS),
      religion: rng.pick(RELIGIONS),
      languages: [...new Set(languages)],
      drinks: rng.pick(ALCOHOL),
      smokes: rng.pick(SMOKING),
      cannabis: rng.pick(CANNABIS),
      kids: rng.pick(KIDS),
      pets: rng.pick(PETS),
      interests,
      prompts,
      tier: rng.chance(0.12) ? 'plus' : rng.chance(0.04) ? 'gold' : 'free',
      minAge: range.min,
      maxAge: range.max,
      maxDistanceKm: distanceFor(rng, city),
      lastActiveAt: lastActive > now ? now : lastActive,
      createdAt,
      verified,
      seeded: true,
      isDiaspora,
      photoCount: rng.int(1, 5),
    });

    const answers = generateAnswers(rng, archetype, answeredCount, userId);
    world.answers.push(...answers);
  }

  // Demo account gets a complete, curated set of answers: intent long-term, high importance on
  // family/values, so their scores read as "picky but fair".
  const demoAnswers = generateAnswers(rng, demo.archetype, 46, demo.id).map((answer) => {
    // The generator sometimes produces "narrow" people who reject their own answer (it is a real
    // behaviour, and the editor warns about it). The demo profile is the shop window, so its
    // answers always accept themselves: a "85% match with yourself" is a confusing first
    // impression, and it would make the sanity invariant below impossible to state.
    const accept = answer.accept.includes(answer.answer) ? answer.accept : [...answer.accept, answer.answer];
    return { ...answer, accept };
  });
  world.answers.push(...demoAnswers);
  world.users.unshift({
    id: demo.id,
    email: demo.email,
    name: demo.name,
    birthDate: demo.birthDate,
    gender: demo.gender,
    lookingFor: demo.lookingFor,
    intent: 'long-term',
    headline: 'Marketing manager by day, sadza critic by night',
    bio: 'I grew up in Avondale and I am still here, by choice. I run marketing for a small Harare firm, I cook far too much food on Sundays, and I am looking for someone kind, funny and honest. My family is loud and I would not change them. If you send only "hi", I will probably not reply.',
    city: demo.city,
    suburb: demo.suburb,
    lat: CITIES.Harare.lat,
    lon: CITIES.Harare.lon,
    heightCm: 168,
    education: 'Honours',
    occupation: 'Marketing manager',
    religion: 'Christian',
    languages: ['English', 'Shona'],
    drinks: 'Socially',
    smokes: 'Never',
    cannabis: 'Never',
    kids: 'No children',
    pets: 'Dogs',
    interests: ['cooking', 'sadza and relish', 'gospel music', 'road trips', 'reading', 'photography'],
    prompts: [
      { prompt: 'The way to my heart is', answer: 'a proper conversation and a good plate of food' },
      { prompt: 'Green flags I look for', answer: 'kindness to strangers and a decent relationship with their mother' },
      { prompt: 'A weekend well spent looks like', answer: 'market on Saturday, church on Sunday, nap in between' },
    ],
    tier: 'free',
    minAge: 27,
    maxAge: 40,
    maxDistanceKm: 400,
    lastActiveAt: now,
    createdAt: addDays(now, -400),
    // The demo account starts unverified on purpose: the Settings screen's verification flow is
    // part of the product surface and should be reachable on a fresh seed. 38% of the synthetic
    // population is verified, which is what makes verified badges visible while browsing.
    verified: false,
    seeded: false,
    isDiaspora: false,
    photoCount: 4,
  });
  // Top up the demo profile to a believable number of interests/photos in the writer.
  const demoRecord = world.users[0];
  demoRecord.photoCount = 4;

  // Photos for every profile.
  for (const [index, user] of world.users.entries()) {
    for (let position = 0; position < user.photoCount; position += 1) {
      const paletteIndex = (index + position * 3) % PHOTO_PALETTES.length;
      world.photos.push({
        id: `pho_${user.id}_${position}`,
        userId: user.id,
        position,
        mime: 'image/svg+xml',
        bytes: placeholderSvg(user.name, paletteIndex, initialsOf(user.name)),
        createdAt: addDays(now, -Math.abs(rng.normal(0, 90))),
      });
    }
  }

  // A social graph with realistic asymmetry: most likes are inbound to a small set of profiles.
  //
  // Two things matter here that a naive random sampler gets wrong:
  //   1. `looksCompatible` only checks gender/orientation. Age and distance also decide whether a
  //      like could ever have happened, so they are applied too — otherwise the graph fills with
  //      pairs the product itself would never have shown to each other.
  //   2. Reciprocity has to be encouraged explicitly. With ~100 candidates, independent random
  //      likes almost never form a mutual pair, so the demo world would contain no matches between
  //      real profiles at all. Each liker first likes people who already liked them.
  const candidates = world.users.filter((user) => user.id !== demo.id);
  const ageByUser = new Map(candidates.map((user) => [user.id, ageOfBirthDate(user.birthDate, now)]));
  const plausiblyInterested = (liker, target) => {
    if (!looksCompatible(liker, target)) return false;
    const likerAge = ageByUser.get(liker.id);
    const targetAge = ageByUser.get(target.id);
    if (likerAge < target.minAge || likerAge > target.maxAge) return false;
    if (targetAge < liker.minAge || targetAge > liker.maxAge) return false;
    if (liker.isDiaspora !== target.isDiaspora && !liker.isDiaspora && liker.maxDistanceKm < 1000) return false;
    return true;
  };

  const activePool = candidates.filter((user) => addDays(now, -30) < user.lastActiveAt);
  const inbound = new Map(); // user id -> ids who liked them
  for (const liker of activePool) {
    const outbound = rng.int(0, 6);
    const fans = inbound.get(liker.id) ?? [];
    for (let count = 0; count < outbound; count += 1) {
      // Every other like is a reciprocation, which is what makes matches exist at all.
      const reciprocate = fans.length > 0 && rng.chance(0.5);
      const target = reciprocate ? rng.pick(fans) : rng.pick(candidates);
      if (!target || target.id === liker.id) continue;
      if (!plausiblyInterested(liker, target)) continue;
      world.likes.push({ from: liker.id, to: target.id, at: addDays(now, -rng.int(0, 40)) });
      const list = inbound.get(target.id) ?? [];
      list.push(liker);
      inbound.set(target.id, list);
    }
  }

  // Demo account: a guaranteed set of people who liked them, so "who likes you" is not empty,
  // plus a couple of live matches with conversations.
  //
  // These must be *eligible* both ways — orientation, age range and distance — or the product
  // itself would hide them and the demo account's likes would be full of people it can never see.
  const demoCurrentAge = ageOfBirthDate(demo.birthDate, now);
  const demoEligible = (user) => {
    if (user.id === demo.id) return false;
    if (!looksCompatible(user, demo) || !looksCompatible(demo, user)) return false;
    const candidateAge = ageByUser.get(user.id);
    if (candidateAge < demo.minAge || candidateAge > demo.maxAge) return false;
    if (demoCurrentAge < user.minAge || demoCurrentAge > user.maxAge) return false;
    if (user.isDiaspora && user.maxDistanceKm < 1000) return false;
    // Mutual distance: the demo profile's 60 km radius must reach them too.
    if (!user.isDiaspora && demo.maxDistanceKm < 1000) {
      const km = haversineKm(
        { lat: CITIES[demo.city].lat, lon: CITIES[demo.city].lon },
        { lat: user.lat, lon: user.lon },
      );
      if (km > demo.maxDistanceKm) return false;
    }
    return true;
  };
  // Two disjoint sets so the demo account has a realistic mix: some people it already matched
  // (mutual), and some who liked it that it has not responded to yet (the "who likes you" lane).
  const eligiblePool = rng.shuffle(candidates.filter(demoEligible));
  const demoFans = eligiblePool.slice(0, 14);
  const demoLikes = eligiblePool.slice(6, 20); // deliberate overlap of 6 → six inbound-and-matched
  for (const fan of demoFans) {
    world.likes.push({ from: fan.id, to: demo.id, at: addDays(now, -rng.int(0, 20)) });
  }
  for (const target of demoLikes) {
    world.likes.push({ from: demo.id, to: target.id, at: addDays(now, -rng.int(0, 10)) });
  }
  const matched = new Set(demoLikes.map((user) => user.id));
  world.demoPendingFans = demoFans.filter((fan) => !matched.has(fan.id)).map((fan) => fan.id);
  // Mutual likes → matches (the writer dedupes).
  const demoMatches = demoFans.slice(0, 5).filter((fan) => demoLikes.some((target) => target.id === fan.id));
  world.demoMatches = demoMatches.map((fan) => fan.id);

  // Passes give the stack a realistic "seen" history.
  for (const user of rng.shuffle(candidates).slice(0, Math.floor(candidates.length * 0.35))) {
    const target = rng.pick(candidates);
    if (target.id === user.id) continue;
    world.passes.push({ from: user.id, to: target.id, at: addDays(now, -rng.int(0, 60)) });
  }

  // A few blocks and reports so the safety surfaces are not empty in the demo.
  for (const user of rng.shuffle(candidates).slice(0, 12)) {
    const target = rng.pick(candidates);
    if (target.id === user.id) continue;
    world.blocks.push({ from: user.id, to: target.id, at: addDays(now, -rng.int(1, 60)) });
  }
  const reportReasons = ['fake_profile', 'harassment', 'spam', 'inappropriate_photos', 'scam'];
  for (const user of rng.shuffle(candidates).slice(0, 9)) {
    const target = rng.pick(candidates);
    if (target.id === user.id) continue;
    world.reports.push({
      reporter: user.id,
      target: target.id,
      reason: rng.pick(reportReasons),
      details: rng.chance(0.5) ? 'Kept asking for money after two messages.' : '',
      status: rng.pick(['open', 'open', 'reviewing', 'dismissed', 'actioned']),
      at: addDays(now, -rng.int(0, 25)),
    });
  }

  return { world, seed, archetypeCounts, demo, demoMatches };
}

function looksCompatible(a, b) {
  if (a.id === b.id) return false;
  if (!a.lookingFor.includes(b.gender)) return false;
  if (!b.lookingFor.includes(a.gender)) return false;
  return true;
}

function ageOfBirthDate(birthDate, now) {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const current = new Date(now);
  let age = current.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = current.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && current.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/** Write the generated world into an opened+migrated database. */
export function writeWorld(db, generated, options = {}) {
  const { world } = generated;
  const now = options.now ?? nowIso();
  const passwordHash = sharedSeedHash();
  const demoHash = hashPassword(DEMO_PASSWORD);
  const adminHash = hashPassword(ADMIN_PASSWORD);

  transaction(db, () => {
    for (const question of QUESTIONS) {
      run(
        db,
        `INSERT OR REPLACE INTO questions (id, category, text, options, weight_hint, active) VALUES (?, ?, ?, ?, ?, 1)`,
        question.id,
        question.category,
        question.text,
        toJson(question.options),
        question.weightHint,
      );
    }

    for (const user of world.users) {
      const isDemo = user.id === 'usr_demo';
      run(
        db,
        `INSERT INTO users (
           id, email, password_hash, name, birth_date, gender, looking_for, intent, headline, bio,
           city, suburb, lat, lon, height_cm, education, occupation, religion, languages, drinks,
           smokes, cannabis, kids, pets, interests, prompts, photo_ids, tier, coins, boosts_left,
           verified, is_admin, banned, min_age, max_age, max_distance_km, last_active_at,
           created_at, seeded
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        user.id,
        user.email,
        isDemo ? demoHash : passwordHash,
        user.name,
        user.birthDate,
        user.gender,
        toJson(user.lookingFor),
        user.intent,
        user.headline,
        user.bio,
        user.city,
        user.suburb,
        user.lat,
        user.lon,
        user.heightCm,
        user.education,
        user.occupation,
        user.religion,
        toJson(user.languages),
        user.drinks,
        user.smokes,
        user.cannabis,
        user.kids,
        user.pets,
        toJson(user.interests),
        toJson(user.prompts),
        '[]',
        user.tier,
        isDemo ? 120 : 0,
        isDemo ? 2 : 0,
        user.verified ? 1 : 0,
        0,
        0,
        user.minAge,
        user.maxAge,
        user.maxDistanceKm,
        user.lastActiveAt,
        user.createdAt,
        user.seeded ? 1 : 0,
      );
    }

    // The admin account exists for the moderation surface; it is also a normal dating profile
    // (admins are people too), but is not seeded into discovery because `seeded` is 0 elsewhere.
    run(
      db,
      `INSERT INTO users (
         id, email, password_hash, name, birth_date, gender, looking_for, intent, headline, bio,
         city, suburb, verified, is_admin, coins, last_active_at, created_at, seeded
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?, 0)`,
      'usr_admin',
      ADMIN_EMAIL,
      adminHash,
      'ZimDate Trust & Safety',
      '1990-01-15',
      'nonbinary',
      toJson(['woman', 'man', 'nonbinary']),
      'friends',
      'Trust & Safety team account',
      'This account reviews reports. It is not a dating profile.',
      'Harare',
      'CBD',
      now,
      addDays(now, -500),
    );

    for (const photo of world.photos) {
      run(
        db,
        `INSERT INTO photos (id, user_id, position, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        photo.id,
        photo.userId,
        photo.position,
        photo.mime,
        photo.bytes,
        photo.createdAt,
      );
    }

    // Keep photo_ids in sync with the photos table (denormalised for cheap reads).
    const photoIdsByUser = new Map();
    for (const photo of world.photos) {
      const list = photoIdsByUser.get(photo.userId) ?? [];
      list.push(photo.id);
      photoIdsByUser.set(photo.userId, list);
    }
    for (const [userId, ids] of photoIdsByUser) {
      run(db, `UPDATE users SET photo_ids = ? WHERE id = ?`, toJson(ids), userId);
    }

    for (const answer of world.answers) {
      run(
        db,
        `INSERT OR REPLACE INTO answers (user_id, question_id, answer, accept, importance, explanation, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        answer.userId,
        answer.questionId,
        answer.answer,
        toJson(answer.accept),
        answer.importance,
        answer.explanation,
        answer.visibility,
        answer.createdAt,
        answer.updatedAt,
      );
    }

    const seenLikes = new Set();
    for (const like of world.likes) {
      const key = `${like.from}->${like.to}`;
      if (seenLikes.has(key) || like.from === like.to) continue;
      seenLikes.add(key);
      run(
        db,
        `INSERT OR IGNORE INTO likes (from_user, to_user, created_at, seen) VALUES (?, ?, ?, ?)`,
        like.from,
        like.to,
        like.at,
        like.to === 'usr_demo' ? 0 : 1,
      );
    }

    const seenPasses = new Set();
    for (const pass of world.passes) {
      const key = `${pass.from}->${pass.to}`;
      if (seenPasses.has(key) || pass.from === pass.to) continue;
      seenPasses.add(key);
      run(db, `INSERT OR IGNORE INTO passes (from_user, to_user, created_at) VALUES (?, ?, ?)`, pass.from, pass.to, pass.at);
    }

    for (const block of world.blocks) {
      if (block.from === block.to) continue;
      run(db, `INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`, block.from, block.to, block.at);
    }

    for (const report of world.reports) {
      run(
        db,
        `INSERT OR IGNORE INTO reports (id, reporter_id, target_id, reason, details, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id('rep'),
        report.reporter,
        report.target,
        report.reason,
        report.details,
        report.status,
        report.at,
      );
    }

    // Matches from mutual likes.
    const mutual = all(
      db,
      `SELECT l1.from_user AS a, l1.to_user AS b FROM likes l1
        JOIN likes l2 ON l2.from_user = l1.to_user AND l2.to_user = l1.from_user
       WHERE l1.from_user < l1.to_user`,
    );
    for (const pair of mutual) {
      const [first, second] = [pair.a, pair.b].sort();
      run(
        db,
        `INSERT OR IGNORE INTO matches (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)`,
        `match_${first}_${second}`,
        first,
        second,
        addDays(now, -1),
      );
    }
  });

  return { users: world.users.length + 1, answers: world.answers.length, photos: world.photos.length };
}

/** Seed a few conversations on the demo account's matches. */
export function seedDemoConversations(db, now = nowIso()) {
  const rng = makeRng(DEFAULT_SEED + 7);
  const rows = all(
    db,
    `SELECT * FROM matches WHERE (user_a = 'usr_demo' OR user_b = 'usr_demo') AND closed_at IS NULL LIMIT 6`,
  );
  const lines = [
    'Hey Rudo — your profile made me laugh. The sadza critic line is a strong opening.',
    'Thank you! I take my sadza very seriously.',
    'As you should. So where is the best sadza in Harare, in your professional opinion?',
    'KwaMai Tafadzwa in Avondale, no debate. Where do you stand?',
    'I defer entirely to your expertise. Can I take you there on Saturday?',
    'That is the correct answer. Yes.',
    'What are you up to this weekend?',
    'Farm visit with my family on Saturday. Sunday is church and then nothing, gloriously nothing.',
    'That sounds perfect. My mother has been asking when I will bring someone home, so no pressure.',
    'Ha! Mine too. Tell her I am well behaved.',
  ];
  transaction(db, () => {
    let lineIndex = 0;
    for (const [index, match] of rows.entries()) {
      const otherId = match.user_a === 'usr_demo' ? match.user_b : match.user_a;
      const messageCount = index === 0 ? 6 : index === 1 ? 4 : index === 2 ? 2 : 1;
      for (let count = 0; count < messageCount; count += 1) {
        const fromDemo = count % 2 === 1;
        const sender = fromDemo ? 'usr_demo' : otherId;
        const body = lines[lineIndex % lines.length] ?? 'Hello!';
        lineIndex += 1;
        const at = addMs(now, -(messageCount - count) * 3_600_000 - rng.int(0, 900_000));
        run(
          db,
          `INSERT OR IGNORE INTO messages (id, match_id, sender_id, body, client_id, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
          `msg_seed_${index}_${count}`,
          match.id,
          sender,
          body,
          at,
        );
        run(db, `UPDATE matches SET last_message_at = ? WHERE id = ?`, at, match.id);
      }
    }
    // The demo account gets a few unread messages so the nav badge is honest.
    const first = rows[0];
    if (first) {
      const at = addMs(now, -600_000);
      const otherId = first.user_a === 'usr_demo' ? first.user_b : first.user_a;
      run(
        db,
        `INSERT OR IGNORE INTO messages (id, match_id, sender_id, body, client_id, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        'msg_seed_unread',
        first.id,
        otherId,
        'Also — I have never been to Nyanga. Is that a crime?',
        at,
      );
      run(db, `UPDATE matches SET last_message_at = ? WHERE id = ?`, at, first.id);
    }
  });
  return { conversations: rows.length };
}

/** Notification backlog for the demo account, generated from real rows (never invented). */
export function seedNotifications(db, now = nowIso()) {
  const fans = all(
    db,
    `SELECT l.from_user, l.created_at, u.name FROM likes l JOIN users u ON u.id = l.from_user
      WHERE l.to_user = 'usr_demo' ORDER BY l.created_at DESC LIMIT 6`,
  );
  transaction(db, () => {
    for (const fan of fans) {
      run(
        db,
        `INSERT INTO notifications (id, user_id, kind, payload, created_at) VALUES (?, 'usr_demo', 'like', ?, ?)`,
        id('ntf'),
        toJson({ from: fan.from_user, fromName: fan.name }),
        fan.created_at,
      );
    }
  });
  return { notifications: fans.length };
}

export function seedDatabase(db, options = {}) {
  const generated = buildWorld(options);
  const counts = writeWorld(db, generated, options);
  const conversations = seedDemoConversations(db, options.now ?? nowIso());
  const notifications = seedNotifications(db, options.now ?? nowIso());
  return {
    seed: generated.seed,
    archetypes: generated.archetypeCounts,
    ...counts,
    ...conversations,
    ...notifications,
    digest: sha256(JSON.stringify({
      users: counts.users,
      answers: counts.answers,
      photos: counts.photos,
      seed: generated.seed,
    })),
  };
}

export { ageOfBirthDate };
