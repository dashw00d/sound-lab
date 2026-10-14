// Balance: every shipped sound and music level at its in-game level (file loudness + the code's offset + the mix's
// trim + its bus), trimmed here and saved to the game's mix file, which a running game re-reads live.
(() => {
  const B = { data: null, mix: null, saved: "", rows: [], focus: 0, ref: null, group: "all", sort: "group" };
  const PAD = -12;  // dB under the game's levels, so the loudest sounds don't clip the browser
  const ORDER = ["alerts", "events", "combat", "deaths", "work", "far calls", "ambience", "ui", "voices", "music", "other"];

  async function show() {
    const r = await (await fetch("/api/balance")).json();
    if (!r.balance.sounds) { Lab.view().innerHTML = `<div class="page"><div class="empty">Nothing measured yet.<br><br>Run <code>soundlab balance measure</code>.</div></div>`; return; }
    B.data = r.balance;
    B.mix = { buses: {}, sounds: {}, music: {}, levels: {}, ...r.mix };
    for (const k of ["buses", "sounds", "music", "levels"]) B.mix[k] = { ...(B.mix[k] || {}) };
    B.saved = JSON.stringify(B.mix);
    render();
  }
  const busDb = bus => B.mix.buses[bus] ?? B.data.buses[bus] ?? 0;
  const codeDb = s => { const v = s.calls.map(c => c.db).filter(x => x != null); return v.length ? Math.max(...v) : 0; };
  function allRows() {
    const rows = [];
    for (const [name, s] of Object.entries(B.data.sounds)) {
      const key = B.mix.sounds[name] != null ? name : (B.mix.sounds[s.base] != null ? s.base : name);
      rows.push({ kind: "sound", name, group: s.group, bus: s.bus, lufs: s.lufs, metric: s.metric, code: codeDb(s), calls: s.calls,
                  file: Lab.shippedUrl(s.file), key, trim: () => B.mix.sounds[key] || 0 });
    }
    for (const [id, t] of Object.entries(B.data.music)) for (const [lv, f] of Object.entries(t.levels)) {
      rows.push({ kind: "music", name: `${id} · ${lv}`, group: "music", bus: "Music", lufs: f.lufs, metric: "integrated", code: 0, calls: [],
                  file: Lab.shippedUrl(f.file), track: id, level: lv,
                  trim: () => (B.mix.music[id] ?? B.mix.music[t.context] ?? 0) + (B.mix.levels[lv] || 0) });
    }
    return rows;
  }
  const eff = r => r.lufs + r.code + r.trim() + busDb(r.bus);
  function render() {
    const all = allRows(), groups = [...new Set(all.map(r => r.group))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    B.rows = all.filter(r => B.group === "all" || r.group === B.group)
      .sort((a, b) => B.sort === "loud" ? eff(b) - eff(a) : (ORDER.indexOf(a.group) - ORDER.indexOf(b.group)) || a.name.localeCompare(b.name));
    B.focus = Math.min(B.focus, B.rows.length - 1);
    const median = {};
    for (const g of groups) { const v = all.filter(r => r.group === g).map(eff).sort((a, b) => a - b); median[g] = v[Math.floor(v.length / 2)]; }
    const dirty = JSON.stringify(B.mix) !== B.saved, lo = Math.min(...all.map(eff)), hi = Math.max(...all.map(eff));
    let last = "";
    const body = B.rows.map((r, i) => {
      const e = eff(r), out = Math.abs(e - median[r.group]) > 4;
      const head = B.sort === "group" && r.group !== last ? `<tr class="grp"><td colspan="9">${Lab.esc(r.group)} <span class="dim" style="font-weight:normal">median ${median[r.group].toFixed(1)}</span></td></tr>` : "";
      last = r.group;
      const tv = r.kind === "music" ? (B.mix.music[r.track] ?? 0) : r.trim();
      return head + `<tr data-i="${i}" class="${i === B.focus ? "focus" : ""} ${out ? "out" : ""}">
        <td><button class="btn" data-ref="${i}" title="make this the reference (R plays it)">${B.ref === r.name ? "★" : "☆"}</button></td>
        <td><button class="btn" data-play="${i}">▶</button></td>
        <td>${Lab.esc(r.name)}</td><td class="dim">${Lab.esc(r.bus)}</td>
        <td class="num" title="${Lab.esc(r.metric)}">${r.lufs.toFixed(1)}</td>
        <td class="num" title="${Lab.esc(r.calls.map(c => `${c.db ?? "computed"} dB on ${c.bus} at ${c.at}`).join("\n"))}">${r.code >= 0 ? "+" : ""}${r.code.toFixed(1)}</td>
        <td><input type="range" min="-12" max="12" step="0.5" value="${tv}" data-trim="${i}"> <span class="trimv ${tv ? "on" : ""}">${tv > 0 ? "+" : ""}${(+tv).toFixed(1)}</span></td>
        <td class="num eff" title="${out ? "over 4 dB from its group's median" : ""}">${e.toFixed(1)}</td>
        <td><span class="effbar" style="width:${Math.max(2, 140 * (e - lo) / Math.max(1, hi - lo))}px"></span></td></tr>`;
    }).join("");
    Lab.view().innerHTML = `<div class="page"><h2>Balance</h2>
      <div class="note">Effective level = the file's loudness (a one-shot's loudest moment; a loop's or music level's integrated LUFS) + its
        call site's offset in the code + the mix's trim + its bus: what the game plays, 3D distance aside. ▶ plays at that level (${PAD} dB
        under, so nothing clips). Saving writes the game's mix file; a running game picks it up within a second.</div>
      <div class="row"><span class="lbl">buses</span><div class="faders">${Object.keys(B.data.buses).map(b => `<label>${Lab.esc(b)}
        <input type="range" min="-30" max="12" step="0.5" value="${busDb(b)}" data-bus="${Lab.esc(b)}"><span class="trimv ${B.mix.buses[b] != null ? "on" : ""}">${busDb(b).toFixed(1)}</span></label>`).join("")}</div></div>
      ${Object.keys(B.data.music).length ? `<div class="row"><span class="lbl">music levels</span><div class="faders">${[...new Set(Object.values(B.data.music).flatMap(t => Object.keys(t.levels)))].map(l => `<label>${Lab.esc(l)}
        <input type="range" min="-12" max="12" step="0.5" value="${B.mix.levels[l] || 0}" data-level="${Lab.esc(l)}"><span class="trimv ${B.mix.levels[l] ? "on" : ""}">${(B.mix.levels[l] || 0).toFixed(1)}</span></label>`).join("")}</div></div>` : ""}
      <div class="row"><span class="lbl">show</span><div class="chips">${["all", ...groups].map(g => `<button class="chip ${g === B.group ? "on" : ""}" data-group="${Lab.esc(g)}">${Lab.esc(g)}</button>`).join("")}</div>
        ${Lab.seg([["group", "by group"], ["loud", "loudest first"]], B.sort, "sort")}</div>
      <div class="row"><button class="btn primary" id="bsave" ${dirty ? "" : "disabled"}>${dirty ? "Save (Ctrl+S)" : "Saved"}</button>
        <button class="btn" id="brevert" ${dirty ? "" : "disabled"}>Revert</button>
        <span class="note">reference: ${B.ref ? `<b>${Lab.esc(B.ref)}</b> (R plays it, A plays it then the selected row)` : "none (☆ picks one)"}</span></div>
      <table class="mix"><tr><th></th><th></th><th>sound</th><th>bus</th><th class="num">file LUFS</th><th class="num">code dB</th><th>trim</th><th class="num">effective</th><th></th></tr>${body}</table></div>`;
    const v = Lab.view();
    v.querySelectorAll("[data-play]").forEach(b => b.onclick = () => { B.focus = +b.dataset.play; paint(); play(B.rows[B.focus]); });
    v.querySelectorAll("[data-ref]").forEach(b => b.onclick = () => { const r = B.rows[+b.dataset.ref]; B.ref = B.ref === r.name ? null : r.name; keep(render); });
    v.querySelectorAll("[data-trim]").forEach(el => { el.oninput = () => setTrim(B.rows[+el.dataset.trim], +el.value); el.onchange = () => keep(render); });
    v.querySelectorAll("[data-bus]").forEach(el => el.onchange = () => { B.mix.buses[el.dataset.bus] = +el.value; keep(render); });
    v.querySelectorAll("[data-level]").forEach(el => el.onchange = () => { const x = +el.value; if (x) B.mix.levels[el.dataset.level] = x; else delete B.mix.levels[el.dataset.level]; keep(render); });
    v.querySelectorAll("[data-group]").forEach(b => b.onclick = () => { B.group = b.dataset.group; B.focus = 0; render(); });
    v.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { B.sort = b.dataset.sort; render(); });
    document.getElementById("bsave").onclick = save;
    document.getElementById("brevert").onclick = () => { B.mix = JSON.parse(B.saved); keep(render); };
  }
  function keep(fn) { const p = Lab.view().querySelector(".page"), y = p ? p.scrollTop : 0; fn(); const q = Lab.view().querySelector(".page"); if (q) q.scrollTop = y; }
  function paint() { document.querySelectorAll("table.mix tr[data-i]").forEach(tr => tr.classList.toggle("focus", +tr.dataset.i === B.focus)); }
  function setTrim(r, v) {
    if (r.kind === "music") { if (v) B.mix.music[r.track] = v; else delete B.mix.music[r.track]; }
    else { if (v) B.mix.sounds[r.key] = v; else delete B.mix.sounds[r.key]; }
  }
  function play(r, then) { if (r) Lab.play(r.file, { id: "bal:" + r.name, onEnd: then, volume: Math.pow(10, (r.code + r.trim() + busDb(r.bus) + PAD) / 20) }); }
  async function save() {
    const clean = await (await fetch("/api/mix", { method: "POST", body: JSON.stringify(B.mix) })).json();
    B.mix = { buses: {}, sounds: {}, music: {}, levels: {}, ...clean };
    B.saved = JSON.stringify(B.mix);
    keep(render); Lab.toast("mix saved");
  }
  Lab.register("balance", {
    title: "Balance", show, enabled: () => Lab.project.features.balance,
    keys: [["↑", "previous sound"], ["↓", "next sound"], ["Space", "play at its in-game level"], ["+", "trim up 0.5 dB"], ["-", "trim down 0.5 dB"],
           ["0", "reset the trim"], ["R", "play the reference"], ["A", "reference, then this"], ["Ctrl S", "save the mix"], ["Esc", "stop"]],
    onKey(e) {
      if (!B.data) return;
      const k = e.key, r = B.rows[B.focus];
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); B.focus = Math.max(0, Math.min(B.rows.length - 1, B.focus + (k === "ArrowDown" ? 1 : -1))); paint();
        const tr = document.querySelector(`table.mix tr[data-i="${B.focus}"]`); if (tr) tr.scrollIntoView({ block: "nearest" }); }
      else if (k === " ") { e.preventDefault(); Lab.player.current ? Lab.stop() : play(r); }
      else if ((k === "+" || k === "=" || k === "-") && r) { const cur = r.kind === "music" ? (B.mix.music[r.track] || 0) : r.trim(); setTrim(r, Math.max(-12, Math.min(12, cur + (k === "-" ? -0.5 : 0.5)))); keep(render); play(r); }
      else if (k === "0" && r) { setTrim(r, 0); keep(render); }
      else if (k === "r" || k === "R") play(allRows().find(x => x.name === B.ref));
      else if (k === "a" || k === "A") { const ref = allRows().find(x => x.name === B.ref); if (ref) play(ref, () => setTimeout(() => play(r), 300)); }
      else if (k === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      else if (k === "Escape") Lab.stop();
    },
  });
})();
