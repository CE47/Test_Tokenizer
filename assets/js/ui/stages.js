/* =============================================================================
 * stages.js — the eight animated stages of the journey.
 *
 * Each stage is an async function: it builds the DOM synchronously (so nothing
 * pops in late), then awaits tweens/pauses to play the animation. Re-rendering
 * cancels the previous Timeline, which makes every pending await resolve at once.
 * ========================================================================== */
(function (global) {
  "use strict";

  var D = global.DOM;
  var el = D.el;
  var Anim = global.Anim;
  var Vocab = global.Vocab;
  var T = global.Tokenizer;
  var Pretok = global.Pretok;
  var MS = global.ModelSim;

  var MAX_CHARS_ANIM = 30;
  var MAX_TOKENS_ANIM = 220;
  var PALETTE = ["tok-cyan", "tok-violet", "tok-mint", "tok-amber", "tok-coral", "tok-sky"];

  /* ------------------------------------------------------------- helpers */
  function stack(nodes, gap) {
    var s = el("div", { class: "stack", style: gap ? { gap: gap } : null });
    (nodes || []).forEach(function (n) { if (n) s.appendChild(n); });
    return s;
  }

  function statCard(label, value, sub, accent) {
    return el("div", { class: "stat" + (accent ? " stat--accent" : "") }, [
      el("div", { class: "stat__label", text: label }),
      el("div", { class: "stat__value", text: value }),
      sub ? el("div", { class: "stat__sub", text: sub }) : null
    ]);
  }

  function callout(html, kind) {
    return el("div", { class: "callout" + (kind ? " callout--" + kind : "") }, [
      el("span", { class: "callout__icon", text: kind === "warn" ? "⚠" : "◆", "aria-hidden": "true" }),
      el("div", { html: html })
    ]);
  }

  function visible(s) {
    if (s === "") return "";
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      out += c === "\n" ? "\\n" : c === "\t" ? "\\t" : c === "\r" ? "\\r" : c;
    }
    return out;
  }

  function bytesOf(s) { return Vocab.utf8Encode(s); }

  function byteTile(b, opts) {
    opts = opts || {};
    return el("div", {
      class: "byte" + (opts.wide ? " byte--wide" : "") + (opts.special ? " byte--special" : ""),
      title: "byte 0x" + D.hex2(b)
    }, [
      el("span", { class: "byte__glyph", text: D.byteGlyph(b) }),
      el("span", { class: "byte__hex", text: D.hex2(b) }),
      el("span", { class: "byte__bin", text: D.bin8(b) })
    ]);
  }

  function pieceNode(text, kind, rank, showRank) {
    return el("div", { class: "piece" + (kind ? " is-" + kind : "") }, [
      showRank ? el("span", { class: "piece__rank", text: "#" + rank }) : null,
      el("span", { class: "piece__txt", text: visible(text) }),
      el("span", { class: "piece__meta", text: rank === undefined ? "" : "r" + rank })
    ]);
  }

  function colourAt(i) { return PALETTE[i % PALETTE.length]; }

  function vocabBytesOf(vocab, id) {
    if (vocab.specialById.get(id) !== undefined) return [];
    var b = vocab.byRank[id];
    return b === undefined ? [] : Array.from(vocab.latin1ToBytes(b));
  }

  /* =====================================================================
   * 1 — your text
   * =================================================================== */
  var stageText = {
    id: "text",
    title: "You typed something",
    sub: "The last thing a model ever sees",
    lede:
      "This is the only step of the journey with any resemblance to writing. " +
      "A language model never receives it — by the time the model is involved, " +
      "these glyphs are already gone.",
    ledeDeep:
      "In a browser this string is UTF-16: one JavaScript character is one 16-bit " +
      "code unit, so an emoji like 🚀 is two of them. That is a language quirk, not " +
      "a tokenizer quirk — but it is a good reminder that “character” means at least " +
      "three different things depending on who is asking.",
    render: async function (host, ctx) {
      var s = ctx.stats;
      var chars = Array.from(ctx.text);
      var shown = chars.slice(0, MAX_CHARS_ANIM);

      var grid = el("div", { class: "bytes", style: { gap: "6px" } });
      var tiles = shown.map(function (ch, i) {
        var node = el("div", {
          class: "byte",
          style: { "--c": "var(--" + ["cyan", "violet", "mint", "amber", "coral", "sky"][i % 6] + ")" }
        }, [
          el("span", { class: "byte__glyph", text: D.charGlyph(ch), style: { fontSize: "18px" } }),
          el("span", {
            class: "byte__hex",
            text: "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")
          })
        ]);
        grid.appendChild(node);
        return node;
      });

      var banner = el("div", { class: "outText", style: { opacity: "0" } });

      host.appendChild(stack([
        el("div", { class: "stats" }, [
          statCard("Characters", D.fmtInt(s.chars), "UTF-16 code units"),
          statCard("Code points", D.fmtInt(s.codePoints),
            s.codePoints !== s.chars ? s.chars - s.codePoints + " fewer" : "same as characters"),
          statCard("UTF-8 bytes", D.fmtInt(s.bytes), "what BPE sees", true),
          statCard("Words", D.fmtInt(s.words), "a rough human count")
        ]),
        el("div", { class: "subhead", text: "Every character, one tile" }),
        grid,
        chars.length > shown.length
          ? callout("Showing the first " + shown.length + " of " + D.fmtInt(chars.length) + " characters so the animation stays quick.")
          : null,
        ctx.depth === "deep" && s.chars !== s.codePoints
          ? callout("<strong>" + (s.chars - s.codePoints) + "</strong> extra UTF-16 code unit(s) come from characters outside the Basic Multilingual Plane.")
          : null,
        el("div", { class: "subhead", text: "What the model will actually receive" }),
        banner
      ]));

      for (var i = 0; i < tiles.length; i++) {
        var node = tiles[i];
        node.style.opacity = "0";
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.tween({
          from: 0, to: 1, duration: 300 / ctx.speed, delay: (i * 26) / ctx.speed, ease: "outBack",
          onUpdate: function (v) {
            node.style.opacity = String(v);
            node.style.transform = "translateY(" + 14 * (1 - v) + "px) scale(" + (0.8 + 0.2 * v) + ")";
          }
        });
      }

      await ctx.tl.wait(120 / ctx.speed);
      banner.style.transition = "opacity .6s var(--ease)";
      banner.style.opacity = "1";
      banner.innerHTML = "<span style='opacity:.4'>…</span>";
      await ctx.tl.wait(620 / ctx.speed);
      banner.innerHTML =
        "<span style='opacity:.45'>token ids</span><br>" +
        "<b class='mono'>[" + ctx.result.ids.slice(0, 12).join(", ") +
        (ctx.result.ids.length > 12 ? ", … " + (ctx.result.ids.length - 12) + " more" : "") + "]</b>";
    }
  };

  /* =====================================================================
   * 2 — bytes
   * =================================================================== */
  var stageBytes = {
    id: "bytes",
    title: "Every character shatters into bytes",
    sub: "UTF-8 — the only alphabet BPE knows",
    lede:
      "Before anything else, the text becomes UTF-8 bytes. This is why a tokenizer " +
      "can never choke on unknown input: all 256 possible byte values are in the " +
      "vocabulary as tokens of their own, so any string on earth is representable.",
    ledeDeep:
      "UTF-8 is self-synchronising on purpose. A leading byte announces how many " +
      "bytes follow (110xxxxx = 2, 1110xxxx = 3, 11110xxx = 4) and every continuation " +
      "byte starts with 10xxxxxx. So a token boundary can fall in the middle of a " +
      "character and the byte stream still decodes correctly on the other side — " +
      "which is exactly why BPE is allowed to merge arbitrary byte sequences.",
    render: async function (host, ctx) {
      var s = ctx.stats;
      var chars = Array.from(ctx.text);
      var shown = chars.slice(0, 12);

      var rows = el("div", { class: "stack" });
      var rowTiles = [];
      var wideExample = null;

      shown.forEach(function (ch) {
        var b = bytesOf(ch);
        if (b.length > 1 && !wideExample) wideExample = ch;
        var byteRow = el("div", { class: "bytes", style: { gap: "4px" } });
        var tiles = [];
        for (var i = 0; i < b.length; i++) {
          var t = byteTile(b[i], { wide: b.length > 1 });
          byteRow.appendChild(t);
          tiles.push(t);
        }
        rows.appendChild(el("div", { class: "mergeRow" }, [
          el("div", { class: "mergeRow__head" }, [
            el("span", { class: "mergeRow__pre", text: "'" + D.charGlyph(ch) + "'" }),
            el("span", { class: "tag", text: "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0") }),
            el("span", {
              class: "mergeRow__rule",
              text: b.length === 1 ? "one byte — plain ASCII" : b.length + " bytes — a multi-byte character"
            })
          ]),
          byteRow
        ]));
        rowTiles.push(tiles);
      });

      var deepPanel = null;
      if (ctx.depth === "deep" && wideExample) {
        var wb = bytesOf(wideExample);
        var dts = [], dds = [];
        wb.forEach(function (x, i) {
          var bin = D.bin8(x);
          var lead = 0;
          while (lead < 8 && bin[lead] === "1") lead++;
          dts.push(el("dt", { text: i === 0 ? "leading byte · " + lead + " bytes total" : "continuation byte · 10xxxxxx" }));
          dds.push(el("dd", { text: D.hex2(x) + "   " + bin }));
        });
        deepPanel = el("div", { class: "panel" }, [
          el("div", { class: "subhead", text: "Why '" + D.charGlyph(wideExample) + "' needs " + wb.length + " bytes" }),
          el("dl", { class: "kv" }, dts.concat(dds))
        ]);
      }

      host.appendChild(stack([
        el("div", { class: "stats" }, [
          statCard("UTF-8 bytes", D.fmtInt(s.bytes), "BPE's alphabet is all 256 of these", true),
          statCard("Characters", D.fmtInt(s.chars), "what you typed"),
          statCard("Bytes / character", s.chars ? (s.bytes / s.chars).toFixed(2) : "—", "for this text")
        ]),
        chars.length > shown.length
          ? callout("Showing the first " + shown.length + " of " + D.fmtInt(chars.length) + " characters so the animation stays quick.")
          : null,
        rows,
        deepPanel
      ]));

      for (var r = 0; r < shown.length; r++) {
        for (var t2 = 0; t2 < rowTiles[r].length; t2++) {
          (function (tile) {
            tile.style.opacity = "0";
            ctx.tl.tween({
              from: 0, to: 1, duration: 260 / ctx.speed, ease: "outBack",
              onUpdate: function (v) {
                tile.style.opacity = String(v);
                tile.style.transform = "translateY(" + 10 * (1 - v) + "px)";
              }
            });
          })(rowTiles[r][t2]);
        }
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.wait(rowTiles[r].length * 95 / ctx.speed + 90);
      }
    }
  };

  /* =====================================================================
   * 3 — pre-tokenisation
   * =================================================================== */
  var stagePre = {
    id: "pretok",
    title: "A regex cuts it into blocks",
    sub: "Pre-tokens — where BPE is allowed to merge",
    lede:
      "BPE never merges across arbitrary boundaries — otherwise it would happily " +
      "glue the end of one word to the start of the next. A regex carves the text " +
      "into pre-tokens first, and BPE runs only inside each one. That single choice " +
      "is why a leading space changes the token count.",
    ledeDeep:
      "The rules below are OpenAI's published pattern for this tokenizer, taken " +
      "from tiktoken. They are tried top to bottom and the first that matches wins, " +
      "which is why the contraction rule fires before the word rule and “don” and " +
      "“’t” end up as separate blocks. Some rules use possessive quantifiers, which " +
      "is what stops a letter from being re-used as the next block's prefix.",
    render: async function (host, ctx) {
      var chunks = ctx.result.chunks;
      var rules = Pretok.HUMAN[ctx.vocab.pattern];
      var byAlt = {};
      chunks.forEach(function (c) { if (c.alt >= 0) byAlt[c.alt] = (byAlt[c.alt] || 0) + 1; });
      var used = Object.keys(byAlt).map(Number).sort(function (a, b) { return a - b; });

      var beam = el("div", {
        style: {
          height: "2px", width: "0%", marginBottom: "10px", borderRadius: "2px",
          background: "linear-gradient(90deg, transparent, var(--amber), transparent)"
        }
      });
      var chipRow = el("div", { class: "chips" });
      var chipNodes = chunks.map(function (c, i) {
        var chip = el("button", {
          class: "chip " + (c.alt < 0 ? "tok-coral" : PALETTE[c.alt % PALETTE.length]) + (c.special ? " chip--special" : ""),
          type: "button",
          title: "pre-token " + (i + 1) + (c.alt >= 0 ? " — " + rules[c.alt].why : " — special token"),
          onclick: function () { ctx.inspectChunk(i); }
        }, [
          el("span", { class: "chip__text", text: visible(c.pre) || "∅" }),
          el("span", { class: "chip__id", text: c.special ? "special" : "rule " + (c.alt + 1) })
        ]);
        chipRow.appendChild(chip);
        return chip;
      });

      var regexBlock = el("pre", {
        class: "outText",
        style: { fontSize: "12px", lineHeight: "1.8", whiteSpace: "pre-wrap", overflowX: "auto", margin: "0" }
      });
      rules.forEach(function (r, i) {
        var on = used.indexOf(i) >= 0;
        regexBlock.appendChild(el("span", {
          style: on ? { color: "var(--mint)" } : { color: "var(--text-faint)", opacity: ".5" },
          text: (on ? "▶ " : "  ") + r.re + "\n"
        }));
      });
      regexBlock.appendChild(el("span", {
        style: { color: "var(--text-faint)" },
        text: "     green = a rule that actually fired on your text\n     " +
              "the first rule that matches wins, so rules above shadow the ones below"
      }));

      host.appendChild(stack([
        el("div", { class: "stats" }, [
          statCard("Pre-tokens", D.fmtInt(chunks.length), "regex blocks", true),
          statCard("Rules fired", String(used.length), "of " + rules.length + " in the pattern"),
          statCard("Characters", D.fmtInt(ctx.stats.chars), "total input")
        ]),
        beam,
        chipRow,
        el("div", { class: "subhead", text: "The pattern doing the cutting — tap a block for details" }),
        regexBlock,
        used.length ? el("div", { class: "panel" }, [
          el("div", { class: "subhead", text: "Why each rule fired here" })
        ].concat(used.map(function (i2) {
          return el("p", { style: { margin: "0 0 7px", fontSize: "13px" }, html:
            "<b class='mono'>rule " + (i2 + 1) + "</b> — " + D.esc(rules[i2].why) +
            " <span class='tag'>" + byAlt[i2] + "×</span>" });
        }))) : null,
        callout(
          "Compare <span class='inlineCode'>' world</span> with <span class='inlineCode'>world</span>. " +
          "The leading space is <strong>part of the token</strong>. That is deliberate: it lets the " +
          "tokenizer tell one word from the next with no extra marker.",
          "warn"
        )
      ].filter(Boolean)));

      var per = chunks.length > 80 ? 5 : Math.max(20, 460 / Math.max(chunks.length, 1)) / ctx.speed;
      var tweenP = ctx.tl.tween({
        from: 0, to: 100, duration: (chunks.length * per) / ctx.speed, ease: "linear",
        onUpdate: function (v) { beam.style.width = v + "%"; }
      });
      chipNodes.forEach(function (node, i) {
        ctx.tl.tween({
          from: 0, to: 1, duration: 300 / ctx.speed, delay: i * per, ease: "outBack",
          onUpdate: function (v) {
            node.style.opacity = String(v);
            node.style.transform = "translateY(" + 12 * (1 - v) + "px) scale(" + (0.86 + 0.14 * v) + ")";
          }
        });
      });
      await tweenP;
    }
  };

  /* =====================================================================
   * 4 — BPE merges (the centrepiece)
   * =================================================================== */
  var stageMerge = {
    id: "merge",
    title: "Glue the most common pairs",
    sub: "Byte-pair encoding, merge by merge",
    lede:
      "Inside each block, start with one piece per byte. Then repeatedly find the " +
      "adjacent pair whose merge has the lowest rank — lowest rank means it was seen " +
      "most often in the training text — and glue it together. Every step below is a " +
      "real one, taken from the real merge table.",
    ledeDeep:
      "Ranks 0–255 are the raw bytes themselves, in the order this vocabulary lists " +
      "them (which is not ASCII order). From 256 upward each rank is one learned " +
      "merge. The loop keeps an array of (offset, rank) pairs, and after every merge " +
      "it recomputes the ranks of the two neighbouring positions; a pair that is not " +
      "in the table is treated as rank infinity and never merged.",
    render: async function (host, ctx) {
      var chunks = ctx.result.chunks.filter(function (c) { return c.tokens.length > 0; });
      var pick = chunks.slice(0, 5);
      var wrap = el("div", { class: "mergeGrid" });
      var jobs = [];

      // A merge carries latin-1 bytes; decode them for display so multi-byte
      // characters read as characters rather than mojibake.
      function dec(latin) {
        return latin === undefined ? "" : Vocab.utf8Decode(vocab.latin1ToBytes(latin));
      }
      var vocab = ctx.vocab;

      pick.forEach(function (chunk) {
        var piecesEl = el("div", { class: "pieces" });
        var nodes = [];
        if (chunk.special) {
          var sp = pieceNode(chunk.pre, "final", chunk.tokens[0].id, false);
          piecesEl.appendChild(sp);
          nodes.push(sp);
        } else {
          for (var i = 0; i < chunk.bytes.length; i++) {
            var n = pieceNode(D.byteGlyph(chunk.bytes[i]), "raw");
            piecesEl.appendChild(n);
            nodes.push(n);
          }
        }
        var logEl = el("div", { class: "mergeLog" });
        wrap.appendChild(el("div", { class: "mergeRow" }, [
          el("div", { class: "mergeRow__head" }, [
            el("span", { class: "mergeRow__pre", text: visible(chunk.pre) || "∅" }),
            el("span", {
              class: "tag",
              text: chunk.special ? "special" : chunk.bytes.length + " byte" + (chunk.bytes.length > 1 ? "s" : "")
            }),
            el("span", {
              class: "tag",
              text: chunk.special ? "BPE skipped" : (chunk.merges.length ? chunk.merges.length + " merges" : "already one token")
            }),
            el("span", {
              class: "mergeRow__rule",
              text: chunk.special ? "reserved control token" :
                chunk.alt >= 0 ? Pretok.HUMAN[ctx.vocab.pattern][chunk.alt].why : ""
            })
          ]),
          el("div", { class: "mergeRow__body" }, [piecesEl, logEl])
        ]));
        jobs.push({ chunk: chunk, nodes: nodes, piecesEl: piecesEl, logEl: logEl });
      });

      host.appendChild(stack([
        callout(
          "Watch the <strong>rank</strong> badge on each merge. Lower means earlier and more " +
          "common. When no adjacent pair is left in the table the loop stops — whatever " +
          "remains is the final token."
        ),
        wrap,
        chunks.length > pick.length
          ? el("p", { class: "rail__hint", text: "+ " + (chunks.length - pick.length) + " more blocks merged the same way" })
          : null
      ].filter(Boolean)));

      for (var j = 0; j < jobs.length; j++) {
        var job = jobs[j];
        var alive = job.nodes.slice();

        if (job.chunk.special) {
          job.logEl.appendChild(el("span", { class: "mergeLog__step",
            html: "<i>special tokens are reserved ids — byte-pair encoding never runs on them</i>" }));
          alive.forEach(function (n) { n.classList.add("is-final"); });
          // eslint-disable-next-line no-await-in-loop
          await ctx.tl.wait(620 / ctx.speed);
          continue;
        }

        var merges = job.chunk.merges;
        // Adaptive pacing so a five-block overview always settles in a few
        // seconds. Long chains show their first few steps in detail, then
        // cascade through the remainder so the final state is always the truth.
        var MAX_SHOWN = 6;
        var shown = Math.min(merges.length, MAX_SHOWN);
        var stepDur = Math.max(110, Math.min(260, 1100 / Math.max(shown, 1))) / ctx.speed;
        var gapDur = Math.max(14, Math.min(40, 240 / Math.max(shown, 1))) / ctx.speed;
        var insertDur = Math.min(200 / ctx.speed, stepDur * 0.6);

        function applyMerge(m) {
          var left = alive[m.at], right = alive[m.at + 1];
          if (!left || !right) return null;
          var merged = pieceNode(dec(m.merged), "merged", m.rank, true);
          job.piecesEl.insertBefore(merged, left);
          left.remove();
          right.remove();
          alive.splice(m.at, 2, merged);
          return merged;
        }

        function logMerge(m) {
          job.logEl.appendChild(el("span", {
            class: "mergeLog__step",
            html: "<i>" + D.esc(visible(dec(m.left)) || "·") + "</i> + <i>" + D.esc(visible(dec(m.right)) || "·") +
                  " → <b>" + D.esc(visible(dec(m.merged))) + "</b> <i>rank " + m.rank + "</i>"
          }));
          while (job.logEl.children.length > 6) job.logEl.firstChild.remove();
        }

        if (merges.length === 0) {
          job.logEl.appendChild(el("span", { class: "mergeLog__step",
            html: "<i>the whole block is already a single token in the table</i>" }));
          alive.forEach(function (n) { n.classList.add("is-final"); });
          // eslint-disable-next-line no-await-in-loop
          await ctx.tl.wait(560 / ctx.speed);
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.wait(j === 0 ? 40 : 200 / ctx.speed);

        for (var mi = 0; mi < shown; mi++) {
          var m = merges[mi];
          // eslint-disable-next-line no-await-in-loop
          await ctx.tl.tween({
            from: 0, to: 1, duration: stepDur, ease: "inOutCubic",
            onUpdate: function (v, e, t) {
              var pair = [alive[m.at], alive[m.at + 1]];
              pair.forEach(function (n) {
                if (!n) return;
                n.classList.toggle("is-next", t < 0.55);
                n.style.transform = t < 0.55 ? "scale(" + (1 + 0.14 * t) + ")" : "";
              });
            }
          });

          var merged = applyMerge(m);
          if (!merged) break;
          merged.style.opacity = "0";
          // eslint-disable-next-line no-await-in-loop
          await ctx.tl.tween({
            from: 0, to: 1, duration: insertDur, ease: "outBack",
            onUpdate: function (v) {
              merged.style.opacity = String(v);
              merged.style.transform = "scale(" + (0.75 + 0.25 * v) + ")";
            }
          });
          logMerge(m);
          // eslint-disable-next-line no-await-in-loop
          await ctx.tl.wait(gapDur);
        }

        if (merges.length > shown) {
          var rest = merges.length - shown;
          job.logEl.appendChild(el("span", { class: "mergeLog__step", html: "<i>+" + rest + " more merges…</i>" }));
          for (var f = shown; f < merges.length; f++) {
            var cascaded = applyMerge(merges[f]);
            if (cascaded) cascaded.classList.add("is-merged");
            // eslint-disable-next-line no-await-in-loop
            await ctx.tl.wait(45 / ctx.speed);
          }
          job.logEl.appendChild(el("span", {
            class: "mergeLog__step",
            html: "<i>no mergeable pair left — stop</i>"
          }));
          while (job.logEl.children.length > 6) job.logEl.firstChild.remove();
        }

        alive.forEach(function (n) {
          n.classList.add("is-final");
          n.classList.remove("is-next");
        });
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.wait(300 / ctx.speed);
      }
    }
  };

  /* =====================================================================
   * 5 — the token list
   * =================================================================== */
  var stageTokens = {
    id: "tokens",
    title: "The list the model actually receives",
    sub: "Token ids, and what they cost you",
    lede:
      "This is the whole interface between you and the model: a list of integers. " +
      "Nothing about letters, words or meaning survives this point. Everything the " +
      "model knows about language was learned from corpora of lists like this one.",
    ledeDeep:
      "Two consequences worth internalising. The context window is counted in these " +
      "integers, not in characters. And so is money — a phrase that costs 4 characters " +
      "can cost 12 tokens, or 1. That is why whitespace and casing quietly dominate " +
      "your bill.",
    render: async function (host, ctx) {
      var tokens = ctx.result.tokens;
      var chipRow = el("div", { class: "chips" });
      var nodes = tokens.slice(0, MAX_TOKENS_ANIM).map(function (t, i) {
        var n = el("button", {
          class: "chip " + (t.isSpecial ? "tok-coral" : colourAt(i)) + (t.isSpecial ? " chip--special" : ""),
          type: "button",
          onclick: function () { ctx.inspectToken(i); }
        }, [
          el("span", { class: "chip__text", text: visible(t.text) }),
          el("span", { class: "chip__id", text: String(t.id) })
        ]);
        chipRow.appendChild(n);
        return n;
      });

      var ruler = el("div", { class: "ruler" });
      [
        ["character", Array.from(ctx.text).slice(0, 140).map(function (c) { return D.charGlyph(c); })],
        ["byte", Array.from(bytesOf(ctx.text)).slice(0, 140).map(function (b) { return D.hex2(b); })],
        ["token", tokens.map(function (t) { return visible(t.text); }).slice(0, 140)]
      ].forEach(function (r, ri) {
        var cells = el("div", { class: "ruler__cells" });
        r[1].forEach(function (v, i) {
          cells.appendChild(el("div", {
            class: "ruler__cell",
            style: ri === 2 ? { background: "color-mix(in srgb, var(--" +
              ["cyan", "violet", "mint", "amber", "coral", "sky"][i % 6] + ") 18%, var(--surface-3))" } : {},
            text: v
          }));
        });
        ruler.appendChild(el("div", { class: "ruler__row" }, [
          el("div", { class: "ruler__label", text: r[0] }),
          cells
        ]));
      });

      var model = ctx.cheapestModel();
      var ctxLimit = model.ctx;
      var used = tokens.length + ctx.replyTokens;
      var pct = Math.min(100, (used / ctxLimit) * 100);

      host.appendChild(stack([
        el("div", { class: "stats" }, [
          statCard("Tokens", D.fmtInt(tokens.length), "in this prompt", true),
          statCard("Tokens / word", ctx.stats.words ? (tokens.length / ctx.stats.words).toFixed(2) : "—", "density"),
          statCard("Tokens / 1k chars", ctx.stats.chars ? Math.round((tokens.length / ctx.stats.chars) * 1000) : 0, "efficiency"),
          statCard("Special tokens", String(ctx.result.specials.length), "reserved control ids")
        ]),
        el("div", { class: "subhead", text: "Tap any token to inspect it" }),
        chipRow,
        tokens.length > nodes.length
          ? el("p", { class: "rail__hint", text: "+ " + D.fmtInt(tokens.length - nodes.length) + " more tokens not drawn" })
          : null,
        el("div", { class: "subhead", text: "Three rulers over the same text" }),
        ctx.byteRuler
          ? ruler
          : callout("The byte ruler is switched off in the composer. Turn it back on to compare characters, bytes and tokens side by side."),
        el("div", { class: "subhead", text: "What it costs" }),
        el("div", { class: "panel" }, [
          el("dl", { class: "kv" }, [
            el("dt", { text: "Prompt" }), el("dd", { text: D.fmtInt(tokens.length) + " tokens" }),
            el("dt", { text: "Simulated reply" }), el("dd", { text: D.fmtInt(ctx.replyTokens) + " tokens" }),
            el("dt", { text: "Context" }), el("dd", { text: pct.toFixed(4) + "% of " + D.fmtInt(ctxLimit) + " (" + model.name + ")" }),
            el("dt", { text: "Prompt price" }), el("dd", { text: "$" + ctx.cost(tokens.length, model).toFixed(6) }),
            el("dt", { text: "Reply price" }), el("dd", { text: "$" + ctx.cost(ctx.replyTokens, model, true).toFixed(6) })
          ]),
          el("div", { class: "gauge", style: { marginTop: "12px" } }, [
            el("div", { class: "gauge__fill", style: { width: Math.max(pct, 0.7) + "%" } })
          ]),
          el("p", { class: "rail__hint", style: { textAlign: "left", marginTop: "8px" },
            text: "Prices are an indicative snapshot per 1M tokens — check your provider's current price sheet." })
        ])
      ].filter(Boolean)));

      var per = nodes.length > 90 ? 7 : 22;
      for (var i = 0; i < nodes.length; i++) {
        (function (n, idx) {
          n.style.opacity = "0";
          ctx.tl.tween({
            from: 0, to: 1, duration: 260 / ctx.speed, delay: idx * per, ease: "outBack",
            onUpdate: function (v) {
              n.style.opacity = String(v);
              n.style.transform = "translateY(" + 10 * (1 - v) + "px) scale(" + (0.82 + 0.18 * v) + ")";
            }
          });
        })(nodes[i], i);
      }
      await ctx.tl.wait((nodes.length * per + 260) / ctx.speed);
    }
  };

  /* =====================================================================
   * 6 — embeddings
   * =================================================================== */
  var stageEmbed = {
    id: "embed",
    title: "Ids become vectors",
    sub: "A row lookup in a giant learned table",
    lede:
      "A token id is just a row number. The model looks that row up in an embedding " +
      "table — for GPT-4o, around 200,000 rows of 3,072 numbers — and from here on " +
      "nothing human-readable survives. Two tokens that look nothing alike can be " +
      "near neighbours in this space.",
    ledeDeep:
      "These particular vectors are invented — a deterministic function of the token " +
      "id — because the real weights are not public. What is faithful is the " +
      "mechanism: one row per id, a fixed width, and a position signal added before " +
      "the first layer. Real models use rotary embeddings (RoPE), which rotates " +
      "pairs of dimensions by an angle that grows with the position.",
    render: async function (host, ctx) {
      var tokens = ctx.result.tokens.slice(0, 12);
      var DIM = 40;

      var ticks = el("div", { class: "vocabBand__grid" });
      for (var i = 0; i < 10; i++) {
        ticks.appendChild(el("div", { class: "vocabBand__tick" }, [
          el("span", { text: Math.round((ctx.vocab.nVocab / 10) * i).toLocaleString("en-US") })
        ]));
      }
      var cursor = el("div", { class: "vocabBand__cursor", style: { left: "0%" }, "data-id": "—" });
      var band = el("div", { class: "vocabBand" }, [ticks, cursor]);

      var narration = el("p", { class: "viewhead__lede", style: { fontSize: "13.5px", minHeight: "3.2em" } });
      var vecHost = el("div", { class: "panel", style: { minHeight: "116px" } });
      vecHost.appendChild(el("p", { class: "rail__hint", style: { textAlign: "left" }, text: "waiting for the first token…" }));

      host.appendChild(stack([
        el("div", { class: "stats" }, [
          statCard("Vocabulary rows", D.fmtInt(ctx.vocab.nVocab), "mergeable + special", true),
          statCard("Embedding width", "3,072", "floats per row (GPT-4o)"),
          statCard("Table size", (ctx.vocab.nVocab * 3072 * 4 / 1048576).toFixed(0) + " MB", "fp32, one table"),
          statCard("Positions", String(tokens.length), "0 … " + (tokens.length - 1))
        ]),
        el("div", { class: "subhead", text: "The embedding table — watch the cursor jump to each row" }),
        band,
        narration,
        el("div", { class: "subhead", text: "Row contents (schematic)" }),
        vecHost,
        callout(
          "The bar charts are <strong>invented</strong>, not real weights — they are a fixed " +
          "function of the token id so the same text always draws the same picture. Everything " +
          "structural is real: one row per id, a fixed width, and no lookup by meaning.",
          "warn"
        )
      ]));

      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t];
        var frac = tok.isSpecial ? 0.995 : tok.id / (ctx.vocab.nVocab - 1);
        var fromPct = parseFloat(cursor.style.left) || 0;
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.tween({
          from: fromPct, to: frac * 100, duration: 340 / ctx.speed, ease: "inOutCubic",
          onUpdate: function (v) { cursor.style.left = v + "%"; }
        });
        cursor.classList.add("is-past");
        cursor.dataset.id = "#" + tok.id + " · position " + t;
        narration.innerHTML =
          "id <b class='mono'>" + tok.id + "</b> → row " + tok.id.toLocaleString("en-US") +
          " of " + ctx.vocab.nVocab.toLocaleString("en-US") + ", at position " + t +
          (tok.isSpecial ? " — a special token still gets its own row" : "") +
          ". Neighbouring ids tend to be related fragments, which is why " +
          "<span class='inlineCode'>ing</span> and <span class='inlineCode'>thing</span> sit close together.";

        var vec = MS.embedding(tok.id, DIM);
        D.clear(vecHost);
        var bars = el("div", { class: "vectorRow__bars" });
        var peak = 0;
        for (var q = 0; q < DIM; q++) peak = Math.max(peak, Math.abs(vec[q]));
        var bn = [];
        for (var d = 0; d < DIM; d++) {
          var b = el("div", { class: "vbar" + (d % 2 ? " vbar--alt" : "") });
          b.style.height = "2px";
          bars.appendChild(b);
          bn.push(b);
        }
        vecHost.appendChild(el("div", { class: "vectorRow" }, [
          el("div", { class: "vectorRow__name", text: "#" + tok.id }),
          bars
        ]));
        for (var d2 = 0; d2 < DIM; d2++) {
          (function (node, idx) {
            var target = Math.max(2, (Math.abs(vec[idx]) / (peak || 1)) * 30);
            ctx.tl.tween({
              from: 2, to: target, duration: 300, delay: idx * 7, ease: "outCubic",
              onUpdate: function (v) { node.style.height = v + "px"; }
            });
          })(bn[d2], d2);
        }
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.wait(190 / ctx.speed);
      }
    }
  };

  /* =====================================================================
   * 7 — attention
   * =================================================================== */
  var stageAttn = {
    id: "attn",
    title: "Every token looks at the others",
    sub: "Causal attention, stacked many times",
    lede:
      "Each position asks a question and compares it with every position before it, " +
      "then blends their information in proportion to the match. This is how " +
      "information moves between tokens. Crucially it is causal — nothing can look " +
      "to the right, which is what lets the model generate one token at a time.",
    ledeDeep:
      "Scaled dot-product attention: score = q·k / √d, mask everything to the right, " +
      "softmax, then take the weighted sum of the values. Real models stack dozens " +
      "of these blocks (GPT-4o: 96 layers, multiple heads each). The matrix below is " +
      "one head of one layer. Two features visible here are genuinely reproducible " +
      "in real models: a strong attention sink on the very first token, and locality " +
      "— recent tokens attract more attention.",
    render: async function (host, ctx) {
      var tokens = ctx.result.tokens.slice(0, 9);
      var n = tokens.length;
      var ids = tokens.map(function (t) { return t.id; });
      var matrix = MS.attention(ids, 24);

      var grid = el("div", {
        class: "heat__grid",
        style: { gridTemplateColumns: "repeat(" + n + ", minmax(0, 1fr))", maxWidth: n * 38 + "px" }
      });
      var cells = [];
      for (var q = 0; q < n; q++) {
        for (var k = 0; k < n; k++) {
          var c = el("div", { class: "heat__cell" + (k > q ? " is-masked" : "") });
          grid.appendChild(c);
          cells.push(c);
        }
      }

      var legend = el("div", { class: "chips", style: { marginTop: "10px" } });
      tokens.forEach(function (t, i) {
        legend.appendChild(el("span", { class: "chip " + colourAt(i), style: { pointerEvents: "none" } }, [
          el("span", { class: "chip__text", text: visible(t.text) || "∅" }),
          el("span", { class: "chip__id", text: "pos " + i })
        ]));
      });

      var narration = el("p", { class: "viewhead__lede", style: { fontSize: "13.5px", minHeight: "3em" } });
      var towerHost = el("div", { class: "stack" });
      var towers = ["Block 1", "Block 2", "Block 3", "… 93 more", "Block 96"].map(function (label) {
        var fill = el("div", { class: "tower__fill" });
        towerHost.appendChild(el("div", { class: "tower" }, [
          el("span", { class: "tower__label", text: label }),
          el("div", { class: "tower__track" }, [fill]),
          el("span", { class: "tag", text: label === "Block 96" ? "→ logits" : "" })
        ]));
        return fill;
      });

      host.appendChild(stack([
        el("div", { class: "stats" }, [
          statCard("Positions", String(n), "context length in tokens"),
          statCard("Blocks", "96", "GPT-4o layers"),
          statCard("Attention", "causal", "never looks right", true),
          statCard("Attention sink", "position 0", "a real, reproducible effect")
        ]),
        el("div", { class: "subhead", text: "One head, one layer — query (row) × key (column)" }),
        el("div", { style: { overflowX: "auto", paddingBottom: "4px" } }, [grid]),
        legend,
        narration,
        el("div", { class: "subhead", text: "Then it all happens again, 96 times over" }),
        towerHost,
        callout("The numbers are schematic — derived from the real token ids, not from real weights — but the causal mask, the softmax shape, the sink and the locality are genuine.", "warn")
      ]));

      for (var qi = 0; qi < n; qi++) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.wait(qi === 0 ? 40 : 340 / ctx.speed);
        var jobs = [];
        for (var ki = 0; ki < n; ki++) {
          (function (kIdx) {
            var cell = cells[qi * n + kIdx];
            if (kIdx > qi) {
              jobs.push(ctx.tl.tween({
                from: 0, to: 1, duration: 120 / ctx.speed,
                onUpdate: function (v) { cell.style.transform = "scale(" + (0.7 + 0.3 * v) + ")"; }
              }));
              return;
            }
            jobs.push(ctx.tl.tween({
              from: 0, to: matrix[qi][kIdx], duration: 280 / ctx.speed, ease: "outCubic",
              onUpdate: function (v) {
                var hue = 195 - 155 * Math.min(1, v * 1.3);
                var sat = 22 + 68 * Math.min(1, v * 1.6);
                var light = 15 + 50 * Math.min(1, v * 1.2);
                cell.style.backgroundColor = "hsl(" + hue + " " + sat + "% " + light + "%)";
                cell.style.transform = "scale(" + (0.7 + 0.3 * Math.min(1, v * 2)) + ")";
              }
            }));
          })(ki);
        }
        narration.innerHTML = "Row " + qi + " — position <b class='mono'>" +
          D.esc(visible(tokens[qi].text)) + "</b> leans hardest on " +
          MS.strongestTargets(ids, matrix, qi).map(function (t) {
            return "position " + t[0] + " (" + (t[1] * 100).toFixed(0) + "%)";
          }).join(", ") + ".";
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(jobs);
      }

      for (var t2 = 0; t2 < towers.length; t2++) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.tween({
          from: 0, to: 100, duration: 380 / ctx.speed, ease: "outCubic",
          onUpdate: function (v) { towers[t2].style.width = v + "%"; }
        });
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.wait(90 / ctx.speed);
      }
    }
  };

  /* =====================================================================
   * 8 — output
   * =================================================================== */
  var stageOut = {
    id: "output",
    title: "Pick a token. Then pick the next.",
    sub: "Logits, sampling, and the way back to text",
    lede:
      "After the last block, the model scores every token in the vocabulary and picks " +
      "one. That token is appended, the whole sequence runs again, and the loop " +
      "continues until a stop token appears. The reply you read is the concatenation " +
      "of the bytes behind those output ids.",
    ledeDeep:
      "Each score is a logit. Temperature divides them (lower is sharper, higher is " +
      "flatter); softmax turns them into probabilities; top-p keeps the smallest set " +
      "whose cumulative probability exceeds p. Detokenisation then maps every id back " +
      "to bytes and concatenates them — byte-wise, which is why a single emoji can " +
      "be split across two tokens.",
    render: async function (host, ctx) {
      var gen = MS.generate(ctx.vocab, ctx.result.ids, { temperature: 0.8, topP: 0.92, length: 8 });
      var reply = T.decode(ctx.vocab, gen.ids);

      var stepsHost = el("div", { class: "stack" });
      var outText = el("div", { class: "outText" });

      var replyInput = el("textarea", {
        class: "composer__input",
        rows: "2",
        style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "9px 11px", background: "var(--surface-2)" },
        placeholder: "…or paste a real API reply and see how it tokenises",
        id: "replyBox"
      });
      var replyHolder = el("div", { class: "stack" });
      replyInput.addEventListener("input", D.debounce(function () {
        D.clear(replyHolder);
        var v = replyInput.value;
        if (!v.trim()) return;
        var r = T.encode(ctx.vocab, v, { trace: false });
        var chips = el("div", { class: "chips" });
        r.tokens.slice(0, 90).forEach(function (t, i) {
          chips.appendChild(el("span", { class: "chip " + colourAt(i), style: { pointerEvents: "none" } }, [
            el("span", { class: "chip__text", text: visible(t.text) }),
            el("span", { class: "chip__id", text: String(t.id) })
          ]));
        });
        replyHolder.appendChild(el("div", { class: "stats" }, [
          statCard("Reply tokens", D.fmtInt(r.ids.length), "the output side of your bill", true),
          statCard("Reply characters", D.fmtInt(v.length), "not what you are billed"),
          statCard("Round trip", T.decode(ctx.vocab, r.ids) === v ? "exact" : "lossy",
            "decode(encode(x)) === x")
        ]));
        replyHolder.appendChild(chips);
      }, 220));

      host.appendChild(stack([
        callout(
          "<strong>What is real here and what is not.</strong> The vocabulary, the candidate " +
          "set, the softmax, the top-p cut, the sampling and the detokenisation are all real " +
          "algorithms applied to this real tokenizer. The weights behind those scores are not — " +
          "they are a frequency-shaped stand-in built from the merge ranks. A real model needs " +
          "its 200 billion-plus parameters.",
          "warn"
        ),
        el("div", { class: "subhead", text: "The generation loop" }),
        stepsHost,
        el("div", { class: "subhead", text: "The reply, reassembled from token ids" }),
        outText,
        el("p", { class: "rail__hint", style: { textAlign: "left" },
          text: "output ids: [" + gen.ids.join(", ") + "]  ·  " + gen.ids.length +
                " tokens → " + reply.length + " characters" }),
        el("div", { class: "subhead", text: "Now try a real one" }),
        el("div", { class: "panel" }, [
          el("label", { class: "field__label", for: "replyBox", text: "Paste a genuine API reply" }),
          replyInput,
          replyHolder
        ])
      ]));

      var pickedSoFar = [];
      for (var si = 0; si < gen.steps.length; si++) {
        var st = gen.steps[si];
        var step = el("div", { class: "sampleStep" });
        var barsHost = el("div", { class: "bars" });
        var pickIdx = st.ids.indexOf(st.picked);
        var bars = st.ids.map(function (id, i) {
          var fill = el("div", { class: "bar__fill" });
          var pctNode = el("span", { class: "bar__pct", text: "0%" });
          var bytesHere = id === undefined ? [] : (vocabBytesOf(ctx.vocab, id));
          var row = el("div", { class: "bar" + (i === pickIdx ? " is-picked" : "") }, [
            el("span", {
              class: "bar__label",
              text: visible(ctx.vocab.decode(id)) || "∅",
              title: "id " + id + (bytesHere.length ? " · " + D.bytes(bytesHere) : "")
            }),
            el("div", { class: "bar__track" }, [fill]),
            pctNode
          ]);
          barsHost.appendChild(row);
          return { fill: fill, pct: pctNode, row: row, p: st.probs[i], id: id };
        });
        step.appendChild(el("div", { class: "sampleStep__head" }, [
          el("b", { text: "step " + (si + 1) }),
          el("span", { text: "context " + st.contextSize + " tokens" }),
          el("span", { text: "temperature " + st.temperature.toFixed(2) }),
          el("span", { text: "top-p " + st.topP.toFixed(2) })
        ]));
        step.appendChild(barsHost);
        stepsHost.appendChild(step);

        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.wait(si === 0 ? 0 : 260 / ctx.speed);

        var jobs = bars.map(function (b, i) {
          return ctx.tl.tween({
            from: 0, to: b.p * 100, duration: 360 / ctx.speed, delay: i * 45 / ctx.speed, ease: "outCubic",
            onUpdate: function (v) {
              b.fill.style.width = v + "%";
              b.pct.textContent = v.toFixed(1) + "%";
            }
          });
        });
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(jobs);

        if (pickIdx >= 0) {
          bars.forEach(function (b, i) { if (i !== pickIdx) b.row.classList.add("is-cut"); });
        }

        // The reply is the concatenation of the output tokens' BYTES, so decode
        // the whole run every step rather than each token on its own — a
        // character split across two tokens only comes back intact this way.
        pickedSoFar.push(st.picked);
        D.clear(outText);
        outText.appendChild(el("span", { style: { color: "var(--mint)" }, text: T.decode(ctx.vocab, pickedSoFar) }));
        // eslint-disable-next-line no-await-in-loop
        await ctx.tl.wait(150 / ctx.speed);
      }

      outText.appendChild(el("span", {
        style: { color: "var(--text-faint)", fontSize: "12px" },
        text: "   ← " + gen.ids.length + " tokens, " + reply.length + " characters"
      }));
      await ctx.tl.wait(400 / ctx.speed);
    }
  };

  global.Stages = [
    stageText, stageBytes, stagePre, stageMerge, stageTokens, stageEmbed, stageAttn, stageOut
  ];
})(typeof window !== "undefined" ? window : globalThis);