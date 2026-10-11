#!/usr/bin/env python3
"""
Builds the browser data files for the Tokenization app.

  1. loads the real *.tiktoken vocabularies (identical files tiktoken downloads)
  2. validates our reference BPE against published tiktoken output vectors
  3. emits a compact packed base64 blob per encoding as a classic <script> file
     (classic scripts load over file:// where fetch()/XHR/modules do not)

Usage:  python tools/build_data.py
"""

from __future__ import annotations

import base64
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reference_bpe import Encoding, byte_pair_merge, is_space  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data_src")
OUT = os.path.join(ROOT, "assets", "js", "data")

EOT = "<|endoftext|>"

ENCODINGS = {
    "cl100k_base": {
        "file": "cl100k_base.tiktoken",
        "sha256": "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7",
        "pattern": "cl100k",
        "models": ["gpt-4", "gpt-4-turbo", "gpt-4o", "gpt-3.5-turbo", "text-embedding-3-small",
                   "text-embedding-3-large", "text-embedding-ada-002"],
        "specials": {EOT: 100257, "<|fim_prefix|>": 100258, "<|fim_middle|>": 100259,
                     "<|fim_suffix|>": 100260, "<|endofprompt|>": 100276},
        "explicit_n_vocab": 100277,
    },
    "o200k_base": {
        "file": "o200k_base.tiktoken",
        "sha256": "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d",
        "pattern": "o200k",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-5", "chatgpt-4o-latest"],
        "specials": {EOT: 199999, "<|endofprompt|>": 200018},
        "explicit_n_vocab": 200019,
    },
    "r50k_base": {
        "file": "r50k_base.tiktoken",
        "sha256": "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930",
        "pattern": "r50k",
        "models": ["gpt2", "GPT-3 davinci/curie/babbage/ada", "code-davinci-002", "text-davinci-002"],
        "specials": {EOT: 50256},
        "explicit_n_vocab": 50257,
    },
    "p50k_base": {
        "file": "p50k_base.tiktoken",
        "sha256": "94b5ca7dff4d00767bc256fdd1b27e5b17361d7b8a5f968547f9f23eb70d2069",
        "pattern": "r50k",
        "models": ["text-davinci-003", "text-davinci-002", "code-davinci-002"],
        "specials": {EOT: 50256},
        "explicit_n_vocab": 50257,
    },
}


# ---------------------------------------------------------------- validation
# Token ids published by OpenAI (tiktoken README / core.py docstring), plus
# ids verified by decoding them straight out of the vocabulary file.
GROUND_TRUTH = [
    ("cl100k_base", "hello world", [15339, 1917]),          # tiktoken README
    ("cl100k_base", "Hello, world!", [9906, 11, 1917, 0]),  # 9906='Hello' 11=',' 1917=' world' 0='!'
    ("cl100k_base", " Hello, world!", [22691, 11, 1917, 0]),# 22691=' Hello'
    ("cl100k_base", "tiktoken is great!", [83, 1609, 5963, 374, 2294, 0]),
    ("cl100k_base", "1234567890", None),                    # 3-digit grouping: 3,3,3,1
    ("r50k_base", "hello world", [31373, 995]),              # tiktoken core.py docstring
    ("r50k_base", "Hello, world!", [15496, 11, 995, 0]),
]


def naive_byte_pair_merge(ranks: dict, piece: bytes) -> list[bytes]:
    """Textbook BPE: repeatedly merge the globally lowest-ranked adjacent pair,
    rescanning from scratch. Independent of tiktoken's O(n) linked-array port."""
    parts = [piece[i : i + 1] for i in range(len(piece))]
    while len(parts) > 1:
        best, at = None, -1
        for i in range(len(parts) - 1):
            r = ranks.get(parts[i] + parts[i + 1])
            if r is not None and (best is None or r < best):
                best, at = r, i
        if at < 0:
            break
        parts[at : at + 2] = [parts[at] + parts[at + 1]]
    return parts


def differential_fuzz(enc, vocab: dict, n=400, seed=7):
    """Our ported merge must agree with the naive one on random byte strings."""
    import random

    rng = random.Random(seed)
    alphabets = [
        b"abcdefghijklmnopqrstuvwxyz",
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ",
        b"etaoinshrdlu",
        b"0123456789",
        bytes(range(32, 127)),
        bytes(range(0, 256)),
    ]
    for i in range(n):
        ab = alphabets[i % len(alphabets)]
        ln = rng.randint(1, 24)
        piece = bytes(rng.choice(ab) for _ in range(ln))
        if len(piece) < 2:
            continue
        assert all(piece[i : i + 1] in vocab for i in range(len(piece))), "byte not in vocab"
        a = byte_pair_merge(vocab, piece)
        b = naive_byte_pair_merge(vocab, piece)
        if a != b:
            raise SystemExit(f"merge disagreement on {piece!r}: {a} vs {b}")
    return n


def check_space_table():
    r"""Our _PY_SPACE table must equal what Python's `re` thinks \s is."""
    import re

    rx = re.compile(r"\s")
    bad = [c for c in range(0x11000) if bool(rx.match(chr(c))) != is_space(chr(c))]
    if bad:
        raise SystemExit("whitespace table mismatch at: " + repr([hex(b) for b in bad[:10]]))
    print("  \u2713 \\s table matches Python re across U+0000..U+10FFF")


# -------------------------------------------------------------------- packing
def varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            break
    return bytes(out)


def pack(ranks: dict[bytes, int]) -> str:
    """magic | varint(count) | per token: varint(rankDelta) varint(len) bytes"""
    items = sorted(ranks.items(), key=lambda kv: kv[1])
    buf = bytearray(b"TKB1")
    buf += varint(len(items))
    prev = -1
    for b, r in items:
        buf += varint(r - prev - 1)
        buf += varint(len(b))
        buf += b
        prev = r
    return base64.b64encode(bytes(buf)).decode("ascii")


def load_tiktoken(path: str):
    ranks = {}
    with open(path, "rb") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            tok, rank = line.split()
            ranks[base64.b64decode(tok)] = int(rank)
    return ranks


def main():
    os.makedirs(OUT, exist_ok=True)
    print("Building tokenizer data\u2026\n")

    check_space_table()

    built = {}
    for name, cfg in ENCODINGS.items():
        path = os.path.join(SRC, cfg["file"])
        if not os.path.exists(path):
            print(f"  ! missing {path} \u2014 skipping {name}")
            continue
        raw = open(path, "rb").read()
        got = hashlib.sha256(raw).hexdigest()
        if cfg["sha256"] != got:
            raise SystemExit(
                f"  ! sha256 mismatch for {cfg['file']}:\n    got      {got}\n    expected {cfg['sha256']}"
            )
        print(f"  \u2713 {cfg['file']} sha256 matches OpenAI's published hash")
        ranks = load_tiktoken(path)
        rs = sorted(ranks.values())
        assert rs[0] == 0 and len(set(rs)) == len(rs), f"{name}: bad rank set"
        gaps = sorted(set(range(rs[-1] + 1)) - set(rs))
        if gaps:
            print(f"    note: {name} reserves rank(s) {gaps} for special tokens")

        enc = Encoding(name, ranks, cfg["specials"], cfg["explicit_n_vocab"],
                       pattern=cfg["pattern"])
        built[name] = (ranks, enc)

    print("\nValidating reference BPE against published tiktoken output\u2026")
    ok = True
    for name, text, expect in GROUND_TRUTH:
        enc = built.get(name, (None, None))[1]
        if enc is None:
            continue
        got = enc.encode_ordinary(text)
        note = ""
        if expect is None:  # structural assertion: digits group 3+3+3+1
            expect = [enc.ranks[b] for b in (b"123", b"456", b"789", b"0")]
        good = got == expect
        ok &= good
        print(f"  {'\u2713' if good else '\u2717'} {name:12s} {text!r:24s} -> {got}"
              + (f"   expect {expect}" if not good else ""))
    if not ok:
        raise SystemExit("reference implementation does not match ground truth")

    print("\nDifferential fuzz: tiktoken's merge port vs a naive textbook BPE\u2026")
    for name, (ranks, enc) in built.items():
        n = differential_fuzz(enc, ranks, n=400 if name != "o200k_base" else 250)
        print(f"  \u2713 {name:12s} {n} random byte strings agree exactly")
    print("  \u2713 reference BPE matches every published vector\n")

    print("Packing\u2026")
    meta = {}
    for name, cfg in ENCODINGS.items():
        if name not in built:
            continue
        ranks = built[name][0]
        blob = pack(ranks)
        js = (
            "/* Auto-generated by tools/build_data.py \u2014 do not edit.\n"
            f"   source: {cfg['file']}\n"
            f"   sha256: {cfg['sha256']}\n"
            f"   {len(ranks)} tokens. Packed as base64(varint) of rank-delta + raw bytes. */\n"
            f"window.TOKDATA = window.TOKDATA || {{}};\n"
            f"window.TOKDATA[{name!r}] = {{\n"
            f"  name: {name!r},\n"
            f"  nMergeable: {len(ranks)},\n"
            f"  nVocab: {cfg['explicit_n_vocab']},\n"
            f"  pattern: {cfg['pattern']!r},\n"
            f"  special: {cfg['specials']!r},\n"
            f"  models: {cfg['models']!r},\n"
            f"  b64: {blob!r}\n"
            f"}};\n"
        )
        p = os.path.join(OUT, f"{name}.js")
        open(p, "w", encoding="utf-8").write(js)
        size = len(js.encode())
        meta[name] = size
        print(f"  \u2192 {os.path.relpath(p, ROOT):38s} {size/1024:8.0f} KB  "
              f"({len(ranks)} tokens)")

    # machine-readable test vectors for the JS test harness
    vectors = []
    names = [n for n in ENCODINGS if built.get(n, (None, None))[1]]
    corpus = [
        "hello world",
        " Hello, world!",
        "tiktoken is great!",
        "The quick brown fox jumps over the lazy dog.",
        "Antidisestablishmentarianism",
        "1234567890",
        "3.14159265358979",
        "  leading and trailing   ",
        "def fibonacci(n):\n    return n if n < 2 else fibonacci(n-1)+fibonacci(n-2)",
        "\u00e9l\u00e8ve caf\u00e9 na\u00efve \u2014 r\u00e9sum\u00e9",
        "\u4f60\u597d\uff0c\u4e16\u754c\uff01\u3053\u3093\u306b\u3061\u306f\u4e16\u754c",
        "\U0001f680\U0001f9ea\U0001f4a1",
        "don't won't I'M WE'VE",
        "<|endoftext|> is a special token",
        "a\u00a0b\u2003c\u3000d",
        "x\n\n  \ny",
        "SELECT * FROM users WHERE id = 42;",
        "https://example.com/path?a=1&b=2",
        "function add(a, b) { return a + b; }",
        "na\u00efve caf\u00e9",
        "\u0915\u094d\u0937 \u0915\u0948\u0932\u0947 \u092e\u0947\u0902 \u0915\u0924\u094d\u093e \u091a\u093e\u0939\u0947\u0902",
        "\U0001f1fa\U0001f1f8\U0001f1eb\U0001f1f7 flags \U0001f3f4\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f",
        "NaN  -Infinity  1e-10  0x1F  0b1010  1_000_000",
        "tabs\tand\nnewlines\r\nmixed",
        "\u0000\u0007 control chars \u001b[31m",
        "CamelCaseCase snake_case_case kebab-case-case",
        "\u2764\ufe0f\u2764\ufe0f\u2764\ufe0f",
        "a" * 60,
        "\u00c5\u00c4\u00d6",
        "II III IV V VI VII VIII IX X",
        "supercalifragilisticexpialidocious",
    ]
    for name in names:
        enc = built[name][1]
        for txt in corpus:
            ids = enc.encode(txt)
            vectors.append({"enc": name, "text": txt, "ids": ids})
    os.makedirs(os.path.join(ROOT, "tests"), exist_ok=True)
    with open(os.path.join(ROOT, "tests", "vectors.json"), "w", encoding="utf-8") as f:
        f.write("// Generated by tools/build_data.py from the reference implementation.\n")
        f.write("// The JS engine must reproduce every one of these exactly.\n")
        f.write("window.TEST_VECTORS = ")
        import json

        f.write(json.dumps(vectors, ensure_ascii=False, indent=0).replace("\n", ""))
        f.write(";\n")
    print(f"  \u2192 tests/vectors.json ({len(vectors)} vectors)")
    print("\nDone.")


if __name__ == "__main__":
    main()