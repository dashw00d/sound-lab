// Sounds: every sound's takes, by prompt variant (rows) and seed (columns), beside the file shipped now.
(() => {
  const INFO = { el: "the project's own prompt (negatives removed)", core: "the description without the shared style tail",
                 tags: "tag-style caption", plain: "short plain sentence", vivid: "foley / engineer detail", alt: "a different source" };
  const ORDER = ["el", "core", "tags", "plain", "vivid", "alt"];  // (the standard variants first, then the rest)
  const P = { sounds: [], cur: 0, focus: -1, tiles: [], status: "todo", kind: "all", q: "", audition: false, loopLong: true, first: true, keepId: null };
  const { icon, esc } = Lab, $ = id => document.getElementById(id);

  function build() {
    const by = Lab.byName();
    P.sounds = Object.entries(Lab.S.sounds).filter(([n, m]) => by[n] && m.kind !== "pool")
      .map(([name, m]) => ({ name, ...m, clips: by[name] }))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "oneshot" ? -1 : 1) || a.name.localeCompare(b.name));
  }
  const decided = s => Lab.V.picks[s.name] != null;
  const unshipped = s => { const p = Lab.V.picks[s.name]; return !!p && p !== "shipped" && Lab.shipped[s.name] !== p; };
  const cur = () => P.sounds[P.cur];
  const matches = s => (P.status === "all" || (P.status === "todo") === !decided(s)) && (P.kind === "all" || s.kind === P.kind) &&
    (!P.q || s.name.toLowerCase().includes(P.q.toLowerCase()));
  const visible = () => P.sounds.filter(matches);
  const takeName = c => c.id === "shipped" ? "the shipped file" : `${c.variant} · seed ${c.seed}`;

  function show(arg) {
    build();
    if (!P.sounds.length) { Lab.showEmpty("wave", "No takes yet", `<p>Make some with <code>soundlab sounds generate</code>.</p>`); return; }
    if (P.first) { P.first = false; if (!P.sounds.some(s => !decided(s))) P.status = "all"; }
    const want = arg ? P.sounds.findIndex(s => s.name === arg) : -1;
    if (want >= 0 && want !== P.cur) { P.cur = want; P.focus = -1; P.keepId = null; }
    P.cur = Lab.clamp(P.cur, 0, P.sounds.length - 1);
    if (!matches(cur())) { P.status = "all"; P.kind = "all"; P.q = ""; }  // (jumped to a sound the filters hide)
    Lab.view().innerHTML = `<div class="split"><aside class="side"><div class="head">
        <div class="tally"><span>Decided</span><span id="stally"></span></div><div class="progress"><div id="sprog"></div></div>
        <div class="search">${icon("search")}<input type="search" id="sq" placeholder="Filter sounds" value="${esc(P.q)}"></div>
        <div class="filters" id="sf"></div></div><div class="items" id="si"></div></aside>
      <div class="page" id="sd"></div></div>`;
    $("sq").oninput = e => { P.q = e.target.value.trim(); renderList(); };
    $("sq").onkeydown = e => { if (e.key === "Enter") { const v = visible(); if (v.length) { go(P.sounds.indexOf(v[0])); e.target.blur(); } } };
    renderFilters(); renderList(); renderSound();
  }
  function refresh() {
    if (!P.sounds.length || !$("sd")) { show(); return; }
    const name = cur().name;
    build();
    P.cur = Math.max(0, P.sounds.findIndex(s => s.name === name));
    P.keepId = P.tiles[P.focus] ? P.tiles[P.focus].id : null;
    renderList(); renderSound();
  }
  function renderFilters() {
    const el = $("sf");
    el.innerHTML = Lab.seg([["todo", "To do"], ["done", "Done"], ["all", "All"]], P.status, "st") +
                   Lab.seg([["all", "Every kind"], ["oneshot", "One-shots"], ["loop", "Loops"]], P.kind, "kd");
    el.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { P.status = b.dataset.st; renderFilters(); renderList(); });
    el.querySelectorAll("[data-kd]").forEach(b => b.onclick = () => { P.kind = b.dataset.kd; renderFilters(); renderList(); });
  }
  function renderList() {
    const el = $("si");
    if (!el) return;
    const vis = visible(), s0 = cur(), n = P.sounds.filter(decided).length;
    $("stally").innerHTML = `<b>${n}</b> / ${P.sounds.length}`;
    $("sprog").style.width = `${100 * n / P.sounds.length}%`;
    let html = "", last = null;
    for (const s of vis) {
      if (P.kind === "all" && s.kind !== last) {
        html += `<div class="group"><span>${s.kind === "loop" ? "Loops" : "One-shots"}</span><span>${vis.filter(x => x.kind === s.kind).length}</span></div>`;
        last = s.kind;
      }
      const pick = Lab.V.picks[s.name], ups = s.clips.filter(c => Lab.V.clips[c.id] === 1).length, note = Lab.V.notes[s.name];
      html += `<div class="item ${s === s0 ? "cur" : ""} ${pick === "shipped" ? "keep" : pick ? "picked" : ""}" data-n="${esc(s.name)}">
        <span class="st">${pick === "shipped" ? icon("keep") : pick ? icon("starFill") : `<span class="ring0"></span>`}</span>
        <span class="nm">${esc(s.name)}</span><span class="meta">
        ${note ? `<span class="note" data-tip="${esc(note)}">${icon("pen")}</span>` : ""}${ups ? `<span class="up" data-tip="${ups} thumbs up">${ups}</span>` : ""}
        ${unshipped(s) ? `<span class="unshipped" data-tip="Picked, not shipped into the game yet"></span>` : ""}</span></div>`;
    }
    el.innerHTML = html || `<div class="none">No sounds match.</div>`;
    el.querySelectorAll(".item").forEach(d => d.onclick = () => go(P.sounds.findIndex(s => s.name === d.dataset.n)));
    const c = el.querySelector(".item.cur");
    if (c) c.scrollIntoView({ block: "nearest" });
  }
  function go(i) {
    if (i < 0) return;
    Lab.stop(); P.audition = false;
    P.cur = (i + P.sounds.length) % P.sounds.length; P.focus = -1; P.keepId = null;
    Lab.setHash(cur().name);
    renderList(); renderSound();
    $("sd").scrollTop = 0;
  }
  function step(dir) {  // the next or previous sound in the list as filtered
    const vis = visible();
    if (!vis.length) return;
    const i = vis.indexOf(cur());
    go(P.sounds.indexOf(vis[i < 0 ? 0 : (i + dir + vis.length) % vis.length]));
  }
  const fmtPrompt = t => esc(t || "").replace(/\b([A-Z][A-Za-z]+): /g, `<span class="tag">$1:</span> `);

  function renderSound() {
    const s = cur(), el = $("sd"), pick = Lab.V.picks[s.name];
    const silent = s.clips.filter(c => c.failed).length, pc = pick && pick !== "shipped" ? Lab.S.clips[pick] : null;
    const decision = pick === "shipped" ? `<span class="pill keep">${icon("keep")}Keeping the shipped file</span>`
      : pick ? `<span class="pill pick">${icon("starFill")}Picked ${esc(pc ? `${pc.variant} · seed ${pc.seed}` : pick)}</span>` +
               (unshipped(s) ? `<span class="pill accent" data-tip="The game still has the previous file. Ask for a promote to ship this pick.">Not shipped yet</span>` : "")
      : `<span class="pill todo">Undecided</span>`;
    el.innerHTML = `<div class="shead"><div>
        <div class="eyebrow">${s.kind === "loop" ? "Loop" : "One-shot"}${s.palette ? ` · ${esc(s.palette)}` : ""}</div>
        <h1>${esc(s.name)}</h1>
        <div class="meta"><span class="chip">${s.seconds} s</span><span class="chip">${s.channels === 1 ? "mono" : "stereo"}</span>
          <span class="chip">${s.clips.length} takes${silent ? ` · ${silent} silent` : ""}</span></div></div>
      <div class="actions">${decision}
        <button class="btn" id="keep" data-tip="Keep the file the game has now (0)">${icon("keep")}Keep shipped</button>
        ${pick ? `<button class="btn ghost" id="clear" data-tip="Clear the decision">Clear</button>` : ""}
        <span class="nav"><button class="iconbtn" id="prev" data-tip="Previous sound (B)">${icon("left")}</button>
          <button class="iconbtn" id="next" data-tip="Next sound (N) · next undecided (Shift N)">${icon("right")}</button></span></div></div>
      <div class="notebox ${Lab.V.notes[s.name] ? "has" : ""}">${icon("pen")}<textarea id="note" rows="1"
        placeholder="Notes for the next round: what's wrong, what to try…">${esc(Lab.V.notes[s.name] || "")}</textarea><span class="saved">${icon("check")}saved</span></div>
      <div class="toolbar"><span class="count" id="tcount"></span>
        <button class="btn ${P.audition ? "on" : ""}" id="aud" data-tip="Play every take in order, from the selected one (A)">${icon("headphones")}Audition all</button>
        ${s.kind !== "oneshot" ? `<button class="btn ${P.loopLong ? "on" : ""}" id="lp" data-tip="Loop the loops (L)">${icon("loop")}Loop</button>` : ""}
        <button class="btn ${Lab.prefs.hideDown ? "on" : ""}" id="hd" data-tip="Hide thumbed-down takes (H)">${icon(Lab.prefs.hideDown ? "eyeoff" : "eye")}Hide ${icon("down")}</button></div>
      <div id="rows"></div>`;
    Lab.wireNote($("note"), s.name, renderList);
    $("keep").onclick = () => setPick("shipped");
    if ($("clear")) $("clear").onclick = () => setPick(null);
    $("prev").onclick = () => step(-1); $("next").onclick = () => step(1);
    $("aud").onclick = () => audition();
    if ($("lp")) $("lp").onclick = () => toggleLoop();
    $("hd").onclick = () => toggleHide();

    P.tiles = [];
    const rows = $("rows");
    if (s.shipped) rows.appendChild(row("shipped", "the file the game has now", [{ id: "shipped", variant: "shipped", url: Lab.shippedUrl(s.shipped) }], true));
    const prompts = Lab.S.prompts[s.name] || {};
    const rank = v => ORDER.includes(v) ? ORDER.indexOf(v) : ORDER.length + (v.includes("-") ? 1 : 0);
    for (const v of Object.keys(prompts).sort((a, b) => rank(a) - rank(b))) {
      const clips = s.clips.filter(c => c.variant === v).sort((a, b) => a.seed - b.seed);
      if (clips.length) rows.appendChild(row(v, prompts[v], clips, false));
    }
    const keep = P.keepId ? P.tiles.findIndex(t => t.id === P.keepId) : -1;
    P.focus = keep >= 0 ? keep : P.focus >= 0 ? Lab.clamp(P.focus, 0, P.tiles.length - 1) : Math.min(s.shipped ? 1 : 0, P.tiles.length - 1);
    P.keepId = null;
    paint();
    Lab.repaintPlaying();
  }
  function row(v, prompt, clips, ship) {
    const sec = document.createElement("section");
    sec.className = "variant";
    const ups = clips.filter(c => Lab.V.clips[c.id] === 1).length, downs = clips.filter(c => Lab.V.clips[c.id] === -1).length;
    sec.innerHTML = `<div class="vhead"><span class="vname ${ship ? "ship" : ""}" ${INFO[v] ? `data-tip="${esc(INFO[v])}"` : ""}>${esc(v)}</span>
      <p class="vprompt" ${ship ? "" : `data-tip="Click to expand"`}>${fmtPrompt(prompt)}</p>
      <span class="vtools">${ship ? "" : `<span class="stat">${ups ? `<span class="up">${ups} up</span>` : ""}${downs ? `<span class="down">${downs} down</span>` : ""}</span>
        <button class="iconbtn" data-tip="Copy the prompt">${icon("copy")}</button>`}</span></div><div class="tiles"></div>`;
    const p = sec.querySelector(".vprompt");
    if (!ship) {
      p.onclick = () => { if (!p.classList.contains("whole")) { p.classList.toggle("open"); p.removeAttribute("data-tip"); } };
      requestAnimationFrame(() => { if (p.scrollHeight <= p.clientHeight + 2) { p.classList.add("whole"); p.removeAttribute("data-tip"); } });
    }
    const cp = sec.querySelector(".vtools .iconbtn");
    if (cp) cp.onclick = () => navigator.clipboard.writeText(prompt).then(() => Lab.toast("Prompt copied", { icon: "copy" }), () => Lab.toast("Couldn't copy"));
    const grid = sec.querySelector(".tiles");
    let hidden = 0;
    for (const c of clips) {
      if (!ship) c.url = Lab.clipUrl(c);
      const hide = !ship && Lab.prefs.hideDown && Lab.V.clips[c.id] === -1;
      const t = Lab.tile(c, ship ? "shipped now" : `seed ${c.seed}`, ship ? "wide ship" : "");
      if (hide) { t.classList.add("hide"); hidden++; }
      if (!c.failed && !hide) {
        const i = P.tiles.length;
        P.tiles.push(c);
        t.onclick = () => { P.audition = false; P.focus = i; paint(); play(c); };
      }
      c.el = t; grid.appendChild(t);
    }
    if (hidden) grid.insertAdjacentHTML("beforeend", `<span class="hiddenmsg">${hidden} hidden</span>`);
    return sec;
  }
  function paint(scroll = true) {
    const s = cur(), pick = Lab.V.picks[s.name], f = P.tiles[P.focus];
    document.querySelectorAll("#sd .tile").forEach(el => {
      const id = el.dataset.id;
      Lab.tileState(el, { focus: f && f.id === id, up: Lab.V.clips[id] === 1, down: Lab.V.clips[id] === -1, pick: id === "shipped" ? pick === "shipped" : pick === id });
    });
    if (f && f.el && scroll) f.el.scrollIntoView({ block: "nearest" });
    const n = P.tiles.filter(t => t.id !== "shipped").length, k = f && f.id !== "shipped" ? P.tiles.filter(t => t.id !== "shipped").indexOf(f) + 1 : 0;
    const tc = $("tcount");
    if (tc) tc.innerHTML = k ? `Take <b>${k}</b> of ${n}` : f ? `The shipped file · ${n} takes` : `${n} takes`;
    Lab.inspect(f ? dockItem(f) : null);
  }
  function dockItem(c) {
    const s = cur(), pick = Lab.V.picks[s.name], v = Lab.V.clips[c.id];
    if (c.id === "shipped") return { id: "shipped", url: c.url, title: s.name, sub: "Shipped now · the file the game has", pick: pick === "shipped",
      play: f => play(c, f), actions: [{ icon: "keep", label: pick === "shipped" ? "Keeping it" : "Keep it", cls: "pick", on: pick === "shipped", run: () => setPick("shipped"), tip: "Keep the shipped file (0 or Enter)" }] };
    const m = c.metrics || {};
    return {
      id: c.id, url: c.url, title: s.name, sub: `${c.variant} · seed ${c.seed}${c.gen_s ? ` · made in ${c.gen_s}s` : ""}`, pick: pick === c.id,
      facts: [m.peak_db != null && `peak ${m.peak_db} dB`, m.rms_db != null && `rms ${m.rms_db} dB`, m.crest_db != null && `crest ${m.crest_db} dB`].filter(Boolean).join(" · "),
      play: f => play(c, f),
      actions: [
        { icon: "up", cls: "good", on: v === 1, run: () => rate(1, c, false), tip: "Thumbs up (U)" },
        { icon: "down", cls: "bad", on: v === -1, run: () => rate(-1, c, false), tip: "Thumbs down (D)" },
        { icon: pick === c.id ? "starFill" : "star", label: pick === c.id ? "Picked" : "Pick", cls: "pick", on: pick === c.id, run: () => setPick(c.id), tip: "Pick this take (Enter)" },
        s.shipped && { icon: "ab", run: ab, tip: "A/B: jump between this take and the shipped file at the same moment (X)" },
      ].filter(Boolean),
    };
  }
  function play(c, from = 0) {
    const s = cur();
    Lab.play(c.url, { id: c.id, from, loop: P.loopLong && !P.audition && s.kind !== "oneshot",
      onEnd: () => {
        if (P.audition && P.focus < P.tiles.length - 1) { P.focus++; paint(); play(P.tiles[P.focus]); }
        else if (P.audition) { P.audition = false; syncTools(); }
      } });
  }
  Lab.player.el.addEventListener("timeupdate", () => {  // (an audition moves on after 12 s of a long take)
    if (Lab.tab === "sounds" && P.audition && Lab.player.el.currentTime > 12) Lab.endNow();
  });
  function syncTools() { const a = $("aud"); if (a) a.classList.toggle("on", P.audition); }
  function audition() {
    if (P.audition) { P.audition = false; Lab.stop(); syncTools(); return; }
    P.audition = true; syncTools();
    if (P.tiles[P.focus]) play(P.tiles[P.focus]);
  }
  function toggleLoop() {
    P.loopLong = !P.loopLong;
    Lab.player.el.loop = P.loopLong && cur().kind !== "oneshot" && !Lab.player.region;
    const b = $("lp"); if (b) b.classList.toggle("on", P.loopLong);
    Lab.toast(`Looping ${P.loopLong ? "on" : "off"}`, { icon: "loop" });
  }
  function toggleHide() {
    Lab.prefs.hideDown = !Lab.prefs.hideDown; Lab.savePrefs();
    P.keepId = P.tiles[P.focus] ? P.tiles[P.focus].id : null;
    renderSound();
  }
  // A/B: the same moment in the other file (the shipped one, or back to the selected take).
  function ab() {
    const s = cur(), el = Lab.player.el;
    if (!s.shipped) return;
    const t = Lab.player.current ? el.currentTime : 0, take = P.tiles[P.focus] && P.tiles[P.focus].id !== "shipped" ? P.tiles[P.focus] : P.tiles.find(x => x.id !== "shipped");
    if (Lab.player.current === "shipped") { if (take) play(take, t); Lab.toast(`A · ${take ? takeName(take) : ""}`, { icon: "ab" }); }
    else { play({ id: "shipped", url: Lab.shippedUrl(s.shipped) }, t); Lab.toast("B · the shipped file", { icon: "ab" }); }
  }
  async function rate(v, c = P.tiles[P.focus], advance = true) {
    if (!c || c.id === "shipped") return;
    const now = Lab.V.clips[c.id] === v ? 0 : v;
    await Lab.vote({ clip: c.id, value: now }, { label: `${now === 1 ? "Thumbs up" : now === -1 ? "Thumbs down" : "Vote cleared"} · ${takeName(c)}`, icon: now === -1 ? "down" : now ? "up" : "x" });
    renderList();
    const next = advance ? P.tiles[P.focus + 1] : null;
    if (Lab.prefs.hideDown && now === -1) { P.keepId = (next || P.tiles[P.focus - 1] || {}).id; renderSound(); }
    else if (next) { P.focus++; paint(); }
    else paint(false);
    if (next) play(next);
  }
  async function setPick(id) {
    const s = cur(), now = id && Lab.V.picks[s.name] === id ? null : id, c = Lab.S.clips[now];
    await Lab.vote({ sound: s.name, pick: now }, { label: now === null ? `Decision cleared · ${s.name}` : now === "shipped" ? `Keeping the shipped ${s.name}` : `Picked ${c ? takeName(c) : now} for ${s.name}`, icon: now ? "starFill" : "x" });
    P.keepId = P.tiles[P.focus] ? P.tiles[P.focus].id : null;
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
    title: "Sounds", icon: "wave", show, refresh,
    count() {
      const by = new Set(Object.values(Lab.S.clips).map(c => c.name));
      return Object.entries(Lab.S.sounds).filter(([n, m]) => m.kind !== "pool" && by.has(n) && Lab.V.picks[n] == null).length || "";
    },
    keys: [["Space", "play or stop the selected take"], ["← →", "previous / next take"], ["↑ ↓", "previous / next prompt row"],
           ["U", "thumbs up, then play the next take"], ["D", "thumbs down, then play the next take"], ["Enter", "pick the selected take"],
           ["0", "keep the shipped file"], ["S", "play the shipped file"], ["X", "A/B the take and the shipped file"], ["A", "audition every take in order"],
           ["N", "next sound"], ["B", "previous sound"], ["Shift N", "next undecided sound"], ["H", "hide thumbed-down takes"], ["L", "loop loops on or off"], ["Esc", "stop"]],
    onKey(e) {
      if (!P.sounds.length || !$("sd")) return;
      const k = e.key, f = P.tiles[P.focus];
      if (k === " ") { e.preventDefault(); if (Lab.player.current) { P.audition = false; syncTools(); Lab.stop(); } else if (f) play(f); }
      else if (k === "ArrowRight" || k === "ArrowLeft") {
        e.preventDefault();
        P.focus = Lab.clamp(P.focus + (k === "ArrowRight" ? 1 : -1), 0, P.tiles.length - 1); paint();
        if (Lab.player.current) { P.audition = false; syncTools(); play(P.tiles[P.focus]); }
      }
      else if (k === "ArrowDown") { e.preventDefault(); moveRow(1); }
      else if (k === "ArrowUp") { e.preventDefault(); moveRow(-1); }
      else if (k === "u" || k === "+" || k === "=") rate(1);
      else if (k === "d" || k === "-") rate(-1);
      else if (k === "Enter") { if (f) setPick(f.id); }
      else if (k === "0") setPick("shipped");
      else if (k === "s") { const s = cur(); if (s.shipped) play({ id: "shipped", url: Lab.shippedUrl(s.shipped) }); }
      else if (k === "x") ab();
      else if (k === "a") audition();
      else if (k === "h") toggleHide();
      else if (k === "Escape") { P.audition = false; syncTools(); Lab.stop(); }
      else if (k === "N") { const v = P.sounds.findIndex((s, i) => i > P.cur && !decided(s)); go(v >= 0 ? v : P.sounds.findIndex(s => !decided(s))); }
      else if (k === "n" || k === "]") step(1);
      else if (k === "b" || k === "[") step(-1);
      else if (k === "l") toggleLoop();
    },
  });
})();
