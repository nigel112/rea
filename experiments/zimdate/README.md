# ZimDate

**Serious dating, built for Zimbabwe.** A working, self-contained reimplementation of the
questionnaire-driven dating category — the product OkCupid pioneered — rebuilt from a
reverse-engineering study of how its matching actually works.

ZimDate is not a UI mock. It is a real server, a real database, a real matching kernel with 99
tests and 62 browser-level checks behind it. Start it with one command and you get a populated
Zimbabwe dating site: 500 seeded profiles, 60 questions, live match percentages, likes, mutual
matches, chat, moderation and paid tiers.

```bash
cd experiments/zimdate
npm start          # http://localhost:3000
```

Then sign in with the demo account:

| Role  | Email                 | Password            |
| ----- | --------------------- | ------------------- |
| Demo  | `demo@zimdate.test`   | `ZimDate2026!`      |
| Admin | `admin@zimdate.test`  | `ZimDateAdmin2026!` |

Zero runtime dependencies. Node 22.18+ (uses the built-in `node:sqlite`, `node:test` and native
type-stripping). The only optional install is `jsdom`, used by the two browser-level check scripts.

---

## Why this exists

The brief was to reverse-engineer OkCupid and build it. [`REVERSE_ENGINEERING.md`](./REVERSE_ENGINEERING.md)
is that study: twelve sections separating what is **observed** in public sources, what is
**derived** from them, what is **inferred**, and what is genuinely **unknown** — with the evidence
behind each. The most interesting finding is that OkCupid's famous match percentage is not a
black box. It is:

```
Match %  = geometric mean of the two directional scores   √(A→B × B→A)
Friend % = raw agreement, importance ignored
Enemy %  = rejected weight ÷ total weight available
```

where each directional score is a weight ratio over the importance tiers
**Irrelevant 0 · A Little 1 · Somewhat 10 · Very 50 · Mandatory 250**.

That formula is implemented exactly, in [`server/lib/compat.js`](./server/lib/compat.js), with a
TypeScript mirror kept semantically identical by a parity test. The numbers on screen are computed
from the same code the tests exercise.

## What is actually built

**The questionnaire.** 60 Zimbabwe-framed questions across eight categories. Every answer is
three-part, exactly as OkCupid does it: *your* answer, *which* answers you would accept from a
partner, and *how much it matters*. The editor warns you when you reject your own answer, because
that is the most common way users accidentally score themselves out of good matches.

**The scores.** Match, Friend and Enemy percentages with a real confidence indicator driven by how
many questions two people have both answered. Every score comes with a breakdown: which questions
you agreed on, which you disagreed on, and how much each one moved the number. No number on this
site is unexplained.

**Eligibility in both directions.** A profile is shown to you only if *you* want to see that kind
of person **and** that person's own filters include you. Orientation, age and distance are
symmetric by construction, so nobody appears in a stack they would be filtered out of. This is the
single most common bug in dating apps and it is directly tested
(`test/domain.test.js`, `scripts/selftest.mjs`).

**Discovery.** A ranked stack with a transparent scoring model —
`0.70·match + 0.15·recency + 0.10·completeness + 0.05·shared interests + 0.02·newcomer` — plus a grid
view with filters, an inbound-likes lane so people who already liked you are never buried, and
undo for passes. The match term is scaled by *how many answers back it*: an 86.6% from five shared
answers should never outrank a 64.4% from thirty-six, and it used to.

**The rest of the product.** Profiles with photo galleries and prompt answers, mutual likes that
create matches automatically, real-time chat with message limits and idempotent sends, blocks and
reports, a notification centre, free/Plus/Gold tiers, coins, boosts, profile-view tracking, and a
Trust & Safety admin console with a report queue and an audit log.

**Boring but non-negotiable.** Scrypt password hashing, SHA-256-hashed session tokens in
`HttpOnly` cookies, CSRF protection on every write, login lockout, a strict CSP, path-traversal
defence on static files, and parameterised SQL everywhere.

## Verify it yourself

```bash
npm test           # 99 unit + integration tests (no dependencies)
npm run check      # the above, then 46 self-checks against a live server
npm run test:ui    # 62 browser-level checks (needs: npm i -D jsdom)
```

The suites are deliberately integration-first. They boot a real server on a real SQLite file and
talk to it over real HTTP with real cookies, because the bugs that actually happened here —
an out-of-scope variable in the eligibility predicate, a response field silently dropped, a
match with no message thread — are invisible to unit tests with mocked boundaries.

`scripts/ui-check.mjs` runs the **actual client modules** inside jsdom against that server and
walks all eleven screens: signing in through the form, answering a question, liking a card,
undone passes, sending a message, saving a profile. It also audits every screen for accessibility
(one `h1`, no skipped heading levels, every control named, every image with `alt`).

## Layout

```
server/
  routing.js           the route matcher — pure, and adversarial-input tested
  domain/validation.js signup / answer / filter validation with stable error codes
  lib/compat.js        the matching kernel — pure, dependency-free, heavily tested
  lib/compat.ts        TypeScript mirror, parity-locked to the .js
  db/schema.sql        16 tables, constraints doing real work
  domain/              eligibility · profiles · discovery · social (all business rules)
  seed/                60 questions + a deterministic 500-profile world
  api.js               43 routes, one factory, no framework
  http.js              routing, static files, security headers, error envelopes
  auth.js              scrypt + sessions + CSRF helpers
public/
  js/screens/          eleven screens, one module each, no build step
  styles.css           the whole design system in one file
test/                  99 tests
scripts/
  serve.mjs            entry point (preview mode: allows cross-origin framing)
  selftest.mjs         46 self-checks against a live server
  ui-check.mjs         62 browser-level checks (jsdom)
  screenshots.mjs      renders every screen to artifacts/screens/*.html
```

## API

Raw payloads on success; `{"error": {"code", "message", …}}` on failure. Session cookie
`zimdate_session`; every write also needs `x-zimdate-csrf`.

| Method | Path | What it does |
| ------ | ---- | ------------ |
| GET | `/api/health` | Liveness |
| GET | `/api/meta` | Cities, genders, intents, tiers, route table |
| POST | `/api/auth/signup` | Create an account (18+ enforced) |
| POST | `/api/auth/login` | Sign in, sets the session cookie |
| POST | `/api/auth/logout` | Revoke the session |
| GET | `/api/auth/me` | Current profile, tier, quota, counters |
| GET | `/api/questions` | The question bank |
| GET | `/api/answers` | Your answers |
| POST | `/api/answers` | Save one answer (own + accepted + importance) |
| DELETE | `/api/answers/:questionId` | Remove an answer |
| GET | `/api/stack` | Ranked cards + `inbound[]` lane + exclusion counts |
| GET | `/api/discover` | Filterable grid + total |
| GET | `/api/likes-you` | Who likes you (count always exact; the list is a paid feature) |
| POST | `/api/likes/:userId` | Like someone; auto-creates a match when mutual |
| POST / DELETE | `/api/passes/:userId` | Pass, and undo a pass |
| GET | `/api/matches` | Your matches and threads |
| GET | `/api/matches/:matchId` | One match with both profiles |
| GET / POST | `/api/matches/:matchId/messages` | Read and send messages |
| POST | `/api/matches/:matchId/read` | Mark a thread read |
| POST | `/api/matches/:matchId/unmatch` | Close a match (irreversible) |
| GET | `/api/profile/:userId` | Public profile + score, private answers redacted |
| GET | `/api/score/:userId` | Full compatibility breakdown |
| GET | `/api/photos/:photoId` | Generated SVG photo |
| PATCH | `/api/me` | Edit your profile (protected fields rejected, not ignored) |
| POST | `/api/me/verify` | Verification (idempotent) |
| POST / DELETE | `/api/me/photos` | Add or remove a photo |
| GET | `/api/me/views` | Who viewed you |
| POST / DELETE | `/api/block/:userId` | Block and unblock |
| POST | `/api/report/:userId` | Report someone |
| GET | `/api/notifications` | Notification centre |
| POST | `/api/notifications/read` | Mark read |
| GET / POST | `/api/boost` | Boost status and activation |
| POST | `/api/billing/checkout` | Tier changes (simulated; no card is taken) |
| GET | `/api/admin/stats` | Pool health and platform counts |
| GET / POST | `/api/admin/reports…` | Moderation queue and resolution |
| POST | `/api/admin/users/:userId/ban` | Suspend an account |
| GET | `/api/admin/audit` | The moderation log |

## Design decisions worth defending

**The score is explained, never asserted.** OkCupid shows a percentage and leaves you guessing.
ZimDate shows the percentage *and* the arithmetic: shared answers, disagreements, and the weight
each carried. A match you cannot interrogate is a horoscope.

**Private answers stay private, and silence is explicit.** Mark an answer private and other people
see that you answered it and can see the shared/agreed signal; they never see the answer, the
accepted set, or the explanation. The API returns an empty `accept` array rather than `null` so a
client cannot confuse "redacted" with "no data".

**Errors are codes, not prose.** `403 match_closed` and `400 cannot_like_self` exist so the UI — and
a future client — can react without parsing English.

**Simulated money is labelled as simulated.** Checkout returns `{simulated: true}`, plans say so in
the interface, and the README says it too. A demo that quietly pretends to charge a card is a demo
that will one day accidentally charge one.

## Configuration

| Variable | Default | What it does |
| -------- | ------- | ------------ |
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `ZIMDATE_DB` | `data/zimdate.db` | SQLite file path |
| `ZIMDATE_PROFILES` | `500` | Profiles to seed on first boot |
| `ZIMDATE_AUTOSEED` | enabled | Set `0` to never seed |
| `ZIMDATE_FRAME_ANCESTORS` | `*` in `serve.mjs`, `'self'` in the library | CSP `frame-ancestors`: who may iframe the app |
| `ZIMDATE_DEBUG` | off | Include internal error messages in 500s |

**On framing.** `X-Frame-Options`/`frame-ancestors 'self'` is the right default for a real
deployment, and it is also exactly what stops a hosted preview environment from rendering the app,
because those environments embed you in a cross-origin iframe. So `serve.mjs` — the demo launcher —
opts into `frame-ancestors *` and omits `X-Frame-Options`, while `createZimDateServer()` keeps the
strict default for anyone importing the library. Set `ZIMDATE_FRAME_ANCESTORS='none'` (or a
specific origin list) to lock it down.

## Known limitations

- Photos are generated SVG portraits, not uploads. There is no image upload path and no moderation
  of images.
- Billing is simulated; there is no payment gateway integration.
- Verification grants the flag without a liveness check; the endpoint and UI are honest about it.
- There is no email, push, or SMS delivery. Notifications are in-app only.
- Single-process SQLite. Correct for a demo, not for production scaling.
- The seed world is synthetic. Names, bios, and photos are generated.
- No E2E test in a real browser: Chromium cannot be downloaded in this sandbox, so
  `scripts/ui-check.mjs` uses jsdom against the real server. It exercises the real modules and
  catches everything except paint-level layout bugs.

## Provenance

ZimDate is an independent clean-room implementation built for study. It is **not affiliated with,
endorsed by, or connected to OkCupid or Match Group**. No OkCupid code, assets, copy, or user data
was used. The matching formula was reconstructed from public documentation, user write-ups and
observable behaviour; `REVERSE_ENGINEERING.md` cites each source and states where the evidence
runs out and inference begins.

MIT licensed. Do not use it to run a real dating service without doing the actual work: abuse
prevention, image moderation, payment compliance and the laws of your jurisdiction.
