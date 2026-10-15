// Alerts: every kit's whole alert set as a row, so a family is judged for consistency, not one sound at a time.
(() => {
  const P = { row: 0, col: 0, seq: null };
  const { icon, esc } = Lab;
  const set = () => Lab.S.sets && Lab.S.sets.alerts;
  function rows() {
    const s = set();
    if (!s) return [];
    const shipped = { id: "shipped", label: "Shipped now · reference", clips: {} };
    for (const n of s.names) if (Lab.S.sounds[n] && Lab.S.sounds[n].shipped) shipped.clips[n] = "shipped:" + n;
    return [shipped, ...s.rows];
  }
  const url = cid => cid.startsWith("shipped:") ? Lab.shippedUrl(Lab.S.sounds[cid.slice(8)].shipped) : Lab.clipUrl(Lab.S.clips[cid]);
  const short = n => n.replace(/^alert_/, "").replace(/_/g, " ");
  const kitOf = r => r.id === "shipped" ? "Shipped now" : r.label.replace(/ · take \d+$/, "");
  // (the kit's seed counts from 0; Sounds and Instruments say "take" for seed + 1, so this does too)
  const takeOf = r => { if (r.id === "shipped") return "reference"; const m = r.label.match(/take (\d+)$/); return m ? `take ${+m[1] + 1}` : r.id; };
  // What a pick on this row is: a kit's take for each alert, or "shipped" (keep the file the game has) on the reference row.
  const chosen = (r, n) => Lab.V.picks[n] === (r.id === "shipped" ? "shipped" : r.clips[n]);
  const picked = r => { const has = set().names.filter(n => r.clips[n]); return has.length > 0 && has.every(n => chosen(r, n)); };
  const whatFor = n => Object.entries(set().what || {}).map(([f, w]) => w[n] ? `${f}: ${w[n]}` : "").filter(Boolean).join("\n");

  // A take's thumb from the Sounds page (alert takes are voted there too), as a corner mark on its cell.
  const vote = cid => cid.startsWith("shipped:") ? 0 : Lab.V.clips[cid] || 0;
  const voteMark = cid => vote(cid) ? `<span style="position:absolute;top:-2px;right:-2px;display:flex;transform:scale(.7);pointer-events:none;color:var(--${vote(cid) > 0 ? "good" : "bad"})">${icon(vote(cid) > 0 ? "up" : "down")}</span>` : "";
  const voteTip = cid => vote(cid) ? ` data-tip="${vote(cid) > 0 ? "Thumbs up" : "Thumbs down"} (voted on the Sounds page)"` : "";

  function show() {
    const s = set();
    if (!s) { Lab.showEmpty("bell", "No alert sets yet", `<p>Build them with <code>soundlab alerts build</code>.</p>`); return; }
    const rs = rows();
    P.row = Lab.clamp(P.row, 0, rs.length - 1);
    const fam = Object.entries(s.legend || {}), cols = s.names.length + 2;
    let html = `<div class="page" id="ap"><div class="wrap"><div class="page-head"><div>
        <div class="eyebrow">${s.names.length} alerts · ${s.rows.length} kits</div><h1>Alert sets</h1>
        <p class="lede">Each row is one kit's whole family, so you judge consistency rather than one sound at a time.
          <kbd>Space</kbd> plays a row in order; <kbd>Enter</kbd> picks it for every alert. Hover a column for what that alert means.</p></div></div>
      ${fam.length ? `<div class="legend">${fam.map(([f, t]) => `<div class="card"><b>${esc(f)}</b><p>${esc(t)}</p></div>`).join("")}</div>` : ""}
      <table class="agrid"><thead><tr><th></th>${s.names.map((n, j) => `<th class="c" data-col="${j}" data-tip="${esc(whatFor(n) || short(n))}">${esc(short(n))}</th>`).join("")}<th></th></tr></thead><tbody>`;
    let last = null;
    rs.forEach((r, i) => {
      const k = kitOf(r);
      if (k !== last) { html += `<tr class="kit"><td colspan="${cols}">${esc(k)}${r.family ? `<small>${esc(r.family)}</small>` : ""}</td></tr>`; last = k; }
      const pk = picked(r), ref = r.id === "shipped";
      html += `<tr class="r ${pk ? "picked" : ""} ${ref ? "ref" : ""}" data-i="${i}"><td class="rl">${pk ? icon(ref ? "keep" : "starFill") : ""}${esc(takeOf(r))}</td>
        ${s.names.map((n, j) => r.clips[n] ? `<td><button class="cell" data-r="${i}" data-c="${j}" data-play-id="${esc(r.clips[n])}"${voteTip(r.clips[n])}><canvas></canvas>${voteMark(r.clips[n])}</button></td>` : "<td></td>").join("")}
        <td><span class="row rowbtn" style="flex-wrap:nowrap;gap:4px"><button class="iconbtn" data-playrow="${i}" data-tip="Play the whole row (Space)">${icon("play")}</button>
          <button class="btn ${pk ? "pick on" : ""}" data-pick="${i}">${icon(ref ? "keep" : pk ? "starFill" : "star")}${ref ? (pk ? "Keeping" : "Keep set") : pk ? "Picked" : "Pick set"}</button></span></td></tr>`;
    });
    const page = document.getElementById("ap"), y = page ? page.scrollTop : 0;
    Lab.view().innerHTML = html + `</tbody></table></div></div>`;
    document.getElementById("ap").scrollTop = y;
    const v = Lab.view();
    v.querySelectorAll(".cell").forEach(b => {
      Lab.watch(b, url(rs[+b.dataset.r].clips[s.names[+b.dataset.c]]));
      b.onclick = () => { P.row = +b.dataset.r; P.col = +b.dataset.c; playCell(); };
    });
    v.querySelectorAll("[data-playrow]").forEach(b => b.onclick = () => { P.row = +b.dataset.playrow; playRow(); });
    v.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { P.row = +b.dataset.pick; pickRow(); });
    v.querySelectorAll("tr.r").forEach(tr => tr.querySelector("td.rl").onclick = () => { P.row = +tr.dataset.i; paint(); });
    paint(false);
    Lab.repaintPlaying();
  }
  function paint(scroll = true) {
    const s = set(), rs = rows();
    document.querySelectorAll(".agrid tr.r").forEach(tr => tr.classList.toggle("sel", +tr.dataset.i === P.row));
    document.querySelectorAll(".agrid th.c").forEach(th => th.classList.toggle("on", +th.dataset.col === P.col));
    document.querySelectorAll(".agrid .cell").forEach(b => {
      const r = rs[+b.dataset.r], n = s.names[+b.dataset.c];
      Lab.tileState(b, { focus: +b.dataset.r === P.row && +b.dataset.c === P.col, chosen: !!r.clips[n] && chosen(r, n) });
    });
    const f = document.querySelector(".agrid .cell.focus");
    if (f && scroll) f.closest("tr").scrollIntoView({ block: "nearest" });
    Lab.inspect(dockItem());
  }
  function dockItem() {
    const r = rows()[P.row], n = set().names[P.col], cid = r && r.clips[n];
    if (!cid) return null;
    const c = Lab.S.clips[cid], pk = picked(r);
    return { id: cid, url: url(cid), title: n, sub: `${kitOf(r)} · ${takeOf(r)}`, pick: chosen(r, n),
      facts: c && c.prompt ? c.prompt.replace(/ · kit .*$/, "") : "",
      play: f => { P.seq = null; Lab.play(url(cid), { id: cid, from: f }); },
      actions: r.id === "shipped" ? [{ icon: "keep", label: pk ? "Keeping set" : "Keep set", cls: "pick", on: pk, run: pickRow, tip: "Keep the shipped file for every alert (Enter)" }]
        : [{ icon: pk ? "starFill" : "star", label: pk ? "Set picked" : "Pick set", cls: "pick", on: pk, run: pickRow, tip: "Pick this kit for every alert (Enter)" }] };
  }
  function playCell() {
    const r = rows()[P.row], cid = r.clips[set().names[P.col]];
    P.seq = null; paint();
    if (cid) Lab.play(url(cid), { id: cid });
  }
  function playRow() {
    const r = rows()[P.row], names = set().names;
    P.seq = names.map((n, j) => j).filter(j => r.clips[names[j]]);
    next();
  }
  function next() {
    if (!P.seq || !P.seq.length) { P.seq = null; return; }
    P.col = P.seq.shift();
    const cid = rows()[P.row].clips[set().names[P.col]], u = url(cid);
    if (!u) { next(); return; }  // (a silent take: skip it)
    paint();
    Lab.play(u, { id: cid, onEnd: () => setTimeout(() => { if (P.seq) next(); }, 450) });
  }
  async function pickRow() {
    const r = rows()[P.row], ref = r.id === "shipped";
    const picks = ref ? Object.fromEntries(Object.keys(r.clips).map(n => [n, "shipped"])) : r.clips;
    try { await Lab.vote({ picks }, { label: ref ? "Keeping the shipped file for every alert" : `Picked ${kitOf(r)} · ${takeOf(r)} for every alert`, icon: ref ? "keep" : "starFill" }); }
    catch { return; }  // (Lab.vote already said so)
    if (Lab.tab === "alerts") show();
  }
  Lab.register("alerts", {
    title: "Alerts", icon: "bell", show, enabled: () => Lab.project.features.alerts,
    leave() { P.seq = null; },
    keys: [["↑ ↓", "previous / next set"], ["Space", "play the whole set"], ["← →", "play the previous / next alert"],
           ["Enter", "pick the set for every alert"], ["Esc", "stop"]],
    onKey(e) {
      const k = e.key, n = rows().length;
      if (!n || !set()) return;
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); P.row = Lab.clamp(P.row + (k === "ArrowDown" ? 1 : -1), 0, n - 1); P.seq = null; Lab.stop(); paint(); }
      else if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); P.col = Lab.clamp(P.col + (k === "ArrowRight" ? 1 : -1), 0, set().names.length - 1); playCell(); }
      else if (k === " ") { e.preventDefault(); if (P.seq || Lab.player.current) { P.seq = null; Lab.stop(); } else playRow(); }
      else if (k === "Enter") pickRow();
      else if (k === "Escape") { P.seq = null; Lab.stop(); }
    },
  });
})();
