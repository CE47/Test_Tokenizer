/* =============================================================================
 * pretok.js — the three published tiktoken pre-tokenisation patterns.
 *
 * The patterns in OpenAI's tokenizer use *possessive* quantifiers (`?+`, `++`,
 * `*+`). JavaScript has no possessive quantifiers (as of V8 in Node 22 / Chrome
 * <125), and they cannot simply be dropped: dropping them changes the result.
 *
 *   "1abc"  with `[^\r\n\p{L}\p{N}]?+\p{L}++`  ->  "1" + "abc"
 *           with `[^\r\n\p{L}\p{N}]?\p{L}+`    ->  "1abc"        (wrong!)
 *
 * So we emulate possessiveness with the standard atomic-group trick
 * `X?+  ==>  (?:(?=(X))\k<X>)?` and `X++  ==>  (?=(X+))\k<X>`.
 * tools/minire.py implements real possessive semantics, and tests/run.js proves
 * this file agrees with it on hundreds of thousands of random strings.
 *
 * A second, subtler difference: JavaScript's `\s` includes U+FEFF, while
 * Python's `re` `\s` (Py_UNICODE_ISSPACE) does not. We therefore spell the class
 * out explicitly rather than using `\s`.
 *
 * A third trap: the patterns' `(?i:...)` groups. Under the `i` flag ECMAScript
 * case-folds *property escapes inside character classes*, so `[\p{Ll}]` with
 * `iu` also matches uppercase letters — which silently destroys o200k's whole
 * point of telling SCREAMING CASE apart from lowercase. We therefore never use
 * the `i` flag and spell the contractions out as explicit case classes.
 * (The only divergence from Python is U+017F 'ſ', which Python's `(?i:s)` also
 * matches; the explicit classes below do not.)
 * ========================================================================== */
(function (global) {
  "use strict";

  // Py_UNICODE_ISSPACE — byte-for-byte what Python's `re` treats as \s.
  var WS =
    "\\t\\n\\v\\f\\r\\x1c-\\x1f\\x20\\x85\\xa0\\u1680\\u2000-\\u200a" +
    "\\u2028\\u2029\\u202f\\u205f\\u3000";
  var WS_CLASS = "[" + WS + "]";
  var NOT_WS_CLASS = "[^" + WS + "]";

// Not-letter-or-digit, i.e. the \p{L} / \p{N} complement.
  var NOT_LN = "[^\\r\\n\\p{L}\\p{N}]";
  // Non-space, non-letter, non-digit — the "punctuation & symbols" class.
  var PUNCT = "[^" + WS + "\\p{L}\\p{N}]";

  // '(?i:[sdmt]|ll|ve|re)  — case-insensitive, used by cl100k
  var CONTR_CI = "(?:[sSdDmMtT]|[lL][lL]|[vV][eE]|[rR][eE])";
  // '(?:[sdmt]|ll|ve|re)   — case-SENSITIVE, used by r50k / p50k / gpt2
  var CONTR_CS = "(?:[sdtm]|ll|ve|re)";
  // (?i:'s|'t|'re|'ve|'m|'ll|'d') — used by o200k
  var CONTR_O = "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])";

  var PATTERNS = {
    // ---- cl100k_base: GPT-4, GPT-4-turbo, GPT-3.5-turbo, text-embedding-3
    // '(?i:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?+\p{L}++|\p{N}{1,3}+
    // | ?[^\s\p{L}\p{N}]++[\r\n]*+|\s++$|\s*[\r\n]|\s+(?!\S)|\s
    cl100k: [
      "'" + CONTR_CI,
      "|(?:(?=(?<a>" + NOT_LN + "))\\k<a>)?(?=(?<b>\\p{L}+))\\k<b>",
      "|(?=(?<c>\\p{N}{1,3}))\\k<c>",
      "| ?(?=(?<d>" + PUNCT + "+))\\k<d>(?=(?<e>[\\r\\n]*))\\k<e>",
      "|(?=(?<f>" + WS_CLASS + "*))\\k<f>$",
      "|" + WS_CLASS + "*[\\r\\n]",
      "|" + WS_CLASS + "+(?!" + NOT_WS_CLASS + ")",
      "|" + WS_CLASS
    ].join(""),

    // ---- r50k_base / p50k_base / gpt2
    // '(?:[sdmt]|ll|ve|re)| ?\p{L}++| ?\p{N}++| ?[^\s\p{L}\p{N}]++
    // |\s++$|\s+(?!\S)|\s
    r50k: [
      "'" + CONTR_CS,
      "| ?(?=(?<a>\\p{L}+))\\k<a>",
      "| ?(?=(?<b>\\p{N}+))\\k<b>",
      "| ?(?=(?<c>" + PUNCT + "+))\\k<c>",
      "|(?=(?<d>" + WS_CLASS + "*))\\k<d>$",
      "|" + WS_CLASS + "+(?!" + NOT_WS_CLASS + ")",
      "|" + WS_CLASS
    ].join(""),

    // ---- o200k_base: GPT-4o, GPT-4o-mini, GPT-4.1, GPT-5
    // No possessive quantifiers here, so this one is a direct translation.
    o200k: [
      NOT_LN + "?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+" + CONTR_O + "?",
      "|" + NOT_LN + "?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*" + CONTR_O + "?",
      "|\\p{N}{1,3}",
      "| ?" + PUNCT + "+[\\r\\n/]*",
      "|" + WS_CLASS + "*[\\r\\n]+",
      "|" + WS_CLASS + "+(?!" + NOT_WS_CLASS + ")",
      "|" + WS_CLASS + "+"
    ].join("")
  };

var HUMAN = {
    cl100k: [
      { re: "'(?i:[sdmt]|ll|ve|re)", cls: "'(?:[sSdDmMtT]|[lL][lL]|[vV][eE]|[rR][eE])",
        why: "a contraction tail, any case — 's 't 'm 'd 'll 've 're" },
      { re: "[^\\r\\n\\p{L}\\p{N}]?+\\p{L}++", cls: "[^\\r\\n\\p{L}\\p{N}]?\\p{L}+",
        why: "one optional non-letter prefix, then a run of letters" },
      { re: "\\p{N}{1,3}+", cls: "\\p{N}{1,3}",
        why: "a run of digits — never more than 3 at a time" },
      { re: " ?[^\\s\\p{L}\\p{N}]++[\\r\\n]*+", cls: " ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*",
        why: "an optional space, a run of punctuation, then newlines" },
      { re: "\\s++$", cls: "\\s+$",
        why: "a whitespace run that runs to the very end of the input" },
      { re: "\\s*[\\r\\n]", cls: "\\s*[\\r\\n]",
        why: "whitespace that ends on a newline" },
      { re: "\\s+(?!\\S)", cls: "\\s+(?!\\S)",
        why: "a whitespace run NOT followed by a non-space" },
      { re: "\\s", cls: "\\s",
        why: "any single leftover whitespace character" }
    ],
    r50k: [
      { re: "'(?:[sdmt]|ll|ve|re)", cls: "'(?:[sdtm]|ll|ve|re)",
        why: "a contraction tail — lowercase only" },
      { re: " ?\\p{L}++", cls: " ?\\p{L}+", why: "an optional space, then a run of letters" },
      { re: " ?\\p{N}++", cls: " ?\\p{N}+",
        why: "an optional space, then digits — no 3-digit cap here" },
      { re: " ?[^\\s\\p{L}\\p{N}]++", cls: " ?[^\\s\\p{L}\\p{N}]+",
        why: "an optional space, then a run of punctuation" },
      { re: "\\s++$", cls: "\\s+$", why: "a whitespace run that ends the input" },
      { re: "\\s+(?!\\S)", cls: "\\s+(?!\\S)", why: "a whitespace run not followed by a non-space" },
      { re: "\\s", cls: "\\s", why: "any single leftover whitespace character" }
    ],
    o200k: [
      { re: "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
        cls: "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?",
        why: "a mostly-lowercase word, optionally ending in a contraction" },
      { re: "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
        cls: "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?",
        why: "a mostly-UPPERCASE word (SCREAMING CASE gets its own rule)" },
      { re: "\\p{N}{1,3}", cls: "\\p{N}{1,3}", why: "a run of digits, at most 3 at a time" },
      { re: " ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*", cls: " ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*",
        why: "an optional space, punctuation, then newlines or slashes" },
      { re: "\\s*[\\r\\n]+", cls: "\\s*[\\r\\n]+", why: "whitespace then one or more newlines" },
      { re: "\\s+(?!\\S)", cls: "\\s+(?!\\S)", why: "a whitespace run not followed by a non-space" },
      { re: "\\s+", cls: "\\s+", why: "any remaining run of whitespace" }
    ]
  };

  var compiled = {};
  var classRegex = {};

  function getRegex(patternKey) {
    if (!compiled[patternKey]) {
      compiled[patternKey] = new RegExp(PATTERNS[patternKey], "gu");
    }
    return compiled[patternKey];
  }

  function classifier(patternKey, alt) {
    if (!classRegex[patternKey]) classRegex[patternKey] = [];
    if (!classRegex[patternKey][alt]) {
      var src = HUMAN[patternKey][alt].cls
        .replace(/\[\s/g, "[" + WS + "\\p{L}\\p{N} ") // plain \s inside a class
        .replace(/\S/g, "[^" + WS + "]");
      classRegex[patternKey][alt] = new RegExp("^(?:" + src + ")$", "gu");
    }
    return classRegex[patternKey][alt];
  }

  /**
   * Split text into pre-tokens exactly as tiktoken does.
   * @returns {{text:string,start:number,end:number,alt:number}[]}
   */
  function preTokenize(text, patternKey) {
    var rx = getRegex(patternKey);
    var out = [];
    var m;
    rx.lastIndex = 0;
    while ((m = rx.exec(text)) !== null) {
      if (m[0] === "") {
        rx.lastIndex++;
        continue;
      }
      out.push({
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        alt: alternateFor(patternKey, m[0])
      });
    }
    return out;
  }

  /** Which alternation branch of the pattern produced this chunk? */
  function alternateFor(patternKey, s) {
    var human = HUMAN[patternKey];
    if (!human) return 0;
    for (var j = 0; j < human.length; j++) {
      if (classifier(patternKey, j).test(s)) return j;
    }
    return human.length - 1;
  }

  function altInfo(patternKey, alt) {
    var h = HUMAN[patternKey][alt];
    return { re: h.re, why: h.why, index: alt };
  }

  global.Pretok = {
    PATTERNS: PATTERNS,
    HUMAN: HUMAN,
    WS: WS,
    preTokenize: preTokenize,
    getRegex: getRegex,
    altInfo: altInfo
  };
})(typeof window !== "undefined" ? window : globalThis);