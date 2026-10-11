# Token Lab

**An interactive, animated, byte-exact tour of how a Large Language Model reads
your words** — from the characters you type, through UTF-8 bytes, regex
pre-tokenisation and byte-pair encoding, all the way to the token ids a model
actually consumes, and back out through embeddings, attention and sampling.

Open `index.html`. That's it — no build step, no server required.

```
./venv/bin/python serve.py        # optional: http://localhost:8000
```

---

## What makes this accurate

The tokenisation in this app is not an approximation or a mock-up. It is the
real thing:

| Claim | How it is guaranteed |
|---|---|
| The vocabularies are OpenAI's | The four `.tiktoken` files are downloaded from `openaipublic.blob.core.windows.net` and their **SHA-256 digests match the hashes published in `tiktoken`** (`223921b7…`, `446a9538…`, `306cd27f…`, `94b5ca7d…`). Run `./venv/bin/python serve.py` and open `/verify`. |
| The merge algorithm is tiktoken's | `assets/js/core/bpe.js` is a line-for-line port of `_byte_pair_merge` in `tiktoken/src/lib.rs`, including the subtle `i + 3` lookahead that accounts for the not-yet-spliced array slot. |
| The pre-tokenisation is tiktoken's | The three published patterns (`cl100k`, `r50k`, `o200k`) are transcribed from `tiktoken_ext/openai_public.py`, including possessive quantifiers. |
| The output is identical to `tiktoken` | `tests/run.js` reproduces **every** vector produced by an independent Python reference implementation, plus the token ids published in OpenAI's own README and docstrings. |

### The three traps that had to be got right

JavaScript cannot express the published patterns directly. All three of these
produce *plausible but wrong* output if you ignore them:

1. **Possessive quantifiers.** The patterns use `X?+`, `X++`, `X*+`. JavaScript
   has no possessive quantifiers (as of V8 in Node 22 / Chrome <125) and simply
   dropping them changes the answer:

   ```
   "1abc"  with  [^\r\n\p{L}\p{N}]?+\p{L}++   →  "1" + "abc"
            with  [^\r\n\p{L}\p{N}]?\p{L}+     →  "1abc"        ← wrong
   ```

   `pretok.js` emulates them with the standard atomic-group trick
   `X?+ ⇔ (?:(?=(X))\k<X>)?`.

2. **`\s` is not the same set.** JavaScript's `\s` includes U+FEFF; Python's
   `re` `\s` (`Py_UNICODE_ISSPACE`) does not. The class is spelled out
   explicitly instead.

3. **The `i` flag destroys o200k.** Under `i`, ECMAScript case-folds property
   escapes *inside character classes*, so `[\p{Ll}]` also matches uppercase
   letters — silently erasing o200k's entire uppercase/lowercase distinction
   (which is the whole point of its first two rules). The app therefore never
   uses the `i` flag and writes contractions as explicit case classes.

### What is *not* real, and is labelled as such in the UI

OpenAI's model weights are not public, so anything downstream of the token ids
is schematic:

- **Embeddings** (stage 6) are a deterministic function of the token id, so the
  same text always draws the same picture. The *mechanism* — one row per id,
  fixed width, no lookup by meaning — is faithful.
- **Attention** (stage 7) is computed from those synthetic vectors. The causal
  mask, the softmax shape, the attention sink on position 0 and the locality
  bias are all genuine, reproducible properties of real transformers.
- **The generated reply** (stage 8) uses a frequency-shaped stand-in for the
  logits, built from the merge ranks (a lower BPE rank really does mean a more
  frequent token). The softmax, top-p filtering, sampling and detokenisation
  are the real algorithms applied to the real tokenizer. You can also paste a
  genuine API reply into that stage and watch it tokenise for real.

Everything up to and including the token ids is exact.

---

## Verification

```bash
./venv/bin/python tools/build_data.py     # re-pack the vocabularies + self-check
./venv/bin/python tools/make_fuzz.py 20000 # regenerate the differential corpus
node tests/run.js                          # the full JS test suite
```

Latest run:

```
  ✓ 124/124 vectors from the Python reference reproduced exactly
  ✓ 8/8 published tiktoken outputs match
  ✓ 11544/11544 byte strings: tiktoken's merge port == an independent naive BPE
  ✓ 124/124 decode(encode(x)) === x, including characters split across tokens
  ✓ 20000/20000 random strings: JS regex == Python possessive-semantics oracle

All 20256 assertions passed.
```

A jsdom smoke test (`/tmp/opencode/domtest/smoke.js`, not shipped) additionally
boots the real page, walks all eight stages and every panel, switches tokenizers,
lazily loads `o200k_base`, opens the inspector, and drives the merge animation to
its settled final state on a dozen awkward inputs — including `""`, `"   "`,
emoji, CJK, a literal `<|endoftext|>` and 300 repeated characters.

### How the oracle works

`tools/minire.py` is a small backtracking regex engine written purely as a test
oracle. It implements **genuine possessive quantifier semantics**, which neither
Python's `re` nor JavaScript's `RegExp` provides, so the app's atomic-group
emulation can be proved correct against the real patterns rather than assumed.
It found three real bugs during development, including a typo in a hand-typed
copy of the o200k pattern.

`tools/reference_bpe.py` is a pure-Python implementation of the whole pipeline,
and `tools/build_data.py` differentially fuzzes the Rust port against a
textbook naive BPE (`best`/`naiveMerge` in JS) on random byte strings.

### Known, deliberate divergence

V8 ships a newer Unicode version than Python 3.14 (Unicode 17 vs 16). Code
points assigned after Unicode 16 — CJK Extension J, for instance — are letters to
JavaScript and unassigned to Python. `tools/make_fuzz.py` excludes those from the
fuzz corpus and treats them as version skew rather than a bug. Browsers will
classify them as letters.

---

## Layout

```
index.html                 the app shell
serve.py                   optional static server + /verify endpoint
assets/css/app.css         design system, components, responsive rules
assets/js/
  data/*.js                GENERATED — packed vocabularies (1.1 MB for cl100k)
  core/
    pretok.js              the three published patterns + possessiveness emulation
    vocab.js               unpacks the packed merge table, UTF-8 codec
    bpe.js                 tiktoken's merge loop, with a per-merge trace
    tokenizer.js           encode / decode / count / stats
    model-sim.js           embeddings, RoPE, attention, sampling  (schematic)
    content.js             sample texts, glossary, model & price table
  ui/
    anim.js                tween engine, timelines, reduced-motion support
    dom.js                 tiny DOM helpers
    stages.js              the eight animated stages
    panels.js              vocabulary explorer, compare, quiz, models, glossary
  app.js                   state, navigation, lazy loading, the inspector
tools/                     build + verification scripts (dev only)
tests/run.js               the JavaScript test suite
data_src/                  the original .tiktoken files, verbatim
```

### Design notes

- **No build step and no ES modules.** The app works straight off `file://`.
  Vocabularies are classic `<script>` files (a `.js` blob per encoding) rather
  than `fetch()`-ed JSON, because `fetch` is blocked on `file://` origins.
  They are base64-packed from the original format, which cuts cl100k from
  1.68 MB to 1.10 MB.
- **Lazy loading.** Only `cl100k_base` loads on boot; the other three are
  injected when you ask for them, so the initial payload stays small.
- **Cancellation.** Every stage render creates an `Anim.Timeline`. Re-rendering
  cancels it, which resolves every pending `await` immediately — so typing in the
  composer can never leave an orphaned animation running.
- **Reduced motion.** `prefers-reduced-motion` collapses every tween to 0 ms and
  stops the background particles, while all state still sets correctly.
- **Responsive.** The stage rail becomes a horizontal strip under 900 px; the
  composer collapses to a single column under 640 px; safe-area insets are
  respected on notched phones.

## Keyboard

| Key | Action |
|---|---|
| `→` / `←` | next / previous stage |
| `Space` | focus the text box |
| `Esc` | close the inspector, or leave the text box |