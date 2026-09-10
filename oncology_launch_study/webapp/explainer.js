/*
 * PROJECT BEACON - animated product-profile explainer (v2).
 *
 * A scene-based visual walkthrough synced to the narration in /audio/. Each scene is inline
 * SVG with layered CSS animation - gradients, drawn curves, particles - so there are no video
 * files, no codecs and no external requests. Scenes advance on the narration clock rather
 * than on a timer, so the picture and the voice cannot drift apart if the audio stalls.
 *
 * v2: crossfading art layers, ambient per-scene backdrops, scene dots + prev/next, richer
 * clinical artwork (ECG trace, Kaplan-Meier curves, liquid vial, DNA helix, donut sweep).
 */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------- scene artwork
  var ART = {
    patient:
      '<svg viewBox="0 0 400 240" class="scene-svg">' +
      '<defs><radialGradient id="gp-halo" cx="50%" cy="42%" r="60%">' +
      '<stop offset="0%" stop-color="#7fd4f0" stop-opacity=".35"/>' +
      '<stop offset="100%" stop-color="#7fd4f0" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="gp-body" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#b9d8e8"/><stop offset="100%" stop-color="#8fb8cd"/>' +
      '</linearGradient></defs>' +
      '<rect x="0" y="0" width="400" height="240" fill="url(#gp-halo)"/>' +
      '<g class="a-fade"><circle cx="140" cy="86" r="30" fill="url(#gp-body)"/>' +
      '<path d="M88 182c0-30 23-54 52-54s52 24 52 54v10H88z" fill="url(#gp-body)"/>' +
      '<circle cx="140" cy="86" r="30" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>' +
      '</g>' +
      '<g class="a-pulse"><circle cx="140" cy="110" r="58" fill="none" stroke="#12789e" stroke-width="2" opacity=".4"/></g>' +
      '<g class="a-pulse" style="animation-delay:.8s"><circle cx="140" cy="110" r="74" fill="none" stroke="#12789e" stroke-width="1.4" opacity=".25"/></g>' +
      '<path class="a-ecg" d="M20 210h60l8-14 10 26 10-38 10 30 8-4h56l8-12 10 22 10-32 10 26 8-2h150" ' +
      'fill="none" stroke="#2ea882" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<g class="a-rise" style="animation-delay:.5s"><rect x="236" y="48" width="140" height="32" rx="16" fill="#0b4f6c"/>' +
      '<circle cx="254" cy="64" r="5" fill="#7fd4f0"/><text x="316" y="69" text-anchor="middle" fill="#fff" font-size="12.5" font-weight="600">Advanced NSCLC</text></g>' +
      '<g class="a-rise" style="animation-delay:1.1s"><rect x="236" y="90" width="140" height="32" rx="16" fill="#12789e"/>' +
      '<circle cx="254" cy="106" r="5" fill="#ffd166"/><text x="316" y="111" text-anchor="middle" fill="#fff" font-size="12" font-weight="600">Post-IO progression</text></g>' +
      '<g class="a-rise" style="animation-delay:1.7s"><rect x="236" y="132" width="140" height="32" rx="16" fill="#5f7284"/>' +
      '<circle cx="254" cy="148" r="5" fill="#fff" opacity=".7"/><text x="316" y="153" text-anchor="middle" fill="#fff" font-size="12" font-weight="600">ECOG 1</text></g>' +
      '<g class="a-float"><circle cx="330" cy="200" r="3" fill="#7fd4f0" opacity=".6"/></g>' +
      '<g class="a-float" style="animation-delay:1.2s"><circle cx="360" cy="186" r="2.2" fill="#7fd4f0" opacity=".45"/></g>' +
      '<g class="a-float" style="animation-delay:2s"><circle cx="300" cy="208" r="2.6" fill="#ffd166" opacity=".5"/></g>' +
      '</svg>',

    trial:
      '<svg viewBox="0 0 400 240" class="scene-svg">' +
      '<defs><linearGradient id="gt-arm" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#eaf5fb"/><stop offset="100%" stop-color="#d3e9f5"/>' +
      '</linearGradient></defs>' +
      '<g class="a-fade"><rect x="150" y="18" width="100" height="36" rx="10" fill="#0b4f6c"/>' +
      '<text x="200" y="41" text-anchor="middle" fill="#fff" font-size="13" font-weight="600">Patients</text></g>' +
      '<path class="a-ants" d="M200 54v34" stroke="#5f7284" stroke-width="2" fill="none"/>' +
      '<g class="a-fade" style="animation-delay:.5s"><rect x="146" y="88" width="108" height="34" rx="17" fill="#fff" stroke="#12789e" stroke-width="1.6"/>' +
      '<g class="a-spin" style="transform-origin:166px 105px"><path d="M166 98v14M159 105h14M161 100l10 10M171 100l-10 10" stroke="#12789e" stroke-width="1.6"/></g>' +
      '<text x="212" y="110" text-anchor="middle" fill="#0b4f6c" font-size="12.5" font-weight="700">Randomise 1:1</text></g>' +
      '<path class="a-ants" style="animation-delay:.9s" d="M178 122 L110 156" stroke="#5f7284" stroke-width="2" fill="none"/>' +
      '<path class="a-ants" style="animation-delay:.9s" d="M222 122 L290 156" stroke="#5f7284" stroke-width="2" fill="none"/>' +
      '<g class="a-rise" style="animation-delay:1.4s"><rect x="36" y="156" width="148" height="58" rx="12" fill="#f6f9fb" stroke="#dde5ec"/>' +
      '<text x="110" y="181" text-anchor="middle" fill="#5f7284" font-size="12.5" font-weight="700">Standard of care</text>' +
      '<text x="110" y="200" text-anchor="middle" fill="#8fa3b3" font-size="11">control arm</text></g>' +
      '<g class="a-rise" style="animation-delay:1.8s"><rect x="216" y="156" width="148" height="58" rx="12" fill="url(#gt-arm)" stroke="#12789e" stroke-width="1.6"/>' +
      '<rect x="216" y="156" width="148" height="58" rx="12" fill="none" stroke="#7fd4f0" stroke-width="4" opacity=".25" class="a-pulse"/>' +
      '<text x="290" y="181" text-anchor="middle" fill="#0b4f6c" font-size="12.5" font-weight="700">New therapy</text>' +
      '<text x="290" y="200" text-anchor="middle" fill="#3c7fa0" font-size="11">investigational arm</text></g>' +
      '<g class="a-pop" style="animation-delay:2.4s"><circle cx="200" cy="140" r="12" fill="#ffd166"/>' +
      '<text x="200" y="144.5" text-anchor="middle" fill="#6b4c00" font-size="10" font-weight="800">1:1</text></g>' +
      '</svg>',

    mechanism:
      '<svg viewBox="0 0 400 240" class="scene-svg">' +
      '<defs><linearGradient id="gm-liq" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#4db6dd"/><stop offset="100%" stop-color="#0b4f6c"/>' +
      '</linearGradient>' +
      '<clipPath id="gm-clip"><rect x="168" y="64" width="64" height="120" rx="14"/></clipPath></defs>' +
      '<g class="a-fade"><rect x="168" y="64" width="64" height="120" rx="14" fill="#eef6fa" stroke="#9cc3d8" stroke-width="2"/>' +
      '<rect x="184" y="44" width="32" height="24" rx="6" fill="#0b4f6c"/></g>' +
      '<g clip-path="url(#gm-clip)">' +
      '<path class="a-wave" d="M148 118q10-8 20 0t20 0 20 0 20 0 20 0 20 0v80h-120z" fill="url(#gm-liq)" opacity=".9"/>' +
      '<g class="a-bub"><circle cx="186" cy="170" r="3.4" fill="#fff" opacity=".55"/></g>' +
      '<g class="a-bub" style="animation-delay:1s"><circle cx="204" cy="176" r="2.4" fill="#fff" opacity=".5"/></g>' +
      '<g class="a-bub" style="animation-delay:1.8s"><circle cx="216" cy="168" r="2.9" fill="#fff" opacity=".5"/></g>' +
      '</g>' +
      '<g class="a-fade" style="animation-delay:.4s"><rect x="178" y="104" width="44" height="46" rx="8" fill="#fff" opacity=".92"/>' +
      '<text x="200" y="137" text-anchor="middle" fill="#0b4f6c" font-size="28" font-weight="800">?</text>' +
      '<rect x="178" y="104" width="44" height="46" rx="8" fill="none" stroke="#12789e" stroke-width="1.4"/></g>' +
      '<g class="a-orbit" style="transform-origin:200px 124px"><circle cx="200" cy="34" r="5" fill="#7fd4f0"/>' +
      '<circle cx="200" cy="214" r="3.6" fill="#ffd166"/></g>' +
      '<g class="a-pulse"><circle cx="200" cy="124" r="88" fill="none" stroke="#12789e" stroke-width="1.6" opacity=".3"/></g>' +
      '<g class="a-rise" style="animation-delay:1s"><rect x="268" y="98" width="116" height="52" rx="12" fill="#fff" stroke="#dde5ec"/>' +
      '<text x="326" y="120" text-anchor="middle" fill="#5f7284" font-size="11.5" font-weight="700">Novel mechanism</text>' +
      '<text x="326" y="137" text-anchor="middle" fill="#8fa3b3" font-size="10.5">blinded for this study</text></g>' +
      '</svg>',

    efficacy:
      '<svg viewBox="0 0 400 240" class="scene-svg">' +
      '<defs><linearGradient id="ge-area" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#12789e" stop-opacity=".28"/>' +
      '<stop offset="100%" stop-color="#12789e" stop-opacity="0"/></linearGradient></defs>' +
      '<line x1="56" y1="24" x2="56" y2="196" stroke="#c6d4de" stroke-width="1.6"/>' +
      '<line x1="56" y1="196" x2="372" y2="196" stroke="#c6d4de" stroke-width="1.6"/>' +
      '<text x="60" y="34" fill="#8fa3b3" font-size="10">% PFS</text>' +
      '<text x="300" y="214" fill="#8fa3b3" font-size="10">months</text>' +
      '<path class="a-km" d="M56 44h40v14h34v12h36v14h40v16h44v18h50v16h60" fill="none" stroke="#9db2c2" stroke-width="2.6"/>' +
      '<path class="a-km" style="animation-delay:.5s" d="M56 44h46v8h40v8h42v10h46v10h50v10h56v8h40" fill="none" stroke="#0b4f6c" stroke-width="3"/>' +
      '<path class="a-fade" style="animation-delay:1.6s" d="M56 44h46v8h40v8h42v10h46v10h50v10h56v8h40v80H56z" fill="url(#ge-area)"/>' +
      '<line class="a-fade" style="animation-delay:1.8s" x1="212" y1="44" x2="212" y2="196" stroke="#b26a00" stroke-width="1.4" stroke-dasharray="5 4"/>' +
      '<text class="a-fade" style="animation-delay:1.8s" x="216" y="208" fill="#b26a00" font-size="10">12 mo</text>' +
      '<g class="a-pop" style="animation-delay:2s"><rect x="120" y="118" width="58" height="26" rx="13" fill="#fff" stroke="#9db2c2"/>' +
      '<text x="149" y="135" text-anchor="middle" fill="#5f7284" font-size="12" font-weight="800">25%</text></g>' +
      '<g class="a-pop" style="animation-delay:2.3s"><rect x="196" y="78" width="58" height="26" rx="13" fill="#0b4f6c"/>' +
      '<text x="225" y="95" text-anchor="middle" fill="#fff" font-size="12" font-weight="800">45%</text></g>' +
      '<g class="a-rise" style="animation-delay:2.7s"><rect x="238" y="14" width="150" height="26" rx="13" fill="#fff4e2" stroke="#ecd6a8"/>' +
      '<text x="313" y="31" text-anchor="middle" fill="#b26a00" font-size="10.5" font-weight="700">Overall survival: not yet mature</text></g>' +
      '<g class="a-fade" style="animation-delay:.2s"><circle cx="70" cy="228" r="4" fill="#0b4f6c"/>' +
      '<text x="80" y="232" fill="#5f7284" font-size="10">New therapy</text>' +
      '<circle cx="160" cy="228" r="4" fill="#9db2c2"/>' +
      '<text x="170" y="232" fill="#5f7284" font-size="10">Standard of care</text></g>' +
      '</svg>',

    safety:
      '<svg viewBox="0 0 400 240" class="scene-svg">' +
      '<defs><linearGradient id="gs-arc" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#e09b2d"/><stop offset="100%" stop-color="#b26a00"/>' +
      '</linearGradient></defs>' +
      '<circle cx="146" cy="120" r="66" fill="none" stroke="#eef3f6" stroke-width="26"/>' +
      '<circle class="a-donut" cx="146" cy="120" r="66" fill="none" stroke="url(#gs-arc)" stroke-width="26" transform="rotate(-90 146 120)"/>' +
      '<g class="a-pop" style="animation-delay:.9s"><text x="146" y="116" text-anchor="middle" fill="#b26a00" font-size="32" font-weight="800">30%</text>' +
      '<text x="146" y="138" text-anchor="middle" fill="#5f7284" font-size="10.5">Grade 3+ treatment-related</text></g>' +
      '<g class="a-rise" style="animation-delay:1.3s"><rect x="244" y="76" width="136" height="40" rx="10" fill="#fff4e2" stroke="#ecd6a8"/>' +
      '<path d="M262 88l-7 12h14z" fill="#b26a00"/>' +
      '<text x="318" y="101" text-anchor="middle" fill="#b26a00" font-size="11.5" font-weight="700">Adverse events</text></g>' +
      '<g class="a-rise" style="animation-delay:1.7s"><rect x="244" y="126" width="136" height="40" rx="10" fill="#eefaf3" stroke="#bfe6d2"/>' +
      '<circle cx="262" cy="146" r="7" fill="none" stroke="#1a7f4b" stroke-width="2"/>' +
      '<path d="M258.6 146l2.6 2.8 4.6-5.4" fill="none" stroke="#1a7f4b" stroke-width="2"/>' +
      '<text x="320" y="151" text-anchor="middle" fill="#1a7f4b" font-size="11.5" font-weight="700">70% below Grade 3</text></g>' +
      '<g class="a-pulse"><circle cx="146" cy="120" r="92" fill="none" stroke="#e09b2d" stroke-width="1.4" opacity=".25"/></g>' +
      '</svg>',

    cdx:
      '<svg viewBox="0 0 400 240" class="scene-svg">' +
      '<g class="a-fade"><path class="a-helix" d="M60 40c30 26 30 54 0 80s-30 54 0 80" fill="none" stroke="#12789e" stroke-width="3"/>' +
      '<path class="a-helix" style="animation-delay:.15s" d="M96 40c-30 26-30 54 0 80s30 54 0 80" fill="none" stroke="#7fd4f0" stroke-width="3"/>' +
      '<path class="a-draw" d="M66 60h24M62 80h32M62 100h32M66 120h24M62 140h32M62 160h32M66 180h24" stroke="#9cc3d8" stroke-width="1.6"/></g>' +
      '<g class="a-rise" style="animation-delay:.4s"><rect x="132" y="34" width="150" height="52" rx="12" fill="#e8f2f7" stroke="#12789e"/>' +
      '<text x="207" y="57" text-anchor="middle" fill="#0b4f6c" font-size="13" font-weight="800">Broad NGS panel</text>' +
      '<text x="207" y="75" text-anchor="middle" fill="#5f7284" font-size="10">required to select patients</text></g>' +
      ['EGFR', 'ALK', 'ROS1', 'KRAS', 'BRAF', 'MET'].map(function (g, i) {
        return '<g class="a-pop" style="animation-delay:' + (0.9 + i * 0.25).toFixed(2) + 's">' +
          '<rect x="' + (140 + (i % 3) * 44) + '" y="' + (104 + Math.floor(i / 3) * 34) +
          '" width="38" height="26" rx="6" fill="#fff" stroke="#12789e"/>' +
          '<text x="' + (159 + (i % 3) * 44) + '" y="' + (121 + Math.floor(i / 3) * 34) +
          '" text-anchor="middle" fill="#0b4f6c" font-size="9" font-weight="700">' + g +
          '</text></g>';
      }).join("") +
      '<g class="a-stamp" style="animation-delay:2.6s"><rect x="292" y="104" width="92" height="36" rx="9" fill="#0b4f6c"/>' +
      '<text x="338" y="127" text-anchor="middle" fill="#fff" font-size="12" font-weight="800">Eligible</text></g>' +
      '<g class="a-float"><circle cx="320" cy="60" r="3" fill="#7fd4f0" opacity=".55"/></g>' +
      '<g class="a-float" style="animation-delay:1.4s"><circle cx="352" cy="76" r="2.2" fill="#ffd166" opacity=".5"/></g>' +
      '</svg>',

    attributes:
      '<svg viewBox="0 0 400 240" class="scene-svg">' +
      '<g class="a-pulse"><circle cx="200" cy="118" r="30" fill="none" stroke="#12789e" stroke-width="1.6" opacity=".4"/></g>' +
      '<g class="a-pop"><circle cx="200" cy="118" r="22" fill="#0b4f6c"/>' +
      '<text x="200" y="114" text-anchor="middle" fill="#7fd4f0" font-size="9" font-weight="700">YOUR</text>' +
      '<text x="200" y="126" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">CHOICE</text></g>' +
      [["&#9203;", "Overall survival", 62, 44], ["&#128200;", "12-month PFS", 200, 30],
       ["&#9888;", "Grade 3+ AEs", 338, 44], ["&#128137;", "Administration", 48, 128],
       ["&#129516;", "Companion dx", 352, 128], ["&#128178;", "Annual cost", 62, 196],
       ["&#127973;", "Payer access", 338, 196]].map(function (p, i) {
        return '<path class="a-draw" style="animation-delay:' + (0.4 + i * 0.3).toFixed(2) +
          's" d="M200 118 L' + p[2] + ' ' + p[3] + '" stroke="#bcd6e4" stroke-width="1.4" fill="none"/>' +
          '<g class="a-pop" style="animation-delay:' + (0.5 + i * 0.3).toFixed(2) + 's">' +
          '<rect x="' + (p[2] - 52) + '" y="' + (p[3] - 17) + '" width="104" height="34" rx="17" fill="#e8f2f7" stroke="#12789e"/>' +
          '<text x="' + (p[2] - 34) + '" y="' + (p[3] + 5) + '" font-size="12">' + p[0] + '</text>' +
          '<text x="' + (p[2] + 8) + '" y="' + (p[3] + 4) + '" text-anchor="middle" fill="#0b4f6c" font-size="10.5" font-weight="700">' + p[1] +
          '</text></g>';
      }).join("") +
      '<g class="a-pop" style="animation-delay:2.9s"><rect x="148" y="200" width="104" height="30" rx="15" fill="#f6f9fb" stroke="#dde5ec" stroke-dasharray="5 4"/>' +
      '<text x="200" y="219" text-anchor="middle" fill="#5f7284" font-size="10" font-weight="700">or continue SOC</text></g>' +
      '</svg>'
  };

  // ---------------------------------------------------------------- player
  function Explainer(root, opts) {
    this.root = root;
    this.scenes = opts.scenes;
    this.narration = opts.narration;
    this.onDone = opts.onDone || function () {};
    this.muted = !!opts.muted;
    this.tts = !!opts.tts;
    this.noClip = false;
    this.i = -1;
    this.playingClip = null;
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.raf = null;
    this.build();
  }

  Explainer.prototype.build = function () {
    var self = this;
    this.root.innerHTML =
      '<div class="ex-shell" id="ex-shell">' +
      '  <div class="ex-ambient"></div>' +
      '  <div class="ex-stage">' +
      '    <div class="ex-art" id="ex-artA"></div>' +
      '    <div class="ex-art" id="ex-artB"></div>' +
      '  </div>' +
      '  <div class="ex-caption"><strong id="ex-title"></strong><span id="ex-sub"></span></div>' +
      '  <div class="ex-bar">' +
      '    <div class="ex-track"><div class="ex-fill" id="ex-fill"></div></div>' +
      '    <div class="ex-dots" id="ex-dots"></div>' +
      '  </div>' +
      '  <div class="ex-controls">' +
      '    <button class="ex-btn ghost" id="ex-prev" type="button" title="Previous scene">&#8249;</button>' +
      '    <button class="ex-btn" id="ex-play" type="button">Pause</button>' +
      '    <button class="ex-btn ghost" id="ex-next" type="button" title="Next scene">&#8250;</button>' +
      '    <button class="ex-btn ghost" id="ex-mute" type="button">' +
      (this.muted ? "Unmute" : "Mute") + "</button>" +
      '    <button class="ex-btn ghost" id="ex-skip" type="button">Skip</button>' +
      '    <span class="ex-scene" id="ex-scene"></span>' +
      "  </div>" +
      "</div>";

    this.shell = this.root.querySelector("#ex-shell");
    this.layers = [this.root.querySelector("#ex-artA"), this.root.querySelector("#ex-artB")];
    this.active = 0;
    this.title = this.root.querySelector("#ex-title");
    this.sub = this.root.querySelector("#ex-sub");
    this.cap = this.root.querySelector(".ex-caption");
    this.fill = this.root.querySelector("#ex-fill");
    this.dotsWrap = this.root.querySelector("#ex-dots");
    this.counter = this.root.querySelector("#ex-scene");
    this.playBtn = this.root.querySelector("#ex-play");

    var dhtml = "";
    for (var i = 0; i < this.scenes.length; i++) dhtml += '<span class="ex-dot" data-i="' + i + '"></span>';
    this.dotsWrap.innerHTML = dhtml;
    this.dotsWrap.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.classList.contains("ex-dot")) self.loadScene(parseInt(t.getAttribute("data-i"), 10));
    });

    this.playBtn.addEventListener("click", function () { self.toggle(); });
    this.root.querySelector("#ex-prev").addEventListener("click", function () {
      if (self.i > 0) self.loadScene(self.i - 1);
    });
    this.root.querySelector("#ex-next").addEventListener("click", function () { self.next(); });
    this.root.querySelector("#ex-mute").addEventListener("click", function () {
      self.muted = !self.muted;
      self.audio.muted = self.muted;
      this.textContent = self.muted ? "Unmute" : "Mute";
    });
    this.root.querySelector("#ex-skip").addEventListener("click", function () { self.finish(); });
    this.audio.addEventListener("ended", function () { self.next(); });
    this.audio.addEventListener("error", function () {
      // narration unavailable: fall back to a readable timed walkthrough rather than stalling
      self.startFallback();
    });
  };

  Explainer.prototype.start = function () {
    this.i = -1;
    this.loadScene(0);
  };

  Explainer.prototype.setClip = function (sc) {
    var self = this;
    if (this.sceneTimer) { clearTimeout(this.sceneTimer); this.sceneTimer = null; }
    var clip = sc.clip ? this.narration[sc.clip] : null;
    if (sc.clip && !clip) { this.finish(); return; }

    if (!clip) {
      // No produced narration for this study: speak the scene with the browser's
      // speech engine (or run timed when muted/unsupported) so the walkthrough
      // always follows the TPP text the researcher typed.
      this.noClip = true;
      this.playingClip = null;
      var words = ((sc.title || "") + " " + (sc.caption || "")).trim().split(/\s+/).length;
      this.sceneDur = Math.max(6, Math.min(14, words / 2.4));
      this.sceneStart = Date.now();
      var advanced = false;
      var go = function () { if (!advanced) { advanced = true; self.next(); } };
      if (this.tts && !this.muted && ("speechSynthesis" in window)) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
        var u = new SpeechSynthesisUtterance(
          (sc.title ? sc.title + ". " : "") + (sc.caption || ""));
        u.lang = "en-US";
        u.onend = go;
        u.onerror = go;
        window.speechSynthesis.speak(u);
      }
      this.sceneTimer = setTimeout(go, this.sceneDur * 1000 + 2000);
      this.tick();
      return;
    }

    this.noClip = false;
    if (sc.clip === this.playingClip) return;
    this.playingClip = sc.clip;
    this.audio.pause();
    var clip = this.narration[sc.clip];
    if (clip && clip.src) {
      this.audio.src = clip.src;
    } else if (clip) {
      this.audio.src = "/audio/" + clip.file;
    }
    this.audio.muted = this.muted;
    var p = this.audio.play();
    if (p && p.catch) {
      p.catch(function () {
        // autoplay blocked: keep going silently on a timer, the text is still on screen
        self.startFallback();
      });
    }
    if (sc.at) {
      this.audio.addEventListener("loadedmetadata", function once() {
        self.audio.currentTime = sc.at;
        self.audio.removeEventListener("loadedmetadata", once);
      });
    }
  };

  Explainer.prototype.loadScene = function (i) {
    if (i >= this.scenes.length) return this.finish();
    if (i < 0) i = 0;
    var sc = this.scenes[i];
    this.i = i;

    // crossfade: draw into the hidden layer, fade it in over the other one
    var show = 1 - this.active;
    this.layers[show].innerHTML = ART[sc.id] || "";
    void this.layers[show].offsetWidth; // restart CSS animations
    this.layers[show].classList.add("on");
    this.layers[this.active].classList.remove("on");
    this.active = show;

    this.shell.setAttribute("data-scene", sc.id);
    this.title.textContent = sc.title;
    this.sub.textContent = sc.caption;
    // retrigger the caption entrance animation
    var cap = this.cap || this.title.parentElement;
    if (cap) {
      cap.classList.remove("cap-in");
      void cap.offsetWidth;
      cap.classList.add("cap-in");
    }

    this.counter.textContent = (i + 1) + " / " + this.scenes.length;
    var dots = this.dotsWrap.children;
    for (var d = 0; d < dots.length; d++) dots[d].classList.toggle("cur", d === i);

    this.setClip(sc);
    this.tick();
  };

  Explainer.prototype.next = function () {
    this.loadScene(this.i + 1);
  };

  Explainer.prototype.startFallback = function () {
    var self = this;
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(function () {
      if (self.i + 1 >= self.scenes.length) {
        clearInterval(self.fallbackTimer);
        self.fallbackTimer = null;
        self.finish();
      } else self.next();
    }, 6500);
  };

  Explainer.prototype.tick = function () {
    var self = this;
    var sc = this.scenes[this.i];
    var nextScene = this.scenes[this.i + 1];
    var sameClip = nextScene && nextScene.clip === sc.clip;
    var clip = this.narration[sc.clip];

    function frame() {
      if (self.i < 0) return;
      if (self.noClip) {
        var spent = (Date.now() - self.sceneStart) / 1000;
        self.fill.style.width = Math.min(100, (spent / self.sceneDur) * 100) + "%";
        self.raf = requestAnimationFrame(frame);
        return;
      }
      var total = clip ? clip.seconds : 1;
      var pos = self.audio.currentTime || 0;
      var localStart = sc.at || 0;
      var span = sameClip ? (nextScene.at - localStart) : (total - localStart);
      var pct = span > 0 ? Math.min(100, ((pos - localStart) / span) * 100) : 100;
      self.fill.style.width = Math.max(0, pct) + "%";

      if (sameClip && pos >= nextScene.at) {
        self.loadScene(self.i + 1);
        return;
      }
      self.raf = requestAnimationFrame(frame);
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(frame);
  };

  Explainer.prototype.toggle = function () {
    if (this.noClip && ("speechSynthesis" in window)) {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        this.playBtn.textContent = "Play";
      } else {
        window.speechSynthesis.resume();
        this.playBtn.textContent = "Pause";
      }
      return;
    }
    if (this.audio.paused) {
      var p = this.audio.play();
      if (p && p.catch) p.catch(function () {});
      this.playBtn.textContent = "Pause";
    } else {
      this.audio.pause();
      this.playBtn.textContent = "Play";
    }
  };

  Explainer.prototype.finish = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    if (this.sceneTimer) clearTimeout(this.sceneTimer);
    this.raf = this.fallbackTimer = this.sceneTimer = null;
    try { this.audio.pause(); } catch (e) {}
    try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (e) {}
    this.onDone();
  };

  global.BeaconExplainer = Explainer;
  global.BEACON_ART = ART;
})(window);
