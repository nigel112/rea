# Reverse engineering Tinder with REA — and rebuilding it

This experiment answers a "can I have that feature?" request in the way REA is
built for: inspect a real product without its source, keep the evidence, then
build a working version of what was learned.

It has three parts:

1. **Evidence** — static REA analysis of public Tinder clients and public API
   documentation (`evidence/`).
2. **Reconstruction** — a runnable dating app that implements the recovered
   contract against local, fictional data (`app/`).
3. **Reproduction** — `scripts/reproduce.sh`, which regenerates every Evidence
   identifier quoted below.

> **Not affiliated with Tinder.** No Tinder source code, credentials, account,
> private endpoint, or live traffic is included. Every profile and photo is
> fictional or generated. The app in `app/` never contacts Tinder.

---

## What was actually reverse engineered

The honest scope is the **public client-side contract**:

| Question                                | Answer                                                                                                                                                 | Authority                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Which hosts and routes do clients call? | `api.gotinder.com`, `imageupload.gotinder.com`, `images-ssl.gotinder.com`, 9 recovered route literals                                                  | observed in client code                |
| How is a session authenticated?         | `X-AUTH-TOKEN` header; token read from IndexedDB `keyval-store/keyval` → `persist::mfa` → `authToken`; device id from `localStorage["TinderWeb/uuid"]` | observed in client README + code       |
| What does a swipe send?                 | `POST /like/{id}` (or `/like/{id}/super`) with `s_number`, `liked_content_id`, `liked_content_type`; pass is `GET /pass/{id}?s_number=`                | observed call sites + types            |
| What comes back?                        | `{ match, likes_remaining, status }`, plus `super_likes{remaining, allotment, resets_at…}`; opaque `X-Padding` header                                  | observed response types                |
| How do quotas look?                     | `likes_remaining`, `super_likes.*`, `boost{allotment_remaining, duration, multiplier, expires_at, boost_id}`                                           | observed response types                |
| How do matches and chats work?          | `GET /v2/matches?count&message&is_tinder_u`, `GET /v2/matches/{id}/messages?count`, `POST /user/matches/{id}` `{message}`                              | observed call sites + types            |
| Is there realtime?                      | `GET /ws/generate` then `/ws`; older clients polled `POST /updates`                                                                                    | documented + legacy client             |
| What is premium-gated?                  | preference editing (403 → premium error), likes grid, rewinds, boosts, Super Likes                                                                     | observed error mapping + feature names |
| Which extra routes exist?               | 39 documented operations (SMS login, captcha, onboarding, push devices, media, passport, …)                                                            | public OpenAPI description             |

What is **not** in scope, and stays unknown: recommendation ranking
(`s_number` / `content_hash` inputs), matching weights, moderation and Face
Check internals, pricing and experiment assignment, real rate limits, and any
server implementation detail. Those are labelled `unknown` in the contract and
in the UI.

### Why the analysis is trustworthy (and where it stops)

REA parsed the artifacts as inert text. It never executed client code and never
sent a request. The numbers below come from `npm` tarballs only, so anyone can
re-run them.

| Subject                    | Files | JS parsed | AST nodes | Semantic nodes | Relations | Literals | Unknowns |
| -------------------------- | ----- | --------- | --------- | -------------- | --------- | -------- | -------- |
| `tinder-api-ts@0.5.0`      | 141   | 92        | 57,583    | 14,197         | 11,906    | 1,294    | 3,837    |
| `tinder@1.19.0` (tinderjs) | 2     | 1         | 1,160     | 858            | 936       | 2        | —        |

Graph coverage for both is `unknown`/partial on purpose: a missing relation is a
gap, not proof of absence.

---

## Reproducing the evidence

Prerequisites: Node, npm, git, and a built REA checkout (`npm ci && npm run build:cached`).

```bash
cd experiments/tinder-reconstruction
scripts/reproduce.sh                # writes to ${TMPDIR:-/tmp}/rea-tinder-reproduction
```

The script:

1. downloads `tinder-api-ts@0.5.0` and `tinder@1.19.0` from the npm registry and
   clones `NastyDevs/tinder-api-documentation` (public, MIT-licensed prose;
   only factual path/method/parameter names are extracted);
2. runs `analyze-javascript-application` on both clients;
3. runs `trace-javascript-semantics` on each recovered route literal;
4. runs `trace-application-feature` with the seed `string: "match"`;
5. runs `compare-application-versions` between the two clients;
6. writes condensed tables that `evidence/rea-extract.json` was built from.

Identifiers from the producing run (also stored in `evidence/rea-extract.json`):

```
artifact           sha256  3ed2c4234cc2366b805b47fdcae0115438c5d9efe882d956eed5e10c0bb0c7f4
application        ev_65a02bfdc0f88d82a2ce44cd3293d1ac7e9e2ae245585cae1f0e2e66d5c326c7
semantic graph     jsrg_c7b2a8a5a9b63af3d74c3936e60e275f4583f6b5e6b7923d5be5b7d288d54a05
legacy application ev_cac534837fc6725d55cfc3526f080a93444c0a5186f88e68a0236f340be3e3a5
legacy graph       jsrg_96c959ee719adbd53049fb60dbd0a7e9eb44d2bcb3007ee90f3bf0d5976a9218
comparison         ev_25fbdb7f272dcc4721b7feb674550b05f94598df613caa472dd21a8b976143af
```

`identity_semantics` in the extract records what varies: the artifact digest and
the semantic **graph** id are content-derived and were reproduced byte-identically
across two independent runs; the **Evidence** id embeds the subject name and
local path, so renaming the analyzed directory changes the record id but not the
graph.

---

## Route recovery results

Each row is one semantic trace seeded with the recovered route literal:

| Literal            | Property slot  | Status    | Interpretation                                                                                                                        |
| ------------------ | -------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/v2/profile`      | `profile`      | found     | authenticated profile                                                                                                                 |
| `/v2/profile/user` | `profileUser`  | found     | preference filters                                                                                                                    |
| `/v2/recs/core`    | `search`       | found     | recommendation deck                                                                                                                   |
| `/like`            | `like`         | found     | like + `/super` suffix at the call site                                                                                               |
| `/pass`            | `dislike`      | found     | pass/dislike                                                                                                                          |
| `/boost`           | `boost`        | found     | profile boost                                                                                                                         |
| `/v2/meta`         | `location`     | found     | location / Passport                                                                                                                   |
| `/v2/matches`      | `chatMessages` | ambiguous | two occurrences: the tarball ships both an ESM and a CommonJS build of the same source. Packaging duplication, not runtime ambiguity. |
| `/user/matches`    | `sendMessage`  | found     | send a chat message                                                                                                                   |

Two negative results worth keeping:

- A literal trace for `likes_remaining` finds **nothing**. That name exists only
  as a TypeScript type member; it is not a runtime literal. The absence is a
  representation fact, not evidence the field does not exist — which is why the
  contract cites the type declaration instead.
- `compare-application-versions` between the 2016 wrapper and the 2024 client
  pairs exactly **1** entity (`417 added`, `12 unknown`, `429 unmatched`). These
  are independent packages, not two versions of one app, so no pairing tier
  applies. Running version comparison across unrelated clients is the wrong
  tool; the result is kept as a documented negative.

`trace-application-feature` with the seed `string: "match"` returns
`partial`: 24 seed matches, 422 nodes, 848 edges, 4 terminal paths, 883 observed
and 672 inferred facts.

---

## The reconstruction

A working app that speaks the recovered contract to a local mock. Start it with:

```bash
cd experiments/tinder-reconstruction
node app/server.mjs          # http://localhost:4317
```

No install step: it uses Node's built-in HTTP/WebSocket support and plain ES
modules. `HOST`/`PORT` are overridable; the server binds `0.0.0.0` so it also
works behind a preview proxy.

### Implemented routes

| Route                                                                               | Fidelity              | Behaviour                                                                                                                            |
| ----------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v2/auth/login/guest`                                                         | reconstruction-only   | creates a local session (stands in for SMS/Facebook/protobuf login)                                                                  |
| `GET /v2/meta`                                                                      | observed + documented | globals: quota, boosts, filters, location                                                                                            |
| `POST /v2/meta`                                                                     | observed              | Passport location; enforces the documented 10-minute cooldown → `429`                                                                |
| `GET /v2/recs/core`                                                                 | observed              | recommendation deck, `meta` + `data.results[]`, `429 out_of_likes` at 0                                                              |
| `POST /like/{id}` · `POST /like/{id}/super`                                         | observed              | reciprocal likes create a match; `super_likes` block; `X-Padding` header                                                             |
| `GET /pass/{id}`                                                                    | observed              | records the pass                                                                                                                     |
| `POST /boost`                                                                       | observed              | quota, duration, multiplier, expiry; schedules incoming likes while active                                                           |
| `GET /v2/profile`                                                                   | observed              | viewer, likes quota, boost, super likes, travel, feature access                                                                      |
| `POST /v2/profile`                                                                  | observed              | accepts the client's snake_case `{ user: … }` partial body (the client converts km→miles)                                            |
| `POST /v2/profile/user`                                                             | observed              | `{ preference_filters: … }`; `403 premium_required` on the free tier, matching the client's error mapping                            |
| `GET /v2/matches`                                                                   | observed              | match list with last message + unread count                                                                                          |
| `GET /v2/matches/{id}/messages`                                                     | observed              | transcript; marks read                                                                                                               |
| `POST /user/matches/{id}`                                                           | observed              | send a message; simulated reply arrives over the socket                                                                              |
| `GET /ws/generate` → `/ws`                                                          | documented            | real handshake, real RFC 6455 frames, live match/message/typing/like events                                                          |
| `GET /demo/likes` · `POST /demo/premium` · `POST /demo/rewind` · `POST /demo/reset` | reconstruction-only   | the parts a real client gets from a subscription or a hidden route are namespaced and labelled rather than invented as Tinder routes |
| `GET /demo/contract` · `GET /demo/evidence` · `GET /demo/health`                    | reconstruction-only   | serve the evidence this app was built from                                                                                           |

Error bodies use the client-visible vocabulary (`out_of_likes`,
`no_super_likes`, `no_boosts_available`, `premium_required`,
`location_update_too_frequent`, `unknown_match`, `unauthorized`) and are
labelled as inferred where the analyzed artifacts type only the success path.

### Interface

- **Discover** — swipeable card stack with drag, keyboard (`←` `→` `↑`), photo
  carousel, verified/active/Passport badges, prompts and interests.
- **Likes** — the Gold-gated likes grid, including the blur gate and a
  "simulate Gold" switch. Nothing is charged.
- **Messages** — match list with unread state, transcript, typing indicator,
  simulated replies delivered over the WebSocket, with a single bounded re-read
  if the socket is unavailable.
- **Profile** — live quota fields, Passport location picker with cooldown,
  discoverable toggle, a premium-gated preference filter that really returns
  `403 premium_required` until Gold is simulated, boost, rewind, socket status,
  reset/sign-out.
- **Contract inspector** — a side panel with three live views: the request log of
  everything the UI just called, the recovered route table with per-route REA
  evidence and fidelity badges, and the analysis summary (files, AST nodes,
  semantic graph size, unknowns, route recovery, generation comparison).

### Data

`app/data/profiles.mjs` holds 10 fictional profiles and 2 seeded matches. Field
shapes mirror the observed `User`, `Photo`, `Match` and `Message` models; the
few additions the public types do not expose (job, school, prompts, interests)
are namespaced under `rea` or documented in the contract.

Portraits were generated for this experiment (painterly, obviously
illustrative). The remaining lifestyle images and the open-mic stage (standing
in for a portrait) are hand-authored SVG art, so no real person appears anywhere.

---

## Fidelity statement

| Level               | Meaning                                                | Examples                                                          |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Observed            | Present in analyzed client code or types               | routes, headers, request bodies, response envelopes, quota fields |
| Documented          | Present in the public OpenAPI description only         | SMS login, captcha, onboarding, push devices, media, `/ws`        |
| Inferred            | Composed from call sites and types, not directly typed | error bodies, unread counts, socket event names                   |
| Reconstruction-only | Invented for the demo, clearly namespaced              | guest login, likes grid endpoint, premium toggle, rewind          |
| Unknown             | Not established by any artifact                        | ranking, matching weights, moderation, pricing, real limits       |

---

## Verification performed

- The full pipeline in `scripts/reproduce.sh` ran end-to-end on this machine
  (Node 22, Linux): two analyses, nine semantic traces, one feature trace, one
  comparison, one route extraction.
- The mock server was exercised with real HTTP calls: session creation, deck,
  like→match, transcript, message + simulated reply, rewind, boost, location
  change with deck regeneration, profile, and auth rejection without a token.
- The browser app was driven headlessly through its real DOM (jsdom, with the
  served `app.js` evaluated against the live mock): login, deck advance on like,
  pointer drag, keyboard swipes, Super Like → match modal, deck exhaustion, a
  photo-carousel bar, inspector tabs, route expansion, network log, likes gate
  → Gold → unlocked, match list → chat → send → reply, profile settings, the
  403 preference gate, discoverable toggle, boost, toast. 34 checks, no console
  or jsdom errors. Re-run it with `scripts/dom-smoke.mjs` (see its header for the
  one-line jsdom install).
- **Not verified:** rendering in a real browser engine (no browser binary or
  system libraries were available in this environment), real Tinder behaviour,
  mobile/APK analysis, and any ranking or moderation claim. No live request was
  made to Tinder.

## Limitations and open questions

- **Scope is the client contract, not the service.** Everything above describes
  what public clients send and expect. Ranking inputs, match weighting, abuse
  detection, Face Check, pricing experiments and real rate limits are not
  observable from these artifacts and are marked `unknown` rather than guessed.
- **Missing edges are not absence.** Both semantic graphs report `unknown`
  coverage (timeouts, dynamic dispatch, minified boundaries). A trace that finds
  nothing for `likes_remaining` reflects TypeScript-only typing, not a missing
  field.
- **Error bodies are inferred.** The analyzed clients type success responses and
  map a few status codes; the error envelope here is a reconstruction, labelled
  per endpoint.
- **The socket protocol is documented, not observed.** `/ws/generate` plus a
  `/ws` upgrade comes from the public reference; event names are ours.
- **`/v2/matches` shows a packaging duplication** (ESM + CommonJS copies of one
  source), which is why that trace is `ambiguous` rather than `found`.
- **Two known REA follow-ups, kept honest:** a property seed for `s_number`
  yields an ambiguous result, and there is no first-class `endpoint` seed, so
  endpoints were reached through their route literals instead.
- **Art generation hit a per-turn limit of 10 images**, so three lifestyle
  images and one portrait slot are hand-authored SVG stand-ins. They are
  intentionally stylised, not photo-real.
- **No real browser was available**, so layout was validated structurally
  (DOM + CSS review) rather than by screenshot.

## Files

```
experiments/tinder-reconstruction/
├── README.md                     this document
├── app/
│   ├── server.mjs                mock Tinder API + WebSocket + static host
│   ├── data/profiles.mjs         fictional profiles, matches, locations
│   └── public/                   index.html, styles.css, app.js, img/
├── evidence/
│   ├── api-contract.json         the reconstructed contract (18 routes, 4 models)
│   ├── openapi-subset.json       39 documented operations, path/query params only
│   └── rea-extract.json          condensed REA results and identifiers
└── scripts/
    ├── reproduce.sh              regenerates the Evidence above
    └── dom-smoke.mjs             headless DOM test of the UI against the mock
```

Third-party inputs: `tinder-api-ts` (MIT), `tinder`/tinderjs (MIT), and
`NastyDevs/tinder-api-documentation` (no licence file in the repository; only
factual endpoint, method and parameter names were extracted, not its prose).
