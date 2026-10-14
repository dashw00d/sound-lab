// Balance: every shipped sound and music level at its in-game level (file loudness + the code's offset + the mix's
// trim + its bus), trimmed here and saved to the game's mix file, which a running game re-reads live.
(() => {
  const B = { data: null, mix: null, saved: "", rows: [], focus: 0, ref: null, group: "all", sort: "group" };
  const PAD = -12;  // dB under the game's levels, so the loudest sounds don't clip the browser
  const ORDER = ["alerts", "events", "combat", "deaths", "work", "far calls", "ambience", "ui", "voices", "music", "other"];
  const { icon, esc } = Lab;
  const sign = x => `${x > 0 ? "+" : ""}${(+x).toFixed(1)}`;

  async function show() {
    const r = await (await fetch("/api/balance")).json();
    if (!r.balance.sounds) { Lab.showEmpty("sliders", "Nothing measured yet", `<p>Run <code>soundlab balance measure</code>.</p>`); return; }
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
  const trimOf = r => r.kind === "music" ? (B.mix.music[r.track] ?? 0) : r.trim();
  function render() {
    const all = allRows(), groups = [...new Set(all.map(r => r.group))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    B.rows = all.filter(r => B.group === "all" || r.group === B.group)
      .sort((a, b) => B.sort === "loud" ? eff(b) - eff(a) : (ORDER.indexOf(a.group) - ORDER.indexOf(b.group)) || a.name.localeCompare(b.name));
    B.focus = Lab.clamp(B.focus, 0, B.rows.length - 1);
    const median = {};
    for (const g of groups) { const v = all.filter(r => r.group === g).map(eff).sort((a, b) => a - b); median[g] = v[Math.floor(v.length / 2)]; }
    const dirty = JSON.stringify(B.mix) !== B.saved, lo = Math.min(...all.map(eff)) - 1, hi = Math.max(...all.map(eff)) + 1, at = x => `${100 * (x - lo) / (hi - lo)}%`;
    let last = "";
    const body = B.rows.map((r, i) => {
      const e = eff(r), off = e - median[r.group], out = Math.abs(off) > 4, tv = trimOf(r);
      const head = B.sort === "group" && r.group !== last ? `<tr class="grp"><td colspan="7">${esc(r.group)}<small>median ${median[r.group].toFixed(1)}</small></td></tr>` : "";
      last = r.group;
      return head + `<tr class="r ${i === B.focus ? "focus" : ""}" data-i="${i}">
        <td style="width:64px"><span class="row" style="gap:2px;flex-wrap:nowrap"><button class="iconbtn ${B.ref === r.name ? "ref" : ""}" data-ref="${i}" data-tip="Make this the reference (R plays it)">${icon(B.ref === r.name ? "starFill" : "star")}</button>
          <button class="iconbtn" data-play="${i}" data-tip="Play at its in-game level (Space)">${icon("play")}</button></span></td>
        <td class="nm">${esc(r.name)}</td><td class="bus">${esc(r.bus)}</td>
        <td class="num" data-tip="${esc(r.metric)}">${r.lufs.toFixed(1)}</td>
        <td class="num" data-tip="${esc(r.calls.map(c => `${c.db ?? "computed"} dB on ${c.bus} at ${c.at}`).join("\n") || "no call-site offset")}">${sign(r.code)}</td>
        <td><input type="range" class="bipolar" min="-12" max="12" step="0.5" value="${tv}" data-trim="${i}"><span class="trimv ${tv ? "on" : ""}">${sign(tv)}</span></td>
        <td><div class="effcell"><span class="v ${out ? "out" : ""}">${e.toFixed(1)}</span><div class="lvlbar ${out ? "out" : ""}"><div class="f" style="width:${at(e)}"></div>
          <div class="med" style="left:${at(median[r.group])}" data-tip="group median ${median[r.group].toFixed(1)}"></div></div>
          ${out ? `<span class="flag" data-tip="${sign(off)} dB from its group's median">${icon("flag")}</span>` : ""}</div></td></tr>`;
    }).join("");
    const page = document.getElementById("bp"), y = page ? page.scrollTop : 0;
    const levels = [...new Set(Object.values(B.data.music).flatMap(t => Object.keys(t.levels)))];
    Lab.view().innerHTML = `<div class="page" id="bp"><div class="wrap"><div class="page-head"><div>
        <div class="eyebrow">${all.length} sounds and levels · ${groups.length} groups</div><h1>Balance</h1>
        <p class="lede">Effective level = the file's loudness (a one-shot's loudest moment; a loop's or music level's integrated LUFS) + its call
          site's offset in the code + the mix's trim + its bus: what the game plays, 3D distance aside. Play runs at that level (${PAD} dB under, so
          nothing clips). Saving writes the game's mix file, and a running game picks it up within a second.</p></div></div>
      <h3 style="margin-top:0">Buses</h3><div class="consoles">${Object.keys(B.data.buses).map(b => `<div class="card fader"><div class="t">${esc(b)}
        <span class="${B.mix.buses[b] != null ? "on" : ""}">${sign(busDb(b))} dB</span></div><input type="range" min="-30" max="12" step="0.5" value="${busDb(b)}" data-bus="${esc(b)}"></div>`).join("")}</div>
      ${levels.length ? `<h3>Music levels</h3><div class="consoles">${levels.map(l => `<div class="card fader"><div class="t">${esc(l)}<span class="${B.mix.levels[l] ? "on" : ""}">${sign(B.mix.levels[l] || 0)} dB</span></div>
        <input type="range" class="bipolar" min="-12" max="12" step="0.5" value="${B.mix.levels[l] || 0}" data-level="${esc(l)}"></div>`).join("")}</div>` : ""}
      <div class="btools"><div class="chips">${["all", ...groups].map(g => `<button class="chip ${g === B.group ? "on" : ""}" data-group="${esc(g)}">${esc(g)}</button>`).join("")}</div>
        <span class="grow"></span><span class="dim" style="font-size:12.5px">${B.ref ? `Reference <b style="color:var(--pick)">${esc(B.ref)}</b> · <kbd>R</kbd> plays it, <kbd>A</kbd> it then the selected row` : "No reference: ☆ picks one"}</span>
        ${Lab.seg([["group", "By group"], ["loud", "Loudest first"]], B.sort, "sort")}</div>
      <table class="mix"><thead><tr><th></th><th>sound</th><th>bus</th><th class="num">file LUFS</th><th class="num">code dB</th><th>trim</th><th>effective</th></tr></thead><tbody>${body}</tbody></table>
      ${dirty ? `<div class="savebar"><span class="dot"></span><span>Unsaved mix changes</span><button class="btn ghost" id="brevert">Revert</button>
        <button class="btn primary" id="bsave">${icon("save")}Save <kbd>Ctrl S</kbd></button></div>` : ""}</div></div>`;
    document.getElementById("bp").scrollTop = y;
    const v = Lab.view();
    v.querySelectorAll("input[type=range]").forEach(el => { Lab.fillRange(el); el.addEventListener("input", () => Lab.fillRange(el)); el.addEventListener("change", () => el.blur()); });
    v.querySelectorAll("tr.r").forEach(tr => tr.onclick = e => { if (e.target.closest("button, input")) return; B.focus = +tr.dataset.i; paint(); });
    v.querySelectorAll("[data-play]").forEach(b => b.onclick = () => { B.focus = +b.dataset.play; paint(); play(B.rows[B.focus]); });
    v.querySelectorAll("[data-ref]").forEach(b => b.onclick = () => { const r = B.rows[+b.dataset.ref]; B.ref = B.ref === r.name ? null : r.name; render(); });
    v.querySelectorAll("[data-trim]").forEach(el => {
      el.oninput = () => { const r = B.rows[+el.dataset.trim]; setTrim(r, +el.value); const tv = el.nextElementSibling; tv.textContent = sign(+el.value); tv.classList.toggle("on", +el.value !== 0); };
      el.onchange = () => render();
    });
    v.querySelectorAll("[data-bus]").forEach(el => el.onchange = () => { B.mix.buses[el.dataset.bus] = +el.value; render(); });
    v.querySelectorAll("[data-level]").forEach(el => el.onchange = () => { const x = +el.value; if (x) B.mix.levels[el.dataset.level] = x; else delete B.mix.levels[el.dataset.level]; render(); });
    v.querySelectorAll("[data-group]").forEach(b => b.onclick = () => { B.group = b.dataset.group; B.focus = 0; render(); });
    v.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { B.sort = b.dataset.sort; render(); });
    if (dirty) { document.getElementById("bsave").onclick = save; document.getElementById("brevert").onclick = () => { B.mix = JSON.parse(B.saved); render(); }; }
    paint(false);
  }
  function paint(scroll = true) {
    document.querySelectorAll("table.mix tr[data-i]").forEach(tr => tr.classList.toggle("focus", +tr.dataset.i === B.focus));
    const tr = document.querySelector(`table.mix tr[data-i="${B.focus}"]`);
    if (tr && scroll) tr.scrollIntoView({ block: "nearest" });
    const r = B.rows[B.focus];
    Lab.inspect(r ? { id: "bal:" + r.name, url: r.file, title: r.name, sub: `${r.group} · ${r.bus} bus`,
      facts: `file ${r.lufs.toFixed(1)} · code ${sign(r.code)} · trim ${sign(r.trim())} · bus ${sign(busDb(r.bus))} = ${eff(r).toFixed(1)}`,
      play: f => play(r, null, f),
      actions: [{ icon: B.ref === r.name ? "starFill" : "star", label: B.ref === r.name ? "Reference" : "Make reference", cls: "pick", on: B.ref === r.name,
                  run: () => { B.ref = B.ref === r.name ? null : r.name; render(); }, tip: "The reference: R plays it, A plays it then this" }] } : null);
  }
  function setTrim(r, v) {
    if (r.kind === "music") { if (v) B.mix.music[r.track] = v; else delete B.mix.music[r.track]; }
    else { if (v) B.mix.sounds[r.key] = v; else delete B.mix.sounds[r.key]; }
  }
  function play(r, then, from = 0) {
    if (r) Lab.play(r.file, { id: "bal:" + r.name, onEnd: then, from, volume: Math.pow(10, (r.code + r.trim() + busDb(r.bus) + PAD) / 20) });
  }
  async function save() {
    const clean = await (await fetch("/api/mix", { method: "POST", body: JSON.stringify(B.mix) })).json();
    B.mix = { buses: {}, sounds: {}, music: {}, levels: {}, ...clean };
    B.saved = JSON.stringify(B.mix);
    render(); Lab.toast("Mix saved: a running game picks it up within a second", { icon: "check" });
  }
  Lab.register("balance", {
    title: "Balance", icon: "sliders", show, refresh: () => B.data && render(), enabled: () => Lab.project.features.balance,
    keys: [["↑ ↓", "previous / next sound"], ["Space", "play at its in-game level"], ["+ -", "trim up / down 0.5 dB"],
           ["0", "reset the trim"], ["R", "play the reference"], ["A", "the reference, then this"], ["Ctrl S", "save the mix"], ["Esc", "stop"]],
    onKey(e) {
      if (!B.data) return;
      const k = e.key, r = B.rows[B.focus];
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); B.focus = Lab.clamp(B.focus + (k === "ArrowDown" ? 1 : -1), 0, B.rows.length - 1); paint(); }
      else if (k === " ") { e.preventDefault(); Lab.player.current ? Lab.stop() : play(r); }
      else if ((k === "+" || k === "=" || k === "-") && r) { setTrim(r, Lab.clamp(trimOf(r) + (k === "-" ? -0.5 : 0.5), -12, 12)); render(); play(r); }
      else if (k === "0" && r) { setTrim(r, 0); render(); }
      else if (k === "r" || k === "R") play(allRows().find(x => x.name === B.ref));
      else if (k === "a" || k === "A") { const ref = allRows().find(x => x.name === B.ref); if (ref) play(ref, () => setTimeout(() => play(r), 300)); }
      else if (k === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      else if (k === "Escape") Lab.stop();
    },
  });
})();
