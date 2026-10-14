// Stats: which prompt styles win, so the next prompts are written the way that works.
(() => {
  const { esc } = Lab;
  function show() {
    const rows = {}, offered = {};
    let takes = 0, silent = 0, up = 0, down = 0;
    for (const [id, c] of Object.entries(Lab.S.clips)) {
      takes++; if (c.failed) silent++;
      if (Lab.V.clips[id] === 1) up++; if (Lab.V.clips[id] === -1) down++;
      if (c.kit || c.variant === "pool") continue;
      const r = rows[c.variant] ||= { takes: 0, silent: 0, up: 0, down: 0, picks: 0, words: [] };
      r.takes++; if (c.failed) r.silent++;
      if (Lab.V.clips[id] === 1) r.up++; if (Lab.V.clips[id] === -1) r.down++;
      r.words.push((c.prompt || "").split(/\s+/).length);
      (offered[c.variant] ||= new Set()).add(c.name);
    }
    let kept = 0;
    for (const p of Object.values(Lab.V.picks)) {
      if (p === "shipped") kept++;
      else if (Lab.S.clips[p] && rows[Lab.S.clips[p].variant]) rows[Lab.S.clips[p].variant].picks++;
    }
    const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    // (a style tried on a handful of sounds can win them all; those are listed apart, so the real comparison stays honest)
    const FEW = 5, list = Object.entries(rows).map(([v, r]) => ({ v, ...r, offered: offered[v].size, rate: r.picks / Math.max(1, offered[v].size) }))
      .sort((a, b) => (a.offered < FEW) - (b.offered < FEW) || b.rate - a.rate || b.picks - a.picks);
    if (!list.length) { Lab.showEmpty("chart", "Nothing to compare yet", `<p>Stats appear once there are takes to vote on: <code>soundlab sounds generate</code>.</p>`); return; }
    const best = list.find(r => r.offered >= FEW), top = Math.max(.01, ...list.filter(r => r.offered >= FEW).map(r => r.rate)), { total, decided } = Lab.decisions();
    Lab.view().innerHTML = `<div class="page"><div class="wrap"><div class="page-head"><div><div class="eyebrow">${list.length} prompt styles</div><h1>Stats</h1>
        <p class="lede">How often each prompt style wins when it is on offer, so the next round of prompts is written the way that works.</p></div></div>
      <div class="tiles4">
        <div class="card stat"><span class="lbl">Takes</span><div class="v">${takes}</div><div class="s">${silent} silent (${(100 * silent / Math.max(1, takes)).toFixed(1)}%)</div></div>
        <div class="card stat"><span class="lbl">Decided</span><div class="v">${decided}<small>/ ${total}</small></div><div class="s">${kept} keep the shipped file</div></div>
        <div class="card stat"><span class="lbl">Votes</span><div class="v">${up + down}</div><div class="s">${up} up · ${down} down</div></div>
        ${best ? `<div class="card stat"><span class="lbl">Best style</span><div class="v">${esc(best.v)}</div><div class="s">wins ${Math.round(100 * best.rate)}% of the sounds it's offered for</div></div>` : ""}
      </div>
      <h3>Win rate by prompt style</h3>
      <table class="stats"><thead><tr><th>prompt style</th><th>win rate</th><th>sounds offered</th><th>picked</th><th>takes</th><th>silent</th><th>up</th><th>down</th><th>median words</th></tr></thead><tbody>
      ${list.map((r, i) => `${r.offered < FEW && (i === 0 || list[i - 1].offered >= FEW) ? `<tr class="split"><td colspan="9">Tried on fewer than ${FEW} sounds</td></tr>` : ""}
        <tr class="${r.offered < FEW ? "few" : ""}"><td>${esc(r.v)}</td><td class="rate"><div class="rbar ${r === best ? "best" : ""}"><div class="track"><div style="width:${Math.min(100, 100 * r.rate / top)}%"></div></div><b>${Math.round(100 * r.rate)}%</b></div></td>
        <td>${r.offered}</td><td>${r.picks}</td><td>${r.takes}</td><td>${r.silent}</td><td>${r.up}</td><td>${r.down}</td><td>${med(r.words)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  Lab.register("stats", { title: "Stats", icon: "chart", show, dock: false, keys: [] });
})();
