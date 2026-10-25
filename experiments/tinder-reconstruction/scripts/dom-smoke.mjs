#!/usr/bin/env node
// Headless DOM smoke test for the reconstruction UI.
//
// Loads the real page from a running server, evaluates the real app.js against
// the real mock API, and drives the UI the way a person would: log in, swipe,
// open the inspector, unlock likes, chat, change profile settings, boost.
//
// jsdom is not a repository dependency. Run it from a scratch install:
//
//   cd experiments/tinder-reconstruction
//   node app/server.mjs &                 # serve on :4317
//   npm install --no-save --no-package-lock jsdom@25
//   node scripts/dom-smoke.mjs
//
// This validates behaviour and wiring, not visual rendering: jsdom has no
// layout engine. Any console or jsdom error fails the run.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const appScript = readFileSync(
  join(here, "..", "app", "public", "app.js"),
  "utf8",
);
const base = process.env.REA_SMOKE_BASE_URL ?? "http://localhost:4317";

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) =>
  errors.push(`jsdomError: ${error.message}`),
);
virtualConsole.on("error", (...args) =>
  errors.push(`console.error: ${args.join(" ")}`),
);

const dom = await JSDOM.fromURL(`${base}/`, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const doc = window.document;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Requests go to the same server the page came from, so relative URLs behave
// exactly as they do in a browser.
window.fetch = (input, init) => fetch(new URL(String(input), base), init);

// The app opens a real socket; this stub keeps the DOM tests deterministic and
// exercises the HTTP fallback the client keeps for exactly this case.
window.WebSocket = class {
  static OPEN = 1;
  constructor() {
    this.readyState = 0;
  }
  addEventListener() {}
  close() {}
  send() {}
};

if (typeof window.Element.prototype.scrollTo !== "function")
  window.Element.prototype.scrollTo = function scrollTo() {};
if (typeof window.Element.prototype.scrollIntoView !== "function")
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};

window.eval(appScript);

let failures = 0;
function check(name, condition, detail = "") {
  console.log(
    `${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures += 1;
}

const toastText = () =>
  [...doc.querySelectorAll(".toast")].at(-1)?.textContent ?? "";
const cardName = () =>
  (doc.querySelector(".card-overlay-name h2")?.textContent ?? "").trim();

/** Dispatch a pointer sequence that jsdom's MouseEvent can stand in for. */
function drag(target, from, to, y = 320) {
  const send = (type, x) =>
    target.dispatchEvent(
      new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        buttons: 1,
      }),
    );
  send("pointerdown", from);
  send("pointermove", from + 24);
  send("pointermove", to);
  send("pointerup", to);
}

await wait(300);
check(
  "login screen visible",
  !doc.querySelector("#login").classList.contains("hidden"),
);
check(
  "shell hidden before login",
  doc.querySelector("#shell").classList.contains("hidden"),
);

doc.querySelector("#login-button").click();
await wait(1200);
check(
  "login screen hidden",
  doc.querySelector("#login").classList.contains("hidden"),
);
check(
  "shell visible",
  !doc.querySelector("#shell").classList.contains("hidden"),
);
check("deck rendered", doc.querySelectorAll(".deck .card").length >= 1);
check("card has a name", cardName().length > 0, cardName());
check(
  "boost pill in top bar",
  doc.querySelector("[data-live='boost']") !== null,
);
check(
  "quota line",
  (doc.querySelector(".quota-line")?.textContent ?? "").includes("likes left"),
);

const beforeLike = cardName();
doc.querySelector("[data-action='like']").click();
await wait(1500);
check(
  "like advances the deck",
  beforeLike !== cardName(),
  `${beforeLike} → ${cardName()}`,
);

doc.querySelector("[data-action='inspector']").click();
await wait(500);
check(
  "inspector opens",
  doc.querySelector("#inspector").classList.contains("open"),
);
const routes = doc.querySelectorAll("#inspector-body [data-route-id]");
check(
  "recovered routes listed",
  routes.length === 18,
  `${routes.length} endpoints`,
);
routes[0]?.click();
await wait(250);
check(
  "route detail expands",
  (doc.querySelector("#inspector-body .route-body")?.textContent ?? "").length >
    20,
);
doc.querySelector("#inspector-tabs [data-tab='network']")?.click();
await wait(300);
check(
  "network log records calls",
  doc.querySelectorAll("#inspector-body .call-row").length > 0,
);
doc.querySelector("#inspector-tabs [data-tab='evidence']")?.click();
await wait(400);
const evidenceText = doc.querySelector("#inspector-body")?.textContent ?? "";
check(
  "evidence tiles",
  doc.querySelectorAll("#inspector-body .evidence-tile").length >= 4,
);
check("route recovery rendered", evidenceText.includes("/v2/recs/core"));
check(
  "generation comparison rendered",
  evidenceText.includes("1 entity paired"),
);
check(
  "artifact digest rendered",
  evidenceText.includes(
    "3ed2c4234cc2366b805b47fdcae0115438c5d9efe882d956eed5e10c0bb0c7f4",
  ),
);
doc.querySelector("#inspector-close")?.click();
await wait(250);

// Pointer drag in the discover deck.
const beforeDrag = cardName();
drag(doc.querySelector(".card"), 300, 470);
await wait(1500);
check(
  "pointer drag swipes",
  beforeDrag !== cardName(),
  `${beforeDrag} → ${cardName()}`,
);

// A like can open the match modal, which intentionally suspends keyboard swipes.
doc.querySelector("[data-action='close-modal']")?.click();
await wait(400);

// Keyboard swipe.
const beforeKey = cardName();
doc.dispatchEvent(
  new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
);
await wait(1400);
check(
  "keyboard swipe",
  beforeKey !== cardName(),
  `${beforeKey} → ${cardName()}`,
);
doc.querySelector("[data-action='close-modal']")?.click();
await wait(300);

doc.querySelector("[data-view='likes']").click();
await wait(800);
check(
  "likes heading",
  /like/i.test(doc.querySelector(".section-head h1")?.textContent ?? ""),
);
check("likes grid populated", doc.querySelectorAll(".like-card").length > 0);
check(
  "likes gate visible on free tier",
  doc.querySelector(".likes-gate") !== null,
);
doc.querySelector("[data-action='gold']")?.click();
await wait(900);
check(
  "Gold unlocks the likes grid",
  doc.querySelectorAll(".like-card.locked").length === 0,
);

doc.querySelector("[data-view='messages']").click();
await wait(900);
const rows = doc.querySelectorAll(".match-row");
check("match list populated", rows.length >= 2, `${rows.length} matches`);
const conversation = [...rows].find(
  (row) =>
    !/^Say hello$/.test(
      (row.querySelector(".match-row-last")?.textContent ?? "").trim(),
    ),
);
conversation?.click();
await wait(900);
check("transcript renders", doc.querySelectorAll(".bubble").length > 0);
const input = doc.querySelector(".chat-compose input");
input.value = "Testing the mock from the DOM harness";
input.dispatchEvent(new window.Event("input", { bubbles: true }));
input
  .closest("form")
  .dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
await wait(1200);
check(
  "sent message appears",
  (doc.querySelector(".chat-scroll")?.textContent ?? "").includes(
    "DOM harness",
  ),
);
await wait(4000);
check(
  "simulated reply arrives",
  doc.querySelectorAll(".bubble.them").length >= 2,
);

doc.querySelector("[data-view='profile']").click();
await wait(900);
check(
  "profile page",
  /profile/i.test(doc.querySelector(".section-head h1")?.textContent ?? ""),
);
check("settings rows", doc.querySelectorAll(".setting-row").length >= 7);
check("live stats", doc.querySelectorAll(".stat").length >= 4);

doc.querySelector("[data-action='toggle-bio-filter']").click();
await wait(800);
check(
  "preference filter unlocked by Gold",
  toastText().includes("Preference filter saved"),
  toastText(),
);
doc.querySelector("[data-action='toggle-discoverable']").click();
await wait(800);
check("discoverable toggles", /visible|hidden/.test(toastText()), toastText());
doc.querySelector("[data-action='boost']").click();
await wait(1200);
check(
  "boost applies",
  (doc.querySelector("[data-live='boost']")?.textContent ?? "")
    .toLowerCase()
    .includes("boosted"),
);
check("toast feedback", doc.querySelectorAll(".toast").length > 0);

console.log(`\n${errors.length} console/jsdom errors`);
for (const error of errors.slice(0, 10)) console.log(` - ${error}`);
if (errors.length > 0) failures += errors.length;

console.log(
  failures === 0 ? "\nDOM smoke passed" : `\nDOM smoke failed: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
