// Music: a set's levels playing in sync on the audio clock (as the game's synchronized stream does), with live
// intensity crossfades and bar-quantised switches between takes, profiles and sets. The timeline seeks by bar.
(() => {
  const FADES = { cut: ["cut", 0], beat: ["1 beat", 1], bar: ["1 bar", 4], two: ["2 bars", 8] };  // in beats
  const PROFILE_INFO = { close: "levels keep the spine's chords; gentler contrast", contrast: "clearer contrast; chords drift more" };
  const profTip = (take, p) => {  // (what a profile is: its note, and the take's audio-to-audio strengths)
    const i = (take.profiles[p] || {}).info || {}, st = Object.entries(i).filter(([, x]) => x.noise != null).map(([lv, x]) => `${lv} ${x.noise}`);
    const lay = Object.entries(i).filter(([, x]) => x.layers).map(([lv, x]) => `${lv}: ${Object.entries(x.layers).map(([n, g]) => `${n} ${g > 0 ? "+" : ""}${g} dB`).join(", ")}`);
    return [PROFILE_INFO[p], st.length ? `strength from the spine: ${st.join(", ")}` : "", lay.length ? `layers: ${lay.join("; ")}` : ""].filter(Boolean).join(" · ");
  };
  const M = { older: false, key: null, take: 0, prof: null, level: null, stack: false, fade: "bar", quant: false, enter: "start",
              deck: null, prev: null, swapAt: 0, pendingAt: 0, raf: 0, gen: 0 };  // (gen: bumped by every start, switch and stop; a stale load gives up)
  const { icon, esc } = Lab, $ = id => document.getElementById(id);
  const bufs = new Map(), shapes = new Map(), MAX_BUFS = 18;  // (a 42 s level decodes to about 16 MB)
  const out = Lab.actx.createGain(), an = Lab.actx.createAnalyser();
  out.gain.value = 0.9; an.fftSize = 4096; an.smoothingTimeConstant = .8;
  out.connect(an); an.connect(Lab.master);
  const spec = new Float32Array(an.frequencyBinCount), wav = new Float32Array(1024);

  const mesh = () => Lab.S.mesh;
  const beatS = () => 60 / mesh().bpm, barS = () => beatS() * mesh().bar_beats, loopS = () => barS() * mesh().bars;
  const set = (k = M.key) => mesh().contexts[k];
  const keys = () => Object.keys(mesh().contexts).sort((a, b) => a.localeCompare(b));
  // A set keeps the takes of every run, newest batch first. Only the set's newest batch is out; its earlier takes (voted
  // on or not) fold under "Earlier takes". A take made before takes carried their round belongs to the set's round.
  const isCurrent = (t, k = M.key) => (t.round ?? set(k).round ?? "") === (set(k).round ?? "");
  const current = (k = M.key) => set(k).takes.filter(t => isCurrent(t, k));
  const voteId = (k = M.key, t = set().takes[M.take].id, p = M.prof) => `mesh_${k}.${t}.${p}`;
  // music candidates: each new take scored before it's heard (plays nice with the shipped songs, catchiness)
  const score = (k, id) => ((Lab.C || {}).takes || {})[`${k}.${id}`];
  const bestIn = k => current(k).map(t => score(k, t.id)).filter(Boolean).reduce((b, x) => !b || x.rank < b.rank ? x : b, null);
  function buf(rel) {
    if (bufs.has(rel)) { const b = bufs.get(rel); bufs.delete(rel); bufs.set(rel, b); return b; }
    const b = fetch("/clips/" + rel).then(r => { if (!r.ok) throw new Error(`${r.status} ${rel}`); return r.arrayBuffer(); }).then(x => Lab.actx.decodeAudioData(x));
    bufs.set(rel, b); b.catch(() => bufs.delete(rel));
    while (bufs.size > MAX_BUFS) bufs.delete(bufs.keys().next().value);
    return b;
  }
  Lab.onFlush(() => { bufs.clear(); shapes.clear(); M.shape = null; M.shapeFor = null; });
  const gainFor = lv => M.stack ? 0.6 : (lv === M.level ? 1 : 0);
  const files = () => set().takes[M.take].profiles[M.prof].levels;
  const posOf = d => (((Lab.actx.currentTime - d.t0) % loopS()) + loopS()) % loopS();
  // What ships from a set, as `music promote` decides it: its liked takes, or (none liked) every take not thumbed
  // down, at the project's default profile (else "contrast", else the first). A style's set (key "<set>~<style>")
  // ships only liked takes, and a plain set ships nothing unliked once any style of its context and biome is liked.
  function profile0(k) {
    const t = set(k).takes[0], ps = t ? Object.keys(t.profiles) : [], d = Lab.project.default_profile;
    return ps.includes(d) ? d : ps.includes("contrast") ? "contrast" : ps[0];
  }
  // Rounds: each `music generate` run. Only the newest round's sets show; the rest fold under "Earlier rounds"
  // (liked sets first, then each round, newest first; opened when the set playing is one of them).
  const roundOf = k => set(k).round || "";
  const newest = () => { const r = mesh().rounds || []; return r.length ? r[r.length - 1].id : keys().reduce((m, k) => roundOf(k) > m ? roundOf(k) : m, ""); };
  function roundLabel(r, title = "Round") {  // "Round · bed · anthem · full", then its time, muted
    if (!r) return "The first score";
    const x = (mesh().rounds || []).find(o => o.id === r), when = new Date(r.replace(" ", "T"));
    const time = isNaN(when) ? r : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return `${title}${x && x.styles && x.styles.length ? ` · ${x.styles.map(esc).join(" · ")}` : ""}<span class="when">${esc(time)}</span>`;
  }
  // What's new to you: what was added since you last opened a set (remembered in this browser). A set never opened
  // is "new"; one opened before that has gained takes or profiles since (e.g. layered mixes added to old takes) has
  // "new mixes", and those profiles are tagged "new". New is blue; green (a thumb on a take) means liked. Opening a set marks all of it seen. The first time,
  // everything older than the newest round counts as seen, except profiles other than the default and contrast.
  let seen = null, SEEN = null;
  function seenSet() {
    if (seen) return seen;
    SEEN = `soundlab.music.seen.${Lab.project.name}`;  // (Lab.project is loaded after this file runs)
    const got = localStorage.getItem(SEEN);
    seen = new Set(got ? JSON.parse(got) : keys().filter(k => roundOf(k) !== newest()).flatMap(k => set(k).takes.flatMap(t =>
      Object.keys(t.profiles).filter(p => p === Lab.project.default_profile || p === "contrast").map(p => `${k}|${t.id}|${p}`))));
    if (!got) localStorage.setItem(SEEN, JSON.stringify([...seen]));
    return seen;
  }
  function markSetSeen(k) {
    const ids = set(k).takes.flatMap(t => Object.keys(t.profiles).map(p => `${k}|${t.id}|${p}`)).filter(id => !seenSet().has(id));
    if (!ids.length) return;
    ids.forEach(id => seen.add(id)); localStorage.setItem(SEEN, JSON.stringify([...seen]));
  }
  const isNew = (k, t, p) => !seenSet().has(`${k}|${t}|${p}`);
  const takeNew = (k, t) => Object.keys(t.profiles).some(p => isNew(k, t.id, p));
  const setNew = k => current(k).filter(t => takeNew(k, t)).length;
  const NEW = `<span class="newb">new</span>`, MIXES = `<span class="newb mixes" data-tip="New mixes of takes you've heard">+ mixes</span>`;
  const setAllNew = k => current(k).every(t => Object.keys(t.profiles).every(p => isNew(k, t.id, p)));  // (never opened)

  function setChip(k) {
    const sc = mesh().contexts[k], n = ships(k).liked, fresh = setNew(k);
    return `<button class="setc ${k === M.key ? "on" : ""}" data-key="${esc(k)}">
        <b>${esc(k.replace(/[.~]/g, " · "))}${!fresh ? "" : setAllNew(k) ? NEW : MIXES}${bestIn(k) ? `<span class="rankb" data-tip="Its best take's place in the scores (music candidates)">#${bestIn(k).rank}</span>` : ""}</b><small><span>${esc(sc.mode)}</span><span>${current(k).length} take${current(k).length === 1 ? "" : "s"}${sc.takes.length > current(k).length ? ` · ${sc.takes.length - current(k).length} earlier` : ""}</span>${n ? `<span class="liked">${n} liked</span>` : ""}</small></button>`;
  }
  // Only the newest round is out; everything older is folded away: what you liked first, then each round.
  function setList() {
    const rank = k => (bestIn(k) || { rank: 1e9 }).rank;
    const top = keys().filter(k => roundOf(k) === newest()).sort((a, b) => rank(a) - rank(b)), old = keys().filter(k => roundOf(k) !== newest());
    const liked = old.filter(k => likedIn(k).length), rest = old.filter(k => !likedIn(k).length);
    const group = (title, ks, cls = "") => ks.length ? `<div class="round ${cls}"><div class="roundh">${title}</div>
        <div class="sets">${ks.map(setChip).join("")}</div></div>` : "";
    const rounds = [...new Set(rest.map(roundOf))].sort().reverse(), oldNew = old.filter(setNew).length;
    return (top.length ? bestStrip(top) + group(roundLabel(newest(), "Newest round"), top, "now")
        : newest() ? `<div class="round now"><div class="roundh">${roundLabel(newest(), "Newest round")}</div><p class="lede">No take passed in this round: every seed was rejected. The sets below are from earlier rounds.</p></div>` : "")
      + (old.includes(M.key) ? group("The set playing, from an earlier round", [M.key]) : "")  // (so what's loaded is in view while the list is folded)
      + (old.length ? `<div class="sets"><button class="setc older ${M.older ? "on" : ""}" id="molder" data-tip="Everything from earlier rounds">
          <b>${icon("right")}Earlier rounds</b><small><span>${old.length} set${old.length === 1 ? "" : "s"}</span>${liked.length ? `<span class="liked">${liked.length} liked</span>` : ""}${oldNew ? `<span>${oldNew} with new mixes</span>` : ""}</small></button></div>
      ${M.older ? `<div class="olderbox">${group("Liked", liked) + rounds.map(r => group(roundLabel(r), rest.filter(k => roundOf(k) === r))).join("")}</div>` : ""}` : "");
  }
  // The newest round's takes in score order, across sets: where to start listening (N: the next, B: back).
  const bestOrder = () => keys().filter(k => roundOf(k) === newest()).flatMap(k => current(k).map(t => [k, t, score(k, t.id)]))
    .filter(x => x[2]).sort((a, b) => a[2].rank - b[2].rank);
  function stepBest(d) {
    const all = bestOrder();
    if (!all.length) return;
    const at = all.findIndex(([k, t]) => k === M.key && set().takes[M.take] === t);
    const [k, t] = all[at < 0 ? (d > 0 ? 0 : all.length - 1) : (at + d + all.length) % all.length];
    switchTo({ key: k, take: set(k).takes.indexOf(t) });
  }
  function bestStrip(ks) {
    const all = bestOrder();
    if (!all.length) return "";
    const n = (Lab.C || {}).songs, open = M.bestAll ? all : all.slice(0, 12);
    return `<div class="best"><div class="roundh">Best first<small><kbd>N</kbd> next · <kbd>B</kbd> back · scored before you've heard them: plays nice with your ${n} shipped songs and sounds unlike them (and unlike the takes above it) · ${all.length} takes</small></div>
      <div class="bestl">${open.map(([k, t, c]) => `<button class="bestc ${k === M.key && set().takes[M.take] === t ? "on" : ""}" data-best="${esc(k)}|${set(k).takes.indexOf(t)}"
          data-tip="Plays nice: ${c.nice} good transitions, more than ${c.nice_beats} of ${n} shipped songs · unique ${c.unique == null ? "?" : (c.unique > 0 ? "+" : "") + c.unique.toFixed(1)}${c.nearest ? ` · most like ${esc(c.nearest.id.replace(/\.any|\.stack/g, ""))}` : ""}">
          <b>#${c.rank}</b><span>${esc(k.replace(/[.~]/g, " · "))} · ${esc(t.id)}</span>${dot2(k, t)}<small>beats ${c.pick_beats} of ${n}</small></button>`).join("")}
        ${all.length > 12 ? `<button class="btn" id="mbestall">${icon("right")}<span>${M.bestAll ? "Fewer" : `All ${all.length}`}</span></button>` : ""}</div></div>`;
  }
  const dot2 = (k, t) => { const x = Object.keys(t.profiles).map(p => Lab.V.clips[`mesh_${k}.${t.id}.${p}`] || 0).find(v => v) || 0;
    return x === 1 ? `<span class="vote up">${icon("up")}</span>` : x === -1 ? `<span class="vote down">${icon("down")}</span>` : ""; };
  function likedIn(k) {
    return set(k).takes.flatMap(t => Object.keys(t.profiles).filter(p => (Lab.V.clips[voteId(k, t.id, p)] || 0) > 0).map(p => `${t.id} · ${p}`));
  }
  function ships(k) {
    const c = set(k), takes = current(k), p0 = profile0(k), liked = likedIn(k);  // (liked: any round; the fallback: the newest batch)
    const sibling = keys().some(o => o !== k && set(o).context === c.context && set(o).biome === c.biome && likedIn(o).length);
    const fallback = c.style || sibling ? [] : takes.filter(t => (Lab.V.clips[voteId(k, t.id, p0)] || 0) >= 0).map(t => `${t.id} · ${p0}`);
    return { liked: liked.length, list: liked.length ? liked : fallback, sibling };
  }

  function hold(param, at) {  // keep the value an automation has reached at `at` (cancelling would jump back)
    if (param.cancelAndHoldAtTime) { param.cancelAndHoldAtTime(at); return; }
    const v = param.value;  // (clearing all of it: a curve already running would make a later event throw)
    try { param.cancelScheduledValues(0); param.setValueAtTime(v, Math.min(at, Lab.actx.currentTime)); } catch { /* (the ramp below still sets the target) */ }
  }
  function ramp(param, target, at, dur) {  // equal power, from the value held at `at`
    const from = param.value;
    hold(param, at);
    if (dur <= 0.02) { param.setValueAtTime(target, at); return; }
    const c = new Float32Array(64);
    for (let i = 0; i < 64; i++) { const x = i / 63; c[i] = Math.sqrt(from * from * (1 - x) + target * target * x); }
    try { param.setValueCurveAtTime(c, at, dur); } catch { param.setValueAtTime(target, at); }
  }
  function nextBar(deck = M.deck) {
    const now = Lab.actx.currentTime, b = barS();
    const at = deck.t0 + Math.ceil((now - deck.t0) / b + 1e-6) * b;
    return at - now < 0.08 ? at + b : at;
  }
  function load(key, take, prof) {  // a take's level buffers, decoded
    const fl = set(key).takes[take].profiles[prof].levels, lv = mesh().levels;
    return Promise.all(lv.map(l => buf(fl[l]))).then(bs => Object.fromEntries(lv.map((l, i) => [l, bs[i]])));
  }
  function makeDeck(loaded, at, offset) {  // (synchronous: `at` is chosen once the audio is ready, so it starts on time)
    const d = { t0: at - offset, src: {}, gain: {}, meter: {}, out: Lab.actx.createGain() };
    d.out.connect(out);
    for (const lv of mesh().levels) {
      const s = Lab.actx.createBufferSource(), g = Lab.actx.createGain(), m = Lab.actx.createAnalyser();
      s.buffer = loaded[lv]; s.loop = true; s.loopEnd = loaded[lv].duration;
      g.gain.value = gainFor(lv); m.fftSize = 1024;
      s.connect(g).connect(m).connect(d.out);
      s.start(at, offset);
      d.src[lv] = s; d.gain[lv] = g; d.meter[lv] = m;
    }
    return d;
  }
  function kill(d, at, fade) {
    const end = at + Math.max(fade, 0.01);
    hold(d.out.gain, at);
    d.out.gain.linearRampToValueAtTime(0, end);
    for (const s of Object.values(d.src)) s.stop(end + 0.02);
    setTimeout(() => d.out.disconnect(), Math.max(0, end - Lab.actx.currentTime + 0.3) * 1000);  // (frees the graph)
  }
  async function play(offset = 0) {
    const g = ++M.gen;
    if (Lab.actx.state === "suspended") await Lab.actx.resume();
    Lab.stop();
    let loaded;
    try { loaded = await load(M.key, M.take, M.prof); } catch { if (g === M.gen) Lab.toast("Couldn't load this take's audio", { icon: "x" }); return; }
    if (g !== M.gen) return;  // (stopped, or something newer started, while it loaded)
    const at = Lab.actx.currentTime + 0.06, d = makeDeck(loaded, at, offset);
    if (M.deck) kill(M.deck, at, 0.03);
    dropPrev(at);
    M.deck = d; M.pendingAt = 0;
    cancelAnimationFrame(M.raf); tick(); paint();
  }
  function dropPrev(at) {  // (a switch's outgoing deck, still sounding until the new one enters)
    if (M.prev && Lab.actx.currentTime < M.swapAt) kill(M.prev, at, 0.03);
    M.prev = null; M.swapAt = 0;
  }
  function stop() {
    M.gen++;
    dropPrev(Lab.actx.currentTime);
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
    if (change.key && change.key !== M.key) M.olderTakes = false;  // (another set: its earlier takes fold again)
    Object.assign(M, change);
    if (!set() || !set().takes.length) { stop(); render(); return; }
    M.take = Lab.clamp(M.take, 0, set().takes.length - 1);
    if (!set().takes[M.take].profiles[M.prof]) M.prof = Object.keys(set().takes[M.take].profiles)[0];
    Lab.setHash(M.key);
    if (!M.deck) { render(); return; }
    const g = ++M.gen;
    render();
    let loaded;
    try { loaded = await load(M.key, M.take, M.prof); } catch { if (g === M.gen) Lab.toast("Couldn't load this take's audio", { icon: "x" }); return; }
    if (g !== M.gen || !M.deck) return;
    const old = M.deck, at = nextBar(old);
    const offset = M.enter === "start" ? 0 : (((at - old.t0) % loopS()) + loopS()) % loopS();
    const xf = M.fade === "cut" ? 0 : beatS(), d = makeDeck(loaded, at, offset);
    if (xf > 0.02) { d.out.gain.setValueAtTime(0, Lab.actx.currentTime); d.out.gain.setValueAtTime(0, at); d.out.gain.linearRampToValueAtTime(1, at + xf); }
    kill(old, at, xf);
    M.deck = d; M.pendingAt = at; M.prev = old; M.swapAt = at;
    paint();
  }

  // ---- drawing: the clock, the timeline (the shape of the level you hear), meters and a spectrum
  function shape(rel) {
    if (!shapes.has(rel)) {
      const p = buf(rel).then(b => {
        const n = b.length, d = new Float32Array(n);
        for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] += x[i] / b.numberOfChannels; }
        return Lab.buckets(d, 1200);
      });
      shapes.set(rel, p); p.catch(() => { if (shapes.get(rel) === p) shapes.delete(rel); });  // (a failure isn't kept: it can load later)
    }
    return shapes.get(rel);
  }
  const shapeFile = () => { try { return files()[M.stack ? mesh().levels[mesh().levels.length - 1] : M.level]; } catch { return null; } };
  async function loadShape() {
    const want = shapeFile();
    let got = null;
    try { got = await shape(want); } catch { /* (no waveform) */ }
    if (want !== shapeFile()) return;  // (the take, level or profile moved on while this loaded)
    M.shape = got; M.shapeFor = got ? want : null;
    drawTimeline();
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
  const drawSpectrum = live => Lab.drawSpectrum($("mspec"), an, spec, live);
  function idle() {
    drawSpectrum(false); drawTimeline();
    const c = $("clock"); if (c) c.innerHTML = `1.1<small>/ ${mesh().bars}</small>`;
    document.querySelectorAll("#beats i").forEach(i => i.classList.remove("on"));
    const hd = document.querySelector("#tl .head"); if (hd) hd.style.display = "none";
    document.querySelectorAll(".lvl .vu div").forEach(d => d.style.width = "0");
    document.querySelectorAll("#tl .barnums span").forEach(s => s.classList.remove("now"));
  }
  function tick() {
    if (!M.deck) return;
    const now = Lab.actx.currentTime;
    if (M.prev && now >= M.swapAt) { M.prev = null; M.swapAt = 0; }
    const d = M.prev || M.deck;  // (a switch waiting for its bar: keep showing the deck you hear)
    const pos = posOf(d), m = mesh();
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
    if (arg && mesh().contexts[arg] && arg !== M.key && M.deck && Lab.tab === "music") { switchTo({ key: arg, take: 0 }); return; }  // (playing: enter on the bar)
    if (arg && mesh().contexts[arg]) { if (arg !== M.key) M.take = 0; M.key = arg; }
    if (!M.key || !set()) {  // (a set that has takes: generating can leave one with none, when every seed was rejected)
      const full = keys().filter(k => set(k).takes.length);
      M.key = full.find(k => roundOf(k) === newest()) || full[0] || keys()[0];
    }
    M.take = Math.max(0, Math.min(M.take, set().takes.length - 1));
    M.level = M.level && mesh().levels.includes(M.level) ? M.level : mesh().levels[Math.floor(mesh().levels.length / 2)];
    const def = mesh().profiles.includes(Lab.project.default_profile) ? Lab.project.default_profile : mesh().profiles[mesh().profiles.length - 1];
    M.prof = M.prof && mesh().profiles.includes(M.prof) ? M.prof : def;
    Lab.setHash(M.key);
    render();
  }
  function render() {
    if (M.seenKey !== M.key) {  // entering a set: note what's new in it (dots for this visit), then mark it all seen
      const all = setAllNew(M.key);
      M.fresh = new Set(all ? [] : current().flatMap(t => Object.keys(t.profiles).map(p => `${M.key}|${t.id}|${p}`)).filter(id => !seenSet().has(id)));
      markSetSeen(M.key); M.seenKey = M.key;
    }
    const m = mesh(), c = set();
    if (!c.takes.length) {  // (the set chips stay, so another set is one click away)
      Lab.view().innerHTML = `<div class="page music"><div class="wrap">
        <div class="page-head"><div><div class="eyebrow">${m.bpm} BPM · ${m.bar_beats}/4 · ${m.bars}-bar loops · ${loopS().toFixed(1)} s</div><h1>Music</h1></div></div>
        ${setList()}<div class="empty"><div class="glyph">${icon("layers")}</div><b>No takes passed for ${esc(M.key)}</b>
          <p>Every seed was rejected (tempo, beat lock or the quality gate). Run <code>soundlab music generate</code> again for it.</p></div></div></div>`;
      Lab.view().querySelectorAll("[data-key]").forEach(b => b.onclick = () => switchTo({ key: b.dataset.key, take: 0 }));
      if ($("molder")) $("molder").onclick = () => { M.older = !M.older; render(); };
      return;
    }
    M.take = Lab.clamp(M.take, 0, c.takes.length - 1);
    if (!c.takes[M.take].profiles[M.prof]) M.prof = Object.keys(c.takes[M.take].profiles)[0];
    const take = c.takes[M.take], info = (take.profiles[M.prof] || {}).info || {}, v = Lab.V.clips[voteId()], sh = ships(M.key);
    const qual = lv => ((take.quality || {})[(take.profiles[M.prof] || {}).levels?.[lv]]);  // (music check's report)
    const warned = t => { const L = (t.profiles[M.prof] || {}).levels || {}; return Object.values(L).some(f => ((t.quality || {})[f] || {}).flags?.length); };
    const dot = t => { const x = Lab.V.clips[voteId(M.key, t.id)]; return x === 1 ? `<span class="vote up">${icon("up")}</span>` : x === -1 ? `<span class="vote down">${icon("down")}</span>` : ""; };  // (this profile's vote)
    const cur = c.takes.filter(t => isCurrent(t)), olderT = c.takes.filter(t => !isCurrent(t)), showOld = M.olderTakes || olderT.includes(take);
    const likedTake = t => Object.keys(t.profiles).some(p => (Lab.V.clips[voteId(M.key, t.id, p)] || 0) > 0);
    const takeSeg = ts => Lab.seg(ts.map(t => [String(c.takes.indexOf(t)), `${dot(t)}${esc(t.id)}${score(M.key, t.id) ? `<span class="rankt">#${score(M.key, t.id).rank}</span>` : ""}${warned(t) ? `<span class="qwarn" data-tip="A level of this take is flagged">${icon("flag")}</span>` : ""}`]), String(M.take), "take");
    const page = document.querySelector(".page.music"), y = page ? page.scrollTop : 0;
    Lab.view().innerHTML = `<div class="page music"><div class="wrap">
      <div class="page-head"><div><div class="eyebrow">${m.bpm} BPM · ${m.bar_beats}/4 · ${m.bars}-bar loops · ${loopS().toFixed(1)} s</div><h1>Music</h1>
        <p class="lede">A take's levels play in sync the whole time; intensity is only their volumes, so it moves at any moment.
          Switching take, profile or set enters on the next bar line. Click the timeline to jump to a bar.</p></div></div>
      ${m.provisional ? `<div class="warn">${icon("flag")}Provisional instrument pool: choose instruments on the Instruments page, then regenerate.</div>` : ""}
      ${setList()}
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
            <small>${info[lv] && info[lv].noise ? `derived at ${info[lv].noise}` : "the spine"}${info[lv] && info[lv].layers ? ` + ${Object.keys(info[lv].layers).join(" + ")}` : ""}${qual(lv) && qual(lv).aes ? ` · rated ${qual(lv).aes.CE.toFixed(1)}` : ""}</small>
            ${qual(lv) && qual(lv).flags && qual(lv).flags.length ? `<span class="qflag" data-tip="Measured by music check; a warning, not a verdict">${icon("flag")}${esc(qual(lv).flags.join(" · "))}</span>` : ""}
            <div class="vu"><div></div></div><div class="mix"><div></div></div></button>`).join("")}
          <button class="btn stackbtn ${M.stack ? "on" : ""}" id="mstack" data-tip="Every level at once: do they clash? (S)">${icon("layers")}<span>Stack</span></button></div>
      </section>
      <div class="mtake">
        <div class="field"><label>Take</label>${takeSeg(cur)}${olderT.length ? `<button class="btn" id="molderT" data-tip="Takes from earlier runs of this set: hidden once a new batch exists">${icon("right")}<span>Earlier takes · ${olderT.length}${olderT.filter(t => likedTake(t)).length ? ` · ${olderT.filter(t => likedTake(t)).length} liked` : ""}</span></button>` : ""}${showOld ? takeSeg(olderT) : ""}</div>
        <div class="field"><label>Profile</label>${Lab.seg(m.profiles.filter(p => take.profiles[p]).map(p => [p, `${esc(p)}${M.fresh.has(`${M.key}|${take.id}|${p}`) ? `<span class="newtag">new</span>` : ""}`, false, profTip(take, p)]), M.prof, "prof")}</div>
        <div class="field grow"><label>Plays</label><div class="lineup">${Object.entries(take.instruments || {}).map(([r, n]) =>
          `<span class="chip" data-tip="${esc(r.replace(/_/g, " "))}">${esc(n)}</span>`).join("")}${Object.entries(take.layers || {}).map(([n, l]) =>
          `<button class="chip layer" data-stem="${esc(l.file)}" data-play-id="stem:${esc(l.file)}" data-tip="Layer: hear it alone. ${esc(l.prompt)}">${icon("play")}${esc(n)} layer</button>`).join("")}</div></div>
        <div class="field"><label>This take</label><div class="row">
          <button class="btn good ${v === 1 ? "on" : ""}" id="mup" data-tip="Liked takes ship as tracks in rotation (U)">${icon("up")}Like</button>
          <button class="btn bad ${v === -1 ? "on" : ""}" id="mdown" data-tip="Dislike (D)">${icon("down")}</button></div></div>
      </div>
      <div class="mopts">
        <div class="field"><label>Fade</label>${Lab.seg(Object.entries(FADES).map(([k, [l]]) => [k, l]), M.fade, "fade")}</div>
        <div class="field"><label>Intensity changes</label>${Lab.seg([["now", "now"], ["bar", "on the next bar"]], M.quant ? "bar" : "now", "quant")}</div>
        <div class="field"><label>A switch enters</label>${Lab.seg([["start", "at bar 1"], ["same", "at the same bar"]], M.enter, "enter")}</div>
      </div>
      <div class="facts">${(sc => sc ? `<span data-tip="music candidates: scored against your shipped songs before you heard it">score <b>#${sc.rank}</b>, over ${sc.pick_beats} of ${Lab.C.songs} shipped songs · plays nice <b>${sc.nice}</b> good transitions (over ${sc.nice_beats}) · unique <b>${sc.unique == null ? "?" : (sc.unique > 0 ? "+" : "") + sc.unique.toFixed(1)}</b>${sc.nearest ? ` · most like <b>${esc(sc.nearest.id.replace(/\.any|\.stack/g, ""))}</b> (same piece ${sc.nearest.same_piece.toFixed(2)}, sounds like ${sc.nearest.sounds_like.toFixed(2)})` : ""}</span>` : "")(score(M.key, take.id))}<span>tempo <b>${take.measured_bpm} → ${take.corrected_bpm} BPM</b></span>${take.beat_spread_ms != null ? `<span>beat spread <b>${take.beat_spread_ms} ms</b></span>` : ""}
        <span>beat lock <b>${esc(m.levels.map(lv => info[lv] ? `${lv} ${info[lv].lock}` : "").filter(Boolean).join(", "))}</b></span>
        <span>ships <b>${sh.list.length ? esc(sh.list.join(", ")) : "nothing"}</b>${sh.liked ? "" : sh.list.length ? " (none liked yet: every take of the newest batch not thumbed down, at its default profile)" : c.style ? " (a style's takes ship only when liked)" : sh.sibling ? " (a style of this set is liked instead)" : current().length ? " (every take of the newest batch is thumbed down)" : ""}</span></div>
      <div class="notebox ${Lab.V.notes["mesh_" + M.key] ? "has" : ""}">${icon("pen")}<textarea id="mnote" rows="1"
        placeholder="Notes on ${esc(M.key)}: do the levels mesh? Which lineups work?">${esc(Lab.V.notes["mesh_" + M.key] || "")}</textarea><span class="saved">${icon("check")}saved</span></div>
      <details class="prompts"><summary>${icon("right")}Prompts</summary>
        ${m.levels.map(lv => `<div class="p"><b>${esc(lv)}</b>${esc((take.prompts || c.prompts || {})[lv])}</div>`).join("")}</details></div></div>`;
    document.querySelector(".page.music").scrollTop = y;
    const vw = Lab.view();
    vw.querySelectorAll("[data-key]").forEach(b => b.onclick = () => switchTo({ key: b.dataset.key, take: 0 }));
    if ($("molder")) $("molder").onclick = () => { M.older = !M.older; render(); };
    if ($("molderT")) $("molderT").onclick = () => { M.olderTakes = !M.olderTakes; render(); };
    vw.querySelectorAll("[data-stem]").forEach(b => b.onclick = () => {  // (a layer alone; click it again to stop)
      const id = "stem:" + b.dataset.stem;
      if (Lab.player.current === id) { Lab.stop(); paint(); return; }
      if (M.deck) stop();
      Lab.play("/clips/" + b.dataset.stem, { id, onEnd: paint }); paint();
    });
    vw.querySelectorAll("[data-take]").forEach(b => b.onclick = () => switchTo({ take: +b.dataset.take }));
    vw.querySelectorAll("[data-best]").forEach(b => b.onclick = () => { const [k, i] = b.dataset.best.split("|"); switchTo({ key: k, take: +i }); });
    if ($("mbestall")) $("mbestall").onclick = () => { M.bestAll = !M.bestAll; render(); };
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
    if (M.shapeFor !== shapeFile()) M.shape = null;
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
    document.querySelectorAll("[data-stem]").forEach(b => { const on = Lab.player.current === "stem:" + b.dataset.stem; b.classList.toggle("on", on); b.innerHTML = b.innerHTML.replace(/<svg[\s\S]*?<\/svg>/, icon(on ? "stop" : "play")); });
    const pend = M.pendingAt && M.deck ? Math.floor(((((M.pendingAt - M.deck.t0) % loopS()) + loopS()) % loopS()) / barS()) : -1;
    document.querySelectorAll("#tl .barnums span").forEach((el, i) => el.classList.toggle("pend", i === pend));
  }
  async function vote(v) {
    const id = voteId(), now = Lab.V.clips[id] === v ? 0 : v, t = set().takes[M.take].id;
    await Lab.vote({ clip: id, value: now }, { label: `${now === 1 ? "Liked" : now === -1 ? "Disliked" : "Vote cleared on"} ${M.key} ${t} · ${M.prof}`, icon: now === -1 ? "down" : now ? "up" : "x" });
    render();
  }

  Lab.register("music", {
    title: "Music", icon: "layers", show, refresh: () => show(), dock: false, enabled: () => Lab.project.features.music, leave: stop,
    keys: [["Space", "play or stop"], ["1 2 3", "quietest … fullest level"], ["S", "stack every level"], ["← →", "jump a bar back / forward"],
           ["[ ]", "previous / next take"], ["N B", "next / back in Best first (across sets)"], ["P", "next profile"], ["U", "like this take"], ["D", "dislike this take"], ["Esc", "stop"]],
    onKey(e) {
      if (!mesh() || !M.key || !set().takes.length) return;
      const k = e.key;
      if (k === " ") { e.preventDefault(); M.deck ? stop() : play(); }
      else if (/^[1-9]$/.test(k) && mesh().levels[+k - 1]) { M.stack = false; setLevel(mesh().levels[+k - 1]); loadShape(); }
      else if (k === "s" || k === "S") { M.stack = !M.stack; setLevel(); loadShape(); }
      else if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); const b = M.deck ? Math.floor(posOf(M.deck) / barS()) : 0; seekBar(b + (k === "ArrowRight" ? 1 : -1)); }
      else if (k === "[" || k === "]") {  // (the takes on show: the newest batch, and the earlier ones when opened)
        const vis = set().takes.map((t, i) => i).filter(i => isCurrent(set().takes[i]) || M.olderTakes || i === M.take), at = vis.indexOf(M.take);
        switchTo({ take: vis[(at + (k === "]" ? 1 : -1) + vis.length) % vis.length] });
      }
      else if (k === "p" || k === "P") {  // (among the profiles this take has)
        const have = mesh().profiles.filter(p => set().takes[M.take].profiles[p]);
        if (have.length) switchTo({ prof: have[(have.indexOf(M.prof) + 1) % have.length] });
      }
      else if (k === "n" || k === "N") stepBest(1);  // (the next take in score order, across sets)
      else if (k === "b" || k === "B") stepBest(-1);
      else if (k === "u" || k === "U") vote(1);
      else if (k === "d" || k === "D") vote(-1);
      else if (k === "Escape") { stop(); Lab.stop(); paint(); }
    },
  });
})();
