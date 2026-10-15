// Instruments: the music's instrument pool. Each candidate's solo takes, grouped by the role it would play.
// An instrument is in the pool when one of its takes is picked (★) or its takes' thumbs net above zero; out when they net below
// zero (the same rule as music.pool_of). A role with nobody in uses the project's provisional instrument, and so does the whole pool until a vote.
(() => {
  const P = { focus: 0, tiles: [], want: null };
  const { icon, esc } = Lab;
  const ROLE = r => (r || "").replace(/_/g, " ");
  const label = ins => (Lab.project.instruments || {})[ins.id] || ins.id;
  const prose = t => t.replace(/^(?:[A-Z][A-Za-z]+: [^,.]+[,.]\s*)+/, "") || t;  // (the description, without the leading tags)

  function instruments() {
    const by = Lab.byName();
    return Object.entries(Lab.S.sounds).filter(([, m]) => m.kind === "pool").map(([name, m]) => ({
      name, id: name.slice(5), role: m.palette, prompts: Lab.S.prompts[name] || {},
      takes: (by[name] || []).sort((a, b) => a.seed - b.seed),
    }));
  }
  function stateOf(ins) {
    const net = ins.takes.reduce((s, t) => s + (Lab.V.clips[t.id] || 0), 0);
    if (net < 0) return "out";
    return Lab.V.picks[ins.name] || net > 0 ? "in" : "none";
  }
  // The pool the next music draws from: the instruments voted in, with the provisional pick standing in for a role with none.
  function poolNote(list, roles) {
    const n = list.filter(i => stateOf(i) === "in").length, bare = roles.filter(r => !list.some(i => i.role === r && stateOf(i) === "in")).length;
    return !n ? "none chosen yet: the music uses a provisional pick per role" : `${n} in the pool${bare ? ` (${bare} ${bare > 1 ? "roles use" : "role uses"} the provisional pick)` : ""}`;
  }
  const PILL = { in: ["good", "check", "In the pool"], out: ["bad", "x", "Dropped"], none: ["todo", null, "Undecided"] };

  function show(arg) {
    const list = instruments();
    if (!list.length) { Lab.showEmpty("note", "No instrument auditions yet", `<p>Make them with <code>soundlab music audition</code>.</p>`); return; }
    if (arg) P.want = arg;
    const roles = [...new Set(list.map(i => i.role))], pool = Lab.S.mesh && Lab.S.mesh.pool;
    const silent = list.reduce((n, i) => n + i.takes.filter(t => t.failed).length, 0);
    const page = document.getElementById("ip"), y = page ? page.scrollTop : 0;
    P.tiles = [];
    Lab.view().innerHTML = `<div class="page" id="ip"><div class="wrap"><div class="page-head"><div>
        <div class="eyebrow">${list.length} candidates · ${roles.length} roles · ${poolNote(list, roles)}${silent ? ` · ${silent} silent takes` : ""}</div><h1>Instruments</h1>
        <p class="lede">The music plays on a pool of instruments; each track draws one per role from it. Pick (★) a take or thumb an
          instrument up to keep it; thumb it down to drop it. The next music you generate uses the new pool.</p></div></div>
      <div class="pool">${roles.map(role => `<div class="card"><span class="lbl">${esc(ROLE(role))}</span><div class="chips">
        ${list.filter(i => i.role === role).map(i => { const st = stateOf(i); return `<button class="chip ${st === "none" ? "" : st}" data-jump="${esc(i.name)}">${esc(label(i))}</button>`; }).join("")}</div></div>`).join("")}</div>
      ${pool ? `<div class="facts"><span>The current music was made from <b>${esc(Object.values(pool).flat().join(", "))}</b></span></div>` : ""}
      <div id="roles"></div></div></div>`;
    const el = document.getElementById("roles");
    let card = 0;
    for (const role of roles) {
      el.insertAdjacentHTML("beforeend", `<h3>${esc(ROLE(role))}</h3>`);
      for (const ins of list.filter(i => i.role === role)) {
        const mine = card, live = ins.takes.some(t => !t.failed);  // (an instrument with nothing to play has no place in the ↑ ↓ order)
        const st = stateOf(ins), [cls, ic, txt] = PILL[st], d = document.createElement("div");
        d.className = `card inst ${st}`; d.dataset.ins = ins.name;
        // One row of takes per prompt (several when the auditions compare prompt shapes), each with its prompt.
        const vars = [...new Set(ins.takes.map(t => t.variant))], many = vars.length > 1;
        const say = v => ins.prompts[v] ? `<p data-tip="${esc(ins.prompts[v])}">${many ? `<span class="lbl">${esc(v)}</span>` : ""}${esc(prose(ins.prompts[v]))}</p>` : "";
        if (many) d.classList.add("multi");
        d.innerHTML = `<div class="name"><b>${esc(label(ins))}</b><span class="pill ${cls}">${ic ? icon(ic) : ""}${txt}</span>
          ${many ? "" : say(vars[0])}</div>${vars.map(v => `${many ? `<div class="name ivar">${say(v)}</div>` : ""}<div class="tiles" data-variant="${esc(v)}"></div>`).join("")}`;
        for (const t of ins.takes) {
          t.url = Lab.clipUrl(t);
          const tile = Lab.tile(t, `take ${t.seed + 1}`);
          if (!t.failed) {
            const i = P.tiles.length;
            tile.onclick = () => { P.focus = i; paint(); Lab.play(t.url, { id: t.id }); };
            P.tiles.push({ ...t, ins, card: mine });
          }
          d.querySelector(`.tiles[data-variant="${CSS.escape(t.variant)}"]`).appendChild(tile);
        }
        el.appendChild(d); if (live) card++;
      }
    }
    Lab.view().querySelectorAll("[data-jump]").forEach(b => b.onclick = () => jump(b.dataset.jump));
    document.getElementById("ip").scrollTop = y;
    P.focus = Lab.clamp(P.focus, 0, P.tiles.length - 1);
    if (P.want) { const w = P.want; P.want = null; jump(w); } else paint(false);
    Lab.repaintPlaying();
  }
  function jump(name) {
    const i = P.tiles.findIndex(t => t.ins.name === name);
    if (i >= 0) { P.focus = i; paint(false); }  // (an instrument with only silent takes: just scroll to it)
    const c = document.querySelector(`.inst[data-ins="${CSS.escape(name)}"]`);
    if (c) c.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function paint(scroll = true) {
    const f = P.tiles[P.focus];
    document.querySelectorAll("#roles .tile").forEach(el => {
      const id = el.dataset.id, t = P.tiles.find(x => x.id === id);
      Lab.tileState(el, { focus: f && f.id === id, pick: t && Lab.V.picks[t.ins.name] === id, up: Lab.V.clips[id] === 1, down: Lab.V.clips[id] === -1 });
    });
    document.querySelectorAll("#roles .inst").forEach(c => c.classList.toggle("cur", !!f && c.dataset.ins === f.ins.name));
    const el = document.querySelector("#roles .tile.focus");
    if (el && scroll) el.scrollIntoView({ block: "nearest" });
    Lab.inspect(f ? dockItem(f) : null);
  }
  function dockItem(t) {
    const v = Lab.V.clips[t.id], pk = Lab.V.picks[t.ins.name] === t.id;
    return { id: t.id, url: t.url, title: label(t.ins), sub: `${ROLE(t.ins.role)} · ${what(t)}`, pick: pk,
      facts: PILL[stateOf(t.ins)][2],
      actions: [
        { icon: "up", cls: "good", on: v === 1, run: () => vote(t, 1), tip: "Thumbs up: keep it (U)" },
        { icon: "down", cls: "bad", on: v === -1, run: () => vote(t, -1), tip: "Thumbs down: drop it (D)" },
        { icon: pk ? "starFill" : "star", label: pk ? "Picked" : "Pick", cls: "pick", on: pk, run: () => pick(t), tip: "Pick this take: keeps the instrument (Enter)" },
      ] };
  }
  // The take, as the toasts and dock say it: with its prompt when the instrument has several (seeds restart for each).
  const what = t => `${new Set(t.ins.takes.map(x => x.variant)).size > 1 ? `${t.variant} · ` : ""}take ${t.seed + 1}`;
  async function vote(t, v) {
    const now = Lab.V.clips[t.id] === v ? 0 : v;
    try { await Lab.vote({ clip: t.id, value: now }, { label: `${now === 1 ? "Thumbs up" : now === -1 ? "Thumbs down" : "Vote cleared"} · ${label(t.ins)} ${what(t)}`, icon: now === -1 ? "down" : now ? "up" : "x" }); }
    catch { return; }  // (Lab.vote already said so)
    if (Lab.tab === "instruments") show();
  }
  async function pick(t) {
    const now = Lab.V.picks[t.ins.name] === t.id ? null : t.id;
    try { await Lab.vote({ sound: t.ins.name, pick: now }, { label: now ? `Picked ${label(t.ins)} ${what(t)}` : `Pick cleared · ${label(t.ins)}`, icon: now ? "starFill" : "x" }); }
    catch { return; }  // (Lab.vote already said so)
    if (Lab.tab === "instruments") show();
  }
  Lab.register("instruments", {
    title: "Instruments", icon: "note", show, refresh: () => show(), enabled: () => Lab.project.features.music,
    count() { return instruments().filter(i => stateOf(i) === "none").length || ""; },
    keys: [["Space", "play or stop the selected take"], ["← →", "previous / next take"], ["↑ ↓", "previous / next instrument"],
           ["Enter", "pick this take (keeps the instrument)"], ["U", "thumbs up"], ["D", "thumbs down (drops it)"], ["Esc", "stop"]],
    onKey(e) {
      const k = e.key, t = P.tiles[P.focus];
      if (!t) return;
      if (k === " ") { e.preventDefault(); Lab.player.current === t.id ? Lab.stop() : Lab.play(t.url, { id: t.id }); }
      else if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); P.focus = Lab.clamp(P.focus + (k === "ArrowRight" ? 1 : -1), 0, P.tiles.length - 1); moved(); }
      else if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        const card = t.card + (k === "ArrowDown" ? 1 : -1), col = P.tiles.filter(x => x.card === t.card).indexOf(t), in2 = P.tiles.filter(x => x.card === card);
        if (in2.length) { P.focus = P.tiles.indexOf(in2[Math.min(col, in2.length - 1)]); moved(); }
      }
      else if (k === "Enter") pick(t);
      else if (k === "u") vote(t, 1);
      else if (k === "d") vote(t, -1);
      else if (k === "Escape") Lab.stop();
    },
  });
  function moved() { paint(); if (Lab.player.current) Lab.play(P.tiles[P.focus].url, { id: P.tiles[P.focus].id }); }
})();
