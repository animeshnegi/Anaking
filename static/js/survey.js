/* PROJECT BEACON - respondent instrument.
 *
 * Layers, in order of purpose:
 *   1. attention    - narrated explainer, comprehension checks, minimum dwell time on the
 *                     conjoint. These exist to stop satisficing, not to decorate.
 *   2. engagement   - progress ring, insight points, section milestones. Points reward
 *                     completion and care; nothing rewards speed.
 *   3. instrument   - the questions themselves, rendered from /api/spec.
 */
(function () {
  "use strict";

  var STUDY = window.STUDY || { slug: "beacon" };
  var IS_TEST = /(^|\/)test$/.test(location.pathname.replace(/\/$/, ""));
  var NS = (STUDY.slug === "beacon" ? "beacon" : "study_" + STUDY.slug) +
           (IS_TEST ? "_test_" : "_");

  var SPEC = null, SESSION = null, CONJOINT = null, NARR = null, SCENES = null;
  var answers = {};
  var steps = [];
  var cur = 0;
  var t0 = Date.now();
  var points = 0;
  var seenSections = {};
  // Audio is opt-in. It must never start before the respondent chooses a preference.
  var soundOn = false;
  var audioPref = "manual"; // manual | all | off
  var testNotes = {}, reviewToken = "";
  var narrator = null;
  var explainer = null;
  var dwellTimer = null;
  var dwellStart = 0;
  var pendingDwell = null;
  var MIN_DWELL = 12;
  var LANG = "";           // respondent language, from ?lang= or the on-welcome picker
  var ORIG = {};           // question ids the respondent wants in the parent (original) language

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  function loadSpecLang(lang) {
    LANG = lang;
    try { store("lang", lang); } catch (e) {}
    return fetch("/api/spec/" + STUDY.slug + "?lang=" + encodeURIComponent(lang))
      .then(function (r) { return r.json(); })
      .then(function (spec) {
        SPEC = spec;
        CONJOINT = spec.conjoint;
        NARR = spec.narration;
        SCENES = spec.explainer_scenes;
        window.BEACON_CONJOINT_SCENE = spec.conjoint_scene;
        setupLangPicker();
        applyWelcomeCopy();
      });
  }

  function setupLangPicker() {
    var pick = $("#lang-pick");
    if (pick) pick.remove();
    if (!SPEC || !SPEC.languages || SPEC.languages.length < 2) return;
    var host = document.querySelector("#start-btn");
    var row = el("div", "lang-pick");
    row.id = "lang-pick";
    row.appendChild(el("span", "lang-pick-ic", "\u2726"));
    var sel = el("select", "");
    SPEC.languages.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.code;
      o.textContent = l.native || l.code;
      if (l.code === SPEC.render_language) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      var m = null;
      SPEC.languages.forEach(function (l) { if (l.code === sel.value) m = l; });
      if (m && m.child && m.code !== SPEC.default_language) {
        // each language is its own child survey with its own link and data
        var qs = location.search.replace(/^\?/, "");
        location.href = "/survey/" + m.child + (IS_TEST ? "/test" : "") + (qs ? "?" + qs : "");
      } else {
        loadSpecLang(sel.value);
      }
    });
    row.appendChild(sel);
    if (host && host.parentElement) host.parentElement.insertBefore(row, host);
  }

  function applyWelcomeCopy() {
    if (!SPEC) return;
    try { document.documentElement.dir = SPEC.render_dir || "ltr"; } catch (e) {}
    if (SPEC.welcome_title) {
      var h = document.querySelector("#welcome h1");
      if (h) h.textContent = SPEC.welcome_title;
    }
    if (SPEC.welcome_text) {
      var ps = document.querySelectorAll("#welcome p");
      if (ps.length) ps[0].textContent = SPEC.welcome_text;
    }
  }

  function readEmbedded() {
    var out = {};
    try {
      var ps = new URLSearchParams(location.search);
      (SPEC.embedded || []).forEach(function (n) {
        var v = ps.get(n);
        if (v !== null) out[n] = v;
      });
    } catch (e) {}
    return out;
  }

  function isNum(x) { return x !== "" && x !== null && x !== undefined && !isNaN(Number(x)); }

  function store(k, v) {
    try {
      if (v === undefined) localStorage.removeItem(NS + k);
      else localStorage.setItem(NS + k, JSON.stringify(v));
    } catch (e) {}
  }
  function recall(k) {
    try { var v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }

  // ============================================================ narration
  function stopNarration() {
    stopSpeech();
    if (narrator) {
      try { narrator.pause(); } catch (e) {}
      narrator = null;
    }
    document.querySelectorAll(".play-btn.playing").forEach(function (b) {
      b.classList.remove("playing");
    });
    document.querySelectorAll(".g-btn.playing").forEach(function (b) {
      b.classList.remove("playing");
      b.innerHTML = '<span class="g-ico">&#9654;</span> Listen';
    });
    var w = $("#welcome-wave");
    if (w) w.hidden = true;
  }

  function playClip(key, onEnd) {
    if (!soundOn || !NARR || !NARR[key]) { if (onEnd) onEnd(); return null; }
    stopNarration();
    var a = new Audio(NARR[key].src || "/audio/" + NARR[key].file);
    a.preload = "auto";
    narrator = a;
    if (onEnd) a.addEventListener("ended", function () { narrator = null; onEnd(); });
    var p = a.play();
    // Browsers block autoplay until the user has interacted; fail quietly rather than stalling.
    if (p && p.catch) p.catch(function () { narrator = null; });
    return a;
  }

  function setSound(on) {
    soundOn = on;
    store("sound", on);
    var b = $("#sound-btn");
    if (b) {
      b.classList.toggle("off", !on);
      b.innerHTML = on ? "&#128266;" : "&#128263;";
      b.title = on ? "Narration on" : "Narration off";
    }
    if (!on) stopNarration();
  }

  // ============================================================ spoken guide
  // Every screen offers the same three choices: listen (narration or text-to-speech),
  // read at your own pace, or replay. Works on any modern browser, no server cost.
  var tts = ("speechSynthesis" in window) ? window.speechSynthesis : null;
  var lastGuide = null;

  function stopSpeech() {
    if (tts) { try { tts.cancel(); } catch (e) {} }
  }

  function speak(text, btn) {
    if (!tts) return false;
    stopNarration();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 1.03;
    u.onend = u.onerror = function () {
      if (btn) {
        btn.classList.remove("playing");
        btn.innerHTML = '<span class="g-ico">&#9654;</span> Listen';
      }
    };
    lastGuide = text;
    tts.speak(u);
    return true;
  }

  function qSpeechText(q) {
    q = Object.assign({}, q, { stem: pipeText(q.stem) });
    var t = q.id + ". " + q.stem + (q.help ? " " + q.help : "");
    if (q.options) t += " The options are: " +
      q.options.map(function (o) { return o.label; }).join("; ") + ".";
    if (q.rows && q.cols) t += (q.select === "multi" ? " For each row, tick every column that applies."
      : " For each row, choose one column.") +
      " Rows: " + q.rows.map(function (r) { return r.label; }).join("; ") +
      ". Columns: " + q.cols.map(function (c) { return c.label; }).join("; ") + ".";
    else if (q.rows && q.scale) t += " Please rate each item from " + q.scale.min + " to " + q.scale.max +
      ". Items: " + q.rows.map(function (r) { return r.label; }).join("; ") + ".";
    return t;
  }

  function taskSpeechText(step) {
    var q = step.q;
    var alts = taskAt(step.taskId);
    var t = "Choice task " + step.slot + " of " + step.total + ". Patient: " + q.vignette + ". ";
    alts.forEach(function (alt, i) {
      var said = (CONJOINT.attributes || []).map(function (a, ai) {
        var lv = altLevel(alt, a, ai);
        return lv == null ? "" : (a.levels || [])[lv];
      }).filter(function (v) { return v != null; });
      t += "Treatment " + (i + 1) + ": " + said.join("; ") + ". ";
    });
    if (CONJOINT.has_opt_out !== false) t += "Or choose: " + q.opt_out_label + ".";
    return t;
  }

  function guideBar(textFn) {
    var bar = el("div", "guide");
    var listen = el("button", "g-btn", '<span class="g-ico">&#9654;</span> Listen');
    listen.type = "button";
    var replay = el("button", "g-btn", '<span class="g-ico">&#8635;</span> Replay');
    replay.type = "button";
    var hint = el("span", "g-hint", "or read at your own pace below");

    function setPlaying(on) {
      listen.classList.toggle("playing", on);
      listen.innerHTML = on ? '<span class="g-ico">&#9632;</span> Stop'
                            : '<span class="g-ico">&#9654;</span> Listen';
    }
    listen.addEventListener("click", function () {
      if (listen.classList.contains("playing")) { stopNarration(); return; }
      if (!soundOn) setSound(true);
      if (speak(textFn(), listen)) setPlaying(true);
      else { listen.title = "Audio is not supported on this device - please read below."; }
    });
    replay.addEventListener("click", function () {
      if (!soundOn) setSound(true);
      if (speak(lastGuide || textFn(), listen)) setPlaying(true);
    });

    bar.appendChild(listen);
    bar.appendChild(replay);
    bar.appendChild(hint);
    return bar;
  }

  // ============================================================ study coach
  // A small mascot that talks to the respondent: celebrates, nudges and guides.
  // It never blocks the survey - it only comments.
  var coachTimer = null;
  var PREVIEW = !!window.BEACON_PREVIEW_MODE;   // set by the Studio: render questions, no session/boot
  function coachSay(html, tone, ms) {
    if (PREVIEW) return;
    var c = $("#coach");
    if (!c) {
      c = el("div", "coach");
      c.id = "coach";
      c.innerHTML =
        '<span class="coach-face">' +
        '<svg viewBox="0 0 44 44"><rect x="4" y="8" width="36" height="30" rx="10" fill="#0b4f6c"/>' +
        '<circle cx="16" cy="21" r="3.4" fill="#fff"/><circle cx="28" cy="21" r="3.4" fill="#fff"/>' +
        '<path d="M15 28q7 5 14 0" stroke="#7fd4f0" stroke-width="2.6" fill="none" ' +
        'stroke-linecap="round"/>' +
        '<path d="M22 8V4" stroke="#0b4f6c" stroke-width="2.6"/>' +
        '<circle cx="22" cy="3" r="2.4" fill="#ffd166"/></svg></span>' +
        '<span class="coach-msg"></span>';
      document.body.appendChild(c);
    }
    c.className = "coach show " + (tone || "info");
    c.querySelector(".coach-msg").innerHTML = html;
    if (coachTimer) clearTimeout(coachTimer);
    coachTimer = setTimeout(function () { c.classList.remove("show"); }, ms || 5200);
  }

  // ============================================================ verbatim quality
  // Live gibberish detection: keyboard mashes, character/word repetition, vowel-less
  // strings, lorem ipsum. Flags while typing so the respondent can fix it in place.
  function textQuality(t) {
    var s = String(t || "").trim().toLowerCase();
    if (s.length < 8) return null;
    if (s.indexOf("lorem ipsum") >= 0) return "placeholder text";
    var letters = s.replace(/[^a-z]/g, "");
    if (letters.length >= 8) {
      var vowels = (letters.match(/[aeiou]/g) || []).length;
      if (vowels / letters.length < 0.1) return "not readable";
    }
    var rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
    for (var i = 0; i < rows.length; i++) {
      var rr = rows[i].split("").reverse().join("");
      if (s.indexOf(rows[i]) >= 0 || s.indexOf(rr) >= 0) return "a keyboard pattern";
    }
    if (/(.)\1{5,}/.test(s)) return "repeated characters";
    var words = s.split(/\s+/);
    if (words.length >= 4) {
      var uniq = {};
      words.forEach(function (w) { uniq[w] = 1; });
      if (Object.keys(uniq).length / words.length <= 0.3) return "repeated words";
    }
    for (var c = 2; c <= 8; c++) {
      var pat = s.slice(0, c);
      var reps = Math.floor(s.length / c);
      if (reps >= 3 && s.length - reps * c < c &&
          new Array(reps + 1).join(pat) === s.slice(0, reps * c)) return "a repeated pattern";
    }
    return null;
  }

  // ============================================================ AI-written answer check
  // Written answers are the part of a study most often faked: paste a chatbot reply into
  // the box and move on. So every text box watches HOW the answer arrives (keystrokes,
  // pastes, typing speed, time away from the tab) and asks the server to score WHAT it
  // says. /api/check_text runs exactly the rules the QC engine applies after the field
  // closes, so the warning a respondent sees and the flag on their record can never
  // disagree - and a client that skipped the call would still be scored on submit.
  var textMeta = {};        // qid -> telemetry collected in the browser
  var aiState = {};         // qid -> latest server verdict (with the text it scored)
  var proofreadSeen = false;

  function escHtml(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function metaFor(qid) {
    if (!textMeta[qid]) {
      textMeta[qid] = { keystrokes: 0, pastes: 0, pasted_chars: 0, input_events: 0,
                        typed_ms: 0, blur_ms: 0 };
    }
    return textMeta[qid];
  }

  // "off" | "warn" | "confirm" - mirrors core.ai_detect.ai_settings() on the server
  function aiActionOf(q) {
    var g = (SPEC && SPEC.ai_check) || {};
    if (g.enabled === false || (q && q.ai_check === false)) return "off";
    var a = (q && q.ai_action) || g.action || "confirm";
    return a === "off" ? "off" : (a === "warn" ? "warn" : "confirm");
  }

  // Counts real typing in one text box. Keystrokes push the pasted-character count back
  // down, so a respondent who pastes a draft and then rewrites it by hand is not still
  // carrying that paste on their record - the answer is judged on what they actually did.
  function trackKeys(meta, box) {
    var lastKey = 0, keysSinceInput = 0, lastLen = box.value.length, pasting = false;
    box.addEventListener("keydown", function (e) {
      if (!e.key || e.key.length !== 1) return;
      var now = Date.now();
      if (lastKey && now - lastKey < 3000) meta.typed_ms += now - lastKey;
      lastKey = now;
      meta.keystrokes++;
      keysSinceInput++;
      if (meta.pasted_chars > 0) meta.pasted_chars--;
    });
    box.addEventListener("paste", function (e) {
      var cd = e.clipboardData || window.clipboardData;
      meta.pastes++;
      meta.pasted_chars += cd ? String(cd.getData("text") || "").length : 0;
      pasting = true;
    });
    box.addEventListener("input", function () {
      meta.input_events++;
      var delta = box.value.length - lastLen;
      lastLen = box.value.length;
      if (pasting) { pasting = false; keysSinceInput = 0; return; }   // already counted above
      // text that grew by a big chunk with no keystrokes behind it - drag and drop, a
      // scripted insert, autofill of a whole answer - counts as pasted. The threshold
      // leaves room for predictive text and IME composition, which add a word at a time.
      if (delta - keysSinceInput >= 25) { meta.pasted_chars += delta; meta.pastes++; }
      keysSinceInput = 0;
    });
  }

  function checkText(qid, text, meta, cb) {
    fetch("/api/check_text", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study: STUDY.slug, qid: qid, text: text, meta: meta })
    }).then(function (r) { return r.json(); }).then(function (res) {
      res.text = text;
      aiState[qid] = res;
      var prev = (answers[qid] || {})._ai || {};
      setAns(qid, "_ai", { score: res.score, verdict: res.verdict, ack: !!prev.ack,
                           checked: Date.now() });
      if (cb) cb(res);
    }).catch(function () { if (cb) cb(null); });
  }

  function aiReasons(res) {
    var out = [];
    (res && res.signals || []).forEach(function (s) { if (s.weight > 0) out.push(s.label); });
    return out;
  }

  // Wires one textarea: telemetry, live gibberish check, live AI check, confirm action.
  function wireTextWatch(q, ta, chip, actions) {
    var meta = metaFor(q.id);
    var action = aiActionOf(q);
    var deb = null, awayAt = 0, praised = false;

    function snapshot() {
      var m = {};
      for (var k in meta) if (meta.hasOwnProperty(k)) m[k] = meta[k];
      if (awayAt) m.blur_ms += Date.now() - awayAt;
      return m;
    }

    function paint(res, txt) {
      var acked = !!((answers[q.id] || {})._ai || {}).ack;
      if (!res || !res.scored || res.verdict === "human") {
        chip.className = "oq-chip" + (res && res.scored ? " ok" : "");
        chip.innerHTML = res && res.scored ? "&#10003; Reads like your own words - thank you." : "";
        actions.innerHTML = "";
        if (res && res.scored && !praised && txt.split(/\s+/).length >= Math.max(3, q.min_words || 3)) {
          praised = true;
          coachSay("That is exactly the kind of insight this study needs. Thank you!", "good");
        }
        return;
      }
      var bad = res.verdict === "likely_ai";
      chip.className = "oq-chip " + (bad ? "ai" : "warn");
      chip.innerHTML =
        "<strong>&#9888; " + (bad ? "This looks AI-written or pasted." :
                                     "This may be AI-written or pasted.") + "</strong> " +
        '<span class="ai-score">' + res.score + "/100</span><br>" +
        '<span class="ai-why">' + escHtml(aiReasons(res).slice(0, 3).join(" \u00b7 ")) + "</span><br>" +
        (acked
          ? "Thank you - noted as your own words. Our reviewers can still see the score."
          : "This study only works with your own words. Rough, short or unfinished is worth " +
            "far more here than polished text from a chatbot - please rewrite it, or confirm " +
            "below that you wrote it yourself.");
      if (res.proofread && res.proofread.length) {
        chip.innerHTML += '<br><span class="ai-why">Proofreading: ' +
          escHtml(res.proofread.slice(0, 2).map(function (n) { return n.note; }).join("; ")) +
          "</span>";
      }
      actions.innerHTML = "";
      if (acked || action === "off") return;
      if (action === "confirm") {
        var mine = el("button", "g-btn", "&#10003; I wrote this myself");
        mine.type = "button";
        mine.addEventListener("click", function () {
          var prev = (answers[q.id] || {})._ai || {};
          setAns(q.id, "_ai", { score: res.score, verdict: res.verdict, ack: true,
                                confirmed: Date.now() });
          paint(res, ta.value.trim());
          coachSay("Thank you for confirming - that is noted on your record.", "info");
        });
        actions.appendChild(mine);
      }
      var again = el("button", "g-btn ghost", "&#9998; I will rewrite it");
      again.type = "button";
      again.addEventListener("click", function () { ta.focus(); ta.select(); });
      actions.appendChild(again);
    }

    function runCheck() {
      var txt = ta.value.trim();
      setAns(q.id, "_meta", snapshot());
      if (txt.length < 20) {
        chip.className = "oq-chip"; chip.innerHTML = ""; actions.innerHTML = "";
        return;
      }
      var bad = textQuality(txt);            // instant, offline: keyboard mashes and filler
      if (bad) {
        chip.className = "oq-chip warn";
        chip.innerHTML = "&#9888; This reads as " + bad + ". A sentence or two in your own " +
          "words makes sure your insight counts - or record it with the microphone.";
        actions.innerHTML = "";
      }
      if (action === "off") return;
      checkText(q.id, txt, snapshot(), function (res) { if (res) paint(res, txt); });
    }

    trackKeys(meta, ta);
    ta.addEventListener("keydown", function () {
      if (meta.keystrokes % 20 === 0) setAns(q.id, "_meta", snapshot());
    });
    ta.addEventListener("paste", function () {
      clearTimeout(deb);
      deb = setTimeout(runCheck, 150);       // score a paste straight away
    });
    ta.addEventListener("drop", function () { meta.pastes++; meta.input_events++; });
    ta.addEventListener("input", function () {
      setAns(q.id, "_", ta.value); hideErr();
      clearTimeout(deb);
      deb = setTimeout(runCheck, 650);
    });
    ta.addEventListener("blur", function () {
      awayAt = Date.now();
      setAns(q.id, "_meta", snapshot());
      ansChanged();                          // screening on text waits until the box is left
    });
    ta.addEventListener("focus", function () {
      if (awayAt) { meta.blur_ms += Date.now() - awayAt; awayAt = 0; }
    });

    // coming back to an answered question: show the verdict we already have, or re-score
    var init = ta.value.trim();
    if (init.length >= 20 && action !== "off") {
      var cached = aiState[q.id];
      if (cached && cached.text === init) paint(cached, init);
      else setTimeout(runCheck, 80);
    }
  }

  // ============================================================ voice verbatims
  // Optional recorded answer via MediaRecorder; uploaded to /api/voice and referenced
  // from the answers payload by filename only.
  function recorderFor(q) {
    var row = el("div", "rec-row");
    var can = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
              ("MediaRecorder" in window);
    var rec = el("button", "g-btn rec-btn", '<span class="g-ico">&#127908;</span> Record voice answer');
    rec.type = "button";
    var note = el("span", "g-hint", "optional &middot; stored on the study server");
    row.appendChild(rec);
    row.appendChild(note);
    if (!can) {
      rec.disabled = true;
      rec.title = "Recording is not supported on this device - typing works fine.";
      return row;
    }

    var mrec = null, chunks = [], recMime = "", blobUrl = null, play = null, del = null;

    function clearPlay() {
      if (play) { play.remove(); play = null; }
      if (del) { del.remove(); del = null; }
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    }

    rec.addEventListener("click", function () {
      if (mrec) { try { mrec.stop(); } catch (e) {} return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        recMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
        mrec = recMime ? new MediaRecorder(stream, { mimeType: recMime }) : new MediaRecorder(stream);
        chunks = [];
        mrec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        mrec.onstop = function () {
          stream.getTracks().forEach(function (tr) { tr.stop(); });
          mrec = null;
          rec.classList.remove("recording");
          rec.innerHTML = '<span class="g-ico">&#127908;</span> Record voice answer';
          var blob = new Blob(chunks, { type: recMime || "audio/webm" });
          attach(blob);
        };
        mrec.start();
        rec.classList.add("recording");
        rec.innerHTML = '<span class="g-ico">&#9724;</span> Stop &amp; attach';
      }).catch(function () {
        coachSay("Microphone access was blocked - you can still type your answer below.", "warn");
      });
    });

    function attach(blob) {
      clearPlay();
      blobUrl = URL.createObjectURL(blob);
      play = el("audio");
      play.controls = true;
      play.src = blobUrl;
      play.className = "rec-play";
      row.insertBefore(play, note);
      del = el("button", "g-btn", "Delete");
      del.type = "button";
      del.addEventListener("click", function () {
        clearPlay();
        setAns(q.id, "voice", null);
        save();
      });
      row.insertBefore(del, note);

      var fr = new FileReader();
      fr.onload = function () {
        var b64 = String(fr.result).split(",")[1] || "";
        var ext = recMime.indexOf("mp4") >= 0 ? "m4a"
                : recMime.indexOf("ogg") >= 0 ? "ogg" : "webm";
        fetch("/api/voice", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: SESSION.session_id, qid: q.id, data: b64, ext: ext })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res.ok) {
            setAns(q.id, "voice", res.file);
            save();
            coachSay("Voice answer attached - thank you.", "good");
          }
        }).catch(function () {});
      };
      fr.readAsDataURL(blob);
    }
    return row;
  }

  // ============================================================ gamification
  var RANKS = [[0, "Observer"], [100, "Clinical Explorer"], [250, "Evidence Analyst"],
               [400, "Insight Strategist"], [600, "KOL Partner"]];
  function rankFor(p) {
    var r = RANKS[0][1];
    for (var i = 0; i < RANKS.length; i++) if (p >= RANKS[i][0]) r = RANKS[i][1];
    return r;
  }
  function toast(html) {
    var t = el("div", "toast", html);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2750);
  }

  // Authors can switch the game layer off in Studio; the plain progress bar on top stays.
  function gamifyOn() { return !!(SPEC && SPEC.gamify !== false); }

  // A quiet bull's-eye: two target rings ripple out of an answer the moment it lands,
  // so picking feels like hitting the mark - no words, no noise, just feedback.
  function bullseye(node) {
    if (!node || node.classList.contains("hit")) return;
    node.classList.add("hit");
    setTimeout(function () { node.classList.remove("hit"); }, 800);
  }

  function addPoints(n) {
    if (PREVIEW || !gamifyOn()) return;
    var before = rankFor(points);
    points += n;
    var after = rankFor(points);
    var p = $("#points");
    if (!p) return;
    p.textContent = points;
    var badge = $("#rank-badge");
    if (badge) badge.textContent = after;
    var box = p.parentElement;
    box.classList.remove("bump");
    void box.offsetWidth;
    box.classList.add("bump");
    floatPoints(n);
    if (before !== after) {
      toast("&#9733; Rank up: " + after);
      confetti(18);
    }
  }

  // "+25" rises out of the points counter, so a reward is seen as it lands.
  function floatPoints(n) {
    var box = $("#points") && $("#points").parentElement;
    if (!box || !(n > 0)) return;
    var f = el("span", "pts-float", "+" + n);
    box.appendChild(f);
    setTimeout(function () { f.remove(); }, 1400);
  }

  function setProgress(pct) {
    var ring = $("#ring-fg");
    if (ring) ring.style.strokeDashoffset = String(100 - pct);
    var lab = $("#ring-label");
    if (lab) lab.textContent = pct + "%";
    var bar = $("#progress-fill");
    if (bar) bar.style.width = pct + "%";
  }

  function confetti(n) {
    if (!gamifyOn()) return;
    var colors = ["#0b4f6c", "#12789e", "#7fd4f0", "#ffd166", "#1a7f4b"];
    n = n || 40;
    for (var i = 0; i < n; i++) {
      (function (i) {
        setTimeout(function () {
          var d = el("div", "confetti");
          d.style.left = Math.random() * 100 + "vw";
          d.style.background = colors[i % colors.length];
          d.style.animationDuration = (1.6 + Math.random() * 1.4) + "s";
          d.style.transform = "rotate(" + Math.random() * 360 + "deg)";
          document.body.appendChild(d);
          setTimeout(function () { d.remove(); }, 3200);
        }, i * 28);
      })(i);
    }
  }

  // ============================================================ voice commands
  // Speak your answers: say an option (or its number), several options joined
  // with "and", then say "next". Runs on the browser's own speech recognition
  // (Web Speech API) - free to ship, nothing to configure server-side. Voice is
  // strictly optional: tapping always works, and on browsers without the API
  // every voice control simply stays hidden.
  var voice = null, voiceOn = false, voiceBar = null;

  function voiceSupported() {
    return !PREVIEW && window.BeaconVoice && window.BeaconVoice.supported();
  }

  // Options of the question currently on screen (options the voice picks from).
  function voiceCtx() {
    var q = steps[cur] && steps[cur].q;
    if (!q || !q.options) return { options: [], multi: false, type: (q && q.type) || "" };
    return { options: q.options, multi: q.type === "multi_select", type: q.type };
  }

  function showVoiceBar(msg) {
    if (!voiceBar) {
      voiceBar = el("div", "voice-bar",
        '<span class="vb-mic" aria-hidden="true"><i></i></span>' +
        '<span class="vb-live">Listening\u2026</span>' +
        '<span class="vb-heard" aria-live="polite"></span>' +
        '<button type="button" class="vb-stop">Stop</button>');
      voiceBar.querySelector(".vb-stop").addEventListener("click", function () {
        setVoice(false);
        coachSay("Voice answering is off - tap your answers.", "info");
      });
      document.body.appendChild(voiceBar);
    }
    var live = voiceBar.querySelector(".vb-live");
    var heard = voiceBar.querySelector(".vb-heard");
    live.textContent = msg || "Listening\u2026 say an option or \u201Cnext\u201D";
    heard.textContent = "";
    voiceBar.classList.add("listening");
    voiceBar.hidden = false;
  }

  function hideVoiceBar() {
    if (voiceBar) voiceBar.hidden = true;
  }

  function voiceTranscript(text) {
    if (!voiceBar) return;
    var heard = voiceBar.querySelector(".vb-heard");
    heard.textContent = "\u201C" + text + "\u201D";
  }

  // Turn one finished utterance into survey actions and run them in order.
  function voiceHear(text) {
    if (!text || !voiceOn) return;
    voiceTranscript(text);
    var ctx = voiceCtx();
    var acts = window.BeaconVoice.parseCommand(text, ctx);
    var picked = 0, spoken = false;
    acts.forEach(function (a) {
      if (a.act === "next") {
        if (spoken) coachSay("Next question coming up\u2026", "info");
        next();
      } else if (a.act === "back") {
        go(cur - 1);
      } else if (a.act === "clear") {
        voiceClear();
        coachSay("Selections cleared.", "info");
      } else if (a.act === "pick") {
        if (ctx.type !== "single_select" && ctx.type !== "multi_select") {
          if (!spoken) {
            coachSay("This one needs a quick tap \u2014 then say \u201Cnext\u201D when you\u2019re ready.", "info");
            spoken = true;
          }
          return;
        }
        var row = document.querySelector('#app .opt[data-code="' + String(a.code).replace(/"/g, '\\"') + '"]');
        if (row) { row.click(); picked++; }
      } else if (!spoken) {
        coachSay("I heard \u201C" + escHtml(a.text) + "\u201D \u2014 say an option name or number, or \u201Cnext\u201D.", "warn");
        spoken = true;
      }
    });
    if (picked) coachSay(picked === 1 ? "Locked in." : "Locked in " + picked + " answers.", "info");
    showVoiceBar(); // settle the bar back to listening state for the next utterance
  }

  function voiceClear() {
    Array.prototype.forEach.call(document.querySelectorAll("#app .opt input[type='checkbox']"), function (i) {
      if (i.checked) i.closest(".opt").click();
    });
  }

  // What a respondent hears when voice answering stops by itself: the microphone is blocked or
  // missing, or the speech service cannot be reached.  Every message ends with a way forward.
  var VOICE_ERRORS = {
    "not-allowed": "Microphone access is blocked. Allow it for this site, then turn voice on again.",
    "service-not-allowed": "This browser won\u2019t use its speech service here. Tap your answers to carry on.",
    "audio-capture": "No microphone was found. Connect one, then turn voice on again.",
    "network": "Couldn\u2019t reach the browser\u2019s speech service. Tap your answers to carry on.",
    "language-not-supported": "This browser can\u2019t listen in this survey\u2019s language. Tap your answers to carry on.",
    "no-audio": "Can\u2019t hear the microphone. Check that it is allowed and not muted, then turn voice on again.",
    "no-start": "Voice answering couldn\u2019t start in this browser. Tap your answers to carry on."
  };
  function voiceFailed(code) {
    if (!voiceOn) return;                              // a late report after we already stopped
    setVoice(false);
    coachSay(VOICE_ERRORS[code] || "Voice answering stopped. Tap your answers to carry on.", "warn", 9000);
  }

  function setVoice(on) {
    if (on && !voiceSupported()) return;
    if (on && !voice) {
      voice = window.BeaconVoice.create({
        onInterim: function (t) { voiceTranscript(t); },
        onFinal: function (t) { voiceHear(t); },
        onState: function (state, code) { if (state === "error") voiceFailed(code); }
      });
    }
    if (!voice) return;
    voiceOn = on;
    var btn = $("#voice-btn");
    if (on) {
      voice.start();                                   // may report a failure straight away
      if (voiceOn) {
        showVoiceBar();
        coachSay("Voice mode on \u2014 say an option or its number, then \u201Cnext\u201D. Press <b>Stop</b> below to switch it off.", "info");
      }
    } else {
      voice.stop();
      hideVoiceBar();
    }
    if (btn) { btn.classList.toggle("on", voiceOn); btn.setAttribute("aria-pressed", voiceOn ? "true" : "false"); }
    document.body.classList.toggle("voice-on", voiceOn);
  }

  // ============================================================ explainer
  var explainerOnDone = null;
  function dismissExplainer() {
    var ov = $("#explainer");
    if (ov.hidden) return;
    ov.hidden = true;
    if (explainer) { try { explainer.finish(); } catch (e) {} explainer = null; }
    var fn = explainerOnDone; explainerOnDone = null;
    if (fn) fn();
  }
  // reachable from the inline onclick in index.html, so the close button works even if
  // the rest of this file never finishes booting
  window.__beaconDismiss = dismissExplainer;

  // readable static profile so the overlay body is never empty on devices where the
  // animated walkthrough cannot start
  function staticProfileFallback() {
    var m = $("#ex-mount");
    if (!m || m.firstChild) return;
    m.innerHTML =
      '<div class="ex-fallback">' +
      "<p><strong>The animated walkthrough could not start on this device, so here is the " +
      "profile in text. The &times; button closes this at any time.</strong></p>" +
      "<ul>" +
      "<li><strong>Mechanism:</strong> novel mechanism of action; details blinded for this study.</li>" +
      "<li><strong>Pivotal trial:</strong> randomised, controlled, Phase III versus current standard of care.</li>" +
      "<li><strong>Efficacy:</strong> significant improvement in progression-free survival; overall survival data immature.</li>" +
      "<li><strong>Safety:</strong> treatment-related Grade 3+ adverse events in approximately 30% of patients.</li>" +
      "<li><strong>Companion diagnostic:</strong> broad NGS panel.</li>" +
      "</ul>" +
      '<p class="ex-fallback-note">This profile is a research construct, not an approved product.</p>' +
      "</div>";
  }

  function runExplainer(scenes, onDone) {
    var ov = $("#explainer");
    $("#ex-badge").textContent = scenes.length > 1 ? "Product profile" : "How the choices work";
    ov.hidden = false;
    explainerOnDone = onDone;
    var mounted = false;
    if (window.BeaconExplainer) {
      try {
        explainer = new window.BeaconExplainer($("#ex-mount"), {
          scenes: scenes,
          narration: NARR,
          muted: !soundOn,
          tts: !!SPEC.use_tts,
          onDone: function () { explainer = null; dismissExplainer(); }
        });
        explainer.start();
        mounted = !!$("#ex-mount").firstChild;
      } catch (e) { explainer = null; }
    }
    if (!mounted) staticProfileFallback();
    // auto-escape: if the walkthrough body somehow fails to render, do not lock the user out
    setTimeout(function () {
      if (!ov.hidden && !$("#ex-mount").firstChild) dismissExplainer();
    }, 1500);
  }

  // ============================================================ steps
  function seededOrder(items) {
    // Page Randomizer: keep the opening and closing sections fixed, shuffle the
    // middle section groups deterministically for this respondent's session.
    var groups = [];
    items.forEach(function (q) {
      var g = groups[groups.length - 1];
      if (!g || g.sec !== q.section) groups.push({ sec: q.section, qs: [q] });
      else g.qs.push(q);
    });
    if (groups.length < 3) return items;
    var mid = groups.slice(1, groups.length - 1);
    var seedStr = (SESSION && SESSION.session_id) || "preview";
    var h = 2166136261;
    for (var i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = (h * 16777619) >>> 0; }
    var st = h || 1;
    function rnd() {
      st ^= st << 13; st ^= st >>> 17; st ^= st << 5; st >>>= 0;
      return st / 4294967296;
    }
    for (var j = mid.length - 1; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1));
      var t = mid[j]; mid[j] = mid[k]; mid[k] = t;
    }
    var out = groups[0].qs.slice();
    mid.forEach(function (g) { out = out.concat(g.qs); });
    return out.concat(groups[groups.length - 1].qs);
  }

  function buildSteps() {
    steps = [];
    var list = SPEC.questions.slice();
    if (SPEC.randomize_pages) list = seededOrder(list);
    list.forEach(function (q) {
      if (q.type === "choice_task") {
        var order = (SESSION.task_order && SESSION.task_order.length)
          ? SESSION.task_order
          : taskIds();
        order.forEach(function (tid, i) {
          steps.push({ kind: "task", taskId: tid, slot: i + 1, q: q, total: order.length });
        });
      } else {
        steps.push({ kind: "q", q: q });
      }
    });
  }

  function sectionOf(q) {
    for (var i = 0; i < SPEC.sections.length; i++) {
      if (SPEC.sections[i].id === q.section) return SPEC.sections[i];
    }
    return { title: "", blurb: null };
  }

  var SECTION_NARRATION = { B: "section_practice", E: "section_access" };
  var SECTION_POINTS = { A: 50, B: 100, C: 100, D: 150, E: 100, F: 50 };

  // ============================================================ answers
  function setAns(qid, item, val) {
    if (!answers[qid]) answers[qid] = {};
    if (val === null || val === "") delete answers[qid][item];
    else answers[qid][item] = val;
  }
  function getAns(qid, item) { return answers[qid] ? answers[qid][item] : undefined; }

  function answered(q) {
    var a = answers[q.id] || {};
    switch (q.type) {
      case "single_select": case "numeric": case "slider": case "open_text":
        return a._ !== undefined && a._ !== "";
      case "rating_grid": case "semantic_diff": case "rating_scale":
        return q.rows.every(function (r) {
          var v = a[r.code];
          if (Array.isArray(v)) return v.length > 0;   // a multi-select grid row needs one tick
          return v !== undefined && v !== "";
        });
      case "sum_to_100":
        return q.rows.some(function (r) { return a[r.code] !== undefined && a[r.code] !== ""; });
      case "multi_select":
        return (a.codes || []).length > 0;
      case "date":
        return !!(a && a._);
      case "numeric_matrix": {
        var nmc = q.cols || [];
        if (nmc.length) {                            // a table: every cell, unless the row is N/A
          return (q.rows || []).length > 0 && (q.rows || []).every(function (r) {
            if (a[r.code] === "NA") return true;
            return nmc.every(function (c) {
              var v = a[r.code + "_" + c.code];
              return v !== undefined && v !== "";
            });
          });
        }
        return (q.rows || []).length > 0 && (q.rows || []).every(function (r) { return a[r.code] !== undefined && a[r.code] !== ""; });
      }
      case "delta":
        return !!(a && a.before !== undefined && a.before !== "" && a.after !== undefined && a.after !== "");
      case "concept_test": case "emoji_grid":
        return (q.rows || []).every(function (r) { return a[r.code] !== undefined; });
      case "heatmap":                                   // every cell is optional, one is enough
        return Object.keys(a).some(function (k) {
          return k.charAt(0) !== "_" && k.slice(0, 2) !== "c_" && a[k] !== "" && a[k] !== undefined;
        });
      case "loop":
        return (q.items || []).length > 0 && (q.items || []).every(function (it) { return a[it.code] !== undefined && String(a[it.code]).trim() !== ""; });
      case "text_block":
        return true;
      case "rank":
        return (a.order || []).length === q.rows.length;
      case "choice_task":
        return Object.keys(CONJOINT.tasks).every(function (t) { return a["T" + t] !== undefined; });
    }
    return false;
  }

  // ============================================================ renderers
  // per-respondent, stable option order (randomisation is seeded by the session id)
  function orderedList(list, q, axis) {
    if (!window.BeaconQ || !q.randomize) return list;
    var seed = (SESSION && SESSION.session_id) || "preview";
    var out = window.BeaconQ.order(list, q, seed, axis);
    // remember what the respondent actually saw, for analysis
    var a = answers[q.id] || {};
    var shown = out.map(function (x) { return x.code !== undefined ? x.code : x.v; }).join(",");
    var key = axis === "cols" ? "_order_cols" : "_order";
    if (a[key] !== shown) setAns(q.id, key, shown);
    return out;
  }

  function renderOptions(q, multi) {
    var layout = q.layout || (multi ? "grid" : "list");
    var wrap = el("div", "opts" + (layout === "grid" ? " opt-multi" : layout === "inline" ? " opt-inline" : ""));
    var otherBox = null;
    var options = orderedList(q.options, q);

    options.forEach(function (o) {
      var row = el("div", "opt" + (o.exclusive ? " opt-excl" : ""));
      row.dataset.code = String(o.code);
      var input = el("input");
      input.type = multi ? "checkbox" : "radio";
      input.name = q.id;
      input.value = o.code;
      input.id = q.id + "_" + o.code;
      row.appendChild(input);
      if (q.hide_codes !== true) row.appendChild(el("span", "code", o.code + "."));
      var lab = el("label");
      lab.htmlFor = input.id;
      if (o.label_html && window.BeaconQ) window.BeaconQ.richInto(lab, o.label_html, logicCtx(), "…");
      else lab.textContent = pipeText(o.label);
      if (o.image) { var im = el("img", "opt-img"); im.src = o.image; im.alt = ""; lab.appendChild(im); }
      row.appendChild(lab);

      row.addEventListener("click", function (ev) {
        if (ev.target.tagName !== "INPUT") input.checked = !input.checked;
        if (input.checked) bullseye(row);
        var codes = getAns(q.id, "codes") || [];
        if (multi) {
          var i = codes.map(String).indexOf(String(o.code));
          if (input.checked && i < 0) {
            if (o.exclusive) {
              codes = [];                       // "None of these" clears everything else
            } else {
              codes = codes.filter(function (c) {
                var oc = q.options.filter(function (x) { return String(x.code) === String(c); })[0];
                return !(oc && oc.exclusive);   // picking a normal option drops the exclusive one
              });
              if (q.max_select && codes.length >= q.max_select) {
                input.checked = false;
                showErr("Please select no more than " + q.max_select + ".");
                return;
              }
            }
            codes.push(o.code);
          } else if (!input.checked && i >= 0) codes.splice(i, 1);
          setAns(q.id, "codes", codes);
        } else {
          setAns(q.id, "_", o.code);
        }
        ansChanged();                          // screening: fires immediately if this answer ends it
        paint();
        if (o.other && otherBox) {
          otherBox.classList.toggle("show", input.checked);
          if (input.checked) otherBox.focus();
        }
        if (!multi || (getAns(q.id, "codes") || []).length) hideErr();
      });
      wrap.appendChild(row);

      if (o.other) {
        otherBox = el("input", "other-input");
        otherBox.type = "text";
        otherBox.placeholder = "Please specify";
        otherBox.value = getAns(q.id, "other_text") || "";
        otherBox.addEventListener("input", function () { setAns(q.id, "other_text", otherBox.value); });
        wrap.appendChild(otherBox);
      }
    });

    function paint() {
      var sel = multi ? (getAns(q.id, "codes") || []).map(String)
                      : [String(getAns(q.id, "_"))];
      Array.prototype.forEach.call(wrap.querySelectorAll(".opt"), function (row, i) {
        var on = sel.indexOf(String(options[i].code)) >= 0;
        row.classList.toggle("checked", on);
        row.querySelector("input").checked = on;
        if (options[i].other && otherBox) otherBox.classList.toggle("show", on);
      });
    }
    paint();
    return wrap;
  }

  // Spectrum scale: a draggable gradient track with detents and a value bubble.
  // Same data contract as the old 1-7 button row (one integer per item), but the
  // interaction is continuous, visual and touch friendly instead of a button strip.
  // ============================================================ grids
  // A grid is a title, two axes and a scale.  The Studio gives every row, column and scale
  // point its own label, format, image / video / audio clip, comment box and place in the
  // order - everything below simply draws what the Studio stored.
  var EMOJI_FACES = ["\uD83D\uDE1E", "\uD83D\uDE15", "\uD83D\uDE10", "\uD83D\uDE42", "\uD83D\uDE0D"];   // frowning .. smiling

  // One entry for every value of the scale, each with its own label and attachment.
  function scalePointsOf(q) {
    var sc = q.scale || {}, min = sc.min != null ? Number(sc.min) : 1;
    var max = sc.max != null ? Number(sc.max) : 5, have = {};
    (sc.points || []).forEach(function (p) { have[Number(p.v)] = p; });
    var out = [];
    for (var v = min; v <= max; v++) {
      var p = have[v] || {}, label = p.label || "";
      if (!label && q.type === "emoji_grid") {
        label = sc.faces ? (sc.faces[v - min] || "")
          : (max - min + 1 === EMOJI_FACES.length ? EMOJI_FACES[v - min] : "");
      }
      out.push({ v: v, label: label, fmt: p.fmt, media: p.media,
                 tip: (q.type === "emoji_grid" && sc.face_labels ? sc.face_labels[v - min] : "") || "" });
    }
    return out;
  }
  // Plain / bold / italic / bold+italic - the little format choice in the Studio.
  function fmtNode(text, fmt) {
    if (fmt === "b" || fmt === "bi") {
      var b = el("b");
      if (fmt === "bi") { var bi = el("i"); bi.textContent = text; b.appendChild(bi); }
      else b.textContent = text;
      return b;
    }
    if (fmt === "i") { var ii = el("i"); ii.textContent = text; return ii; }
    var sp = el("span"); sp.textContent = text; return sp;
  }
  // A row, column or scale point label, with its attachment underneath when it carries one.
  function itemLabelNode(it, cls) {
    var box = el("div", cls || "rlabel");
    var line = el("div", "rlabel-line");
    if (it.label_html && window.BeaconQ) window.BeaconQ.richInto(line, it.label_html, logicCtx(), it.label || "");
    else line.appendChild(fmtNode(pipeText(it.label), it.fmt));
    box.appendChild(line);
    var m = it.media || (it.image ? { kind: "image", src: it.image } : null);
    if (m && m.src) box.appendChild(renderMedia(m, "qmedia-sm"));
    return box;
  }
  // The exclusive N/A on one row: ticking it clears the rating, rating clears the tick.
  function naCell(q, key, label, onRate) {
    var lab = el("label", "na-cell");
    var cb = el("input"); cb.type = "checkbox";
    cb.checked = (answers[q.id] || {})[key] === "NA";
    cb.addEventListener("change", function () {
      setAns(q.id, key, cb.checked ? "NA" : "");
      if (onRate) onRate(cb.checked);
      hideErr(); ansChanged();
    });
    lab.appendChild(cb);
    lab.appendChild(el("span", null, label));
    return lab;
  }
  function commentBox(qid, key, mode, placeholder) {
    var ta = el("textarea", "cmt-box" + (mode === "require" ? " req" : ""));
    ta.rows = 2;
    ta.placeholder = placeholder || "Add a comment";
    ta.value = getAns(qid, key) || "";
    ta.addEventListener("input", function () { setAns(qid, key, ta.value); if (ta.value.trim()) hideErr(); });
    return ta;
  }
  // One comment box under a row, spanning the whole grid.
  function gridCommentRow(q, r, span) {
    var row = el("div", "grid-row grid-cmtrow");
    var ta = commentBox(q.id, "c_" + r.code, r.comment,
      "Comment on " + pipeText(r.label) + (r.comment === "require" ? " (required)" : ""));
    if (span) ta.dataset.span = String(span);
    row.appendChild(ta);
    return row;
  }
  function questionComment(q) {
    var c = q.comments || {}, box = el("div", "q-comment");
    box.appendChild(el("label", "q-comment-lbl", pipeText(c.label || "Any other comments?") +
      (c.mode === "require" ? " *" : "")));
    box.appendChild(commentBox(q.id, "_comment", c.mode, c.label || "Any other comments?"));
    return box;
  }
  // The header: the row group name on the left, one caption per column on the right.
  function gridHead(q, pts, extra) {
    var g = q.grid || {}, na = q.na || {};
    var head = el("div", "grid-row grid-head");
    head.appendChild(el("div", "rlabel grid-rowname", pipeText(g.row_label || "")));
    var cells = el("div", "grid-cells");
    if (g.col_label) cells.appendChild(el("div", "grid-colname", pipeText(g.col_label)));
    var strip = el("div", "grid-plabels");
    pts.forEach(function (p) {
      var c = el("div", "grid-plabel");
      if (p.label) c.appendChild(fmtNode(pipeText(p.label), p.fmt));
      if (p.tip) c.title = p.tip;
      if (p.media && p.media.src) c.appendChild(renderMedia(p.media, "qmedia-xs"));
      strip.appendChild(c);
    });
    if (extra) extra(strip);
    cells.appendChild(strip);
    head.appendChild(cells);
    return head;
  }

  function renderScale(min, max, val, onPick, pts) {
    var box = el("div", "spectrum");
    box.setAttribute("role", "slider");
    box.setAttribute("aria-valuemin", String(min));
    box.setAttribute("aria-valuemax", String(max));
    box.tabIndex = 0;

    function pct(v) { return max === min ? 50 : ((v - min) / (max - min)) * 100; }

    var track = el("div", "sp-track");
    var fillEl = el("div", "sp-fill");
    track.appendChild(fillEl);
    var detents = [];
    for (var v = min; v <= max; v++) {
      var d = el("span", "sp-detent");
      d.style.left = pct(v) + "%";
      track.appendChild(d);
      detents.push(d);
    }
    // one caption per scale point, sitting under the matching detent
    if (pts && pts.some(function (p) { return p.label || (p.media && p.media.src); })) {
      var labs = el("div", "sp-labels");
      pts.forEach(function (p) {
        var c = el("div", "sp-label");
        c.style.left = pct(p.v) + "%";
        if (p.label) c.appendChild(fmtNode(pipeText(p.label), p.fmt));
        if (p.media && p.media.src) c.appendChild(renderMedia(p.media, "qmedia-xs"));
        labs.appendChild(c);
      });
      box.appendChild(labs);
      box.classList.add("has-labels");
    }
    var bubble = el("div", "sp-bubble", val === undefined ? "tap or drag" : String(val));
    var thumb = el("button", "sp-thumb" + (val === undefined ? " idle" : ""));
    thumb.type = "button";
    thumb.tabIndex = -1;
    track.appendChild(thumb);
    track.appendChild(bubble);
    box.appendChild(track);

    var cur = val;
    function place(nv, commit) {
      cur = nv;
      thumb.style.left = pct(nv) + "%";
      bubble.style.left = pct(nv) + "%";
      bubble.textContent = String(nv);
      bubble.classList.remove("pop");
      void bubble.offsetWidth;
      bubble.classList.add("pop");
      fillEl.style.width = pct(nv) + "%";
      thumb.classList.remove("idle");
      box.setAttribute("aria-valuenow", String(nv));
      detents.forEach(function (dd, i) { dd.classList.toggle("hit", min + i <= nv); });
      if (commit) onPick(nv);
    }
    if (val !== undefined) {
      thumb.style.left = pct(val) + "%";
      bubble.style.left = pct(val) + "%";
      fillEl.style.width = pct(val) + "%";
      detents.forEach(function (dd, i) { dd.classList.toggle("hit", min + i <= val); });
      box.setAttribute("aria-valuenow", String(val));
    }

    function fromEvent(ev) {
      var r = track.getBoundingClientRect();
      var f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      return Math.round(min + f * (max - min));
    }
    track.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      try { track.setPointerCapture(ev.pointerId); } catch (e) {}
      place(fromEvent(ev), true);
      var move = function (e2) { place(fromEvent(e2), true); };
      var up = function () {
        track.removeEventListener("pointermove", move);
        track.removeEventListener("pointerup", up);
        track.removeEventListener("pointercancel", up);
      };
      track.addEventListener("pointermove", move);
      track.addEventListener("pointerup", up);
      track.addEventListener("pointercancel", up);
    });
    box.addEventListener("keydown", function (ev) {
      var v0 = cur === undefined ? Math.round((min + max) / 2) : cur;
      if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") { ev.preventDefault(); place(Math.max(min, v0 - 1), true); }
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") { ev.preventDefault(); place(Math.min(max, v0 + 1), true); }
    });
    return box;
  }

  function renderDate(q) {
    var a = answers[q.id] || {};
    var wrap = el("div", "field");
    var input = el("input", "");
    input.type = "date";
    if (q.min) input.min = q.min;
    if (q.max) input.max = q.max;
    input.value = a._ || "";
    input.addEventListener("change", function () { setAns(q.id, "_", input.value); hideErr(); ansChanged(); });
    wrap.appendChild(input);
    return wrap;
  }

  // A numeric matrix: one number box per row, or a whole table of them once it has columns.
  function numInput(q, key, onType) {
    var inp = el("input", "nm-input");
    inp.type = "number";
    if (q.min !== undefined) inp.min = q.min;
    if (q.max !== undefined) inp.max = q.max;
    if (q.step !== undefined) inp.step = q.step;
    var v = (answers[q.id] || {})[key];
    if (v !== undefined && v !== "" && v !== "NA") inp.value = v;
    inp.addEventListener("input", function () {
      setAns(q.id, key, inp.value);
      if (onType) onType();
      hideErr(); ansChanged();
    });
    return inp;
  }
  function renderNumMatrix(q) {
    var wrap = el("div", "nummatrix");
    var g = q.grid || {}, na = q.na || {}, naLabel = na.label || "N/A";
    var cols = orderedList(q.cols || [], q, "cols");
    var anyNa = na.rows || na.col;
    if (g.title) wrap.appendChild(el("div", "grid-title", pipeText(g.title)));
    if (!cols.length) {                                   // one number box per row, as always
      orderedList(q.rows || [], q, "rows").forEach(function (r) {
        var row = el("div", "nm-row");
        row.appendChild(itemLabelNode(r, "nm-label"));
        row.appendChild(numInput(q, r.code));
        if (anyNa) row.appendChild(naCell(q, r.code, naLabel, null));
        wrap.appendChild(row);
        if (r.comment && r.comment !== "none") {
          wrap.appendChild(commentBox(q.id, "c_" + r.code, r.comment, "Comment on " + pipeText(r.label)));
        }
      });
    } else {                                              // rows x columns
      var tbl = el("div", "nm-table");
      tbl.style.setProperty("--nm-cols", "minmax(140px,1.6fr) repeat(" + cols.length + ", minmax(110px,1fr))" + (anyNa ? " 74px" : ""));
      var head = el("div", "nm-tr nm-head");
      head.appendChild(el("div", "nm-th nm-corner", pipeText(g.row_label || "")));
      cols.forEach(function (c) { head.appendChild(itemLabelNode(c, "nm-th")); });
      if (anyNa) head.appendChild(el("div", "nm-th nm-th-na", naLabel));
      tbl.appendChild(head);
      orderedList(q.rows || [], q, "rows").forEach(function (r) {
        var row = el("div", "nm-tr");
        row.appendChild(itemLabelNode(r, "nm-th nm-rowlabel"));
        // typing into any cell of the row lifts an N/A tick on that row
        var clearNa = (function (rowEl, rowCode) {
          return function () {
            if ((answers[q.id] || {})[rowCode] !== "NA") return;
            setAns(q.id, rowCode, "");
            var nb = rowEl.querySelector(".na-cell input");
            if (nb) nb.checked = false;
          };
        })(row, r.code);
        cols.forEach(function (c) {
          var cell = el("div", "nm-td");
          cell.appendChild(numInput(q, r.code + "_" + c.code, clearNa));
          row.appendChild(cell);
        });
        if (anyNa) {
          var nc = el("div", "nm-td nm-td-na");
          // N/A stands in for the whole row: ticking it empties the cells
          nc.appendChild(naCell(q, r.code, naLabel, function (checked) {
            if (!checked) return;
            cols.forEach(function (c) { setAns(q.id, r.code + "_" + c.code, ""); });
            row.querySelectorAll(".nm-input").forEach(function (ni) { ni.value = ""; });
          }));
          row.appendChild(nc);
        }
        tbl.appendChild(row);
        if (r.comment && r.comment !== "none") {
          var crow = el("div", "nm-tr nm-cmtrow");
          crow.appendChild(commentBox(q.id, "c_" + r.code, r.comment, "Comment on " + pipeText(r.label)));
          tbl.appendChild(crow);
        }
      });
      wrap.appendChild(tbl);
    }
    if ((q.comments || {}).mode && q.comments.mode !== "none") wrap.appendChild(questionComment(q));
    return wrap;
  }

  function renderDelta(q) {
    var wrap = el("div", "delta");
    var a = answers[q.id] || {};
    var out = el("div", "delta-out");
    function paint() {
      var d = NaN;
      if (before.value !== "" && after.value !== "") d = parseFloat(after.value) - parseFloat(before.value);
      out.textContent = isFinite(d) ? (d >= 0 ? "+" : "") + d : "\u2014";
    }
    function sync() {
      setAns(q.id, "before", before.value);
      setAns(q.id, "after", after.value);
      var d = NaN;
      if (before.value !== "" && after.value !== "") d = parseFloat(after.value) - parseFloat(before.value);
      setAns(q.id, "delta", isFinite(d) ? d : "");
      paint(); hideErr(); ansChanged();
    }
    function cell(label, node, val) {
      var box = el("div", "delta-cell");
      var l = el("label", ""); l.textContent = label;
      node.value = val;
      node.addEventListener("input", sync);
      box.appendChild(l); box.appendChild(node);
      return box;
    }
    var before = el("input", ""); before.type = "number";
    var after = el("input", ""); after.type = "number";
    [before, after].forEach(function (i) {
      if (q.min !== undefined) i.min = q.min;
      if (q.max !== undefined) i.max = q.max;
    });
    wrap.appendChild(cell(q.before_label || "Before", before, a.before !== undefined ? a.before : ""));
    wrap.appendChild(cell(q.after_label || "After", after, a.after !== undefined ? a.after : ""));
    var outBox = el("div", "delta-cell");
    var ol = el("label", ""); ol.textContent = "Change";
    outBox.appendChild(ol); outBox.appendChild(out);
    wrap.appendChild(outBox);
    paint();
    return wrap;
  }

  function renderConceptTest(q) {
    var wrap = el("div", "concept-test");
    if (q.concept_html && window.BeaconQ) {
      var c = el("div", "concept-html");
      window.BeaconQ.richInto(c, q.concept_html, logicCtx(), q.concept || "\u2026");
      wrap.appendChild(c);
    } else if (q.concept) {
      var p = el("p", "concept"); p.textContent = q.concept;
      wrap.appendChild(p);
    }
    if (q.media && q.media.src) wrap.appendChild(renderMedia(q.media));
    var grid = renderGrid(q, false);
    if (grid) wrap.appendChild(grid);
    return wrap;
  }

  function renderLoop(q) {
    var wrap = el("div", "loopq");
    var a = answers[q.id] || {};
    (q.items || []).forEach(function (it) {
      var row = el("div", "loop-row");
      var lbl = el("div", "loop-label");
      lbl.textContent = (q.prompt_template || "{label}").replace("{label}", it.label);
      row.appendChild(lbl);
      var inp;
      if (q.child === "numeric") {
        inp = el("input", ""); inp.type = "number";
        if (q.min !== undefined) inp.min = q.min;
        if (q.max !== undefined) inp.max = q.max;
      } else {
        inp = el("textarea", "");
        inp.rows = q.text_rows || 2;
        inp.placeholder = q.placeholder || "";
      }
      inp.value = a[it.code] !== undefined ? a[it.code] : "";
      inp.addEventListener("input", function () { setAns(q.id, it.code, inp.value); hideErr(); });
      row.appendChild(inp);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function renderTextBlock(q) {
    var wrap = el("div", "textblock");
    if (q.body_html && window.BeaconQ) window.BeaconQ.richInto(wrap, q.body_html, logicCtx(), q.body || "");
    else { var p = el("p", ""); p.textContent = q.body || ""; wrap.appendChild(p); }
    return wrap;
  }

  // A choice grid: rows x columns, and every row picks one column (single select) or
  // several of them (multi select).  One value per row is stored - the column's code.
  function renderChoiceGrid(q) {
    var wrap = el("div", "grid choice-grid");
    var g = q.grid || {}, na = q.na || {}, naLabel = na.label || "N/A";
    var multi = q.select === "multi";
    var cols = orderedList(q.cols || [], q, "cols");
    var rows = orderedList(q.rows || [], q, "rows");
    wrap.style.setProperty("--cg-tmpl", "minmax(140px, 1.4fr) repeat(" + cols.length +
      ", minmax(44px, 1fr))" + (na.rows ? " minmax(64px, auto)" : ""));
    if (g.title) wrap.appendChild(el("div", "grid-title", pipeText(g.title)));

    var head = el("div", "cg-row cg-head");
    head.appendChild(el("div", "cg-corner", pipeText(g.row_label || "")));
    cols.forEach(function (c) { head.appendChild(itemLabelNode(c, "cg-col")); });
    if (na.rows) head.appendChild(el("div", "cg-col cg-col-na", ""));
    wrap.appendChild(head);

    rows.forEach(function (r) {
      var row = el("div", "cg-row");
      row.appendChild(itemLabelNode(r, "rlabel cg-rlabel"));
      var cur = (answers[q.id] || {})[r.code];
      var on = Array.isArray(cur) ? cur.map(String) : (cur === undefined || cur === "" ? [] : [String(cur)]);
      var isNa = cur === "NA";
      cols.forEach(function (c) {
        var cell = el("label", "cg-cell");
        var inp = el("input");
        inp.type = multi ? "checkbox" : "radio";
        inp.name = q.id + "_" + r.code;
        inp.checked = !isNa && on.indexOf(String(c.code)) >= 0;
        inp.addEventListener("change", function () {
          if (multi) {
            var have = getAns(q.id, r.code);
            have = Array.isArray(have) ? have.map(String) : [];
            var at = have.indexOf(String(c.code));
            if (inp.checked && at < 0) have.push(c.code);
            if (!inp.checked && at >= 0) have.splice(at, 1);
            setAns(q.id, r.code, have);
          } else {
            setAns(q.id, r.code, c.code);
          }
          var tick = row.querySelector(".cg-na input"); if (tick) tick.checked = false;
          if (inp.checked) bullseye(cell);
          hideErr(); ansChanged(); checkPattern(q, wrap);
        });
        cell.appendChild(inp);
        if (c.media && c.media.src) cell.title = pipeText(c.label);
        row.appendChild(cell);
      });
      if (na.rows) {
        var holder = el("div", "cg-cell cg-na");
        var nl = el("label", "na-cell");
        var ncb = el("input"); ncb.type = "checkbox";
        ncb.checked = isNa;
        ncb.addEventListener("change", function () {
          setAns(q.id, r.code, ncb.checked ? "NA" : "");
          Array.prototype.forEach.call(row.querySelectorAll(".cg-cell input"), function (x) {
            if (x !== ncb) x.checked = false;              // N/A clears every pick on the row
          });
          hideErr(); ansChanged();
        });
        nl.appendChild(ncb);
        nl.appendChild(el("span", null, naLabel));
        holder.appendChild(nl);
        row.appendChild(holder);
      }
      wrap.appendChild(row);
      if (r.comment && r.comment !== "none") wrap.appendChild(gridCommentRow(q, r, cols.length + 1));
    });
    if ((q.comments || {}).mode && q.comments.mode !== "none") wrap.appendChild(questionComment(q));
    return wrap;
  }

  function renderGrid(q, semantic) {
    if (q.cols && q.cols.length && !semantic) return renderChoiceGrid(q);   // rows x columns
    var wrap = el("div", "grid");
    var g = q.grid || {}, na = q.na || {}, naLabel = na.label || "N/A";
    var sc = q.scale || {}, min = sc.min != null ? Number(sc.min) : 1;
    var max = sc.max != null ? Number(sc.max) : 5;
    var pts = orderedList(scalePointsOf(q), q, "cols");
    if (g.title) wrap.appendChild(el("div", "grid-title", pipeText(g.title)));
    if (g.row_label || g.col_label || na.col || pts.some(function (p) { return p.label; })) {
      wrap.appendChild(gridHead(q, pts, na.col ? function (strip) {
        strip.appendChild(el("div", "grid-plabel grid-plabel-na", naLabel));
      } : null));
    }
    orderedList(q.rows || [], q, "rows").forEach(function (r) {
      var row = el("div", "grid-row");
      row.appendChild(itemLabelNode(r, "rlabel"));
      var cells = el("div", "grid-cells");
      if (semantic) {
        cells.style.cssText = "display:flex;align-items:center;gap:9px";
        cells.appendChild(el("span", "sem-left", String(r.left || "")));
      }
      var naTick = null;
      cells.appendChild(renderScale(min, max, getAns(q.id, r.code), function (v) {
        setAns(q.id, r.code, v);
        if (naTick) naTick.checked = false;              // a rating clears the N/A
        hideErr(); ansChanged(); checkPattern(q, wrap);
      }, pts));
      if (semantic) cells.appendChild(el("span", "sem-right", String(r.right || "")));
      if (na.rows || na.col) {
        var holder = el("div", "grid-nacell"), cell = naCell(q, r.code, naLabel, null);
        naTick = cell.querySelector("input");
        holder.appendChild(cell); cells.appendChild(holder);
      }
      row.appendChild(cells);
      wrap.appendChild(row);
      if (r.comment && r.comment !== "none") wrap.appendChild(gridCommentRow(q, r));
    });
    var allLabelled = pts.length && pts.every(function (p) { return p.label; });
    if (!allLabelled || sc.min_label || sc.max_label) {
      var ends = el("div", "scale-ends");
      ends.appendChild(el("span", null, String(sc.min_label || (pts[0] || {}).label || min)));
      ends.appendChild(el("span", null, String(sc.max_label || (pts[pts.length - 1] || {}).label || max)));
      wrap.appendChild(ends);
    }
    if ((q.comments || {}).mode && q.comments.mode !== "none") wrap.appendChild(questionComment(q));
    return wrap;
  }

  // A rating scale: rows rated on one scale, labelled at the low end, the middle and the
  // high end.  The three anchor labels sit under the scale once, below all the rows.
  function renderRatingScale(q) {
    var wrap = el("div", "grid rating-scale");
    var sc = q.scale || {}, min = sc.min != null ? Number(sc.min) : 1;
    var max = sc.max != null ? Number(sc.max) : 5;
    orderedList(q.rows || [], q, "rows").forEach(function (r) {
      var row = el("div", "grid-row");
      row.appendChild(itemLabelNode(r, "rlabel"));
      var cells = el("div", "grid-cells");
      cells.appendChild(renderScale(min, max, getAns(q.id, r.code), function (v) {
        setAns(q.id, r.code, v);
        hideErr(); ansChanged(); checkPattern(q, wrap);
      }, null));
      row.appendChild(cells);
      wrap.appendChild(row);
    });
    var ends = el("div", "scale-ends rs-ends");
    ends.appendChild(el("span", "rs-end-low", pipeText(sc.min_label) || String(min)));
    if (sc.mid_label) ends.appendChild(el("span", "rs-end-mid", pipeText(sc.mid_label)));
    ends.appendChild(el("span", "rs-end-high", pipeText(sc.max_label) || String(max)));
    wrap.appendChild(ends);
    return wrap;
  }

  // An emoji grid: the same shape as a rating grid, but each scale point is a face to tap.

  function renderEmojiGrid(q) {
    var wrap = el("div", "grid emoji-grid");
    var g = q.grid || {}, na = q.na || {}, naLabel = na.label || "N/A";
    var pts = orderedList(scalePointsOf(q), q, "cols");
    if (g.title) wrap.appendChild(el("div", "grid-title", pipeText(g.title)));
    if (g.row_label || g.col_label || na.col) {
      wrap.appendChild(gridHead(q, pts, na.col ? function (strip) {
        strip.appendChild(el("div", "grid-plabel grid-plabel-na", naLabel));
      } : null));
    }
    orderedList(q.rows || [], q, "rows").forEach(function (r) {
      var row = el("div", "grid-row");
      row.appendChild(itemLabelNode(r, "rlabel"));
      var cells = el("div", "grid-cells emoji-cells");
      var faces = [];
      pts.forEach(function (p) {
        var b = el("button", "emoji-btn");
        b.type = "button";
        b.appendChild(el("span", "emoji-face", pipeText(p.label || String(p.v))));
        if (p.media && p.media.src) b.appendChild(renderMedia(p.media, "qmedia-xs"));
        if (p.tip) b.title = p.tip;
        b.classList.toggle("on", String(getAns(q.id, r.code)) === String(p.v));
        b.addEventListener("click", function () {
          setAns(q.id, r.code, p.v);
          faces.forEach(function (x) { x.classList.remove("on"); });
          b.classList.add("on");
          var tick = row.querySelector(".na-cell input"); if (tick) tick.checked = false;
          hideErr(); ansChanged();
        });
        faces.push(b);
        cells.appendChild(b);
      });
      if (na.rows || na.col) {
        var holder = el("div", "grid-nacell");
        holder.appendChild(naCell(q, r.code, naLabel, null));
        cells.appendChild(holder);
      }
      row.appendChild(cells);
      wrap.appendChild(row);
      if (r.comment && r.comment !== "none") wrap.appendChild(gridCommentRow(q, r));
    });
    if ((q.comments || {}).mode && q.comments.mode !== "none") wrap.appendChild(questionComment(q));
    return wrap;
  }

  // A heat map: rows x columns, tap a cell to raise how strongly it applies (0 - 3).

  function renderHeatmap(q) {
    var wrap = el("div", "heatmap");
    var g = q.grid || {};
    var cols = orderedList(q.cols || [], q, "cols");
    if (g.title) wrap.appendChild(el("div", "grid-title", pipeText(g.title)));
    var tbl = el("div", "hm-table");
    tbl.style.setProperty("--hm-cols", "minmax(120px,1.5fr) repeat(" + cols.length + ", minmax(74px,1fr))");
    var head = el("div", "hm-tr hm-head");
    head.appendChild(el("div", "hm-th hm-corner", pipeText(g.row_label || "")));
    cols.forEach(function (c) { head.appendChild(itemLabelNode(c, "hm-th")); });
    tbl.appendChild(head);
    orderedList(q.rows || [], q, "rows").forEach(function (r) {
      var row = el("div", "hm-tr");
      row.appendChild(itemLabelNode(r, "hm-th hm-rowlabel"));
      cols.forEach(function (c) {
        var key = r.code + "_" + c.code;
        var lvl = Number((answers[q.id] || {})[key] || 0);
        var cell = el("button", "hm-cell");
        cell.type = "button";
        cell.dataset.lvl = String(lvl);
        cell.title = pipeText(r.label) + " \\u00D7 " + pipeText(c.label);
        cell.setAttribute("aria-label", cell.title);
        var mark = el("span", "hm-mark", lvl ? String(lvl) : "");
        cell.appendChild(mark);
        cell.addEventListener("click", function () {
          var next = (Number(cell.dataset.lvl || 0) + 1) % 4;      // tap cycles 0 -> 1 -> 2 -> 3 -> 0
          cell.dataset.lvl = String(next);
          mark.textContent = next ? String(next) : "";
          setAns(q.id, key, next || "");
          hideErr(); ansChanged();
        });
        row.appendChild(cell);
      });
      tbl.appendChild(row);
      if (r.comment && r.comment !== "none") {
        var crow = el("div", "hm-tr hm-cmtrow");
        crow.appendChild(commentBox(q.id, "c_" + r.code, r.comment, "Comment on " + pipeText(r.label)));
        tbl.appendChild(crow);
      }
    });
    wrap.appendChild(tbl);
    wrap.appendChild(el("div", "hm-legend",
      "Tap a cell once for weak, twice for moderate, three times for strong \\u00B7 tap again to clear."));
    if ((q.comments || {}).mode && q.comments.mode !== "none") wrap.appendChild(questionComment(q));
    return wrap;
  }

  // A numeric matrix: one number box per row, or a whole table of them once it has columns.

  // Gentle, in-the-moment nudge when every row carries the same rating.
  // Never blocks, never penalises - it just asks for a second look.
  function checkPattern(q, wrap) {
    var a = answers[q.id] || {};
    var vals = q.rows.map(function (r) { return a[r.code]; })
                     .filter(function (v) { return v !== undefined; });
    if (vals.length < q.rows.length || vals.length < 5) return;
    var uniq = {};
    vals.forEach(function (v) { uniq[v] = 1; });
    if (Object.keys(uniq).length === 1 && !wrap.dataset.nudged) {
      wrap.dataset.nudged = "1";
      wrap.classList.remove("ripple");
      void wrap.offsetWidth;
      wrap.classList.add("ripple");
      coachSay("Every row currently carries the same rating. If that is your true view, " +
        "perfect - otherwise a quick second look keeps your input accurate.", "warn");
    }
  }

  function renderSum100(q) {
    var wrap = el("div", "grid");
    var total = el("div", "s100-total");
    var totalVal = el("strong", null, "0");
    var inputs = [];
    var isPoints = q.help && q.help.indexOf("points") >= 0;

    function recompute() {
      var s = 0;
      inputs.forEach(function (i) { s += parseInt(i.value, 10) || 0; });
      totalVal.textContent = s + (isPoints ? " pts" : "%");
      total.className = "s100-total " + (s === 100 ? "ok" : "bad");
      if (s === 100) hideErr();
      return s;
    }

    orderedList(q.rows, q).forEach(function (r) {
      var row = el("div", "s100-row");
      row.appendChild(itemLabelNode(r, "rlabel"));
      var inp = el("input");
      inp.type = "number"; inp.min = 0; inp.max = 100; inp.step = 1;
      var v = getAns(q.id, r.code);
      inp.value = (v === undefined) ? "" : v;
      inp.addEventListener("input", function () {
        setAns(q.id, r.code, inp.value === "" ? "" : parseInt(inp.value, 10));
        ansChanged();
        recompute();
      });
      inputs.push(inp);
      row.appendChild(inp);
      wrap.appendChild(row);
    });
    total.appendChild(el("span", null, "Total (must equal 100)"));
    total.appendChild(totalVal);
    wrap.appendChild(total);
    recompute();
    return wrap;
  }

  function renderRank(q) {
    var order = getAns(q.id, "order") || orderedList(q.rows, q).map(function (r) { return r.code; });
    var wrap = el("div", "rank-list");
    var top = q.rank_count || 3;

    function paint() {
      wrap.innerHTML = "";
      order.forEach(function (code, i) {
        var r = q.rows.filter(function (x) { return x.code === code; })[0];
        var item = el("div", "rank-item" + (i < top ? " top" : ""));
        item.appendChild(el("span", "pos", String(i + 1)));
        item.appendChild(itemLabelNode(r, "rank-label"));
        var ar = el("div", "arrows");
        var up = el("button", null, "&#9650;"), dn = el("button", null, "&#9660;");
        up.type = dn.type = "button";
        up.disabled = i === 0; dn.disabled = i === order.length - 1;
        up.addEventListener("click", function () { move(i, -1); });
        dn.addEventListener("click", function () { move(i, 1); });
        ar.appendChild(up); ar.appendChild(dn);
        item.appendChild(ar);
        wrap.appendChild(item);
      });
      setAns(q.id, "order", order.slice());
      ansChanged();
      hideErr();
    }
    function move(i, d) {
      var j = i + d;
      if (j < 0 || j >= order.length) return;
      var t = order[i]; order[i] = order[j]; order[j] = t;
      paint();
    }
    paint();
    return wrap;
  }

  // ---- conjoint as cards, with a minimum dwell gate ----
  var ATTR_ICON = { OS: "\u23F3", PFS12: "\uD83D\uDCC8", AE: "\u26A0\uFE0F", ROUTE: "\uD83D\uDC89",
                    CDX: "\uD83E\uDDEC", COST: "\uD83D\uDCB2", ACCESS: "\uD83C\uDFE5" };
  // The design may carry its own labels (an author-defined attribute); fall back to the
  // wording the seeded BEACON instrument uses, then to the raw id.
  var ATTR_LABEL = { OS: "Median OS vs standard of care", PFS12: "12-month PFS",
                     AE: "Grade 3+ adverse events", ROUTE: "Administration",
                     CDX: "Companion diagnostic", COST: "Net 12-month cost",
                     ACCESS: "Payer access at month 1" };
  function attrLabel(attr) {
    var id = typeof attr === "string" ? attr : (attr && attr.id);
    var own = typeof attr === "object" && attr && String(attr.label || "").trim();
    if (own && own !== id) return own;
    return ATTR_LABEL[id] || id;
  }
  // A generated design stores tasks as a list; the seeded one keys them by task number.
  function taskAt(tid) {
    if (!CONJOINT || !CONJOINT.tasks) return [];
    var t = CONJOINT.tasks;
    if (Array.isArray(t)) return t[Number(tid)] || [];
    return t[String(tid)] || [];
  }
  function taskIds() {
    var t = (CONJOINT && CONJOINT.tasks) || [];
    return Array.isArray(t) ? t.map(function (_, i) { return i; }) : Object.keys(t).map(Number);
  }
  // The level an alternative shows for one attribute. Designs store levels positionally
  // (aligned to CONJOINT.attributes, null when a group-inclusion attribute is hidden in this
  // task) or keyed by attribute id; both are read here so a design always renders.
  function altLevel(alt, attr, ai) {
    var lv = (alt && alt.levels) || alt || [];
    if (!Array.isArray(lv) && typeof lv === "object") return lv[attr.id];
    return lv[ai];
  }
  // kept in step with profile_levels() in core/conjoint.py

  function renderConjoint(step) {
    var q = step.q;
    var tid = step.taskId;
    var alts = taskAt(tid);
    var positions = (SESSION.alt_positions && SESSION.alt_positions[String(tid)]) ||
                    [1, 2, 3];
    var chosen = getAns(q.id, "T" + tid);

    var wrap = el("div");
    wrap.appendChild(el("div", "task-count", "Choice task " + step.slot + " of " + step.total));
    wrap.appendChild(el("div", "vignette", "<strong>Patient:</strong> " + q.vignette));
    wrap.appendChild(guideBar(function () { return taskSpeechText(step); }));

    var cards = el("div", "alt-cards");
    positions.forEach(function (altId) {
      var alt = alts[altId - 1];
      var card = el("div", "alt-card" + (String(chosen) === String(altId) ? " sel" : ""));
      var head = el("div", "alt-head");
      head.appendChild(el("span", "alt-tick", "&#10003;"));
      head.appendChild(el("span", null, "Treatment " + altId));
      card.appendChild(head);

      var rows = el("div", "alt-rows");
      CONJOINT.attributes.forEach(function (attr, ai) {
        // a group-inclusion attribute is absent from some tasks - the design stores null for it
        var lv = altLevel(alt, attr, ai);
        if (lv === null || lv === undefined) return;
        var r = el("div", "alt-row");
        r.appendChild(el("span", "ico", ATTR_ICON[attr.id] || "\u2022"));
        var t = el("span", "txt");
        t.appendChild(el("span", "lbl", attrLabel(attr)));
        var val = (attr.levels || [])[lv];
        var pic = (attr.images || [])[lv];
        if (pic) {
          var im = el("img", "alt-level-img");
          im.src = pic; im.alt = "";
          r.appendChild(im);
        }
        t.appendChild(document.createTextNode(val == null ? "" : String(val)));
        r.appendChild(t);
        rows.appendChild(r);
      });
      card.appendChild(rows);

      card.addEventListener("click", function () {
        setAns(q.id, "T" + tid, altId);
        cards.querySelectorAll(".alt-card").forEach(function (c) { c.classList.remove("sel"); });
        card.classList.add("sel");
        if (optout) optout.classList.remove("sel");   // there is no opt-out card when Allow "none" is off
        hideErr();
      });
      cards.appendChild(card);
    });
    wrap.appendChild(cards);

    // "None of these" is only offered when the experiment allows it (Allow "none" in Studio)
    if (CONJOINT.has_opt_out !== false) {
      var optout = el("div", "optout-card" + (String(chosen) === "0" ? " sel" : ""));
      optout.appendChild(el("span", "alt-tick", "&#10003;"));
      optout.appendChild(el("span", null, String(q.opt_out_label || CONJOINT.none_label || "None of these")));
      optout.addEventListener("click", function () {
        setAns(q.id, "T" + tid, 0);
        optout.classList.add("sel");
        cards.querySelectorAll(".alt-card").forEach(function (c) { c.classList.remove("sel"); });
        hideErr();
      });
      wrap.appendChild(optout);
    }

    // dwell gate: the respondent must actually look at the profiles. Started by render()
    // after the nav exists, otherwise there is a brief window where Next is still clickable.
    var dwell = el("div", "dwell");
    dwell.innerHTML =
      '<svg class="dwell-ring" viewBox="0 0 22 22">' +
      '<circle class="bg" cx="11" cy="11" r="9"/>' +
      '<circle class="fg" cx="11" cy="11" r="9"/></svg>' +
      '<span class="dwell-txt"></span>';
    wrap.appendChild(dwell);
    pendingDwell = dwell;

    return wrap;
  }

  function startDwell(node) {
    var fg = node.querySelector(".fg");
    var txt = node.querySelector(".dwell-txt");
    dwellStart = Date.now();
    if (dwellTimer) clearInterval(dwellTimer);

    // returns true while the gate is still closed
    function frame() {
      var spent = (Date.now() - dwellStart) / 1000;
      var left = Math.max(0, MIN_DWELL - spent);
      var pct = Math.min(1, spent / MIN_DWELL);
      fg.style.strokeDashoffset = String(56.5 * (1 - pct));
      if (left > 0) {
        txt.textContent = "Take a moment to weigh the options \u2014 " +
          Math.ceil(left) + "s before you can continue";
        node.classList.remove("done");
        lockNext(true);
        return true;
      }
      txt.textContent = "Ready when you are.";
      node.classList.add("done");
      lockNext(false);
      return false;
    }

    if (frame()) {
      dwellTimer = setInterval(function () {
        if (!frame()) { clearInterval(dwellTimer); dwellTimer = null; }
      }, 250);
    }
  }

  function lockNext(locked) {
    var b = document.querySelector(".nav .btn.primary");
    if (b) { b.disabled = locked; b.title = locked ? "Please review the options" : ""; }
  }
  function unlockNext() { lockNext(false); }

  function pipeText(t) { return window.BeaconQ ? window.BeaconQ.pipe(t, logicCtx(), "…") : String(t == null ? "" : t); }

  function renderStem(q) {
    var h = el("h2", "stem");
    if (q.hide_number !== true) h.appendChild(el("span", "qnum", q.id + ". "));
    var body = el("span", "stem-text");
    if (q.stem_html && window.BeaconQ) window.BeaconQ.richInto(body, q.stem_html, logicCtx(), "…");
    else body.textContent = pipeText(q.stem);
    h.appendChild(body);
    if (q.style) {
      var st = q.style;
      if (st.font) h.style.fontFamily = st.font;
      if (st.size) h.style.fontSize = st.size;
      if (st.align) h.style.textAlign = st.align;
      if (st.color) h.style.color = st.color;
    }
    return h;
  }

  function renderMedia(m, cls) {
    var box = el("div", "qmedia" + (cls ? " " + cls : "") + (m.align ? " qmedia-" + m.align : ""));
    var node;
    if (m.kind === "video") {
      node = el("video"); node.controls = true; node.src = m.src; node.preload = "metadata";
      if (m.autoplay) { node.autoplay = true; node.muted = true; }
    } else if (m.kind === "audio") {
      node = el("audio"); node.controls = true; node.src = m.src; node.preload = "metadata";
    } else {
      node = el("img"); node.src = m.src; node.alt = m.alt || "";
    }
    if (m.width) node.style.maxWidth = /%|px/.test(String(m.width)) ? String(m.width) : m.width + "px";
    box.appendChild(node);
    if (m.caption) box.appendChild(el("div", "qmedia-cap", null)).textContent = pipeText(m.caption);
    return box;
  }

  function renderQuestion(q) {
    // Which section a question sits in (screeners, main, ...) is research-team information and
    // is never shown to the respondent - not on the card, not in the progress strip. Section
    // titles stay visible in the Studio outline, where the team needs them.
    var card = el("div", "card");

    if (q.comprehension) {
      card.appendChild(el("div", "cc-banner",
        "\uD83D\uDCA1 Quick check \u2014 this confirms the profile was clear. " +
        "It does not affect your participation."));
    }
    card.appendChild(renderStem(q));
    if (q.help_html || q.help) {
      var hp = el("div", "help");
      if (q.help_html && window.BeaconQ) window.BeaconQ.richInto(hp, q.help_html, logicCtx(), "…");
      else hp.textContent = pipeText(q.help);
      card.appendChild(hp);
    }
    if (q.media && q.media.src) card.appendChild(renderMedia(q.media));
    card.appendChild(guideBar(function () { return qSpeechText(q); }));

    var body;
    switch (q.type) {
      case "single_select": body = renderOptions(q, false); break;
      case "multi_select": body = renderOptions(q, true); break;
      case "date": body = renderDate(q); break;
      case "numeric_matrix": body = renderNumMatrix(q); break;
      case "heatmap": body = renderHeatmap(q); break;
      case "emoji_grid": body = renderEmojiGrid(q); break;
      case "delta": body = renderDelta(q); break;
      case "concept_test": body = renderConceptTest(q); break;
      case "loop": body = renderLoop(q); break;
      case "text_block": body = renderTextBlock(q); break;
      case "rating_grid": body = renderGrid(q, false); break;
      case "semantic_diff": body = renderGrid(q, true); break;
      case "rating_scale": body = renderRatingScale(q); break;
      case "sum_to_100": body = renderSum100(q); break;
      case "rank": body = renderRank(q); break;
      case "numeric": {
        var row = el("div", "num-row");
        if (q.prefix) row.appendChild(el("span", "pre", String(q.prefix)));
        var inp = el("input");
        inp.type = "number"; inp.min = q.min; inp.max = q.max; inp.step = 1;
        var v = getAns(q.id, "_");
        inp.value = v === undefined ? "" : v;
        inp.addEventListener("input", function () {
          setAns(q.id, "_", inp.value === "" ? "" : Number(inp.value)); hideErr(); ansChanged();
        });
        row.appendChild(inp);
        if (q.suffix) row.appendChild(el("span", "suf", String(q.suffix)));
        body = row;
        break;
      }
      case "slider": {
        body = el("div");
        var val = getAns(q.id, "_");
        if (val === undefined) val = Math.round((q.min + q.max) / 2);
        var out = el("div", "slider-val", String(val) + (q.suffix || ""));
        var rng = el("input");
        rng.type = "range"; rng.min = q.min; rng.max = q.max; rng.step = q.step || 1;
        rng.value = val;
        setAns(q.id, "_", Number(val));
        ansChanged();
        rng.addEventListener("input", function () {
          out.textContent = rng.value + (q.suffix || "");
          setAns(q.id, "_", Number(rng.value)); hideErr(); ansChanged();
        });
        var ends = el("div", "slider-ends");
        ends.appendChild(el("span", null, String(q.min_label || q.min)));
        ends.appendChild(el("span", null, String(q.max_label || q.max)));
        body.appendChild(out); body.appendChild(rng); body.appendChild(ends);
        break;
      }
      case "open_text": {
        var ta = el("textarea");
        ta.placeholder = q.placeholder || "Type your answer here...";
        ta.value = getAns(q.id, "_") || "";
        var chip = el("div", "oq-chip");
        var aiBox = el("div", "ai-actions");
        body = el("div");
        body.appendChild(ta);
        body.appendChild(chip);
        body.appendChild(aiBox);
        body.appendChild(recorderFor(q));
        wireTextWatch(q, ta, chip, aiBox);
        break;
      }
    }
    card.appendChild(body);

    if (q.comprehension) card.appendChild(buildCcFeedback(q));
    return card;
  }

  function buildCcFeedback(q) {
    var box = el("div", "cc-feedback");
    var correct = q.comprehension.correct;
    var prev = getAns(q.id, "_");
    if (prev !== undefined) showCc(prev);
    return box;

    function showCc(val) {
      var ok = String(val) === String(correct);
      box.className = "cc-feedback show " + (ok ? "ok" : "retry");
      box.innerHTML = ok
        ? "<strong>That is right.</strong> The profile is clear \u2014 let's carry on."
        : "<strong>Worth another look.</strong> That is not quite what the profile said. " +
          "You can replay the walkthrough before answering the rest.";
      if (!ok) {
        var b = el("button", "btn", "\u25B6 Replay the product walkthrough");
        b.type = "button";
        b.addEventListener("click", function () { runExplainer(SCENES, function () {}); });
        box.appendChild(b);
      } else if (!box.dataset.awarded) {
        box.dataset.awarded = "1";
        addPoints(25);
      }
    }
    // re-check whenever the answer changes
    var poll = setInterval(function () {
      if (!document.body.contains(box)) { clearInterval(poll); return; }
      var v = getAns(q.id, "_");
      if (v !== undefined && String(v) !== box.dataset.seen) {
        box.dataset.seen = String(v);
        showCc(v);
      }
    }, 400);
  }

  // ============================================================ validation
  function showErr(msg) { var e = $(PREVIEW ? ".prev-err" : "#err"); if (e) { e.textContent = msg; e.classList.add("show"); } }
  function hideErr() { var e = $(PREVIEW ? ".prev-err" : "#err"); if (e) e.classList.remove("show"); }

  // A comment box can be required outright, required when named rows are answered, or
  // required on a row of its own.  Nothing else is blocked - only the box itself.
  function missingComment(q) {
    var a = answers[q.id] || {}, c = q.comments || {}, need = [];
    function blank(v) { return !String(v || "").trim(); }
    var wanted = c.mode === "require";
    if (!wanted && (c.require_when || []).length) {
      wanted = (c.require_when || []).some(function (code) {
        var v = a[code];
        return v !== undefined && v !== "" && v !== "NA";
      });
    }
    if (wanted && blank(a._comment)) return "Please add a comment before continuing.";
    (q.rows || []).forEach(function (r) {
      if (a[r.code] === "NA") return;               // N/A rows carry nothing to comment on
      if (r.comment === "require" && blank(a["c_" + r.code])) need.push(pipeText(r.label));
    });
    if (need.length) return "Please add a comment for " + need.join(", ") + ".";
    return null;
  }

  function validateStep() {
    var st = steps[cur];
    if (st.kind === "task") {
      if (getAns(st.q.id, "T" + st.taskId) === undefined) {
        showErr("Please choose one of the treatments, or choose to continue current standard of care.");
        return false;
      }
      if (dwellTimer) {
        showErr("Please take a moment to review the options before continuing.");
        return false;
      }
      return true;
    }
    var q = st.q;
    if (q.required && !answered(q)) {
      showErr("This question is required.");
      return false;
    }
    if (q.type === "sum_to_100") {
      var a = answers[q.id] || {}, s = 0;
      q.rows.forEach(function (r) { s += parseInt(a[r.code], 10) || 0; });
      if (s !== 100) { showErr("The total must equal 100 (currently " + s + ")."); return false; }
    }
    if (q.type === "numeric" && q.required) {
      var n = Number(getAns(q.id, "_"));
      if (isNaN(n) || n < q.min || n > q.max) {
        showErr("Please enter a value between " + q.min + " and " + q.max + "."); return false;
      }
    }
    if (q.type === "numeric_matrix") {
      var na = answers[q.id] || {}, nmCells = [], nmCols = q.cols || [];
      (q.rows || []).forEach(function (rr) {
        if (nmCols.length) nmCols.forEach(function (cc) {
          nmCells.push([rr.label + " \u00D7 " + cc.label, rr.code + "_" + cc.code]); });
        else nmCells.push([rr.label, rr.code]);
      });
      for (var ri = 0; ri < nmCells.length; ri++) {
        var rv = na[nmCells[ri][1]], rname = nmCells[ri][0];
        if (rv === undefined || rv === "" || rv === "NA") continue;
        if (!isNum(rv)) { showErr(rname + ": please enter a number."); return false; }
        if (q.min !== undefined && parseFloat(rv) < q.min) { showErr(rname + " must be at least " + q.min + "."); return false; }
        if (q.max !== undefined && parseFloat(rv) > q.max) { showErr(rname + " must be at most " + q.max + "."); return false; }
      }
    }
    var cmtErr = missingComment(q);
    if (cmtErr) { showErr(cmtErr); return false; }
    if (q.type === "delta") {
      var da = answers[q.id] || {}, need = ["before", "after"];
      for (var di = 0; di < 2; di++) {
        var dv = da[need[di]];
        if (dv === undefined || dv === "") continue;
        if (!isNum(dv)) { showErr("Please enter numbers only."); return false; }
        if (q.min !== undefined && parseFloat(dv) < q.min) { showErr("Values must be at least " + q.min + "."); return false; }
        if (q.max !== undefined && parseFloat(dv) > q.max) { showErr("Values must be at most " + q.max + "."); return false; }
      }
    }
    if (q.type === "loop" && q.child === "numeric") {
      var la = answers[q.id] || {};
      for (var li = 0; li < (q.items || []).length; li++) {
        var lv = la[q.items[li].code];
        if (lv !== undefined && lv !== "" && !isNum(lv)) { showErr(q.items[li].label + ": please enter a number."); return false; }
      }
    }
    if (q.type === "open_text" && q.required && q.min_words) {
      var words = String(getAns(q.id, "_") || "").trim().split(/\s+/).filter(Boolean);
      if (words.length < q.min_words) {
        showErr("Please write at least " + q.min_words + " words."); return false;
      }
    }
    if (q.type === "open_text" && aiActionOf(q) === "confirm") {
      var ai = (answers[q.id] || {})._ai;
      if (ai && ai.verdict === "likely_ai" && !ai.ack) {
        showErr("Our quality check reads this answer as AI-written or pasted. Please write it " +
                "in your own words, or confirm that you wrote it yourself.");
        return false;
      }
    }
    return true;
  }

  // ============================================================ screening
  // Screening is data, never code: every question can carry its own screen-in /
  // screen-out rules (see BeaconQ.screening in qlogic.js).  Nothing about a study's
  // quotas is hard-coded here any more - the rules travel with the questionnaire.
  function screenOut(v) {
    stopNarration();
    var qid = v.qid || (steps[cur] && steps[cur].q.id) || "";
    save({ screened_out: true, screen_out_reason: v.reason, screen_out_at: qid });
    var card = el("div", "card");
    card.appendChild(el("div", "done-icon stop", "&#10005;"));
    card.appendChild(el("h1", null, "End of survey"));
    card.appendChild(el("p", null, String(v.message || SPEC.terminate_text)));
    card.appendChild(el("div", "summary", "Screened out at <code>" + qid +
      "</code> &middot; reference <code>" + SESSION.respondent_code + "</code>"));
    show(card, true);
    setAnswering(false);                           // project bar returns on the closing screen
    $("#progress-wrap").style.display = "none";
    $("#hud").hidden = true;
    $("#tpp-panel").hidden = true;
  }

  // Evaluate every screening rule in the study.  phase "live" only looks at the rules
  // marked to fire the moment they match; the Next button checks everything.
  function evaluateScreening(phase) {
    if (!window.BeaconQ || !window.BeaconQ.screeningVerdict) return null;
    // questions, not steps: every conjoint task belongs to the same question
    var idx = SPEC.questions.indexOf(steps[cur].q);
    return window.BeaconQ.screeningVerdict(
      SPEC.questions, answers,
      { phase: phase, upto: idx < 0 ? SPEC.questions.length - 1 : idx });
  }
  function screeningHit(phase) {
    if (window.BEACON_PREVIEW_MODE) return null;   // the Studio test view never ends the survey
    var v = evaluateScreening(phase);
    if (v) screenOut(v);
    return v;
  }
  // Fires after every answer the respondent gives.  Rules set to "as soon as it matches"
  // end the survey there and then; the rest wait for Next.
  function ansChanged() { return screeningHit("live"); }

  // ============================================================ navigation
  // ============================================================ respondent chrome
  // The project information (brand, study name, respondent code, timer), the gamification HUD and
  // the progress strip are shown on the welcome and closing screens only.  They are hidden for as
  // long as a question is on screen, so nothing competes with it.  See `.answering` in survey.css.
  function setAnswering(on) { document.body.classList.toggle("answering", !!on); }

  function show(node, replace) {
    var app = $("#app");
    app.innerHTML = "";
    app.appendChild(node);
    if (!replace) {
      var nav = el("div", "nav");
      var back = el("button", "btn ghost", "&larr; Back");
      back.type = "button";
      back.disabled = nextVisible(cur, -1) < 0;
      back.addEventListener("click", function () { var pv = nextVisible(cur, -1); if (pv >= 0) go(pv); });
      var last = nextVisible(cur, 1) < 0;
      var fwd = el("button", "btn primary", last ? "Submit survey" : "Next &rarr;");
      fwd.type = "button";
      fwd.addEventListener("click", next);
      nav.appendChild(back);
      if (IS_TEST) {
        var jumpWrap = el("label", "test-jump-inline");
        jumpWrap.innerHTML = '<span>Jump to</span>';
        var jump = el("select"); jump.setAttribute("aria-label", "Jump to any survey question");
        steps.forEach(function (s, i) {
          var o = document.createElement("option"), done = answers[s.q.id] && Object.keys(answers[s.q.id]).some(function(k){ return k.charAt(0) !== "_"; });
          o.value = i; o.selected = i === cur;
          o.textContent = (done ? "✓ " : "") + s.q.id + " · " + String(s.q.stem || "Choice task").slice(0, 46);
          jump.appendChild(o);
        });
        jump.addEventListener("change", function () { save(); go(Number(this.value)); });
        jumpWrap.appendChild(jump); nav.appendChild(jumpWrap);
      }
      nav.appendChild(fwd);
      app.appendChild(nav);
      var err = el("div", "err"); err.id = "err";
      app.appendChild(err);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // When the respondent is on a translated (child) survey, they can flip any single
  // question back to the original wording - or back again - with the chip in the header.
  function locQ(q) {
    var dt = SPEC.default_text;
    if (!dt || !ORIG[q.id]) return q;
    var c = JSON.parse(JSON.stringify(q));
    function g(k) { return dt["q:" + q.id + ":" + k]; }
    ["stem_html", "help_html", "placeholder", "vignette", "concept", "concept_html",
     "body", "body_html", "before_label", "after_label"].forEach(function (k) {
      var t = g(k);
      if (t !== undefined) c[k] = t;
    });
    if (g("stem_html")) c.stem = (window.BeaconQ ? window.BeaconQ.stripTags(g("stem_html")) : g("stem_html"));
    (c.options || []).forEach(function (o) { var t = g("opt:" + o.code); if (t !== undefined) o.label = t; });
    (c.rows || []).forEach(function (r) { var t = g("row:" + r.code); if (t !== undefined) r.label = t; });
    (c.cols || []).forEach(function (r) { var t = g("col:" + r.code); if (t !== undefined) r.label = t; });
    (c.items || []).forEach(function (it) { var t = g("loopitem:" + it.code); if (t !== undefined) it.label = t; });
    if (c.scale) {
      ["min_label", "max_label"].forEach(function (k) { var t = g(k); if (t !== undefined) c.scale[k] = t; });
      (c.scale.face_labels || []).forEach(function (f, i) { var t = g("face:" + i); if (t !== undefined) c.scale.face_labels[i] = t; });
    }
    return c;
  }

  function langChip(q) {
    var dt = SPEC.default_text;
    if (!dt || !Object.keys(dt).length || SPEC.render_language === SPEC.default_language) return null;
    var meta = null;
    (SPEC.languages || []).forEach(function (l) { if (l.code === SPEC.render_language) meta = l; });
    var chip = el("button", "i18n-chip");
    chip.type = "button";
    chip.title = "Switch just this question between " + (meta ? meta.native : SPEC.render_language) + " and the original";
    chip.textContent = ORIG[q.id] ? "\u21C4 " + (meta ? meta.native : "translated") : "\u21C4 original";
    chip.addEventListener("click", function () {
      ORIG[q.id] = !ORIG[q.id];
      render();
    });
    return chip;
  }

  function renderTestConsole() {
    if (!IS_TEST) return;
    var box = document.getElementById("test-console"); if (!box || !steps.length) return;
    box.hidden = false;
    var opts = steps.map(function(s,i){ var done = answers[s.q.id] && Object.keys(answers[s.q.id]).some(function(k){return k.charAt(0)!=='_';}); return '<option value="'+i+'"'+(i===cur?' selected':'')+'>'+ (done?'✓ ':'') + escHtml(s.q.id + ' · ' + String(s.q.stem || 'Choice task').slice(0,55)) + '</option>';}).join('');
    var qid = steps[cur].q.id;
    // screening: the rules on this question and what they do to this respondent right now
    var scrBits = "";
    if (window.BeaconQ && window.BeaconQ.screenSummary) {
      var scrLines = window.BeaconQ.screenSummary(steps[cur].q, SPEC.questions);
      if (scrLines.length) {
        var scrV = window.BeaconQ.screeningVerdict(SPEC.questions, answers,
                     { upto: SPEC.questions.indexOf(steps[cur].q) });
        scrBits = '<div class="tc-screen"><b>Screening</b>' + scrLines.map(function (l) {
          return "<span>" + escHtml(l.text) + " <em>" + (l.when === "live" ? "on the spot" : "on Next") + "</em></span>";
        }).join("") + "<i>" + (scrV
          ? "This respondent would be screened out here - " + escHtml(scrV.reason)
          : "This respondent continues.") + "</i></div>";
      }
    }
    box.innerHTML = '<div class="tc-head"><b>Test workspace</b><span>Not shown to respondents</span><button id="tc-collapse">−</button></div><div class="tc-current">Reviewing <b>'+escHtml(qid)+'</b> · use <i>Jump to</i> beside Next to navigate</div>' + scrBits + '<div class="tc-actions"><button id="tc-ai">✦ AI fill test answers</button><a href="/studio/#'+encodeURIComponent(STUDY.slug)+'" target="_blank">Edit in Studio ↗</a></div><label>Review note for '+escHtml(qid)+'<textarea id="tc-note" placeholder="Describe an error, wording issue or logic discrepancy…">'+escHtml(testNotes[qid] || '')+'</textarea></label><button class="tc-save" id="tc-share">Save notes & copy review link</button><small id="tc-state">The link preserves answers, position and notes for your team.</small>';
    $("#tc-note").oninput=function(){ testNotes[qid]=this.value; store('test_notes',testNotes); };
    $("#tc-ai").onclick=aiFillTest;
    $("#tc-share").onclick=saveTestReview;
    $("#tc-collapse").onclick=function(){box.classList.toggle('collapsed'); this.textContent=box.classList.contains('collapsed')?'+':'−';};
  }
  function escHtml(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function aiFillTest(){
    steps.forEach(function(s){ var q=s.q, a=answers[q.id]=answers[q.id]||{}; if(q.options&&q.options.length)a._=String(q.options[0].code); else if(q.type==='open_text')a._='Test response generated for survey validation only.'; else if(q.type==='numeric'||q.type==='slider'||q.type==='nps')a._=q.min||5; else if(q.rows)(q.rows||[]).forEach(function(r){a[r.code]=(q.scale&&q.scale.min)||1;}); });
    store('answers',answers); save(); render(); toastTest('AI populated test-only sample answers. Review before using navigation.');
  }
  function toastTest(msg){var s=$("#tc-state");if(s)s.textContent=msg;}
  function saveTestReview(){
    fetch('/api/test-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({study:STUDY.slug,token:reviewToken,answers:answers,notes:testNotes,current:cur})}).then(function(r){return r.json();}).then(function(d){reviewToken=d.token;var url=location.origin+d.url;if(navigator.clipboard)navigator.clipboard.writeText(url);toastTest('Review saved and share link copied: '+url);});
  }

  function render() {
    var st = steps[cur];
    setAnswering(true);
    stopNarration();
    pendingDwell = null;
    if (dwellTimer) { clearInterval(dwellTimer); dwellTimer = null; }

    var node = st.kind === "task" ? renderConjoint(st) : renderQuestion(locQ(st.q));
    var chip = st.kind === "task" ? null : langChip(st.q);
    if (chip && node.insertBefore) {
      var stemH = node.querySelector(".stem");
      if (stemH) node.insertBefore(chip, stemH); else node.appendChild(chip);
    }
    show(node);
    renderTestConsole();
    if (audioPref === "all" && soundOn) setTimeout(function(){ speak(st.kind === "task" ? taskSpeechText(st) : qSpeechText(st.q)); }, 250);
    if (pendingDwell) { startDwell(pendingDwell); pendingDwell = null; }

    // the bar fills silently: no section name, no step counter next to it
    setProgress(Math.round((cur / steps.length) * 100));

    var inTPP = st.q.section === "C" || st.q.section === "D";
    $("#tpp-panel").hidden = !inTPP;
  }

  // Fires once per section: narration, milestone, points.
  function onEnterSection(sec) {
    if (seenSections[sec.id]) return;
    seenSections[sec.id] = true;

    if (sec.id === "C") {
      // the product profile is shown as a narrated animation before any opinion is sought
      runExplainer(SCENES, function () {
        if (audioPref === "all" && SECTION_NARRATION[sec.id]) playClip(SECTION_NARRATION[sec.id]);
        coachSay("Keep the profile fresh in mind - the questions ahead refer back to it. " +
          "Replay it any time from the panel at the bottom right.", "info");
      });
      return;
    }
    if (sec.id === "D") {
      runExplainer([window.BEACON_CONJOINT_SCENE], function () {
        coachSay("Nine choice tasks ahead - you earn insight points with every one.", "info");
      });
      return;
    }
    if (audioPref === "all" && SECTION_NARRATION[sec.id]) playClip(SECTION_NARRATION[sec.id]);
  }

  function onLeaveSection(prevSec, nextSec) {
    if (!prevSec || prevSec.id === nextSec.id) return;
    // The section bonus is still earned and the HUD still ticks up, but there is no between-section
    // popup any more: once a section ends the respondent goes straight on to the next question.
    addPoints(SECTION_POINTS[prevSec.id] || 50);
  }

  // show-if logic: a step is visible when its question's rules pass against current answers
  function logicCtx() { return { answers: answers, questions: SPEC.questions }; }
  function stepVisible(i) {
    var st = steps[i];
    if (!st || !window.BeaconQ) return true;
    return window.BeaconQ.showIf(st.q, logicCtx());
  }
  function nextVisible(i, dir) {
    for (var j = i + dir; j >= 0 && j < steps.length; j += dir) if (stepVisible(j)) return j;
    return -1;
  }

  function go(i) {
    if (i < 0 || i >= steps.length) return;
    if (!stepVisible(i)) { var alt = nextVisible(i, i < cur ? -1 : 1); if (alt < 0) return; i = alt; }
    cur = i;
    render();
  }

  function next() {
    if (!validateStep()) return;
    if (screeningHit()) return;                // screen-out rules, both live and on-Next

    var prevSec = sectionOf(steps[cur].q);
    var nx = nextVisible(cur, 1);
    if (nx < 0) return finish();
    // answers to questions that are now hidden are dropped so logic and exports stay consistent
    for (var h = cur + 1; h < nx; h++) delete answers[steps[h].q.id];
    cur = nx;
    var nextSec = sectionOf(steps[cur].q);
    render();
    if (prevSec.id !== nextSec.id) onLeaveSection(prevSec, nextSec);
    onEnterSection(nextSec);
    if (steps[cur].kind === "task") addPoints(5);
    save();
  }

  function finish() {
    stopNarration();
    // every written answer gets one last quality pass before it leaves the browser
    if (!proofreadSeen && freeTextAnswers().length) { showProofread(); return; }
    submitSurvey();
  }

  function submitSurvey() {
    stopNarration();
    var secs = (Date.now() - t0) / 1000;
    save({}, function () {
      fetch("/api/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: SESSION.session_id, answers: answers, elapsed_seconds: secs })
      }).then(function (r) { return r.json(); }).then(function (res) {
        var card = el("div", "card");
        card.appendChild(el("div", gamifyOn() ? "done-icon done-target" : "done-icon",
          gamifyOn()
            ? '<svg viewBox="0 0 72 72" aria-hidden="true">' +
              '<circle cx="36" cy="36" r="32" fill="#e8f2f7"/>' +
              '<circle cx="36" cy="36" r="22" fill="#fff" stroke="#12789e" stroke-width="3"/>' +
              '<circle cx="36" cy="36" r="12.5" fill="#e8f2f7" stroke="#12789e" stroke-width="3"/>' +
              '<circle cx="36" cy="36" r="4.5" fill="#0b4f6c"/>' +
              '<path d="M36 36 L60 12" stroke="#0b4f6c" stroke-width="3.5" stroke-linecap="round"/>' +
              '<path d="M60 12 l-9 2.2 M60 12 l-2.2 9" stroke="#0b4f6c" stroke-width="3.5" stroke-linecap="round"/>' +
              '</svg>'
            : "&#10003;"));
        card.appendChild(el("h1", null, SPEC.thanks_title || "Thank you"));
        card.appendChild(el("p", null, SPEC.thanks_text || "Your responses have been recorded. Thank you for the " +
          "time and clinical insight you have given this study."));
        var flags = res.flags || [];
        card.appendChild(el("div", "summary",
          gamifyOn()
            ? "Reference <code>" + res.respondent_code + "</code> &middot; " +
              Math.round(secs / 60) + " min &middot; <strong>" + points +
              "</strong> insight points &middot; rank <strong>" + rankFor(points) +
              "</strong> &middot; quality control: <code>" +
              (flags.length ? flags.join(", ") : "clean") + "</code>"
            : "Reference <code>" + res.respondent_code + "</code> &middot; " +
              Math.round(secs / 60) + " min"));
        if (flags.indexOf("ai_generated_verbatim") >= 0) {
          card.appendChild(el("div", "ai-note",
            "One or more written answers were flagged as possibly AI-generated. They stay on " +
            "your record marked for review - the rest of your answers are unaffected."));
        }
        show(card, true);
        setAnswering(false);                     // project bar returns on the closing screen
        $("#progress-wrap").style.display = "none";
        $("#hud").hidden = true;
        $("#tpp-panel").hidden = true;
        setProgress(100);
        confetti();
        playClip("complete");
        ["session_id", "answers", "cur"].forEach(function (k) { store(k); });
      }).catch(function () {
        show(el("div", "card", "<h1>Connection problem</h1><p>Your answers are held in this " +
          "browser. Please try submitting again.</p>"), true);
      });
    });
  }

  // ============================================================ final proofreading pass
  // Before the survey is submitted, every written answer is scored once more and anything
  // that reads as AI-generated, pasted in, or simply broken is put back in front of the
  // respondent with the reasons and a chance to fix it. Answers stay flagged on the record
  // either way - this is a nudge, not a way to scrub a flag.
  var SERIOUS_NOTES = ["placeholder", "lorem", "doubled_word", "run_on", "markdown",
                       "all_caps", "assistant_tone"];

  function freeTextAnswers() {
    var out = [];
    (SPEC.questions || []).forEach(function (q) {
      if (q.type !== "open_text" || aiActionOf(q) === "off") return;
      var txt = String((answers[q.id] || {})._ || "").trim();
      if (txt.length >= 20) out.push({ q: q, text: txt });
    });
    return out;
  }

  function flaggedFor(item) {
    var res = aiState[item.q.id];
    if (!res || res.text !== item.text) return null;           // not scored (yet)
    if (((answers[item.q.id] || {})._ai || {}).ack) return null;   // already confirmed
    var notes = (res.proofread || []).filter(function (n) {
      return SERIOUS_NOTES.indexOf(n.key) >= 0;
    });
    if (res.verdict === "human" && !notes.length) return null;
    return { res: res, notes: notes };
  }

  function proofRow(row) {
    var q = row.item.q, res = row.res;
    var box = el("div", "proof-row");
    box.appendChild(el("div", "proof-head", "<b>" + q.id + ".</b> " + escHtml(pipeText(q.stem))));
    var chips = el("div", "proof-chips");
    var head = res.verdict === "likely_ai" ? "Looks AI-written"
             : res.verdict === "possible_ai" ? "May be AI-written" : "Worth a fix";
    chips.appendChild(el("span", "pr-chip" + (res.verdict === "human" ? "" : " warn"),
      head + " &middot; " + res.score + "/100"));
    aiReasons(res).slice(0, 4).forEach(function (r) { chips.appendChild(el("span", "pr-chip", escHtml(r))); });
    row.notes.slice(0, 3).forEach(function (n) {
      chips.appendChild(el("span", "pr-chip", "Proofreading: " + escHtml(n.note)));
    });
    box.appendChild(chips);

    var ta = el("textarea", "proof-text");
    ta.value = row.item.text;
    trackKeys(metaFor(q.id), ta);            // rewriting here counts as typing
    box.appendChild(ta);
    row.ta = ta;

    var acts = el("div", "proof-acts");
    var mine = el("button", "g-btn", "&#10003; I wrote this myself");
    mine.type = "button";
    mine.addEventListener("click", function () {
      row.mine = true;
      mine.disabled = true;
      mine.textContent = "Confirmed - thank you";
    });
    var re = el("button", "g-btn ghost", "&#8635; Re-check this answer");
    re.type = "button";
    re.addEventListener("click", function () {
      row.item.text = ta.value.trim();
      row.mine = false;
      mine.disabled = false;
      mine.innerHTML = "&#10003; I wrote this myself";
      re.disabled = true;
      re.textContent = "Checking\u2026";
      setAns(q.id, "_meta", metaFor(q.id));
      checkText(q.id, row.item.text, metaFor(q.id), function (fresh) {
        re.disabled = false;
        re.innerHTML = "&#8635; Re-check this answer";
        if (!fresh) return;
        row.res = fresh;
        var f = flaggedFor(row.item);
        if (!f) {
          box.parentNode.removeChild(box);       // fixed - it now reads clean
        } else {
          // rebuild the row in place, keeping the same entry so Submit stores the new score
          row.notes = f.notes;
          row.mine = false;
          box.parentNode.replaceChild(proofRow(row), box);
        }
      });
    });
    acts.appendChild(mine);
    acts.appendChild(re);
    box.appendChild(acts);
    return box;
  }

  function stepIndexOf(q) {
    for (var i = 0; i < steps.length; i++) if (steps[i].q && steps[i].q.id === q.id) return i;
    return cur;
  }

  function showProofread() {
    var items = freeTextAnswers();
    var card = el("div", "card proof-card");
    card.appendChild(el("div", "done-icon note", "&#9998;"));
    card.appendChild(el("h1", null, "One last look at your written answers"));
    card.appendChild(el("p", null,
      "Before your answers reach the researchers we run a quality check on everything you " +
      "wrote. Text that looks generated by an AI tool, pasted in from somewhere else, or in " +
      "need of a quick fix is listed below with the reason. Your own words - short, rough or " +
      "unfinished - are worth far more to this study than polished text from a chatbot."));
    var hold = el("div", "proof-list", "Checking your written answers\u2026");
    card.appendChild(hold);
    show(card, true);

    var waiting = 0;
    items.forEach(function (it) {
      var cached = aiState[it.q.id];
      if (cached && cached.text === it.text) return;
      waiting++;
      checkText(it.q.id, it.text, metaFor(it.q.id), function () {
        if (--waiting === 0) draw();
      });
    });
    if (!waiting) draw();

    function draw() {
      var rows = items.map(function (it) {
        var f = flaggedFor(it);
        return f ? { item: it, res: f.res, notes: f.notes } : null;
      }).filter(Boolean);
      proofreadSeen = true;
      if (!rows.length) { submitSurvey(); return; }

      hold.innerHTML = "";
      hold.appendChild(el("p", "proof-note",
        rows.length + " of your " + items.length + " written answers need a look:"));
      rows.forEach(function (r) { hold.appendChild(proofRow(r)); });

      var nav = el("div", "nav");
      var back = el("button", "btn ghost", "&larr; Back to the survey");
      back.type = "button";
      back.addEventListener("click", function () {
        proofreadSeen = false;
        go(stepIndexOf(rows[0].item.q));
      });
      var done = el("button", "btn primary", "Submit survey &rarr;");
      done.type = "button";
      done.addEventListener("click", function () {
        rows.forEach(function (r) {
          setAns(r.item.q.id, "_", r.ta.value);
          setAns(r.item.q.id, "_ai", { score: r.res.score, verdict: r.res.verdict,
                                       ack: !!r.mine, reviewed: Date.now() });
        });
        submitSurvey();
      });
      nav.appendChild(back);
      nav.appendChild(done);
      card.appendChild(nav);
    }
  }

  // ============================================================ persistence
  var saveTimer = null;
  function save(extra, cb) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var body = { session_id: SESSION.session_id, answers: answers,
                   elapsed_seconds: (Date.now() - t0) / 1000 };
      if (extra) for (var k in extra) body[k] = extra[k];
      fetch("/api/save", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      }).then(function () { if (cb) cb(); }).catch(function () { if (cb) cb(); });
    }, 40);
  }

  function tickClock() {
    var s = Math.floor((Date.now() - t0) / 1000);
    var m = Math.floor(s / 60);
    $("#elapsed").textContent = m + "m " + String(s % 60).padStart(2, "0") + "s";
  }

  // ============================================================ boot
  function boot() {
    // ?new=1 / ?reset=1 / ?fresh=1 - wipe this browser's saved session and start over
    try {
      if (/[?&](new|reset|fresh)=1/.test(location.search)) {
        ["session_id", "answers", "cur"].forEach(function (k) { store(k); });
      }
    } catch (e) {}
    try {
      LANG = new URLSearchParams(location.search).get("lang") || recall("lang") || "";
    } catch (e) {}
    loadSpec();
  }

  function loadSpec() {
    fetch("/api/spec/" + STUDY.slug + (LANG ? "?lang=" + encodeURIComponent(LANG) : "")).then(function (r) { return r.json(); }).then(function (spec) {
      SPEC = spec;
      CONJOINT = spec.conjoint;
      NARR = spec.narration;
      SCENES = spec.explainer_scenes;
      document.body.classList.toggle("gamified", gamifyOn());
      // 0 is a valid setting (no gate) - only an absent value falls back to the default
      MIN_DWELL = spec.conjoint_min_dwell === undefined || spec.conjoint_min_dwell === null
                  ? 12 : Number(spec.conjoint_min_dwell);
      window.BEACON_CONJOINT_SCENE = spec.conjoint_scene;

      // Default is silent; a previous explicit preference may be restored.
      audioPref = recall("audio_pref") || "manual";
      setSound(audioPref !== "off" && recall("sound") === true);
      $("#sound-btn").addEventListener("click", function () {
        setSound(!soundOn);
        if (soundOn && $("#welcome") && $("#welcome").parentElement) playClip("welcome");
      });

      // Voice answering is always listed on the welcome page, so respondents can see it.  Where the
      // browser has no speech recognition the option stays there, disabled, with the reason given.
      var vRadio = document.querySelector('input[name="voice-pref"][value="voice"]');
      if (vRadio && !voiceSupported()) {
        vRadio.disabled = true;
        if (vRadio.closest("label")) vRadio.closest("label").classList.add("is-off");
        var vnote = $(".voice-note");
        if (vnote) vnote.textContent = "Not available in this browser. Open this survey in Chrome, Edge or Safari to answer by voice.";
      }
      var vb = $("#voice-btn");
      if (vb && voiceSupported()) {
        vb.hidden = false;
        vb.addEventListener("click", function () { setVoice(!voiceOn); });
      }
      wireWelcomeAudio();
      setupLangPicker();
      applyWelcomeCopy();

      var savedSid = recall("session_id");
      var resume = savedSid
        ? fetch("/api/progress?sid=" + encodeURIComponent(savedSid)).then(function (r) { return r.json(); })
        : Promise.resolve({ exists: false });

      resume.then(function (prog) {
        if (prog.exists && prog.status === "complete") {
          ["session_id", "answers", "cur"].forEach(function (k) { store(k); });
          return startFresh();
        }
        if (prog.exists) {
          SESSION = { session_id: savedSid, respondent_code: prog.respondent_code,
                      task_order: prog.task_order, alt_positions: prog.alt_positions };
          answers = prog.answers || {};
          if (prog.elapsed_seconds) t0 = Date.now() - prog.elapsed_seconds * 1000;
          // Nothing answered yet: show the welcome page again so the choice of how to answer
          // (tap or voice) is offered before Q1.  The saved session itself is kept.
          afterSession(Object.keys(answers).length === 0);
        } else if (STUDY.paused) {
          showPaused();                      // nobody new starts while the study is paused
        } else {
          startFresh();
        }
      }).catch(startFresh);
    }).catch(function () {
      $("#app").innerHTML = '<div class="card"><h1>Unable to load</h1>' +
        "<p>The survey definition could not be retrieved. Please reload.</p></div>";
    });
  }

  function wireWelcomeAudio() {
    var btn = $("#welcome-play");
    var wave = $("#welcome-wave");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (narrator && !narrator.paused) { stopNarration(); return; }
      btn.classList.add("playing");
      wave.hidden = false;
      var a = playClip("welcome", function () {
        btn.classList.remove("playing");
        wave.hidden = true;
      });
      if (!a) { btn.classList.remove("playing"); wave.hidden = true; }
    });
  }

  function startFresh() {
    return fetch("/api/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_test: IS_TEST, study: STUDY.slug,
                             language: SPEC.render_language || LANG || "",
                             embedded: readEmbedded() })
    }).then(function (r) { return r.json(); }).then(function (s) {
      if (s && s.paused) { showPaused(); return; }
      if (!s || !s.session_id) {
        $("#app").innerHTML = '<div class="card"><h1>Unable to start</h1><p>' +
          (s && s.error ? s.error : "The survey could not be started. Please reload.") + "</p></div>";
        return;
      }
      SESSION = s;
      answers = {};
      store("session_id", s.session_id);
      afterSession(true);
    });
  }

  // A paused study keeps its door closed to new respondents, but someone already answering
  // can reload this page and resume from their saved progress.
  function showPaused() {
    document.body.classList.remove("answering");
    $("#app").innerHTML =
      '<div class="card paused-card"><h1>This study is paused</h1>' +
      "<p>The research team has temporarily stopped new responses. Thank you for your interest - " +
      "please try again later.</p>" +
      '<p class="paused-resume">Already taking part? <a href="' + location.pathname +
      '">Continue where you left off</a>.</p>' +
      '<p class="paused-team">Part of the team? <a href="/survey/' + STUDY.slug +
      '/test">Open it in test mode</a> or find it in the <a href="/studio/#' + STUDY.slug +
      '">Studio</a>.</p></div>';
  }

  function afterSession(waitForClick) {
    buildSteps();
    testNotes = recall("test_notes") || {};
    if (IS_TEST) { try { reviewToken = new URLSearchParams(location.search).get("review") || ""; } catch(e) {}
      if (reviewToken) fetch('/api/test-review/'+encodeURIComponent(reviewToken)).then(function(r){return r.json();}).then(function(d){if(d.payload){answers=d.payload.answers||{};testNotes=d.payload.notes||{};cur=Math.min(Number(d.payload.current||0),steps.length-1);store('answers',answers);render();toastTest('Shared review loaded — answers and team notes restored.');}});
    }
    $("#respondent-code").textContent = (IS_TEST ? "TEST " : "") + SESSION.respondent_code;

    // the welcome facts and the always-available TPP card follow the active study
    var facts = document.querySelectorAll("#welcome .facts div strong");
    if (facts.length >= 2) {
      facts[0].textContent = String(SPEC.questions.length);
      facts[1].textContent = String(SPEC.conjoint ? SPEC.conjoint.n_tasks : 0);
    }
    var tpt = $("#tpp-body table");
    if (tpt && STUDY.slug !== "beacon") {
      // the reference panel mirrors the walkthrough scenes exactly (custom scenes included)
      var rows = (SCENES || []).filter(function (sc) { return (sc.caption || "").trim(); })
        .map(function (sc) { return [sc.title || "", sc.caption]; });
      if (!rows.length && SPEC.tpp) {
        var tp = SPEC.tpp;
        rows = [["Mechanism", tp.mechanism], ["Pivotal trial", tp.trial],
          ["Headline efficacy", tp.efficacy], ["Safety", tp.safety],
          ["Administration", tp.administration], ["Companion diagnostic", tp.cdx]];
      }
      tpt.innerHTML = "";
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        var th = document.createElement("th"); th.textContent = r[0];
        var td = document.createElement("td"); td.textContent = r[1] || "";
        tr.appendChild(th); tr.appendChild(td); tpt.appendChild(tr);
      });
    }
    if (IS_TEST) document.body.classList.add("testmode");
    $("#hud").hidden = !gamifyOn();
    $("#points").textContent = String(points);
    var rb = $("#rank-badge");
    if (rb) rb.textContent = rankFor(points);
    setInterval(tickClock, 1000); tickClock();

    $("#tpp-toggle").addEventListener("click", function () {
      var b = $("#tpp-body");
      b.hidden = !b.hidden;
      $("#tpp-toggle").innerHTML = "Target product profile " + (b.hidden ? "&#9662;" : "&#9652;");
    });
    $("#tpp-replay").addEventListener("click", function () { runExplainer(SCENES, function () {}); });
    $("#ex-close").addEventListener("click", dismissExplainer);

    window.addEventListener("beforeunload", function () {
      store("answers", answers); store("cur", cur);
    });
    setInterval(function () { store("answers", answers); store("cur", cur); }, 8000);

    if (waitForClick) {
      $("#start-btn").addEventListener("click", function () {
        var pref = document.querySelector('input[name="audio-pref"]:checked');
        audioPref = pref ? pref.value : "manual";
        store("audio_pref", audioPref); setSound(audioPref !== "off");
        var vpref = document.querySelector('input[name="voice-pref"]:checked');
        store("voice_pref", vpref ? vpref.value : "manual");
        if (vpref && vpref.value === "voice") setVoice(true);
        t0 = Date.now();
        $("#welcome").remove();
        stopNarration();
        cur = 0;
        render();
        onEnterSection(sectionOf(steps[0].q));
      });
    } else {
      $("#welcome").remove();
      var last = recall("cur");
      cur = (typeof last === "number" && last < steps.length) ? last : 0;
      // mark earlier sections as seen so a resumed session does not replay their narration
      for (var i = 0; i < cur; i++) seenSections[steps[i].q.section] = true;
      render();
    }
  }

  // ============================================================ Studio preview hook
  // Renders one question with the very same code respondents get. `ctx.answers` supplies
  // earlier answers for piping / show-if; nothing is persisted.
  window.BeaconSurveyPreview = {
    render: function (host, q, ctx, seed) {
      SPEC = { questions: ctx.questions || [q], sections: ctx.sections || [], narration: {}, use_tts: false };
      SESSION = { session_id: seed || "preview", respondent_code: "PREVIEW" };
      NARR = {}; SCENES = [];
      answers = JSON.parse(JSON.stringify(ctx.answers || {}));
      delete answers[q.id];
      host.innerHTML = "";
      var card;
      try { card = renderQuestion(q); }
      catch (e) { card = el("div", "card"); card.textContent = "Cannot render: " + e.message; }
      host.appendChild(card);
      var err = el("div", "err prev-err"); host.appendChild(err);
      var check = el("button", "btn primary", "Check answer &rarr;"); check.type = "button";
      check.addEventListener("click", function () {
        steps = [{ kind: "q", q: q }]; cur = 0;
        if (validateStep()) { hideErr(); err.textContent = "\u2713 Valid - respondent could continue. Stored: " + JSON.stringify(answers[q.id] || {}); err.classList.add("show", "ok"); }
        else err.classList.remove("ok");
      });
      host.appendChild(check);
      // report unresolved piping tokens
      var un = (host.textContent.match(/\u2026/g) || []).length;
      var toks = [];
      JSON.stringify(q).replace(/\{([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_:]+)?\}/g, function (m, qid) {
        if (window.BeaconQ && window.BeaconQ.pipe(m, { answers: answers, questions: SPEC.questions }, "") === "") toks.push(m); return m; });
      return { unresolved: toks, ellipses: un };
    }
  };

  if (PREVIEW) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
