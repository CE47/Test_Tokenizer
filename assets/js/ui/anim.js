/* =============================================================================
 * anim.js — a tiny tween/scheduler engine used by every stage.
 * Honours prefers-reduced-motion: durations collapse to 0 but state still sets.
 * ========================================================================== */
(function (global) {
  "use strict";

  var reduced = false;
  try {
    var mq = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq) {
      reduced = mq.matches;
      var onChange = function (e) {
        reduced = e.matches;
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  } catch (e) {
    /* no matchMedia: animate normally */
  }

  var EASE = {
    linear: function (t) {
      return t;
    },
    outCubic: function (t) {
      return 1 - Math.pow(1 - t, 3);
    },
    inOutCubic: function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    outQuint: function (t) {
      return 1 - Math.pow(1 - t, 5);
    },
    outBack: function (t) {
      var c1 = 1.70158,
        c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    outElastic: function (t) {
      var c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    inOutSine: function (t) {
      return -(Math.cos(Math.PI * t) - 1) / 2;
    }
  };

  var running = [];
  var rafId = null;
  var last = 0;

  function loop(now) {
    if (!last) last = now;
    var dt = Math.min(now - last, 64);
    last = now;
    for (var i = running.length - 1; i >= 0; i--) {
      var a = running[i];
      a.elapsed += dt;
      var t = a.duration <= 0 ? 1 : Math.min(a.elapsed / a.duration, 1);
      var e = a.ease(t);
      a.onUpdate(a.from + (a.to - a.from) * e, e, t);
      if (t >= 1) {
        running.splice(i, 1);
        if (a.onComplete) a.onComplete();
      }
    }
    rafId = running.length ? requestAnimationFrame(loop) : null;
  }

  function schedule() {
    if (rafId === null && running.length) {
      last = 0;
      rafId = requestAnimationFrame(loop);
    }
  }

  function tween(opts) {
    var dur = reduced ? 0 : opts.duration === undefined ? 400 : opts.duration;
    var delay = reduced ? 0 : opts.delay || 0;
    var a = {
      elapsed: -delay,
      duration: Math.max(dur, 1),
      from: opts.from === undefined ? 0 : opts.from,
      to: opts.to === undefined ? 1 : opts.to,
      ease: typeof opts.ease === "function" ? opts.ease : EASE[opts.ease || "outCubic"],
      onUpdate: opts.onUpdate || function () {},
      onComplete: opts.onComplete
    };
    running.push(a);
    schedule();
    return {
      cancel: function () {
        var i = running.indexOf(a);
        if (i >= 0) running.splice(i, 1);
      }
    };
  }

  /** Run async steps with delays; resolves when finished. Cancels on interrupt. */
  function Timeline() {
    this.timers = [];
    this.gen = null;
    this.cancelled = false;
  }
  Timeline.prototype.wait = function (ms) {
    var self = this;
    return new Promise(function (resolve) {
      if (self.cancelled) return resolve();
      var t = setTimeout(resolve, reduced ? Math.min(ms, 60) : ms);
      self.timers.push(t);
    });
  };
  Timeline.prototype.tween = function (opts) {
    var self = this;
    return new Promise(function (resolve) {
      if (self.cancelled) return resolve();
      var o = {};
      Object.keys(opts).forEach(function (k) {
        o[k] = opts[k];
      });
      var userDone = o.onComplete;
      o.onComplete = function () {
        if (userDone) userDone();
        resolve();
      };
      (self.handles = self.handles || []).push(tween(o));
    });
  };
  Timeline.prototype.cancel = function () {
    this.cancelled = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    (this.handles || []).forEach(function (h) {
      h.cancel();
    });
  };

  function clearAll() {
    running.length = 0;
  }

  global.Anim = {
    reduced: function () {
      return reduced;
    },
    EASE: EASE,
    tween: tween,
    Timeline: Timeline,
    clearAll: clearAll
  };
})(typeof window !== "undefined" ? window : globalThis);