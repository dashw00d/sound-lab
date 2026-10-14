// Alerts: every kit's whole alert set as a row, so a family is judged for consistency, not one sound at a time.
(() => {
  const P = { row: 0, col: 0, seq: null };
  const set = () => Lab.S.sets && Lab.S.sets.alerts;
  function rows() {
    const s = set();
    if (!s) return [];
    const shipped = { id: "shipped", label: "shipped now (reference)", clips: {} };
    for (const n of s.names) if (Lab.S.sounds[n] && Lab.S.sounds[n].shipped) shipped.clips[n] = "shipped:" + n;
    return [shipped, ...s.rows];
  }
  const url = cid => cid.startsWith("shipped:") ? Lab.shippedUrl(Lab.S.sounds[cid.slice(8)].shipped) : Lab.clipUrl(Lab.S.clips[cid]);
  const short = n => n.replace(/^alert_/, "").replace(/_/g, " ");

  function show() {
    const s = set();
    if (!s) { Lab.view().innerHTML = `<div class="page"><div class="empty">No alert sets yet.<br><br>Build them with <code>soundlab alerts build</code>.</div></div>`; return; }
    const rs = rows();
    P.row = Math.min(P.row, rs.length - 1);
    const picked = r => r.id !== "shipped" && s.names.every(n => Lab.V.picks[n] === r.clips[n]);
    Lab.view().innerHTML = `<div class="page"><h2>Alert sets</h2>
      ${Object.entries(s.legend || {}).map(([f, t]) => `<div class="note"><b style="color:var(--accent)">${Lab.esc(f)}</b> · ${Lab.esc(t)}</div>`).join("")}
      <div class="note" style="margin-top:6px">Each row is one kit's whole family. <kbd>Space</kbd> plays a row in order; <kbd>Enter</kbd> picks it for every alert. Hover a column for what that alert means.</div>
      <table class="grid"><tr><th></th><th></th>${s.names.map(n => `<th title="${Lab.esc(Object.values(s.what || {}).map(w => w[n]).filter(Boolean).join(" / "))}">${Lab.esc(short(n))}</th>`).join("")}<th></th></tr>
      ${rs.map((r, i) => `<tr data-i="${i}" class="${i === P.row ? "sel" : ""} ${picked(r) ? "picked" : ""}">
        <td class="lbl">${Lab.esc(r.label)}</td><td><button class="btn" data-playrow="${i}">▶ row</button></td>
        ${s.names.map((n, j) => r.clips[n] ? `<td><button class="cell ${i === P.row && j === P.col ? "focus" : ""} ${Lab.V.picks[n] === r.clips[n] ? "chosen" : ""}" data-r="${i}" data-c="${j}" data-play-id="${Lab.esc(r.clips[n])}">▶</button></td>` : "<td></td>").join("")}
        <td>${r.id === "shipped" ? "" : `<button class="btn" data-pick="${i}">pick set</button>`}</td></tr>`).join("")}</table></div>`;
    const v = Lab.view();
    v.querySelectorAll("[data-playrow]").forEach(b => b.onclick = () => { P.row = +b.dataset.playrow; playRow(); });
    v.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { P.row = +b.dataset.pick; pickRow(); });
    v.querySelectorAll(".cell").forEach(b => b.onclick = () => { P.row = +b.dataset.r; P.col = +b.dataset.c; playCell(); });
  }
  function playCell() {
    const r = rows()[P.row], n = set().names[P.col];
    P.seq = null;
    if (r.clips[n]) { show(); Lab.play(url(r.clips[n]), { id: r.clips[n] }); }
  }
  function playRow() {
    const r = rows()[P.row];
    P.seq = set().names.map((n, j) => j).filter(j => r.clips[set().names[j]]);
    show(); next();
  }
  function next() {
    if (!P.seq || !P.seq.length) { P.seq = null; return; }
    P.col = P.seq.shift();
    const cid = rows()[P.row].clips[set().names[P.col]];
    show();
    Lab.play(url(cid), { id: cid, onEnd: () => setTimeout(next, 450) });
  }
  async function pickRow() {
    const r = rows()[P.row];
    if (r.id === "shipped") return;
    await Lab.vote({ picks: r.clips });
    show(); Lab.toast("set picked for every alert");
  }
  Lab.register("alerts", {
    title: "Alerts", show, enabled: () => Lab.project.features.alerts,
    leave() { P.seq = null; },
    keys: [["↑", "previous set"], ["↓", "next set"], ["Space", "play the whole set"], ["←", "play the previous alert"],
           ["→", "play the next alert"], ["Enter", "pick the set for every alert"], ["Esc", "stop"]],
    onKey(e) {
      const k = e.key, n = rows().length;
      if (!n) return;
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); P.row = Math.max(0, Math.min(n - 1, P.row + (k === "ArrowDown" ? 1 : -1))); P.seq = null; Lab.stop(); show(); }
      else if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); P.col = Math.max(0, Math.min(set().names.length - 1, P.col + (k === "ArrowRight" ? 1 : -1))); playCell(); }
      else if (k === " ") { e.preventDefault(); if (P.seq || Lab.player.current) { P.seq = null; Lab.stop(); } else playRow(); }
      else if (k === "Enter") pickRow();
      else if (k === "Escape") { P.seq = null; Lab.stop(); }
    },
  });
})();
