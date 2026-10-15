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
  const matches = s => (P.status === "all" || (P.status === "notes" ? noteList(s).length > 0 : (P.status === "todo") === !decided(s))) &&
    (P.kind === "all" || s.kind === P.kind) &&
    (!P.q || s.name.toLowerCase().includes(P.q.toLowerCase()));
  const visible = () => P.sounds.filter(matches);
  const takeName = c => c.id === "shipped" ? "the shipped file" : `${c.variant} · take ${c.seed + 1}`;
  // Notes: on a prompt (stays with that prompt: new variants start clean), or on the whole sound.
  const pnotes = name => (Lab.V.prompt_notes || {})[name] || {};
  const promptOf = (name, v) => (Lab.S.prompts[name] || {})[v] || "";
  const noteList = s => [...(Lab.V.notes[s.name] ? [{ v: null, text: Lab.V.notes[s.name] }] : []),
                          ...Object.entries(pnotes(s.name)).map(([v, n]) => ({ v, text: n.text }))];
  const notesOf = s => [...(Lab.V.notes[s.name] ? [`The whole sound: ${Lab.V.notes[s.name]}`] : []),
                        ...Object.entries(pnotes(s.name)).map(([v, n]) => `${v}: ${n.text}`)];

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
    renderFilters(); renderList(); renderSound();  // (the filters too: the Notes count changes with a note)
  }
  function renderFilters() {
    const el = $("sf");
    const noted = P.sounds.filter(x => noteList(x).length).length;
    el.innerHTML = Lab.seg([["todo", "To do"], ["done", "Done"], ["notes", `Notes${noted ? ` <small>${noted}</small>` : ""}`, false, "Every sound with an open note, and what it says"], ["all", "All"]], P.status, "st") +
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
      const pick = Lab.V.picks[s.name], ups = s.clips.filter(c => Lab.V.clips[c.id] === 1).length, notes = notesOf(s);
      html += `<div class="item ${s === s0 ? "cur" : ""} ${pick === "shipped" ? "keep" : pick ? "picked" : ""}" data-n="${esc(s.name)}">
        <span class="st">${pick === "shipped" ? icon("keep") : pick ? icon("starFill") : `<span class="ring0"></span>`}</span>
        <span class="nm">${esc(s.name)}</span><span class="meta">
        ${notes.length ? `<span class="note" data-tip="${esc(notes.join("\n"))}">${icon("pen")}${notes.length > 1 ? notes.length : ""}</span>` : ""}${ups ? `<span class="up" data-tip="${ups} thumbs up">${ups}</span>` : ""}
        ${unshipped(s) ? `<span class="unshipped" data-tip="Picked, not shipped into the game yet"></span>` : ""}</span>
        ${P.status === "notes" ? `<span class="nlist">${noteList(s).map(n => `<span class="nl" data-v="${esc(n.v || "")}"><b>${esc(n.v || "whole sound")}</b>${esc(n.text)}</span>`).join("")}</span>` : ""}</div>`;
    }
    el.innerHTML = html || `<div class="none">No sounds match.</div>`;
    el.querySelectorAll(".item").forEach(d => d.onclick = e => {
      const nl = e.target.closest(".nl"), i = P.sounds.findIndex(s => s.name === d.dataset.n);
      if (i !== P.cur || !$("sd").childElementCount) go(i);
      if (nl) showRow(nl.dataset.v);  // (a note in the list: to the prompt it's about)
    });
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
  function showRow(v) {
    const el = v ? [...document.querySelectorAll("#sd .variant")].find(r => r.querySelector(".vname").textContent === v) : document.querySelector("#sd .pnote.sound");
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const n = el.classList.contains("pnote") ? el : el.querySelector(".pnote");
    if (n) { n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash"); }
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
      : pick ? `<span class="pill pick">${icon("starFill")}Picked ${esc(pc ? takeName(pc) : pick)}</span>` +
               (unshipped(s) ? `<span class="pill accent" data-tip="The game still has the previous file. Ask for a promote to ship this pick.">Not shipped yet</span>` : "")
      : `<span class="pill todo">Undecided</span>`;
    el.innerHTML = `<div class="shead"><div>
        <div class="eyebrow">${s.kind === "loop" ? "Loop" : "One-shot"}${s.palette ? ` · ${esc(s.palette)}` : ""}</div>
        <h1>${esc(s.name)}</h1>
        <div class="meta"><span class="chip">${s.seconds} s</span><span class="chip">${s.channels === 1 ? "mono" : "stereo"}</span>
          <span class="chip">${s.clips.length - silent} takes${silent ? ` · ${silent} silent` : ""}</span></div></div>
      <div class="actions">${decision}
        <button class="btn" id="keep" data-tip="Keep the file the game has now (0)">${icon("keep")}Keep shipped</button>
        ${pick ? `<button class="btn ghost" id="clear" data-tip="Clear the decision">Clear</button>` : ""}
        ${Lab.V.notes[s.name] ? "" : `<button class="btn ghost" id="snote" data-tip="A note on the whole sound. A note on a prompt (C) stays with that prompt, so it's usually clearer.">${icon("pen")}Note</button>`}
        <span class="nav"><button class="iconbtn" id="prev" data-tip="Previous sound (B)">${icon("left")}</button>
          <button class="iconbtn" id="next" data-tip="Next sound (N) · next undecided (Shift N)">${icon("right")}</button></span></div></div>
      ${Lab.V.notes[s.name] ? callout(Lab.V.notes[s.name], "On the whole sound", "", "sound") : ""}
      <div class="toolbar"><span class="count" id="tcount"></span>
        <button class="btn ${P.audition ? "on" : ""}" id="aud" data-tip="Play every take in order, from the selected one (A)">${icon("headphones")}Audition all</button>
        ${s.kind !== "oneshot" ? `<button class="btn ${P.loopLong ? "on" : ""}" id="lp" data-tip="Loop the loops (L)">${icon("loop")}Loop</button>` : ""}
        <button class="btn ${Lab.prefs.hideDown ? "on" : ""}" id="hd" data-tip="Hide thumbed-down takes (H)">${icon(Lab.prefs.hideDown ? "eyeoff" : "eye")}Hide ${icon("down")}</button></div>
      <div id="rows"></div>`;
    if ($("snote")) $("snote").onclick = () => editSoundNote($("snote"));
    const sn = el.querySelector(".pnote.sound");
    if (sn) wireCallout(sn, () => editSoundNote(sn), () => saveSoundNote(""));
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
    const shown = new Set();
    for (const v of Object.keys(prompts).sort((a, b) => rank(a) - rank(b))) {
      const clips = s.clips.filter(c => c.variant === v).sort((a, b) => a.seed - b.seed);
      if (clips.length) { rows.appendChild(row(v, prompts[v], clips, false)); shown.add(v); }
    }
    for (const [v, n] of Object.entries(pnotes(s.name))) if (!shown.has(v)) rows.appendChild(orphanRow(v, n));  // (a note whose prompt has no takes)
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
    const n = ship ? null : pnotes(cur().name)[v], stale = n && n.prompt && n.prompt !== prompt;
    sec.innerHTML = `<div class="vhead"><span class="vname ${ship ? "ship" : ""}" ${INFO[v] ? `data-tip="${esc(INFO[v])}"` : ""}>${esc(v)}</span>
      <p class="vprompt" ${ship ? "" : `data-tip="Click to expand"`}>${fmtPrompt(prompt)}</p>
      <span class="vtools">${ship ? "" : `<span class="stat">${ups ? `<span class="up">${ups} up</span>` : ""}${downs ? `<span class="down">${downs} down</span>` : ""}</span>
        <button class="iconbtn ${n ? "noted" : ""}" data-note data-tip="${n ? "Edit the note on this prompt (C)" : "A note on this prompt's takes (C)"}">${icon("pen")}</button>
        <button class="iconbtn" data-copy data-tip="Copy the prompt">${icon("copy")}</button>`}</span></div>
      ${n ? callout(n.text, Lab.when(n.at), stale ? n.prompt : "") : ""}<div class="tiles"></div>`;
    const p = sec.querySelector(".vprompt");
    if (!ship) {
      p.onclick = () => { if (!p.classList.contains("whole")) { p.classList.toggle("open"); p.removeAttribute("data-tip"); } };
      requestAnimationFrame(() => { if (p.scrollHeight <= p.clientHeight + 2) { p.classList.add("whole"); p.removeAttribute("data-tip"); } });
    }
    const nb = sec.querySelector("[data-note]"), pn = sec.querySelector(".pnote");
    if (nb) nb.onclick = () => editPromptNote(v, nb);
    if (pn) wireCallout(pn, () => editPromptNote(v, pn), () => savePromptNote(v, ""));
    const cp = sec.querySelector("[data-copy]");
    if (cp) cp.onclick = () => navigator.clipboard.writeText(prompt).then(() => Lab.toast("Prompt copied", { icon: "copy" }), () => Lab.toast("Couldn't copy"));
    const grid = sec.querySelector(".tiles");
    let hidden = 0;
    for (const c of clips) {
      if (!ship) c.url = Lab.clipUrl(c);
      const hide = !ship && Lab.prefs.hideDown && Lab.V.clips[c.id] === -1;
      const t = Lab.tile(c, ship ? "shipped now" : `take ${c.seed + 1}`, ship ? "wide ship" : "");
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
  // A prompt note with no row of takes (the prompt has none, or it was removed): the note still shows, to edit or resolve.
  function orphanRow(v, n) {
    const sec = document.createElement("section"), prompt = promptOf(cur().name, v) || n.prompt;
    sec.className = "variant";
    sec.innerHTML = `<div class="vhead"><span class="vname">${esc(v)}</span><p class="vprompt whole">${fmtPrompt(prompt)}</p></div>
      ${callout(n.text, `${Lab.when(n.at)} · no takes on this prompt`, "")}`;
    wireCallout(sec.querySelector(".pnote"), () => editPromptNote(v, sec.querySelector(".pnote")), () => savePromptNote(v, ""));
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
      play: f => play(c, f), actions: [{ icon: "keep", label: pick === "shipped" ? "Keeping it" : "Keep it", cls: "pick", on: pick === "shipped", run: () => setPick("shipped"), tip: "Keep the shipped file (0 or Enter)" }],
      note: { has: !!Lab.V.notes[s.name], tip: "A note on the whole sound (C)", open: a => editSoundNote(a, "above") } };
    const m = c.metrics || {};
    return {
      id: c.id, url: c.url, title: s.name, sub: `${c.variant} · take ${c.seed + 1}${c.gen_s ? ` · made in ${c.gen_s}s` : ""}`, pick: pick === c.id,
      facts: [m.peak_db != null && `peak ${(+m.peak_db).toFixed(1)}`, m.rms_db != null && `rms ${(+m.rms_db).toFixed(1)}`, m.crest_db != null && `crest ${(+m.crest_db).toFixed(1)} dB`].filter(Boolean).join(" · "),
      play: f => play(c, f),
      note: { has: !!pnotes(s.name)[c.variant], tip: `${pnotes(s.name)[c.variant] ? "Edit the note" : "A note"} on the ${c.variant} prompt (C)`, open: a => editPromptNote(c.variant, a, "above") },
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
    if (cur().kind === "oneshot") { Lab.toast("One-shots don't loop", { icon: "loop" }); return; }
    P.loopLong = !P.loopLong;
    const pl = Lab.player, want = P.loopLong && !P.audition;
    pl.loopWanted = want;  // (what the player goes back to when an A-B region is cleared)
    pl.el.loop = want && !(pl.region && pl.region.id === pl.current);
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
  const pending = {};  // clip id -> the vote on its way (Lab.V is stale until it lands, so a quick second press toggles from this)
  async function rate(v, c = P.tiles[P.focus], advance = true) {
    if (!c || c.id === "shipped") return;
    const q = pending[c.id] || (pending[c.id] = { n: 0, value: Lab.V.clips[c.id] || 0 });
    const now = q.value === v ? 0 : v, i = P.tiles.indexOf(c), next = advance ? P.tiles[i + 1] : null;
    const hide = Lab.prefs.hideDown && now === -1, moved = !!next && !hide;
    q.value = now; q.n++;
    if (moved) { P.focus = i + 1; paint(); play(next); }  // (move on at once: a quick next press rates the next take)
    try {
      await Lab.vote({ clip: c.id, value: now }, { label: `${now === 1 ? "Thumbs up" : now === -1 ? "Thumbs down" : "Vote cleared"} · ${takeName(c)}`, icon: now === -1 ? "down" : now ? "up" : "x" });
    } catch {  // (Lab.vote already said so) back to the take that wasn't rated
      if (moved && Lab.tab === "sounds" && $("sd") && P.focus === i + 1) { P.focus = i; paint(); play(c); }
      return;
    } finally { if (!--q.n) delete pending[c.id]; }
    if (Lab.tab !== "sounds" || !$("sd")) return;
    renderList();
    if (hide) { P.keepId = (next || P.tiles[i - 1] || {}).id; renderSound(); if (next) play(next); }
    else paint(false);
  }
  async function setPick(id) {
    const s = cur(), now = id && Lab.V.picks[s.name] === id ? null : id, c = Lab.S.clips[now];
    try {
      await Lab.vote({ sound: s.name, pick: now }, { label: now === null ? `Decision cleared · ${s.name}` : now === "shipped" ? `Keeping the shipped ${s.name}` : `Picked ${c ? takeName(c) : now} for ${s.name}`, icon: now ? "starFill" : "x" });
    } catch { return; }  // (Lab.vote already said so)
    if (Lab.tab !== "sounds" || !$("sd")) return;
    P.keepId = P.tiles[P.focus] ? P.tiles[P.focus].id : null;
    renderList(); renderSound();
  }
  function callout(text, meta, oldPrompt, cls = "") {
    return `<div class="pnote ${cls} ${oldPrompt ? "stale" : ""}">${icon("pen")}<div class="b"><p>${esc(text)}</p><div class="m"><span>${esc(meta)}</span>
      ${oldPrompt ? `<span class="stale" data-tip="${esc(`Written about: ${oldPrompt}`)}">about an earlier version of this prompt</span>` : ""}</div></div>
      <span class="a"><button class="btn ghost" data-edit>Edit</button><button class="btn ghost" data-resolve data-tip="It doesn't apply any more: remove it">${icon("check")}Resolve</button></span></div>`;
  }
  function wireCallout(el, edit, resolve) {
    el.querySelector("[data-edit]").onclick = e => { e.stopPropagation(); edit(); };
    el.querySelector("[data-resolve]").onclick = e => { e.stopPropagation(); resolve(); };
    el.onclick = e => { if (!e.target.closest("button")) edit(); };
  }
  function keepPlace() {
    const sd = $("sd");
    if (!sd) return;  // (left the tab while it saved)
    P.keepId = P.tiles[P.focus] ? P.tiles[P.focus].id : null;
    const y = sd.scrollTop;
    renderFilters(); renderList(); renderSound(); $("sd").scrollTop = y;
  }
  function editPromptNote(v, anchor, place = "below") {
    const n = pnotes(cur().name)[v];
    Lab.noteEditor({ anchor, place, title: `Note on the ${v} prompt`, value: n ? n.text : "", placeholder: "What's wrong with these takes, or what to try instead…",
                     onSave: t => savePromptNote(v, t), onResolve: () => savePromptNote(v, "") });
  }
  async function savePromptNote(v, text) {
    const s = cur();
    try {
      await Lab.vote({ sound: s.name, variant: v, prompt_note: text, prompt: promptOf(s.name, v) || (pnotes(s.name)[v] || {}).prompt || "" },  // (a note's prompt is kept when the variant is gone)
                     { label: text ? `Note saved on the ${v} prompt` : `Note on the ${v} prompt resolved`, icon: text ? "pen" : "check" });
    } catch { return; }  // (Lab.vote already said so)
    keepPlace();
  }
  function editSoundNote(anchor, place = "below") {
    const s = cur();
    Lab.noteEditor({ anchor, place, title: `Note on the whole ${s.name} sound`, value: Lab.V.notes[s.name] || "",
                     placeholder: "About the sound as a whole: what it should be, ideas to try…", onSave: t => saveSoundNote(t), onResolve: () => saveSoundNote("") });
  }
  async function saveSoundNote(text) {
    try { await Lab.vote({ sound: cur().name, note: text }, { label: text ? "Note on the sound saved" : "Note on the sound resolved", icon: text ? "pen" : "check" }); }
    catch { return; }  // (Lab.vote already said so)
    keepPlace();
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
    title: "Sounds", icon: "wave", show, refresh, leave() { P.audition = false; }, hash: () => P.sounds.length ? cur().name : undefined,
    count() {
      const by = new Set(Object.values(Lab.S.clips).map(c => c.name));
      return Object.entries(Lab.S.sounds).filter(([n, m]) => m.kind !== "pool" && by.has(n) && Lab.V.picks[n] == null).length || "";
    },
    keys: [["Space", "play or stop the selected take"], ["← →", "previous / next take"], ["↑ ↓", "previous / next prompt row"],
           ["U", "thumbs up, then play the next take"], ["D", "thumbs down, then play the next take"], ["Enter", "pick the selected take"],
           ["0", "keep the shipped file"], ["C", "a note on the selected take's prompt"], ["S", "play the shipped file"], ["X", "A/B the take and the shipped file"], ["A", "audition every take in order"],
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
      else if (k === "N") {  // (the next undecided sound in the list as filtered)
        const todo = visible().filter(s => !decided(s)), nx = todo.find(s => P.sounds.indexOf(s) > P.cur) || todo[0];
        if (nx) go(P.sounds.indexOf(nx)); else Lab.toast("Every sound here is decided", { icon: "check" });
      }
      else if (k === "n" || k === "]") step(1);
      else if (k === "b" || k === "[") step(-1);
      else if (k === "l") toggleLoop();
      else if (k === "c") { e.preventDefault(); Lab.dock.openNote(); }
    },
  });
})();
