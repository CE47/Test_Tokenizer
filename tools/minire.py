"""A tiny backtracking regex engine used ONLY as a test oracle.

The published tiktoken pre-tokenisation patterns use *possessive* quantifiers
(`?+`, `++`, `*+`), which neither Python's `re` nor (as of Node 22) JavaScript's
RegExp support.  The web app emulates them with the standard atomic-group trick
`(?=(X))\\1`.  This engine implements genuine possessive semantics so that we can
prove the emulation correct against the real patterns.

Supports exactly the constructs the three tiktoken patterns use:
  |   (?: )  ( )  (?i: )  (?! )   [...]   \\p{..} \\P{..}  \\s \\S \\r \\n \\d
  ? * + {m} {m,} {m,n}    with a trailing `+` meaning POSSESSIVE
  $
"""

from __future__ import annotations

import unicodedata

__all__ = ["compile_pattern", "findall", "match_at"]

_SPACE_EXTRA = (0x1C, 0x1D, 0x1E, 0x1F, 0x85)


# Py_UNICODE_ISSPACE: what Python's `re` means by \s on str patterns.
_SPACE_CP = (
    set(range(0x09, 0x0E))
    | set(range(0x1C, 0x20))
    | {0x20, 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000}
    | set(range(0x2000, 0x200B))
)


def _is_space(ch: str) -> bool:
    return ord(ch) in _SPACE_CP


def _prop_match(name: str, ch: str) -> bool:
    c = unicodedata.category(ch)
    if name in ("L", "N", "M", "P", "S", "Z", "C"):
        return c[0] == name
    if len(name) == 2 and name[0] in "LNMP":
        return c == name
    raise AssertionError("unsupported property " + name)


class _Node:
    __slots__ = ("kind", "kids", "v", "mn", "mx", "poss", "neg")

    def __init__(self, kind, **kw):
        self.kind = kind
        self.kids = []
        for k, val in kw.items():
            setattr(self, k, val)


_ESCAPES = {"r": "\r", "n": "\n", "t": "\t", "v": "\v", "f": "\f", "0": "\0", "a": "\a"}


# --------------------------------------------------------------------- parsing
class _Parser:
    def __init__(self, src):
        self.s = src
        self.i = 0

    def parse(self):
        alts = [self.seq()]
        while self.i < len(self.s) and self.s[self.i] == "|":
            self.i += 1
            alts.append(self.seq())
        return alts[0] if len(alts) == 1 else _Node("alt", kids=alts)

    def seq(self):
        kids = []
        while self.i < len(self.s) and self.s[self.i] not in "|)":
            kids.append(self.atom_with_quant())
        return _Node("seq", kids=kids)

    def atom_with_quant(self):
        atom = self.atom()
        while self.i < len(self.s):
            c = self.s[self.i]
            if c in "?*+{":
                if c == "{":
                    j = self.s.find("}", self.i)
                    if j < 0:
                        break
                    body = self.s[self.i + 1 : j]
                    parts = body.split(",")
                    mn = int(parts[0])
                    mx = int(parts[1]) if len(parts) > 1 and parts[1] else None
                    if len(parts) == 1:
                        mx = mn
                    self.i = j + 1
                elif c == "?":
                    mn, mx = 0, 1
                    self.i += 1
                elif c == "*":
                    mn, mx = 0, None
                    self.i += 1
                else:
                    mn, mx = 1, None
                    self.i += 1
                poss = False
                if self.i < len(self.s) and self.s[self.i] == "+":
                    poss = True
                    self.i += 1
                atom = _Node("rep", kids=[atom], mn=mn, mx=mx, poss=poss)
            else:
                break
        return atom

    def atom(self):
        s, i = self.s, self.i
        if s[i] == "(":
            if s.startswith("(?:", i):
                self.i += 3
                node = self.parse()
            elif s.startswith("(?i:", i):
                self.i += 4
                node = _Node("icase", kids=[self.parse()])
            elif s.startswith("(?!", i):
                self.i += 3
                node = _Node("nlook", kids=[self.parse()])
            else:
                self.i += 1
                node = self.parse()
            assert s[self.i] == ")", (s, i, self.i)
            self.i += 1
            return node
        if s[i] == "[":
            return self.cls()
        if s[i] == "\\":
            return self.escape()
        if s[i] == "$":
            self.i += 1
            return _Node("eol")
        self.i += 1
        return _Node("lit", v=s[i])

    def escape(self):
        s = self.s
        self.i += 1
        c = s[self.i]
        if c in "pP":
            j = s.index("}", self.i)
            name = s[self.i + 2 : j]
            self.i = j + 1
            return _Node("prop", v=(name, c == "P"))
        self.i += 1
        if c in "sS":
            return _Node("spc", v=(c == "S"))
        return _Node("lit", v=_ESCAPES.get(c, c))

    def cls(self):
        s = self.s
        self.i += 1
        neg = False
        if s[self.i] == "^":
            neg = True
            self.i += 1
        items = []
        while s[self.i] != "]":
            if s[self.i] == "\\":
                self.i += 1
                c = s[self.i]
                if c in "pP":
                    j = s.index("}", self.i)
                    items.append(("prop", s[self.i + 2 : j], c == "P"))
                    self.i = j + 1
                elif c == "s":
                    self.i += 1
                    items.append(("space", None, False))
                elif c == "S":
                    self.i += 1
                    items.append(("space", None, True))
                else:
                    self.i += 1
                    items.append(("lit", _ESCAPES.get(c, c), False))
            else:
                ch = s[self.i]
                self.i += 1
                if s[self.i : self.i + 1] == "-" and s[self.i + 1 : self.i + 2] != "]":
                    items.append(("lit", ch + "-" + s[self.i + 1], False))
                    self.i += 2
                else:
                    items.append(("lit", ch, False))
        self.i += 1
        return _Node("cls", v=items, neg=neg)

# ------------------------------------------------------------------- matching
def _class_ok(node, ch, ci=False):
    neg = node.neg
    hit = False
    for kind, val, sub_neg in node.v:
        if kind == "lit":
            if len(val) == 3 and val[1] == "-":
                ok = val[0] <= ch <= val[2]
            else:
                ok = val == ch or (ci and val.lower() == ch.lower())
        elif kind == "prop":
            ok = _prop_match(val, ch) != sub_neg
        elif kind == "space":
            ok = _is_space(ch) != sub_neg
        else:
            raise AssertionError(kind)
        if ok:
            hit = True
    return hit != neg


def _m(node, text, pos, cont, ci=False):
    k = node.kind
    n = len(text)
    if k == "lit":
        if pos < n:
            a = node.v
            b = text[pos]
            if a == b or (ci and a.lower() == b.lower()):
                return cont(pos + 1)
        return False
    if k == "icase":
        return _m(node.kids[0], text, pos, cont, True)
    if k == "prop":
        if pos < n and _prop_match(node.v[0], text[pos]) != node.v[1]:
            return cont(pos + 1)
        return False
    if k == "cls":
        if pos < n and _class_ok(node, text[pos], ci):
            return cont(pos + 1)
        return False
    if k == "spc":
        if pos < n and _is_space(text[pos]) != node.v:
            return cont(pos + 1)
        return False
    if k == "eol":
        if pos == n or (pos == n - 1 and text[pos] == "\n"):
            return cont(pos)
        return False
    if k == "seq":
        kids = node.kids

        def rec(i, p):
            if i == len(kids):
                return cont(p)
            return _m(kids[i], text, p, lambda q: rec(i + 1, q), ci)

        return rec(0, pos)
    if k == "alt":
        for a in node.kids:
            if _m(a, text, pos, cont, ci):
                return True
        return False
    if k == "nlook":
        if _m(node.kids[0], text, pos, lambda p: True, ci):
            return False
        return cont(pos)
    if k == "rep":
        kid = node.kids[0]
        mn, mx, poss = node.mn, node.mx, node.poss

        def rec(count, p):
            took = [False]

            if mx is None or count < mx:

                def after(q):
                    took[0] = True
                    if q == p:
                        return False  # no progress: stop to avoid an infinite loop
                    return rec(count + 1, q)

                if _m(kid, text, p, after, ci):
                    return True
            # Possessive: once >=1 repetition succeeded we may never give any back.
            if poss and took[0]:
                return False
            if count >= mn:
                return cont(p)
            return False

        return rec(0, pos)
    raise AssertionError(k)


def match_at(root, text, pos):
    box = []
    if _m(root, text, pos, lambda p: (box.append(p), True)[1]):
        return box[0]
    return None


def compile_pattern(src):
    return _Parser(src).parse()


def findall(src, text):
    root = compile_pattern(src)
    out = []
    pos = 0
    n = len(text)
    while pos < n:
        end = match_at(root, text, pos)
        if end is None or end == pos:
            raise ValueError("pattern made no progress at %d" % pos)
        out.append(text[pos:end])
        pos = end
    return out