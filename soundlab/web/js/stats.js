// Stats: which prompt styles win, so the next prompts are written the way that works.
(() => {
  function show() {
    const rows = {};
    const offered = {};
    for (const [id, c] of Object.entries(Lab.S.clips)) {
      if (c.kit || c.variant === "pool") continue;
      const r = rows[c.variant] ||= { takes: 0, silent: 0, up: 0, down: 0, picks: 0, words: [] };
      r.takes++; if (c.failed) r.silent++;
      if (Lab.V.clips[id] === 1) r.up++; if (Lab.V.clips[id] === -1) r.down++;
      r.words.push((c.prompt || "").split(/\s+/).length);
      (offered[c.variant] ||= new Set()).add(c.name);
    }
    let kept = 0;
    for (const [name, p] of Object.entries(Lab.V.picks)) {
      if (p === "shipped") kept++;
      else if (Lab.S.clips[p] && rows[Lab.S.clips[p].variant]) rows[Lab.S.clips[p].variant].picks++;
    }
    const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const list = Object.entries(rows).map(([v, r]) => ({ v, ...r, offered: offered[v].size, rate: r.picks / Math.max(1, offered[v].size) }))
      .sort((a, b) => b.rate - a.rate);
    Lab.view().innerHTML = `<div class="page"><h2>Stats</h2>
      <div class="note">How often each prompt style wins when it is on offer. Picks you made to keep the shipped file: ${kept}.</div>
      <table class="stats"><tr><th>prompt style</th><th>sounds offered</th><th>picked</th><th>win rate</th><th>takes</th><th>silent</th><th>▲</th><th>▼</th><th>median words</th></tr>
      ${list.map(r => `<tr><td>${Lab.esc(r.v)}</td><td>${r.offered}</td><td>${r.picks}</td><td>${Math.round(100 * r.rate)}%</td><td>${r.takes}</td>
        <td>${r.silent}</td><td>${r.up}</td><td>${r.down}</td><td>${med(r.words)}</td></tr>`).join("")}</table></div>`;
  }
  Lab.register("stats", { title: "Stats", show, keys: [] });
})();
