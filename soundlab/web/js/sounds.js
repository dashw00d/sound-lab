// Sounds: every sound's takes, by prompt variant (rows) and seed (columns), beside the file shipped now.
(() => {
  const INFO = { el: "the project's own prompt (negatives removed)", core: "the description without the shared style tail",
                 tags: "tag-style caption", plain: "short plain sentence", vivid: "foley / engineer detail", alt: "a different source" };
  const P = { sounds: [], cur: 0, focus: 0, tiles: [], filter: "undecided", q: "", audition: false, loopLong: true };

  function build() {
    const by = Lab.byName();
    P.sounds = Object.entries(Lab.S.sounds).filter(([n, m]) => by[n] && m.kind !== "pool")
      .map(([name, m]) => ({ name, ...m, clips: by[name] }))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "oneshot" ? -1 : 1) || a.name.localeCompare(b.name));
  }
  const decided = s => Lab.V.picks[s.name] != null;
  const visible = () => P.sounds.filter(s => (P.filter === "all" || (P.filter === "undecided" && !decided(s)) ||
    (P.filter === "decided" && decided(s)) || s.kind === P.filter) && (!P.q || s.name.includes(P.q)));

  function show(arg) {
    build();
    if (!P.sounds.length) {
      Lab.view().innerHTML = `<div class="page"><div class="empty">No takes yet.<br><br>Make some with <code>soundlab sounds generate</code>.</div></div>`;
      return;
    }
    if (P.filter === "undecided" && !P.sounds.some(s => !decided(s))) P.filter = "all";  // (all decided: show them all)
    const want = arg ? P.sounds.findIndex(s => s.name === arg) : -1;
    if (want >= 0) P.cur = want;
    P.cur = Math.min(P.cur, P.sounds.length - 1);
    Lab.view().innerHTML = `<div class="split"><div class="list"><div class="head">
        <input type="search" id="sq" placeholder="Find a sound…" value="${Lab.esc(P.q)}">
        <div class="chips" id="sf"></div></div><div class="items" id="si"></div></div>
      <div class="page" id="sd"></div></div>`;
    document.getElementById("sq").oninput = e => { P.q = e.target.value.trim(); renderList(); };
    renderFilters(); renderList(); renderSound();
  }
  function renderFilters() {
    const el = document.getElementById("sf");
    el.innerHTML = ["undecided", "decided", "all", "oneshot", "loop"].map(f =>
      `<button class="chip ${f === P.filter ? "on" : ""}" data-f="${f}">${f === "oneshot" ? "one-shots" : f === "loop" ? "loops" : f}</button>`).join("");
    el.querySelectorAll("button").forEach(b => b.onclick = () => { P.filter = b.dataset.f; renderFilters(); renderList(); });
  }
  function renderList() {
    const el = document.getElementById("si");
    if (!el) return;
    el.innerHTML = "";
    for (const s of visible()) {
      const d = document.createElement("div"), pick = Lab.V.picks[s.name];
      d.className = "item" + (s === P.sounds[P.cur] ? " cur" : "") + (pick === "shipped" ? " keep" : pick ? " picked" : "");
      const ups = s.clips.filter(c => Lab.V.clips[c.id] === 1).length;
      d.innerHTML = `<span class="nm">${Lab.esc(s.name)}</span><span class="meta">${ups ? ups + "▲ " : ""}${s.kind === "loop" ? "loop" : ""}</span>`;
      d.onclick = () => go(P.sounds.indexOf(s));
      el.appendChild(d);
      if (s === P.sounds[P.cur]) requestAnimationFrame(() => d.scrollIntoView({ block: "nearest" }));
    }
  }
  function go(i) {
    Lab.stop(); P.audition = false;
    P.cur = (i + P.sounds.length) % P.sounds.length; P.focus = 0;
    Lab.setHash(P.sounds[P.cur].name);
    renderList(); renderSound();
  }
  function renderSound() {
    const s = P.sounds[P.cur], el = document.getElementById("sd"), pick = Lab.V.picks[s.name];
    el.innerHTML = `<div class="title"><h2>${Lab.esc(s.name)}</h2>
        <span class="chip">${s.kind === "loop" ? "loop" : "one-shot"}</span>${s.palette ? `<span class="chip">${Lab.esc(s.palette)}</span>` : ""}
        <span class="chip">${s.seconds} s · ${s.channels === 1 ? "mono" : "stereo"}</span>
        <span class="chip">${pick === "shipped" ? "keeping the shipped file" : pick ? "picked " + Lab.esc(pick.split(".").slice(1).join(".")) : "undecided"}</span></div>
      <div class="note">Every take is mastered (trimmed, levelled, EQ'd, loop-crossfaded) the way the shipped file is, so they compare fairly.</div>
      <div class="variant"><div class="label"><b>shipped</b><span>the file the game has now</span></div><div class="tiles" id="ship"></div></div>
      <div id="rows"></div>
      <h3>Notes</h3><textarea id="note" rows="2" placeholder="What's wrong, what to try next…">${Lab.esc(Lab.V.notes[s.name] || "")}</textarea>
      <div class="row"><button class="btn" id="keep">Keep the shipped file (0)</button><button class="btn" id="clear">Clear the decision</button></div>`;
    document.getElementById("note").onchange = e => Lab.vote({ sound: s.name, note: e.target.value });
    document.getElementById("keep").onclick = () => setPick("shipped");
    document.getElementById("clear").onclick = () => setPick(null);
    P.tiles = [];
    if (s.shipped) {
      const t = Lab.tile({ id: "shipped", url: Lab.shippedUrl(s.shipped) }, "shipped", "wide");
      t.onclick = () => play({ id: "shipped", url: Lab.shippedUrl(s.shipped) });
      document.getElementById("ship").appendChild(t);
    } else document.getElementById("ship").innerHTML = `<span class="dim">none</span>`;
    const prompts = Lab.S.prompts[s.name] || {}, rows = document.getElementById("rows");
    const ORDER = ["el", "core", "tags", "plain", "vivid", "alt"];  // (the standard variants first, then the rest)
    const rank = v => ORDER.includes(v) ? ORDER.indexOf(v) : ORDER.length + (v.includes("-") ? 1 : 0);
    for (const v of Object.keys(prompts).sort((a, b) => rank(a) - rank(b))) {
      const clips = s.clips.filter(c => c.variant === v).sort((a, b) => a.seed - b.seed);
      if (!clips.length) continue;
      const row = document.createElement("div");
      row.className = "variant";
      row.innerHTML = `<div class="label"><b title="${Lab.esc(INFO[v] || "")}">${Lab.esc(v)}</b><span>${Lab.esc(prompts[v])}</span></div><div class="tiles"></div>`;
      for (const c of clips) {
        c.url = Lab.clipUrl(c);
        const i = P.tiles.length, t = Lab.tile(c, `seed ${c.seed}`);
        if (!c.failed) { t.onclick = () => { P.focus = i; paint(); play(c); }; P.tiles.push(c); }
        c.el = t; row.querySelector(".tiles").appendChild(t);
      }
      rows.appendChild(row);
    }
    P.focus = Math.min(P.focus, P.tiles.length - 1);
    paint();
  }
  function paint() {
    const s = P.sounds[P.cur], pick = Lab.V.picks[s.name];
    document.querySelectorAll("#sd .tile").forEach(el => {
      const id = el.dataset.id;
      el.classList.toggle("focus", P.tiles[P.focus] && P.tiles[P.focus].id === id);
      el.classList.toggle("up", Lab.V.clips[id] === 1);
      el.classList.toggle("down", Lab.V.clips[id] === -1);
      el.classList.toggle("pick", pick === id);
    });
    const f = P.tiles[P.focus];
    if (f && f.el) f.el.scrollIntoView({ block: "nearest" });
  }
  function play(c) {
    const s = P.sounds[P.cur];
    Lab.play(c.url, { id: c.id, loop: P.loopLong && !P.audition && s.kind !== "oneshot",
      onEnd: () => { if (P.audition && P.focus < P.tiles.length - 1) { P.focus++; paint(); play(P.tiles[P.focus]); } else P.audition = false; } });
  }
  Lab.player.el.addEventListener("timeupdate", () => {
    if (Lab.tab === "sounds" && P.audition && Lab.player.el.currentTime > 12) { Lab.player.el.pause(); Lab.player.el.onended(); }
  });
  async function rate(v) {
    const c = P.tiles[P.focus];
    if (!c) return;
    await Lab.vote({ clip: c.id, value: Lab.V.clips[c.id] === v ? 0 : v });
    renderList();
    if (P.focus < P.tiles.length - 1) { P.focus++; paint(); play(P.tiles[P.focus]); } else paint();
  }
  async function setPick(id) {
    const s = P.sounds[P.cur];
    await Lab.vote({ sound: s.name, pick: Lab.V.picks[s.name] === id ? null : id });
    renderList(); renderSound();
  }
  function moveRow(dir) {
    const row = i => P.tiles[i] && P.tiles[i].variant;
    let i = P.focus;
    const r = row(i);
    while (i >= 0 && i < P.tiles.length && row(i) === r) i += dir;
    if (i < 0 || i >= P.tiles.length) return;
    if (dir < 0) { const r2 = row(i); while (i > 0 && row(i - 1) === r2) i--; }
    P.focus = i; paint();
  }

  Lab.register("sounds", {
    title: "Sounds",
    show,
    keys: [["Space", "play or stop the selected take"], ["←", "previous take"], ["→", "next take"], ["↑", "previous prompt row"],
           ["↓", "next prompt row"], ["U", "thumbs up, then play the next take"], ["D", "thumbs down, then play the next take"],
           ["Enter", "pick the selected take"], ["0", "keep the shipped file"], ["S", "play the shipped file"],
           ["A", "audition every take in order"], ["N", "next sound"], ["B", "previous sound"], ["Shift N", "next undecided sound"],
           ["L", "loop loops on or off"], ["Esc", "stop"]],
    onKey(e) {
      if (!P.sounds.length) return;
      const k = e.key;
      if (k === " ") { e.preventDefault(); Lab.player.current && Lab.player.current === P.tiles[P.focus]?.id ? Lab.stop() : P.tiles[P.focus] && play(P.tiles[P.focus]); }
      else if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); P.focus = Math.max(0, Math.min(P.tiles.length - 1, P.focus + (k === "ArrowRight" ? 1 : -1))); paint(); if (Lab.player.current) play(P.tiles[P.focus]); }
      else if (k === "ArrowDown") { e.preventDefault(); moveRow(1); }
      else if (k === "ArrowUp") { e.preventDefault(); moveRow(-1); }
      else if (k === "u" || k === "+" || k === "=") rate(1);
      else if (k === "d" || k === "-") rate(-1);
      else if (k === "Enter") { const c = P.tiles[P.focus]; if (c) setPick(c.id); }
      else if (k === "0") setPick("shipped");
      else if (k === "s") { const s = P.sounds[P.cur]; if (s.shipped) play({ id: "shipped", url: Lab.shippedUrl(s.shipped) }); }
      else if (k === "a") { P.audition = true; if (P.tiles[P.focus]) play(P.tiles[P.focus]); }
      else if (k === "Escape") { P.audition = false; Lab.stop(); }
      else if (k === "N") { const v = P.sounds.findIndex((s, i) => i > P.cur && !decided(s)); go(v >= 0 ? v : P.sounds.findIndex(s => !decided(s))); }
      else if (k === "n" || k === "]") go(P.cur + 1);
      else if (k === "b" || k === "[") go(P.cur - 1);
      else if (k === "l") { P.loopLong = !P.loopLong; Lab.player.el.loop = P.loopLong && P.sounds[P.cur].kind !== "oneshot"; Lab.toast(`looping ${P.loopLong ? "on" : "off"}`); }
    },
  });
})();
