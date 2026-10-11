/* Cross-validates assets/js/core against the Python reference implementation.
 *
 *   node tests/run.js
 *
 * Checks, in order:
 *   1. every vector in tests/vectors.json (produced by tools/build_data.py)
 *   2. tiktoken's published outputs, transcribed from OpenAI's own docs
 *   3. the BPE merge port vs an independently written naive BPE, fuzzed
 *   4. the JS pre-tokeniser vs tools/minire.py, fuzzed over random strings
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
global.window = global;
require(path.join(ROOT, "assets/js/data/cl100k_base.js"));
require(path.join(ROOT, "assets/js/data/o200k_base.js"));
require(path.join(ROOT, "assets/js/data/r50k_base.js"));
require(path.join(ROOT, "assets/js/data/p50k_base.js"));
require(path.join(ROOT, "assets/js/core/pretok.js"));
require(path.join(ROOT, "assets/js/core/vocab.js"));
require(path.join(ROOT, "assets/js/core/bpe.js"));
require(path.join(ROOT, "assets/js/core/tokenizer.js"));

let pass = 0,
  fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (detail ? "  " + detail : ""));
  }
}

const T = global.Tokenizer,
  V = global.Vocab,
  P = global.Pretok,
  B = global.BPE;

function enc(name) {
  return V.get(name);
}

/* --------------------------------------------------------- 1. vectors.json */
function loadVectors() {
  const src = fs.readFileSync(path.join(ROOT, "tests/vectors.json"), "utf8");
  const json = src
    .replace(/^\/\/[^\n]*\n/gm, "")
    .replace(/^window\.TEST_VECTORS\s*=\s*/, "")
    .replace(/;\s*$/, "");
  return JSON.parse(json);
}
const vectors = loadVectors();
let vOk = 0;
for (const v of vectors) {
  const got = T.encode(enc(v.enc), v.text).ids;
  if (JSON.stringify(got) === JSON.stringify(v.ids)) vOk++;
  else
    fail++,
      failures.push(
        `vector ${v.enc} ${JSON.stringify(v.text).slice(0, 40)}\n    want ${JSON.stringify(v.ids)}\n    got  ${JSON.stringify(got)}`
      );
}
pass += vOk;
console.log(`  ${vOk === vectors.length ? "✓" : "✗"} ${vOk}/${vectors.length} vectors from the Python reference reproduced exactly`);

/* ------------------------------------- 2. published OpenAI / tiktoken docs */
const PUBLISHED = [
  ["cl100k_base", "hello world", [15339, 1917]],           // tiktoken README
  ["cl100k_base", "Hello, world!", [9906, 11, 1917, 0]],   // tiktoken README
  ["cl100k_base", " Hello, world!", [22691, 11, 1917, 0]],
  ["cl100k_base", "tiktoken is great!", [83, 1609, 5963, 374, 2294, 0]],
  ["r50k_base", "hello world", [31373, 995]],              // tiktoken core.py docstring
  ["r50k_base", "Hello, world!", [15496, 11, 995, 0]],
  ["o200k_base", "hello world", [24912, 2375]],            // o200k splits it differently
  ["o200k_base", " Hello, world!", [32949, 11, 2375, 0]]
];
for (const [name, text, want] of PUBLISHED) {
  const got = T.encode(enc(name), text).ids;
  check(`published ${name} ${JSON.stringify(text)}`, JSON.stringify(got) === JSON.stringify(want),
    `want ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
}
console.log(`  ${PUBLISHED.every(([n, t, w]) => JSON.stringify(T.encode(enc(n), t).ids) === JSON.stringify(w)) ? "✓" : "✗"} ${PUBLISHED.length} published tiktoken outputs match`);

/* ------------------------------------------------ 3. merge vs naive BPE */
function mulberry(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const alphabets = [
  "abcdefghijklmnopqrstuvwxyz",
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ",
  "etaoinshrdlu",
  "0123456789",
  " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join("")
];
let fuzzOk = 0,
  fuzzN = 0;
for (const name of ["cl100k_base", "r50k_base", "p50k_base", "o200k_base"]) {
  const v = enc(name);
  const rnd = mulberry(1234);
  for (let i = 0; i < 3000; i++) {
    const ab = alphabets[i % alphabets.length];
    const len = 1 + Math.floor(rnd() * 20);
    let piece = "";
    for (let k = 0; k < len; k++) piece += ab[Math.floor(rnd() * ab.length)];
    const lat = latin1(V.utf8Encode(piece));
    if (lat.length < 2) continue;
    for (let b = 0; b < 256; b++) if (v.rank(String.fromCharCode(b)) < 0) { check("byte in vocab", false, `${name} byte ${b}`); break; }
    fuzzN++;
    const a = B.merge(v, lat, false).parts;
    const c = B.naiveMerge(v, lat);
    if (JSON.stringify(a) === JSON.stringify(c)) fuzzOk++;
    else check(`merge fuzz ${name}`, false, `${JSON.stringify(piece)}\n    port  ${JSON.stringify(a)}\n    naive ${JSON.stringify(c)}`);
  }
}
console.log(`  ${fuzzOk === fuzzN ? "✓" : "✗"} ${fuzzOk}/${fuzzN} byte strings: tiktoken's merge port == an independent naive BPE`);

/* ------------------------------------------------- 4. round-trip integrity */
let rtOk = 0,
  rtN = 0;
for (const v of vectors) {
  const voc = enc(v.enc);
  const ids = T.encode(voc, v.text).ids;
  rtN++;
  if (T.decode(voc, ids) === v.text) rtOk++;
  else check(`round trip ${v.enc} ${JSON.stringify(v.text).slice(0, 40)}`, false, `got ${JSON.stringify(T.decode(voc, ids))}`);
}
pass += rtOk;
console.log(`  ${rtOk === rtN ? "✓" : "✗"} ${rtOk}/${rtN} decode(encode(x)) === x, including characters split across tokens`);

/* -------------------------------- 5. JS pre-tokeniser vs tools/minire.py */
const fuzzFile = path.join(__dirname, "pretok_fuzz.json");
if (fs.existsSync(fuzzFile)) {
  const cases = JSON.parse(fs.readFileSync(fuzzFile, "utf8"));
  let pOk = 0;
  for (const c of cases) {
    const got = P.preTokenize(c.text, c.pattern).map((x) => x.text);
    if (JSON.stringify(got) === JSON.stringify(c.want)) pOk++;
    else
      check(`pretok fuzz ${c.pattern}`, false,
        `${JSON.stringify(c.text)}\n    want ${JSON.stringify(c.want)}\n    got  ${JSON.stringify(got)}`);
  }
  pass += pOk;
  console.log(`  ${pOk === cases.length ? "✓" : "✗"} ${pOk}/${cases.length} random strings: JS regex == Python possessive-semantics oracle`);
} else {
  console.log("  … tests/pretok_fuzz.json not generated (run tools/make_fuzz.py)");
}

function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/* ------------------------------------------------------------------ report */
console.log("");
if (fail) {
  console.log(`${fail} FAILURE(S):\n` + failures.map((f) => "  ✗ " + f).join("\n"));
  process.exit(1);
}
console.log(`All ${pass} assertions passed.`);