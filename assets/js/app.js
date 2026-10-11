/* =============================================================================
 * app.js — wiring: state, navigation, lazy vocabulary loading, the inspector.
 * ========================================================================== */
(function (global) {
  "use strict";

  var D = global.DOM;
  var el = D.el;
  var Vocab = global.Vocab;
  var T = global.Tokenizer;
  var Anim = global.Anim;
  var Stages = global.Stages;
  var Panels = global.Panels;
  var Content = global.Content;
  var MS = global.ModelSim;

  var $ = D.$;

  var state = {
    encId: "cl100k_base",
    text: "Tokenizers are the unsung heroes of large language models.",
    depth: "plain",
    speed: 1,
    byteRuler: true,
    stage: 0,
    tab: null,          // null = pipeline, otherwise a panel id
    playing: false,
    replyTokens: 0
  };

  var vocab = null;
  var result = null;
  var stats = null;
  var tl = null;
  var stageDone = Promise.resolve();
  var textListeners = [];
  var replyCache = null;

  /* -------------------------------------------------------------- helpers */
  function encMeta(id) {
    return Content.ENCODINGS.filter(function (e) { return e.id === id; })[0];
  }

  function recompute() {
    if (!vocab) return;
    result = T.encode(vocab, state.text, { trace: true });
    stats = T.stats(state.text);
    replyCache = null;
  }

  /** Simulated reply length for this prompt — generated once, then cached. */
  function replyFor() {
    if (replyCache) return replyCache;
    if (!result || !result.ids.length) return (replyCache = { ids: [], steps: [] });
    try {
      replyCache = MS.generate(vocab, result.ids, { temperature: 0.8, topP: 0.92, length: 8 });
    } catch (e) {
      replyCache = { ids: [], steps: [] };
    }
    return replyCache;
  }

  /* ------------------------------------------------------- tokenize cost */
  function costFor(n, model, isOutput) {
    var rate = isOutput ? model.out : model.in;
    return (n / 1e6) * (rate || 0);
  }

  /* ------------------------------------------------------------ ctx/hooks */
  var ctx = {
    get vocab() { return vocab; },
    get result() { return result; },
    get stats() { return stats; },
    get text() { return state.text; },
    get speed() { return state.speed; },
    get depth() { return state.depth; },
    get byteRuler() { return state.byteRuler; },
    get tl() { return tl; },
    get encId() { return state.encId; },
    get replyTokens() { return replyFor().ids.length; },
    get reply() { return replyFor(); },
    cost: costFor,
    cheapestModel: function () {
      var candidates = Content.MODELS.filter(function (m) { return m.enc === state.encId && m.in > 0; });
      candidates.sort(function (a, b) { return a.in - b.in; });
      return candidates[0] || Content.MODELS[0];
    },
    inspectToken: function (idOrIndex) {
      var id = typeof idOrIndex === "number" && result && result.tokens[idOrIndex]
        ? result.tokens[idOrIndex].id : idOrIndex;
      showTokenInspector(id);
    },
    inspectChunk: function (i) {
      var c = result.chunks[i];
      if (!c) return;
      var body = el("div", { class: "stack" });
      body.appendChild(el("div", { class: "tokenBig", text: visible(c.pre) || "∅" }));
      body.appendChild(el("dl", { class: "kv" }, [
        el("dt", { text: "Character range" }), el("dd", { text: c.preStart + " … " + (c.preStart + c.pre.length) }),
        el("dt", { text: "Bytes" }), el("dd", { text: Array.from(c.bytes || []).map(function (b) { return "0x" + D.hex2(b); }).join(" ") }),
        el("dt", { text: "Rule" }), el("dd", { text: c.alt >= 0 ? "rule " + (c.alt + 1) : "special token" })
      ]));
      if (c.alt >= 0) {
        var info = global.Pretok.altInfo(vocab.pattern, c.alt);
        body.appendChild(el("div", { class: "callout" }, [
          el("span", { class: "callout__icon", text: "◆" }),
          el("div", {}, [
            el("div", { html: "<b>" + D.esc(info.why) + "</b>" }),
            el("div", { class: "mono", style: { marginTop: "6px", fontSize: "12px", color: "var(--mint)" }, text: info.re })
          ])
        ]));
      }
      if (c.merges && c.merges.length) {
        var log = el("div", { class: "mergeLog" });
        c.merges.forEach(function (m) {
          log.appendChild(el("span", { class: "mergeLog__step",
            html: "<i>" + D.esc(visible(m.left) || "·") + "</i> + <i>" + D.esc(visible(m.right) || "·") +
                  " → <b>" + D.esc(visible(m.merged)) + "</b> <i>rank " + m.rank + "</i>" }));
        });
        body.appendChild(el("div", {}, [
          el("div", { class: "subhead", text: c.merges.length + " merges" }),
          log
        ]));
      }
      body.appendChild(el("div", { class: "subhead", text: "Resulting tokens" }));
      var chips = el("div", { class: "chips" });
      (c.tokens || []).forEach(function (t) {
        chips.appendChild(el("span", { class: "chip tok-cyan", style: { pointerEvents: "none" } }, [
          el("span", { class: "chip__text", text: visible(t.text) }),
          el("span", { class: "chip__id", text: String(t.id) })
        ]));
      });
      body.appendChild(chips);
      openDrawer("Pre-token " + (i + 1), body);
    },
    loadEncoding: function (id) { loadEncoding(id, function () { renderPanel(state.tab); }); },
    setTab: function (id) { setTab(id); },
    onText: function (fn) { textListeners.push(fn); }
  };

  function visible(s) {
    if (s === "") return "∅";
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      out += c === "\n" ? "\\n" : c === "\t" ? "\\t" : c === "\r" ? "\\r" : c;
    }
    return out;
  }

  /* ------------------------------------------------------------- drawer */
  function openDrawer(title, node) {
    $("#drawerTitle").textContent = title;
    var body = $("#drawerBody");
    D.clear(body);
    body.appendChild(node);
    var drawer = $("#drawer");
    drawer.hidden = false;
    document.body.style.overflow = "hidden";
    var closeBtn = drawer.querySelector("[data-close-drawer]");
    if (closeBtn) closeBtn.focus();
  }
  function closeDrawer() {
    $("#drawer").hidden = true;
    document.body.style.overflow = "";
  }

  function showTokenInspector(id) {
    var name = vocab.specialById.get(id);
    var bytes = name === undefined ? vocab.latin1ToBytes(vocab.byRank[id]) : null;
    var text = vocab.decode(id);
    var body = el("div", { class: "stack" });

    body.appendChild(el("div", { class: "tokenBig", text: visible(text) }));

    var dl = el("dl", { class: "kv" });
    function row(k, v) { dl.appendChild(el("dt", { text: k })); dl.appendChild(el("dd", { text: v })); }
    row("token id", String(id));
    if (name !== undefined) {
      row("kind", "special token");
      row("reserved for", "control signalling, never produced by BPE");
    } else {
      row("kind", "mergeable");
      row("rank", "rank " + id + (id < 256 ? " (a raw byte)" : " (learned merge)"));
      row("byte count", String(bytes.length));
      row("bytes", D.bytes(bytes));
      if (!Vocab.utf8Complete(bytes)) {
        row("note", "part of a multi-byte character");
      }
    }
    body.appendChild(dl);

    if (bytes && !Vocab.utf8Complete(bytes)) {
      body.appendChild(el("div", { class: "callout" }, [
        el("span", { class: "callout__icon", text: "◆" }),
        el("div", { html:
          "This token's bytes do <strong>not</strong> form a whole character on their own. " +
          "Detokenisation concatenates the <em>bytes</em> of consecutive tokens first and decodes " +
          "once at the end, which is why the neighbouring token completes this one." })
      ]));
    }

    if (bytes) {
      var tiles = el("div", { class: "bytes" });
      Array.from(bytes).forEach(function (b) {
        tiles.appendChild(el("div", { class: "byte" + (bytes.length > 1 ? " byte--wide" : "") }, [
          el("span", { class: "byte__glyph", text: D.byteGlyph(b) }),
          el("span", { class: "byte__hex", text: D.hex2(b) }),
          el("span", { class: "byte__bin", text: D.bin8(b) })
        ]));
      });
      body.appendChild(el("div", {}, [
        el("div", { class: "subhead", text: "Bytes" }), tiles
      ]));
    }

    // where does it sit in the vocabulary?
    var frac = id / Math.max(vocab.nVocab - 1, 1);
    var band = el("div", { class: "vocabBand", style: { height: "54px" } });
    var cursor = el("div", { class: "vocabBand__cursor is-past", style: { left: frac * 100 + "%" }, "data-id": "#" + id });
    band.appendChild(cursor);
    body.appendChild(el("div", {}, [
      el("div", { class: "subhead", text: "Position in the " + D.fmtInt(vocab.nVocab) + "-entry vocabulary" }),
      band,
      el("p", { class: "rail__hint", style: { textAlign: "left" },
        text: "Lower ids were merged earlier, which means they were more common in the training data. " +
              "Common words and punctuation live at the front; rare fragments live at the back." })
    ]));

    // how is it used in the current input?
    var occ = (result ? result.tokens : []).filter(function (t) { return t.id === id; });
    if (occ.length) {
      body.appendChild(el("div", {}, [
        el("div", { class: "subhead", text: "Occurs " + occ.length + "× in your current text" }),
        el("div", { class: "chips" }, occ.slice(0, 30).map(function (t) {
          return el("span", { class: "chip tok-cyan", style: { pointerEvents: "none" } }, [
            el("span", { class: "chip__text", text: visible(t.text) }),
            el("span", { class: "chip__id", text: "#" + t.index })
          ]);
        }))
      ]));
    }

    // neighbours
    var around = [];
    for (var k = Math.max(0, id - 3); k <= Math.min(vocab.nVocab - 1, id + 3); k++) {
      around.push(el("button", {
        class: "vocabCell " + (k === id ? "tok-amber" : "tok-cyan"),
        type: "button", onclick: function () { showTokenInspector(k); }
      }, [el("span", { text: visible(vocab.decode(k)) || "∅" }), el("small", { text: String(k) })]));
    }
    body.appendChild(el("div", {}, [
      el("div", { class: "subhead", text: "Neighbours in the table" }),
      el("div", { class: "vocabGrid" }, around)
    ]));

    var actions = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, [
      el("button", {
        class: "btn btn--sm", type: "button", text: "Copy id",
        onclick: function () {
          var s = String(id);
          if (navigator.clipboard) navigator.clipboard.writeText(s);
          toast("Copied " + s);
        }
      }),
      el("button", {
        class: "btn btn--sm", type: "button", text: "Copy token text",
        onclick: function () {
          if (navigator.clipboard) navigator.clipboard.writeText(text);
          toast("Copied token text");
        }
      })
    ]);
    body.appendChild(actions);
    openDrawer("Token " + id, body);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1900);
  }

  /* --------------------------------------------------------------- rail */
  function buildRail() {
    var host = D.clear($("#railScroll"));
    Stages.forEach(function (s, i) {
      host.appendChild(el("button", {
        class: "railItem" + (state.tab === null && state.stage === i ? " is-active" : "") +
               (state.tab === null && state.stage > i ? " is-done" : ""),
        type: "button",
        role: "tab",
        "aria-selected": state.tab === null && state.stage === i ? "true" : "false",
        onclick: function () { state.tab = null; goto(i); }
      }, [
        el("span", { class: "railItem__bar" }),
        el("span", { class: "railItem__num", text: String(i + 1) }),
        el("span", { class: "railItem__body" }, [
          el("span", { class: "railItem__title", text: s.title }),
          el("span", { class: "railItem__sub", text: s.sub })
        ])
      ]));
    });
  }

  /* ------------------------------------------------------- stage render */
  async function renderStage() {
    var stage = Stages[state.stage];
    var host = D.clear($("#stage"));
    tl = new Anim.Timeline();

    $("#stageStep").textContent = "Stage " + (state.stage + 1) + " of " + Stages.length;
    $("#stageTitle").textContent = stage.title;
    $("#stageLede").textContent = state.depth === "deep" && stage.ledeDeep ? stage.ledeDeep : stage.lede;
    $("#replayBtn").hidden = false;
    $("#prevStage").disabled = state.stage === 0;
    $("#nextStage").disabled = state.stage === Stages.length - 1;
    $("#nextStage").querySelector(".btn__label").textContent =
      state.stage === Stages.length - 1 ? "Done" : "Next";
    updateProgress();

    var localCtx = Object.assign({}, ctx, { tl: tl });
    try {
      stageDone = stage.render(host, localCtx);
      await stageDone;
    } catch (err) {
      if (err && err.name !== "AbortError") {
        host.appendChild(el("div", { class: "callout callout--warn" }, [
          el("span", { class: "callout__icon", text: "⚠" }),
          el("div", { text: "This stage could not render: " + err.message })
        ]));
      }
    }
  }

  function updateProgress() {
    $("#railProgress").style.width =
      (state.tab === null ? ((state.stage + 1) / Stages.length) * 100 : 0) + "%";
  }

  function goto(i) {
    state.stage = Math.max(0, Math.min(Stages.length - 1, i));
    state.tab = null;
    buildRail();
    var view = $("#stage-view");
    if (view) view.scrollTop = 0;
    var active = $("#railScroll .railItem.is-active");
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
    renderStage();
  }

  function setTab(id) {
    state.tab = id;
    buildRail();
    renderPanel(id);
    updateProgress();
  }

  function renderPanel(tab) {
    if (tl) tl.cancel();
    Anim.clearAll();
    var host = D.clear($("#stage"));
    textListeners.length = 0;
    $("#stageStep").textContent = "Reference";
    $("#stageTitle").textContent = (Panels.TABS.filter(function (t) { return t.id === tab; })[0] || {}).label || "";
    $("#stageLede").textContent = "";
    $("#replayBtn").hidden = true;
    $("#prevStage").disabled = true;
    $("#nextStage").disabled = true;
    tl = new Anim.Timeline();
    Panels.render(ctx, host, tab || Panels.TABS[0].id);
  }

  /* -------------------------------------------------------- composer UI */
  function autoGrow(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 168) + "px";
  }

  function updateLive() {
    var host = D.clear($("#liveStats"));
    if (!vocab || !stats) return;
    var n = result ? result.ids.length : 0;
    function pill(label, value, cls) {
      return el("span", { class: "metaPill " + (cls || "") }, [
        el("strong", { text: String(value) }), " " + label
      ]);
    }
    host.appendChild(pill("characters", D.fmtInt(stats.chars)));
    host.appendChild(pill("bytes", D.fmtInt(stats.bytes)));
    host.appendChild(pill("words", D.fmtInt(stats.words)));
    host.appendChild(pill("tokens", D.fmtInt(n), "metaPill--tokens"));
    var dens = stats.words ? (n / stats.words).toFixed(2) : "—";
    host.appendChild(pill("tokens / word", dens));
    var m = ctx.cheapestModel();
    if (m.in) host.appendChild(pill("prompt price", "$" + costFor(n, m).toFixed(6)));
  }

  var onInput = D.debounce(function () {
    state.text = $("#inputText").value;
    autoGrow($("#inputText"));
    recompute();
    updateLive();
    textListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
    if (state.tab === "compare" || state.tab === "models") renderPanel(state.tab);
    else if (state.tab === null) renderStage();
  }, 180);

  /* ------------------------------------------------------- lazy loading */
  var LOADING = {};
  function loadEncoding(id, done) {
    if (Vocab.isLoaded(id)) { done && done(); return Promise.resolve(); }
    if (LOADING[id]) return LOADING[id];
    toast("Loading " + encMeta(id).label + "…");
    LOADING[id] = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "assets/js/data/" + id + ".js";
      s.onload = function () { delete LOADING[id]; resolve(); };
      s.onerror = function () {
        delete LOADING[id];
        toast("Could not load " + id);
        resolve();
      };
      document.head.appendChild(s);
    });
    return LOADING[id];
  }

  function buildEncSelect() {
    var sel = D.clear($("#encSelect"));
    Content.ENCODINGS.forEach(function (e) {
      sel.appendChild(el("option", { value: e.id, text: e.label }));
    });
    sel.value = state.encId;
    sel.addEventListener("change", function () {
      var id = sel.value;
      loadEncoding(id).then(function () {
        state.encId = id;
        vocab = Vocab.get(id);
        recompute();
        updateLive();
        buildEncSelect();
        if (state.tab) renderPanel(state.tab);
        else renderStage();
        toast("Switched to " + encMeta(id).label);
      });
    });
  }

  function buildSamples() {
    var host = D.clear($("#samples"));
    Content.SAMPLES.forEach(function (s) {
      host.appendChild(el("button", {
        class: "sample", type: "button", text: s.label,
        title: s.text,
        onclick: function () {
          $("#inputText").value = s.text;
          onInput();
        }
      }));
    });
  }

  /* ------------------------------------------------------------ playback */
  async function playJourney() {
    if (state.playing) {
      state.playing = false;
      $("#playBtn").querySelector(".btn__label").textContent = "Play the journey";
      return;
    }
    state.playing = true;
    var btnLabel = $("#playBtn").querySelector(".btn__label");
    btnLabel.textContent = "Stop";

    for (var i = 0; i < Stages.length; i++) {
      if (!state.playing) break;
      if (state.tab !== null) { state.tab = null; buildRail(); }
      goto(i);
      // eslint-disable-next-line no-await-in-loop
      await stageDone;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(function (r) { setTimeout(r, 800 / state.speed); });
    }
    state.playing = false;
    btnLabel.textContent = "Play the journey";
  }

  /* ---------------------------------------------------------- background */
  function startBackground() {
    var cvs = $("#bgCanvas");
    var ctx2 = null;
    try { ctx2 = cvs.getContext("2d"); } catch (e) { ctx2 = null; }
    if (!ctx2) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var parts = [];
    var running = true;

    function resize() {
      cvs.width = Math.floor(innerWidth * dpr);
      cvs.height = Math.floor(innerHeight * dpr);
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    addEventListener("resize", resize);

    for (var i = 0; i < 46; i++) {
      parts.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.00018,
        vy: -0.00008 - Math.random() * 0.00022,
        r: 0.6 + Math.random() * 2.1,
        a: 0.12 + Math.random() * 0.4
      });
    }

    var glyphs = ["{", "}", "[", "]", "#", "·", "/", "\\", "▁", "▏"];
    function frame() {
      if (!running) return;
      var w = innerWidth, h = innerHeight;
      ctx2.clearRect(0, 0, w, h);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
        if (p.x < -0.05) p.x = 1.05;
        if (p.x > 1.05) p.x = -0.05;
        ctx2.beginPath();
        ctx2.arc(p.x * w, p.y * h, p.r, 0, 6.2832);
        ctx2.fillStyle = "rgba(120,200,255," + p.a + ")";
        ctx2.fill();
      }
      if (!Anim.reduced() && Math.random() < 0.02) {
        var g = glyphs[Math.floor(Math.random() * glyphs.length)];
        var gx = Math.random() * w, gy = Math.random() * h;
        ctx2.font = (11 + Math.random() * 12).toFixed(0) + "px ui-monospace, monospace";
        ctx2.fillStyle = "rgba(150,200,255,.10)";
        ctx2.fillText(g, gx, gy);
      }
      requestAnimationFrame(frame);
    }
    if (!Anim.reduced()) frame();
    document.addEventListener("visibilitychange", function () {
      running = !document.hidden;
      if (running && !Anim.reduced()) { running = false; frame(); }
    });
  }

  /* -------------------------------------------------------------- themes */
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("tokenlab.theme"); } catch (e) {}
    var prefersLight = matchMedia && matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.dataset.theme = saved || (prefersLight ? "light" : "dark");
  }

  /* ------------------------------------------------------------ shortcuts */
  function initKeys() {
    addEventListener("keydown", function (e) {
      if (e.target.matches("input, textarea, select")) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      if (e.key === "ArrowRight" && state.tab === null) { e.preventDefault(); goto(state.stage + 1); }
      if (e.key === "ArrowLeft" && state.tab === null) { e.preventDefault(); goto(state.stage - 1); }
      if (e.key === "Escape") closeDrawer();
      if (e.key === " ") { e.preventDefault(); $("#inputText").focus(); }
    });
  }

  /* ------------------------------------------------------------- bootstrap */
  function init() {
    initTheme();

    vocab = Vocab.get(state.encId);
    $("#inputText").value = state.text;
    recompute();

    buildEncSelect();
    buildSamples();
    buildRail();
    autoGrow($("#inputText"));
    updateLive();
    renderStage();
    startBackground();
    initKeys();

    $("#inputText").addEventListener("input", onInput);
    $("#inputText").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); goto(0); }
    });
    $("#clearBtn").addEventListener("click", function () {
      $("#inputText").value = "";
      onInput();
      $("#inputText").focus();
    });

    $("#nextStage").addEventListener("click", function () {
      if (state.stage < Stages.length - 1) goto(state.stage + 1);
    });
    $("#prevStage").addEventListener("click", function () {
      if (state.stage > 0) goto(state.stage - 1);
    });
    $("#replayBtn").addEventListener("click", function () {
      if (state.tab) return;
      renderStage();
    });
    $("#playBtn").addEventListener("click", playJourney);
    $("#helpBtn").addEventListener("click", function () { setTab("glossary"); });

    D.$$("[data-close-drawer]").forEach(function (n) {
      n.addEventListener("click", closeDrawer);
    });

    D.$$(".segmented__btn").forEach(function (b) {
      b.addEventListener("click", function () {
        D.$$(".segmented__btn").forEach(function (x) { x.classList.remove("is-active"); });
        b.classList.add("is-active");
        state.depth = b.dataset.depth;
        if (state.tab) renderPanel(state.tab);
        else renderStage();
      });
    });

    D.$$(".speed__btn").forEach(function (b) {
      b.addEventListener("click", function () {
        D.$$(".speed__btn").forEach(function (x) { x.classList.remove("is-active"); });
        b.classList.add("is-active");
        state.speed = parseFloat(b.dataset.speed);
        if (state.tab) renderPanel(state.tab);
        else renderStage();
      });
    });

    var rulerToggle = $("#showBytesToggle");
    rulerToggle.checked = state.byteRuler;
    rulerToggle.addEventListener("change", function () {
      state.byteRuler = this.checked;
      if (state.tab === null) renderStage();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.TokenLab = { state: state, ctx: ctx, goto: goto, setTab: setTab };
})(typeof window !== "undefined" ? window : globalThis);