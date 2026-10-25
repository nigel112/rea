#!/usr/bin/env bash
# Reproduce the REA evidence this reconstruction is built from.
#
# Downloads the public client artifacts, runs the REA workflows used in the
# write-up, and prints the resulting Evidence identifiers. Nothing here talks
# to Tinder: the artifacts are public npm tarballs and a public documentation
# repository.
#
# Requirements: node, npm, git, and a built REA checkout (`npm ci && npm run build:cached`).
#
# Usage: scripts/reproduce.sh [output-directory]
#   Default output: ${TMPDIR:-/tmp}/rea-tinder-reproduction

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPERIMENT="$(dirname "$HERE")"
REA_ROOT="$(cd "$EXPERIMENT/../.." && pwd)"
OUT="${1:-${TMPDIR:-/tmp}/rea-tinder-reproduction}"
REA=(node "$REA_ROOT/scripts/rea.mjs")

log() { printf '\n=== %s\n' "$1"; }

mkdir -p "$OUT"
cd "$OUT"

if [[ ! -f "$REA_ROOT/dist/cli-runtime/cli.js" ]]; then
  echo "REA's compiled runtime is missing. Run: npm ci && npm run build:cached" >&2
  exit 1
fi

log "Fetching public artifacts into $OUT"
if [[ ! -d modern ]]; then
  npm pack tinder-api-ts@0.5.0 --silent >/dev/null
  mkdir -p modern
  tar xzf tinder-api-ts-0.5.0.tgz -C modern --strip-components=1
fi
if [[ ! -d legacy ]]; then
  npm pack tinder@1.19.0 --silent >/dev/null
  mkdir -p legacy
  tar xzf tinder-1.19.0.tgz -C legacy --strip-components=1
fi
if [[ ! -d docs ]]; then
  git clone --depth 1 https://github.com/NastyDevs/tinder-api-documentation.git docs >/dev/null 2>&1
fi

log "Analyzing the modern client (static application graph + semantic graph)"
"${REA[@]}" analyze-javascript-application "$OUT/modern" --json > "$OUT/modern-evidence.json"
node -e '
const fs = require("node:fs");
const application = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const graph = application.normalized_result.semantic_graph;
console.log(JSON.stringify({
  evidence_id: application.evidence_id,
  graph_id: graph.graph_id,
  root_artifact_sha256: application.normalized_result.root_artifact_sha256,
  statistics: application.normalized_result.statistics,
  semantic_nodes: graph.nodes.length,
  semantic_relations: graph.relations.length,
  unknowns: graph.unknowns.length,
}, null, 2));
' "$OUT/modern-evidence.json"

log "Tracing recovered router literals through the semantic graph"
node -e '
const fs = require("node:fs");
const path = require("node:path");
const application = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const literals = ["/v2/profile", "/v2/profile/user", "/v2/recs/core", "/like", "/pass", "/boost", "/v2/meta", "/v2/matches", "/user/matches"];
for (const [index, value] of literals.entries()) {
  fs.writeFileSync(
    path.join(process.argv[2], `semantic-${index}.json`),
    JSON.stringify({ application, query: { seed: { kind: "literal", value }, direction: "forward-influence" } }),
  );
}
fs.writeFileSync(path.join(process.argv[2], "literals.json"), JSON.stringify(literals));
' "$OUT/modern-evidence.json" "$OUT"

for index in $(seq 0 8); do
  "${REA[@]}" trace-javascript-semantics "$OUT/semantic-$index.json" --json > "$OUT/semantic-$index-out.json"
done

node -e '
const fs = require("node:fs");
const literals = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const rows = [];
for (const [index, value] of literals.entries()) {
  const evidence = JSON.parse(fs.readFileSync(`${process.argv[2]}/semantic-${index}-out.json`, "utf8"));
  const result = evidence.normalized_result;
  const slot = result.nodes.find((node) => node.kind === "property-slot");
  rows.push({
    literal: value,
    slot: slot?.properties?.name ?? null,
    status: result.status,
    seeds: result.seed_node_ids.length,
    semantic_graph_id: result.source_graph_id,
    trace_evidence_id: evidence.evidence_id,
  });
}
fs.writeFileSync(`${process.argv[2]}/route-recovery.json`, JSON.stringify(rows, null, 2));
console.table(rows.map(({ literal, slot, status, seeds }) => ({ literal, slot, status, seeds })));
' "$OUT/literals.json" "$OUT"

log "Tracing the recommendation endpoint through the application graph"
node -e '
const fs = require("node:fs");
const application = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
fs.writeFileSync(process.argv[2], JSON.stringify({ application, seed: { kind: "string", value: "match" }, direction: "both" }));
' "$OUT/modern-evidence.json" "$OUT/feature-trace-input.json"
"${REA[@]}" trace-application-feature "$OUT/feature-trace-input.json" --json > "$OUT/feature-trace.json"
node -e '
const evidence = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const result = evidence.normalized_result;
console.log(JSON.stringify({ evidence_id: evidence.evidence_id, status: result.coverage.status, summary: result.summary }, null, 2));
' "$OUT/feature-trace.json"

log "Analyzing the legacy client"
"${REA[@]}" analyze-javascript-application "$OUT/legacy" --json > "$OUT/legacy-evidence.json"

log "Comparing the two client generations"
node -e '
const fs = require("node:fs");
const left = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const right = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
fs.writeFileSync(process.argv[3], JSON.stringify({ left, right }));
' "$OUT/legacy-evidence.json" "$OUT/modern-evidence.json" "$OUT/compare-input.json"
"${REA[@]}" compare-application-versions "$OUT/compare-input.json" --json > "$OUT/compare.json"
node -e '
const evidence = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
console.log(JSON.stringify({ evidence_id: evidence.evidence_id, summary: evidence.normalized_result.summary, matching: evidence.normalized_result.matching, coverage: evidence.normalized_result.coverage }, null, 2));
' "$OUT/compare.json"

log "Extracting the documented route inventory"
node -e '
const fs = require("node:fs");
const YAML = require(process.argv[1] + "/node_modules/yaml");
const document = YAML.parse(fs.readFileSync(process.argv[2], "utf8"));
const paths = [];
for (const [route, item] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (method === "servers" || method === "parameters") continue;
    paths.push({
      method: method.toUpperCase(),
      path: route,
      summary: operation.summary ?? null,
      parameters: [...(item.parameters ?? []), ...(operation.parameters ?? [])]
        .filter((parameter) => parameter.in === "path" || parameter.in === "query")
        .map((parameter) => ({ name: parameter.name, in: parameter.in, required: parameter.required === true })),
    });
  }
}
fs.writeFileSync(process.argv[3], JSON.stringify({ schema: "tinder-openapi-subset/v1", paths }, null, 2));
console.log(`${paths.length} documented operations`);
' "$REA_ROOT" "$OUT/docs/tinder-api-swagger.yaml" "$OUT/openapi-subset.json"

log "Done"
cat <<EOF
Artifacts in $OUT:
  modern-evidence.json     full REA application Evidence (large; do not commit)
  legacy-evidence.json     full REA application Evidence (large; do not commit)
  semantic-*-out.json      semantic traces per recovered route literal
  route-recovery.json      condensed route table used by evidence/rea-extract.json
  feature-trace.json       literal "match" feature trace
  compare.json             legacy -> modern version comparison
  openapi-subset.json      documented operations used by evidence/openapi-subset.json
EOF
