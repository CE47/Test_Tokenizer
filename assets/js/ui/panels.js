/* =============================================================================
 * panels.js — the non-pipeline tabs:
 *   Explorer · Compare · Quiz · Glossary · Models
 * ========================================================================== */
(function (global) {
  "use strict";

  var D = global.DOM;
  var el = D.el;
  var T = global.Tokenizer;
  var Vocab = global.Vocab;
  var Content = global.Content;

  function statCard(label, value, sub, accent) {
    return el("div", { class: "stat" + (accent ? " stat--accent" : "") }, [
      el("div", { class: "stat__label", text: label }),
      el("div", { class: "stat__value", text: value }),
      sub ? el("div", { class: "stat__sub", text: sub }) : null
    ]);
  }

  function visible(s) {
    if (s === "") return "∅";
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      out += c === "\n" ? "\\n" : c === "\t" ? "\\t" : c === "\r" ? "\\r" : c;
    }
    return out;
  }

  function tabs(items, current, onPick) {
    return el("div", { class: "tabs", role: "tablist" }, items.map(function (t) {
      return el("button", {
        class: "tab" + (t.id === current ? " is-active" : ""),
        type: "button", role: "tab",
        "aria-selected": t.id === current ? "true" : "false",
        text: t.label,
        onclick: function () { onPick(t.id); }
      });
    }));
  }

  function heading(text, sub) {
    return el("div", { style: { marginBottom: "16px" } }, [
      el("h2", { style: { fontSize: "21px", letterSpacing: "-.02em" }, text: text }),
      sub ? el("p", { class: "viewhead__lede", style: { fontSize: "14px" }, text: sub }) : null
    ]);
  }

  /* ====================================================== Explorer ======= */
  function explorer(ctx, host, tab) {
    var vocab = ctx.vocab;
    var search = el("input", {
      class: "input", type: "search", placeholder: "Search all " + D.fmtInt(vocab.nVocab) + " tokens — try “ ing”, “🐍”, “ Tokyo”…",
      "aria-label": "Search the vocabulary"
    });
    var limit = el("select", { class: "select", "aria-label": "Result cap" });
    [500, 2000, 10000, 50000].forEach(function (n) {
      limit.appendChild(el("option", { value: String(n), text: D.fmtInt(n) + " results" }));
    });
    limit.value = "2000";

    var out = el("div");
    var status = el("p", { class: "rail__hint", style: { textAlign: "left" } });

    var haystack = null; // built lazily

    function buildHaystack() {
      if (haystack) return haystack;
      haystack = [];
      var latin = [];
      for (var id = 0; id < vocab.nMergeable; id++) {
        var b = vocab.byRank[id];
        if (b === undefined) continue;
        var s = Vocab.utf8Decode(vocab.latin1ToBytes(b));
        latin.push({ id: id, text: s, lower: s.toLowerCase(), len: b.length });
      }
      latin.sort(function (a, b2) { return a.lower < b2.lower ? -1 : a.lower > b2.lower ? 1 : 0; });
      haystack = latin;
      return latin;
    }

    function render() {
      var q = search.value.trim();
      D.clear(out);
      var t0 = performance.now();
      var results;
      if (!q) {
        results = buildHaystack().slice(0, Number(limit.value));
      } else {
        var lq = q.toLowerCase();
        results = [];
        for (var i = 0; i < haystack.length && results.length < Number(limit.value); i++) {
          if (haystack[i].lower.indexOf(lq) >= 0) results.push(haystack[i]);
        }
      }
      var ms = (performance.now() - t0).toFixed(0);
      status.textContent = D.fmtInt(results.length) + " token" + (results.length === 1 ? "" : "s") +
        (q ? " containing " + JSON.stringify(q) : "") + " · " + ms + "ms";

      if (!results.length) {
        out.appendChild(el("p", { class: "rail__hint", text: "No token contains that. Try a shorter fragment." }));
        return;
      }

      var grid = el("div", { class: "vocabGrid" });
      var frag = el("div", { class: "vocabGrid", style: { maxHeight: "none" } });
      results.slice(0, Number(limit.value)).forEach(function (r, i) {
        grid.appendChild(el("button", {
          class: "vocabCell " + ["", "tok-cyan", "tok-violet", "tok-mint", "tok-amber", "tok-coral"][i % 6],
          type: "button",
          title: "id " + r.id + " · " + r.len + " byte" + (r.len > 1 ? "s" : "") + " — click for details",
          onclick: function () { ctx.inspectToken(r.id); }
        }, [
          el("span", { text: visible(r.text) }),
          el("small", { text: String(r.id) })
        ]));
      });
      out.appendChild(grid);
    }

    search.addEventListener("input", D.debounce(render, 220));
    limit.addEventListener("change", render);

    host.appendChild(el("div", { class: "stack" }, [
      heading("Vocabulary explorer",
        "This is the real merge table shipped with the tokenizer — every entry below " +
        "corresponds to one row the model owns. Search it to see what has been learned " +
        "as a single unit of text."),
      el("div", { class: "explorer__search" }, [search, limit]),
      status,
      out
    ]));
    render();
  }

  /* ====================================================== Compare ======= */
  function compare(ctx, host, tab) {
    var body = el("div", { class: "stack" });

    function refresh() {
      D.clear(body);
      var text = ctx.text;
      var rows = [];
      var anyLoaded = false;
      Content.ENCODINGS.forEach(function (e) {
        if (!Vocab.isLoaded(e.id)) return;
        anyLoaded = true;
        var v = Vocab.get(e.id);
        var ids = T.encode(v, text).ids;
        rows.push({ enc: e, vocab: v, ids: ids, s: T.stats(text) });
      });

      var table = el("table", { class: "data" }, [
        el("thead", {}, [el("tr", {}, [
          el("th", { text: "Tokenizer" }),
          el("th", { text: "Used by" }),
          el("th", { class: "num", text: "Tokens" }),
          el("th", { class: "num", text: "Tokens / word" }),
          el("th", { class: "num", text: "Bytes / token" }),
          el("th", { text: "Preview" })
        ])])
      ]);
      var tb = el("tbody");
      rows.forEach(function (r) {
        tb.appendChild(el("tr", { class: r.enc.id === ctx.encId ? "is-current" : "" }, [
          el("td", { html: "<b class='mono'>" + D.esc(r.enc.label) + "</b>" }),
          el("td", { text: r.enc.note }),
          el("td", { class: "num", text: D.fmtInt(r.ids.length) }),
          el("td", { class: "num", text: r.s.words ? (r.ids.length / r.s.words).toFixed(2) : "—" }),
          el("td", { class: "num", text: (r.s.bytes / Math.max(r.ids.length, 1)).toFixed(2) }),
          el("td", { class: "mono", style: { maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis" },
            text: r.ids.slice(0, 14).join(" ") + (r.ids.length > 14 ? " …" : "") })
        ]));
      });
      table.appendChild(tb);

      var bodyText = [
        el("div", { class: "stats" }, rows.map(function (r, i) {
          return statCard(r.enc.label, D.fmtInt(r.ids.length), r.enc.note, i === 0);
        })),
        el("div", { class: "tableWrap" }, [table]),
        el("p", { class: "rail__hint", style: { textAlign: "left" },
          text: "Same text, different vocabularies, different price. Newer encodings were trained " +
                "on more multilingual data, so non-English text is usually much cheaper on them." })
      ];

      if (!anyLoaded) bodyText.unshift(el("p", { class: "rail__hint", text: "Loading vocabularies…" }));

      var missing = Content.ENCODINGS.filter(function (e) { return !Vocab.isLoaded(e.id); });
      if (missing.length) {
        bodyText.push(el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          missing.map(function (e) {
            return el("button", {
              class: "btn btn--ghost btn--sm", type: "button",
              text: "Load " + e.label + " (" + D.fmtInt(e.vocab) + " tokens)",
              onclick: function () { ctx.loadEncoding(e.id); }
            });
          })));
      }
      body.appendChild(el("div", { class: "stack" }, bodyText));
    }

    host.appendChild(el("div", { class: "stack" }, [
      heading("Same words, different tokenizers",
        "A tokenizer is not a universal standard. Each model family ships its own, and " +
        "the number you are billed depends entirely on which one the model uses."),
      body
    ]));
    ctx.onText(refresh);
    refresh();
  }

  /* ========================================================= Quiz ======== */
  var QUIZ_ROUNDS = [
    { text: "hello world", opts: [1, 2, 3, 4] },
    { text: "Hello world", opts: [2, 3, 4, 5] },
    { text: "indivisible", opts: [2, 3, 4, 5] },
    { text: "1234567890", opts: [2, 3, 4, 10] },
    { text: "supercalifragilisticexpialidocious", opts: [6, 8, 11, 13] },
    { text: "antidisestablishmentarianism", opts: [4, 6, 8, 9] },
    { text: "don't", opts: [1, 2, 3, 4] },
    { text: "🚀", opts: [1, 2, 3, 4] },
    { text: "https://example.com", opts: [4, 5, 6, 7] },
    { text: "   ", opts: [1, 2, 3, 4] },
    { text: "THIS IS SHOUTING", opts: [2, 3, 4, 5] },
    { text: "你好，世界", opts: [4, 6, 8, 10] }
  ];

  function quiz(ctx, host, tab) {
    var score = 0, round = 0, streak = 0;
    var body = el("div", { class: "stack" });

    function nextRound() {
      D.clear(body);
      if (round >= QUIZ_ROUNDS.length) {
        body.appendChild(el("div", { class: "stack" }, [
          el("div", { class: "scoreBadge", text: "Final score: " + score + " / " + QUIZ_ROUNDS.length }),
          el("p", { class: "viewhead__lede", style: { fontSize: "14px" },
            text: "The pattern behind most surprises: a leading space costs a whole extra token, " +
                  "shouting costs more than speaking, numbers are chunked in threes, and a rare " +
                  "word shatters into fragments the model has to reassemble." }),
          el("button", { class: "btn btn--primary", type: "button", text: "Play again", onclick: function () { score = 0; round = 0; streak = 0; nextRound(); } })
        ]));
        return;
      }
      var q = QUIZ_ROUNDS[round];
      var truth = T.encode(ctx.vocab, q.text).ids.length;
      // Whatever tokenizer is active, make sure the truth is on the board.
      var options = q.opts.slice();
      if (options.indexOf(truth) < 0) {
        options = [];
        for (var o = truth - 1; o <= truth + 1; o++) if (o >= 1 && o !== truth + 2) options.push(o);
        if (options.indexOf(truth) < 0) options.push(truth);
        options = options.filter(function (x) { return x >= 1; }).slice(0, 4);
        if (options.indexOf(truth) < 0) options[0] = truth;
      }
      var prompt = el("div", { class: "quizPrompt", text: visible(q.text) });
      var feedback = el("p", { class: "viewhead__lede", style: { fontSize: "14px" } });
      var buttons = el("div", { class: "quizOptions" });
      var answered = false;

      options.slice().sort(function () { return Math.random() - 0.5; }).forEach(function (opt) {
        buttons.appendChild(el("button", {
          class: "quizOpt", type: "button", text: String(opt),
          onclick: function () {
            if (answered) return;
            answered = true;
            var right = opt === truth;
            if (right) { score++; streak++; } else { streak = 0; }
            Array.prototype.forEach.call(buttons.children, function (b) {
              b.disabled = true;
              if (Number(b.textContent) === truth) b.classList.add("is-right");
            });
            var chosen = Array.prototype.find.call(buttons.children, function (b) { return b.textContent === String(opt); });
            if (!right && chosen) chosen.classList.add("is-wrong");
            feedback.innerHTML = right
              ? "<b style='color:var(--mint)'>Correct.</b> " + D.esc(explain(q, truth))
              : "<b style='color:var(--coral)'>Not quite.</b> " + D.esc(explain(q, truth));
            nextBtn.disabled = false;
            round++;
          }
        }));
      });

      var nextBtn = el("button", {
        class: "btn btn--primary", type: "button", disabled: true,
        text: round === QUIZ_ROUNDS.length - 1 ? "Finish" : "Next question",
        onclick: function () { nextRound(); }
      });

      body.appendChild(el("div", { class: "stack" }, [
        el("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } }, [
          el("span", { class: "tag", text: "Question " + (round + 1) + " of " + QUIZ_ROUNDS.length }),
          el("span", { class: "scoreBadge", text: score + " correct" }),
          streak >= 3 ? el("span", { class: "tag", text: "🔥 " + streak + " in a row" }) : null
        ]),
        el("p", { class: "viewhead__lede", style: { fontSize: "14px" }, text: "How many tokens is this?" }),
        prompt,
        buttons,
        feedback,
        el("div", {}, [nextBtn])
      ]));
    }

    function explain(q, truth) {
      var enc = T.encode(ctx.vocab, q.text, { trace: false });
      return q.text + " is " + truth + " token" + (truth === 1 ? "" : "s") + ": [" +
        enc.ids.join(", ") + "]" +
        (truth === 1 ? " — the whole thing is one row in the table." : " — it does not fit in a single row.");
    }

    host.appendChild(el("div", { class: "stack" }, [
      heading("Guess the token count",
        "Ten-second intuition check. Most people's first guess is off by a factor of two " +
        "in one direction or the other."),
      body
    ]));
    nextRound();
  }

  /* ===================================================== Glossary ======= */
  function glossary(ctx, host, tab, opts) {
    var list = el("div", { class: "panel" });
    Content.GLOSSARY.forEach(function (g) {
      list.appendChild(el("div", { class: "glossItem" }, [
        el("div", { class: "glossItem__term", text: g.term }),
        el("div", { class: "glossItem__short", text: g.short }),
        el("div", { class: "glossItem__long", text: g.long })
      ]));
    });
    host.appendChild(el("div", { class: "stack" }, [
      heading("Glossary", "Every term this app uses, in one place."),
      list,
      el("div", { class: "panel" }, [
        el("div", { class: "subhead", text: "How this app was verified" }),
        el("ul", { style: { margin: "0", paddingLeft: "18px", fontSize: "13.5px", color: "var(--text-dim)", lineHeight: "1.8" } }, [
          el("li", { text: "The four vocabularies are the exact files tiktoken downloads; their sha256 digests match OpenAI's published hashes." }),
          el("li", { text: "The byte-pair merge loop is a line-for-line port of tiktoken's Rust implementation, fuzz-checked against an independently written naive BPE." }),
          el("li", { text: "The pre-tokenisation regexes are OpenAI's published patterns, with possessive quantifiers emulated exactly; they are fuzz-checked against a backtracking regex engine with true possessive semantics." }),
          el("li", { text: "Test vectors are generated by a pure-Python reference implementation and must match in JavaScript, character for character." })
        ])
      ])
    ]));
  }

  /* ======================================================= Models ======= */
  function models(ctx, host, tab) {
    var body = el("div", { class: "tableWrap" });
    var table = el("table", { class: "data" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", { text: "Model" }), el("th", { text: "Tokenizer" }),
        el("th", { class: "num", text: "Context" }),
        el("th", { class: "num", text: "$ / 1M in" }),
        el("th", { class: "num", text: "$ / 1M out" }),
        el("th", { class: "num", text: "Your prompt" })
      ])])
    ]);
    var tb = el("tbody");
    Content.MODELS.forEach(function (m) {
      tb.appendChild(el("tr", { class: m.enc === ctx.encId ? "is-current" : "" }, [
        el("td", { text: m.name }),
        el("td", { class: "mono", text: m.enc }),
        el("td", { class: "num", text: D.fmtInt(m.ctx) }),
        el("td", { class: "num", text: m.in ? "$" + m.in.toFixed(2) : "—" }),
        el("td", { class: "num", text: m.out ? "$" + m.out.toFixed(2) : "—" }),
        el("td", { class: "num", text: "$" + ctx.cost(ctx.result.ids.length, m).toFixed(6) })
      ]));
    });
    table.appendChild(tb);
    body.appendChild(table);
    host.appendChild(el("div", { class: "stack" }, [
      heading("Which tokenizer am I actually paying for?",
        "Your prompt is tokenised with whichever encoding the chosen model uses. " +
        "The same words can cost very different amounts across model families."),
      body,
      el("p", { class: "rail__hint", style: { textAlign: "left" },
        text: "Prices are an indicative snapshot in US dollars per 1M tokens and change often — " +
              "always confirm against your provider's current price sheet." })
    ]));
  }

  var TABS = [
    { id: "explore", label: "Vocabulary", render: explorer },
    { id: "compare", label: "Compare", render: compare },
    { id: "quiz", label: "Quiz", render: quiz },
    { id: "models", label: "Models & cost", render: models },
    { id: "glossary", label: "Glossary", render: glossary }
  ];

  global.Panels = {
    TABS: TABS,
    render: function (ctx, host, tab) {
      var def = TABS.filter(function (t) { return t.id === tab; })[0] || TABS[0];
      host.appendChild(tabs(TABS, def.id, ctx.setTab));
      var body = el("div", { id: "panelBody" });
      host.appendChild(body);
      def.render(ctx, body, tab);
      return body;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);