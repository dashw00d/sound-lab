// Music: a set's levels playing in sync on the audio clock (as the game's synchronized stream does), with live
// intensity crossfades and bar-quantised switches between takes, profiles and sets.
(() => {
  const FADES = { cut: ["cut", 0], beat: ["1 beat", 1], bar: ["1 bar", 4], two: ["2 bars", 8] };  // in beats
  const PROFILE_INFO = { close: "levels keep the spine's chords; gentler contrast", contrast: "clearer contrast; chords drift more" };
  const M = { key: null, take: 0, prof: null, level: null, stack: false, fade: "bar", quant: false, enter: "start",
              deck: null, pendingAt: 0, raf: 0 };
  const bufs = new Map();
  const out = Lab.actx.createGain();
  out.gain.value = 0.9; out.connect(Lab.actx.destination);

  const mesh = () => Lab.S.mesh;
  const beatS = () => 60 / mesh().bpm, barS = () => beatS() * mesh().bar_beats, loopS = () => barS() * mesh().bars;
  const set = (k = M.key) => mesh().contexts[k];
  const keys = () => Object.keys(mesh().contexts).sort((a, b) => a.localeCompare(b));
  const voteId = () => `mesh_${M.key}.${set().takes[M.take].id}.${M.prof}`;
  const buf = rel => { if (!bufs.has(rel)) bufs.set(rel, fetch("/clips/" + rel).then(r => r.arrayBuffer()).then(b => Lab.actx.decodeAudioData(b))); return bufs.get(rel); };
  const gainFor = lv => M.stack ? 0.6 : (lv === M.level ? 1 : 0);

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
    let at = deck.t0 + Math.ceil((now - deck.t0) / b + 1e-6) * b;
    return at - now < 0.08 ? at + b : at;
  }
  async function makeDeck(key, take, prof, at, offset) {
    const files = set(key).takes[take].profiles[prof].levels;
    const loaded = Object.fromEntries(await Promise.all(mesh().levels.map(async lv => [lv, await buf(files[lv])])));
    const d = { t0: at - offset, src: {}, gain: {}, out: Lab.actx.createGain() };
    d.out.connect(out);
    for (const lv of mesh().levels) {
      const s = Lab.actx.createBufferSource(), g = Lab.actx.createGain();
      s.buffer = loaded[lv]; s.loop = true; s.loopEnd = loaded[lv].duration;
      g.gain.value = gainFor(lv);
      s.connect(g).connect(d.out);
      s.start(Math.max(at, Lab.actx.currentTime), offset);
      d.src[lv] = s; d.gain[lv] = g;
    }
    return d;
  }
  function kill(d, at, fade) {
    d.out.gain.cancelScheduledValues(at);
    d.out.gain.setValueAtTime(d.out.gain.value, at);
    d.out.gain.linearRampToValueAtTime(0, at + Math.max(fade, 0.01));
    for (const s of Object.values(d.src)) s.stop(at + Math.max(fade, 0.01) + 0.02);
  }
  async function play() {
    if (Lab.actx.state === "suspended") await Lab.actx.resume();
    stop();
    M.deck = await makeDeck(M.key, M.take, M.prof, Lab.actx.currentTime + 0.1, 0);
    tick(); paint();
  }
  function stop() {
    if (M.deck) { kill(M.deck, Lab.actx.currentTime, 0.05); M.deck = null; }
    M.pendingAt = 0; cancelAnimationFrame(M.raf); paint();
  }
  function setLevel(lv) {
    if (lv) M.level = lv;
    if (M.deck) {
      const at = M.quant ? nextBar() : Lab.actx.currentTime + 0.02;
      const dur = FADES[M.fade][1] * beatS();
      for (const l of mesh().levels) ramp(M.deck.gain[l].gain, gainFor(l), at, dur);
      if (M.quant) M.pendingAt = at;
    }
    paint();
  }
  async function switchTo(change) {  // a new take, profile or set enters on the next bar line
    Object.assign(M, change);
    if (!set().takes[M.take].profiles[M.prof]) M.prof = Object.keys(set().takes[M.take].profiles)[0];
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
  function tick() {
    const d = M.deck;
    if (!d) return;
    const now = Lab.actx.currentTime, pos = (((now - d.t0) % loopS()) + loopS()) % loopS();
    const bar = Math.floor(pos / barS()), beat = Math.floor(pos / beatS()) % mesh().bar_beats;
    const clock = document.getElementById("clock");
    if (clock) clock.textContent = now < d.t0 ? "…" : `${bar + 1}.${beat + 1}`;
    document.querySelectorAll(".bars div").forEach((el, i) => el.classList.toggle("now", now >= d.t0 && i === bar));
    for (const lv of mesh().levels) {
      const m = document.querySelector(`.lvl[data-lv="${lv}"] .meter div`);
      if (m) m.style.width = `${Math.round(100 * Math.min(1, d.gain[lv].gain.value / (M.stack ? 0.6 : 1)))}%`;
    }
    if (M.pendingAt && now >= M.pendingAt) { M.pendingAt = 0; paint(); }
    M.raf = requestAnimationFrame(tick);
  }
  function show() {
    if (!mesh() || !keys().length) { Lab.view().innerHTML = `<div class="page"><div class="empty">No music yet.<br><br>Make some with <code>soundlab music generate --contexts …</code>.</div></div>`; return; }
    if (!M.key || !set()) M.key = keys()[0];
    M.take = Math.min(M.take, set().takes.length - 1);
    M.level = M.level && mesh().levels.includes(M.level) ? M.level : mesh().levels[Math.floor(mesh().levels.length / 2)];
    M.prof = M.prof && mesh().profiles.includes(M.prof) ? M.prof : mesh().profiles[mesh().profiles.length - 1];
    render();
  }
  function render() {
    const m = mesh(), c = set();
    if (!c.takes.length) { Lab.view().innerHTML = `<div class="page"><div class="empty">No takes passed for ${Lab.esc(M.key)}.</div></div>`; return; }
    const take = c.takes[M.take], info = (take.profiles[M.prof] || {}).info || {}, vid = voteId();
    Lab.view().innerHTML = `<div class="page"><h2>Music</h2>
      <div class="note">${m.bpm} BPM · ${m.bar_beats}/4 · ${m.bars}-bar loops (${loopS().toFixed(1)} s). A take's levels play in sync all the
        time; intensity is only their volumes, so it moves at any moment. Switching take, profile or set enters on the next bar line.</div>
      ${m.provisional ? `<div class="warn">Provisional instrument pool: choose instruments on the Instruments page, then regenerate.</div>` : ""}
      <div class="row"><span class="lbl">set</span>${Lab.seg(keys().map(k => [k, `${Lab.esc(k.replace(".", " · "))} <small>${Lab.esc(m.contexts[k].mode)}</small>`]), M.key, "key")}</div>
      <div class="row"><span class="lbl">take</span>${Lab.seg(c.takes.map((t, i) => [String(i), t.id]), String(M.take), "take")}
        <span class="lbl" style="margin-left:12px">profile</span>${Lab.seg(m.profiles.map(p => [p, p, !take.profiles[p], PROFILE_INFO[p]]), M.prof, "prof")}</div>
      ${take.instruments ? `<div class="row"><span class="lbl">plays</span><div class="lineup">${Object.entries(take.instruments).map(([r, n]) =>
        `<span class="chip" title="${Lab.esc(r.replace(/_/g, " "))}">${Lab.esc(n)}</span>`).join("")}</div></div>` : ""}
      <div class="row"><button class="btn primary" id="mplay" style="padding:8px 18px">${M.deck ? "■ Stop" : "▶ Play"}</button>
        <span class="clock" id="clock">–</span>
        <button class="btn ${M.stack ? "on" : ""}" id="mstack" title="every level at once: do they clash?">stack all levels (S)</button></div>
      <div class="lvls">${m.levels.map((lv, i) => `<button class="lvl ${!M.stack && M.level === lv ? "on" : ""}" data-lv="${lv}">
        <b>${i + 1} · ${Lab.esc(lv)}</b><small>${info[lv] && info[lv].noise ? `derived at ${info[lv].noise}` : "the spine"}</small><div class="meter"><div></div></div></button>`).join("")}</div>
      <div class="row"><span class="lbl">fade</span>${Lab.seg(Object.entries(FADES).map(([k, [l]]) => [k, l]), M.fade, "fade")}
        <span class="lbl" style="margin-left:12px">intensity on</span>${Lab.seg([["now", "now"], ["bar", "next bar"]], M.quant ? "bar" : "now", "quant")}
        <span class="lbl" style="margin-left:12px">switch enters</span>${Lab.seg([["start", "at bar 1"], ["same", "at the same bar"]], M.enter, "enter")}</div>
      <div class="bars">${Array.from({ length: m.bars }, (_, i) => `<div>${i + 1}</div>`).join("")}</div>
      <div class="row"><span class="lbl">this take</span>
        <button class="btn ${Lab.V.clips[vid] === 1 ? "on" : ""}" id="mup">👍 (U)</button><button class="btn ${Lab.V.clips[vid] === -1 ? "on" : ""}" id="mdown">👎 (D)</button>
        <span class="note">liked takes ship as tracks in rotation · ${take.measured_bpm} → ${take.corrected_bpm} BPM · beat lock ${m.levels.map(lv => info[lv] ? `${lv} ${info[lv].lock}` : "").join(", ")}</span></div>
      <h3>Notes on ${Lab.esc(M.key)}</h3><textarea id="mnote" rows="2" placeholder="Do the levels mesh? Which lineups work?">${Lab.esc(Lab.V.notes["mesh_" + M.key] || "")}</textarea>
      <details style="margin-top:12px"><summary class="note" style="cursor:pointer">prompts</summary>
        ${m.levels.map(lv => `<div class="note" style="margin:6px 0"><b>${Lab.esc(lv)}</b>: ${Lab.esc((take.prompts || c.prompts || {})[lv])}</div>`).join("")}</details></div>`;
    const v = Lab.view();
    v.querySelectorAll("[data-key]").forEach(b => b.onclick = () => switchTo({ key: b.dataset.key, take: 0 }));
    v.querySelectorAll("[data-take]").forEach(b => b.onclick = () => switchTo({ take: +b.dataset.take }));
    v.querySelectorAll("[data-prof]").forEach(b => b.onclick = () => switchTo({ prof: b.dataset.prof }));
    v.querySelectorAll("[data-fade]").forEach(b => b.onclick = () => { M.fade = b.dataset.fade; render(); });
    v.querySelectorAll("[data-quant]").forEach(b => b.onclick = () => { M.quant = b.dataset.quant === "bar"; render(); });
    v.querySelectorAll("[data-enter]").forEach(b => b.onclick = () => { M.enter = b.dataset.enter; render(); });
    v.querySelectorAll(".lvl").forEach(b => b.onclick = () => { M.stack = false; setLevel(b.dataset.lv); });
    document.getElementById("mplay").onclick = () => M.deck ? stop() : play();
    document.getElementById("mstack").onclick = () => { M.stack = !M.stack; setLevel(); };
    document.getElementById("mup").onclick = () => vote(1);
    document.getElementById("mdown").onclick = () => vote(-1);
    document.getElementById("mnote").onchange = e => Lab.vote({ sound: "mesh_" + M.key, note: e.target.value });
    paint();
  }
  function paint() {
    if (Lab.tab !== "music") return;
    const p = document.getElementById("mplay");
    if (p) p.textContent = M.deck ? "■ Stop" : "▶ Play";
    document.querySelectorAll(".lvl").forEach(b => b.classList.toggle("on", !M.stack && b.dataset.lv === M.level));
    const st = document.getElementById("mstack");
    if (st) st.classList.toggle("on", M.stack);
    const pend = M.pendingAt && M.deck ? Math.floor(((((M.pendingAt - M.deck.t0) % loopS()) + loopS()) % loopS()) / barS()) : -1;
    document.querySelectorAll(".bars div").forEach((el, i) => el.classList.toggle("pending", i === pend));
  }
  async function vote(v) { const id = voteId(); await Lab.vote({ clip: id, value: Lab.V.clips[id] === v ? 0 : v }); render(); }

  Lab.register("music", {
    title: "Music", show, enabled: () => Lab.project.features.music, leave: stop,
    keys: [["Space", "play or stop"], ["1", "quietest level"], ["2", "middle level"], ["3", "fullest level"], ["S", "stack every level"],
           ["[", "previous take"], ["]", "next take"], ["P", "next profile"], ["U", "like this take"], ["D", "dislike this take"], ["Esc", "stop"]],
    onKey(e) {
      if (!mesh() || !M.key) return;
      const k = e.key, n = set().takes.length;
      if (k === " ") { e.preventDefault(); M.deck ? stop() : play(); }
      else if (/^[1-9]$/.test(k) && mesh().levels[+k - 1]) { M.stack = false; setLevel(mesh().levels[+k - 1]); }
      else if (k === "s" || k === "S") { M.stack = !M.stack; setLevel(); }
      else if (k === "[" || k === "]") switchTo({ take: (M.take + (k === "]" ? 1 : -1) + n) % n });
      else if (k === "p" || k === "P") switchTo({ prof: mesh().profiles[(mesh().profiles.indexOf(M.prof) + 1) % mesh().profiles.length] });
      else if (k === "u") vote(1);
      else if (k === "d") vote(-1);
      else if (k === "Escape") stop();
    },
  });
})();
