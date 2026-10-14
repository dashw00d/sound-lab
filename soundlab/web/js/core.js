// Sound Lab core: state, the API, one audio player, waveforms, small UI helpers, tabs and keys.
const Lab = {
  project: null, S: null, V: null,   // the project's info, the index (takes, sets, music), the votes
  tabs: {}, order: [], tab: null,     // registered pages
  actx: new (window.AudioContext || window.webkitAudioContext)(),
};

// ---- API
Lab.load = async function () {
  const r = await (await fetch("/api/state")).json();
  Lab.project = r.project; Lab.S = r.index; Lab.V = r.votes;
};
Lab.vote = async function (msg) {
  Lab.V = await (await fetch("/api/vote", { method: "POST", body: JSON.stringify(msg) })).json();
  Lab.status();
  return Lab.V;
};

// ---- helpers
Lab.esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
Lab.$ = sel => document.querySelector(sel);
Lab.view = () => document.getElementById("view");
Lab.seg = (items, on, attr) => `<span class="seg">${items.map(([v, label, dis, title]) =>
  `<button data-${attr}="${Lab.esc(v)}" class="${v === on ? "on" : ""}" ${dis ? "disabled" : ""} title="${Lab.esc(title || "")}">${label}</button>`).join("")}</span>`;
Lab.toast = function (msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(Lab._toastT); Lab._toastT = setTimeout(() => t.classList.remove("show"), 1800);
};
Lab.clipUrl = c => c && !c.failed ? "/clips/" + c.file : null;
Lab.shippedUrl = rel => rel ? "/shipped/" + rel : null;
// Takes grouped by the sound they are for, in the order the index lists them.
Lab.byName = function () {
  const by = {};
  for (const [id, c] of Object.entries(Lab.S.clips)) (by[c.name] ||= []).push({ id, ...c });
  return by;
};

// ---- one player for every page (an <audio> element: seeking, looping, ranges)
Lab.player = { el: new Audio(), current: null, onEnd: null, raf: 0 };
Lab.play = function (url, { loop = false, id = null, onEnd = null, volume = 1 } = {}) {
  const p = Lab.player;
  if (!url) return;
  p.el.pause(); cancelAnimationFrame(p.raf);
  p.el.src = url; p.el.loop = loop; p.el.volume = Math.max(0, Math.min(1, volume));
  p.current = id; p.onEnd = onEnd;
  p.el.play().catch(() => {});
  Lab.repaintPlaying();
};
Lab.stop = function () {
  const p = Lab.player;
  p.el.pause(); p.current = null; p.onEnd = null; cancelAnimationFrame(p.raf);
  Lab.repaintPlaying();
};
Lab.player.el.onended = () => {
  const cb = Lab.player.onEnd;
  Lab.player.current = null; Lab.repaintPlaying();
  if (cb) cb();
};
Lab.repaintPlaying = function () {
  document.querySelectorAll("[data-play-id]").forEach(el => el.classList.toggle("playing", el.dataset.playId === Lab.player.current));
  const seekLoop = () => {
    const el = document.querySelector(`.tile[data-play-id="${CSS.escape(Lab.player.current || "")}"] .seek`);
    if (el && Lab.player.el.duration) el.style.left = `${7 + (el.parentElement.clientWidth - 16) * Lab.player.el.currentTime / Lab.player.el.duration}px`;
    if (Lab.player.current) Lab.player.raf = requestAnimationFrame(seekLoop);
  };
  if (Lab.player.current) seekLoop();
};

// ---- waveforms (decoded once per file)
Lab.waves = new Map();
Lab.drawWave = async function (canvas, url) {
  if (!url || !canvas) return;
  let peaks = Lab.waves.get(url);
  if (!peaks) {
    try {
      const buf = await Lab.actx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const ch = buf.getChannelData(0), n = 160, step = Math.max(1, Math.floor(ch.length / n));
      peaks = new Float32Array(n);
      for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(ch.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(ch[j])); peaks[i] = m; }
      Lab.waves.set(url, peaks);
    } catch { return; }
  }
  const g = canvas.getContext("2d"), w = canvas.width, h = canvas.height, bw = w / peaks.length;
  g.clearRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(document.body).getPropertyValue("--accent");
  peaks.forEach((p, i) => { const y = p * h / 2; g.fillRect(i * bw, h / 2 - y, Math.max(1, bw - 0.6), Math.max(1, 2 * y)); });
};
// A take tile: waveform, caption, length; `extra` classes; click handled by the page.
Lab.tile = function (take, caption, cls = "") {
  const d = document.createElement("div");
  d.className = `tile ${cls} ${take.failed ? "failed" : ""}`;
  d.dataset.id = take.id; d.dataset.playId = take.id;
  d.innerHTML = `<canvas width="380" height="88"></canvas><div class="seek"></div>
    <div class="foot"><span>${Lab.esc(caption)}</span><span>${take.failed ? "silent" : take.duration != null ? (+take.duration).toFixed(2) + " s" : ""}</span></div>`;
  if (!take.failed) Lab.drawWave(d.querySelector("canvas"), take.url);
  return d;
};

// ---- pages and keys
Lab.register = function (name, page) { Lab.tabs[name] = page; Lab.order.push(name); };
Lab.go = function (name, arg) {
  if (!Lab.tabs[name] || (Lab.tabs[name].enabled && !Lab.tabs[name].enabled())) name = Lab.order[0];
  if (Lab.tab && Lab.tab !== name && Lab.tabs[Lab.tab].leave) Lab.tabs[Lab.tab].leave();
  Lab.stop();
  Lab.tab = name;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  Lab.tabs[name].show(arg);
  Lab.setHash(arg);
  Lab.renderHelp();
};
Lab.setHash = function (arg) { history.replaceState(null, "", "#" + Lab.tab + (arg ? "/" + encodeURIComponent(arg) : "")); };
Lab.renderHelp = function () {
  const keys = (Lab.tabs[Lab.tab].keys || []).map(([k, what]) => `<div>${k.split(" ").map(x => `<kbd>${Lab.esc(x)}</kbd>`).join(" ")} ${Lab.esc(what)}</div>`);
  document.getElementById("help").innerHTML = `<b>${Lab.esc(Lab.tabs[Lab.tab].title)}</b>${keys.join("") || "<div class='dim'>No keys here.</div>"}
    <div class="dim" style="margin-top:8px"><kbd>?</kbd> show or hide this</div>`;
};
Lab.status = function () {
  if (!Lab.S) return;
  const names = Object.entries(Lab.S.sounds).filter(([, m]) => m.kind !== "pool").map(([n]) => n);
  const withTakes = new Set(Object.values(Lab.S.clips).map(c => c.name));
  const real = names.filter(n => withTakes.has(n));
  const n = real.filter(x => Lab.V.picks[x] != null).length;
  document.getElementById("status").textContent = `${n} / ${real.length} sounds decided · ${Object.keys(Lab.S.clips).length} takes`;
};
document.addEventListener("keydown", e => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") { if (e.key === "Escape") e.target.blur(); return; }
  if (e.key === "?") { document.getElementById("help").classList.toggle("show"); return; }
  const page = Lab.tabs[Lab.tab];
  if (page && page.onKey) page.onKey(e);
});
