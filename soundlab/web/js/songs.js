// Songs: every track the game ships (its music manifest, not the work index), each as two states: mellow (its calm
// level) and intense (its battle level, or action). The Music page's transport plays the song loaded from the list:
// the clock, a waveform timeline by bar, a level card per state, the spectrum. Thumbs go on each state
// ("song_<track>.mellow" / ".intense").
//
// Cues (2026-10-20): SA3 builds across a piece, so a loop's last bars are a crescendo and its first bar still carries
// it. Each state can loop just its middle, between two cues: guessed by `soundlab music trims`, dragged along the
// timeline by the designer (snapping to bar lines) and saved in votes.json "cues". With "crescendo transition" on,
// going intense plays the mellow's outer slices in their own order (the bars after its end cue, then bars 1 up to its
// start cue: one seamless passage, the loop's own wrap) and lands on intense at the start cue.
//
// Playback is one voice per song at a time: a level's buffer looping between its cues, its position kept on the
// original 16-bar timeline. A switch is the game's two-beat equal-power crossfade, and keeps the place in the bar, so
// the beat never breaks. A cued loop's wrap gets a short crossfade baked in (as the game's files would have).
(() => {
  const { icon, esc } = Lab, $ = id => document.getElementById(id);
  const PREF = "soundlab.songs", STATES = ["mellow", "intense"];
  const S = Object.assign({ intense: "battle", group: "all", show: "all", cueM: true, cueI: false, cresc: true },
    (() => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } })());
  Object.assign(S, { lib: null, sel: null, state: "mellow", cur: null, pending: [], gen: 0, raf: 0, shuffle: false, medley: false, played: [], rise: null,
                     shape: null, shapeFor: null, drag: null });
  const save = () => { try { localStorage.setItem(PREF, JSON.stringify({ intense: S.intense, group: S.group, show: S.show, cueM: S.cueM, cueI: S.cueI, cresc: S.cresc })); } catch { /* ignore */ } };
  const bufs = new Map(), baked = new Map(), shapes = new Map(), MAX_BUFS = 12;  // (a 43 s level decodes to about 15 MB)
  const SEAM = 0.12;  // seconds of crossfade baked into a cued loop's wrap
  // out → spectrum analyser → master; each state has a bus with its own meter (the level cards' VU)
  const out = Lab.actx.createGain(), an = Lab.actx.createAnalyser();
  out.gain.value = 0.9; an.fftSize = 4096; an.smoothingTimeConstant = .8;
  out.connect(an); an.connect(Lab.master);
  const spec = new Float32Array(an.frequencyBinCount), wav = new Float32Array(1024);
  const bus = Object.fromEntries(STATES.map(st => { const g = Lab.actx.createGain(), m = Lab.actx.createAnalyser(); m.fftSize = 1024; g.connect(m); m.connect(out); return [st, { g, m }]; }));
  Lab.onFlush(() => { bufs.clear(); baked.clear(); shapes.clear(); S.shape = null; S.shapeFor = null; });

  const L = () => S.lib;
  const N = () => L().bars;
  const beatS = () => 60 / L().bpm, barS = () => beatS() * L().bar_beats, loopS = () => barS() * N();
  const level = st => st === "mellow" ? "calm" : S.intense;
  const measured = st => st === "mellow" ? "calm" : "battle";  // (the guesses and loudness are measured on calm and battle)
  const voteId = (t, st) => `song_${t.id}.${st}`;
  const vote = (t, st) => Lab.V.clips[voteId(t, st)] || 0;
  const track = id => L().tracks.find(t => t.id === id);
  const sel = () => track(S.sel);
  const name = t => t.key ? `${t.key.replace(/~/g, " · ")} · ${t.take}` : t.id;
  const groupName = g => (L().groups[g] || {}).name || g || "no group";
  const groupOrder = () => [...Object.keys(L().groups), ...new Set(L().tracks.map(t => t.group).filter(g => !(g in L().groups)))];
  // Cues: yours (votes.json) or the best guess; [1, N] when the track isn't measured.
  const mine = (t, st) => ((Lab.V.cues || {})[t.id] || {})[st] || null;
  const guesses = (t, st) => ((t.measure || {}).cuts || {})[measured(st)] || [];
  const cues = (t, st) => mine(t, st) || (guesses(t, st)[0] || {}).bars || [1, N()];
  const cued = st => st === "mellow" ? S.cueM : S.cueI;
  const loopOf = (t, st) => cued(st) ? cues(t, st) : [1, N()];

  function visible() {
    const keep = t => (S.group === "all" || t.group === S.group || (S.group === "families" && t.family)) && (
      S.show === "all" || (S.show === "liked" && vote(t, "mellow") > 0) || (S.show === "unrated" && !vote(t, "mellow")) || (S.show === "disliked" && vote(t, "mellow") < 0));
    const order = groupOrder();
    const fk = t => t.family ? t.family.key : "";
    return L().tracks.filter(keep).sort(S.group === "families" ? (a, b) => fk(a).localeCompare(fk(b)) || a.id.localeCompare(b.id)
      : (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.id.localeCompare(b.id));
  }

  // ---- audio
  function buf(rel) {
    if (bufs.has(rel)) { const b = bufs.get(rel); bufs.delete(rel); bufs.set(rel, b); return b; }
    const b = fetch("/shipped/" + rel).then(r => { if (!r.ok) throw new Error(`${r.status} ${rel}`); return r.arrayBuffer(); }).then(x => Lab.actx.decodeAudioData(x));
    bufs.set(rel, b); b.catch(() => bufs.delete(rel));
    while (bufs.size > MAX_BUFS) { const k = bufs.keys().next().value; bufs.delete(k); for (const x of baked.keys()) if (x.startsWith(k + "|")) baked.delete(x); }
    return b;
  }
  const loadTrack = t => Promise.all(STATES.map(st => buf(t.files[level(st)])));
  // A level cut to end at bar `le`, its last SEAM seconds faded into what comes before bar `ls`, so looping
  // [ls, le] wraps without a click. The whole loop needs nothing: it's a seamless circle already.
  function bake(rel, b, ls, le) {
    if (ls === 1 && le === N()) return b;
    const key = `${rel}|${ls}-${le}`;
    if (baked.has(key)) return baked.get(key);
    const sr = b.sampleRate, bar = Math.round(barS() * sr), end = Math.min(b.length, le * bar), x = Math.round(SEAM * sr), total = b.length;
    const nb = Lab.actx.createBuffer(b.numberOfChannels, end, sr);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const src = b.getChannelData(c), d = nb.getChannelData(c);
      d.set(src.subarray(0, end));
      for (let i = 0; i < x; i++) {
        const k = end - x + i, f = (i + .5) / x, j = (((ls - 1) * bar - x + i) % total + total) % total;
        d[k] = d[k] * Math.cos(f * Math.PI / 2) + src[j] * Math.sin(f * Math.PI / 2);
      }
    }
    baked.set(key, nb);
    return nb;
  }
  function fade(param, from, to, at, dur) {  // equal power
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at); else param.cancelScheduledValues(at);
    if (dur <= 0.02) { param.setValueAtTime(to, at); return; }
    const c = new Float32Array(64);
    for (let i = 0; i < 64; i++) { const k = i / 63; c[i] = Math.sqrt(from * from * (1 - k) + to * to * k); }
    try { param.setValueCurveAtTime(c, at, dur); } catch { param.setValueAtTime(to, at); }
  }
  // A voice: one level of one song looping bars ls..le, started at `at` from `off` seconds into the original timeline.
  function voice(t, st, b, at, off, [ls, le], fadeIn) {
    const rel = t.files[level(st)], bb = bake(rel, b, ls, le), s = Lab.actx.createBufferSource(), g = Lab.actx.createGain();
    s.buffer = bb; s.loop = true; s.loopStart = (ls - 1) * barS(); s.loopEnd = Math.min(bb.duration, le * barS());
    g.gain.value = fadeIn > 0.02 ? 0 : 1;
    s.connect(g).connect(bus[st].g); s.start(at, off);
    if (fadeIn > 0.02) fade(g.gain, 0, 1, at, fadeIn);
    return { id: t.id, st, src: s, g, t0: at, off, ls: s.loopStart, le: s.loopEnd };
  }
  function pos(v, time) {  // where a voice is on the original timeline (seconds from bar 1)
    const p = v.off + Math.max(0, time - v.t0);
    return p < v.le ? p : v.ls + (p - v.ls) % (v.le - v.ls);
  }
  function mapPos(p, [ls, le]) {  // a position inside a loop of ls..le: the same, or its loop start at the same place in the bar
    return p < le * barS() - 0.01 ? p : (ls - 1) * barS() + (p % barS());
  }
  function drop(v, at, dur) {
    if (!v) return;
    fade(v.g.gain, v.g.gain.value, 0, at, dur);
    try { v.src.stop(at + dur + 0.05); } catch { /* (already stopped) */ }
    setTimeout(() => v.g.disconnect(), Math.max(0, at + dur - Lab.actx.currentTime + 0.3) * 1000);
  }
  function clearPending(at) { S.pending.forEach(v => drop(v, at, 0.03)); S.pending = []; S.rise = null; }
  // From `off` on the whole level (outside its cues: a cut-off end), through bar N and round into its loop at the start
  // cue: the bars play as they are, then the cued loop takes over on that bar line.
  function passInto(t, st, b, at, off, fadeIn) {
    const loop = loopOf(t, st), dist = (((loop[0] - 1) * barS() - off) % loopS() + loopS()) % loopS();
    const pass = voice(t, st, b, at, off, [1, N()], fadeIn), land = at + dist;
    return { pass, land, next: voice(t, st, b, land, (loop[0] - 1) * barS(), loop, 0) };
  }

  async function play(id, st = S.state, fromBar = null) {
    const t = track(id), g = ++S.gen;
    if (!t) return;
    if (Lab.actx.state === "suspended") await Lab.actx.resume();
    Lab.stop();
    if (S.sel !== id) { S.sel = id; renderTransport(); }
    S.state = st; paint();
    let bs;
    try { bs = await loadTrack(t); } catch { if (g === S.gen) Lab.toast(`Couldn't load ${name(t)}`, { icon: "x" }); return; }
    if (g !== S.gen) return;
    const at = Lab.actx.currentTime + 0.05, loop = loopOf(t, st), b = bs[STATES.indexOf(st)];
    clearPending(at); drop(S.cur, at, 0.04);
    const off = fromBar == null ? (loop[0] - 1) * barS() : fromBar * barS();  // (a cued loop starts at its start cue)
    if (off >= (loop[0] - 1) * barS() && off < loop[1] * barS()) S.cur = voice(t, st, b, at, off, loop, 0);
    else {  // (a bar outside the loop: hear it, then round into the loop)
      const p = passInto(t, st, b, at, off, 0);
      fade(p.pass.g.gain, 1, 0, p.land, 0.03); try { p.pass.src.stop(p.land + 0.08); } catch { /* ignore */ }
      S.cur = p.pass; S.pending = [p.next];
    }
    if (S.played[S.played.length - 1] !== id) S.played.push(id);
    cancelAnimationFrame(S.raf); tick(); paint();
  }
  function stop() {
    S.gen++;
    const now = Lab.actx.currentTime;
    clearPending(now); drop(S.cur, now, 0.06); S.cur = null; S.shuffle = false;
    cancelAnimationFrame(S.raf); S.raf = 0; paint(); idle();
  }
  // The game's intensity change: a two-beat crossfade, at the same place (mapped into the new state's loop). With the
  // crescendo transition on, intense comes through the mellow's outer slices first.
  async function setState(st, { quick = false } = {}) {
    if (!S.cur) { S.state = st; paint(); loadShape(); return; }
    const t = track(S.cur.id), g = S.gen;
    let bs;
    try { bs = await loadTrack(t); } catch { return; }
    if (g !== S.gen || !S.cur) return;
    const at = Lab.actx.currentTime + 0.03, xf = quick ? beatS() / 4 : 2 * beatS(), p = pos(S.cur, at), from = S.cur;
    clearPending(at);
    S.state = st;
    const [ms, me] = cues(t, "mellow");
    if (st === "intense" && S.cresc && !(ms === 1 && me === N()) && !quick) {
      // the back slice (bars after the end cue) then the front (bars before the start cue): the calm level as it is
      const off = (me % N()) * barS() + (p % barS()), dist = (((ms - 1) * barS() - off) % loopS() + loopS()) % loopS();
      const pass = voice(t, "mellow", bs[0], at, off, [1, N()], xf), land = at + dist;
      const inLoop = loopOf(t, "intense"), hit = voice(t, "intense", bs[1], land, mapPos((ms - 1) * barS(), inLoop), inLoop, xf);
      drop(from, at, xf);
      fade(pass.g.gain, 1, 0, land, xf);  // (the passage hands over to intense at the start cue, over the same two beats)
      try { pass.src.stop(land + xf + 0.05); } catch { /* ignore */ }
      S.cur = pass; S.pending = [hit]; S.rise = { at: land };
    } else {
      const loop = loopOf(t, st);
      S.cur = voice(t, st, bs[STATES.indexOf(st)], at, mapPos(p, loop), loop, xf);
      drop(from, at, xf);
    }
    paint(); loadShape();
  }
  function seekBar(bar) {  // jump to a bar now (in the state playing; a bar outside its cues plays into the loop)
    const t = sel(); if (!t) return;
    S.shuffle = false;
    play(t.id, S.state, ((bar % N()) + N()) % N());
  }

  // Shuffle: the liked mellows (every one on show when none is liked yet), a random one next, never one just heard. A
  // song plays its loop through once (at least 15 s), and the next enters at its start cue two bars before that ends.
  const pool = () => { const v = visible(), liked = v.filter(t => vote(t, "mellow") > 0); return liked.length ? liked : v; };
  function pickNext() {
    const p = pool().filter(t => t.id !== (S.cur && S.cur.id)), fresh = p.filter(t => !S.played.slice(-Math.floor(p.length / 2)).includes(t.id));
    const from = fresh.length ? fresh : p;
    return from.length ? from[Math.floor(Math.random() * from.length)] : null;
  }
  async function startShuffle() {
    S.medley = false;
    const first = pickNext() || pool()[0];
    if (!first) return;
    await play(first.id, "mellow");
    S.shuffle = true; paint();
  }
  // The next song enters two bars before the playing loop's end (after one pass, at least 15 s), crossing over those
  // bars. A shuffled song enters at its start cue, in mellow; a sibling (medley) enters in step: the same bar, the same state.
  async function queueNext(t, inStep) {
    const v = S.cur, g = S.gen, st = inStep ? S.state : "mellow";
    if (!t || !v) return;
    S.queueing = true;
    let bs;
    try { bs = await loadTrack(t); } catch { S.queueing = false; return; }
    S.queueing = false;
    if (g !== S.gen || S.cur !== v || S.state !== st || S.rise) return;
    const now = Lab.actx.currentTime, period = v.le - v.ls;
    let end = v.t0 + (v.le - v.off);
    while (end - v.t0 < 15 || end - 2 * barS() < now + 0.2) end += period;
    const at = end - 2 * barS(), loop = loopOf(t, st);
    const nv = voice(t, st, bs[STATES.indexOf(st)], at, inStep ? mapPos(pos(v, at), loop) : (loop[0] - 1) * barS(), loop, 2 * barS());
    drop(v, at, 2 * barS());
    S.pending = [nv];
  }
  // Siblings: the same style and take made for other contexts, in step bar for bar (music trims: families).
  const family = t => t && t.family ? t.family.members.map(track).filter(Boolean) : [];
  const ctxName = t => (t.key || t.id).split(/[~.]/)[0];
  function nextSibling() {  // (the medley: round the family, skipping mellows you've thumbed down)
    const t = track(S.cur.id), f = family(t).filter(x => x.id === t.id || vote(x, "mellow") >= 0);
    return f.length > 1 ? f[(f.findIndex(x => x.id === t.id) + 1) % f.length] : null;
  }
  // Another song at the same bar, in the same state: a sibling in step, so the two-beat crossfade is all the join needs.
  async function switchTo(id) {
    const t = track(id);
    if (!t) return;
    if (!S.cur) { load(id); return; }
    const g = S.gen;
    let bs;
    try { bs = await loadTrack(t); } catch { return; }
    if (g !== S.gen || !S.cur) return;
    const at = Lab.actx.currentTime + 0.03, p = pos(S.cur, at), from = S.cur, loop = loopOf(t, S.state);
    clearPending(at);
    S.cur = voice(t, S.state, bs[STATES.indexOf(S.state)], at, mapPos(p, loop), loop, 2 * beatS());
    drop(from, at, 2 * beatS());
    S.sel = id; S.played.push(id); Lab.setHash(id);
    renderTransport();
    const row = document.querySelector(`.song[data-id="${CSS.escape(id)}"]`); if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---- drawing: the clock, the timeline (the shape of the state you hear, its cues), meters and the spectrum
  function shape(rel) {
    if (!shapes.has(rel)) {
      const p = buf(rel).then(b => {
        const n = b.length, d = new Float32Array(n);
        for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] += x[i] / b.numberOfChannels; }
        return Lab.buckets(d, 1200);
      });
      shapes.set(rel, p); p.catch(() => { if (shapes.get(rel) === p) shapes.delete(rel); });
    }
    return shapes.get(rel);
  }
  const shapeFile = () => { const t = sel(); return t ? t.files[level(S.state)] : null; };
  async function loadShape() {
    const want = shapeFile();
    if (!want) return;
    let got = null;
    try { got = await shape(want); } catch { /* (no waveform) */ }
    if (want !== shapeFile()) return;
    S.shape = got; S.shapeFor = got ? want : null;
    placeCues(); drawTimeline();
  }
  function drawTimeline(prog = -1) {
    const tl = $("stl");
    if (!tl || !S.shape) return;
    const cv = tl.querySelector("canvas");
    Lab.paintWave(cv, S.shape, { progress: prog, tone: "focus" });
    const g = cv.getContext("2d"), w = cv.clientWidth, h = cv.clientHeight, bb = L().bar_beats;
    for (let b = 1; b < N() * bb; b++) {
      const x = Math.round(w * b / (N() * bb)) + .5, isBar = b % bb === 0;
      g.fillStyle = isBar ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.03)";
      g.fillRect(x, isBar ? 0 : h - 6, 1, isBar ? h : 6);
    }
  }
  // The cue markers on the timeline: the state shown's loop (yours, or the guess while dragging), its cut-off ends shaded.
  function placeCues(bars) {
    const tl = $("stl"), t = sel();
    if (!tl || !t) return;
    const [s, e] = bars || cues(t, S.state), pct = k => `${(100 * k / N()).toFixed(3)}%`;
    tl.querySelector(".shade.front").style.width = pct(s - 1);
    tl.querySelector(".shade.back").style.left = pct(e);
    const hs = tl.querySelector(".cueh.start"), he = tl.querySelector(".cueh.end");
    hs.style.left = pct(s - 1); he.style.left = pct(e);
    hs.querySelector("span").textContent = `${s}`; he.querySelector("span").textContent = `${e}`;
    tl.classList.toggle("uncued", !cued(S.state));
    tl.classList.toggle("mine", !!mine(t, S.state));
    const info = $("scueinfo");
    if (info) {
      const g = guesses(t, S.state), cur = g.find(c => c.bars[0] === s && c.bars[1] === e), step = ((t.measure || {}).step || {})[measured(S.state)];
      info.innerHTML = `<b>${S.state}</b> loops bars <b>${s}–${e}</b> · ${e - s + 1} bars, ${((e - s + 1) * barS()).toFixed(1)} s · `
        + (bars ? "release to set" : mine(t, S.state) ? `<span class="yours">yours</span>` : g.length ? "my guess" : "not measured: run <code>soundlab music trims</code>")
        + (cur ? ` · the join scores ${cur.seam} <span class="dim">(its own bar-to-bar steps: ${step})</span>` : "")
        + (cued(S.state) ? "" : ` · <span class="dim">Cue ${S.state} is off: it plays all ${N()} bars</span>`);
    }
  }
  function idle() {
    Lab.drawSpectrum($("sspec"), an, spec, false); drawTimeline();
    const c = $("sclock"); if (c) c.innerHTML = `1.1<small>/ ${N()}</small>`;
    document.querySelectorAll("#sbeats i").forEach(i => i.classList.remove("on"));
    const hd = document.querySelector("#stl .head"); if (hd) hd.style.display = "none";
    document.querySelectorAll("#stp .lvl .vu div, #stp .lvl .mix div").forEach(d => d.style.width = "0");
    document.querySelectorAll("#stl .barnums span").forEach(s => s.classList.remove("now"));
    const r = $("srise"); if (r) r.textContent = "";
  }

  function tick() {
    if (!S.cur) return;
    const now = Lab.actx.currentTime;
    if (S.pending.length && now >= S.pending[0].t0) {  // (what was scheduled has entered: it is the voice now)
      const nv = S.pending.shift(), moved = nv.id !== S.cur.id, turned = nv.st !== S.cur.st;
      S.cur = nv; S.rise = null;
      if (moved) { S.played.push(nv.id); S.sel = nv.id; renderTransport(); const row = document.querySelector(`.song[data-id="${CSS.escape(nv.id)}"]`); if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      else if (turned) loadShape();
      paint();
    }
    const v = S.cur, p = pos(v, now), bar = Math.floor(p / barS()), beat = Math.floor(p / beatS()) % L().bar_beats, started = now >= v.t0;
    if (!S.pending.length && !S.queueing && !S.rise && now - v.t0 > 8) {
      if (S.medley) { const n = nextSibling(); if (n) queueNext(n, true); }
      else if (S.shuffle && S.state === "mellow") queueNext(pickNext(), false);
    }
    if (v.id === S.sel) {
      const clock = $("sclock");
      if (clock) clock.innerHTML = started ? `${bar + 1}.${beat + 1}<small>/ ${N()}</small>` : "…";
      document.querySelectorAll("#sbeats i").forEach((el, i) => el.classList.toggle("on", started && i === beat));
      document.querySelectorAll("#stl .barnums span").forEach((el, i) => el.classList.toggle("now", started && i === bar));
      const hd = document.querySelector("#stl .head");
      if (hd) { hd.style.display = started ? "block" : "none"; hd.style.left = `${100 * p / loopS()}%`; }
      for (const st of STATES) {
        const card = document.querySelector(`#stp .lvl[data-lv="${st}"]`);
        if (!card) continue;
        bus[st].m.getFloatTimeDomainData(wav);
        let s = 0; for (let i = 0; i < wav.length; i++) s += wav[i] * wav[i];
        card.querySelector(".vu div").style.width = `${Math.round(100 * Lab.clamp((10 * Math.log10(s / wav.length + 1e-12) + 54) / 48, 0, 1))}%`;
        const gsum = [S.cur, ...S.pending].filter(x => x && x.st === st && now >= x.t0).reduce((a, x) => a + x.g.gain.value, 0);
        card.querySelector(".mix div").style.width = `${Math.round(100 * Math.min(1, gsum))}%`;
      }
      const r = $("srise");
      if (r) r.textContent = S.rise ? `crescendo · intense in ${Math.max(0, Math.ceil((S.rise.at - now) / barS()))} bars` : "";
      Lab.drawSpectrum($("sspec"), an, spec, true);
      drawTimeline(started ? p / loopS() : -1);
    }
    const row = document.querySelector(`.song[data-id="${CSS.escape(v.id)}"]`);
    if (row) {
      row.querySelector(".prog div").style.width = `${(100 * p / loopS()).toFixed(2)}%`;
      row.querySelectorAll(".strip").forEach(s => s.querySelectorAll("i").forEach((c, i) => c.classList.toggle("now", s.dataset.st === v.st && i === bar)));
    }
    S.raf = requestAnimationFrame(tick);
  }

  // ---- the page
  async function show(arg) {
    if (!L()) {
      try { const r = await fetch("/api/songs"); if (!r.ok) throw new Error(r.status); S.lib = await r.json(); }
      catch { Lab.showEmpty("note", "Couldn't read the game's music", `<p>The server didn't give the shipped tracks. Check the terminal running <code>soundlab serve</code>.</p>`); return; }
    }
    if (!L().tracks.length) { Lab.showEmpty("note", "No music in the game yet", `<p>Ship some with <code>soundlab music promote --apply</code>.</p>`); return; }
    if (arg && track(arg)) S.sel = arg;
    if (!sel()) S.sel = (visible()[0] || L().tracks[0]).id;
    render();
  }
  function strip(t, st) {  // a row's glance at a state's 16 bars by loudness, its loop bright and its cut-off ends dim
    const loud = ((t.measure || {}).loud || {})[measured(st)] || [], [s, e] = cues(t, st), lo = Math.min(...loud), hi = Math.max(...loud);
    return `<span class="strip ${mine(t, st) ? "mine" : ""} ${cued(st) ? "" : "off"}" data-st="${st}" data-tip="${st}: bars ${s}–${e}${mine(t, st) ? " (yours)" : " (my guess)"}">${Array.from({ length: N() }, (_, i) =>
      `<i class="${i + 1 < s ? "front" : i + 1 > e ? "back" : "in"}" style="height:${(loud.length ? 22 + 78 * (loud[i] - lo) / Math.max(1e-6, hi - lo) : 50).toFixed(0)}%"></i>`).join("")}</span>`;
  }
  const thumbs = (t, st, big) => big
    ? `<span class="vt big"><span class="lbl">${st}</span><button class="btn good ${vote(t, st) > 0 ? "on" : ""}" data-v="1" data-st="${st}" data-tip="Like its ${st} (U)">${icon("up")}</button><button class="btn bad ${vote(t, st) < 0 ? "on" : ""}" data-v="-1" data-st="${st}" data-tip="Dislike its ${st} (D)">${icon("down")}</button></span>`
    : `<span class="vt"><span class="lbl">${st}</span><button class="tb good ${vote(t, st) > 0 ? "on" : ""}" data-v="1" data-st="${st}" data-tip="Like this song's ${st}">${icon("up")}</button><button class="tb bad ${vote(t, st) < 0 ? "on" : ""}" data-v="-1" data-st="${st}" data-tip="Dislike its ${st}">${icon("down")}</button></span>`;
  function transportHtml() {
    const t = sel(), m = L();
    if (!t) return "";
    const note = Lab.V.notes["mesh_" + t.key];
    const card = st => {
      const [s, e] = loopOf(t, st);
      return `<button class="lvl ${S.state === st ? "on" : ""}" data-lv="${st}">
        <span class="t"><b>${st}</b><kbd>${STATES.indexOf(st) + 1}</kbd></span>
        <small>${esc(level(st))} level · ${s === 1 && e === N() ? `all ${N()} bars` : `loops bars ${s}–${e}`}${mine(t, st) ? " · your cues" : ""}</small>
        <div class="vu"><div></div></div><div class="mix"><div></div></div></button>`;
    };
    return `<section class="card transport" id="stp">
        <div class="ttop">
          <button class="playbtn" id="splay" data-tip="Play or stop (Space)">${icon(S.cur && S.cur.id === t.id ? "stop" : "play")}</button>
          <div class="clock"><div class="big" id="sclock">1.1<small>/ ${N()}</small></div><div class="beats" id="sbeats">${"<i></i>".repeat(m.bar_beats)}</div></div>
          <div class="readouts"><div><span class="lbl">Song</span><b>${esc(name(t))}</b></div><div><span class="lbl">Group</span><b>${esc(groupName(t.group))}</b></div>
            <div><span class="lbl">Plays</span><b class="small">${esc(Object.values(t.instruments || {}).join(", ") || "–")}</b></div></div>
          <canvas class="spectrum" id="sspec"></canvas>
        </div>
        <div class="timeline cueline" id="stl"><canvas></canvas>
          <div class="shade front"></div><div class="shade back"></div>
          <div class="cueh start" data-h="start" data-tip="Start cue: drag to a bar line"><span></span></div>
          <div class="cueh end" data-h="end" data-tip="End cue: drag to a bar line"><span></span></div>
          <div class="head"></div><div class="hover"><span></span></div>
          <div class="barnums" style="grid-template-columns:repeat(${N()},1fr)">${Array.from({ length: N() }, (_, i) => `<span>${i + 1}</span>`).join("")}</div></div>
        <div class="cueinfo"><span id="scueinfo"></span><span class="rise" id="srise"></span>
          <span class="acts"><button class="btn ghost" id="snextg" data-tip="The next of my guesses for these cues">${icon("refresh")}Next guess</button>
          <button class="btn ghost" id="sreset" data-tip="Back to my best guess" ${mine(t, S.state) ? "" : "disabled"}>${icon("undo")}My guess</button></span></div>
        <div class="levels">${STATES.map(card).join("")}</div>
        ${family(t).length ? `<div class="family"><span class="lbl">Variations</span>
          ${family(t).map(x => `<button class="chip fam ${x.id === t.id ? "on" : ""} ${vote(x, "mellow") > 0 ? "liked" : vote(x, "mellow") < 0 ? "down" : ""}" data-sib="${esc(x.id)}"
            data-tip="${esc(name(x))}: the same piece made for ${esc(ctxName(x))}, in step bar for bar. Switching keeps the bar ([ ])">${esc(ctxName(x))}</button>`).join("")}
          <span class="dim">${esc(t.family.key)} · in step ${t.family.in_step}</span>
          <button class="btn ${S.medley ? "on" : ""}" id="smedley" data-tip="Play the family as one piece: each variation's loop once, the next taking over in step over two bars (F)">${icon("layers")}<span>Medley</span></button></div>` : ""}
      </section>
      <div class="mtake">
        <div class="field"><label>Loops</label><div class="row">
          ${toggle("scuem", S.cueM, "Cue mellow", "Mellow loops between its cues (off: the whole 16 bars)")}
          ${toggle("scuei", S.cueI, "Cue intense", "Intense loops between its cues (off: the whole 16 bars)")}
          ${toggle("scresc", S.cresc, "Crescendo transition", "Going intense plays the mellow's cut-off ends first (the bars after its end cue, then before its start cue) and lands on intense at the start cue (C)")}</div></div>
        <div class="field"><label>Intense is</label>${Lab.seg([["battle", "battle", false, "The top level: action with its drums pushed"], ["action", "action"]], S.intense, "intense")}</div>
        <div class="field"><label>This song</label><div class="row" id="sthumbs">${thumbs(t, "mellow", true)}${thumbs(t, "intense", true)}</div></div>
      </div>
      ${note ? `<div class="facts"><span>${icon("pen")} your note on ${esc(t.key)}: <b>${esc(note)}</b></span></div>` : ""}`;
  }
  const toggle = (id, on, label, tip) => `<button class="btn ${on ? "on" : ""}" id="${id}" data-tip="${esc(tip)}">${icon(on ? "check" : "x")}<span>${label}</span></button>`;
  function listHtml() {
    const v = visible(), all = L().tracks, groups = groupOrder(), count = (f, ts = all) => ts.filter(f).length, liked = t => vote(t, "mellow") > 0;
    const row = t => `<div class="song ${t.id === S.sel ? "sel" : ""}" data-id="${esc(t.id)}">
        <button class="pb" data-play data-tip="Play or stop">${icon("play")}</button>
        <div class="nm"><b>${esc(name(t))}</b>${t.family ? `<span class="famc" data-tip="${t.family.members.length} variations in step: ${esc(t.family.members.map(m => ctxName(track(m) || { id: m })).join(", "))}">${icon("layers")}${t.family.members.length}</span>` : ""}${Lab.V.notes["mesh_" + t.key] ? `<span class="nt" data-tip="${esc(Lab.V.notes["mesh_" + t.key])}">${icon("pen")}</span>` : ""}
          <small>${esc([t.profile, ...Object.values(t.instruments || {})].filter(Boolean).join(" · "))}</small></div>
        <span class="cues">${strip(t, "mellow")}${strip(t, "intense")}</span>
        ${thumbs(t, "mellow")}${thumbs(t, "intense")}
        <div class="prog"><div></div></div></div>`;
    const byGroup = S.group === "families"
      ? [...new Set(v.map(t => t.family.key))].map(k => { const ts = v.filter(t => t.family.key === k); return [`${k} · in step ${ts[0].family.in_step}`, ts]; })
      : groups.map(g => [g, v.filter(t => t.group === g)]).filter(([, ts]) => ts.length);
    return `<div class="sbar">
        <div class="field"><label>Group</label>${Lab.seg([["all", `All <small>${all.length}</small>`], ...groups.map(g => [g, `${esc(groupName(g))} <small>${count(t => t.group === g)}</small>`, false, (L().groups[g] || {}).about]),
          ["families", `Variations <small>${new Set(all.filter(t => t.family).map(t => t.family.key)).size}</small>`, false, "Siblings: the same piece made for other contexts, in step bar for bar"]], S.group, "group")}</div>
        <div class="field"><label>Mellow</label>${Lab.seg([["all", "all"], ["liked", `liked <small>${count(liked)}</small>`], ["unrated", `not rated <small>${count(t => !vote(t, "mellow"))}</small>`], ["disliked", `disliked <small>${count(t => vote(t, "mellow") < 0)}</small>`]], S.show, "show")}</div>
        <button class="btn ${S.shuffle ? "on" : ""}" id="sshuf" data-tip="Play ${count(liked, v) ? "the liked mellows on show" : "the mellows on show"} one after another, each crossing into the next over two bars (Shift S)">${icon("loop")}<span>Shuffle ${count(liked, v) ? `liked mellows · ${count(liked, v)}` : "mellows"}</span></button>
      </div>
      ${byGroup.length ? byGroup.map(([g, ts]) => `<h3>${esc(S.group === "families" ? g : groupName(g))} · ${ts.length}${count(liked, ts) ? ` · ${count(liked, ts)} mellow liked` : ""}</h3>
        <div class="songs-list">${ts.map(row).join("")}</div>`).join("") : `<div class="empty"><b>No songs match</b><p>Change the filters above.</p></div>`}`;
  }
  function render() {
    const all = L().tracks, unmeasured = all.filter(t => !t.measure).length, liked = all.filter(t => vote(t, "mellow") > 0).length;
    const page = document.querySelector(".page.songs"), y = page ? page.scrollTop : 0;
    Lab.view().innerHTML = `<div class="page songs"><div class="wrap">
      <div class="page-head"><div><div class="eyebrow">${all.length} songs in the game · ${L().bpm} BPM · ${N()}-bar loops · ${loopS().toFixed(1)} s</div><h1>Songs</h1>
        <p class="lede">Every song the game ships, as <b>mellow</b> (its calm level) and <b>intense</b> (its ${esc(S.intense)} level). Each loops between two cues,
          cutting off SA3's crescendo at the back and its hangover at the front (shaded). The cues are my guesses until you drag one along the timeline.
          ${liked} mellows liked so far.</p></div></div>
      ${unmeasured ? `<div class="warn">${icon("flag")}${unmeasured} song${unmeasured === 1 ? " isn't" : "s aren't"} measured, so ${unmeasured === 1 ? "it has" : "they have"} no cues: run <code>soundlab music trims</code>.</div>` : ""}
      <div id="stransport">${transportHtml()}</div>
      <div id="slist">${listHtml()}</div>
    </div></div>`;
    document.querySelector(".page.songs").scrollTop = y;
    wireTransport(); wireList();
    paint();
    if (S.shapeFor !== shapeFile()) S.shape = null;
    loadShape();
    if (S.cur) { cancelAnimationFrame(S.raf); tick(); } else idle();
  }
  function renderTransport() {
    const el = $("stransport"); if (!el) return;
    el.innerHTML = transportHtml();
    wireTransport();
    document.querySelectorAll(".song").forEach(r => r.classList.toggle("sel", r.dataset.id === S.sel));
    if (S.shapeFor !== shapeFile()) S.shape = null;
    loadShape(); paint();
    if (!S.cur || S.cur.id !== S.sel) idle();
  }
  function renderList() { const el = $("slist"); if (!el) return; el.innerHTML = listHtml(); wireList(); paint(); }

  function wireTransport() {
    const t = sel(); if (!t) return;
    $("splay").onclick = () => S.cur && S.cur.id === t.id ? stop() : (S.shuffle = false, play(t.id));
    document.querySelectorAll("#stp .lvl").forEach(b => b.onclick = () => S.cur && S.cur.id === t.id ? setState(b.dataset.lv) : (S.state = b.dataset.lv, renderTransport()));
    const retoggle = (k, label) => { S[k] = !S[k]; save(); renderTransport(); renderList(); if (S.cur && k !== "cresc") setState(S.state, { quick: true }); Lab.toast(`${label} ${S[k] ? "on" : "off"}`); };
    $("scuem").onclick = () => retoggle("cueM", "Cue mellow");
    $("scuei").onclick = () => retoggle("cueI", "Cue intense");
    $("scresc").onclick = () => retoggle("cresc", "Crescendo transition");
    document.querySelectorAll("#stransport [data-intense]").forEach(b => b.onclick = async () => {
      S.intense = b.dataset.intense; save();
      const playing = S.cur && S.cur.id, shuf = S.shuffle;
      render();
      if (playing) { await play(playing); S.shuffle = shuf; paint(); }  // (the playing song again, with the other intense file)
    });
    document.querySelectorAll("#sthumbs [data-v]").forEach(b => b.onclick = () => doVote(t, b.dataset.st, +b.dataset.v));
    document.querySelectorAll("#stp [data-sib]").forEach(b => b.onclick = () => b.dataset.sib !== t.id && (S.cur ? switchTo(b.dataset.sib) : load(b.dataset.sib)));
    if ($("smedley")) $("smedley").onclick = toggleMedley;
    $("snextg").onclick = () => { const g = guesses(t, S.state), [s, e] = cues(t, S.state); if (!g.length) return; const i = g.findIndex(c => c.bars[0] === s && c.bars[1] === e); setCue(t, S.state, g[(i + 1) % g.length].bars); };
    $("sreset").onclick = () => setCue(t, S.state, null);
    // the timeline: click a bar to jump there (Shift: a beat); drag a cue to a bar line
    const tl = $("stl"), hv = tl.querySelector(".hover");
    const at = e => { const r = tl.getBoundingClientRect(); return Lab.clamp((e.clientX - r.left) / r.width, 0, .9999) * N(); };
    const line = e => { const r = tl.getBoundingClientRect(); return Math.round(Lab.clamp((e.clientX - r.left) / r.width, 0, 1) * N()); };
    tl.onmousemove = e => {
      if (S.drag) return;
      const b = at(e), bi = Math.floor(b);
      hv.style.left = `${100 * bi / N()}%`; hv.style.width = `${100 / N()}%`;
      hv.firstElementChild.textContent = `bar ${bi + 1}`;
    };
    tl.onclick = e => { if (e.target.closest(".cueh") || S.dragged) { S.dragged = false; return; } seekBar(Math.floor(at(e))); };
    tl.querySelectorAll(".cueh").forEach(h => h.onpointerdown = e => {
      e.preventDefault(); e.stopPropagation();
      const which = h.dataset.h, [s0, e0] = cues(t, S.state);
      S.drag = { which, bars: [s0, e0] }; S.dragged = false;
      tl.classList.add("dragging"); h.setPointerCapture(e.pointerId);
      h.onpointermove = ev => {
        const k = line(ev), [s, en] = S.drag.bars;
        const next = which === "start" ? [Lab.clamp(k + 1, 1, en - 1), en] : [s, Lab.clamp(k, s + 1, N())];
        if (next[0] !== s || next[1] !== en) { S.drag.bars = next; S.dragged = true; placeCues(next); }
      };
      h.onpointerup = () => {
        h.onpointermove = h.onpointerup = null; tl.classList.remove("dragging");
        const b = S.drag.bars; S.drag = null;
        if (b[0] !== s0 || b[1] !== e0) setCue(t, S.state, b); else placeCues();
        setTimeout(() => { S.dragged = false; }, 0);
      };
    });
    placeCues();
  }
  function wireList() {
    document.querySelectorAll("#slist [data-group]").forEach(b => b.onclick = () => { S.group = b.dataset.group; save(); renderList(); });
    document.querySelectorAll("#slist [data-show]").forEach(b => b.onclick = () => { S.show = b.dataset.show; save(); renderList(); });
    $("sshuf").onclick = () => S.shuffle ? stop() : startShuffle();
    document.querySelectorAll(".song").forEach(r => {
      const id = r.dataset.id, t = track(id);
      r.onclick = e => { if (e.target.closest("button")) return; load(id); };
      r.querySelector("[data-play]").onclick = () => S.cur && S.cur.id === id ? stop() : (S.shuffle = false, play(id));
      r.querySelectorAll("[data-v]").forEach(b => b.onclick = () => doVote(t, b.dataset.st, +b.dataset.v));
    });
  }
  function toggleMedley() {
    const t = sel();
    if (!family(t).length) return;
    S.medley = !S.medley;
    if (S.medley) { S.shuffle = false; if (!S.cur) play(t.id); }
    renderTransport(); renderList();
    Lab.toast(S.medley ? `Medley: ${family(t).length} variations of ${t.family.key}, one loop each` : "Medley off");
  }
  function sibling(dir) {
    const t = sel(), f = family(t);
    if (f.length < 2) return;
    const x = f[(f.findIndex(m => m.id === t.id) + dir + f.length) % f.length];
    S.cur ? switchTo(x.id) : load(x.id);
  }
  function load(id) {  // a song into the transport (playing it, if something is playing)
    if (S.cur) { S.shuffle = false; play(id); return; }
    S.sel = id; Lab.setHash(id); renderTransport();
  }
  function paint() {
    if (Lab.tab !== "songs") return;
    const sb = $("sshuf"); if (sb) sb.classList.toggle("on", S.shuffle);
    const here = S.cur && S.cur.id === S.sel, p = $("splay");
    if (p) p.innerHTML = icon(here ? "stop" : "play");
    document.querySelectorAll("#stp .lvl").forEach(b => b.classList.toggle("on", b.dataset.lv === S.state));
    document.querySelectorAll(".song").forEach(r => {
      const playing = S.cur && S.cur.id === r.dataset.id;
      r.classList.toggle("on", !!playing);
      r.querySelector("[data-play]").innerHTML = icon(playing ? "stop" : "play");
      if (!playing) { r.querySelector(".prog div").style.width = "0"; r.querySelectorAll(".strip i.now").forEach(c => c.classList.remove("now")); }
    });
  }
  async function setCue(t, st, bars) {
    const top = (guesses(t, st)[0] || {}).bars;
    if (bars && !mine(t, st) && top && top[0] === bars[0] && top[1] === bars[1]) { placeCues(); return; }  // (already the guess)
    await Lab.vote({ cue: t.id, level: st, bars }, { label: bars ? `${name(t)} · ${st} loops bars ${bars[0]}–${bars[1]}` : `${name(t)} · ${st} back to my guess`, icon: "flag" });
    renderTransport(); renderList();
    if (S.cur && S.cur.id === t.id && S.cur.st === st && cued(st)) setState(st, { quick: true });  // (hear the new loop now)
  }
  async function doVote(t, st, v) {
    const now = vote(t, st) === v ? 0 : v;
    await Lab.vote({ clip: voteId(t, st), value: now }, { label: `${now === 1 ? "Liked" : now === -1 ? "Disliked" : "Vote cleared on"} ${name(t)} · ${st}`, icon: now === -1 ? "down" : now ? "up" : "x" });
    renderList();
    if (t.id === S.sel) { const th = $("sthumbs"); if (th) { th.innerHTML = thumbs(t, "mellow", true) + thumbs(t, "intense", true); th.querySelectorAll("[data-v]").forEach(b => b.onclick = () => doVote(t, b.dataset.st, +b.dataset.v)); } }
  }
  function move(dir) {
    const v = visible(); if (!v.length) return;
    const at = v.findIndex(t => t.id === S.sel), t = v[at < 0 ? (dir > 0 ? 0 : v.length - 1) : (at + dir + v.length) % v.length];
    load(t.id);
    const row = document.querySelector(`.song[data-id="${CSS.escape(t.id)}"]`); if (row) row.scrollIntoView({ block: "nearest" });
  }

  Lab.register("songs", {
    title: "Songs", icon: "note", show, refresh: () => { if (L()) render(); else show(); }, dock: false, hash: () => S.sel,
    enabled: () => Lab.project.features.music, leave: stop, count: () => L() ? L().tracks.length : "",
    keys: [["Space", "play or stop the song in the player"], ["↑ ↓", "previous / next song (plays it if one is playing)"], ["← →", "jump a bar back / forward"],
           ["1", "mellow"], ["2", "intense"], ["X", "switch mellow / intense"], ["C", "crescendo transition on / off"],
           ["[ ]", "previous / next variation (in step)"], ["F", "medley: play the variations as one piece"], ["U", "like the state shown"], ["D", "dislike the state shown"], ["Shift S", "shuffle the liked mellows"], ["Esc", "stop"]],
    onKey(e) {
      if (!L() || !L().tracks.length) return;
      const k = e.key, t = sel();
      if (k === " ") { e.preventDefault(); if (S.cur) stop(); else if (t) play(t.id); }
      else if (k === "ArrowDown" || k === "j") { e.preventDefault(); move(1); }
      else if (k === "ArrowUp" || k === "k") { e.preventDefault(); move(-1); }
      else if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); const b = S.cur ? Math.floor(pos(S.cur, Lab.actx.currentTime) / barS()) : 0; seekBar(b + (k === "ArrowRight" ? 1 : -1)); }
      else if (k === "1") S.cur ? setState("mellow") : (S.state = "mellow", renderTransport());
      else if (k === "2") S.cur ? setState("intense") : (S.state = "intense", renderTransport());
      else if (k === "x" || k === "X") { const st = S.state === "mellow" ? "intense" : "mellow"; S.cur ? setState(st) : (S.state = st, renderTransport()); }
      else if (k === "c" || k === "C") $("scresc") && $("scresc").click();
      else if (k === "[" || k === "]") sibling(k === "]" ? 1 : -1);
      else if (k === "f" || k === "F") toggleMedley();
      else if ((k === "u" || k === "U" || k === "d" || k === "D") && t) doVote(t, S.state, k.toLowerCase() === "d" ? -1 : 1);
      else if (k === "S") S.shuffle ? stop() : startShuffle();
      else if (k === "Escape") stop();
    },
  });
})();
