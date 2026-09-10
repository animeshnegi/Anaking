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
  var soundOn = true;
  var narrator = null;
  var explainer = null;
  var dwellTimer = null;
  var dwellStart = 0;
  var pendingDwell = null;
  var MIN_DWELL = 12;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

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
    var t = q.id + ". " + q.stem + (q.help ? " " + q.help : "");
    if (q.options) t += " The options are: " +
      q.options.map(function (o) { return o.label; }).join("; ") + ".";
    if (q.rows && q.scale) t += " Please rate each item from " + q.scale.min + " to " + q.scale.max +
      ". Items: " + q.rows.map(function (r) { return r.label; }).join("; ") + ".";
    return t;
  }

  function taskSpeechText(step) {
    var q = step.q;
    var alts = CONJOINT.tasks[String(step.taskId)];
    var t = "Choice task " + step.slot + " of " + step.total + ". Patient: " + q.vignette + ". ";
    alts.forEach(function (alt, i) {
      t += "Treatment " + (i + 1) + ": " + CONJOINT.attributes.map(function (a, ai) {
        return a.levels[alt.levels[ai]];
      }).join("; ") + ". ";
    });
    t += "Or choose: " + q.opt_out_label + ".";
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
  function coachSay(html, tone) {
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
    coachTimer = setTimeout(function () { c.classList.remove("show"); }, 5200);
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

  function addPoints(n) {
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
    if (before !== after) {
      toast("&#9733; Rank up: " + after);
      confetti(18);
    }
  }

  function setProgress(pct) {
    var ring = $("#ring-fg");
    if (ring) ring.style.strokeDashoffset = String(100 - pct);
    var lab = $("#ring-label");
    if (lab) lab.textContent = pct + "%";
    var bar = $("#progress-fill");
    if (bar) bar.style.width = pct + "%";
  }

  function celebrate(title, sub, pts) {
    var c = $("#celebrate");
    $("#celebrate-title").textContent = title;
    $("#celebrate-sub").textContent = sub;
    $("#celebrate-pts").innerHTML = "&#9733; +" + pts + " insight points";
    c.hidden = false;
    addPoints(pts);
    confetti();
    $("#celebrate-next").onclick = function () { c.hidden = true; };
  }

  function confetti(n) {
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
    // never trap the respondent behind a celebration modal
    $("#celebrate").hidden = true;
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
  function buildSteps() {
    steps = [];
    SPEC.questions.forEach(function (q) {
      if (q.type === "choice_task") {
        var order = (SESSION.task_order && SESSION.task_order.length)
          ? SESSION.task_order
          : Object.keys(CONJOINT.tasks).map(Number);
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
      case "rating_grid": case "semantic_diff":
        return q.rows.every(function (r) { return a[r.code] !== undefined; });
      case "sum_to_100":
        return q.rows.some(function (r) { return a[r.code] !== undefined && a[r.code] !== ""; });
      case "multi_select":
        return (a.codes || []).length > 0;
      case "rank":
        return (a.order || []).length === q.rows.length;
      case "choice_task":
        return Object.keys(CONJOINT.tasks).every(function (t) { return a["T" + t] !== undefined; });
    }
    return false;
  }

  // ============================================================ renderers
  function renderOptions(q, multi) {
    var wrap = el("div", "opts" + (multi ? " opt-multi" : ""));
    var otherBox = null;

    q.options.forEach(function (o) {
      var row = el("div", "opt");
      var input = el("input");
      input.type = multi ? "checkbox" : "radio";
      input.name = q.id;
      input.value = o.code;
      input.id = q.id + "_" + o.code;
      row.appendChild(input);
      row.appendChild(el("span", "code", o.code + "."));
      var lab = el("label", null, String(o.label));
      lab.htmlFor = input.id;
      row.appendChild(lab);

      row.addEventListener("click", function (ev) {
        if (ev.target.tagName !== "INPUT") input.checked = !input.checked;
        var codes = getAns(q.id, "codes") || [];
        if (multi) {
          var i = codes.map(String).indexOf(String(o.code));
          if (input.checked && i < 0) {
            if (q.max_select && codes.length >= q.max_select) {
              input.checked = false;
              showErr("Please select no more than " + q.max_select + ".");
              return;
            }
            codes.push(o.code);
          } else if (!input.checked && i >= 0) codes.splice(i, 1);
          setAns(q.id, "codes", codes);
        } else {
          setAns(q.id, "_", o.code);
        }
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
        var on = sel.indexOf(String(q.options[i].code)) >= 0;
        row.classList.toggle("checked", on);
        row.querySelector("input").checked = on;
        if (q.options[i].other && otherBox) otherBox.classList.toggle("show", on);
      });
    }
    paint();
    return wrap;
  }

  // Spectrum scale: a draggable gradient track with detents and a value bubble.
  // Same data contract as the old 1-7 button row (one integer per item), but the
  // interaction is continuous, visual and touch friendly instead of a button strip.
  function renderScale(min, max, val, onPick) {
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

  function renderGrid(q, semantic) {
    var wrap = el("div", "grid");
    q.rows.forEach(function (r) {
      var row = el("div", "grid-row");
      var left = el("div", "rlabel");
      if (semantic) left.innerHTML = "<strong>" + r.label + "</strong>";
      else left.textContent = r.label;
      var right = el("div");
      if (semantic) {
        right.style.cssText = "display:flex;align-items:center;gap:9px";
        right.appendChild(el("span", "sem-left", String(r.left)));
      }
      right.appendChild(renderScale(q.scale.min, q.scale.max, getAns(q.id, r.code), function (v) {
        setAns(q.id, r.code, v); hideErr();
        checkPattern(q, wrap);
      }));
      if (semantic) right.appendChild(el("span", "sem-right", String(r.right)));
      row.appendChild(left); row.appendChild(right);
      wrap.appendChild(row);
    });
    var ends = el("div", "scale-ends");
    ends.appendChild(el("span", null, String(q.scale.min_label || q.scale.min)));
    ends.appendChild(el("span", null, String(q.scale.max_label || q.scale.max)));
    wrap.appendChild(ends);
    return wrap;
  }

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

    q.rows.forEach(function (r) {
      var row = el("div", "s100-row");
      row.appendChild(el("div", "rlabel", String(r.label)));
      var inp = el("input");
      inp.type = "number"; inp.min = 0; inp.max = 100; inp.step = 1;
      var v = getAns(q.id, r.code);
      inp.value = (v === undefined) ? "" : v;
      inp.addEventListener("input", function () {
        setAns(q.id, r.code, inp.value === "" ? "" : parseInt(inp.value, 10));
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
    var order = getAns(q.id, "order") || q.rows.map(function (r) { return r.code; });
    var wrap = el("div", "rank-list");
    var top = q.rank_count || 3;

    function paint() {
      wrap.innerHTML = "";
      order.forEach(function (code, i) {
        var r = q.rows.filter(function (x) { return x.code === code; })[0];
        var item = el("div", "rank-item" + (i < top ? " top" : ""));
        item.appendChild(el("span", "pos", String(i + 1)));
        item.appendChild(el("span", null, String(r.label)));
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
  function attrLabel(id) {
    return { OS: "Median OS vs standard of care", PFS12: "12-month PFS",
             AE: "Grade 3+ adverse events", ROUTE: "Administration",
             CDX: "Companion diagnostic", COST: "Net 12-month cost",
             ACCESS: "Payer access at month 1" }[id] || id;
  }

  function renderConjoint(step) {
    var q = step.q;
    var tid = step.taskId;
    var alts = CONJOINT.tasks[String(tid)];
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
        var r = el("div", "alt-row");
        r.appendChild(el("span", "ico", ATTR_ICON[attr.id] || "\u2022"));
        var t = el("span", "txt");
        t.appendChild(el("span", "lbl", attrLabel(attr.id)));
        t.appendChild(document.createTextNode(attr.levels[alt.levels[ai]]));
        r.appendChild(t);
        rows.appendChild(r);
      });
      card.appendChild(rows);

      card.addEventListener("click", function () {
        setAns(q.id, "T" + tid, altId);
        cards.querySelectorAll(".alt-card").forEach(function (c) { c.classList.remove("sel"); });
        card.classList.add("sel");
        optout.classList.remove("sel");
        hideErr();
      });
      cards.appendChild(card);
    });
    wrap.appendChild(cards);

    var optout = el("div", "optout-card" + (String(chosen) === "0" ? " sel" : ""));
    optout.appendChild(el("span", "alt-tick", "&#10003;"));
    optout.appendChild(el("span", null, String(q.opt_out_label)));
    optout.addEventListener("click", function () {
      setAns(q.id, "T" + tid, 0);
      optout.classList.add("sel");
      cards.querySelectorAll(".alt-card").forEach(function (c) { c.classList.remove("sel"); });
      hideErr();
    });
    wrap.appendChild(optout);

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
        txt.textContent = "Take a moment to weigh all seven characteristics \u2014 " +
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

  function renderQuestion(q) {
    var sec = sectionOf(q);
    var card = el("div", "card");
    card.appendChild(el("span", "section-tag", String(sec.title)));

    if (q.comprehension) {
      card.appendChild(el("div", "cc-banner",
        "\uD83D\uDCA1 Quick check \u2014 this confirms the profile was clear. " +
        "It does not affect your participation."));
    }
    card.appendChild(el("h2", null, q.id + ". " + q.stem));
    if (q.help) card.appendChild(el("div", "help", String(q.help)));
    card.appendChild(guideBar(function () { return qSpeechText(q); }));

    var body;
    switch (q.type) {
      case "single_select": body = renderOptions(q, false); break;
      case "multi_select": body = renderOptions(q, true); break;
      case "rating_grid": body = renderGrid(q, false); break;
      case "semantic_diff": body = renderGrid(q, true); break;
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
          setAns(q.id, "_", inp.value === "" ? "" : Number(inp.value)); hideErr();
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
        rng.addEventListener("input", function () {
          out.textContent = rng.value + (q.suffix || "");
          setAns(q.id, "_", Number(rng.value)); hideErr();
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
        var praised = false;
        var deb = null;
        ta.addEventListener("input", function () {
          setAns(q.id, "_", ta.value); hideErr();
          clearTimeout(deb);
          deb = setTimeout(function () {
            var txt = ta.value.trim();
            if (txt.length < 8) { chip.className = "oq-chip"; chip.innerHTML = ""; return; }
            var bad = textQuality(txt);
            if (bad) {
              chip.className = "oq-chip warn";
              chip.innerHTML = "&#9888; This reads as " + bad + ". A sentence or two in your own " +
                "words makes sure your insight counts - or record it with the microphone.";
            } else {
              chip.className = "oq-chip ok";
              chip.innerHTML = "&#10003; Looks like a genuine thought - thank you.";
              if (!praised && txt.split(/\s+/).length >= Math.max(3, q.min_words || 3)) {
                praised = true;
                coachSay("That is exactly the kind of insight this study needs. Thank you!", "good");
              }
            }
          }, 300);
        });
        body = el("div");
        body.appendChild(ta);
        body.appendChild(chip);
        body.appendChild(recorderFor(q));
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
  function showErr(msg) { var e = $("#err"); if (e) { e.textContent = msg; e.classList.add("show"); } }
  function hideErr() { var e = $("#err"); if (e) e.classList.remove("show"); }

  function validateStep() {
    var st = steps[cur];
    if (st.kind === "task") {
      if (getAns(st.q.id, "T" + st.taskId) === undefined) {
        showErr("Please choose one of the treatments, or choose to continue current standard of care.");
        return false;
      }
      if (dwellTimer) {
        showErr("Please take a moment to review all seven characteristics before continuing.");
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
    if (q.type === "open_text" && q.required && q.min_words) {
      var words = String(getAns(q.id, "_") || "").trim().split(/\s+/).filter(Boolean);
      if (words.length < q.min_words) {
        showErr("Please write at least " + q.min_words + " words."); return false;
      }
    }
    return true;
  }

  // ============================================================ screening
  function screenOut(reason) {
    stopNarration();
    save({ screened_out: true, screen_out_reason: reason, screen_out_at: steps[cur].q.id });
    var card = el("div", "card");
    card.appendChild(el("div", "done-icon stop", "&#10005;"));
    card.appendChild(el("h1", null, "End of survey"));
    card.appendChild(el("p", null, String(SPEC.terminate_text)));
    card.appendChild(el("div", "summary", "Screened out at <code>" + steps[cur].q.id +
      "</code> &middot; reference <code>" + SESSION.respondent_code + "</code>"));
    show(card, true);
    $("#progress-wrap").style.display = "none";
    $("#hud").hidden = true;
    $("#tpp-panel").hidden = true;
  }

  function checkTerminate() {
    var q1 = Number(getAns("Q1", "_"));
    var q3 = Number(getAns("Q3", "_"));
    var q4 = Number(getAns("Q4", "_"));
    if ([5, 6, 7, 8].indexOf(q1) >= 0) return "Specialty not eligible (Q1=" + q1 + ")";
    if (q1 === 4 && q3 && q3 < 10) return "Hematology-only with fewer than 10 eligible patients/month";
    if (steps[cur].q.id === "Q3" && q3 < 5) return "Fewer than 5 eligible patients per month";
    if ([3, 4, 5].indexOf(q4) >= 0) return "Industry conflict or recent oncology research (Q4=" + q4 + ")";
    return null;
  }

  // ============================================================ navigation
  function show(node, replace) {
    var app = $("#app");
    app.innerHTML = "";
    app.appendChild(node);
    if (!replace) {
      var nav = el("div", "nav");
      var back = el("button", "btn ghost", "&larr; Back");
      back.type = "button";
      back.disabled = cur === 0;
      back.addEventListener("click", function () { go(cur - 1); });
      var last = cur === steps.length - 1;
      var fwd = el("button", "btn primary", last ? "Submit survey" : "Next &rarr;");
      fwd.type = "button";
      fwd.addEventListener("click", next);
      nav.appendChild(back); nav.appendChild(fwd);
      app.appendChild(nav);
      var err = el("div", "err"); err.id = "err";
      app.appendChild(err);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    var st = steps[cur];
    stopNarration();
    pendingDwell = null;
    if (dwellTimer) { clearInterval(dwellTimer); dwellTimer = null; }

    var node = st.kind === "task" ? renderConjoint(st) : renderQuestion(st.q);
    show(node);
    if (pendingDwell) { startDwell(pendingDwell); pendingDwell = null; }

    var pct = Math.round((cur / steps.length) * 100);
    setProgress(pct);
    $("#progress-label").innerHTML =
      "<span>" + sectionOf(st.q).title + "</span><span>Step " + (cur + 1) + " of " +
      steps.length + "</span>";

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
        if (SECTION_NARRATION[sec.id]) playClip(SECTION_NARRATION[sec.id]);
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
    if (SECTION_NARRATION[sec.id]) playClip(SECTION_NARRATION[sec.id]);
  }

  function onLeaveSection(prevSec, nextSec) {
    if (!prevSec || prevSec.id === nextSec.id) return;
    var pts = SECTION_POINTS[prevSec.id] || 50;
    // sections that open with a narrated walkthrough get the points without a second overlay,
    // so the respondent is never shown two stacked modals
    if (nextSec.id === "C" || nextSec.id === "D") { addPoints(pts); return; }
    celebrate(prevSec.title || "Section complete",
      "You have finished the " + prevSec.title.toLowerCase() + " section.", pts);
  }

  function go(i) {
    if (i < 0 || i >= steps.length) return;
    cur = i;
    render();
  }

  function next() {
    if (!validateStep()) return;
    var reason = checkTerminate();
    if (reason) return screenOut(reason);

    var prevSec = sectionOf(steps[cur].q);
    if (cur === steps.length - 1) return finish();
    cur++;
    var nextSec = sectionOf(steps[cur].q);
    render();
    if (prevSec.id !== nextSec.id) onLeaveSection(prevSec, nextSec);
    onEnterSection(nextSec);
    if (steps[cur].kind === "task") addPoints(5);
    save();
  }

  function finish() {
    stopNarration();
    var secs = (Date.now() - t0) / 1000;
    save({}, function () {
      fetch("/api/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: SESSION.session_id, answers: answers, elapsed_seconds: secs })
      }).then(function (r) { return r.json(); }).then(function (res) {
        var card = el("div", "card");
        card.appendChild(el("div", "done-icon", "&#10003;"));
        card.appendChild(el("h1", null, "Thank you"));
        card.appendChild(el("p", null, "Your responses have been recorded. Thank you for the " +
          "time and clinical insight you have given this study."));
        var flags = res.flags || [];
        card.appendChild(el("div", "summary",
          "Reference <code>" + res.respondent_code + "</code> &middot; " +
          Math.round(secs / 60) + " min &middot; <strong>" + points +
          "</strong> insight points &middot; quality control: <code>" +
          (flags.length ? flags.join(", ") : "clean") + "</code>"));
        show(card, true);
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
    fetch("/api/spec/" + STUDY.slug).then(function (r) { return r.json(); }).then(function (spec) {
      SPEC = spec;
      CONJOINT = spec.conjoint;
      NARR = spec.narration;
      SCENES = spec.explainer_scenes;
      MIN_DWELL = spec.conjoint_min_dwell || 12;
      window.BEACON_CONJOINT_SCENE = spec.conjoint_scene;

      setSound(recall("sound") !== false);
      $("#sound-btn").addEventListener("click", function () {
        setSound(!soundOn);
        if (soundOn && $("#welcome") && $("#welcome").parentElement) playClip("welcome");
      });
      wireWelcomeAudio();

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
          afterSession(false);
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
      body: JSON.stringify({ is_test: IS_TEST, study: STUDY.slug })
    }).then(function (r) { return r.json(); }).then(function (s) {
      SESSION = s;
      answers = {};
      store("session_id", s.session_id);
      afterSession(true);
    });
  }

  function afterSession(waitForClick) {
    buildSteps();
    $("#respondent-code").textContent = (IS_TEST ? "TEST " : "") + SESSION.respondent_code;

    // the welcome facts and the always-available TPP card follow the active study
    var facts = document.querySelectorAll("#welcome .facts div strong");
    if (facts.length >= 2) {
      facts[0].textContent = String(SPEC.questions.length);
      facts[1].textContent = String(SPEC.conjoint ? SPEC.conjoint.n_tasks : 0);
    }
    var tpt = $("#tpp-body table");
    if (tpt && SPEC.tpp && STUDY.slug !== "beacon") {
      var tp = SPEC.tpp;
      tpt.innerHTML = [
        ["Mechanism", tp.mechanism], ["Pivotal trial", tp.trial],
        ["Headline efficacy", tp.efficacy], ["Safety", tp.safety],
        ["Administration", tp.administration || "As described in the choice tasks"],
        ["Companion diagnostic", tp.cdx]
      ].map(function (r) {
        return "<tr><th>" + r[0] + "</th><td>" + (r[1] || "") + "</td></tr>";
      }).join("");
    }
    if (IS_TEST) document.body.classList.add("testmode");
    $("#hud").hidden = false;
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
