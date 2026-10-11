/* =============================================================================
 * dom.js — small helpers, no framework.
 * ========================================================================== */
(function (global) {
  "use strict";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.slice(0, 2) === "on" && typeof v === "function")
          node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "data") Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        node.appendChild(typeof c === "string" || typeof c === "number"
          ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Escape for safe innerHTML interpolation. */
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Visible glyph for a token: newlines and tabs get a readable stand-in. */
  function display(s) {
    if (s === "\n") return "\\n";
    if (s === "\r") return "\\r";
    if (s === "\t") return "\\t";
    return s;
  }

  function fmtInt(n) {
    return n.toLocaleString("en-US");
  }

  function hex2(b) {
    return b.toString(16).padStart(2, "0");
  }

  function bin8(b) {
    return b.toString(2).padStart(8, "0");
  }

  /** Visible stand-in for a byte that is not printable ASCII. */
  function bytes(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push("0x" + hex2(list[i]));
    return out.join(" ");
  }

  function byteGlyph(b) {
    if (b === 32) return "␣";
    if (b === 10) return "␊";
    if (b === 13) return "␍";
    if (b === 9) return "␉";
    if (b >= 33 && b <= 126) return String.fromCharCode(b);
    if (b === 0) return "␀";
    return "·";
  }

  function charGlyph(ch) {
    if (ch === "\n") return "\\n";
    if (ch === "\r") return "\\r";
    if (ch === "\t") return "\\t";
    if (ch === " ") return "␣";
    return ch;
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments,
        self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  global.DOM = {
    el: el,
    $: $,
    $$: $$,
    clear: clear,
    esc: esc,
    display: display,
    fmtInt: fmtInt,
    hex2: hex2,
    bin8: bin8,
    bytes: bytes,
    byteGlyph: byteGlyph,
    charGlyph: charGlyph,
    debounce: debounce
  };
})(typeof window !== "undefined" ? window : globalThis);