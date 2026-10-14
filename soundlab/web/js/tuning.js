// Tuning: how each model wants its prompts, which model makes what, and the user's taste (tuning.json), with the
// evidence from this project's votes. Agents read it before writing a prompt (`soundlab tuning`) and add what they
// learn; the user's own rules and taste are instructions. Edits save as you type; a save based on an older copy
// (an agent wrote the file meanwhile) is refused, and the page reloads instead of overwriting it.
(() => {
  const T = { data: null, base: 0, ev: {}, tasks: {}, commands: {}, engines: {}, model: null, filter: "all", dirty: false, timer: 0 };
  const { icon, esc } = Lab, $ = id => document.getElementById(id);
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = p => p + Math.random().toString(36).slice(2, 8);
  const models = () => Object.entries(T.data.models);
  const cur = () => T.data.models[T.model];
  const uses = id => Object.keys(T.tasks).filter(k => T.data.tasks[k].model === id);

  async function show() {
    const r = await (await fetch("/api/tuning")).json();
    if (Lab.tab !== "tuning") return;
    Object.assign(T, { data: r.tuning, base: r.base, ev: r.evidence, tasks: r.tasks, commands: r.commands, engines: r.engines, dirty: false });
    if (!T.data.models[T.model]) T.model = (T.data.tasks.sfx && T.data.tasks.sfx.model) || Object.keys(T.data.models)[0] || null;
    render();
  }
  const keep = fn => { const p = $("tp"), y = p ? p.scrollTop : 0; fn(); const q = $("tp"); if (q) q.scrollTop = y; };
  function render() {
    const t = T.data, m = cur();
    Lab.view().innerHTML = `<div class="page" id="tp"><div class="wrap tuning">
      <div class="page-head"><div><div class="eyebrow">Prompt tuning · the starting point for every prompt</div><h1>Tuning</h1>
        <p class="lede">How each model wants its prompts, which model makes what, and what you like. Agents read this before they write a
          prompt (<code>soundlab tuning</code>) and add what your votes teach them. Your rules and taste are instructions; theirs are
          hypotheses, with the evidence beside them.</p></div><span class="savestate" id="tsave">${icon("check")}saved</span></div>

      <h3>Who makes what</h3>
      <div class="routes">${Object.entries(T.tasks).map(([k, label]) => { const mm = t.models[t.tasks[k].model]; return `<div class="card route">
        <div class="t"><b>${esc(label)}</b><code>${esc(T.commands[k])}</code></div>
        <select data-route="${k}">${models().map(([id, x]) => `<option value="${esc(id)}" ${id === t.tasks[k].model ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
          ${models().length ? "" : `<option>no models yet</option>`}</select>
        ${mm ? `<div class="eng ${mm.engine}"><i></i>${esc(T.engines[mm.engine])}</div>` : ""}
        <textarea rows="1" data-tnote="${k}" placeholder="A note for agents about this task…">${esc(t.tasks[k].note)}</textarea></div>`; }).join("")}</div>

      <h3>Your taste<span class="h3sub">for every model</span></h3>
      <div class="taste">${t.taste.map((x, i) => `<div class="tst ${x.by}">${icon(x.by === "user" ? "pen" : "flag")}
          <textarea rows="1" data-taste="${i}" spellcheck="true">${esc(x.text)}</textarea>
          <button class="by ${x.by}" data-adopt-taste="${i}" data-tip="${x.by === "user" ? "Yours: an instruction agents follow and never change" : "An agent's reading of your votes: click to make it yours"}">${x.by === "user" ? "Yours" : "Agent"}</button>
          <span class="date">${esc(x.added)}</span><button class="iconbtn" data-del-taste="${i}" data-tip="Remove">${icon("x")}</button></div>`).join("")}
        <div class="add">${icon("pen")}<input type="text" id="addTaste" placeholder="Add something you like or dislike: how things should sound, which styles win you over…  (Enter)"></div></div>

      <h3>Models</h3>
      <div class="mtabs">${models().map(([id, x]) => `<button class="${id === T.model ? "on" : ""}" data-model="${esc(id)}"><b>${esc(x.name)}</b>
          <small>${uses(id).length ? `${uses(id).length} task${uses(id).length === 1 ? "" : "s"}` : "unused"} · ${x.rules.length} rules</small></button>`).join("")}
        <button class="addm" id="addModel">${icon("plus")}Add a model</button></div>
      ${m ? model(m) : `<div class="card none">No models yet: add the one you generate with.</div>`}
    </div></div>`;
    wire();
  }
  function model(m) {
    const k = T.filter, rules = m.rules.map((r, i) => ({ r, i })).filter(({ r }) => k === "all" || !r.tasks.length || r.tasks.includes(k))
      .sort((a, b) => (b.r.pinned - a.r.pinned) || ((a.r.by !== "user") - (b.r.by !== "user")));
    const used = uses(T.model);
    return `<section class="card model">
      <div class="mhead"><input type="text" class="mname" data-mf="name" value="${esc(m.name)}" spellcheck="false">
        <input type="text" class="mid" id="mid" value="${esc(T.model)}" spellcheck="false" data-tip="Its id: what takes record as their model">
        <select data-mf="engine">${Object.entries(T.engines).map(([e, l]) => `<option value="${e}" ${e === m.engine ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <span class="grow"></span><button class="btn ghost" id="delModel" ${used.length ? "disabled" : ""} data-tip="${used.length ? "It makes a task: give the task to another model first" : "Remove this model's guide"}">Remove</button></div>
      <textarea class="msum" rows="2" data-mf="summary" placeholder="What this model is and how it behaves: what it was trained on, what it's good and bad at…">${esc(m.summary)}</textarea>

      <div class="msub"><span class="lbl">Rules</span>${Lab.seg([["all", "Every task"], ...Object.entries(T.tasks)], k, "rf")}<span class="grow"></span>
        <button class="btn" id="addRule">${icon("plus")}Add a rule</button></div>
      <div class="rules">${rules.map(({ r, i }) => `<div class="rule ${r.by} ${r.pinned ? "pinned" : ""}" data-i="${i}">
          <button class="pin" data-pin="${i}" data-tip="${r.pinned ? "Pinned: read first" : "Pin: read first"}">${icon(r.pinned ? "starFill" : "star")}</button>
          <div class="body"><textarea rows="1" data-rule="${i}" data-f="text" placeholder="The rule, as an instruction…">${esc(r.text)}</textarea>
            <input type="text" class="why" data-rule="${i}" data-f="why" placeholder="Why: the evidence or the reason…" value="${esc(r.why)}">
            <div class="meta"><span class="scope">${Object.entries(T.tasks).map(([t, l]) => `<button class="chip ${r.tasks.includes(t) ? "on" : ""}" data-scope="${i}" data-task="${t}">${esc(l)}</button>`).join("")}
              ${r.tasks.length ? "" : `<span class="faint">every task</span>`}</span><span class="grow"></span>
              <button class="by ${r.by}" data-adopt="${i}" data-tip="${r.by === "user" ? "Yours: an instruction agents follow and never change" : "An agent's hypothesis: click to make it yours"}">${r.by === "user" ? "Yours" : "Agent"}</button>
              <span class="date">${esc(r.added)}</span></div></div>
          <button class="iconbtn" data-delrule="${i}" data-tip="Remove">${icon("x")}</button></div>`).join("") || `<div class="none">No rules${k === "all" ? "" : " for this task"} yet.</div>`}</div>

      <div class="msub"><span class="lbl">Prompt shapes</span><span class="faint">what a prompt for each task looks like, with {slots}</span></div>
      <div class="tpls">${Object.entries(T.tasks).map(([t, l]) => `<label class="tpl"><span>${esc(l)}</span>
        <textarea rows="1" class="mono" data-tpl="${t}" placeholder="—">${esc(m.templates[t] || "")}</textarea></label>`).join("")}</div>

      <div class="msub"><span class="lbl">Examples</span><span class="grow"></span><button class="btn" id="addEx">${icon("plus")}Add an example</button></div>
      <div class="exs">${m.examples.map((x, i) => { const c = x.take && Lab.S.clips[x.take]; return `<div class="ex ${x.verdict}">
          <div class="exh"><button class="pill ${x.verdict === "good" ? "good" : "bad"}" data-verdict="${i}" data-tip="Click to flip">${icon(x.verdict === "good" ? "up" : "down")}${x.verdict === "good" ? "Good" : "Bad"}</button>
            <select data-ex="${i}" data-f="task">${Object.entries(T.tasks).map(([t, l]) => `<option value="${t}" ${t === x.task ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
            <span class="grow"></span>${c && !c.failed ? `<button class="iconbtn explay" data-play-id="${esc(x.take)}" data-take="${esc(x.take)}" data-tip="Play ${esc(x.take)}">${icon("play")}${icon("stop")}</button>` : ""}
            <button class="iconbtn" data-delex="${i}" data-tip="Remove">${icon("x")}</button></div>
          <textarea rows="2" class="mono" data-ex="${i}" data-f="prompt" placeholder="The prompt…">${esc(x.prompt)}</textarea>
          <input type="text" data-ex="${i}" data-f="why" placeholder="Why it works, or doesn't…" value="${esc(x.why)}">
          <input type="text" class="take" data-ex="${i}" data-f="take" placeholder="A take id to listen to (optional)" value="${esc(x.take)}"></div>`; }).join("") || `<div class="none">No examples yet.</div>`}</div>

      <div class="msub"><span class="lbl">Evidence in ${esc(Lab.project.name)}</span><span class="faint">from your picks and votes, for this model</span></div>
      ${evidence(T.ev[T.model] || {})}
    </section>`;
  }
  function evidence(e) {
    const out = [];
    if (e.sfx) {
      const s = e.sfx, main = s.styles.filter(r => r.offered >= s.few), top = Math.max(.01, ...main.map(r => r.rate));
      out.push(`<div class="facts"><span><b>${s.takes}</b> sound-effect takes of <b>${s.sounds}</b> sounds</span><span><b>${s.silent}</b> silent</span>
        ${s.gen_s != null ? `<span>median <b>${s.gen_s} s</b> per take</span>` : ""}</div>
        <table class="stats"><thead><tr><th>prompt style</th><th>win rate</th><th>sounds offered</th><th>picked</th><th>takes</th><th>silent</th><th>up</th><th>down</th><th>median words</th></tr></thead><tbody>
        ${s.styles.map((r, i) => `${r.offered < s.few && (i === 0 || s.styles[i - 1].offered >= s.few) ? `<tr class="split"><td colspan="9">Tried on fewer than ${s.few} sounds</td></tr>` : ""}
          <tr class="${r.offered < s.few ? "few" : ""}"><td>${esc(r.style)}</td><td class="rate"><div class="rbar ${r === main[0] ? "best" : ""}"><div class="track"><div style="width:${Math.min(100, 100 * r.rate / top)}%"></div></div><b>${Math.round(100 * r.rate)}%</b></div></td>
          <td>${r.offered}</td><td>${r.picked}</td><td>${r.takes}</td><td>${r.silent}</td><td>${r.up}</td><td>${r.down}</td><td>${r.words}</td></tr>`).join("")}</tbody></table>`);
    }
    if (e.alerts) out.push(`<div class="facts"><span>alerts: picked ${Object.entries(e.alerts.picked).map(([k, n]) => `<b>${esc(k)}</b> for ${n} of ${e.alerts.alerts}`).join(", ")}</span></div>`);
    if (e.instruments) out.push(`<div class="facts"><span>instruments: ${Object.entries(e.instruments).map(([k, n]) => `<b>${n}</b> ${esc(k)}`).join(" · ")}</span></div>`);
    if (e.music) out.push(`<div class="facts"><span>music: <b>${e.music.sets}</b> sets, <b>${e.music.takes}</b> takes</span><span>votes by profile: ${Object.entries(e.music.votes).map(([p, x]) =>
      `<b>${esc(p)}</b> ${x.liked} liked / ${x.disliked} disliked`).join(", ") || "none yet"}</span></div>`);
    return out.join("") || `<div class="none">No takes from this model in this project yet.</div>`;
  }

  // ---- editing: text saves as you type; anything structural re-renders and saves at once
  function wire() {
    const v = Lab.view(), grow = ta => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; };
    v.querySelectorAll("textarea").forEach(ta => { requestAnimationFrame(() => grow(ta)); ta.addEventListener("input", () => grow(ta)); });
    const text = (sel, fn) => v.querySelectorAll(sel).forEach(el => el.addEventListener("input", () => { fn(el); changed(); }));
    text("[data-tnote]", el => { T.data.tasks[el.dataset.tnote].note = el.value; });
    text("[data-taste]", el => { T.data.taste[+el.dataset.taste].text = el.value; });
    text("[data-mf=name], [data-mf=summary]", el => { cur()[el.dataset.mf] = el.value; });
    text("[data-rule]", el => { cur().rules[+el.dataset.rule][el.dataset.f] = el.value; });
    text("[data-tpl]", el => { cur().templates[el.dataset.tpl] = el.value; });
    text("textarea[data-ex], input[data-ex]", el => { cur().examples[+el.dataset.ex][el.dataset.f] = el.value.trim() === "" && el.dataset.f === "take" ? "" : el.value; });
    const act = (sel, ev, fn) => v.querySelectorAll(sel).forEach(el => el.addEventListener(ev, () => { fn(el); changed(true); }));
    act("[data-route]", "change", el => { T.data.tasks[el.dataset.route].model = el.value; });
    act("[data-mf=engine]", "change", el => { cur().engine = el.value; });
    act("select[data-ex]", "change", el => { cur().examples[+el.dataset.ex].task = el.value; });
    act("[data-del-taste]", "click", el => T.data.taste.splice(+el.dataset.delTaste, 1));
    act("[data-adopt-taste]", "click", el => { const x = T.data.taste[+el.dataset.adoptTaste]; x.by = x.by === "user" ? "agent" : "user"; });
    act("[data-pin]", "click", el => { const r = cur().rules[+el.dataset.pin]; r.pinned = !r.pinned; });
    act("[data-adopt]", "click", el => { const r = cur().rules[+el.dataset.adopt]; r.by = r.by === "user" ? "agent" : "user"; });
    act("[data-delrule]", "click", el => cur().rules.splice(+el.dataset.delrule, 1));
    act("[data-scope]", "click", el => { const r = cur().rules[+el.dataset.scope], t = el.dataset.task; r.tasks = r.tasks.includes(t) ? r.tasks.filter(x => x !== t) : [...r.tasks, t]; });
    act("[data-verdict]", "click", el => { const x = cur().examples[+el.dataset.verdict]; x.verdict = x.verdict === "good" ? "bad" : "good"; });
    act("[data-delex]", "click", el => cur().examples.splice(+el.dataset.delex, 1));
    v.querySelectorAll("[data-model]").forEach(b => b.onclick = () => { T.model = b.dataset.model; T.filter = "all"; keep(render); });
    v.querySelectorAll("[data-rf]").forEach(b => b.onclick = () => { T.filter = b.dataset.rf; keep(render); });
    v.querySelectorAll(".explay").forEach(b => b.onclick = () => {
      const c = Lab.S.clips[b.dataset.take];
      if (Lab.player.current === b.dataset.take) Lab.stop(); else Lab.play(Lab.clipUrl(c), { id: b.dataset.take });
    });
    const add = $("addTaste");
    add.onkeydown = e => {
      if (e.key !== "Enter" || !add.value.trim()) return;
      T.data.taste.push({ id: uid("t"), text: add.value.trim(), by: "user", added: today() });
      changed(true); focusLast("[data-taste]", "#addTaste");
    };
    $("addModel").onclick = () => {
      let n = 1; while (T.data.models[`new-model-${n}`]) n++;
      T.model = `new-model-${n}`;
      T.data.models[T.model] = { name: "New model", engine: "external", summary: "", rules: [], templates: {}, examples: [] };
      changed(true); const el = document.querySelector(".mname"); if (el) { el.focus(); el.select(); }
    };
    if (!cur()) return;
    $("mid").onchange = e => {  // (rename the key, and the tasks that point at it)
      const id = e.target.value.trim(), old = T.model;
      if (!id || id === old || T.data.models[id]) { e.target.value = old; return; }
      T.data.models = Object.fromEntries(Object.entries(T.data.models).map(([k, x]) => [k === old ? id : k, x]));
      for (const t of Object.values(T.data.tasks)) if (t.model === old) t.model = id;
      T.model = id; changed(true);
    };
    const del = $("delModel");
    if (del) del.onclick = () => { delete T.data.models[T.model]; T.model = Object.keys(T.data.models)[0] || null; changed(true); };
    $("addRule").onclick = () => {
      cur().rules.push({ id: uid("r"), text: "", why: "", tasks: T.filter === "all" ? [] : [T.filter], by: "user", added: today(), pinned: false });
      changed(true); focusLast('textarea[data-f="text"]');
    };
    $("addEx").onclick = () => {
      cur().examples.push({ id: uid("e"), prompt: "", verdict: "good", why: "", task: T.filter === "all" ? "sfx" : T.filter, take: "" });
      changed(true); focusLast('textarea[data-f="prompt"]');
    };
    Lab.repaintPlaying();
  }
  function focusLast(sel, fallback) {
    const els = document.querySelectorAll(sel), el = els[els.length - 1];
    if (el) el.focus();
    if (fallback) { const f = document.querySelector(fallback); if (f) f.focus(); }
  }
  function changed(structural = false) {
    T.dirty = true;
    state("saving");
    clearTimeout(T.timer);
    if (structural) { keep(render); save(); } else T.timer = setTimeout(save, 700);
  }
  function state(s) {
    const el = $("tsave");
    if (!el) return;
    el.className = `savestate ${s}`;
    el.innerHTML = s === "saved" ? `${icon("check")}saved` : s === "saving" ? "saving…" : `${icon("x")}not saved`;
  }
  async function save() {
    clearTimeout(T.timer);
    if (!T.dirty) return;
    T.dirty = false;
    let r;
    try { r = await Lab.post("/api/tuning", { base: T.base, tuning: T.data }); } catch { r = null; }
    if (r && r.status === 409) {  // (written elsewhere since this copy was loaded: take theirs, don't overwrite it)
      const j = await r.json();
      T.data = j.tuning; T.base = j.base;
      if (!T.data.models[T.model]) T.model = Object.keys(T.data.models)[0] || null;
      keep(render);
      Lab.toast("The tuning changed elsewhere (an agent?), so it was reloaded; redo your last edit", { icon: "refresh" });
      return;
    }
    if (!r || !r.ok) { T.dirty = true; state("error"); Lab.toast("Couldn't save the tuning", { icon: "x" }); return; }
    T.base = (await r.json()).base;
    await Lab.stampSeen("tuning");
    state(T.dirty ? "saving" : "saved");
  }
  // An agent wrote tuning.json while the page was open (and nothing here is unsaved): show theirs.
  async function reload() { if (!T.dirty && Lab.tab === "tuning") show(); }

  Lab.register("tuning", {
    title: "Tuning", icon: "fork", show, refresh: reload, dock: false, leave: save, reload,
    keys: [["Ctrl S", "save now"], ["Esc", "leave the field"]],
    onKey(e) { if (e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } },
  });
})();
