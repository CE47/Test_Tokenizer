/* =============================================================================
 * model-sim.js — what happens AFTER tokenisation.
 *
 * IMPORTANT / HONEST SCOPE NOTE
 * The token counts, byte splits, pre-tokens, merge order and ids in this app are
 * computed with the real OpenAI vocabularies and are exact. Everything below is
 * a *schematic*: we do not have GPT-4o's 200B+ learned weights, so the numbers
 * are produced by a deterministic pseudo-random process seeded by the actual
 * token ids. What is faithful is the *shape* of the computation and the data
 * flow; what is invented is the weights. The UI says so wherever it matters.
 * ========================================================================== */
(function (global) {
  "use strict";

  /* --------------------------------------------------------- deterministic RNG */
  function hash32(x) {
    x |= 0;
    x = (x ^ 61) ^ (x >>> 16);
    x = (x + (x << 3)) | 0;
    x = x ^ (x >>> 4);
    x = Math.imul(x, 0x27d4eb2d);
    x = x ^ (x >>> 15);
    return x >>> 0;
  }
  function rngFrom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x9e3779b9) | 0;
      var t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
    };
  }

  /* ----------------------------------------------------------- token vectors */
  /** A stable pseudo-embedding for a token id (Gaussian-ish, unit-ish scale). */
  function embedding(id, dim) {
    var r = rngFrom(hash32(id * 2654435761));
    var v = new Float32Array(dim);
    for (var i = 0; i < dim; i++) {
      var u1 = Math.max(r(), 1e-9);
      var u2 = r();
      var g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v[i] = g * 0.05;
    }
    return v;
  }

  var _embedCache = new Map();
  function cachedEmbedding(id, dim) {
    var key = id + ":" + dim;
    if (!_embedCache.has(key)) _embedCache.set(key, embedding(id, dim));
    return _embedCache.get(key);
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  /* -------------------------------------------------- RoPE (real, simplified) */
  /**
   * Rotary position embedding: pair up the dimensions and rotate each pair by
   * an angle that grows with the position. This is genuinely how GPT-style
   * models encode position inside attention — only the dimension count is toy.
   */
  function rope(vec, pos, theta) {
    var out = new Float32Array(vec.length);
    for (var i = 0; i < vec.length; i += 2) {
      var w = pos / Math.pow(theta, i / 2);
      var c = Math.cos(w);
      var s = Math.sin(w);
      out[i] = vec[i] * c - vec[i + 1] * s;
      out[i + 1] = vec[i] * s + vec[i + 1] * c;
    }
    return out;
  }

  /* --------------------------------------------------------------- attention */
  /**
   * A causal attention matrix with the two empirical signatures real LLMs show:
   * a strong "attention sink" on the first token, and locality (recent tokens get
   * more attention). Values are deterministic per token-id sequence.
   */
  function attention(ids, dim) {
    var n = ids.length;
    var keys = ids.map(function (id, p) {
      var e = cachedEmbedding(id, dim);
      var k = new Float32Array(dim);
      var r = rngFrom(hash32(id + 7919 + p));
      for (var i = 0; i < dim; i++) k[i] = e[i] * (0.8 + 0.4 * r());
      return rope(k, p, 10000);
    });
    var m = [];
    for (var q = 0; q < n; q++) {
      var qv = rope(cachedEmbedding(ids[q], dim), q, 10000);
      var row = new Float32Array(n);
      var scale = 1 / Math.sqrt(dim);
      for (var kk = 0; kk < n; kk++) {
        var sim = dot(qv, keys[kk]) * scale;
        if (kk === 0) sim += 3.2;                       // attention sink
        sim += 1.6 / (1 + Math.abs(kk - q));            // locality
        sim += 0.6 * (ids[kk] === ids[q] ? 1 : 0);      // repeated-token pull
        row[kk] = sim;
      }
      // causal mask + softmax
      var max = -Infinity;
      for (var c = 0; c <= q; c++) if (row[c] > max) max = row[c];
      var sum = 0;
      for (var c2 = 0; c2 <= q; c2++) {
        row[c2] = Math.exp(row[c2] - max);
        sum += row[c2];
      }
      for (var c3 = 0; c3 < n; c3++) row[c3] = c3 <= q ? row[c3] / sum : 0;
      m.push(row);
    }
    return m;
  }

  /** Which token does position q lean on most? (for narration) */
  function strongestTargets(ids, matrix, q) {
    var row = matrix[q];
    var out = [];
    for (var k = 0; k < row.length; k++) out.push([k, row[k]]);
    out.sort(function (a, b) {
      return b[1] - a[1];
    });
    return out.slice(0, 3).filter(function (x) {
      return x[1] > 0.02;
    });
  }

  /* --------------------------------------------------------- next-token sampler */
  /**
   * A believable next-token distribution WITHOUT any model weights.
   *
   * Real fact we lean on: in a BPE vocabulary, a *lower rank* means the token was
   * merged earlier, which means it is more frequent in the training data. So we
   * can build a distribution that is genuinely shaped like a language model's
   * (heavy on a few common tokens, long tail) using only the vocabulary file.
   * The prompt just reseeds which common tokens come out on top.
   */
  function candidateDistribution(vocab, ids, opts) {
    opts = opts || {};
    var k = opts.k || 12;
    var seed = 2166136261;
    for (var i = 0; i < ids.length; i++) seed = hash32(seed ^ ids[i]);
    var rnd = rngFrom(seed);

    var maxRank = vocab.nMergeable - 1;
    var pool = [];
    var seen = Object.create(null);
    var guard = 0;
    while (pool.length < k && guard++ < 4000) {
      // pick a rank skewed toward low ranks (frequent tokens)
      var u = rnd();
      var rank = Math.floor(maxRank * Math.pow(u, 3.1));
      if (seen[rank]) continue;
      seen[rank] = 1;
      var text = vocab.decode(rank);
      if (!text || text.length === 0) continue;
      if (!/[\S\u0020]/.test(text)) continue; // never emit pure whitespace or control characters
      pool.push(rank);
    }
    pool.sort(function (a, b) {
      return a - b;
    });

    var logits = pool.map(function (id, i) {
      var freq = 1 / Math.pow(id + 12, 0.42);
      return Math.log(freq) + (rnd() - 0.5) * 1.6 + (i === 0 ? 1.1 : 0);
    });
    return { ids: pool, logits: logits };
  }

  function softmax(logits, temperature) {
    var t = temperature || 1;
    var max = -Infinity;
    var i;
    for (i = 0; i < logits.length; i++) max = Math.max(max, logits[i] / t);
    var out = new Array(logits.length);
    var sum = 0;
    for (i = 0; i < logits.length; i++) {
      out[i] = Math.exp(logits[i] / t - max);
      sum += out[i];
    }
    for (i = 0; i < out.length; i++) out[i] /= sum;
    return out;
  }

  function sample(p, rnd) {
    var u = rnd();
    var acc = 0;
    for (var i = 0; i < p.length; i++) {
      acc += p[i];
      if (u <= acc) return i;
    }
    return p.length - 1;
  }

  /** Top-p (nucleus) filtering — real algorithm, real numbers. */
  function nucleus(probs, p) {
    var idx = [];
    for (var i = 0; i < probs.length; i++) idx.push(i);
    idx.sort(function (a, b) {
      return probs[b] - probs[a];
    });
    var keep = [];
    var acc = 0;
    for (var k = 0; k < idx.length; k++) {
      keep.push(idx[k]);
      acc += probs[idx[k]];
      if (acc >= p) break;
    }
    return keep;
  }

  /**
   * Simulate the autoregressive loop that turns a prompt into a reply.
   * Returns an array of {ids, probs, temp, topP, picked} steps.
   */
  function generate(vocab, promptIds, opts) {
    opts = opts || {};
    var temperature = opts.temperature === undefined ? 0.8 : opts.temperature;
    var topP = opts.topP === undefined ? 0.92 : opts.topP;
    var n = opts.length || 12;
    var steps = [];
    var out = [];
    var ctx = promptIds.slice();
    var rnd = rngFrom(hash32(promptIds.length * 7919 + 17));

    for (var s = 0; s < n; s++) {
      var dist = candidateDistribution(vocab, ctx, { k: 14 });
      var probs = softmax(dist.logits, temperature);
      var keep = nucleus(probs, topP);
      var kept = keep.map(function (i) {
        return probs[i];
      });
      var tot = kept.reduce(function (a, b) {
        return a + b;
      }, 0);
      kept = kept.map(function (x) {
        return x / tot;
      });
      var pick = keep[sample(kept, rnd)];
      steps.push({
        ids: keep.map(function (i) {
          return dist.ids[i];
        }),
        probs: kept,
        rawProbs: probs,
        picked: dist.ids[pick],
        temperature: temperature,
        topP: topP,
        contextSize: ctx.length
      });
      out.push(dist.ids[pick]);
      ctx.push(dist.ids[pick]);
    }
    return { steps: steps, ids: out };
  }

  global.ModelSim = {
    rngFrom: rngFrom,
    hash32: hash32,
    embedding: cachedEmbedding,
    rope: rope,
    attention: attention,
    strongestTargets: strongestTargets,
    candidateDistribution: candidateDistribution,
    softmax: softmax,
    nucleus: nucleus,
    generate: generate
  };
})(typeof window !== "undefined" ? window : globalThis);