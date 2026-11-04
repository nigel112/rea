# ZimDate — Reverse-Engineering Dossier

**Target:** OkCupid (web + mobile), as of 2026-11-04
**Method:** public-behavioural reverse engineering (surface enumeration, product copy, published
algorithm descriptions, schema inference). No OkCupid source, database, credential, user account,
private API, or protected system was accessed, bypassed, or copied. No OkCupid artwork, question
text, or code is reproduced here.
**Output:** an original, honest reimplementation named **ZimDate**, shipped in this repository
under `experiments/zimdate/`.

This dossier is the spec. Every claim is labelled:

| Label | Meaning |
| --- | --- |
| `OBSERVED` | Publicly visible behaviour, copy, or documentation. Verifiable by anyone. |
| `DERIVED` | Our reconstruction — a decision about *how to build it*, not a claim about OkCupid internals. |
| `INFERRED` | Convergent public evidence (multiple sources) but not officially documented. |
| `UNKNOWN` | Server-side and not observable. We say so instead of guessing. |

> **Scope note.** The interesting part of a dating product is not its HTML; it is its
> *decision system* — identity, questionnaires, compatibility scoring, discovery economics, and the
> messaging contract that protects the funnel. That is the layer this dossier attacks, and it is
> deliberately the bulk of the document. Pixels are cheap; matching equity is not.

---

## 1. Surface enumeration (`OBSERVED`)

OkCupid's public surface, enumerated from the unauthenticated homepage, marketing copy, and
public help-centre material:

| Surface | What is publicly visible | ZimDate equivalent |
| --- | --- | --- |
| Account | email/password (plus mobile-first OTP in app), age gate at 18+ | same gates, local accounts, age gate enforced server-side |
| Onboarding | name, DOB, gender, orientation, location, intent ("what are you looking for") | same, with Zimbabwe-framed taxonomies |
| Profile | photos (ordered), headline, essays/bio prompts, essentials (height, education, religion, languages, vices), interests | same, with `OBSERVED`-style structure but original copy |
| Question bank | thousands of multiple-choice questions; each has *answer*, *acceptable answers*, *importance*, optional *explanation*, visibility | same mechanics, 60 original items across 8 categories |
| Matching | Match %, Friend %, Enemy % badges on profiles and discovery cards | same three scores, documented formula (§4) |
| Discovery | "DoubleTake"-style one-at-a-time stack, "Discover" grid, filters | stack + grid + filters |
| Likes | like/pass, "who likes you" list, mutual-like → match | same, with free-tier obfuscation |
| Messaging | free messaging by default (post-2017), unmatch, block, report | same |
| Monetisation | two subscription tiers, unlimited likes, see-likes, boosts, read receipts | same shape, local "ZimCoins" |
| Trust & safety | report reasons, block, photo/essay moderation, verification | reports, blocks, moderation queue, flags |
| Notifications | likes, matches, messages, profile views | in-app notification centre |

### 1.1 The structural insight (`DERIVED`)

OkCupid is **not a swipe app with a profile attached**; it is a **questionnaire with a catalogue
attached**. Every downstream surface — discovery ranking, the badge on a card, "who liked you"
monetisation, even the "enemy %" easter egg — is a projection of one shared score. Reimplementing
the pixels without the score produces a photo grid. So the build order is:

```
questionnaire → compatibility kernel → discovery ranking → conversation → monetisation
```

---

## 2. Identity & onboarding contract (`OBSERVED` + `DERIVED`)

### 2.1 Gates (`OBSERVED`)

* 18+ only, enforced before profile creation. Birth date is asked, not inferred.
* Dating products require *mutual* visibility rules: gender + orientation + "looking for" combine
  into an eligibility predicate, not a single "interested in" field.
* One account per person is a policy goal, not a technical fact; the industry uses email/phone
  verification, device signals, and behavioural velocity checks, never a single silver bullet.

### 2.2 Eligibility predicate (`DERIVED`)

```
eligible(viewer, candidate) :=
      candidate.gender   ∈ viewer.lookingFor
   ∧  viewer.gender      ∈ candidate.lookingFor
   ∧  |viewer.age - candidate.age| within viewer.ageRange
   ∧  |viewer.age - candidate.age| within candidate.ageRange
   ∧  candidate.location within viewer.maxDistanceKm      (Haversine)
   ∧  viewer.location   within candidate.maxDistanceKm
   ∧  viewer.id ∉ candidate.blocks ∧ candidate.id ∉ viewer.blocks
   ∧  viewer.id ∉ candidate.passes  (one-way pass is sticky in the viewer's stack)
```

Key properties we preserve:

1. **Symmetry is required for the *range*, asymmetry for the *filter*.** Each side's age/distance
   preference is applied to the other; a candidate who filters you out never appears even if you
   would accept them. Getting this wrong is the classic dating-app bug where "my filters work but
   I'm shown to people outside theirs".
2. **Reciprocity of orientation.** Both directions must be satisfied; a one-directional match is
   shown to neither party.
3. **No mutual-match requirement at discovery time.** OkCupid shows people you have not liked;
   mutual interest is step 2 of their published three-step process, not a precondition of being
   seen.

Age is computed from birth date, not stored as a number — otherwise the age silently drifts stale.
ZimDate computes age on read (`DERIVED`, correctness over micro-optimisation; 500 profiles is
nothing).

---

## 3. The question bank (`OBSERVED` mechanics, original content)

Each answered question is a tuple:

```
answer      : question_option_id            — what I am
accept      : set<question_option_id>       — what I will accept from a partner
importance  : 0 | 1 | 10 | 50 | 250         — irrelevant | a little | somewhat | very | mandatory
explanation : optional text                 — shown next to my answer if visibility allows
visibility  : public | private              — private still scores, never displays
```

### 3.1 Why these weights (`INFERRED`, corroborated)

OkCupid has never published the weights, but a widely-cited reconstruction — repeated in their own
user-facing explanations and independently re-derived by users — is:

| Importance | Points |
| --- | --- |
| Irrelevant | 0 |
| A little important | 1 |
| Somewhat important | 10 |
| Very important | 50 |
| Mandatory | 250 |

The distribution is intentionally **super-linear** (1 → 10 → 50 → 250, a ×10/×5/×5 ladder). That
shape is the whole point: a single "mandatory" carries as much weight as 50 "somewhat" answers, so
a dealbreaker cannot be diluted by volume. ZimDate adopts this ladder as the reference profile and
documents it in the UI so the score is auditable — a user can open the breakdown and see the exact
arithmetic (§9 explains why an auditable score is a *better product* than a mysterious one).

---

## 4. The compatibility kernel (`DERIVED` implementation of `INFERRED` semantics)

Three scores, one shared scan. For viewer `a` and candidate `b`, over the set of questions **both**
answered (`Q` — the intersection is what makes coverage matter):

### 4.1 Match % — "how much do we make each other happy"

```
for each q ∈ Q:
    worthToA(q)   = importance_A(q)                   # maximum points b could earn from a
    earnedByB(q)  = worthToA(q) if b.answer ∈ a.accept   else 0

    worthToB(q)   = importance_B(q)
    earnedByA(q)  = worthToB(q) if a.answer ∈ b.accept   else 0

aHappiness = Σ earnedByB / Σ worthToA        # how happy b makes a
bHappiness = Σ earnedByA / Σ worthToB        # how happy a makes b

match% = 100 * sqrt(aHappiness * bHappiness)     # geometric mean
```

**Why geometric mean and not arithmetic.** The arithmetic mean lets a 100 %/10 % pair read as 55 %
compatible. The geometric mean is the correct aggregate for two *ratios* that must both hold: one
side's indifference cannot be averaged into the other side's enthusiasm. It yields 31.6 % for the
same pair — which is the honest number. Practical consequence: **unbalanced importance is
self-correcting**. If you mark 200 questions mandatory and your partner marks none, their side of
the product is ~1 and your score collapses even if they agreed with everything.

**Zero-denominator rule.** If either side has no scoreable weight in `Q`, agree returns
`no_overlap` and the UI shows *"Answer more questions to see your match"* rather than `0 %`.
Distinguishing 0 % from "undefined" is a product requirement, not a maths nicety: 0 % reads as a
verdict, `no_overlap` reads as an invitation.

### 4.2 Friend % — "do we think alike"

Same weighted machinery with `accept` ignored: `a.answer == b.answer` earns the points, weighted by
`b`'s importance (so a shared answer on a question *I* do not care about but *you* do still counts
for the friendship axis). Reported on the same geometric mean.

Why a second score exists (`OBSERVED` rationale): OkCupid's public explanation is that the friend
axis captures raw agreement, while match captures *fit to preference*. Two people who both answer
"No kids" but each demand "Yes kids" from a partner are 100 % friends and 0 % matches. That
distinction is genuinely useful and cheap to compute — the scan is already in memory.

### 4.3 Enemy % — "how much do we disagree"

Over `Q`: you score an *enemy point* when `b.answer ∉ a.accept` **or** `a.answer ∉ b.accept`;
worth `importance_A + importance_B`. Enemy % = `100 * enemyPoints / totalPossible`. It is the
complement of *agreement under rejection*, not `100 − match`, which is why the three numbers do not
sum to 100 and should not.

### 4.4 Coverage and confidence (`DERIVED`)

`match%` alone is a lie when it rests on 2 questions. ZimDate returns:

```
shared       = |Q|
coverage     = min(1, shared / 25)                 # 25 shared answers ≈ full confidence
confidence   = "low" (<5) | "medium" (<15) | "high" (>=15)
```

and the UI renders a muted "based on N shared answers" under every badge. This is the single most
important honesty feature in the product: users learn to distrust a 97 % built on four questions.

### 4.5 Determinism & cost (`DERIVED`)

The kernel is a pure function `score(a, b, questionSet) → Result`. It has no I/O, no clock, no
randomness, and is exhaustively unit-tested (including `Result` failure paths for missing data).
Discovery ranks `N` candidates; precomputing per-candidate scores is `O(N × |Q|)` with `|Q| ≤ 60` in
the seed — trivially affordable, so we *do not* cache. Caches are where dating products grow stale
badges; a recompute-per-request is the correct trade at this scale, and the cache key problem is
documented as future work if `N` grows.

---

## 5. Discovery (`OBSERVED` surface, `DERIVED` ranking)

Two surfaces, both fed by one scored candidate pool.

**DoubleTake-style stack** — one card at a time, large photo, name/age, badge, one-line teaser of a
shared answer, like/pass. Progress is "likes remaining today".

**Discover grid** — filterable paginated grid (age range, distance, online now, has photo,
"looking for", interests), sorted by score, then by a small tiebreaker.

### 5.1 Ranking function (`DERIVED`)

```
rankKey(candidate) :=
      0.70 * matchPercent/100
    + 0.15 * recencyDecay(exp(−hoursSinceActive / 168))
    + 0.10 * profileCompleteness
    + 0.05 * interestJaccard(you, them)
    + 0.02 * newcomerBoost(created < 72 h ago)
    + 0.15 * (candidate has an active paid boost)
```

The boost term is `0` for almost everyone; it is the monetised placement product. It deliberately
sits at the same weight as recency — enough to matter, never enough to put a stranger above someone
you actually agree with, and it is applied to *other people's* ranking rather than to the match
percentage, which stays a claim about compatibility rather than about spend.

The five weights live in one exported constant (`RANK_WEIGHTS` in `server/domain/discovery.js`)
plus one additive term, so this document and the running code cannot drift without a visible
diff. Match dominates by design: a stale but excellent match still outranks a fresh bad one.

Then:

* **Demotion, not exclusion, of already-seen cards** — seen-but-unacted candidates drop below
  unseen ones for a session, which preserves the "fresh stack" feel without hiding anyone forever.
* **New-user exposure floor**: profiles younger than 72 h get a small boost so they get their first
  likes. This is the fair-launch problem; without it every new user experiences silence and churns.
  `OBSERVED`: every major dating product has some cold-start exposure mechanism; the exact form is
  `UNKNOWN`.
* **Desirability balancing is deliberately absent** (`DERIVED`, and an explicit product stance).
  Real platforms re-rank by incoming-like velocity to equalise the market. That optimises engagement
  at the cost of user agency. ZimDate ranks by *stated compatibility + freshness + completeness*.
  Documented as a divergence, not an oversight.

### 5.2 Undo, rewinds, and honesty

Pass is one-way *in the stack* (sticky for the session) but is not a permanent block; the grid can
surface a passed profile later, and a pass can be undone from the stack. **A like cannot be undone**
— the other person may already have seen it — and the UI says exactly that rather than pretending
otherwise. Hidden state is where dating apps earn their reputation for cruelty.

**The inbound lane.** People who already liked you are surfaced in their own strip above the stack
rather than left buried in a ranked list. OkCupid charges to reveal this list (`OBSERVED`); ZimDate
shows the count to everyone and the people themselves as an actionable lane, because a like you
cannot discover is a like you cannot reciprocate. The strip carries no ranking advantage: it is
ordered by match score like everything else.

---

## 6. Likes, matches, and the free-tier contract (`OBSERVED` shape, `DERIVED` mechanics)

* `like(viewer, target)` is idempotent; a second like is a no-op returning the existing state.
* If `like(target, viewer)` already exists → create a **match** (single row, canonical-ordered pair
  so `(a,b)` and `(b,a)` cannot both exist), unlock messaging, emit two notifications.
* **Who likes you** (`OBSERVED`): the list is real but gated — free users see blurred cards and a
  count; subscribers see the list. ZimDate reproduces the *shape* with an honest twist: the count is
  always exact and the UI states plainly that the list is a premium view. No fake "3 people liked
  you!" — the number is computed from rows, never generated.
* Daily like quota for free accounts (`OBSERVED`: OkCupid has historically limited likes; exact
  numbers are `UNKNOWN` and change). ZimDate uses 25/day, server-enforced, surfaced in the UI
  *before* the wall is hit.

### 6.1 Match lifecycle

`matched → messaging → unmatched | blocked | reported`. Unmatch is one-sided-in-effect
(both lose the conversation) and does not notify the other party — this is a safety property, not
politeness: notifying creates retaliation vectors. Reports are append-only; blocks are enforced in
the eligibility predicate, the message composer, and every list query.

---

## 7. Messaging contract (`OBSERVED` semantics, `DERIVED` implementation)

* Messaging is **free** (the 2017 change). No "who messages first" paywall, no read receipts for
  free users.
* Threads are scoped to a live match. Unmatching removes the thread from both sides.
* Constraints that matter:
  - **Length bounds** (1–2000 chars), **rate limit** (20 messages / 5 min / thread), server-side.
  - **Idempotency**: client sends a `clientId`; duplicate sends return the original message.
  - **Ordering**: server timestamps are authoritative; client clocks are not trusted.
  - **Blocked / unmatched** → `403` with a stable error code, not a generic failure.
* Read state is per-participant (`lastReadAt` on the match row), so unread counts are `O(1)`.

---

## 8. Monetisation model (`OBSERVED` two tiers, `DERIVED` pricing)

Four levers, in the order they actually convert:

1. **Volume** — more likes, unlimited rewinds.
2. **Visibility** — see who liked you (the strongest lever in every dating product; it converts
   because the value is already in the database).
3. **Attention** — boost (30 min of stack priority).
4. **Information** — read receipts, advanced filters.

ZimDate models two tiers (`Plus`, `Gold`) plus consumable boost credits. `OBSERVED` that OkCupid
prices in local currency; ZimDate prices in **USD with ZWG/EcoCash framing** and never in a currency
the user cannot pay with — the localisation is the point of the product.

---

## 9. Safety, trust, and the parts that are `UNKNOWN`

`OBSERVED` OkCupid surfaces: report a profile (with reason taxonomy), block, photo verification,
community guidelines, moderation of photos and essays, and account deletion.

`UNKNOWN` and therefore **not faked** here: their moderation models, fraud scoring, device
fingerprinting, shadow-ban policy, and the full ranking formula. ZimDate implements a *transparent*
subset: a moderation queue with reasons and actions (`approve | flag | remove`), an audit trail per
moderation action, and a `safety_flags` table. It does **not** claim to reproduce OkCupid's trust
system, and the UI says so.

### 9.1 Divergences we chose on purpose

| OkCupid does | ZimDate does | Why |
| --- | --- | --- |
| Score is a black box | Score is auditable, with a per-question breakdown (`/api/score/:id`) | Trust is a feature; opaque numbers breed conspiracy and churn |
| Desirability-weighted discovery | Compatibility + freshness + completeness | Agency over engagement |
| Premium-gated "who liked you" with a hard wall | Same wall, but the *count* is always exact and labelled | No manufactured scarcity |
| Global question bank (~thousands) | 60 curated Zimbabwe-relevant items, extensible | Onboarding completion beats volume |
| $ pricing only | USD + local mobile-money framing | Zimbabwe is the target market |

---

## 10. Data model (`DERIVED`)

```
users(id, email, password_hash, name, birth_date, gender, looking_for[], intent,
      headline, bio, city, lat, lon, photos, height_cm, education, religion,
      languages[], drinks, smokes, cannabis, kids, pets, interests[], prompts,
      tier, coins, boosts_left, likes_used_today, likes_reset_at,
      verified, is_admin, last_active_at, created_at, banned)
questions(id, category, text, type[single|multi], options[], weight_hint, active)
answers(user_id, question_id, answer, accept[], importance, explanation, visibility, updated_at)
likes(from_user, to_user, created_at, seen)            -- PK (from_user, to_user)
passes(from_user, to_user, created_at)                 -- PK (from_user, to_user)
matches(id, user_a, user_b, created_at, last_message_at, a_last_read_at, b_last_read_at, closed_at)
messages(id, match_id, sender_id, body, client_id, created_at, read_at, flagged)
blocks(blocker_id, blocked_id, created_at)
reports(id, reporter_id, target_id, reason, details, status, created_at, resolved_at, action)
notifications(id, user_id, kind, payload, read_at, created_at)
boosts(user_id, activated_at, expires_at)
moderation_log(id, actor_id, target_type, target_id, action, notes, created_at)
```

Integrity rules enforced in SQL, not just code: `CHECK` on importance values, `CHECK` on gender enums,
unique like pairs, canonical match pairs, `FOREIGN KEY` cascades for account deletion.

---

## 11. Reimplementation checklist (what "build it" means here)

| Layer | Deliverable | Proof |
| --- | --- | --- |
| Kernel | `server/lib/compat.js` — pure scoring | `test/compat.test.js` (golden cases, geometric mean, zero-denominator) |
| Kernel (TS) | `server/lib/compat.ts` — typed mirror, zero deps, runs on Node 24 | same tests against both |
| Domain | eligibility, ranking, quotas, lifecycle | `test/domain.test.js` |
| API | 40+ endpoints, cookie sessions, CSRF, rate limits | `test/api.test.js` |
| UI | router-driven SPA, no build step, mobile-first | manual + `--selftest` route sweep |
| Data | 500 seeded Zimbabwean profiles, deterministic RNG | `npm run seed` |
| Audit | reconciliation of seeded scores vs live recompute | `/api/admin/stats` |
| Docs | this dossier + README + API reference | — |

---

## 12. What we explicitly did **not** do

* No access to OkCupid systems, users, data, or private endpoints.
* No scraping, credential use, or automated interaction with their service.
* No copied text, question wording, imagery, or code. All 60 questions, all 500 profiles, all copy
  in ZimDate are original.
* No reproduction of their proprietary ranking, moderation, or fraud systems — those are marked
  `UNKNOWN` above and deliberately left unimplemented.
* No claim that ZimDate is OkCupid, or affiliated with it. It is a clean-room study of a product
  category, which is the whole point of this repository.
