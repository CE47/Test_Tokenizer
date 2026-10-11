/* =============================================================================
 * bpe.js — byte-pair merge, plus a recording of every merge for animation.
 *
 * This is a direct port of tiktoken's `_byte_pair_merge` (tiktoken/src/lib.rs).
 * The subtle part is `getRank`, which looks *three* parts ahead rather than two,
 * because `parts[i + 1]` has not been spliced out yet at the time it is called.
 * Getting that wrong produces different (still plausible-looking) tokenisations,
 * so the port is kept line-for-line faithful and tests/run.js fuzzes it.
 * ========================================================================== */
(function (global) {
  "use strict";

  var MAX = Infinity;

  /**
   * @param {object} vocab   Vocab instance (needs .ranks / .rank())
   * @param {string} piece   latin-1 string of the pre-token's raw bytes
   * @param {boolean} trace  record every merge for the animation
   * @returns {{parts: string[], merges: Array}}
   */
  function bytePairMerge(vocab, piece, trace) {
    var n = piece.length;
    if (n === 1) {
      return { parts: [piece], merges: trace ? [{ i: 0, merged: piece, rank: vocab.rank(piece) }] : [] };
    }

    // parts[k] = [start offset, rank of the pair that starts at offset parts[k]]
    var start = new Int32Array(n + 2);
    var rank = new Float64Array(n + 2);
    var minRank = MAX;
    var minI = 0;
    var i, j;

    for (i = 0; i < n - 1; i++) {
      var r = vocab.rank(piece.substr(i, 2));
      if (r < 0) r = MAX;
      if (r < minRank) {
        minRank = r;
        minI = i;
      }
      start[i] = i;
      rank[i] = r;
    }
    start[n - 1] = n - 1;
    start[n] = n;
    rank[n - 1] = MAX;
    rank[n] = MAX;
    var len = n + 1;

    function getRank(at) {
      // +3, not +2: parts[i+1] is deleted only after this call.
      if (at + 3 < len) {
        var rr = vocab.rank(piece.substring(start[at], start[at + 3]));
        return rr < 0 ? MAX : rr;
      }
      return MAX;
    }

    var merges = trace ? [] : null;
    var guard = 0;
    while (minRank !== MAX && guard++ < n * 4) {
      i = minI;
      if (trace) {
        merges.push({
          at: i,
          left: piece.substring(start[i], start[i + 1]),
          right: piece.substring(start[i + 1], start[i + 2]),
          merged: piece.substring(start[i], start[i + 2]),
          rank: minRank
        });
      }
      if (i > 0) rank[i - 1] = getRank(i - 1);
      rank[i] = getRank(i);
      // splice out i+1
      for (j = i + 1; j < len - 1; j++) {
        start[j] = start[j + 1];
        rank[j] = rank[j + 1];
      }
      len--;

      minRank = MAX;
      minI = 0;
      for (j = 0; j < len - 1; j++) {
        if (rank[j] < minRank) {
          minRank = rank[j];
          minI = j;
        }
      }
    }

    var parts = new Array(len - 1);
    for (i = 0; i < len - 1; i++) parts[i] = piece.substring(start[i], start[i + 1]);
    return { parts: parts, merges: merges };
  }

  /**
   * Textbook BPE, written independently of the port above, used by tests/run.js
   * to cross-check it. O(n^2) — only ever called on short pieces.
   */
  function naiveMerge(vocab, piece) {
    var parts = [];
    for (var i = 0; i < piece.length; i++) parts.push(piece[i]);
    while (parts.length > 1) {
      var best = -1,
        at = -1;
      for (var k = 0; k < parts.length - 1; k++) {
        var r = vocab.rank(parts[k] + parts[k + 1]);
        if (r >= 0 && (best < 0 || r < best)) {
          best = r;
          at = k;
        }
      }
      if (at < 0) break;
      parts.splice(at, 2, parts[at] + parts[at + 1]);
    }
    return parts;
  }

  global.BPE = { merge: bytePairMerge, naiveMerge: naiveMerge };
})(typeof window !== "undefined" ? window : globalThis);