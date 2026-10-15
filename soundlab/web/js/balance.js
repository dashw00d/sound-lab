// Balance: every shipped sound and music level at its in-game level, trimmed here and saved to the game's mix file,
// which a running game re-reads live. Two kinds of mix file (soundlab/balance.py):
//  - a sound table ("version": 2): the game plays events, and the page shows exactly the game's sum, file loudness +
//    event dB + category dB + bus dB; the sliders edit the table's own dBs (events, categories, buses, music);
//  - a trims-only mix: file loudness + the code's offset (read from its call sites) + the mix's trim + the bus.
(() => {
  const B = { data: null, mix: null, saved: "", base: "0", stale: false, rows: [], focus: 0, focusName: null, ref: null, group: "all", sort: "group", v2: false };
  const PAD = -12;  // dB under the game's levels, so the loudest sounds don't clip the browser
  const ORDER = ["alerts", "alert", "stinger", "events", "reward", "ui", "voice", "voices", "speech", "combat", "death", "deaths",
                 "battle_cry", "world", "world_2d", "work", "far calls", "far", "thunder", "ambience", "bed", "battle_bed", "fire", "music", "other"];
  const { icon, esc } = Lab;
  const sign = x => `${x > 0 ? "+" : ""}${(+x).toFixed(1)}`;
  const ord = g => { const i = ORDER.indexOf(g); return i < 0 ? ORDER.length : i; };

  const show = () => load(false);
  // Re-entering the tab keeps unsaved edits (force: Revert, which reads the files again).
  async function load(force) {
    if (!force && B.data && levels() !== B.saved) { render(); Lab.toast("Kept your unsaved mix changes"); return; }
    let r;
    try {
      const res = await fetch("/api/balance");
      r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
    } catch (e) {
      if (Lab.tab === "balance") Lab.showEmpty("sliders", "Couldn't load the mix", `<p>${esc(e.message || String(e))}. Is the server running?</p>`);
      return;
    }
    if (Lab.tab !== "balance") return;  // (switched away while it loaded)
    B.v2 = (r.version || 1) >= 2;  // (the mix file's kind, as the server will read a save)
    if (!r.balance || !(B.v2 ? r.balance.events : r.balance.sounds)) { Lab.showEmpty("sliders", "Nothing measured yet", `<p>Run <code>soundlab balance measure</code>.</p>`); return; }
    B.data = r.balance;
    B.data.buses ||= {}; B.data.music ||= {};
    adopt(r.mix);
    B.base = r.base || "0"; B.stale = false;
    B.saved = levels();
    render();
  }
  function adopt(mix) {
    if (B.v2) {
      B.mix = JSON.parse(JSON.stringify(mix || {}));
      for (const k of ["buses", "categories", "sounds", "music"]) B.mix[k] ||= {};
      B.mix.music.levels ||= {}; B.mix.music.tracks ||= {};
    } else {
      B.mix = { buses: {}, sounds: {}, music: {}, levels: {}, ...mix };
      for (const k of ["buses", "sounds", "music", "levels"]) B.mix[k] = { ...(B.mix[k] || {}) };
    }
  }

  // What saving sends (and what "unsaved" compares): the levels only.
  function levels() {
    if (!B.v2) return JSON.stringify(B.mix);
    const t = B.mix, mu = t.music || {};  // (a table may lack sections)
    return JSON.stringify({ version: 2, buses: t.buses || {},
      categories: Object.fromEntries(Object.entries(t.categories || {}).map(([c, v]) => [c, v.db || 0])),
      sounds: Object.fromEntries(Object.entries(t.sounds || {}).map(([s, v]) => [s, v.db || 0])),
      music: { levels: mu.levels || {}, tracks: mu.tracks || {} } });
  }
  const busDb = bus => ((B.mix.buses || {})[bus]) ?? (B.v2 ? 0 : (B.data.buses || {})[bus] ?? 0);
  const buses = () => Object.keys((B.v2 ? B.mix.buses : B.data.buses) || {});
  const mtrim = () => B.v2 ? ((B.mix.music ||= {}).tracks ||= {}) : (B.mix.music ||= {});
  const mlevels = () => B.v2 ? ((B.mix.music ||= {}).levels ||= {}) : (B.mix.levels ||= {});

  function allRows() {
    const rows = [];
    if (B.v2) {
      for (const [id, e] of Object.entries(B.data.events)) {
        const def = (B.mix.sounds || {})[id];
        if (!def || !e.takes || !e.takes.length) continue;
        const cat = (B.mix.categories || {})[def.cat] || { bus: "SFX", db: 0, space: "2d" };
        // (a category with its own zoom curve: its level at the reference zoom, as the game computes it)
        const ref = (B.mix.spatial || {}).reference_m || 60, z = cat.zoom;
        const zoom = z && (cat.space === "3d" || cat.space === "loop") ? Math.max(z.at_ref_db - z.db_per_doubling * Math.log2(Math.max(ref, z.ref_m) / z.ref_m), z.min_db) : 0;
        rows.push({ kind: "event", name: id, group: def.cat, bus: cat.bus, lufs: e.lufs, metric: e.metric, file: Lab.shippedUrl(e.file),
                    space: cat.space, takes: e.takes, code: (cat.db || 0) + zoom, trim: () => B.mix.sounds[id].db || 0,
                    set: v => { B.mix.sounds[id].db = v; },
                    codeTip: `category ${def.cat}: ${sign(cat.db || 0)} dB (${cat.space}${cat.space === "3d" ? ": on screen at the reference zoom" : ""})`
                      + (zoom ? `\nits zoom curve at ${ref} m: ${sign(zoom)} dB (${sign(z.at_ref_db)} dB fully in at ${z.ref_m} m, ${z.db_per_doubling} dB down per doubling)` : "") });
      }
    } else {
      const codeDb = s => { const v = (s.calls || []).map(c => c.db).filter(x => x != null); return v.length ? Math.max(...v) : 0; };
      for (const [name, s] of Object.entries(B.data.sounds)) {
        const key = B.mix.sounds[name] != null ? name : (B.mix.sounds[s.base] != null ? s.base : name);
        rows.push({ kind: "sound", name, group: s.group, bus: s.bus, lufs: s.lufs, metric: s.metric, code: codeDb(s),
                    file: Lab.shippedUrl(s.file), trim: () => B.mix.sounds[key] || 0,
                    set: v => { if (v) B.mix.sounds[key] = v; else delete B.mix.sounds[key]; },
                    codeTip: (s.calls || []).map(c => `${c.db ?? "computed"} dB on ${c.bus} at ${c.at}`).join("\n") || "no call-site offset" });
      }
    }
    for (const [id, t] of Object.entries(B.data.music)) for (const [lv, f] of Object.entries(t.levels || {})) {
      // (a track's own trim wins, else its context's: see "The mix" in the game's audio README)
      const own = () => mtrim()[id] ?? mtrim()[t.context] ?? 0, inherited = () => mtrim()[t.context] ?? 0;
      rows.push({ kind: "music", name: `${id} · ${lv}`, group: "music", bus: "Music", lufs: f.lufs, metric: "integrated", code: 0,
                  file: Lab.shippedUrl(f.file), track: id, level: lv, codeTip: "", own,
                  trim: () => own() + (mlevels()[lv] || 0),
                  // (equal to what the context already gives: no key of its own; else its own, even 0 to undo a context's trim)
                  set: v => { if (v === inherited()) delete mtrim()[id]; else mtrim()[id] = v; } });
    }
    return rows;
  }
  const eff = r => r.lufs + r.code + r.trim() + busDb(r.bus);
  const trimOf = r => r.kind === "music" ? r.own() : r.trim();

  // Each group's median effective level, and where a level sits on the bars.
  function stats(all, groups) {
    const median = {};
    for (const g of groups) { const v = all.filter(r => r.group === g).map(eff).sort((a, b) => a - b); median[g] = v[Math.floor(v.length / 2)]; }
    const lo = Math.min(...all.map(eff)) - 1, hi = Math.max(...all.map(eff)) + 1;
    return { median, at: x => `${100 * (x - lo) / (hi - lo)}%` };
  }

  function render() {
    const all = allRows(), groups = [...new Set(all.map(r => r.group))].sort((a, b) => ord(a) - ord(b));
    B.rows = all.filter(r => B.group === "all" || r.group === B.group)
      .sort((a, b) => B.sort === "loud" ? eff(b) - eff(a) : (ord(a.group) - ord(b.group)) || a.name.localeCompare(b.name));
    const kept = B.rows.findIndex(r => r.name === B.focusName);  // (the focus follows its row when a new level re-sorts them)
    B.focus = kept >= 0 ? kept : Lab.clamp(B.focus, 0, B.rows.length - 1);
    const { median, at } = stats(all, groups);
    const dirty = levels() !== B.saved;
    const [tmin, tmax] = B.v2 ? [-24, 12] : [-12, 12];
    let last = "";
    const body = B.rows.map((r, i) => {
      const e = eff(r), off = e - median[r.group], out = Math.abs(off) > 4, tv = trimOf(r);
      const head = B.sort === "group" && r.group !== last ? `<tr class="grp"><td colspan="7">${esc(r.group)}<small data-gmed="${esc(r.group)}">median ${median[r.group].toFixed(1)}</small></td></tr>` : "";
      last = r.group;
      const takes = r.takes && r.takes.length > 1 ? ` <small class="dim" data-tip="${esc(r.takes.map(t => `${t.file}: ${t.lufs.toFixed(1)}`).join("\n"))}">×${r.takes.length}</small>` : "";
      return head + `<tr class="r ${i === B.focus ? "focus" : ""}" data-i="${i}">
        <td style="width:64px"><span class="row" style="gap:2px;flex-wrap:nowrap"><button class="iconbtn ${B.ref === r.name ? "ref" : ""}" data-ref="${i}" data-tip="Make this the reference (R plays it)">${icon(B.ref === r.name ? "starFill" : "star")}</button>
          <button class="iconbtn" data-play="${i}" data-tip="Play at its in-game level (Space)">${icon("play")}</button></span></td>
        <td class="nm">${esc(r.name)}${takes}</td><td class="bus">${esc(r.bus)}${r.space === "3d" ? ` <small class="dim" data-tip="positional: this level on screen at the reference zoom; off screen and zoomed out it falls">3d</small>` : ""}</td>
        <td class="num" data-tip="${esc(r.metric)}">${r.lufs.toFixed(1)}</td>
        <td class="num" data-tip="${esc(r.codeTip)}">${sign(r.code)}</td>
        <td><input type="range" class="bipolar" min="${tmin}" max="${tmax}" step="0.5" value="${tv}" data-trim="${i}"><span class="trimv ${tv ? "on" : ""}">${sign(tv)}</span></td>
        <td><div class="effcell"><span class="v ${out ? "out" : ""}">${e.toFixed(1)}</span><div class="lvlbar ${out ? "out" : ""}"><div class="f" style="width:${at(e)}"></div>
          <div class="med" style="left:${at(median[r.group])}" data-tip="group median ${median[r.group].toFixed(1)}"></div></div>
          <span class="flag" style="${out ? "" : "display:none"}" data-tip="${sign(off)} dB from its group's median">${icon("flag")}</span></div></td></tr>`;
    }).join("");
    const page = document.getElementById("bp"), y = page ? page.scrollTop : 0;
    const lvls = [...new Set(Object.values(B.data.music).flatMap(t => Object.keys(t.levels || {})))];
    const fader = (label, val, attr, key, on, min = -12, max = 12) => `<div class="card fader"><div class="t">${esc(label)}<span class="${on ? "on" : ""}">${sign(val)} dB</span></div>
        <input type="range" class="bipolar" min="${min}" max="${max}" step="0.5" value="${val}" data-${attr}="${esc(key)}"></div>`;
    const cats = B.v2 ? Object.entries(B.mix.categories || {}).filter(([c]) => all.some(r => r.group === c)).sort((a, b) => ord(a[0]) - ord(b[0])) : [];
    const lede = B.v2
      ? `Effective level = the file's loudness (a one-shot's loudest moment; a loop's or music level's integrated LUFS; an event's loudest take) + the event's dB +
          its category's dB + its bus: the game's own sum, from its sound table. Positional (3d) sounds are shown on screen at the reference zoom; off screen
          and zoomed out the game lowers them. Play runs at that level (${PAD} dB under, so nothing clips). Saving writes the table's levels, and a running game picks them up within a second.`
      : `Effective level = the file's loudness (a one-shot's loudest moment; a loop's or music level's integrated LUFS) + its call
          site's offset in the code + the mix's trim + its bus: what the game plays, 3D distance aside. Play runs at that level (${PAD} dB under, so
          nothing clips). Saving writes the game's mix file, and a running game picks it up within a second.`;
    const warn = B.v2 && ((B.data.missing || []).length || (B.data.unreached || []).length)
      ? `<div class="warn">${icon("flag")}${(B.data.missing || []).length ? `Events with no file: ${esc(B.data.missing.join(", "))}. ` : ""}${(B.data.unreached || []).length ? `Files no event plays: ${esc(B.data.unreached.join(", "))}.` : ""}</div>` : "";
    // The table's dynamic mix (what the game does on top of these levels, in play): snapshots, ducks, bus effects.
    const sgn = x => `${x > 0 ? "+" : ""}${x}`;
    const dyn = !B.v2 ? [] : [
      ...Object.entries(B.mix.snapshots || {}).map(([n, v]) => `snapshot <b>${esc(n)}</b> (${esc(v.drive || "")} ${v.from}..${v.full}): ${Object.entries(v.buses || {}).map(([b, d]) => `${esc(b)} ${sgn(d)} dB`).join(", ")}`),
      ...Object.entries(B.mix.ducks || {}).map(([n, v]) => `duck <b>${esc(n)}</b>: ${Object.entries(v.buses || {}).map(([b, d]) => `${esc(b)} ${sgn(d)} dB`).join(", ")}`),
      ...Object.entries(B.mix.effects || {}).flatMap(([bus, fx]) => fx.map(f => `${esc(bus)} <b>${esc(f.type)}</b> ${f.type === "compressor" ? `${f.threshold_db} dB, ${f.ratio}:1` : `ceiling ${f.ceiling_db} dB`}`)),
    ];
    const dynHtml = dyn.length ? `<div class="facts" style="flex-wrap:wrap;margin-bottom:14px"><span>In play the game also applies (from the same table): ${dyn.join(" · ")}. The levels below are without them.</span></div>` : "";
    Lab.view().innerHTML = `<div class="page" id="bp"><div class="wrap"><div class="page-head"><div>
        <div class="eyebrow">${all.length} ${B.v2 ? "events" : "sounds"} and levels · ${groups.length} ${B.v2 ? "categories" : "groups"}</div><h1>Balance</h1>
        <p class="lede">${lede}</p></div></div>${warn}${dynHtml}
      <h3 style="margin-top:0">Buses</h3><div class="consoles">${buses().map(b => fader(b, busDb(b), "bus", b, B.v2 ? busDb(b) !== 0 : B.mix.buses[b] != null, -30, 12)).join("")}</div>
      ${cats.length ? `<h3>Categories</h3><div class="consoles">${cats.map(([c, v]) => fader(`${c} · ${v.bus}`, v.db || 0, "cat", c, !!v.db)).join("")}</div>` : ""}
      ${lvls.length ? `<h3>Music levels</h3><div class="consoles">${lvls.map(l => fader(l, mlevels()[l] || 0, "level", l, !!mlevels()[l])).join("")}</div>` : ""}
      <div class="btools"><div class="chips">${["all", ...groups].map(g => `<button class="chip ${g === B.group ? "on" : ""}" data-group="${esc(g)}">${esc(g)}</button>`).join("")}</div>
        <span class="grow"></span><span class="dim" style="font-size:12.5px">${B.ref ? `Reference <b style="color:var(--pick)">${esc(B.ref)}</b> · <kbd>R</kbd> plays it, <kbd>A</kbd> it then the selected row` : "No reference: ☆ picks one"}</span>
        ${Lab.seg([["group", B.v2 ? "By category" : "By group"], ["loud", "Loudest first"]], B.sort, "sort")}</div>
      <table class="mix"><thead><tr><th></th><th>${B.v2 ? "event" : "sound"}</th><th>bus</th><th class="num">file LUFS</th><th class="num">${B.v2 ? "category dB" : "code dB"}</th><th>${B.v2 ? "level" : "trim"}</th><th>effective</th></tr></thead><tbody>${body}</tbody></table>
      <div class="savebar" id="sbar" style="${dirty ? "" : "display:none"}"><span class="dot"></span><span id="sbmsg">${saveMsg()}</span><button class="btn ghost" id="brevert">Revert</button>
        <button class="btn primary" id="bsave">${icon("save")}Save <kbd>Ctrl S</kbd></button></div></div></div>`;
    document.getElementById("bp").scrollTop = y;
    const v = Lab.view();
    v.querySelectorAll("input[type=range]").forEach(el => { Lab.fillRange(el); el.addEventListener("input", () => Lab.fillRange(el)); el.addEventListener("change", () => el.blur()); });
    v.querySelectorAll("tr.r").forEach(tr => tr.onclick = e => { if (e.target.closest("button, input")) return; B.focus = +tr.dataset.i; paint(); });
    v.querySelectorAll("[data-play]").forEach(b => b.onclick = () => { B.focus = +b.dataset.play; paint(); play(B.rows[B.focus]); });
    v.querySelectorAll("[data-ref]").forEach(b => b.onclick = () => { const r = B.rows[+b.dataset.ref]; B.ref = B.ref === r.name ? null : r.name; render(); });
    // (dragging a fader changes the mix as it moves: its label, every effective level and the save bar follow; letting go re-sorts)
    const fade = (el, apply, on) => {
      el.oninput = () => {
        const x = +el.value; apply(x);
        const lab = el.closest(".fader").querySelector(".t span"); lab.textContent = `${sign(x)} dB`; lab.classList.toggle("on", on(x));
        live();
      };
      el.onchange = () => render();
    };
    v.querySelectorAll("[data-trim]").forEach(el => {
      el.oninput = () => { const r = B.rows[+el.dataset.trim]; r.set(+el.value); const tv = el.nextElementSibling; tv.textContent = sign(+el.value); tv.classList.toggle("on", +el.value !== 0); live(); };
      el.onchange = () => render();
    });
    v.querySelectorAll("[data-bus]").forEach(el => fade(el, x => { B.mix.buses[el.dataset.bus] = x; }, x => B.v2 ? x !== 0 : true));
    v.querySelectorAll("[data-cat]").forEach(el => fade(el, x => { B.mix.categories[el.dataset.cat].db = x; }, x => x !== 0));
    v.querySelectorAll("[data-level]").forEach(el => fade(el, x => { if (x) mlevels()[el.dataset.level] = x; else delete mlevels()[el.dataset.level]; }, x => x !== 0));
    v.querySelectorAll("[data-group]").forEach(b => b.onclick = () => { B.group = b.dataset.group; B.focus = 0; B.focusName = null; render(); });
    v.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { B.sort = b.dataset.sort; render(); });
    document.getElementById("bsave").onclick = save; document.getElementById("brevert").onclick = () => load(true);
    paint(false);
  }
  const saveMsg = () => B.stale ? "The mix file changed since this page loaded it: Revert to read it, then redo the changes" : "Unsaved mix changes";
  // The numbers that depend on the levels, updated in place (so a slider being dragged isn't rebuilt under the pointer).
  function live() {
    const all = allRows(), groups = [...new Set(all.map(r => r.group))], { median, at } = stats(all, groups);
    document.querySelectorAll("table.mix tr.r").forEach(tr => {
      const r = B.rows[+tr.dataset.i];
      if (!r) return;
      const e = eff(r), off = e - median[r.group], out = Math.abs(off) > 4, v = tr.querySelector(".effcell .v"), bar = tr.querySelector(".lvlbar"), fl = tr.querySelector(".flag");
      v.textContent = e.toFixed(1); v.classList.toggle("out", out); bar.classList.toggle("out", out);
      bar.querySelector(".f").style.width = at(e);
      const med = bar.querySelector(".med"); med.style.left = at(median[r.group]); med.dataset.tip = `group median ${median[r.group].toFixed(1)}`;
      fl.style.display = out ? "" : "none"; fl.dataset.tip = `${sign(off)} dB from its group's median`;
    });
    document.querySelectorAll("[data-gmed]").forEach(sm => { sm.textContent = `median ${median[sm.dataset.gmed].toFixed(1)}`; });
    const sb = document.getElementById("sbar");
    if (sb) { sb.style.display = levels() !== B.saved ? "" : "none"; document.getElementById("sbmsg").textContent = saveMsg(); }
    paint(false);
  }
  function paint(scroll = true) {
    document.querySelectorAll("table.mix tr[data-i]").forEach(tr => tr.classList.toggle("focus", +tr.dataset.i === B.focus));
    const tr = document.querySelector(`table.mix tr[data-i="${B.focus}"]`);
    if (tr && scroll) tr.scrollIntoView({ block: "nearest" });
    const r = B.rows[B.focus];
    B.focusName = r ? r.name : null;
    Lab.inspect(r ? { id: "bal:" + r.name, url: r.file, title: r.name, sub: `${r.group} · ${r.bus} bus`,
      facts: `file ${r.lufs.toFixed(1)} · ${B.v2 ? "category" : "code"} ${sign(r.code)} · ${B.v2 ? "level" : "trim"} ${sign(r.trim())} · bus ${sign(busDb(r.bus))} = ${eff(r).toFixed(1)}`,
      play: f => play(r, null, f),
      actions: [{ icon: B.ref === r.name ? "starFill" : "star", label: B.ref === r.name ? "Reference" : "Make reference", cls: "pick", on: B.ref === r.name,
                  run: () => { B.ref = B.ref === r.name ? null : r.name; render(); }, tip: "The reference: R plays it, A plays it then this" }] } : null);
  }
  function play(r, then, from = 0) {
    if (r) Lab.play(r.file, { id: "bal:" + r.name, onEnd: then, from, volume: Math.pow(10, (r.code + r.trim() + busDb(r.bus) + PAD) / 20) });
  }
  async function save() {
    let res, body;
    try {
      res = await Lab.post("/api/mix", { base: B.base, version: B.v2 ? 2 : 1, mix: JSON.parse(levels()) });
      body = await res.json().catch(() => ({}));
    } catch { Lab.toast("Couldn't save the mix: is the server running?", { icon: "x" }); return; }
    if (res.status === 409) {  // (the file changed since this page read it: saving would overwrite those levels)
      B.stale = true; live();
      Lab.toast("The mix file changed since this page loaded: Revert to read it", { icon: "x" });
      return;
    }
    if (!res.ok) { Lab.toast(`Couldn't save the mix: ${body.error || res.status}`, { icon: "x" }); return; }
    adopt(body.mix);
    B.base = body.base || "0"; B.stale = false;
    B.saved = levels();
    render(); Lab.toast("Mix saved: a running game picks it up within a second", { icon: "check" });
  }
  // Shipped files changed (a promote, a regenerated set): read the measurements again, in case they were redone.
  Lab.onFlush(async () => {
    if (!B.data) return;
    try {
      const r = await (await fetch("/api/balance")).json();
      if (!r.balance || (r.version || 1) >= 2 !== B.v2 || !(B.v2 ? r.balance.events : r.balance.sounds)) return;
      B.data = r.balance; B.data.buses ||= {}; B.data.music ||= {};
      if (Lab.tab === "balance") render();
    } catch { /* server restarting */ }
  });
  Lab.register("balance", {
    title: "Balance", icon: "sliders", show, refresh: () => B.data && render(), enabled: () => Lab.project.features.balance,
    keys: [["↑ ↓", "previous / next sound"], ["Space", "play at its in-game level"], ["+ -", "level up / down 0.5 dB"],
           ["0", "reset (a trim) or 0 dB (an event)"], ["R", "play the reference"], ["A", "the reference, then this"], ["Ctrl S", "save the mix"], ["Esc", "stop"]],
    onKey(e) {
      if (!B.data) return;
      const k = e.key, r = B.rows[B.focus];
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); B.focus = Lab.clamp(B.focus + (k === "ArrowDown" ? 1 : -1), 0, B.rows.length - 1); paint(); }
      else if (k === " ") { e.preventDefault(); Lab.player.current ? Lab.stop() : play(r); }
      else if ((k === "+" || k === "=" || k === "-") && r) { r.set(Lab.clamp(trimOf(r) + (k === "-" ? -0.5 : 0.5), B.v2 ? -24 : -12, 12)); render(); paint(); play(r); }
      else if (k === "0" && r) { r.set(0); render(); paint(); }
      else if (k === "r" || k === "R") play(allRows().find(x => x.name === B.ref));
      else if (k === "a" || k === "A") { const ref = allRows().find(x => x.name === B.ref); if (ref) play(ref, () => setTimeout(() => play(r), 300)); }
      else if (k === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      else if (k === "Escape") Lab.stop();
    },
  });
})();
