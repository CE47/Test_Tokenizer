"""Independent pure-Python reference implementation of OpenAI tiktoken BPE.

This file is *ground truth* for the web app. It is deliberately written as a
hand-rolled scanner (not `re`) so that it is an independent check of the JS
implementation in assets/js/core.

Port of tiktoken's `_byte_pair_merge` (tiktoken/src/lib.rs) is byte-for-byte
faithful, including the `i + 3` lookahead offset.
"""

from __future__ import annotations

import unicodedata

import minire

MAX_RANK = 1 << 30

# --- The published tiktoken pre-tokenisation patterns, verbatim --------------
PATTERNS = {
    # GPT-4 / GPT-3.5-turbo / text-embedding-3
    "cl100k": (
        r"""'(?i:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?+\p{L}++|\p{N}{1,3}+"""
        r"""| ?[^\s\p{L}\p{N}]++[\r\n]*+|\s++$|\s*[\r\n]|\s+(?!\S)|\s"""
    ),
    # GPT-2 (gpt2), GPT-3 text/code davinci, text-davinci-002/003
    "r50k": (
        r"""'(?:[sdmt]|ll|ve|re)| ?\p{L}++| ?\p{N}++"""
        r"""| ?[^\s\p{L}\p{N}]++|\s++$|\s+(?!\S)|\s"""
    ),
    # GPT-4o / GPT-4.1 / GPT-5
    "o200k": "|".join(
        [
            r"""[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?""",
            r"""[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?""",
            r"""\p{N}{1,3}""",
            r""" ?[^\s\p{L}\p{N}]+[\r\n/]*""",
            r"""\s*[\r\n]+""",
            r"""\s+(?!\S)""",
            r"""\s+""",
        ]
    ),
}

# --- Python `re` `\s` for str patterns == Py_UNICODE_ISSPACE ----------------
_PY_SPACE = set(
    [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x1C, 0x1D, 0x1E, 0x1F, 0x20, 0x85]
    + list(range(0xA0, 0xA1))
    + [0x1680]
    + list(range(0x2000, 0x200B))
    + [0x2028, 0x2029, 0x202F, 0x205F, 0x3000]
)


def _cat(ch: str) -> str:
    return unicodedata.category(ch)


def is_space(ch: str) -> bool:
    return ord(ch) in _PY_SPACE


def is_not_space(ch: str) -> bool:
    return ord(ch) not in _PY_SPACE


def is_L(ch: str) -> bool:
    return _cat(ch)[0] == "L"


def is_N(ch: str) -> bool:
    return _cat(ch)[0] == "N"


def is_alpha_or_num_or_cr(ch: str) -> bool:
    """`[^\\r\\n\\p{L}\\p{N}]` -- the optional prefix in cl100k alt #2."""
    return ch not in ("\r", "\n") and not is_L(ch) and not is_N(ch)


# --- Pre-tokenisation patterns ---------------------------------------------
# cl100k_base (GPT-4, GPT-3.5-turbo, text-embedding-3):
#   '(?i:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?+\p{L}++
#   |\p{N}{1,3}+
#   | ?[^\s\p{L}\p{N}]++[\r\n]*+
#   |\s++$
#   |\s*[\r\n]
#   |\s+(?!\S)
#   |\s
#
# r50k_base / p50k_base / gpt2:
#   '(?:[sdmt]|ll|ve|re)| ?\p{L}++| ?\p{N}++
#   | ?[^\s\p{L}\p{N}]++|\s++$|\s+(?!\S)|\s

_CONTRACTIONS = ("ll", "ve", "re", "sd", "mt")
_CONTRACTION_ALT1 = ("s", "t", "m", "d", "ll", "ve", "re")


def split_cl100k(text: str) -> list[str]:
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        start = i
        ch = text[i]

        # alt 1: '(?i:[sdmt]|ll|ve|re)
        if ch == "'" and i + 1 < n:
            c = text[i + 1]
            if c in "sSdDmM":
                i += 2
                out.append(text[start:i])
                continue
            if c in "lL" and i + 2 < n and text[i + 2] in "lL":
                i += 3
                out.append(text[start:i])
                continue
            if c in "vV" and i + 2 < n and text[i + 2] in "eE":
                i += 3
                out.append(text[start:i])
                continue
            if c in "rR" and i + 2 < n and text[i + 2] in "eE":
                i += 3
                out.append(text[start:i])
                continue

        # alt 2: [^\r\n\p{L}\p{N}]?+\p{L}++   (possessive optional prefix)
        j = i
        if j < n and is_alpha_or_num_or_cr(text[j]):
            j += 1  # possessive: committed, no backtracking
        if j < n and is_L(text[j]):
            j += 1
            while j < n and is_L(text[j]):
                j += 1
            i = j
            out.append(text[start:i])
            continue
        j = i  # prefix was not taken (or failed); retry without prefix
        if j < n and is_L(text[j]):
            j += 1
            while j < n and is_L(text[j]):
                j += 1
            i = j
            out.append(text[start:i])
            continue

        # alt 3: \p{N}{1,3}+
        if is_N(ch):
            j = i + 1
            while j < n and j - i < 3 and is_N(text[j]):
                j += 1
            i = j
            out.append(text[start:i])
            continue

        # alt 4:  ?[^\s\p{L}\p{N}]++[\r\n]*+
        j = i
        if j < n and text[j] == " ":
            j += 1
        if j < n and not is_space(text[j]) and not is_L(text[j]) and not is_N(text[j]):
            j += 1
            while (
                j < n
                and not is_space(text[j])
                and not is_L(text[j])
                and not is_N(text[j])
            ):
                j += 1
            while j < n and text[j] in ("\r", "\n"):
                j += 1
            i = j
            out.append(text[start:i])
            continue

        # alt 5: \s++$      (possessive run of whitespace that ends the string)
        if is_space(ch):
            j = i
            while j < n and is_space(text[j]):
                j += 1
            if j == n:
                i = j
                out.append(text[start:i])
                continue

        # alt 6: \s*[\r\n]  (greedy \s* then a newline)
        j = i
        while j < n and is_space(text[j]):
            j += 1
        if j < n and text[j] in ("\r", "\n"):
            i = j + 1
            out.append(text[start:i])
            continue

        # alt 7: \s+(?!\S)  -- whitespace run followed by end / whitespace
        j = i + 1
        while j < n and is_space(text[j]):
            j += 1
        if j == n or is_space(text[j]):
            i = j
            out.append(text[start:i])
            continue

        # alt 8: \s  (single whitespace fallback)
        i = i + 1
        out.append(text[start:i])
        continue

    return out


def split_r50k(text: str) -> list[str]:
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        start = i
        ch = text[i]

        # alt 1: '(?:[sdmt]|ll|ve|re)
        if ch == "'" and i + 1 < n:
            c = text[i + 1]
            if c in "sSdDmM":
                i += 2
                out.append(text[start:i])
                continue
            if c in "lL" and i + 2 < n and text[i + 2] in "lL":
                i += 3
                out.append(text[start:i])
                continue
            if c in "vV" and i + 2 < n and text[i + 2] in "eE":
                i += 3
                out.append(text[start:i])
                continue
            if c in "rR" and i + 2 < n and text[i + 2] in "eE":
                i += 3
                out.append(text[start:i])
                continue

        # alt 2:  ?\p{L}++
        j = i + (1 if ch == " " else 0)
        if j < n and is_L(text[j]):
            j += 1
            while j < n and is_L(text[j]):
                j += 1
            i = j
            out.append(text[start:i])
            continue

        # alt 3:  ?\p{N}++
        if j < n and is_N(text[j]):
            j += 1
            while j < n and is_N(text[j]):
                j += 1
            i = j
            out.append(text[start:i])
            continue

        # alt 4:  ?[^\s\p{L}\p{N}]++
        if j < n and not is_space(text[j]) and not is_L(text[j]) and not is_N(text[j]):
            j += 1
            while j < n and not is_space(text[j]) and not is_L(text[j]) and not is_N(text[j]):
                j += 1
            i = j
            out.append(text[start:i])
            continue

        # alt 5: \s++$
        if is_space(ch):
            j = i
            while j < n and is_space(text[j]):
                j += 1
            if j == n:
                i = j
                out.append(text[start:i])
                continue

        # alt 6: \s+(?!\S)
        j = i + 1
        while j < n and is_space(text[j]):
            j += 1
        if j == n or is_space(text[j]):
            i = j
            out.append(text[start:i])
            continue

        # alt 7: \s
        i = i + 1
        out.append(text[start:i])
        continue

    return out


# --- BPE -------------------------------------------------------------------
def byte_pair_merge(ranks: dict[bytes, int], piece: bytes, trace=None):
    """Faithful port of tiktoken's Rust `_byte_pair_merge`."""
    n = len(piece)
    parts: list[list[int]] = []  # [start, rank]
    min_rank, min_i = MAX_RANK, 0
    for i in range(n - 1):
        r = ranks.get(piece[i : i + 2], MAX_RANK)
        if r < min_rank:
            min_rank, min_i = r, i
        parts.append([i, r])
    parts.append([n - 1, MAX_RANK])
    parts.append([n, MAX_RANK])

    def get_rank(pl, i):
        if i + 3 < len(pl):
            return ranks.get(piece[pl[i][0] : pl[i + 3][0]], MAX_RANK)
        return MAX_RANK

    while min_rank != MAX_RANK:
        i = min_i
        left = piece[parts[i][0] : parts[i + 1][0]]
        right = piece[parts[i + 1][0] : parts[i + 2][0]]
        if trace is not None:
            trace.append(
                {
                    "left": left,
                    "right": right,
                    "merged": piece[parts[i][0] : parts[i + 2][0]],
                    "rank": min_rank,
                }
            )
        if i > 0:
            parts[i - 1][1] = get_rank(parts, i - 1)
        parts[i][1] = get_rank(parts, i)
        del parts[i + 1]

        min_rank, min_i = MAX_RANK, 0
        for k in range(len(parts) - 1):
            if parts[k][1] < min_rank:
                min_rank, min_i = parts[k][1], k

    return [piece[parts[i][0] : parts[i + 1][0]] for i in range(len(parts) - 1)]


class Encoding:
    def __init__(self, name, ranks, specials, explicit_n_vocab=None, pattern="cl100k"):
        self.name = name
        self.ranks = ranks
        self.specials = specials
        self.pattern = pattern
        self._rx = minire.compile_pattern(PATTERNS[pattern])
        self.split = {
            "cl100k": split_cl100k,
            "r50k": split_r50k,
        }.get(pattern)
        maxr = max(ranks.values())
        self.n_vocab = explicit_n_vocab or (maxr + 1 + len(specials))

    def pre_tokenize(self, text: str) -> list[str]:
        """Authoritative split: real pattern, real possessive semantics."""
        if self._rx is None:
            return self.split(text)
        out, pos, n = [], 0, len(text)
        while pos < n:
            end = minire.match_at(self._rx, text, pos)
            if end is None or end == pos:
                raise ValueError(f"{self.name}: no pre-token match at {pos} in {text!r}")
            out.append(text[pos:end])
            pos = end
        return out

    def encode_ordinary_with_trace(self, text, trace_on=False):
        out, traces = [], []
        for pt in self.pre_tokenize(text):
            b = pt.encode("utf-8")
            tr = [] if trace_on else None
            if len(b) == 1:
                pieces = [b]
                if tr is not None:
                    tr.append({"left": b, "right": b"", "merged": b, "rank": self.ranks[b]})
            else:
                pieces = byte_pair_merge(self.ranks, b, tr)
            for p in pieces:
                out.append(self.ranks[p])
                if trace_on:
                    traces.append({"pretoken": pt, "piece": p, "rank": self.ranks[p], "merges": tr})
        return out, traces

    def encode_ordinary(self, text):
        return self.encode_ordinary_with_trace(text, False)[0]

    def encode(self, text):
        """Split on special tokens first, then encode_ordinary the gaps."""
        if not self.specials:
            return self.encode_ordinary(text)
        pat = "|".join(re_escape(s) for s in sorted(self.specials, key=len, reverse=True))
        out: list[int] = []
        pos = 0
        for text_hit, start in re_finditer_literal(pat, text):
            out.extend(self.encode_ordinary(text[pos:start]))
            out.append(self.specials[text_hit])
            pos = start + len(text_hit)
        out.extend(self.encode_ordinary(text[pos:]))
        return out

    def decode(self, ids):
        pieces, buf = [], b""
        for i in ids:
            if i in self.special_values():
                if buf:
                    pieces.append(buf)
                    buf = b""
                pieces.append(i)
            else:
                buf += self.id_to_bytes[i]
        if buf:
            pieces.append(buf)
        return b"".join(p if isinstance(p, bytes) else str(p).encode() for p in pieces).decode(
            "utf-8", errors="replace"
        )

    def special_values(self):
        return set(self.specials.values())

    @property
    def id_to_bytes(self):
        if not hasattr(self, "_id2b"):
            m = {}
            for b, r in self.ranks.items():
                m[r] = b
            self._id2b = m
        return self._id2b


def re_escape(s: str) -> str:
    import re

    return re.escape(s)


def re_finditer_literal(pat: str, text: str):
    import re

    rx = re.compile("(" + pat + ")")
    for m in rx.finditer(text):
        yield m.group(1), m.start(1)