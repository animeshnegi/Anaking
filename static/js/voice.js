/* Beacon voice commands - answer the survey hands-free.
 *
 * Built only on the browser's own Web Speech API (SpeechRecognition), which is
 * free and needs no server key, so deploying the studio online costs nothing
 * extra.  Recognition is unavailable on some browsers; the survey then simply
 * stays manual-only and the mic button never appears.
 *
 * The parser is a pure function (parseCommand) so it can be unit-tested without
 * a microphone: it turns one spoken utterance into a list of actions -
 * pick an option by name / number / ordinal, toggle several with "and",
 * or navigate with "next" / "back" / "clear".
 */
(function () {
  "use strict";

  var NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
              eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
              fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
              nineteen: 19, twenty: 20 };
  var ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
              seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  var STOP = { the: 1, a: 1, an: 1, of: 1, in: 1, on: 1, for: 1, to: 1, and: 1,
               or: 1, with: 1, my: 1, i: 1, it: 1, is: 1, im: 1, "not": 0 };

  function norm(t) {
    return String(t === undefined || t === null ? "" : t).toLowerCase()
      .replace(/[^\w\u00C0-\uFFFF]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function matchOption(phrase, opts) {
    var p = norm(phrase);
    if (!p || !opts || !opts.length) return null;
    var best = null, bestScore = 0;
    opts.forEach(function (o) {
      var L = norm(o.label);
      if (!L) return;
      if (L === p) { best = o; bestScore = 1000; return; }
      if (p.length >= 4 && L.indexOf(p) === 0 && bestScore < 500) { best = o; bestScore = 500; return; }
      if (p.length >= 4 && L.indexOf(p) >= 0 && bestScore < 400) { best = o; bestScore = 400; return; }
      if (L.length >= 4 && p.indexOf(L) >= 0 && bestScore < 300) { best = o; bestScore = 300; return; }
      var lt = L.split(" ").filter(function (w) { return w.length > 2 && !STOP[w]; });
      if (!lt.length) return;
      var pt = p.split(" ");
      var shared = lt.filter(function (w) {
        return pt.some(function (x) {
          return x === w || (w.length > 4 && x.indexOf(w) === 0) || (x.length > 4 && w.indexOf(x) === 0);
        });
      }).length;
      var score = shared / lt.length;
      if (shared > 0 && score >= 0.5 && score * 100 > bestScore) { best = o; bestScore = score * 100; }
    });
    return best;
  }

  // One utterance in, a list of actions out.  ctx: { options, multi }.
  function parseCommand(text, ctx) {
    ctx = ctx || {};
    var t = norm(text);
    if (!t) return [];
    // "the second one" -> "second": drop conversational padding around picks
    t = t.replace(/^the /, "").replace(/ (one|option)s?$/, "");
    if (/^(next|continue|proceed|go on|carry on|submit|done|finish|ok next|next question)$/.test(t)) return [{ act: "next" }];
    if (/^(back|previous|go back|backwards|last question)$/.test(t)) return [{ act: "back" }];
    if (/^(clear|reset|clear selection|start over|clear my answers)$/.test(t)) return [{ act: "clear" }];

    var opts = ctx.options || [], acts = [], m;
    function pickN(n) {
      if (n >= 1 && n <= opts.length) acts.push({ act: "pick", code: opts[n - 1].code });
    }
    if ((m = t.match(/^(?:option|number|choice|answer|the) (\d+)$/))) { pickN(Number(m[1])); return acts.length ? acts : [{ act: "unknown", text: t }]; }
    if ((m = t.match(/^(\d+)$/))) { pickN(Number(m[1])); return acts.length ? acts : [{ act: "unknown", text: t }]; }
    if (NUM[t] !== undefined) { pickN(NUM[t]); return acts.length ? acts : [{ act: "unknown", text: t }]; }
    if (ORD[t]) { pickN(ORD[t]); return acts.length ? acts : [{ act: "unknown", text: t }]; }
    if (/^(none|none of these|none of them|not applicable|no thank you)$/.test(t)) {
      var na = null;
      opts.forEach(function (o) {
        if (o.exclusive || /none|not applicable|\bn\/a\b/i.test(String(o.label || ""))) na = o;
      });
      return na ? [{ act: "pick", code: na.code }] : [{ act: "unknown", text: t }];
    }

    // "chemo and IO" - several picks in one breath (multi-select pages)
    t.split(/\band\b|\bthen\b|\bplus\b|,/).forEach(function (part) {
      part = norm(part.replace(/^(?:option|number|choice) /, ""));
      if (!part) return;
      if (NUM[part] !== undefined) { pickN(NUM[part]); return; }
      if (ORD[part]) { pickN(ORD[part]); return; }
      if (/^(?:option|number|choice) \d+$/.test(part) || /^\d+$/.test(part)) { pickN(Number(part.replace(/\D/g, "")) || 0); return; }
      var hit = matchOption(part, opts);
      if (hit) acts.push({ act: "pick", code: hit.code });
      else acts.push({ act: "unknown", text: part });
    });
    return acts;
  }

  function supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  // Errors that end listening.  The browser will not grant them on a retry, so restarting would
  // only spin.  "no-speech" (a pause with nothing said) and "aborted" (we stopped it) are ordinary.
  var BENIGN = { "no-speech": 1, "aborted": 1 };

  // handlers: onFinal(text), onInterim(text), onState("listening"|"off"|"error", code)
  function create(handlers) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var rec = new SR(), on = false, heard = false, silentEnds = 0;
    var lang = (document.documentElement && document.documentElement.lang) || navigator.language || "en-US";
    rec.lang = lang === "en" ? "en-US" : lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    function emit(state, code) { if (handlers.onState) handlers.onState(state, code); }
    function fail(code) { on = false; emit("error", code); }
    // false only when the browser refused to start listening at all
    function begin() {
      heard = false;
      try { rec.start(); return true; }
      catch (e) { return !!e && e.name === "InvalidStateError"; }   // already running is fine
    }

    rec.onaudiostart = function () { heard = true; silentEnds = 0; };
    rec.onresult = function (e) {
      var fin = "", inter = "", i;
      for (i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript + " ";
        else inter += e.results[i][0].transcript + " ";
      }
      if (inter && handlers.onInterim) handlers.onInterim(inter.trim());
      if (fin && handlers.onFinal) handlers.onFinal(fin.trim());
    };
    rec.onerror = function (e) {
      var code = (e && e.error) || "error";
      if (!BENIGN[code]) fail(code);
    };
    rec.onend = function () {
      if (!on) { emit("off"); return; }
      // A session that ends without ever capturing audio means the microphone is blocked or missing.
      // A few in a row is a fault to report, not something to keep retrying.
      silentEnds = heard ? 0 : silentEnds + 1;
      if (silentEnds >= 3) { fail("no-audio"); return; }
      // the browser stops listening after each utterance - start again at once
      if (!begin()) { fail("no-start"); return; }
      emit("listening");
    };

    return {
      start: function () {
        on = true; silentEnds = 0;
        if (!begin()) { fail("no-start"); return; }
        emit("listening");
      },
      stop: function () {
        on = false;
        try { rec.stop(); } catch (e) {}
        emit("off");
      },
      active: function () { return on; }
    };
  }

  window.BeaconVoice = { supported: supported, create: create, parseCommand: parseCommand, norm: norm };
})();
