#!/usr/bin/env python3
"""Generates tests/pretok_fuzz.json: random strings + the pre-tokens that
tools/minire.py (real possessive regex semantics) produces for them.

  python tools/make_fuzz.py [count]
"""
from __future__ import annotations

import json
import os
import random
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import minire  # noqa: E402
from reference_bpe import PATTERNS  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 6000

PIECES = [
    "abcdefghijklmnopqrstuvwxyz",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "0123456789",
    " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
    "\t\n\r\v\f ",
    "   　    ",
    "àéîõüßæø",
    "ΑΒΓΔΕΖηθ",
    "абвгдя",
    "日本語漢字",
    "中文测试",
    "한국어테스트",
    "🚀🧪💡🎉",
    "❤️‍🔥",
    "🇺🇸🇫🇷",
    "don't won't I'M WE'VE they're IT'S",
    "hello world The Quick BROWN fox",
    "\x00\x07\x1b[31m",
    "3.14159 1e-10 0x1F 0b1010",
    "  \n\n\t\r\n  ",
    "naïve CAFÉ résumé",
    "ﬀﬁﬂǅǆ",
]


def rand_char(rng):
    r = rng.random()
    if r < 0.82:
        return rng.choice(rng.choice(PIECES))
    if r < 0.92:
        # Pick a code point that Python 3.14 (Unicode 16.0) already knows.
        # V8 ships a newer Unicode version, so code points assigned after
        # Unicode 16 (e.g. CJK Extension J) are a *version skew*, not a bug,
        # and would produce false failures.
        while True:
            cp = rng.randrange(0x110000)
            if 0xD800 <= cp <= 0xDFFF:
                continue
            if unicodedata.category(chr(cp)) != "Cn":
                return chr(cp)
    cp = rng.randrange(0, 256)
    return chr(cp)


def main():
    rng = random.Random(20240611)
    cases = []
    for i in range(N):
        key = rng.choice(list(PATTERNS))
        ln = rng.randint(1, 40)
        text = "".join(rand_char(rng) for _ in range(ln))
        if not text:
            continue
        root = minire.compile_pattern(PATTERNS[key])
        pos, want = 0, []
        n = len(text)
        while pos < n:
            end = minire.match_at(root, text, pos)
            if end is None:
                sys.exit(f"oracle stalled at {pos} in {text!r}")
            want.append(text[pos:end])
            pos = end
        cases.append({"pattern": key, "text": text, "want": want})

    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tests", "pretok_fuzz.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False)
    print(f"wrote {len(cases)} cases to {out}")


if __name__ == "__main__":
    main()