/* =============================================================================
 * tokenizer.js — the public API: text <-> token ids, with a full trace.
 * ========================================================================== */
(function (global) {
  "use strict";

  var Pretok = global.Pretok;
  var Vocab = global.Vocab;
  var BPE = global.BPE;

  function latin1(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  /**
   * @typedef {Object} EncodeResult
   * @property {number[]} ids
   * @property {Object[]} tokens  one per token
   * @property {Object[]} chunks  one per pre-token, each with its merges
   */

  function encode(vocab, text, opts) {
    opts = opts || {};
    var trace = !!opts.trace;
    var ids = [];
    var chunks = [];
    var specials = [];

    // Special tokens (<|endoftext|> etc.) are matched first and never merged.
    var segments = splitSpecials(vocab, text);

    segments.forEach(function (seg) {
      if (seg.special) {
        var sid = vocab.special[seg.text];
        ids.push(sid);
        specials.push({ id: sid, text: seg.text, start: seg.start, end: seg.end });
        chunks.push({
          pre: seg.text,
          preStart: seg.start,
          alt: -1,
          special: true,
          bytes: null,
          merges: [],
          tokens: [{ id: sid, text: seg.text, rank: sid, isSpecial: true, index: ids.length - 1 }]
        });
        return;
      }
      var plain = seg.text;
      if (!plain) return;
      var bytes = Vocab.utf8Encode(plain);
      var pre = Pretok.preTokenize(plain, vocab.pattern);
      for (var p = 0; p < pre.length; p++) {
        var pt = pre[p];
        var ptBytes = Vocab.utf8Encode(pt.text);
        var ptLatin = latin1(ptBytes);
        var r = BPE.merge(vocab, ptLatin, trace);
        var toks = r.parts.map(function (bytesLatin) {
          var rank = vocab.rank(bytesLatin);
          return {
            id: rank,
            rank: rank,
            bytes: vocab.latin1ToBytes(bytesLatin),
            text: Vocab.utf8Decode(vocab.latin1ToBytes(bytesLatin))
          };
        });
        for (var t = 0; t < toks.length; t++) {
          toks[t].index = ids.length + t;
          ids.push(toks[t].id);
        }
        chunks.push({
          pre: pt.text,
          preStart: seg.start + pt.start,
          alt: pt.alt,
          bytes: ptBytes,
          merges: r.merges || [],
          tokens: toks
        });
      }
    });

    return {
      ids: ids,
      tokens: chunks.length ? [].concat.apply([], chunks.map(function (c) { return c.tokens; })) : [],
      chunks: chunks,
      specials: specials
    };
  }

  function splitSpecials(vocab, text) {
    if (!vocab.specialPattern) return [{ text: text, start: 0, special: false }];
    var rx = new RegExp("(" + vocab.specialPattern + ")", "g");
    var out = [];
    var pos = 0;
    var m;
    while ((m = rx.exec(text)) !== null) {
      if (m.index > pos) out.push({ text: text.slice(pos, m.index), start: pos, special: false });
      out.push({ text: m[0], start: m.index, special: true });
      pos = m.index + m[0].length;
      if (m[0] === "") rx.lastIndex++;
    }
    if (pos < text.length) out.push({ text: text.slice(pos), start: pos, special: false });
    return out;
  }

  /**
   * Detokenisation. Crucially this concatenates *bytes* first and decodes UTF-8
   * once at the end: a multi-byte character can straddle a token boundary, so
   * decoding token-by-token would mangle it. ("🚀" is ids [9468, 248, 222].)
   */
  function decode(vocab, ids) {
    var out = "";
    var buf = [];
    var i, k, s;
    function flush() {
      if (!buf.length) return;
      out += Vocab.utf8Decode(new Uint8Array(buf));
      buf = [];
    }
    for (i = 0; i < ids.length; i++) {
      var name = vocab.specialById.get(ids[i]);
      if (name !== undefined) {
        flush();
        out += name;
        continue;
      }
      s = vocab.byRank[ids[i]];
      if (s === undefined) continue;
      for (k = 0; k < s.length; k++) buf.push(s.charCodeAt(k));
    }
    flush();
    return out;
  }

  /** Cheap id-only path (no objects, no trace) for live counters. */
  function count(vocab, text) {
    var n = 0;
    splitSpecials(vocab, text).forEach(function (seg) {
      if (seg.special) {
        n += 1;
        return;
      }
      if (!seg.text) return;
      var pre = Pretok.preTokenize(seg.text, vocab.pattern);
      for (var p = 0; p < pre.length; p++) {
        var ptLatin = latin1(Vocab.utf8Encode(pre[p].text));
        if (ptLatin.length === 1) {
          n += 1;
          continue;
        }
        n += BPE.merge(vocab, ptLatin, false).parts.length;
      }
    });
    return n;
  }

  /* ------------------------------------------------------------ statistics */
  function stats(text) {
    var bytes = Vocab.utf8Encode(text);
    var words = (text.match(/[\p{L}\p{N}']+/gu) || []).length;
    return {
      chars: text.length,
      codePoints: Array.from(text).length,
      bytes: bytes.length,
      words: words
    };
  }

  global.Tokenizer = {
    encode: encode,
    decode: decode,
    count: count,
    stats: stats
  };
})(typeof window !== "undefined" ? window : globalThis);