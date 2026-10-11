/* =============================================================================
 * vocab.js — unpacks the real tiktoken merge tables.
 *
 * Each vocabulary file is a base64 blob of:
 *     "TKB1" | varint(count) | per token: varint(rankDelta) varint(len) bytes
 * so a whole 100k-entry table costs ~1.1 MB instead of ~1.7 MB of the original
 * base64-per-line .tiktoken file.
 * ========================================================================== */
(function (global) {
  "use strict";

  function b64ToBytes(b64) {
    if (typeof atob === "function") {
      var bin = atob(b64);
      var n = bin.length;
      var out = new Uint8Array(n);
      for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(b64, "base64")) : null;
  }

  function buildVocab(spec) {
    var bytes = b64ToBytes(spec.b64);
    if (!bytes) throw new Error("no base64 decoder available");
    var p = 0;
    function header() {
      if (bytes[p++] !== 0x54 || bytes[p++] !== 0x4b || bytes[p++] !== 0x42 || bytes[p++] !== 0x31)
        throw new Error("bad vocab magic for " + spec.name);
    }
    function varint() {
      var v = 0, s = 0, b;
      do {
        b = bytes[p++];
        v |= (b & 0x7f) << s;
        s += 7;
      } while (b & 0x80);
      return v >>> 0;
    }
    header();
    var count = varint();

    // Latin-1 strings give us cheap, collision-free Map keys for byte strings.
    var ranks = new Map(); // latin1 token bytes -> rank
    var byRank = new Array(spec.nVocab);
    var lens = new Uint16Array(spec.nVocab);
    var prev = -1;
    var i;
    for (i = 0; i < count; i++) {
      var rank = prev + varint() + 1;
      prev = rank;
      var len = varint();
      var s = "";
      for (var k = 0; k < len; k++) s += String.fromCharCode(bytes[p++]);
      ranks.set(s, rank);
      byRank[rank] = s;
      lens[rank] = len;
    }

    var special = spec.special || {};
    var specialById = new Map();
    Object.keys(special).forEach(function (name) {
      specialById.set(special[name], name);
    });
    var specialRx = Object.keys(special).sort(function (a, b) {
      return b.length - a.length;
    });
    var specialPattern = specialRx.length
      ? specialRx
          .map(function (s) {
            return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("|")
      : null;

    return {
      name: spec.name,
      nMergeable: count,
      nVocab: spec.nVocab,
      pattern: spec.pattern,
      models: spec.models || [],
      ranks: ranks,
      byRank: byRank,
      lens: lens,
      special: special,
      specialById: specialById,
      specialPattern: specialPattern,

      rank: function (bytesLatin1) {
        var r = ranks.get(bytesLatin1);
        return r === undefined ? -1 : r;
      },
      bytesOf: function (id) {
        var name = specialById.get(id);
        if (name !== undefined) return null; // special token: not mergeable bytes
        return byRank[id];
      },
      /** Reserved ids that have neither bytes nor a special name. */
      isReserved: function (id) {
        return specialById.get(id) === undefined && byRank[id] === undefined;
      },
      latin1ToBytes: function (s) {
        var out = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
        return out;
      },
      /** Best-effort UTF-8 decode of a token's bytes. */
      decode: function (id) {
        var name = specialById.get(id);
        if (name !== undefined) return name;
        var b = byRank[id];
        return b === undefined ? "" : utf8Decode(this.latin1ToBytes(b));
      }
    };
  }

  /* ---------------------------------------------------------------- UTF-8 */
  function utf8Encode(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else
        out.push(
          0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)
        );
    }
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    var s = "";
    var i = 0;
    while (i < bytes.length) {
      var b0 = bytes[i++];
      var cp;
      if (b0 < 0x80) cp = b0;
      else if (b0 < 0xe0) cp = ((b0 & 0x1f) << 6) | (bytes[i++] & 63);
      else if (b0 < 0xf0)
        cp = ((b0 & 0x0f) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else
        cp =
          ((b0 & 0x07) << 18) |
          ((bytes[i++] & 63) << 12) |
          ((bytes[i++] & 63) << 6) |
          (bytes[i++] & 63);
      if (cp > 0xffff) {
        cp -= 0x10000;
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      } else s += String.fromCharCode(cp);
    }
    return s;
  }

  /** Does this byte string decode to valid UTF-8 on its own? */
  function utf8Complete(bytes) {
    var i = 0;
    while (i < bytes.length) {
      var b0 = bytes[i++];
      var need;
      if (b0 < 0x80) need = 0;
      else if (b0 >= 0xc2 && b0 < 0xe0) need = 1;
      else if (b0 >= 0xe0 && b0 < 0xf0) need = 2;
      else if (b0 >= 0xf0 && b0 < 0xf5) need = 3;
      else return false;
      if (i + need > bytes.length) return false;
      for (var k = 0; k < need; k++) {
        if ((bytes[i + k] & 0xc0) !== 0x80) return false;
      }
      i += need;
    }
    return true;
  }

  var cache = {};

  function get(name) {
    if (cache[name]) return cache[name];
    var spec = global.TOKDATA && global.TOKDATA[name];
    if (!spec) throw new Error("vocabulary " + name + " is not loaded");
    cache[name] = buildVocab(spec);
    return cache[name];
  }

  function isLoaded(name) {
    return !!(global.TOKDATA && global.TOKDATA[name]);
  }

  function loaded() {
    return Object.keys((global.TOKDATA || {}));
  }

  global.Vocab = {
    get: get,
    isLoaded: isLoaded,
    loaded: loaded,
    build: buildVocab,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    utf8Complete: utf8Complete
  };
})(typeof window !== "undefined" ? window : globalThis);