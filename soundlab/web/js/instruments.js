// Instruments: the music's instrument pool. Each candidate's solo takes, grouped by the role it would play.
// An instrument is in the pool when a take is picked (★) or it is thumbed up on balance; out when thumbed down.
(() => {
  const P = { focus: 0, tiles: [] };
  const ROLE = r => (r || "").replace(/_/g, " ");

  function instruments() {
    const by = Lab.byName();
    return Object.entries(Lab.S.sounds).filter(([, m]) => m.kind === "pool").map(([name, m]) => ({
      name, id: name.slice(5), role: m.palette, prompt: (Lab.S.prompts[name] || {}).pool || "",
      takes: (by[name] || []).sort((a, b) => a.seed - b.seed),
    }));
  }
  function stateOf(ins) {
    const net = ins.takes.reduce((s, t) => s + (Lab.V.clips[t.id] || 0), 0);
    if (net < 0) return "out";
    return Lab.V.picks[ins.name] || net > 0 ? "in" : "none";
  }
  function show() {
    const list = instruments();
    if (!list.length) { Lab.view().innerHTML = `<div class="page"><div class="empty">No instrument auditions yet.<br><br>Make them with <code>soundlab music audition</code>.</div></div>`; return; }
    const roles = [...new Set(list.map(i => i.role))];
    const pool = Lab.S.mesh && Lab.S.mesh.pool;
    P.tiles = [];
    Lab.view().innerHTML = `<div class="page"><h2>Instruments</h2>
      <div class="note">The music is played on a pool of instruments; each track draws one per role from it. Pick (★) a take or
        thumb an instrument up to keep it, thumb it down to drop it. The music uses the new pool the next time it is generated
        ${pool ? `(the current music was made from: ${Lab.esc(Object.values(pool).flat().join(", "))})` : ""}.</div>
      <div class="roles" id="roles"></div></div>`;
    const el = document.getElementById("roles");
    for (const role of roles) {
      const h = document.createElement("h3");
      h.textContent = ROLE(role);
      el.appendChild(h);
      for (const ins of list.filter(i => i.role === role)) {
        const st = stateOf(ins), card = document.createElement("div");
        card.className = `inst ${st}`;
        card.innerHTML = `<div class="name"><b>${Lab.esc((Lab.project.instruments || {})[ins.id] || ins.id)}</b><span class="badge ${st}">${st === "in" ? "in the pool" : st === "out" ? "dropped" : "undecided"}</span>
          <div class="dim" style="font-size:11.5px;margin-top:4px" title="${Lab.esc(ins.prompt)}">prompt ⓘ</div></div><div class="tiles"></div>`;
        for (const t of ins.takes) {
          t.url = Lab.clipUrl(t);
          const i = P.tiles.length, tile = Lab.tile(t, `take ${t.seed + 1}`);
          tile.classList.toggle("pick", Lab.V.picks[ins.name] === t.id);
          tile.classList.toggle("up", Lab.V.clips[t.id] === 1);
          tile.classList.toggle("down", Lab.V.clips[t.id] === -1);
          if (!t.failed) { tile.onclick = () => { P.focus = i; paint(); Lab.play(t.url, { id: t.id }); }; P.tiles.push({ ...t, ins }); }
          card.querySelector(".tiles").appendChild(tile);
        }
        el.appendChild(card);
      }
    }
    P.focus = Math.min(P.focus, P.tiles.length - 1);
    paint();
  }
  function paint() {
    document.querySelectorAll("#roles .tile").forEach(el => el.classList.toggle("focus", P.tiles[P.focus] && P.tiles[P.focus].id === el.dataset.id));
    const f = document.querySelector("#roles .tile.focus");
    if (f) f.scrollIntoView({ block: "nearest" });
  }
  async function act(fn) { const y = Lab.view().querySelector(".page").scrollTop; await fn(); show(); Lab.view().querySelector(".page").scrollTop = y; }
  Lab.register("instruments", {
    title: "Instruments", show, enabled: () => Lab.project.features.music,
    keys: [["Space", "play or stop the selected take"], ["←", "previous take"], ["→", "next take"],
           ["Enter", "pick this take (keeps the instrument)"], ["U", "thumbs up"], ["D", "thumbs down (drops it)"], ["Esc", "stop"]],
    onKey(e) {
      const k = e.key, t = P.tiles[P.focus];
      if (!t) return;
      if (k === " ") { e.preventDefault(); Lab.player.current === t.id ? Lab.stop() : Lab.play(t.url, { id: t.id }); }
      else if (k === "ArrowRight" || k === "ArrowLeft" || k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        const step = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : k === "ArrowDown" ? 4 : -4;
        P.focus = Math.max(0, Math.min(P.tiles.length - 1, P.focus + step)); paint();
        if (Lab.player.current) Lab.play(P.tiles[P.focus].url, { id: P.tiles[P.focus].id });
      }
      else if (k === "Enter") act(() => Lab.vote({ sound: t.ins.name, pick: Lab.V.picks[t.ins.name] === t.id ? null : t.id }));
      else if (k === "u") act(() => Lab.vote({ clip: t.id, value: Lab.V.clips[t.id] === 1 ? 0 : 1 }));
      else if (k === "d") act(() => Lab.vote({ clip: t.id, value: Lab.V.clips[t.id] === -1 ? 0 : -1 }));
      else if (k === "Escape") Lab.stop();
    },
  });
})();
