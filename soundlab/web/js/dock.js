// The dock: whatever take the page has selected, large. Play it, see its waveform or spectrogram, hover for the time
// (and frequency), click to seek, drag to loop a range; the page's actions for it (thumbs, pick) sit beside it.
// A page hands it an item: {id, url, title, sub, facts, pick, play(from), actions: [{icon, label, cls, on, run, tip}],
// note: {has, tip, open(anchor)}} (a note button beside the view switch, e.g. the note on this take's prompt).
(() => {
  const D = Lab.dock = { item: null, active: false, s: null, a: null, drag: null };
  const $ = id => document.getElementById(id);
  let scope, cv, head, hov, reg, rtag, ruler, msg;
  const MIN_LOOP = .02;  // (seconds: the shortest range a drag can loop)

  D.init = function () {
    const el = $("dock");
    el.innerHTML = `<div class="left"><button class="playbtn" id="dPlay" disabled>${Lab.icon("play")}</button>
        <div class="info"><div class="title" id="dTitle">Nothing selected</div><div class="dsub" id="dSub">Select a take to inspect it</div>
          <div class="time"><b id="dNow">0:00.00</b> / <span id="dDur">–</span></div><div class="dfacts" id="dFacts"></div></div></div>
      <div class="scope" id="dScope"><canvas></canvas><div class="region" hidden></div><div class="head"></div><div class="hover"><span></span></div>
        <div class="rtag" hidden><span></span><button title="Clear the loop (double-click)">${Lab.icon("x")}</button></div>
        <div class="ruler"></div><div class="msg"></div></div>
      <div class="right"><div class="row" id="dActs"></div>
        <div class="row"><span id="dNote"></span><span class="seg" id="dView">
          <button data-v="wave" data-tip="Waveform (V)">${Lab.icon("vwave")}</button><button data-v="spec" data-tip="Spectrogram (V)">${Lab.icon("vspec")}</button></span></div></div>`;
    scope = $("dScope"); cv = scope.querySelector("canvas"); head = scope.querySelector(".head"); hov = scope.querySelector(".hover");
    reg = scope.querySelector(".region"); rtag = scope.querySelector(".rtag"); ruler = scope.querySelector(".ruler"); msg = scope.querySelector(".msg");
    $("dPlay").onclick = () => D.toggle();
    rtag.querySelector("button").onpointerdown = e => { e.stopPropagation(); D.clearRegion(); };
    $("dView").querySelectorAll("button").forEach(b => b.onclick = () => { Lab.prefs.view = b.dataset.v; Lab.savePrefs(); D.view(); });
    D.view(false);
    const tAt = e => { const r = scope.getBoundingClientRect(); return Lab.clamp((e.clientX - r.left) / r.width, 0, 1) * (D.s ? D.s.dur : 0); };
    scope.onpointermove = e => {
      if (!D.s) return;
      const r = scope.getBoundingClientRect(), x = Lab.clamp(e.clientX - r.left, 0, r.width), t = tAt(e);
      hov.style.left = `${x}px`; hov.classList.toggle("flip", x > r.width - 140);
      let label = Lab.fmt(t);
      if (Lab.prefs.view === "spec" && D.spec) label += ` · ${Lab.fmtHz(Lab.freqAt(D.spec, Lab.clamp((e.clientY - r.top) / (r.height - 17), 0, 1)))}`;
      hov.firstElementChild.textContent = label;
      if (D.drag) {
        if (Math.abs(e.clientX - D.drag.x) > 4) D.drag.moved = true;
        if (D.drag.moved && Math.abs(t - D.drag.t) > MIN_LOOP) D.showRegion(Math.min(D.drag.t, t), Math.max(D.drag.t, t));  // (only what pointer-up would keep)
        else if (D.drag.moved) D.restoreRegion();
      }
    };
    scope.onpointerdown = e => {
      if (!D.s || e.button !== 0) return;
      scope.setPointerCapture(e.pointerId);
      D.drag = { x: e.clientX, t: tAt(e), moved: false };
    };
    scope.onpointerup = e => {
      const dr = D.drag; D.drag = null;
      if (!dr || !D.item) return;
      const t = tAt(e);
      if (dr.moved && Math.abs(t - dr.t) > MIN_LOOP) { D.setRegion(Math.min(dr.t, t), Math.max(dr.t, t)); D.seek(Math.min(dr.t, t)); return; }
      D.restoreRegion();  // (a drag too short to loop is a click)
      const r = Lab.player.region;
      if (r && (t < r.a || t > r.b)) D.clearRegion();
      D.seek(t);
    };
    scope.onpointercancel = scope.onlostpointercapture = () => { if (D.drag) { D.drag = null; D.restoreRegion(); } };
    scope.ondblclick = () => D.clearRegion();
    new ResizeObserver(() => { D.draw(); D.ruler(); D.placeRegion(); }).observe(scope);
  };
  D.attach = function (on) {
    D.active = on;
    $("dock").hidden = !on;
    D.item = null; D.s = D.a = D.spec = null;
    if (on) D.show(null);
  };
  Lab.onFlush(() => {  // (the page hands the dock its item again when it refreshes)
    if (D.active) D.show(null); else { D.item = null; D.s = D.a = D.spec = null; }
  });
  D.openNote = function () {  // (the page's note key: the dock's note button, if it has one)
    const b = $("dNote").firstElementChild;
    if (b && D.item && D.item.note) { D.item.note.open(b); return true; }
    return false;
  };
  D.show = function (item) {
    if (!D.active) return;
    const same = D.item && item && D.item.id === item.id && D.item.url === item.url;
    D.item = item;
    $("dTitle").textContent = item ? item.title : "Nothing selected";
    $("dSub").textContent = item ? item.sub || "" : "Select a take to inspect it";
    $("dFacts").textContent = item && item.facts || "";
    $("dPlay").disabled = !(item && item.url);
    const acts = $("dActs");
    acts.innerHTML = (item && item.actions || []).map((a, i) => `<button class="btn ${a.label ? "" : "sq"} ${a.cls || ""} ${a.on ? "on" : ""}" data-a="${i}" ${a.tip ? `data-tip="${Lab.esc(a.tip)}"` : ""}>
      ${a.icon ? Lab.icon(a.icon) : ""}${a.label ? `<span>${Lab.esc(a.label)}</span>` : ""}</button>`).join("");
    acts.querySelectorAll("button").forEach(b => b.onclick = () => item.actions[+b.dataset.a].run());
    const n = item && item.note, nb = $("dNote");
    nb.innerHTML = n ? `<button class="btn pick ${n.has ? "on" : ""}" data-tip="${Lab.esc(n.tip || "")}">${Lab.icon("pen")}<span>Note</span></button>` : "";
    if (n) nb.firstElementChild.onclick = () => n.open(nb.firstElementChild);
    if (!same) { D.clearRegion(true); D.s = D.a = D.spec = null; D.load(); }
    D.sync();
  };
  Lab.inspect = item => D.show(item);
  D.load = async function () {
    const it = D.item;
    D.draw(); D.ruler();
    $("dDur").textContent = "–"; $("dNow").textContent = Lab.fmt(0);
    if (!it || !it.url) { msg.textContent = it ? "No audio" : "Select a take: click to seek, drag to loop a range"; return; }
    msg.textContent = "";
    try {
      const s = await Lab.decode(it.url, true), still = () => D.item && D.item.id === it.id && D.item.url === it.url;
      if (!still()) return;
      D.s = s; D.a = Lab.buckets(s.data, 1600);
      $("dDur").textContent = Lab.fmt(s.dur);
      D.draw(); D.ruler();
    } catch { if (D.item && D.item.url === it.url) msg.textContent = "Couldn't decode this file"; }
  };
  const current = () => D.item && Lab.player.current === D.item.id;
  D.draw = function () {
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    scope.classList.toggle("ready", !!(D.s && D.item));  // (hover and crosshair only once there is something to point at)
    if (!D.s || !D.item) { const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height); return; }
    if (Lab.prefs.view === "spec") {
      D.spec = Lab.spectrogram(D.item.url, D.s);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(D.spec, 0, 0, cv.width, cv.height);
    } else {
      const el = Lab.player.el;
      Lab.paintWave(cv, D.a, { progress: current() && el.duration ? el.currentTime / el.duration : -1, tone: D.item.pick ? "pick" : "focus" });
    }
  };
  D.ruler = function () {
    if (!ruler) return;
    if (!D.s) { ruler.innerHTML = ""; return; }
    const w = scope.clientWidth, dur = D.s.dur, steps = [.01, .025, .05, .1, .25, .5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find(s => s * w / dur >= 64) || 60, html = [];
    for (let t = 0; t <= dur + 1e-6; t += step) html.push(`<span style="left:${100 * t / dur}%">${step < 1 ? t.toFixed(step < .1 ? 2 : 1) : Math.round(t)}s</span>`);
    ruler.innerHTML = html.join("");
  };
  D.frame = function (t, d) {
    if (!current() || !D.s) return;
    head.style.display = "block"; head.style.left = `${100 * Lab.clamp(t / (d || D.s.dur), 0, 1)}%`;
    $("dNow").textContent = Lab.fmt(t);
    if (Lab.prefs.view !== "spec") D.draw();
  };
  D.sync = function () {
    if (!D.active || !head) return;
    const on = current();
    $("dPlay").innerHTML = Lab.icon(on ? "stop" : "play");
    if (!on) { head.style.display = "none"; $("dNow").textContent = Lab.fmt(0); D.draw(); }
  };
  D.toggle = function () {
    if (!D.item || !D.item.url) return;
    if (current()) Lab.stop(); else D.seek(Lab.player.region && Lab.player.region.id === D.item.id ? Lab.player.region.a : 0, true);
  };
  D.seek = function (t, restart = false) {
    const it = D.item;
    if (!it || !it.url) return;
    if (current() && !restart) { Lab.player.el.currentTime = t; return; }
    if (it.play) it.play(t); else Lab.play(it.url, { id: it.id, from: t });
  };
  D.setRegion = function (a, b) {
    Lab.player.region = { id: D.item.id, a, b };
    if (current()) Lab.player.el.loop = false;  // (the region does the looping)
    D.showRegion(a, b);
  };
  D.showRegion = function (a, b) {
    D._reg = [a, b];
    reg.hidden = false; rtag.hidden = false;
    rtag.firstElementChild.textContent = `loop ${Lab.fmt(a)} → ${Lab.fmt(b)}`;
    D.placeRegion();
  };
  D.placeRegion = function () {
    if (!D._reg || !D.s || reg.hidden) return;
    const [a, b] = D._reg;
    reg.style.left = `${100 * a / D.s.dur}%`; reg.style.width = `${100 * (b - a) / D.s.dur}%`;
  };
  D.restoreRegion = function () {  // (show the loop that stands: after a drag that kept nothing)
    const r = Lab.player.region;
    if (r && D.item && r.id === D.item.id) D.showRegion(r.a, r.b);
    else if (reg) { D._reg = null; reg.hidden = true; rtag.hidden = true; }
  };
  D.clearRegion = function (quiet) {
    const P = Lab.player;
    if (P.region && (!D.item || P.region.id === D.item.id || quiet)) P.region = null;
    if (P.current && !P.region) P.el.loop = P.loopWanted;  // (a loop sound goes back to looping whole)
    D._reg = null;
    if (reg) { reg.hidden = true; rtag.hidden = true; }
  };
  D.view = function (redraw = true) {
    $("dView").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === Lab.prefs.view));
    if (redraw) D.draw();
  };
  D.toggleView = function () {
    Lab.prefs.view = Lab.prefs.view === "spec" ? "wave" : "spec"; Lab.savePrefs(); D.view();
    Lab.toast(Lab.prefs.view === "spec" ? "Spectrogram" : "Waveform", { icon: Lab.prefs.view === "spec" ? "vspec" : "vwave" });
  };
})();
