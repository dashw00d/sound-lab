// Families: every song sorted into families (music families: songs that could pass as sections of one long piece), and
// one queue to click through, blind: new trial takes, extensions (music grow), the least sure placements and the most
// alike pairs. Each shows the family it's being matched to, as playable chips. The designer, 2026-10-21: "grow could
// serve two functions, test new generations and also test uncertain matches... thumbs up/down, bad match, near
// duplicate. And just kinda click through them real quick."
//   U / ↑  good, it belongs here       link_<item>|<member> = 1, ok_<item> = 1
//   D / ↓  a bad take                   ok_<item> = -1 (a shipped song: out of the walk, never out of the game)
//   B      good, but a bad match        link_<item>|<member> = -1, ok_<item> = 1
//   X      a near duplicate             dup_<item>|<member> = 1 (the member last heard, else the nearest)
//   Y      good, and a new family       novel_<set>.<take> (or novel_<item>) = 1, ok_<item> = 1
(() => {
  const { icon, esc } = Lab, $ = id => document.getElementById(id);
  const F = { data: null, cur: null, playing: null, state: "mellow", heard: null, last: null, bufs: new Map(), stamp: null, poll: 0 };
  const out = Lab.actx.createGain();
  out.gain.value = 0.9; out.connect(Lab.master);
  const GROW_KEEP = 4;
  const D = () => F.data || { items: {}, families: {}, queue: [] };
  const item = id => D().items[id];
  const novelKey = id => { const it = item(id); return it && it.set ? `novel_${it.set}.${it.take}` : `novel_${id}`; };
  function answered(e) {
    const i = e.item, v = Lab.V.clips;
    if (v[`ok_${i}`] < 0 || v[novelKey(i)] || v[`novel_${i}`]) return true;
    return Object.keys(v).some(k => k.startsWith(`link_${i}|`) || k.startsWith(`dup_${i}|`));
  }
  const queue = () => D().queue.filter(e => item(e.item) && !answered(e));
  function membersOf(e) {  // the family's chips: its medoid, then the item's nearest inside it (the pair's other first, for a duplicate check)
    const f = D().families[e.family] || { members: [] }, it = item(e.item), inF = new Set(f.members);
    const out = [];
    const add = id => { if (id && id !== e.item && item(id) && !out.includes(id)) out.push(id); };
    if (e.vs) add(e.vs);
    add(f.medoid);
    (it.nearest || []).filter(id => inF.has(id)).forEach(add);
    f.members.forEach(id => { if (out.length < 5) add(id); });
    return out.slice(0, 5);
  }

  async function buf(url) {
    if (!F.bufs.has(url)) F.bufs.set(url, fetch(url).then(r => r.arrayBuffer()).then(b => Lab.actx.decodeAudioData(b)));
    if (F.bufs.size > 12) F.bufs.delete(F.bufs.keys().next().value);
    return F.bufs.get(url);
  }
  function framed(seedBuf, ext) {  // an extension between its seed's tail and head (music grow)
    const barN = Math.round(ext.sampleRate * 60 / 90 * 4), k = GROW_KEEP * barN, b = Lab.actx.createBuffer(ext.numberOfChannels, k + ext.length + k, ext.sampleRate);
    for (let ch = 0; ch < ext.numberOfChannels; ch++) {
      const d = b.getChannelData(ch), sd = seedBuf.getChannelData(Math.min(ch, seedBuf.numberOfChannels - 1));
      d.set(sd.subarray(sd.length - k), 0); d.set(ext.getChannelData(ch), k); d.set(sd.subarray(0, k), k + ext.length);
    }
    return b;
  }
  function stop() {
    if (!F.playing) return;
    const now = Lab.actx.currentTime;
    for (const v of Object.values(F.playing.voices)) { try { v.g.gain.setTargetAtTime(0, now, 0.03); v.s.stop(now + 0.15); } catch { /* ignore */ } }
    F.playing = null; paint();
  }
  async function play(id) {  // a song's mellow and intense, looping in sync (an extension once, framed by its seed)
    stop();
    if (Lab.actx.state === "suspended") await Lab.actx.resume();
    const it = item(id); if (!it) return;
    let [m, i] = await Promise.all([buf(it.src.calm), buf(it.src.battle || it.src.calm)]);
    const seed = it.seed && item(it.seed);
    if (seed) { const [sm, si] = await Promise.all([buf(seed.src.calm), buf(seed.src.battle || seed.src.calm)]); m = framed(sm, m); i = framed(si, i); }
    const at = Lab.actx.currentTime + 0.06, voices = {};
    for (const [st, b] of [["mellow", m], ["intense", i]]) {
      const s = Lab.actx.createBufferSource(), g = Lab.actx.createGain();
      s.buffer = b; s.loop = !seed; g.gain.value = st === F.state ? 1 : 0;
      s.connect(g).connect(out); s.start(at); voices[st] = { s, g };
      if (!s.loop && st === "mellow") s.onended = () => { if (F.playing && F.playing.voices.mellow.s === s) { F.playing = null; paint(); } };
    }
    F.playing = { id, voices };
    if (F.cur && id !== F.cur.item) F.heard = id;
    paint();
  }
  function setState(st) {
    F.state = st;
    if (F.playing) { const now = Lab.actx.currentTime;
      for (const [k, v] of Object.entries(F.playing.voices)) { v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(v.g.gain.value, now); v.g.gain.linearRampToValueAtTime(k === st ? 1 : 0, now + 4 / 3); } }
    paint();
  }
  async function answer(kind) {
    const e = F.cur; if (!e) return;
    const i = e.item, mem = membersOf(e), vs = F.heard && mem.includes(F.heard) ? F.heard : (e.vs || mem[0]);
    const votes = {
      good: [[`link_${i}|${vs}`, 1], [`ok_${i}`, 1]],
      bad: [[`ok_${i}`, -1]],
      mismatch: [[`link_${i}|${vs}`, -1], [`ok_${i}`, 1]],
      dup: [[`dup_${i}|${vs}`, 1]],
      novel: [[novelKey(i), 1], [`ok_${i}`, 1]],
      // (all of it one family: the song with each member shown, and each member with the first)
      all: [...mem.map(m => [`link_${i}|${m}`, 1]), ...mem.slice(1).map(m => [`link_${m}|${mem[0]}`, 1]), [`ok_${i}`, 1]],
    }[kind];
    const label = { good: "Belongs here", bad: "A bad take", mismatch: "Bad match", dup: "Near duplicate", novel: "A new family", all: `All ${mem.length + 1} belong together` }[kind];
    for (const [k, v] of votes) await Lab.vote({ clip: k, value: v }, { label, icon: kind === "bad" ? "down" : kind === "novel" ? "starFill" : kind === "good" || kind === "all" ? "up" : "x" });
    F.last = { e, kind, vs };
    next(true);
  }
  function next(autoplay) {
    const was = !!F.playing || autoplay;
    F.cur = queue()[0] || null; F.heard = null;
    render();
    if (F.cur && was) play(F.cur.item); else if (!F.cur) stop();
  }
  function paint() {
    const p = $("faplay"); if (p) p.innerHTML = icon(F.playing && F.playing.id === (F.cur || {}).item ? "stop" : "play");
    document.querySelectorAll(".families [data-mem]").forEach(b => b.classList.toggle("on", !!F.playing && F.playing.id === b.dataset.mem));
    document.querySelectorAll(".families [data-st]").forEach(b => b.classList.toggle("on", b.dataset.st === F.state));
  }
  const KIND = { new: "A new take: is it good, and where does it belong?", extension: "An extension: does it join its seed seamlessly, and belong?",
                 uncertain: "Unsure where this one belongs: does it fit this family?", dup: "These two are very alike: near duplicates?" };
  function render() {
    if (!F.data) { Lab.view().innerHTML = `<div class="page families"><div class="wrap"><div class="dim">Reading the families…</div></div></div>`; return; }
    const q = queue(), e = F.cur, fam = e && D().families[e.family], mem = e ? membersOf(e) : [], keys = ["Q", "W", "E", "R", "T"];
    const nf = Object.keys(D().families).length, done = D().queue.length - q.length;
    const last = F.last && item(F.last.e.item);
    Lab.view().innerHTML = `<div class="page families"><div class="wrap">
      <div class="page-head"><div><div class="eyebrow">${nf} families · ${Object.keys(D().items).length} songs · ${q.length} to judge${done ? ` · ${done} done this sort` : ""}</div><h1>Families</h1>
        <p class="lede">A family is songs that could pass as sections of one long piece. Click through: is it good, does it belong with these, is it a near duplicate, or the start of a new family?</p></div></div>
      ${e ? `<section class="card facard">
        <div class="fakind">${esc(KIND[e.kind] || "")}</div>
        <div class="fatop"><button class="playbtn" id="faplay" data-tip="Play it (Space)">${icon("play")}</button>
          <div><div class="big">${e.kind === "extension" ? "The extension" : "This song"} <small>${e.kind === "extension" ? `framed by its seed's last ${GROW_KEEP} bars and first ${GROW_KEEP}` : ""}</small></div>
            <div class="row">${[["mellow", "1"], ["intense", "2"]].map(([st, k]) => `<button class="btn ${F.state === st ? "on" : ""}" data-st="${st}">${st}<kbd>${k}</kbd></button>`).join("")}</div></div></div>
        <div class="famem"><span class="lbl">${e.kind === "dup" ? "against" : "its family"}${fam ? ` · ${fam.members.length} songs` : ""}</span>
          ${mem.map((id, k) => `<button class="chip fachip" data-mem="${esc(id)}" data-tip="${item(id).kind === "shipped" ? "a shipped song" : "a new take"}">${icon("play")}${k + 1}<kbd>${keys[k]}</kbd></button>`).join("")}</div>
        <div class="row fabtns">
          <button class="btn good" data-ans="good">${icon("up")}Belongs<kbd>U</kbd></button>
          <button class="btn good" data-ans="all" data-tip="This song and every member shown are one family">${icon("check")}All belong<kbd>A</kbd></button>
          <button class="btn bad" data-ans="bad">${icon("down")}Bad take<kbd>D</kbd></button>
          <button class="btn" data-ans="mismatch">${icon("x")}Bad match<kbd>B</kbd></button>
          <button class="btn" data-ans="dup">${icon("layers")}Near duplicate<kbd>X</kbd></button>
          <button class="btn primary" data-ans="novel">${icon("starFill")}New family<kbd>Y</kbd></button>
          <button class="btn ghost" id="faskip">Skip<kbd>→</kbd></button></div>
      </section>` : `<section class="card facard"><div class="dim">Nothing to judge right now. New takes, extensions and a fresh sort come in as they're made.</div></section>`}
      ${last ? `<p class="dim falast">The last one (${esc({ good: "belongs", bad: "a bad take", mismatch: "a bad match", dup: "a near duplicate", novel: "a new family", all: "all belong" }[F.last.kind])}): ${esc(F.last.e.item.replace(/\.any|\.stack/g, ""))}${last.words ? " · " + esc(Object.values(last.words).filter(Boolean).map(x => String(x).replace("{s} ", "strings ")).join(" · ")) : ""}${F.last.vs ? ` · against ${esc(F.last.vs.replace(/\.any|\.stack/g, ""))}` : ""}</p>` : ""}
    </div></div>`;
    if ($("faplay")) $("faplay").onclick = () => F.playing && F.playing.id === e.item ? stop() : play(e.item);
    if ($("faskip")) $("faskip").onclick = skip;
    document.querySelectorAll(".families [data-mem]").forEach(b => b.onclick = () => F.playing && F.playing.id === b.dataset.mem ? stop() : play(b.dataset.mem));
    document.querySelectorAll(".families [data-ans]").forEach(b => b.onclick = () => answer(b.dataset.ans));
    document.querySelectorAll(".families [data-st]").forEach(b => b.onclick = () => setState(b.dataset.st));
    paint();
  }
  function skip() {  // (to the end of the queue, for now)
    if (!F.cur) return;
    const d = D(), k = d.queue.indexOf(F.cur);
    if (k >= 0) { d.queue.splice(k, 1); d.queue.push(F.cur); }
    next(!!F.playing);
  }
  async function load(keep) {
    try {
      const s = await (await fetch("/api/stamp")).json();
      if (keep && s.families === F.stamp) return;
      F.stamp = s.families;
      F.data = await (await fetch("/api/families")).json();
    } catch { /* server restarting */ }
    if (!F.cur || answered(F.cur) || !item(F.cur.item)) next(false); else render();
  }
  function show() { if (!F.data) load(false).then(() => {}); else render(); clearInterval(F.poll); F.poll = setInterval(() => { if (Lab.tab === "families" && !F.playing) load(true); }, 15000); }

  Lab.register("families", {
    title: "Families", icon: "layers", show, refresh: () => { if (F.cur && answered(F.cur)) next(false); else render(); }, dock: false,
    enabled: () => Lab.project.features.music, leave: () => { stop(); clearInterval(F.poll); },
    count: () => F.data ? queue().length || "" : "",
    keys: [["Space", "play or stop it"], ["Q W E R T", "play a family member"], ["1 2", "mellow / intense"], ["U / ↑", "belongs"], ["D / ↓", "a bad take"],
           ["A", "all belong: it and every member shown"], ["B", "a bad match"], ["X", "a near duplicate (of the member last heard)"], ["Y", "a new family"], ["→", "skip"]],
    onKey(e) {
      const k = e.key, mem = F.cur ? membersOf(F.cur) : [];
      if (k === " ") { e.preventDefault(); if (F.cur) F.playing && F.playing.id === F.cur.item ? stop() : play(F.cur.item); }
      else if ("qwert".includes(k.toLowerCase()) && k.length === 1 && mem["qwert".indexOf(k.toLowerCase())]) play(mem["qwert".indexOf(k.toLowerCase())]);
      else if (k === "1") setState("mellow");
      else if (k === "2") setState("intense");
      else if (k === "u" || k === "U" || k === "ArrowUp") { e.preventDefault(); answer("good"); }
      else if (k === "d" || k === "D" || k === "ArrowDown") { e.preventDefault(); answer("bad"); }
      else if (k === "a" || k === "A") answer("all");
      else if (k === "b" || k === "B") answer("mismatch");
      else if (k === "x" || k === "X") answer("dup");
      else if (k === "y" || k === "Y") answer("novel");
      else if (k === "ArrowRight") { e.preventDefault(); skip(); }
      else if (k === "Escape") stop();
    },
  });
})();
