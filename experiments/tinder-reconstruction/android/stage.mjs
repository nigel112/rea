#!/usr/bin/env node
// Stage the web assets for the Android package.
//
// Copies the same files the web preview serves into android/build/www, adds the
// offline runtime, and injects its script tag into index.html. Nothing is
// rewritten except that one tag: the app keeps using absolute /img, /styles.css
// paths because the WebView serves the bundle from https://app.local/.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPERIMENT = join(HERE, "..");
const OUT = join(HERE, "build", "www");

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, "offline", "data"), { recursive: true });
await mkdir(join(OUT, "offline", "evidence"), { recursive: true });

// UI
for (const file of ["styles.css", "app.js", "favicon.svg"]) {
  await cp(join(EXPERIMENT, "app", "public", file), join(OUT, file));
}
await cp(join(EXPERIMENT, "app", "public", "img"), join(OUT, "img"), {
  recursive: true,
});

// Mock core, its data, and the offline runtime
await cp(join(EXPERIMENT, "app", "mock-core.mjs"), join(OUT, "offline", "mock-core.mjs"));
await cp(join(EXPERIMENT, "app", "runtime", "browser-mock.mjs"), join(OUT, "offline", "browser-mock.mjs"));
await cp(join(EXPERIMENT, "app", "data", "profiles.mjs"), join(OUT, "offline", "data", "profiles.mjs"));

// Evidence the inspector renders
for (const file of ["api-contract.json", "rea-extract.json"]) {
  await cp(join(EXPERIMENT, "evidence", file), join(OUT, "offline", "evidence", file));
}

// index.html: swap the preview's plain script tag for the offline bundle
const indexPath = join(EXPERIMENT, "app", "public", "index.html");
const html = await readFile(indexPath, "utf8");
const marker = "<!-- offline-runtime -->";
if (!html.includes(marker)) {
  throw new Error(`index.html is missing the ${marker} marker`);
}
const patched = html.replace(
  marker,
  '<script type="module" src="/offline/browser-mock.mjs"></script>',
);
await writeFile(join(OUT, "index.html"), patched);

// A tiny manifest of what went in, useful in build logs and for verification.
const files = [];
async function walk(dir, prefix = "") {
  const { readdir } = await import("node:fs/promises");
  const { stat } = await import("node:fs/promises");
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) await walk(full, `${prefix}${name}/`);
    else files.push({ path: `${prefix}${name}`, bytes: info.size });
  }
}
await walk(OUT);
await writeFile(
  join(HERE, "build", "www-manifest.json"),
  `${JSON.stringify({ files, total_bytes: files.reduce((sum, file) => sum + file.bytes, 0) }, null, 2)}\n`,
);
console.log(`Staged ${files.length} files into ${OUT}`);
