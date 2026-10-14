// Music: a set's levels playing in sync on the audio clock (as the game's synchronized stream does), with live
// intensity crossfades and bar-quantised switches between takes, profiles and sets. The timeline seeks by bar.
(() => {
  const FADES = { cut: ["cut", 0], beat: ["1 beat", 1], bar: ["1 bar", 4], two: ["2 bars", 8] };  // in beats
  const PROFILE_INFO = { close: "levels keep the spine's chords; gentler contrast", contrast: "clearer contrast; chords drift more" };
  const M = { key: null, take: 0, prof: null, level: null, stack: false, fade: "bar", quant: false, enter: "start",
              deck: null, pendingAt: 0, raf: 0 };
  const { icon, esc } = Lab, $ = id => document.getElementById(id);
  const bufs = new Map(), shapes = new Map();
  const out = Lab.actx.createGain(), an = Lab.actx.createAnalyser();
  out.gain.value = 0.9; an.fftSize = 4096; an.smoothingTimeConstant = .8;
  out.connect(an); an.connect(Lab.master);
  const spec = new Float32Array(an.frequencyBinCount), wav = new Float32Array(1024);

  const mesh = () => Lab.S.mesh;
  const beatS = () => 60 / mesh().bpm, barS = () => beatS() * mesh().bar_beats, loopS = () => barS() * mesh().bars;
  const set = (k = M.key) => mesh().contexts[k];
  const keys = () => Object.keys(mesh().contexts).sort((a, b) => a.localeCompare(b));
  const voteId = (k = M.key, t = set().takes[M.take].id, p = M.prof) => `mesh_${k}.${t}.${p}`;
  const buf = rel => { if (!bufs.has(rel)) bufs.set(rel, fetch("/clips/" + rel).then(r => r.arrayBuffer()).then(b => Lab.actx.decodeAudioData(b))); return bufs.get(rel); };
  const gainFor = lv => M.stack ? 0.6 : (lv === M.level ? 1 : 0);
  const files = () => set().takes[M.take].profiles[M.prof].levels;
  const posOf = d => (((Lab.actx.currentTime - d.t0) % loopS()) + loopS()) % loopS();
  // What ships from a set: its liked takes, or (none liked) every take not thumbed down.
  function ships(k) {
    const all = set(k).takes.flatMap(t => Object.keys(t.profiles).map(p => ({ t: t.id, p, v: Lab.V.clips[voteId(k, t.id, p)] || 0 })));
    const liked = all.filter(x => x.v === 1);
    return { liked: liked.length, list: (liked.length ? liked : all.filter(x => x.v !== -1)).map(x => `${x.t} · ${x.p}`) };
  }

  function ramp(param, target, at, dur) {  // equal power, from the value held at `at`
    const from = param.value;
    param.cancelScheduledValues(at);
    if (dur <= 0.02) { param.setValueAtTime(target, at); return; }
    const c = new Float32Array(64);
    for (let i = 0; i < 64; i++) { const x = i / 63; c[i] = Math.sqrt(from * from * (1 - x) + target * target * x); }
    param.setValueCurveAtTime(c, at, dur);
  }
  function nextBar(deck = M.deck) {
    const now = Lab.actx.currentTime, b = barS();
    const at = deck.t0 + Math.ceil((now - deck.t0) / b + 1e-6) * b;
    return at - now < 0.08 ? at + b : at;
  }
  async function makeDeck(key, take, prof, at, offset) {
    const fl = set(key).takes[take].profiles[prof].levels;
    const loaded = Object.fromEntries(await Promise.all(mesh().levels.map(async lv => [lv, await buf(fl[lv])])));
    const d = { t0: at - offset, src: {}, gain: {}, meter: {}, out: Lab.actx.createGain() };
    d.out.connect(out);
    for (const lv of mesh().levels) {
      const s = Lab.actx.createBufferSource(), g = Lab.actx.createGain(), m = Lab.actx.createAnalyser();
      s.buffer = loaded[lv]; s.loop = true; s.loopEnd = loaded[lv].duration;
      g.gain.value = gainFor(lv); m.fftSize = 1024;
      s.connect(g).connect(m).connect(d.out);
      s.start(Math.max(at, Lab.actx.currentTime), offset);
      d.src[lv] = s; d.gain[lv] = g; d.meter[lv] = m;
    }
    return d;
  }
  function kill(d, at, fade) {
    d.out.gain.cancelScheduledValues(at);
    d.out.gain.setValueAtTime(d.out.gain.value, at);
    d.out.gain.linearRampToValueAtTime(0, at + Math.max(fade, 0.01));
    for (const s of Object.values(d.src)) s.stop(at + Math.max(fade, 0.01) + 0.02);
  }
  async function play(offset = 0) {
    if (Lab.actx.state === "suspended") await Lab.actx.resume();
    Lab.stop();
    const at = Lab.actx.currentTime + 0.06, d = await makeDeck(M.key, M.take, M.prof, at, offset);
    if (M.deck) kill(M.deck, at, 0.03);
    M.deck = d; M.pendingAt = 0;
    cancelAnimationFrame(M.raf); tick(); paint();
  }
  function stop() {
    if (M.deck) { kill(M.deck, Lab.actx.currentTime, 0.05); M.deck = null; }
    M.pendingAt = 0; cancelAnimationFrame(M.raf); M.raf = 0; paint(); idle();
  }
  function seekBar(bar) {  // jump to a bar now (wrapping), playing from there
    const n = mesh().bars;
    play((((bar % n) + n) % n) * barS());
  }
  function setLevel(lv) {
    if (lv) M.level = lv;
    if (M.deck) {
      const at = M.quant ? nextBar() : Lab.actx.currentTime + 0.02, dur = FADES[M.fade][1] * beatS();
      for (const l of mesh().levels) ramp(M.deck.gain[l].gain, gainFor(l), at, dur);
      if (M.quant) M.pendingAt = at;
    }
    paint(); drawTimeline();
  }
  async function switchTo(change) {  // a new take, profile or set enters on the next bar line
    Object.assign(M, change);
    if (!set().takes[M.take].profiles[M.prof]) M.prof = Object.keys(set().takes[M.take].profiles)[0];
    Lab.setHash(M.key);
    if (!M.deck) { render(); return; }
    const old = M.deck, at = nextBar(old);
    const offset = M.enter === "start" ? 0 : (((at - old.t0) % loopS()) + loopS()) % loopS();
    const xf = M.fade === "cut" ? 0 : beatS();
    M.deck = await makeDeck(M.key, M.take, M.prof, at, offset);
    if (xf > 0.02) { M.deck.out.gain.setValueAtTime(0, Lab.actx.currentTime); M.deck.out.gain.setValueAtTime(0, at); M.deck.out.gain.linearRampToValueAtTime(1, at + xf); }
    kill(old, at, xf);
    M.pendingAt = at;
    render();
  }

  // ---- drawing: the clock, the timeline (the shape of the level you hear), meters and a spectrum
  function shape(rel) {
    if (!shapes.has(rel)) shapes.set(rel, buf(rel).then(b => {
      const n = b.length, d = new Float32Array(n);
      for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] += x[i] / b.numberOfChannels; }
      return Lab.buckets(d, 1200);
    }));
    return shapes.get(rel);
  }
  async function loadShape() {
    const want = files()[M.stack ? mesh().levels[mesh().levels.length - 1] : M.level], key = M.key;
    try { M.shape = await shape(want); M.shapeFor = want; } catch { M.shape = null; }
    if (key === M.key) drawTimeline();
  }
  function drawTimeline(prog = -1) {
    const tl = $("tl");
    if (!tl || !M.shape) return;
    const cv = tl.querySelector("canvas");
    Lab.paintWave(cv, M.shape, { progress: prog, tone: "focus" });
    const g = cv.getContext("2d"), w = cv.clientWidth, h = cv.clientHeight, m = mesh();
    for (let b = 1; b < m.bars * m.bar_beats; b++) {
      const x = Math.round(w * b / (m.bars * m.bar_beats)) + .5, bar = b % m.bar_beats === 0;
      g.fillStyle = bar ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.03)";
      g.fillRect(x, bar ? 0 : h - 6, 1, bar ? h : 6);
    }
  }
  function drawSpectrum(live) {
    const cv = $("mspec");
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const n = Math.max(24, Math.floor(w / 7)), bw = w / n - 2, sr = Lab.actx.sampleRate, bin = sr / an.fftSize, fmin = 35, fmax = 16000;
    if (live) an.getFloatFrequencyData(spec);
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "#8b7bff"); grad.addColorStop(1, "#5bd6ff");
    g.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (live) {
        const b0 = Math.floor(fmin * Math.pow(fmax / fmin, i / n) / bin), b1 = Math.max(b0 + 1, Math.floor(fmin * Math.pow(fmax / fmin, (i + 1) / n) / bin));
        let db = -200; for (let b = b0; b < b1; b++) if (spec[b] > db) db = spec[b];
        v = Lab.clamp((db + 92) / 66, 0, 1);
      }
      const bh = Math.max(2, v * (h - 2)), x = i * (w / n) + 1;
      g.globalAlpha = live ? .35 + .65 * v : .25;
      g.beginPath(); g.roundRect ? g.roundRect(x, h - bh, bw, bh, 1.5) : g.rect(x, h - bh, bw, bh); g.fill();
    }
    g.globalAlpha = 1;
  }
  function idle() {
    drawSpectrum(false); drawTimeline();
    const c = $("clock"); if (c) c.innerHTML = `1.1<small>/ ${mesh().bars}</small>`;
    document.querySelectorAll("#beats i").forEach(i => i.classList.remove("on"));
    const hd = document.querySelector("#tl .head"); if (hd) hd.style.display = "none";
    document.querySelectorAll(".lvl .vu div").forEach(d => d.style.width = "0");
    document.querySelectorAll("#tl .barnums span").forEach(s => s.classList.remove("now"));
  }
  function tick() {
    const d = M.deck;
    if (!d) return;
    const now = Lab.actx.currentTime, pos = posOf(d), m = mesh();
    const bar = Math.floor(pos / barS()), beat = Math.floor(pos / beatS()) % m.bar_beats, started = now >= d.t0;
    const clock = $("clock");
    if (clock) clock.innerHTML = started ? `${bar + 1}.${beat + 1}<small>/ ${m.bars}</small>` : "…";
    document.querySelectorAll("#beats i").forEach((el, i) => el.classList.toggle("on", started && i === beat));
    document.querySelectorAll("#tl .barnums span").forEach((el, i) => el.classList.toggle("now", started && i === bar));
    const hd = document.querySelector("#tl .head");
    if (hd) { hd.style.display = started ? "block" : "none"; hd.style.left = `${100 * pos / loopS()}%`; }
    for (const lv of m.levels) {
      const card = document.querySelector(`.lvl[data-lv="${CSS.escape(lv)}"]`);
      if (!card) continue;
      d.meter[lv].getFloatTimeDomainData(wav);
      let s = 0; for (let i = 0; i < wav.length; i++) s += wav[i] * wav[i];
      const db = 10 * Math.log10(s / wav.length + 1e-12);
      card.querySelector(".vu div").style.width = `${Math.round(100 * Lab.clamp((db + 54) / 48, 0, 1))}%`;
      card.querySelector(".mix div").style.width = `${Math.round(100 * Math.min(1, d.gain[lv].gain.value / (M.stack ? 0.6 : 1)))}%`;
    }
    drawSpectrum(true);
    drawTimeline(started ? pos / loopS() : -1);
    if (M.pendingAt && now >= M.pendingAt) { M.pendingAt = 0; paint(); }
    M.raf = requestAnimationFrame(tick);
  }

  function show(arg) {
    if (!mesh() || !keys().length) { Lab.showEmpty("layers", "No music yet", `<p>Make some with <code>soundlab music generate --contexts …</code>.</p>`); return; }
    if (arg && mesh().contexts[arg]) { if (arg !== M.key) M.take = 0; M.key = arg; }
    if (!M.key || !set()) M.key = keys()[0];
    M.take = Math.min(M.take, set().takes.length - 1);
    M.level = M.level && mesh().levels.includes(M.level) ? M.level : mesh().levels[Math.floor(mesh().levels.length / 2)];
    M.prof = M.prof && mesh().profiles.includes(M.prof) ? M.prof : mesh().profiles[mesh().profiles.length - 1];
    Lab.setHash(M.key);
    render();
  }
  function render() {
    const m = mesh(), c = set();
    if (!c.takes.length) { Lab.showEmpty("layers", `No takes passed for ${M.key}`, ""); return; }
    if (!c.takes[M.take].profiles[M.prof]) M.prof = Object.keys(c.takes[M.take].profiles)[0];
    const take = c.takes[M.take], info = (take.profiles[M.prof] || {}).info || {}, v = Lab.V.clips[voteId()], sh = ships(M.key);
    const dot = t => { const x = Lab.V.clips[voteId(M.key, t.id)]; return x === 1 ? `<span class="dot"></span>` : x === -1 ? `<span class="dot bad"></span>` : ""; };
    const page = document.querySelector(".page.music"), y = page ? page.scrollTop : 0;
    Lab.view().innerHTML = `<div class="page music"><div class="wrap">
      <div class="page-head"><div><div class="eyebrow">${m.bpm} BPM · ${m.bar_beats}/4 · ${m.bars}-bar loops · ${loopS().toFixed(1)} s</div><h1>Music</h1>
        <p class="lede">A take's levels play in sync the whole time; intensity is only their volumes, so it moves at any moment.
          Switching take, profile or set enters on the next bar line. Click the timeline to jump to a bar.</p></div></div>
      ${m.provisional ? `<div class="warn">${icon("flag")}Provisional instrument pool: choose instruments on the Instruments page, then regenerate.</div>` : ""}
      <div class="sets">${keys().map(k => { const sc = m.contexts[k], n = ships(k).liked; return `<button class="setc ${k === M.key ? "on" : ""}" data-key="${esc(k)}">
        <b>${esc(k.replace(".", " · "))}</b><small><span>${esc(sc.mode)}</span><span>${sc.takes.length} take${sc.takes.length === 1 ? "" : "s"}</span>${n ? `<span class="liked">${n} liked</span>` : ""}</small></button>`; }).join("")}</div>
      <section class="card transport">
        <div class="ttop">
          <button class="playbtn" id="mplay" data-tip="Play or stop (Space)">${icon(M.deck ? "stop" : "play")}</button>
          <div class="clock"><div class="big" id="clock">1.1<small>/ ${m.bars}</small></div><div class="beats" id="beats">${"<i></i>".repeat(m.bar_beats)}</div></div>
          <div class="readouts"><div><span class="lbl">Mode</span><b>${esc(c.mode)}</b></div><div><span class="lbl">Take</span><b>${esc(take.id)}</b></div>
            <div><span class="lbl">Profile</span><b>${esc(M.prof)}</b></div></div>
          <canvas class="spectrum" id="mspec"></canvas>
        </div>
        <div class="timeline" id="tl"><canvas></canvas><div class="head"></div><div class="hover"><span></span></div>
          <div class="barnums" style="grid-template-columns:repeat(${m.bars},1fr)">${Array.from({ length: m.bars }, (_, i) => `<span>${i + 1}</span>`).join("")}</div></div>
        <div class="levels">${m.levels.map((lv, i) => `<button class="lvl ${!M.stack && M.level === lv ? "on" : ""}" data-lv="${esc(lv)}">
            <span class="t"><b>${esc(lv)}</b><kbd>${i + 1}</kbd></span>
            <small>${info[lv] && info[lv].noise ? `derived at ${info[lv].noise}` : "the spine"}${info[lv] && info[lv].lock != null ? ` · lock ${info[lv].lock}` : ""}</small>
            <div class="vu"><div></div></div><div class="mix"><div></div></div></button>`).join("")}
          <button class="btn stackbtn ${M.stack ? "on" : ""}" id="mstack" data-tip="Every level at once: do they clash? (S)">${icon("layers")}<span>Stack</span></button></div>
      </section>
      <div class="mtake">
        <div class="field"><label>Take</label>${Lab.seg(c.takes.map((t, i) => [String(i), `${dot(t)}${esc(t.id)}`]), String(M.take), "take")}</div>
        <div class="field"><label>Profile</label>${Lab.seg(m.profiles.map(p => [p, p, !take.profiles[p], PROFILE_INFO[p]]), M.prof, "prof")}</div>
        <div class="field grow"><label>Plays</label><div class="lineup">${Object.entries(take.instruments || {}).map(([r, n]) =>
          `<span class="chip" data-tip="${esc(r.replace(/_/g, " "))}">${esc(n)}</span>`).join("")}</div></div>
        <div class="field"><label>This take</label><div class="row">
          <button class="btn good ${v === 1 ? "on" : ""}" id="mup" data-tip="Liked takes ship as tracks in rotation (U)">${icon("up")}Like</button>
          <button class="btn bad ${v === -1 ? "on" : ""}" id="mdown" data-tip="Dislike (D)">${icon("down")}</button></div></div>
      </div>
      <div class="mopts">
        <div class="field"><label>Fade</label>${Lab.seg(Object.entries(FADES).map(([k, [l]]) => [k, l]), M.fade, "fade")}</div>
        <div class="field"><label>Intensity changes</label>${Lab.seg([["now", "now"], ["bar", "on the next bar"]], M.quant ? "bar" : "now", "quant")}</div>
        <div class="field"><label>A switch enters</label>${Lab.seg([["start", "at bar 1"], ["same", "at the same bar"]], M.enter, "enter")}</div>
      </div>
      <div class="facts"><span>tempo <b>${take.measured_bpm} → ${take.corrected_bpm} BPM</b></span>${take.beat_spread_ms != null ? `<span>beat spread <b>${take.beat_spread_ms} ms</b></span>` : ""}
        <span>beat lock <b>${m.levels.map(lv => info[lv] ? `${lv} ${info[lv].lock}` : "").filter(Boolean).join(", ")}</b></span>
        <span>ships <b>${sh.list.length ? esc(sh.list.join(", ")) : "nothing"}</b>${sh.liked ? "" : " (none liked: every take not thumbed down)"}</span></div>
      <div class="notebox ${Lab.V.notes["mesh_" + M.key] ? "has" : ""}">${icon("pen")}<textarea id="mnote" rows="1"
        placeholder="Notes on ${esc(M.key)}: do the levels mesh? Which lineups work?">${esc(Lab.V.notes["mesh_" + M.key] || "")}</textarea><span class="saved">${icon("check")}saved</span></div>
      <details class="prompts"><summary>${icon("right")}Prompts</summary>
        ${m.levels.map(lv => `<div class="p"><b>${esc(lv)}</b>${esc((take.prompts || c.prompts || {})[lv])}</div>`).join("")}</details></div></div>`;
    document.querySelector(".page.music").scrollTop = y;
    const vw = Lab.view();
    vw.querySelectorAll("[data-key]").forEach(b => b.onclick = () => switchTo({ key: b.dataset.key, take: 0 }));
    vw.querySelectorAll("[data-take]").forEach(b => b.onclick = () => switchTo({ take: +b.dataset.take }));
    vw.querySelectorAll("[data-prof]").forEach(b => b.onclick = () => switchTo({ prof: b.dataset.prof }));
    vw.querySelectorAll("[data-fade]").forEach(b => b.onclick = () => { M.fade = b.dataset.fade; render(); });
    vw.querySelectorAll("[data-quant]").forEach(b => b.onclick = () => { M.quant = b.dataset.quant === "bar"; render(); });
    vw.querySelectorAll("[data-enter]").forEach(b => b.onclick = () => { M.enter = b.dataset.enter; render(); });
    vw.querySelectorAll(".lvl").forEach(b => b.onclick = () => { M.stack = false; setLevel(b.dataset.lv); loadShape(); });
    $("mplay").onclick = () => M.deck ? stop() : play();
    $("mstack").onclick = () => { M.stack = !M.stack; setLevel(); loadShape(); };
    $("mup").onclick = () => vote(1);
    $("mdown").onclick = () => vote(-1);
    Lab.wireNote($("mnote"), "mesh_" + M.key);
    const tl = $("tl"), hv = tl.querySelector(".hover");
    const barAt = e => { const r = tl.getBoundingClientRect(); return Lab.clamp((e.clientX - r.left) / r.width, 0, .9999) * m.bars; };
    tl.onmousemove = e => {
      const b = barAt(e), bi = Math.floor(b), beat = Math.floor((b - bi) * m.bar_beats);
      hv.style.left = `${100 * bi / m.bars}%`; hv.style.width = `${100 / m.bars}%`;
      hv.firstElementChild.textContent = e.shiftKey ? `bar ${bi + 1}.${beat + 1}` : `bar ${bi + 1}`;
    };
    tl.onclick = e => { const b = barAt(e); if (e.shiftKey) play((Math.floor(b * m.bar_beats) / m.bar_beats) * barS()); else seekBar(Math.floor(b)); };
    tl.dataset.tip = "Click to jump to a bar · Shift-click for a beat";
    paint();
    if (M.shapeFor !== files()[M.stack ? m.levels[m.levels.length - 1] : M.level]) M.shape = null;
    loadShape();
    if (!M.deck) idle(); else { cancelAnimationFrame(M.raf); tick(); }
  }
  function paint() {
    if (Lab.tab !== "music") return;
    const p = $("mplay");
    if (p) p.innerHTML = icon(M.deck ? "stop" : "play");
    document.querySelectorAll(".lvl").forEach(b => b.classList.toggle("on", !M.stack && b.dataset.lv === M.level));
    const st = $("mstack");
    if (st) st.classList.toggle("on", M.stack);
    const pend = M.pendingAt && M.deck ? Math.floor(((((M.pendingAt - M.deck.t0) % loopS()) + loopS()) % loopS()) / barS()) : -1;
    document.querySelectorAll("#tl .barnums span").forEach((el, i) => el.classList.toggle("pend", i === pend));
  }
  async function vote(v) {
    const id = voteId(), now = Lab.V.clips[id] === v ? 0 : v, t = set().takes[M.take].id;
    await Lab.vote({ clip: id, value: now }, { label: `${now === 1 ? "Liked" : now === -1 ? "Disliked" : "Vote cleared on"} ${M.key} ${t} · ${M.prof}`, icon: now === -1 ? "down" : now ? "up" : "x" });
    render();
  }

  Lab.register("music", {
    title: "Music", icon: "layers", show, refresh: render, dock: false, enabled: () => Lab.project.features.music, leave: stop,
    keys: [["Space", "play or stop"], ["1 2 3", "quietest … fullest level"], ["S", "stack every level"], ["← →", "jump a bar back / forward"],
           ["[ ]", "previous / next take"], ["P", "next profile"], ["U", "like this take"], ["D", "dislike this take"], ["Esc", "stop"]],
    onKey(e) {
      if (!mesh() || !M.key || !set().takes.length) return;
      const k = e.key, n = set().takes.length;
      if (k === " ") { e.preventDefault(); M.deck ? stop() : play(); }
      else if (/^[1-9]$/.test(k) && mesh().levels[+k - 1]) { M.stack = false; setLevel(mesh().levels[+k - 1]); loadShape(); }
      else if (k === "s" || k === "S") { M.stack = !M.stack; setLevel(); loadShape(); }
      else if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); const b = M.deck ? Math.floor(posOf(M.deck) / barS()) : 0; seekBar(b + (k === "ArrowRight" ? 1 : -1)); }
      else if (k === "[" || k === "]") switchTo({ take: (M.take + (k === "]" ? 1 : -1) + n) % n });
      else if (k === "p" || k === "P") switchTo({ prof: mesh().profiles[(mesh().profiles.indexOf(M.prof) + 1) % mesh().profiles.length] });
      else if (k === "u") vote(1);
      else if (k === "d") vote(-1);
      else if (k === "Escape") stop();
    },
  });
})();
