// Mixer (2026-10-21): build a set of 4-bar parts, cut from any of the game's shipped songs, that go together in any
// order, and hear it the way the game would play it: an endless random order (or the set's order), every part on the
// one 90 BPM grid, mellow or intense with the two-beat crossfade.
//
// What goes into what: a part x then a part y joins well when y's first bar is like the bar that really followed x in
// its own song, and x's last bar like the bar that really came before y (bar fingerprints from `soundlab music trims`:
// beat chroma and MFCC, cosine; a natural bar-to-bar step in this music scores ~0.78). For any order a pair must join
// both ways; "base" is how alike two parts' pitch classes are overall. Over the 98 shipped mellows, two random parts of
// different songs join both ways that well about 1% of the time, but sets of 10 parts from 10 songs do (MODELS_LOG,
// 2026-10-21): the page finds such starter sets, and ranks what fits everything already in a set.
//
// Playing a set is a walk of runs: a run enters a song at one of the set's parts and plays on in it as SA3 wrote it
// (looping between the song's mellow cues), for at least Stay bars; then, bar by bar, it looks for a part its last bar
// joins well, and goes there (through the glue when none turns up). Each 4-bar phrase may vary: a sibling at the same
// bars (the same piece in another context, in step), stems (`music stems`: drums out, sparse, the battle drums in), and
// at the loop point a fill SA3 wrote (`music fills`). Glue (`music glues`): a mellow pad per family, frozen from its own
// steadiest bar on the home chord: the way through when no part joins, a breath every few runs, or (the bed) quietly
// under everything. Chunks meet with an 80 ms equal-power crossfade straddling the bar line. The glue comes in only at
// the end of a phrase, the music fading into it over a bar, and it fades out over the next chunk's first bar (a two-beat
// handover mid-phrase was abrupt: the designer, 2026-10-21). Saved sets: data/mixes.json (the user's).
(() => {
  const { icon, esc } = Lab, $ = id => document.getElementById(id);
  const LEN = 4, XF = 0.04, STATES = ["mellow", "intense"], STEP = 0.785, OK = 0.7, PREF = "soundlab.mixer";
  const X = Object.assign({ set: [], name: "", mode: "any", intense: "battle", pick: "", glue: "weak", glueBars: 2, stay: 8,
                            vary: { siblings: true, stems: true, fills: true }, bed: "off", joins: "beat", match: true, scope: "set", strict: 0.8 },
    (() => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } })());
  Object.assign(X, { lib: null, mixes: {}, state: "mellow", plan: [], script: null, gen: 0, raf: 0, timer: 0, M: null, starters: null, recent: [], recentTracks: [], sinceGlue: 0, breath: 3, runs: 0, train: { on: false, cur: null, n: 0 } });
  const save = () => { try { localStorage.setItem(PREF, JSON.stringify({ set: X.set, name: X.name, mode: X.mode, intense: X.intense, pick: X.pick, glue: X.glue, glueBars: X.glueBars, stay: X.stay, vary: X.vary, bed: X.bed, joins: X.joins, match: X.match, scope: X.scope, strict: X.strict })); } catch { /* ignore */ } };
  const out = Lab.actx.createGain(), an = Lab.actx.createAnalyser();
  out.gain.value = 0.9; an.fftSize = 4096; an.smoothingTimeConstant = .8; out.connect(an); an.connect(Lab.master);
  const spec = new Float32Array(an.frequencyBinCount), wav = new Float32Array(1024);
  const bus = Object.fromEntries(STATES.map(st => { const g = Lab.actx.createGain(), m = Lab.actx.createAnalyser(); m.fftSize = 1024; g.gain.value = st === "mellow" ? 1 : 0; g.connect(m); m.connect(out); return [st, { g, m }]; }));
  const glueBus = Lab.actx.createGain(); glueBus.connect(out);  // (glue sounds in either state)
  const WEAK = 0.75;
  Lab.onFlush(() => { files.clear(); slices.clear(); pads.clear(); });

  const L = () => X.lib;
  const N = () => L().bars;
  const beatS = () => 60 / L().bpm, barS = () => beatS() * L().bar_beats;
  const track = id => L().tracks.find(t => t.id === id);
  const name = t => t.key ? `${t.key.replace(/~/g, " · ")} · ${t.take}` : t.id;
  const pkey = p => `${p.track}|${p.start}`;
  const plabel = p => { const t = track(p.track); return `${t ? name(t) : p.track} · bars ${p.start}–${p.start + LEN - 1}`; };
  const level = st => st === "mellow" ? "calm" : X.intense;
  const grade = v => v == null ? "" : v >= STEP ? "good" : v >= OK ? "fair" : "poor";

  // ---- what goes into what: every 4-bar part of every measured song, scored against every other (both ways)
  function matrix() {
    if (X.M) return X.M;
    const ts = L().tracks.filter(t => t.measure && t.measure.feat), n = N(), parts = [], idx = new Map();
    ts.forEach(t => { for (let s = 1; s + LEN - 1 <= n; s++) { idx.set(`${t.id}|${s}`, parts.length); parts.push({ track: t.id, start: s }); } });
    const P = parts.length, D = ts[0] ? ts[0].measure.feat[0].length : 0, at = (t, k) => track(t).measure.feat[((k % n) + n) % n];
    const first = [], last = [], next = [], prev = [], lf = [], ll = [], chroma = [];
    for (const p of parts) {
      const f = track(p.track).measure, s = p.start - 1;
      first.push(at(p.track, s)); last.push(at(p.track, s + LEN - 1)); next.push(at(p.track, s + LEN)); prev.push(at(p.track, s - 1));
      lf.push(f.loud.calm[s]); ll.push(f.loud.calm[s + LEN - 1]);
      const c = new Float64Array(12); for (let k = 0; k < LEN; k++) for (let i = 0; i < 12; i++) c[i] += f.feat[s + k][i];
      const nn = Math.hypot(...c) || 1; chroma.push(c.map(v => v / nn));
    }
    const dot = (a, b) => { let v = 0; for (let i = 0; i < D; i++) v += a[i] * b[i]; return v; };
    const J = new Float32Array(P * P);  // J[x * P + y]: x then y
    for (let x = 0; x < P; x++) for (let y = 0; y < P; y++)
      J[x * P + y] = 0.5 * (dot(next[x], first[y]) + dot(last[x], prev[y])) - 0.02 * Math.max(0, Math.abs(lf[y] - ll[x]) - 3);
    const base = (x, y) => { let v = 0; for (let i = 0; i < 12; i++) v += chroma[x][i] * chroma[y][i]; return v; };
    X.M = { parts, idx, P, J, base, j: (x, y) => J[x * P + y], both: (x, y) => Math.min(J[x * P + y], J[y * P + x]) };
    return X.M;
  }
  const ix = p => matrix().idx.get(pkey(p));
  const joinOf = (a, b) => { const M = matrix(), x = ix(a), y = ix(b); return x == null || y == null ? null : M.j(x, y); };
  const overlaps = (a, b) => a.track === b.track && Math.abs(a.start - b.start) < LEN;
  // Starter sets: from parts with many strong partners, add the part whose worst join (both ways) with the set is best,
  // while it stays at least `tau` with every member, with the same base, one part per song.
  function starters(tau = 0.75) {
    if (X.starters) return X.starters;
    const M = matrix(), P = M.P, song = M.parts.map(p => p.track), strength = [];
    for (let x = 0; x < P; x++) { let c = 0; for (let y = 0; y < P; y++) if (song[y] !== song[x] && M.both(x, y) >= tau) c++; strength.push(c); }
    const seeds = [...Array(P).keys()].sort((a, b) => strength[b] - strength[a]).slice(0, 120), sets = [], seen = new Set();
    for (const seed of seeds) {
      const S = [seed], songs = new Set([song[seed]]);
      for (;;) {
        let best = -1, bv = -9;
        for (let c = 0; c < P; c++) {
          if (songs.has(song[c])) continue;
          let w = 9; for (const m of S) { const v = Math.min(M.both(c, m), M.base(c, m) >= 0.9 ? 9 : -9); if (v < w) w = v; if (w < tau) break; }
          if (w >= tau && w > bv) { bv = w; best = c; }
        }
        if (best < 0) break;
        S.push(best); songs.add(song[best]);
      }
      const key = [...songs].sort().join(",");
      if (S.length >= 4 && !seen.has(key)) { seen.add(key); sets.push(S); }
    }
    const mean = S => { let v = 0, n = 0; for (const a of S) for (const b of S) if (a !== b) { v += M.j(a, b); n++; } return v / n; };
    X.starters = sets.map(S => ({ parts: S.map(i => M.parts[i]), mean: mean(S) })).sort((a, b) => b.parts.length - a.parts.length || b.mean - a.mean).slice(0, 8);
    return X.starters;
  }
  function suggestions() {  // what fits everything in the set: its worst join, both ways, with every member
    const M = matrix(), S = X.set.map(ix).filter(i => i != null);
    if (!S.length) return [];
    const out = [];
    for (let c = 0; c < M.P; c++) {
      const p = M.parts[c];
      if (X.set.some(m => overlaps(m, p))) continue;
      let w = 9, b = 9, weak = null;
      for (const m of S) { const v = M.both(c, m); if (v < w) { w = v; weak = m; } b = Math.min(b, M.base(c, m)); }
      out.push({ p, fit: w, base: b, weak: M.parts[weak] });
    }
    const bestOf = new Map();  // (each song's best part: its neighbours mostly fit alike)
    for (const o of out.filter(o => o.base >= 0.85).sort((a, b) => b.fit - a.fit)) if (!bestOf.has(o.p.track)) bestOf.set(o.p.track, o);
    return [...bestOf.values()].slice(0, 24);
  }

  // ---- audio: files decoded whole (levels, stems, fills, glues), sliced to what each chunk plays
  const files = new Map(), slices = new Map(), pads = new Map(), MAX_FILES = 10, MAX_SLICES = 120, FILLPAD = 0.05;
  const db = v => Math.pow(10, v / 20);
  function file(url) {
    if (files.has(url)) { const b = files.get(url); files.delete(url); files.set(url, b); return b; }
    const b = fetch(url).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.arrayBuffer(); }).then(x => Lab.actx.decodeAudioData(x));
    files.set(url, b); b.catch(() => files.delete(url));
    while (files.size > MAX_FILES) files.delete(files.keys().next().value);
    return b;
  }
  const ROLL = 0.7;  // (seconds of audio kept either side of a slice: a song change crosses over up to two beats around the bar line)
  function cut(b, start, bars) {  // bars start.. (1-based) of a loop, with ROLL either side, wrapping round it
    const sr = b.sampleRate, bar = Math.round(barS() * sr), xf = Math.round(ROLL * sr), total = b.length, a = (start - 1) * bar - xf, n = bars * bar + 2 * xf;
    const nb = Lab.actx.createBuffer(b.numberOfChannels, n, sr);
    for (let c = 0; c < b.numberOfChannels; c++) { const src = b.getChannelData(c), d = nb.getChannelData(c); for (let i = 0; i < n; i++) d[i] = src[(((a + i) % total) + total) % total]; }
    return nb;
  }
  function sliced(url, start, bars) {
    const k = `${url}|${start}|${bars}`;
    if (!slices.has(k)) { const p = file(url).then(b => cut(b, start, bars)); slices.set(k, p); p.catch(() => slices.delete(k)); while (slices.size > MAX_SLICES) slices.delete(slices.keys().next().value); }
    return slices.get(k);
  }
  // A glue as a bed: its middle four bars, the last 0.3 s faded into what comes before them, so it loops without a seam.
  function bedPad(gid) {
    if (!pads.has(gid)) pads.set(gid, file("/clips/" + L().glues[gid].file).then(b => {
      const sr = b.sampleRate, bar = Math.round(barS() * sr), a = Math.round(bar / 2), n = 4 * bar, x = Math.round(0.3 * sr);
      const nb = Lab.actx.createBuffer(b.numberOfChannels, n, sr);
      for (let c = 0; c < b.numberOfChannels; c++) { const src = b.getChannelData(c), d = nb.getChannelData(c);
        for (let i = 0; i < n; i++) d[i] = src[a + i];
        for (let i = 0; i < x; i++) { const f = (i + .5) / x; d[n - x + i] = d[n - x + i] * Math.cos(f * Math.PI / 2) + src[a - x + i] * Math.sin(f * Math.PI / 2); } }
      return nb;
    }));
    return pads.get(gid);
  }
  const glueOf = id => { const t = track(id); return t && t.glue && L().glues && L().glues[t.glue] ? t.glue : null; };
  const glueName = gid => { const t = track(gid); return t ? name(t) : gid; };  // (a family's key, or a song's own)
  const has = { stems: () => L().tracks.some(t => t.stems), fills: () => L().tracks.some(t => t.fills && Object.keys(t.fills).length) };
  async function prepare(c) {  // the buffers a chunk plays: {mellow: [{buf, gain, offset}], intense: [...]}, or a glue's
    if (c.kind === "glue") return { glue: await file("/clips/" + L().glues[c.glue].file) };
    const t = track(c.track), cl = u => "/clips/" + u, st = t.stems || {}, lv = l => (t.src && t.src[l]) || "/shipped/" + t.files[l];
    const bed = X.bed !== "off" && glueOf(c.track) ? bedPad(glueOf(c.track)) : null;
    const intense = sliced(lv(X.intense), c.kind === "fill" ? ((c.bar - 1 - c.bars + N()) % N()) + 1 : c.bar, c.bars);
    let mellow;
    if (c.kind === "fill") mellow = [{ buf: await file(cl(c.fill)), gain: 1, pre: FILLPAD }];
    else {
      const v = c.variant, parts = v === "nodrums" ? [[cl(st["calm.other"]), 1], [cl(st["calm.bass"]), 1]]
        : v === "sparse" ? [[cl(st["calm.other"]), 1], [cl(st["calm.bass"]), db(-6)]]
        : v === "pulse" ? [[lv("calm"), 1], [cl(st["battle.drums"]), db(-10)]]
        : [[lv("calm"), 1]];
      mellow = await Promise.all(parts.map(async ([u, g]) => ({ buf: await sliced(u, c.bar, c.bars), gain: g, pre: ROLL })));
    }
    if (bed) await bed;
    return { mellow, intense: [{ buf: await intense, gain: 1, pre: ROLL }] };
  }
  function curve(param, from, to, at, dur) {  // equal power, from one level to another
    const c = new Float32Array(32);
    for (let i = 0; i < 32; i++) { const k = i / 31; c[i] = from < to ? to * Math.sin(k * Math.PI / 2) + from * Math.cos(k * Math.PI / 2) : from * Math.cos(k * Math.PI / 2) + to * Math.sin(k * Math.PI / 2); }
    try { param.setValueCurveAtTime(c, at, dur); } catch { param.setValueAtTime(to, at + dur); }
  }
  function hold(p, t) { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); try { p.setValueAtTime(p.value, t); } catch { /* (inside a running curve) */ } } }
  // A straight line from v0 at t to v1 at t1. The start is pinned: a linear ramp runs from the param's previous event,
  // which after a cancel can be a fade that ended long before (a chunk faded across its whole length, 2026-10-21).
  function line(p, t, v0, v1, t1) { hold(p, t); try { p.setValueAtTime(v0, t); } catch { /* ignore */ } p.linearRampToValueAtTime(v1, t1); }
  function schedule(c, prev) {
    const now = Lab.actx.currentTime;
    c.nodes = [];
    if (c.kind === "glue") {  // it rises over the bar before T as the chunk before fades out over it (a slow handover)
      const lead = barS(), dur = c.bars * barS();
      // (the handover starts once the chunk before has finished fading in: a 1-bar chunk's fade-in sits right at T - lead,
      // and a fade over it throws; the catch made it a hard cut at the bar line: the designer heard it, 2026-10-21)
      const t0 = Math.max(now + 0.01, c.T - lead, prev && prev.T != null && !prev.skipped ? prev.T + XF + 0.01 : 0);
      if (prev && prev.nodes) for (const nd of prev.nodes) if (nd.gain && nd._level != null) { hold(nd.gain, t0); curve(nd.gain, nd._level, 0, t0, c.T - t0); }
      const s = Lab.actx.createBufferSource(), g = Lab.actx.createGain();
      s.buffer = c.bufs.glue; s.connect(g).connect(glueBus);
      g.gain.setValueAtTime(0, t0); curve(g.gain, 0, 1, t0, c.T - t0); curve(g.gain, 1, 0, c.T + dur, barS());  // (and falls over the next chunk's first bar)
      s.start(t0, Math.max(0, t0 - (c.T - lead))); s.stop(c.T + dur + barS() + 0.05);
      c.nodes.push(s, g);
      return;
    }
    const dur = c.bars * barS(), live = prev && !prev.skipped && prev.nodes && prev.kind !== "glue";
    const same = live && prev.run && prev.run === c.run, change = live && !same && prev.run;
    // a song change crosses over around the bar line (Joins: tight 80 ms, or one or two beats); within a run, 80 ms linear
    const w = same || !change ? XF : Math.min(X.joins === "two" ? beatS() : X.joins === "beat" ? beatS() / 2 : XF, prev.post || XF), t0 = c.T - w;
    if (same) for (const nd of prev.nodes) if (nd.gain && nd._level != null) line(nd.gain, t0, nd._level, 0, c.T + XF);
    if (change) for (const nd of prev.nodes) if (nd.gain && nd._level != null) { hold(nd.gain, t0); curve(nd.gain, nd._level, 0, t0, 2 * w); }
    const r = c.run;
    if (r && !r.gn) {  // a run's own gain: where it comes in, its level matched to the song it follows, easing to its own over 2 bars
      r.gn = {};
      for (const st of STATES) {
        const g = Lab.actx.createGain(), m = change && X.match ? matchGain(prev, c, st) : 1;
        g.connect(bus[st].g); g.gain.setValueAtTime(m, Math.max(now, t0)); g.gain.setValueAtTime(m, c.T); g.gain.linearRampToValueAtTime(1, c.T + 2 * barS());
        r.gn[st] = g; r.match = r.match || {}; r.match[st] = m;
      }
    }
    const lv = c.kind === "fill" ? fillLevels(c) : null;
    for (const st of STATES) for (const src of c.bufs[st]) {
      const s = Lab.actx.createBufferSource(), g = Lab.actx.createGain(), dest = r && r.gn ? r.gn[st] : bus[st].g;
      if (lv && st === "mellow") {  // (the fill's own leveling, beat by beat)
        const lev = Lab.actx.createGain(), at0 = Math.max(now, c.T - w);
        lev.gain.setValueAtTime(lv[0], at0);
        lv.forEach((v, k) => lev.gain.linearRampToValueAtTime(v, c.T + (k + 0.5) * beatS()));
        lev.gain.linearRampToValueAtTime(lv[lv.length - 1], c.T + dur + XF);
        lev.connect(dest); s.connect(g).connect(lev);
      } else s.connect(g).connect(dest);
      s.buffer = src.buf;
      const at = Math.max(now, t0);
      g.gain.setValueAtTime(0, at);
      if (same) g.gain.linearRampToValueAtTime(src.gain, c.T + XF); else curve(g.gain, 0, src.gain, at, 2 * w);
      curve(g.gain, src.gain, 0, c.T + dur - XF, 2 * XF);
      g._level = src.gain;
      s.start(at, Math.max(0, src.pre - w) + (at - t0)); s.stop(c.T + dur + (src.pre >= ROLL ? ROLL : XF) + 0.02);  // (late enough for a long crossover)
      c.nodes.push(s, g);
    }
    c.post = c.kind === "fill" ? FILLPAD : ROLL;
    if (c.first) bedTo(glueOf(c.track), c.T);
    if (c.first && !X.script && c.run) X.hist.push({ T: c.T, entry: c.run.entry });
  }
  // The bed: the playing song's glue, quietly under everything, crossing over two bars when the family changes.
  function fillLevels(c) {  // a gain per beat of a fill: 100% to the beats either side at its edges, 70% inside, within 6 dB
    const bt = (((track(c.track) || {}).measure || {}).beats || {}).calm, f = c.fillBeats;
    if (!bt || !f || !f.length) return null;
    const before = bt[((c.hi - 1) * 4 + 3) % bt.length], after = bt[((c.bar - 1) * 4) % bt.length];
    return f.map((v, k) => { const target = before + (after - before) * (k + 0.5) / f.length, edge = k === 0 || k === f.length - 1 ? 1 : 0.7;
      return db(Math.max(-6, Math.min(6, edge * (target - v)))); });
  }
  function matchGain(prev, c, st) {
    const lv = st === "mellow" ? "calm" : "battle", a = (((track(prev.track) || {}).measure || {}).beats || {})[lv], b = (((track(c.track) || {}).measure || {}).beats || {})[lv];
    if (!a || !b || prev.kind !== "part") return 1;
    const last = a[(((prev.bar + prev.bars - 1) - 1) * 4 + 3) % a.length], first = b[((c.bar - 1) * 4) % b.length];
    return db(Math.max(-6, Math.min(6, last - first)));
  }
  function bedTo(gid, at) {
    const level = X.bed === "low" ? db(-12) : db(-6), cur = X.bedVoice;
    if (X.bed === "off" || !gid) { if (cur) { fadeOut(cur, at, 2 * barS()); X.bedVoice = null; } return; }
    if (cur && cur.gid === gid) { if (cur.level !== level) { try { line(cur.g.gain, Math.max(at, Lab.actx.currentTime + 0.02), cur.g.gain.value, level, at + barS()); } catch { /* ignore */ } cur.level = level; } return; }
    bedPad(gid).then(b => {
      if (!X.playing) return;
      const s = Lab.actx.createBufferSource(), g = Lab.actx.createGain(), t0 = Math.max(Lab.actx.currentTime + 0.05, at);
      s.buffer = b; s.loop = true; s.connect(g).connect(glueBus);
      g.gain.setValueAtTime(0, t0); curve(g.gain, 0, level, t0, 2 * barS()); s.start(t0);
      if (X.bedVoice) fadeOut(X.bedVoice, t0, 2 * barS());
      X.bedVoice = { gid, s, g, level };
    });
  }
  function fadeOut(v, at, dur) {  // (the stop first: it must happen even if the fade can't be scheduled)
    try { v.s.stop(at + dur + 0.05); } catch { /* ignore */ }
    try { line(v.g.gain, at, v.level != null && at > Lab.actx.currentTime + 0.05 ? v.level : v.g.gain.value, 0, at + dur); } catch { /* ignore */ }
  }

  // ---- the walk: runs, each entering a song at a part of the set and playing on in it
  // A run plays its song on from the part (looping between the song's mellow cues), in 4-bar phrases; after Stay bars it
  // looks, bar by bar, for a part of the set its last bar joins well (>= WEAK, that exact bar into that part's start),
  // and goes there; with none in 8 more bars, it goes anyway (through the glue, unless the glue is off). A phrase may vary:
  // a sibling at the same bars (in step), stems (drums out, sparse, the battle drums in), a generated fill at the loop.
  const cueOf = tid => (((Lab.V.cues || {})[tid] || {}).mellow) || (((track(tid).measure || {}).cuts || {}).calm || [])[0]?.bars || [1, N()];
  const loopFor = (tid, entry) => { const [ms, me] = cueOf(tid); return [Math.min(ms, entry), Math.min(N(), Math.max(me, entry + LEN - 1))]; };
  function jBar(a, e, b, s) {  // song a's bar e, then song b from its bar s
    if (!((track(a) || {}).measure || {}).feat || !((track(b) || {}).measure || {}).feat) return -1;
    const n = N(), fa = track(a).measure.feat, fb = track(b).measure.feat, la = track(a).measure.loud.calm, lb = track(b).measure.loud.calm;
    const at = (f, k) => f[(((k - 1) % n) + n) % n], dot = (x, y) => { let v = 0; for (let i = 0; i < x.length; i++) v += x[i] * y[i]; return v; };
    const ba = (track(a).measure.beats || {}).calm, bb = (track(b).measure.beats || {}).calm;
    const loud = ba && bb ? 0.03 * Math.max(0, Math.abs(bb[((s - 1) * 4) % bb.length] - ba[((e - 1) * 4 + 3) % ba.length]) - 2) : 0.02 * Math.max(0, Math.abs(at(lb, s) - at(la, e)) - 3);
    return 0.5 * (dot(at(fa, e + 1), at(fb, s)) + dot(at(fa, e), at(fb, s - 1))) - loud;
  }
  // Taste: the designer's transition votes fit by `music joins --fit` (work/join_model.json): the chance they'd like song
  // a's bar e into part p. The same features as music.py join_features: keep the two the same. Without a model, the
  // join score stands in. The join score stays as a floor against plain clashes (CLASH).
  const CLASH = 0.6, med = xs => { const v = [...xs].sort((x, y) => x - y), n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; };
  let recs = null, recsAt = -1;
  function records() {  // each song's record in the transition votes (music.py song_record), recounted when the votes change
    const keys = Object.keys(Lab.V.clips).filter(k => k.startsWith("join_"));
    if (recs && recsAt === keys.length) return recs;
    const n = {};
    for (const k of keys) { const v = Lab.V.clips[k], a = k.slice(5, k.lastIndexOf("@")), b = k.slice(k.indexOf(">") + 1, k.lastIndexOf("|"));
      for (const t of new Set([a, b])) { (n[t] ||= [0, 0])[v > 0 ? 0 : 1]++; } }
    recs = {}; for (const [t, [g, b]] of Object.entries(n)) recs[t] = (g - b) / (g + b + 3);
    recsAt = keys.length; return recs;
  }
  function taste(a, e, p) {
    const M = L().join_model, A = (track(a) || {}).measure, B = (track(p.track) || {}).measure;
    if (!M || !A || !B || !A.beats || !A.onset || !B.onset || !B.phrase) return null;
    const ba = A.beats.calm, n = ba.length, ia = [0, 1, 2, 3].map(k => ((e - 1) * 4 + k) % n), s = p.start;
    const f = { level_a: ia.reduce((t, i) => t + ba[i], 0) / 4 - med(ba),
                entry_phrase: ((((s - B.phrase.start) % 4) + 4) % 4) === 0 ? 1 : 0,
                attack_b: Math.log(B.onset.attack[((s - 1) * 4) % B.onset.attack.length] / med(B.onset.busy)),
                held_a: Math.log(A.onset.busy[ia[3]] / (A.onset.attack[(e * 4) % A.onset.attack.length] + 1e-6)),
                rec_a: records()[a] || 0, rec_b: records()[p.track] || 0 };
    let z = M.w[0]; M.features.forEach((k, i) => { z += M.w[i + 1] * (f[k] - M.mu[i]) / M.sd[i]; });
    return 1 / (1 + Math.exp(-z));
  }
  function judge(a, e, p) {  // {p: the walk's chance (taste, else the join score), j: the join score, v: the user's vote}
    const j = jBar(a, e, p.track, p.start), t = taste(a, e, p), v = joinVote(a, e, p);
    return { p, j, t, v, ok: v > 0 || (v >= 0 && j >= CLASH && (t != null ? t >= 0.5 : j >= WEAK)), w: t != null ? t : j };
  }
  const joinKey = (a, e, p) => `join_${a}@${e}>${pkey(p)}`;  // (votes.json: the user's thumbs on a transition)
  const joinVote = (a, e, p) => Lab.V.clips[joinKey(a, e, p)] || 0;
  const family = tid => { const t = track(tid); return t && t.family ? t.family.members.filter(m => { const x = track(m); return m !== tid && x && x.measure && x.measure.feat && x.files.calm && x.files[X.intense]; }) : []; };
  function libEntries() {  // everything: each song's phrase starts inside its mellow cues
    const out = [];
    for (const t of L().tracks) {
      const m = t.measure || {};
      if (!m.feat || !t.files.calm || !t.files[X.intense] || (Lab.V.clips["song_" + t.id + ".mellow"] || 0) < 0) continue;
      const [lo, hi] = cueOf(t.id), ph = m.phrase, s0 = ph && ph.contrast >= 0.08 ? ph.start : lo, starts = [];
      for (let b = lo; b + LEN - 1 <= hi; b++) if ((((b - s0) % LEN) + LEN) % LEN === 0) starts.push(b);
      (starts.length ? starts : [lo]).forEach(b => out.push({ track: t.id, start: b }));
    }
    return out;
  }
  const pool = () => X.scope === "all" ? libEntries() : X.set;
  function pickEntry(fromTrack) {
    const P = pool();
    if (!P.length) return null;
    if (X.mode === "order" && X.scope !== "all") { const i = X.run0 ? P.findIndex(p => pkey(p) === pkey(X.run0)) : -1; return P[(i + 1) % P.length]; }
    const recent = X.scope === "all" ? [] : X.recent.slice(-(P.length >= 3 ? 2 : 1)), songs = X.scope === "all" ? X.recentTracks.slice(-6) : [];
    const ok = P.filter(p => p.track !== fromTrack && !recent.includes(pkey(p)) && !songs.includes(p.track));
    const from = ok.length ? ok : P;
    return from[Math.floor(Math.random() * from.length)];
  }
  function exits(r) {
    const e = r.lastBar, P = pool();
    if (X.scope === "all") {  // (the whole library: every entry scored, the walk choosing among the 8 best it may take)
      const songs = X.recentTracks.slice(-6);
      return P.filter(p => p.track !== r.track && !songs.includes(p.track)).map(p => judge(r.track, e, p))
        .filter(x => x.ok).sort((a, b) => (b.v > 0) - (a.v > 0) || b.w - a.w).slice(0, 8);
    }
    const recent = X.recent.slice(-(P.length >= 3 ? 2 : 1));
    const want = X.mode === "order" ? [pickEntry(r.track)] : P.filter(p => p.track !== r.track && !recent.includes(pkey(p)));
    return want.filter(Boolean).map(p => judge(r.track, e, p)).filter(x => x.ok);  // (a liked transition always; a disliked one never)
  }
  const weighted = xs => { const w = xs.map(x => (x.v > 0 ? 3 : 1) * Math.max(0.05, x.w || 1)), t = w.reduce((a, b) => a + b, 0); let r = Math.random() * t; for (let i = 0; i < xs.length; i++) if ((r -= w[i]) < 0) return xs[i]; return xs[xs.length - 1]; };
  function phraseEnd(r) {  // is the run's last bar the end of a phrase?
    const ph = ((track(r.track) || {}).measure || {}).phrase;
    if (ph && ph.contrast >= 0.08) return (((r.lastBar - ph.start) % LEN) + LEN) % LEN === LEN - 1;
    return r.played % LEN === 0;
  }
  function startRun(p) {
    const [lo, hi] = loopFor(p.track, p.start);
    X.run = { id: ++X.runs, track: p.track, entry: p, bar: p.start, lo, hi, played: 0, passes: 0, lastBar: p.start - 1, variant: "full", lastFill: null, first: true };
    X.recent.push(pkey(p)); X.recentTracks.push(p.track); X.run0 = p; X.sinceGlue++;
  }
  function planNext() {
    if (X.script) return X.script.shift() || null;
    if (!X.run) { const p = X.pendingEntry || pickEntry(null); X.pendingEntry = null; if (!p) return null; startRun(p); }
    const r = X.run;
    if (r.played >= X.stay && !r.afterFill) {
      // A straight exit can be at any bar that joins well; the glue only at the end of a phrase (4 bars from the run's
      // entry), so it never cuts a phrase off. A breath that's due waits for one; with no exit in 8 bars past Stay, the
      // run goes at the next phrase end anyway.
      const gid = glueOf(r.track), glueOn = gid && X.glue !== "off" && (Lab.V.clips["glue_" + gid] || 0) >= 0, atPhrase = phraseEnd(r);
      const breath = glueOn && X.glue === "breaths" && X.sinceGlue >= X.breath, forced = r.played >= X.stay + 8 || !pool().some(p => p.track !== r.track);
      // (the taste bar: by the designer's own votes, they liked 89% of what the model put at 80% or more and about 60%
      // between 50 and 80; so the walk waits for one over the bar, and only once forced takes what passes 50%)
      const all = breath || !atPhrase ? [] : exits(r), over = all.filter(x => x.v > 0 || x.w >= X.strict);
      const ex = over.length ? over : forced ? all : [];
      if (pool().length && (ex.length || ((breath || forced) && atPhrase))) {
        const pick = ex.length ? weighted(ex) : { p: pickEntry(r.track), j: null };
        if (pick.p) {  // (nowhere to go: the song plays on)
          X.run = null;
          if (glueOn && !ex.length) {
            X.pendingEntry = pick.p; X.sinceGlue = 0; X.breath = 2 + Math.floor(Math.random() * 3);
            return { kind: "glue", glue: gid, bars: X.glueBars, track: r.track };
          }
          startRun(pick.p);
          return planNext();
        }
      }
    }
    if (r.bar > r.hi) {  // round the loop: a generated fill, when there is one for this cue
      r.bar = r.lo; r.passes++;
      const swing = f => f.beats && f.beats.length ? Math.max(...f.beats) - Math.min(...f.beats) : 0;  // (over 10 dB inside: a fill no leveling saves)
      const [ms, me] = cueOf(r.track), fl = X.vary.fills ? ((track(r.track).fills || {})[`${ms}-${me}`] || []).filter(f => (Lab.V.clips["fill_" + f.file] || 0) >= 0 && swing(f) <= 10) : [];
      if (fl.length && r.lo === ms && r.hi === me) {
        const pool = fl.filter(f => f.file !== r.lastFill), f = (pool.length ? pool : fl)[Math.floor(Math.random() * (pool.length || fl.length))];
        r.lastFill = f.file; r.afterFill = true;
        return { kind: "fill", track: r.track, bar: r.lo, bars: f.bars, fill: f.file, fillBeats: f.beats, hi: r.hi, run: r, entry: r.entry };
      }
    }
    if (r.played >= LEN && r.played % LEN === 0) {  // a new phrase: perhaps a variation
      const sib = family(r.track);
      if (X.vary.siblings && sib.length && Math.random() < 0.3) { r.track = sib[Math.floor(Math.random() * sib.length)]; r.swapped = true; }
      const st = track(r.track).stems || {}, ok = ["nodrums", "sparse", "pulse"].filter(v => v !== r.variant && (v === "pulse" ? st["battle.drums"] : st["calm.other"] && st["calm.bass"]));
      r.variant = X.vary.stems && ok.length && Math.random() < 0.45 ? ok[Math.floor(Math.random() * ok.length)] : "full";
    }
    const len = r.played < X.stay ? Math.min(LEN - (r.played % LEN), X.stay - r.played, r.hi - r.bar + 1) : 1;
    r.afterFill = false;
    const c = { kind: "part", track: r.track, bar: r.bar, bars: len, variant: r.variant, run: r, entry: r.entry, first: r.first };
    r.first = false; r.bar += len; r.played += len; r.lastBar = c.bar + len - 1;
    return c;
  }
  function pump() {
    if (!X.playing) return;
    const now = Lab.actx.currentTime;
    if (!X.plan.length) {
      if (X.starting) return;
      const c = planNext(), g = X.gen;
      if (!c) { if (X.script) stop(); return; }
      X.starting = true;
      prepare(c).then(b => {
        X.starting = false;
        if (g !== X.gen) return;
        c.bufs = b; c.T = Lab.actx.currentTime + 0.12 + (c.kind === "glue" ? barS() : 0); c.end = c.T + c.bars * barS();
        X.plan.push(c); pump();
      }).catch(() => { X.starting = false; });
      return;
    }
    let last = X.plan[X.plan.length - 1];
    while ((last ? last.end : now) - now < 6) {
      const c = planNext();
      if (!c) break;
      c.T = last ? last.end : now + 0.25 + (c.kind === "glue" ? barS() : 0);
      c.end = c.T + c.bars * barS();
      prepare(c).then(b => { c.bufs = b; }).catch(() => { c.failed = true; });
      X.plan.push(c); last = c;
    }
    for (let i = 0; i < X.plan.length; i++) {
      const c = X.plan[i];
      if (c.scheduled) continue;
      if (c.T - now > 3) break;
      if (!c.bufs) { if (c.failed || c.T - now < 0.05) { c.scheduled = c.skipped = true; continue; } break; }
      schedule(c, X.plan[i - 1]); c.scheduled = true;
    }
    X.plan = X.plan.filter(c => c.end > now - 30);
    if (X.script && !X.script.length && X.plan.every(c => c.end < now)) stop();
  }
  async function play(script = null, from = null) {  // (from: a part to enter first, keeping the history: back, replay)
    ++X.gen;
    if (Lab.actx.state === "suspended") await Lab.actx.resume();
    Lab.stop(); halt();
    if (!script && !pool().length) { Lab.toast("Add some parts first"); return; }
    Object.assign(X, { script: script ? [...script] : null, plan: [], run: null, pendingEntry: from, runs: 0, recent: from ? X.recent : [], recentTracks: from ? X.recentTracks : [], run0: null,
                       sinceGlue: 0, breath: 3, playing: true, starting: false, hist: from ? X.hist : [] });
    pump();
    clearInterval(X.timer); X.timer = setInterval(pump, 200);  // (keeps going in a background tab)
    cancelAnimationFrame(X.raf); tick(); paint();
  }
  function halt() {
    const now = Lab.actx.currentTime;
    for (const c of X.plan || []) for (const nd of c.nodes || []) { if (nd.stop) { try { nd.stop(now + 0.06); } catch { /* ignore */ } } else { try { line(nd.gain, now, nd.gain.value, 0, now + 0.05); } catch { /* ignore */ } } }
    if (X.bedVoice) { fadeOut(X.bedVoice, now, 0.1); X.bedVoice = null; }
    X.plan = []; X.playing = false; clearInterval(X.timer);
  }
  function back() {
    if (!X.playing || X.script) return;
    const now = Lab.actx.currentTime, past = X.hist.filter(h => h.T <= now), cur = past[past.length - 1];
    if (!cur) return;
    const to = now - cur.T > 3 || past.length < 2 ? cur : past[past.length - 2];
    X.hist = X.hist.filter(h => h.T < to.T);  // (what comes after it is played again)
    play(null, to.entry);
    Lab.toast(`Back to ${plabel(to.entry)}`, { icon: "undo" });
  }
  function skip() {
    if (!X.playing || X.script) return;
    const c = nowChunk(Lab.actx.currentTime), p = pickEntry(c ? c.track : null);
    if (p) play(null, p);
  }
  function stop() { X.gen++; halt(); X.script = null; cancelAnimationFrame(X.raf); X.raf = 0; paint(); idle(); }
  function setState(st) {  // the two-beat crossfade between the buses
    X.state = st;
    const now = Lab.actx.currentTime + 0.02, dur = 2 * beatS();
    for (const s of STATES) { const p = bus[s].g.gain, from = p.value, to = s === st ? 1 : 0;
      hold(p, now);
      const c = new Float32Array(32); for (let i = 0; i < 32; i++) { const k = i / 31; c[i] = Math.sqrt(from * from * (1 - k) + to * to * k); }
      try { p.setValueCurveAtTime(c, now, dur); } catch { p.setValueAtTime(to, now); } }
    paint();
  }
  const part = (p, from = 0, bars = LEN) => ({ kind: "part", track: p.track, bar: p.start + from, bars, variant: "full", entry: p, first: true, run: { entry: p, track: p.track } });  // (a run of its own: auditions join as the walk does)
  const viaGlue = (a, b) => X.glue === "breaths" || (X.glue === "weak" && joinOf(a, b) < WEAK);
  const playJoin = (a, b, glue = viaGlue(a, b)) => play([part(a, LEN - 2, 2), ...(glue && glueOf(a.track) ? [{ kind: "glue", glue: glueOf(a.track), bars: X.glueBars, track: a.track }] : []), part(b)]);
  const playPart = p => play([part(p)]);
  // Training: one transition at a time (2 bars of A, then 3 of B, with the Joins and Match settings), rated with one key,
  // the next one straight after. Most near the walk's line (0.70-0.82: where a vote teaches the most), some scoring
  // high (to catch bad joins slipping through), a few under it; never one you've rated.
  function trainPair() {
    const E = libEntries(), byTrack = {};
    E.forEach(p => (byTrack[p.track] ||= []).push(p));
    const tracks = Object.keys(byTrack), r = Math.random(), model = !!L().join_model;
    const want = model ? (r < 0.6 ? [0.4, 0.6] : r < 0.85 ? [0.7, 1.01] : [0.2, 0.4]) : (r < 0.6 ? [0.70, 0.82] : r < 0.85 ? [0.82, 1.5] : [0.60, 0.70]);
    let best = null;
    for (let i = 0; i < 800; i++) {
      const a = tracks[Math.floor(Math.random() * tracks.length)], ea = byTrack[a][Math.floor(Math.random() * byTrack[a].length)], e = ea.start + LEN - 1;
      const b = E[Math.floor(Math.random() * E.length)];
      if (b.track === a || joinVote(a, e, b)) continue;
      const x = judge(a, e, b);
      if (x.j < CLASH) continue;
      const pair = { a, e, b, j: x.j, t: x.t, w: x.w };
      if (x.w >= want[0] && x.w < want[1]) return pair;
      if (!best || Math.abs(x.w - want[0]) < Math.abs(best.w - want[0])) best = pair;
    }
    return best;
  }
  function trainPlay() { const c = X.train.cur; if (c) play([part({ track: c.a, start: c.e - 1 }, 0, 2), part(c.b, 0, 3)]); }
  function trainNext() { X.train.cur = trainPair(); trainPlay(); paintTrain(); }
  async function trainVote(v) {
    const c = X.train.cur; if (!c) return;
    await Lab.vote({ clip: joinKey(c.a, c.e, c.b), value: v }, null);
    X.train.n++; X.train.last = { ...c, v };
    if (c.t != null && (c.t >= 0.5) === (v > 0)) X.train.agree++;
    trainNext();
  }
  function trainToggle() { X.train.on = !X.train.on; if (X.train.on) { X.train.n = 0; X.train.agree = 0; X.train.last = null; trainNext(); } else stop(); render(); }
  function trainHtml() {
    if (!X.train.on) return "";
    const c = X.train.cur, all = Object.keys(Lab.V.clips).filter(k => k.startsWith("join_")).length, l = X.train.last;
    const M = L().join_model;
    return `<section class="card train" id="xtrain"><div class="lbl">Rating transitions <span class="dim">· ${X.train.n} this session · ${all} in all${M ? ` · the model (fit on ${M.n}) is right ${Math.round(100 * M.right)}% on votes it didn't see: run <code>soundlab music joins --fit</code> to refit` : " · no model yet: <code>soundlab music joins --fit</code>"}</span></div>
      ${c ? `<div class="tpair"><b>${esc(name(track(c.a)))}</b><small>bar ${c.e}</small><span class="arrow">${icon("arrow")}</span><b>${esc(name(track(c.b.track)))}</b><small>bar ${c.b.start}</small>
        <span class="dim" data-tip="Rated blind: the model's guess shows after you vote, so it can't sway you (training plays mostly the ones it's least sure of)">guess hidden</span></div>` : `<div class="dim">No transition left to rate.</div>`}
      <div class="row"><button class="btn good" id="tgood">${icon("up")}Good <kbd>↑</kbd></button><button class="btn bad" id="tbad">${icon("down")}Bad <kbd>↓</kbd></button>
        <button class="btn" id="tskip">${icon("next")}Skip <kbd>→</kbd></button><button class="btn ghost" id="treplay">${icon("refresh")}Replay <kbd>R</kbd></button>
        <button class="btn ghost" id="tstop">${icon("x")}Done</button></div>
      ${l ? `<div class="dim">last: ${esc(name(track(l.a)))} → ${esc(name(track(l.b.track)))} · you said <b>${l.v > 0 ? "good" : "bad"}</b>${l.t != null
          ? ` · the model guessed ${Math.round(100 * l.t)}%: ${(l.t >= 0.5) === (l.v > 0) ? "agreed" : "<b>disagreed</b>"}` : ""} · join score ${l.j.toFixed(2)}</div>` : ""}
      ${X.train.n ? `<div class="dim">this session the model agreed with you ${X.train.agree} of ${X.train.n} times</div>` : ""}</section>`;
  }
  function paintTrain() { const el = $("xtrainbox"); if (el) { el.innerHTML = trainHtml(); wireTrain(); } }
  function wireTrain() {
    if (!$("xtrain")) return;
    if ($("tgood")) $("tgood").onclick = () => trainVote(1);
    if ($("tbad")) $("tbad").onclick = () => trainVote(-1);
    $("tskip").onclick = trainNext; $("treplay").onclick = trainPlay; $("tstop").onclick = trainToggle;
  }
  const playGlue = gid => play([{ kind: "glue", glue: gid, bars: X.glueBars }]);

  // ---- the page
  const VARIANT = { full: "", nodrums: "drums out", sparse: "sparse", pulse: "+ pulse" };
  const nowChunk = now => (X.plan || []).find(c => c.scheduled && !c.skipped && c.T - XF <= now && now < c.end) || null;
  function chunkLabel(c) {
    if (c.kind === "glue") return `glue · ${glueName(c.glue)}`;
    const t = track(c.track), tags = [c.kind === "fill" ? "fill" : VARIANT[c.variant], c.run && c.run.entry && c.track !== c.run.entry.track ? "variation" : ""].filter(Boolean);
    return `${t ? name(t) : c.track} · bar ${c.bar}${c.bars > 1 ? `–${c.bar + c.bars - 1}` : ""}${tags.length ? ` · ${tags.join(", ")}` : ""}`;
  }
  function blocks(list) {  // the lane: a block per run and song (its phrases folded), glue and fills their own
    const out = [];
    for (const c of list) {
      const b = out[out.length - 1], same = b && c.kind === "part" && b.kind === "part" && b.run === c.run && b.track === c.track;
      if (same) { b.bars += c.bars; b.end = c.end; b.last = c.bar + c.bars - 1; b.chunks.push(c); if (c.variant !== "full") b.vars.add(c.variant); }
      else out.push({ kind: c.kind, run: c.run, track: c.track, bar: c.bar, bars: c.bars, last: c.bar + c.bars - 1, T: c.T, end: c.end, glue: c.glue, chunks: [c], vars: new Set(c.variant && c.variant !== "full" ? [c.variant] : []) });
    }
    return out;
  }
  function tick() {
    if (!X.playing) return;
    const now = Lab.actx.currentTime, cur = nowChunk(now), clock = $("xclock");
    if (cur) {
      const t = now - cur.T, k = Math.floor(t / barS()), beat = Math.floor(t / beatS()) % L().bar_beats;
      if (clock) clock.innerHTML = cur.kind === "glue" ? `glue<small> ${k + 1}/${cur.bars}</small>` : cur.kind === "fill" ? `fill<small> ${beat + 1}</small>` : `${cur.bar + k}.${beat + 1}<small>/ ${N()}</small>`;
      document.querySelectorAll("#xbeats i").forEach((el, i) => el.classList.toggle("on", i === beat));
      const nowEl = $("xnow"), nextEl = $("xnext"), lab = chunkLabel(cur);
      if (nowEl && nowEl.textContent !== lab) { nowEl.textContent = lab; paintSet(); }
      const nx = X.plan.find(c => c.T >= cur.end - 0.01 && (c.kind !== "part" || c.run !== cur.run || c.track !== cur.track));
      if (nextEl) nextEl.textContent = nx ? chunkLabel(nx) : X.script ? "(the end)" : "…";
      const lane = $("xlane");
      if (lane) {
        const bl = blocks(X.plan.filter(c => !c.skipped)), i = bl.findIndex(b => b.chunks.includes(cur)), show = bl.slice(Math.max(0, i - 3), i + 4);
        const sig = show.map(b => `${b.kind}${b.T.toFixed(2)}${b.bars}${[...b.vars]}`).join() + X.set.length;
        if (lane.dataset.sig !== sig) {
          lane.dataset.sig = sig;
          lane.innerHTML = show.map((b, j) => {
            const nb = show[j + 1], jd = b.kind === "part" && nb && nb.kind === "part" && nb.run !== b.run && nb.run && nb.run.entry ? judge(b.track, b.last, { track: nb.track, start: nb.bar }) : null, into = jd ? jd.w : null;
            const lab = b.kind === "glue" ? "glue" : b.kind === "fill" ? "fill" : `${name(track(b.track))} · ${b.bars} bar${b.bars > 1 ? "s" : ""}${b.vars.size ? ` · ${[...b.vars].map(v => VARIANT[v]).join(", ")}` : ""}${b.run && b.run.entry && b.track !== b.run.entry.track ? " · variation" : ""}`;
            const entry = b.run && b.run.entry, inSet = entry && X.set.some(p => pkey(p) === pkey(entry)), fill = b.kind === "fill" ? b.chunks[0].fill : null;
            const acts = b.kind === "glue" ? `<button data-noglue="${esc(b.glue)}" data-tip="Never play this glue again (${esc(glueName(b.glue))})">${icon("down")}</button>`
              : b.kind === "fill" ? `<button data-nofill="${esc(fill)}" data-tip="Never play this fill again">${icon("down")}</button>`
              : `${entry ? `<button data-replay="${esc(pkey(entry))}" data-tip="Play this run again from its part, with the settings as they are now">${icon("refresh")}</button>` : ""}${inSet ? `<button data-rm="${esc(pkey(entry))}" data-tip="Take its part (${esc(plabel(entry))}) out of the set">${icon("x")}</button>` : ""}`;
            const jk = into != null && nb.run && nb.run.entry ? joinKey(b.track, b.last, nb.run.entry) : null, jv = jk ? Lab.V.clips[jk] || 0 : 0;
            const badge = into == null ? "" : `<em class="join ${jd.t != null ? (jd.t >= 0.5 ? "good" : "poor") : grade(into)} ${jv > 0 ? "liked" : jv < 0 ? "disliked" : ""}" data-tip="${jd.t != null ? `The model's guess that you'd like it: ${Math.round(100 * jd.t)}% · join score ${jd.j.toFixed(2)}` : `join score ${jd.j.toFixed(2)}`}">${jd.t != null ? Math.round(100 * jd.t) + "%" : into.toFixed(2)}${jk ? `<button data-join="${esc(jk)}" data-v="1" data-tip="Good transition: take it more often">${icon("up")}</button><button data-join="${esc(jk)}" data-v="-1" data-tip="Bad transition: never take it again">${icon("down")}</button>` : ""}</em>`;
            return `<span class="blk ${b.kind !== "part" ? b.kind : ""}" data-t="${b.T}" data-e="${b.end}">${esc(lab)}<span class="bacts">${acts}</span>${badge}</span>`;
          }).join("");
        }
        lane.querySelectorAll(".blk").forEach(el => { el.classList.toggle("on", +el.dataset.t <= now && now < +el.dataset.e); el.classList.toggle("past", +el.dataset.e <= now); });
      }
      const pc = cur.run && cur.run.entry ? document.querySelector(`.pcard[data-k="${CSS.escape(pkey(cur.run.entry))}"] .prog div`) : null;
      document.querySelectorAll(".pcard .prog div").forEach(d => { if (d !== pc) d.style.width = "0"; });
      if (pc) pc.style.width = `${Math.min(100, 100 * cur.run.played / Math.max(X.stay, cur.run.played))}%`;
    }
    for (const st of STATES) {
      const card = document.querySelector(`#xtp .lvl[data-lv="${st}"]`); if (!card) continue;
      bus[st].m.getFloatTimeDomainData(wav); let s = 0; for (let i = 0; i < wav.length; i++) s += wav[i] * wav[i];
      card.querySelector(".vu div").style.width = `${Math.round(100 * Lab.clamp((10 * Math.log10(s / wav.length + 1e-12) + 54) / 48, 0, 1))}%`;
      card.querySelector(".mix div").style.width = `${Math.round(100 * bus[st].g.gain.value)}%`;
    }
    Lab.drawSpectrum($("xspec"), an, spec, true);
    X.raf = requestAnimationFrame(tick);
  }
  function idle() {
    Lab.drawSpectrum($("xspec"), an, spec, false);
    const c = $("xclock"); if (c) c.innerHTML = `1.1<small>/ ${N()}</small>`;
    document.querySelectorAll("#xbeats i").forEach(i => i.classList.remove("on"));
    document.querySelectorAll(".pcard .prog div").forEach(d => d.style.width = "0");
    document.querySelectorAll("#xtp .lvl .vu div, #xtp .lvl .mix div").forEach(d => d.style.width = "0");
    const n = $("xnow"); if (n) n.textContent = "–"; const x = $("xnext"); if (x) x.textContent = "–";
    const lane = $("xlane"); if (lane) { lane.innerHTML = ""; lane.dataset.sig = ""; }
    paintSet();
  }

  async function show() {
    if (!X.playing) {  // (each visit: stems, fills and glues made since show up)
      try {
        const [a, b] = await Promise.all([fetch("/api/songs"), fetch("/api/mixes")]);
        if (!a.ok) throw new Error(a.status);
        const lib = await a.json();
        if (!X.lib || X.lib.tracks.length !== lib.tracks.length) { X.M = null; X.starters = null; }
        X.lib = lib; X.mixes = b.ok ? await b.json() : {};
      } catch { if (!L()) { Lab.showEmpty("note", "Couldn't read the game's music", `<p>The server didn't give the shipped tracks. Check the terminal running <code>soundlab serve</code>.</p>`); return; } }
    }
    if (!L().tracks.some(t => t.measure && t.measure.feat)) { Lab.showEmpty("note", "The songs aren't measured", `<p>Run <code>soundlab music trims</code>: the mixer needs each song's bar fingerprints.</p>`); return; }
    X.set = X.set.filter(p => track(p.track) && ix(p) != null);
    render();
  }
  function setHtml() {
    const M = matrix(), n = X.set.length;
    if (!n) return `<div class="empty small"><b>No parts yet</b><p>Start from one of the sets below, or add parts from a song.</p></div>`;
    const weakest = p => Math.min(...X.set.filter(o => o !== p).map(o => Math.min(joinOf(p, o), joinOf(o, p))));
    const cards = X.set.map((p, i) => {
      const t = track(p.track), loud = t.measure.loud.calm, lo = Math.min(...loud), hi = Math.max(...loud), w = n > 1 ? weakest(p) : null;
      return `<div class="pcard" data-k="${esc(pkey(p))}" data-i="${i}">
        <span class="num">${i + 1}</span>
        <div class="pn"><b>${esc(name(t))}</b><small>bars ${p.start}–${p.start + LEN - 1}${w != null ? ` · weakest join <span class="${grade(w)}">${w.toFixed(2)}</span>` : ""}</small></div>
        <span class="strip mini">${loud.map((v, k) => `<i class="${k + 1 >= p.start && k + 1 < p.start + LEN ? "in" : "back"}" style="height:${(22 + 78 * (v - lo) / Math.max(1e-6, hi - lo)).toFixed(0)}%"></i>`).join("")}</span>
        <span class="acts"><button class="tb" data-solo data-tip="Hear this part alone">${icon("play")}</button>
          <button class="tb" data-up data-tip="Earlier in the order" ${i ? "" : "disabled"}>${icon("left")}</button>
          <button class="tb" data-down data-tip="Later in the order" ${i < n - 1 ? "" : "disabled"}>${icon("right")}</button>
          <button class="tb" data-del data-tip="Take it out of the set">${icon("x")}</button></span>
        <div class="prog"><div></div></div></div>`;
    }).join("");
    const grid = n > 1 ? `<div class="jgrid" style="grid-template-columns: 28px repeat(${n}, 34px)"><span class="h corner" data-tip="Row then column">→</span>
        ${X.set.map((_, j) => `<span class="h">${j + 1}</span>`).join("")}
        ${X.set.map((a, i) => `<span class="h">${i + 1}</span>${X.set.map((b, j) => i === j ? `<span class="c self">·</span>`
          : (() => { const v = joinOf(a, b), jv = joinVote(a.track, a.start + LEN - 1, b); return `<button class="c ${grade(v)} ${jv > 0 ? "liked" : jv < 0 ? "disliked" : ""}" data-ja="${i}" data-jb="${j}" data-tip="${esc(plabel(a))} → ${esc(plabel(b))}: ${v.toFixed(2)} · click: hear it as the player would${X.glue !== "off" ? " (through the glue where it would come in)" : ""} · Shift-click: ${viaGlue(a, b) ? "straight" : "through the glue"}">${Math.round(100 * v)}</button>`; })()).join("")}`).join("")}</div>` : "";
    const gl = [...new Set(X.set.map(p => glueOf(p.track)).filter(Boolean))];
    const glues = gl.length ? `<div class="glues"><span class="lbl">Glues</span>${gl.map(g => `<button class="chip glue" data-glue="${esc(g)}" data-tip="Hear ${esc(glueName(g))}'s glue alone: ${X.glueBars} bar${X.glueBars > 1 ? "s" : ""}, frozen from ${esc(L().glues[g].source.track)} bar ${L().glues[g].source.bar}">${icon("play")}${esc(glueName(g))}</button>`).join("")}</div>`
      : `<div class="glues dim">No glues yet: run <code>soundlab music glues</code>.</div>`;
    return `<div class="setwrap"><div class="pcards">${cards}${glues}</div>${grid ? `<div class="jbox"><div class="lbl">What goes into what <span class="dim">(row, then column · green: as smooth as a natural bar step)</span></div>${grid}</div>` : ""}</div>`;
  }
  function suggHtml() {
    if (!X.set.length) {
      const st = starters();
      return `<h3>Start from a set that already goes together</h3><div class="starters">${st.map((s, i) => `<button class="starter" data-starter="${i}">
          <b>${s.parts.length} parts · ${s.parts.length} songs</b><small>joins ${s.mean.toFixed(2)} on average, every pair both ways ≥ 0.75</small>
          <span>${esc([...new Set(s.parts.map(p => (track(p.track).key || "").split("~")[1] || "plain"))].join(", "))}</span></button>`).join("")}</div>`;
    }
    const sg = suggestions();
    return `<h3>Fits everything in the set <span class="dim">· its worst join, both ways, with any part already in</span></h3>
      <div class="sugg">${sg.map((o, i) => `<div class="srow" data-sg="${i}"><span class="fit ${grade(o.fit)}">${o.fit.toFixed(2)}</span>
        <div class="pn"><b>${esc(name(track(o.p.track)))}</b><small>bars ${o.p.start}–${o.p.start + LEN - 1} · weakest with ${esc(plabel(o.weak))}</small></div>
        <button class="tb" data-sgplay data-tip="Hear it alone">${icon("play")}</button>
        <button class="tb" data-sgjoin data-tip="Hear the part it joins worst with, then it">${icon("arrow")}</button>
        <button class="btn" data-sgadd>${icon("plus")}Add</button></div>`).join("")}</div>`;
  }
  function browseHtml() {
    const ts = [...L().tracks].filter(t => t.measure && t.measure.feat).sort((a, b) => name(a).localeCompare(name(b))), t = track(X.pick);
    const parts = t ? Array.from({ length: N() - LEN + 1 }, (_, k) => ({ track: t.id, start: k + 1 })) : [];
    const fit = p => X.set.length ? Math.min(...X.set.filter(m => !overlaps(m, p)).map(m => Math.min(joinOf(p, m), joinOf(m, p)))) : null;
    return `<h3>Parts of any song</h3>
      <div class="browse"><select id="xpick"><option value="">Choose a song…</option>${ts.map(o => `<option value="${esc(o.id)}" ${o.id === X.pick ? "selected" : ""}>${esc(name(o))}</option>`).join("")}</select>
        ${parts.map(p => { const f = fit(p), inSet = X.set.some(m => pkey(m) === pkey(p)); return `<span class="bpart ${inSet ? "on" : ""}" data-bp="${p.start}">
          <button class="tb" data-bplay data-tip="Hear bars ${p.start}–${p.start + LEN - 1}">${icon("play")}</button><b>${p.start}–${p.start + LEN - 1}</b>
          ${f != null && isFinite(f) ? `<span class="${grade(f)}">${f.toFixed(2)}</span>` : ""}<button class="tb" data-badd ${inSet ? "disabled" : ""} data-tip="Add to the set">${icon("plus")}</button></span>`; }).join("")}</div>`;
  }
  function render() {
    const nm = Object.keys(X.mixes).sort();
    const page = document.querySelector(".page.mixer"), y = page ? page.scrollTop : 0;
    Lab.view().innerHTML = `<div class="page mixer"><div class="wrap">
      <div class="page-head"><div><div class="eyebrow">${L().bpm} BPM · ${LEN}-bar parts · every song on one grid</div><h1>Mixer</h1>
        <p class="lede">Build a set of parts, cut from any songs, that go together in any order, and hear it as the game would play it: endlessly, in a random order,
          mellow or intense. Each song comes in at its part and plays on for at least Stay bars, varying as it goes, then moves on where it joins well.
          The grid shows how well each part flows into each other one; the list under it ranks what fits everything already in.</p></div></div>
      <section class="card transport" id="xtp">
        <div class="ttop">
          <button class="iconbtn tbtn" id="xback" data-tip="Back: the start of this run, or the one before (←)">${icon("prev")}</button>
          <button class="playbtn" id="xplay" data-tip="Play the set (Space)">${icon(X.playing ? "stop" : "play")}</button>
          <button class="iconbtn tbtn" id="xskip" data-tip="Skip to a new run (→)">${icon("next")}</button>
          <div class="clock"><div class="big" id="xclock">1.1<small>/ ${LEN}</small></div><div class="beats" id="xbeats">${"<i></i>".repeat(L().bar_beats)}</div></div>
          <div class="readouts"><div><span class="lbl">Now</span><b class="small" id="xnow">–</b></div><div><span class="lbl">Next</span><b class="small" id="xnext">–</b></div></div>
          <canvas class="spectrum" id="xspec"></canvas>
        </div>
        <div class="lane" id="xlane"></div>
        <div class="levels">${STATES.map((st, i) => `<button class="lvl ${X.state === st ? "on" : ""}" data-lv="${st}"><span class="t"><b>${st}</b><kbd>${i + 1}</kbd></span>
          <small>${esc(level(st))} level of every part</small><div class="vu"><div></div></div><div class="mix"><div></div></div></button>`).join("")}</div>
      </section>
      <div class="mtake">
        <div class="field"><label>Draw from</label>${Lab.seg([["set", "the set", false, "The parts of the set below"], ["all", "everything", false, "Every song in the library, entering at its phrase starts inside its mellow cues (mellows you thumbed down left out): to map the whole graph"]], X.scope, "scope")}</div>
        <div class="field"><label>Order</label>${Lab.seg([["any", "any order", false, "A random part each time, never the one just heard: as the game would"], ["order", "in order", false, "The set's order, round and round"]], X.mode, "mode")}</div>
        <div class="field"><label>Training</label><button class="btn ${X.train.on ? "on" : ""}" id="xtrainbtn" data-tip="Rate transitions one after another, with one key each: the ones a vote teaches the most (T)">${icon("up")}<span>Train transitions</span></button></div>
        <div class="field"><label>Stay</label>${Lab.seg([4, 8, 12, 16].map(n => [String(n), `${n} bars`, false, n === 4 ? "Just the part, as before" : `Each song plays on from its part for at least ${n} bars, then leaves at the first bar that joins a part well`]), String(X.stay), "stay")}</div>
        <div class="field"><label>Variation</label><div class="row">
          ${vtoggle("siblings", "Siblings", "A phrase may go on in a sibling: the same piece made for another context, in step bar for bar", true)}
          ${vtoggle("stems", "Stems", "A phrase may drop the drums, thin to the melody and harmony, or bring the battle drums in quietly (music stems)", has.stems())}
          ${vtoggle("fills", "Fills", "Round the loop, a fill SA3 wrote for that song's loop point (music fills)", has.fills())}</div></div>
        <div class="field"><label>Taste bar</label>${Lab.seg([0.5, 0.7, 0.8, 0.9].map(v => [String(v), `${Math.round(100 * v)}%`, false,
          v === 0.8 ? "The walk waits for a transition the model puts at 80% or more (you liked 89% of those), and settles for 50% only when it must" : v === 0.5 ? "Anything the model puts at 50% or more (you liked about 60% of those)" : `Wait for ${Math.round(100 * v)}% or more; settle for 50% only when it must`]), String(X.strict), "strict")}</div>
        <div class="field"><label>Joins</label><div class="row">${Lab.seg([["tight", "tight", false, "A song change is an 80 ms crossfade at the bar line"], ["beat", "1 beat", false, "The two songs overlap for a beat around the bar line"], ["two", "2 beats", false, "The two songs overlap for two beats around the bar line"]], X.joins, "joins")}
          <button class="btn ${X.match ? "on" : ""}" id="xmatch" data-tip="The song coming in starts at the level of the one going out (its first beat against the other's last, within 6 dB), then eases to its own over 2 bars">${icon(X.match ? "check" : "x")}<span>Match levels</span></button></div></div>
        <div class="field"><label>Bed</label>${Lab.seg([["off", "off"], ["low", "low", false, "The playing song's glue under everything, 12 dB down"], ["mid", "mid", false, "The playing song's glue under everything, 6 dB down"]], X.bed, "bed")}</div>
        <div class="field"><label>Glue</label><div class="row">${Lab.seg([["off", "off", false, "Runs straight into each other, even where nothing joins well"], ["weak", "weak joins", false, `Through the glue where no part joins well (${WEAK}) within 8 bars of Stay`], ["breaths", "breaths", false, "That, and a breath of glue every 2 to 4 runs"]], X.glue, "gmode")}
          ${Lab.seg([1, 2, 4].map(n => [String(n), `${n} bar${n > 1 ? "s" : ""}`]), String(X.glueBars), "gbars")}</div></div>
        <div class="field"><label>Intense is</label>${Lab.seg([["battle", "battle"], ["action", "action"]], X.intense, "xint")}</div>
        <div class="field grow"><label>Set</label><div class="row"><input id="xname" placeholder="Name this set" value="${esc(X.name)}">
          <button class="btn" id="xsave" ${X.set.length ? "" : "disabled"}>${icon("save")}Save</button><button class="btn ghost" id="xclear" ${X.set.length ? "" : "disabled"}>${icon("x")}Clear</button></div></div>
        ${nm.length ? `<div class="field"><label>Saved</label><div class="row">${nm.map(k => `<span class="chip mixc ${k === X.name ? "on" : ""}"><button data-load="${esc(k)}">${esc(k)} · ${X.mixes[k].parts.length}</button><button data-delmix="${esc(k)}" data-tip="Delete this saved set">${icon("x")}</button></span>`).join("")}</div></div>` : ""}
      </div>
      <div id="xtrainbox">${trainHtml()}</div>
      <h3>The set · ${X.set.length} part${X.set.length === 1 ? "" : "s"}${X.scope === "all" ? ` <span class="dim">· not used while drawing from everything</span>` : ""}</h3>
      <div id="xset">${setHtml()}</div>
      <div id="xsugg">${suggHtml()}</div>
      <div id="xbrowse">${browseHtml()}</div>
    </div></div>`;
    document.querySelector(".page.mixer").scrollTop = y;
    wire(); paint();
    if (X.playing) { cancelAnimationFrame(X.raf); tick(); } else idle();
  }
  function paintSet() {
    const c = X.playing ? nowChunk(Lab.actx.currentTime) : null, k = c && c.run ? c.run.entry : null;
    document.querySelectorAll(".pcard").forEach(el => el.classList.toggle("on", !!(k && el.dataset.k === pkey(k))));
  }
  function paint() {
    if (Lab.tab !== "mixer") return;
    const p = $("xplay"); if (p) p.innerHTML = icon(X.playing ? "stop" : "play");
    document.querySelectorAll("#xtp .lvl").forEach(b => b.classList.toggle("on", b.dataset.lv === X.state));
    paintSet();
  }
  function changed() { save(); render(); }
  function paintGrid() {  // (a vote from the lane: the grid's cells show it)
    document.querySelectorAll(".jgrid .c[data-ja]").forEach(el => { const a = X.set[+el.dataset.ja], b = X.set[+el.dataset.jb]; if (!a || !b) return; const jv = joinVote(a.track, a.start + LEN - 1, b);
      el.classList.toggle("liked", jv > 0); el.classList.toggle("disliked", jv < 0); });
  }
  const vtoggle = (k, label, tip, on) => `<button class="btn ${X.vary[k] && on ? "on" : ""}" data-vary="${k}" ${on ? "" : "disabled"} data-tip="${esc(on ? tip : tip + ": none made yet")}">${icon(X.vary[k] && on ? "check" : "x")}<span>${label}</span></button>`;
  function add(p) { if (X.set.some(m => pkey(m) === pkey(p))) return; X.set.push({ track: p.track, start: p.start }); changed(); Lab.toast(`Added ${plabel(p)}`, { icon: "plus" }); }
  function wire() {
    const v = Lab.view();
    $("xplay").onclick = () => X.playing ? stop() : play();
    $("xback").onclick = back; $("xskip").onclick = skip;
    $("xlane").onclick = async e => {  // (the lane's pieces: it re-renders as it plays, so one handler for all of them)
      const b = e.target.closest("button"); if (!b) return;
      const find = k => X.set.find(p => pkey(p) === k) || (k && { track: k.split("|")[0], start: +k.split("|")[1] });
      if (b.dataset.replay) play(null, find(b.dataset.replay));
      else if (b.dataset.join) { const k = b.dataset.join, v = +b.dataset.v, now = (Lab.V.clips[k] || 0) === v ? 0 : v;
        await Lab.vote({ clip: k, value: now }, { label: now > 0 ? "Liked that transition: it'll come up more" : now < 0 ? "Disliked that transition: it won't be taken again" : "Vote cleared on that transition", icon: now < 0 ? "down" : now ? "up" : "x" });
        const lane = $("xlane"); if (lane) lane.dataset.sig = ""; paintGrid(); }
      else if (b.dataset.rm) { const p = find(b.dataset.rm); X.set = X.set.filter(m => pkey(m) !== b.dataset.rm); changed(); Lab.toast(`Took ${plabel(p)} out of the set`, { icon: "x" }); }
      else if (b.dataset.nofill) await Lab.vote({ clip: "fill_" + b.dataset.nofill, value: -1 }, { label: "Disliked that fill: it won't play again", icon: "down" });
      else if (b.dataset.noglue) await Lab.vote({ clip: "glue_" + b.dataset.noglue, value: -1 }, { label: `Disliked ${glueName(b.dataset.noglue)}'s glue: it won't play again`, icon: "down" });
    };
    v.querySelectorAll("#xtp .lvl").forEach(b => b.onclick = () => setState(b.dataset.lv));
    v.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { X.mode = b.dataset.mode; save(); render(); });
    v.querySelectorAll("[data-scope]").forEach(b => b.onclick = () => { X.scope = b.dataset.scope; save(); render(); });
    $("xtrainbtn").onclick = trainToggle; wireTrain();
    v.querySelectorAll("[data-xint]").forEach(b => b.onclick = () => { X.intense = b.dataset.xint; save(); const was = X.playing && !X.script; if (X.playing) stop(); render(); if (was) play(); });
    $("xname").oninput = e => { X.name = e.target.value; save(); };
    $("xsave").onclick = async () => {
      const nm = (X.name || "").trim();
      if (!nm) { Lab.toast("Name the set first"); $("xname").focus(); return; }
      const r = await Lab.post("/api/mixes", { name: nm, parts: X.set.map(p => ({ track: p.track, start: p.start, bars: LEN })) });
      if (!r.ok) { Lab.toast(`Couldn't save: ${((await r.json().catch(() => null)) || {}).error || r.status}`, { icon: "x" }); return; }
      X.mixes = await r.json(); render(); Lab.toast(`Saved “${nm}”`, { icon: "save" });
    };
    $("xclear").onclick = () => { X.set = []; X.name = ""; if (X.playing) stop(); changed(); };
    v.querySelectorAll("[data-load]").forEach(b => b.onclick = () => { const m = X.mixes[b.dataset.load]; X.set = m.parts.map(p => ({ track: p.track, start: p.start })).filter(p => track(p.track)); X.name = b.dataset.load; changed(); });
    v.querySelectorAll("[data-delmix]").forEach(b => b.onclick = async () => {
      if (!confirm(`Delete the saved set “${b.dataset.delmix}”?`)) return;
      const r = await Lab.post("/api/mixes", { name: b.dataset.delmix, parts: null });
      if (r.ok) { X.mixes = await r.json(); render(); }
    });
    v.querySelectorAll(".pcard").forEach(c => {
      const i = +c.dataset.i, p = X.set[i];
      c.querySelector("[data-solo]").onclick = () => playPart(p);
      c.querySelector("[data-up]").onclick = () => { X.set.splice(i - 1, 0, X.set.splice(i, 1)[0]); changed(); };
      c.querySelector("[data-down]").onclick = () => { X.set.splice(i + 1, 0, X.set.splice(i, 1)[0]); changed(); };
      c.querySelector("[data-del]").onclick = () => { X.set.splice(i, 1); changed(); };
    });
    v.querySelectorAll("[data-ja]").forEach(b => b.onclick = e => { const a = X.set[+b.dataset.ja], c = X.set[+b.dataset.jb]; playJoin(a, c, e.shiftKey ? !viaGlue(a, c) : viaGlue(a, c)); });
    v.querySelectorAll("[data-glue]").forEach(b => b.onclick = () => playGlue(b.dataset.glue));
    v.querySelectorAll("[data-gmode]").forEach(b => b.onclick = () => { X.glue = b.dataset.gmode; save(); render(); });
    v.querySelectorAll("[data-stay]").forEach(b => b.onclick = () => { X.stay = +b.dataset.stay; save(); render(); });
    v.querySelectorAll("[data-joins]").forEach(b => b.onclick = () => { X.joins = b.dataset.joins; save(); render(); });
    v.querySelectorAll("[data-strict]").forEach(b => b.onclick = () => { X.strict = +b.dataset.strict; save(); render(); });
    $("xmatch").onclick = () => { X.match = !X.match; save(); render(); };
    v.querySelectorAll("[data-vary]").forEach(b => b.onclick = () => { X.vary[b.dataset.vary] = !X.vary[b.dataset.vary]; save(); render(); });
    v.querySelectorAll("[data-bed]").forEach(b => b.onclick = () => { X.bed = b.dataset.bed; save(); render(); if (X.playing && !X.script) { const c = nowChunk(Lab.actx.currentTime); bedTo(c ? glueOf(c.track) : null, Lab.actx.currentTime + 0.1); } });
    v.querySelectorAll("[data-gbars]").forEach(b => b.onclick = () => { X.glueBars = +b.dataset.gbars; save(); render(); });
    v.querySelectorAll("[data-starter]").forEach(b => b.onclick = () => { X.set = starters()[+b.dataset.starter].parts.map(p => ({ ...p })); X.name = ""; changed(); });
    const sg = X.set.length ? suggestions() : [];
    v.querySelectorAll("[data-sg]").forEach(r => {
      const o = sg[+r.dataset.sg];
      r.querySelector("[data-sgplay]").onclick = () => playPart(o.p);
      r.querySelector("[data-sgjoin]").onclick = () => playJoin(o.weak, o.p);
      r.querySelector("[data-sgadd]").onclick = () => add(o.p);
    });
    $("xpick").onchange = e => { X.pick = e.target.value; save(); $("xbrowse").innerHTML = browseHtml(); wire(); };
    v.querySelectorAll("[data-bp]").forEach(s => {
      const p = { track: X.pick, start: +s.dataset.bp };
      s.querySelector("[data-bplay]").onclick = () => playPart(p);
      s.querySelector("[data-badd]").onclick = () => add(p);
    });
  }

  Lab.ICONS.prev = '<path fill="currentColor" stroke="none" d="M18 6.6v10.8a.9.9 0 0 1-1.4.75L9 12.75a.9.9 0 0 1 0-1.5l7.6-5.4A.9.9 0 0 1 18 6.6z"/><path d="M6.5 6v12"/>';
  Lab.ICONS.next = '<path fill="currentColor" stroke="none" d="M6 6.6v10.8a.9.9 0 0 0 1.4.75L15 12.75a.9.9 0 0 0 0-1.5L7.4 5.85A.9.9 0 0 0 6 6.6z"/><path d="M17.5 6v12"/>';
  Lab.ICONS.parts = '<rect x="3.5" y="4" width="7.5" height="7" rx="1.5"/><rect x="13" y="4" width="7.5" height="7" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="7" rx="1.5"/><rect x="13" y="13" width="7.5" height="7" rx="1.5"/>';
  Lab.register("mixer", {
    title: "Mixer", icon: "parts", show, refresh: () => { if (L()) render(); else show(); }, dock: false,
    enabled: () => Lab.project.features.music, leave: stop, debug: () => X, probe: (a, e, p) => taste(a, e, p),
    keys: [["T", "train: rate transitions (↑ good, ↓ bad, → skip, R replay)"], ["Space", "play or stop the set"], ["←", "back: this run's start, or the one before"], ["→", "skip to a new run"], ["1", "mellow"], ["2", "intense"], ["X", "switch mellow / intense"], ["O", "any order / in order"], ["Esc", "stop"]],
    onKey(e) {
      if (!L()) return;
      const k = e.key;
      if (X.train.on) {  // (rating: one key each)
        if (k === "ArrowUp" || k === "u" || k === "U") { e.preventDefault(); trainVote(1); return; }
        if (k === "ArrowDown" || k === "d" || k === "D") { e.preventDefault(); trainVote(-1); return; }
        if (k === "ArrowRight" || k === "n" || k === "N") { e.preventDefault(); trainNext(); return; }
        if (k === "r" || k === "R" || k === " ") { e.preventDefault(); trainPlay(); return; }
        if (k === "Escape" || k === "t" || k === "T") { trainToggle(); return; }
      }
      if (k === "t" || k === "T") { trainToggle(); return; }
      if (k === " ") { e.preventDefault(); X.playing ? stop() : play(); }
      else if (k === "1") setState("mellow");
      else if (k === "2") setState("intense");
      else if (k === "x" || k === "X") setState(X.state === "mellow" ? "intense" : "mellow");
      else if (k === "o" || k === "O") { X.mode = X.mode === "any" ? "order" : "any"; save(); render(); }
      else if (k === "ArrowLeft") { e.preventDefault(); back(); }
      else if (k === "ArrowRight") { e.preventDefault(); skip(); }
      else if (k === "Escape") stop();
    },
  });
})();
