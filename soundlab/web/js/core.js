// SoundLab core: state, the API (with undo), live refresh, icons, small UI helpers, pages, the palette, help and keys.
const Lab = {
  project: null, S: null, V: null, shipped: {},  // the project's info, the index (takes, sets, music), the votes, what shipped
  tabs: {}, order: [], tab: null,                 // registered pages
  actx: new (window.AudioContext || window.webkitAudioContext)(),
  prefs: { volume: 0.9, muted: false, view: "wave", hideDown: false },
};
try { Object.assign(Lab.prefs, JSON.parse(localStorage.getItem("soundlab.prefs")) || {}); } catch { /* (private window) */ }
Lab.savePrefs = () => { try { localStorage.setItem("soundlab.prefs", JSON.stringify(Lab.prefs)); } catch { /* ignore */ } };

// ---- icons (24-unit grid, drawn with the current colour)
const FILL = 'fill="currentColor" stroke="none"';
const THUMB = '<path d="M7 11v9"/><path d="M7 11l3.6-6.6A1.8 1.8 0 0 1 14 5.6l-.8 3.9h5.3a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.7H7"/><path d="M7 20H4.5A1.5 1.5 0 0 1 3 18.5v-6A1.5 1.5 0 0 1 4.5 11H7"/>';
const STAR = 'd="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.1 6.6 20l1-6.1-4.4-4.3 6.1-.9z"';
Lab.ICONS = {
  play: `<path ${FILL} d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>`,
  stop: `<rect ${FILL} x="6" y="6" width="12" height="12" rx="2.2"/>`,
  up: THUMB, down: `<g transform="rotate(180 12 12)">${THUMB}</g>`,
  star: `<path ${STAR}/>`, starFill: `<path ${FILL} ${STAR}/>`,
  loop: '<path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-1a5 5 0 0 1 5-5h11"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 12.5v1a5 5 0 0 1-5 5H4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  wave: '<path d="M3.5 10v4M7.5 6.5v11M11.5 3v18M15.5 7.5v9M19.5 10v4"/>',
  vwave: '<path d="M2 12h2.5l2-5 3 10 3-13 3 15 2.5-7H22"/>',
  vspec: '<path d="M4 20v-6M8 20V8M12 20v-9M16 20V5M20 20v-11"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v4.5H16"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="M20 6.5L9.5 17 4 11.5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  fork: '<path d="M8 2.5v7.5a4 4 0 0 0 8 0V2.5"/><path d="M12 14v7.5"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.5 6 9z"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>',
  note: '<path d="M9 18V5.5l11-2v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  layers: '<path d="M12 3L2.5 8 12 13l9.5-5z"/><path d="M2.5 12.5L12 17.5l9.5-5"/><path d="M2.5 16.5L12 21.5l9.5-5"/>',
  sliders: '<path d="M5 21v-6M5 11V3M12 21v-9M12 8V3M19 21v-4M19 13V3M2.5 15h5M9.5 8h5M16.5 17h5"/>',
  chart: '<path d="M3.5 20.5h17"/><path d="M6.5 17v-6M11.5 17V5M16.5 17V9"/>',
  pen: '<path d="M12 20h8.5"/><path d="M16 4.5a2.1 2.1 0 0 1 3 3L7.5 19l-4 1 1-4z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  headphones: '<path d="M3.5 18v-5a8.5 8.5 0 0 1 17 0v5"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>',
  ab: '<path d="M3 18l4-12 4 12M4.3 14h5.4"/><path d="M14 6h3.6a2.8 2.8 0 0 1 0 5.6H14zM14 11.6h4.2a3.2 3.2 0 0 1 0 6.4H14z"/>',
  keep: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>',
  save: '<path d="M5 3.5h11l3.5 3.5v12.5a1 1 0 0 1-1 1H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 3.5v5h8v-5M7.5 20.5v-6h9v6"/>',
};
Lab.icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${Lab.ICONS[name] || ""}</svg>`;

// ---- helpers
Lab.esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
Lab.$ = sel => document.querySelector(sel);
Lab.view = () => document.getElementById("view");
Lab.seg = (items, on, attr) => `<span class="seg">${items.map(([v, label, dis, tip]) =>
  `<button data-${attr}="${Lab.esc(v)}" class="${v === on ? "on" : ""}" ${dis ? "disabled" : ""} ${tip ? `data-tip="${Lab.esc(tip)}"` : ""}>${label}</button>`).join("")}</span>`;
Lab.empty = (icon, title, html) => `<div class="page"><div class="empty"><div class="glyph">${Lab.icon(icon)}</div><b>${Lab.esc(title)}</b>${html}</div></div>`;
Lab.showEmpty = (icon, title, html) => { Lab.dock.attach(false); Lab.view().innerHTML = Lab.empty(icon, title, html); };
Lab.clipUrl = c => c && !c.failed ? "/clips/" + c.file : null;
Lab.shippedUrl = rel => rel ? "/shipped/" + rel : null;
Lab.fmt = t => { if (!isFinite(t)) return "–"; const cs = Math.round(Math.max(0, t) * 100), m = Math.floor(cs / 6000); return `${m}:${((cs - 6000 * m) / 100).toFixed(2).padStart(5, "0")}`; };
Lab.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Takes grouped by the sound they are for, in the order the index lists them.
Lab.byName = function () {
  const by = {};
  for (const [id, c] of Object.entries(Lab.S.clips)) (by[c.name] ||= []).push({ id, ...c });
  return by;
};
// The sounds that need a decision (not the instrument pool), and how many are decided.
Lab.decisions = function () {
  const withTakes = new Set(Object.values(Lab.S.clips).map(c => c.name));
  const real = Object.entries(Lab.S.sounds).filter(([n, m]) => m.kind !== "pool" && withTakes.has(n)).map(([n]) => n);
  return { total: real.length, decided: real.filter(n => Lab.V.picks[n] != null).length };
};
// A range input's filled track (bipolar ones fill from zero).
Lab.fillRange = function (el) {
  const lo = +el.min, hi = +el.max, v = +el.value, pct = x => `${100 * (x - lo) / (hi - lo)}%`;
  if (el.classList.contains("bipolar")) { el.style.setProperty("--lo", pct(Math.min(0, v))); el.style.setProperty("--hi", pct(Math.max(0, v))); }
  else el.style.setProperty("--fill", pct(v));
};

// ---- API
Lab.apply = function (r) { Lab.project = r.project; Lab.S = r.index; Lab.V = r.votes; Lab.shipped = r.shipped || {}; };
Lab.load = async function () {
  const r = await fetch("/api/state");
  if (!r.ok) throw new Error(`state refused: ${r.status}`);
  Lab.apply(await r.json());
};
Lab.post = (url, obj) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
Lab.undoStack = [];
function inverse(msg) {
  const V = Lab.V, inv = {};
  if ("clip" in msg) { inv.clip = msg.clip; inv.value = V.clips[msg.clip] || 0; }
  if ("pick" in msg) { inv.sound = msg.sound; inv.pick = V.picks[msg.sound] ?? null; }
  if (msg.picks) inv.picks = Object.fromEntries(Object.keys(msg.picks).map(n => [n, V.picks[n] ?? null]));
  if ("note" in msg) { inv.sound = msg.sound; inv.note = V.notes[msg.sound] || ""; }
  if ("cue" in msg) { inv.cue = msg.cue; inv.level = msg.level; inv.bars = ((V.cues || {})[msg.cue] || {})[msg.level] || null; }
  if ("prompt_note" in msg) {
    const old = ((V.prompt_notes || {})[msg.sound] || {})[msg.variant];
    Object.assign(inv, { sound: msg.sound, variant: msg.variant, prompt_note: old ? old.text : "", prompt: old ? old.prompt : msg.prompt, at: old ? old.at : undefined });
  }
  return inv;
}
async function post(msg) {
  Lab._writing = (Lab._writing || 0) + 1;  // (our own write: the poll doesn't mistake it for someone else's)
  try {
    const r = await Lab.post("/api/vote", msg);
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) || {}).error || `vote refused: ${r.status}`);
    Lab.V = await r.json();
    await Lab.stampSeen("votes");
  }
  finally { Lab._writing--; }
  Lab.status();
  return Lab.V;
}
// A vote, pick or note. With `undo` ({label, icon}) it goes on the undo stack and says what it did.
// Writes run one at a time, so a quick second press sees the first one's result (and its undo is exact).
let queue = Promise.resolve();
const serial = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
Lab.vote = (msg, undo) => serial(async () => {
  if (undo) { Lab.undoStack.push({ inv: inverse(msg), label: undo.label }); if (Lab.undoStack.length > 100) Lab.undoStack.shift(); }
  try { await post(msg); } catch (e) { if (undo) Lab.undoStack.pop(); Lab.toast(`Couldn't save that: ${e.message.startsWith("Failed to fetch") ? "is the server running?" : e.message}`, { icon: "x" }); throw e; }
  if (undo) Lab.toast(undo.label, { undo: true, icon: undo.icon });
  return Lab.V;
});
Lab.undo = () => serial(async () => {
  const u = Lab.undoStack.pop();
  if (!u) { Lab.toast("Nothing to undo"); return; }
  try { await post(u.inv); } catch (e) { Lab.undoStack.push(u); Lab.toast(`Couldn't undo that: ${e.message.startsWith("Failed to fetch") ? "is the server running?" : e.message}`, { icon: "x" }); return; }
  Lab.refresh();
  Lab.toast(`Undone: ${u.label}`, { icon: "undo" });
});
Lab.refresh = function () {
  const p = Lab.tabs[Lab.tab];
  if (!p) return;
  if (p.dock !== false && !Lab.dock.active) Lab.dock.attach(true);  // (hidden while the page was empty)
  (p.refresh || p.show)();
  Lab.renderTabs();
};

// ---- live refresh: new takes from a running generator (offered, not forced, so nothing moves under you), and
// votes written elsewhere (applied). A generator rewrites the index often, so its count is re-read at most every 15 s.
Lab.stampSeen = async function (only) {  // (only: the one file our own write changed, so other news isn't swallowed)
  try { const s = await (await fetch("/api/stamp")).json(); Lab.stamp = only && Lab.stamp ? { ...Lab.stamp, [only]: s[only] } : s; }
  catch { /* server gone */ }
};
Lab.poll = async function () {
  try {
    const s = await (await fetch("/api/stamp")).json(), was = Lab.stamp;
    if (was && !Lab._writing) {
      if (s.index !== was.index && Date.now() - (Lab._counted || 0) > 15000) {
        Lab._counted = Date.now();
        const r = await (await fetch("/api/state")).json(), n = Object.keys(r.index.clips).length - Object.keys(Lab.S.clips).length;
        const b = document.getElementById("fresh");
        b.innerHTML = `${Lab.icon("refresh")}${n > 0 ? `${n} new take${n === 1 ? "" : "s"}` : "Takes updated"}`;
        b.hidden = false;
      } else if (s.index !== was.index) { s.index = was.index; }  // (counted again on a later poll)
      if (s.tuning !== was.tuning && Lab.tab === "tuning" && Lab.tabs.tuning.reload) Lab.tabs.tuning.reload();  // (an agent wrote it)
      const voted = s.votes !== was.votes, shipped = s.promoted !== was.promoted;
      if ((voted || shipped) && (!document.activeElement || !/TEXTAREA|INPUT/.test(document.activeElement.tagName))) {
        const r = await (await fetch("/api/state")).json();
        Lab.V = r.votes; Lab.shipped = r.shipped || {};
        if (shipped) Lab.flushAudio();  // (a promote replaced shipped files under the same names)
        Lab.status(); Lab.refresh();
      } else if (voted || shipped) { s.votes = was.votes; s.promoted = was.promoted; }  // (typing: apply it once the field is left)
    }
    Lab.stamp = s;
  } catch { /* server restarting */ }
  setTimeout(Lab.poll, 3000);
};
Lab.applyPending = async function () {
  await Lab.load();  // (fresh: votes made since the pill appeared are kept)
  Lab.flushAudio();  // (a regenerated set or rebuilt kit reuses file names)
  await Lab.stampSeen();
  Lab._counted = 0;
  document.getElementById("fresh").hidden = true;
  Lab.status(); Lab.refresh(); Lab.toast("Loaded the new takes", { icon: "check" });
};

// ---- toasts and tooltips
Lab.toast = function (msg, { undo = false, icon = null } = {}) {
  const t = document.getElementById("toast");
  t.innerHTML = `${icon ? Lab.icon(icon) : ""}<span>${Lab.esc(msg)}</span>${undo ? `<button>${Lab.icon("undo")}Undo <kbd>Ctrl Z</kbd></button>` : ""}`;
  if (undo) t.querySelector("button").onclick = () => Lab.undo();
  t.classList.toggle("nodock", document.getElementById("dock").hidden);
  t.classList.add("show");
  clearTimeout(Lab._toastT); Lab._toastT = setTimeout(() => t.classList.remove("show"), undo ? 3400 : 1900);
};
Lab.tip = {
  cur: null, t: 0,
  show(target) {
    this.cur = target; clearTimeout(this.t);
    this.t = setTimeout(() => {
      if (this.cur !== target || !document.body.contains(target)) return;
      const el = document.getElementById("tip"), r = target.getBoundingClientRect();
      el.style.left = "0px"; el.style.top = "0px";  // (measured from the corner, not squeezed by where it was last)
      el.textContent = target.dataset.tip; el.classList.add("show");
      const w = el.offsetWidth, h = el.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
      if (y + h > innerHeight - 8) y = r.top - h - 8;
      el.style.left = `${Lab.clamp(x, 8, innerWidth - w - 8)}px`; el.style.top = `${Math.max(8, y)}px`;
    }, 280);
  },
  hide() { this.cur = null; clearTimeout(this.t); document.getElementById("tip").classList.remove("show"); },
};
document.addEventListener("mouseover", e => {
  const t = e.target.closest && e.target.closest("[data-tip]");
  if (t === Lab.tip.cur) return;
  if (t && t.dataset.tip) Lab.tip.show(t); else Lab.tip.hide();
});
document.addEventListener("pointerdown", () => Lab.tip.hide(), true);
// (a disabled button keeps its tooltip, so it is reachable by the mouse: its clicks are stopped here, children included)
document.addEventListener("click", e => { if (e.target.closest && e.target.closest("button:disabled")) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener("scroll", () => Lab.tip.hide(), true);

// ---- a note box that saves itself as you type
Lab.wireNote = function (ta, key, onSaved) {
  const box = ta.closest(".notebox"), saved = box.querySelector(".saved");
  const grow = () => { ta.style.height = "auto"; ta.style.height = `${Math.min(240, ta.scrollHeight + 2)}px`; };
  requestAnimationFrame(grow);
  let t = 0;
  const save = async () => {
    clearTimeout(t);
    if (ta.value === (Lab.V.notes[key] || "")) return;
    await Lab.vote({ sound: key, note: ta.value });
    saved.classList.add("show"); setTimeout(() => saved.classList.remove("show"), 1500);
    if (onSaved) onSaved();
  };
  ta.oninput = () => { grow(); box.classList.toggle("has", !!ta.value.trim()); clearTimeout(t); t = setTimeout(save, 700); };
  ta.onblur = save;
};

// ---- the note editor: a small box by what it's about. Enter saves, Shift+Enter is a new line, Esc cancels,
// a click elsewhere saves (so nothing typed is lost). onSave gets the text ("" when it was emptied).
Lab.noteEditor = function ({ anchor, title, value = "", placeholder = "", place = "below", onSave, onResolve }) {
  if (Lab.noteEditor.close) Lab.noteEditor.close(true);
  const el = document.createElement("div");
  el.className = "pop";
  el.innerHTML = `<div class="pop-h">${Lab.icon("pen")}<span>${Lab.esc(title)}</span></div>
    <textarea rows="2" placeholder="${Lab.esc(placeholder)}">${Lab.esc(value)}</textarea>
    <div class="pop-f"><span><kbd>Enter</kbd> save <kbd>Shift Enter</kbd> new line <kbd>Esc</kbd> cancel</span><span class="grow"></span>
      ${value && onResolve ? `<button class="btn ghost" data-r>${Lab.icon("check")}Resolve</button>` : ""}<button class="btn primary" data-s>Save</button></div>`;
  document.body.appendChild(el);
  const ta = el.querySelector("textarea"), grow = () => { ta.style.height = "auto"; ta.style.height = `${Math.min(220, ta.scrollHeight + 2)}px`; };
  const place_ = () => {
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let top = place === "above" ? r.top - h - 10 : r.bottom + 10;
    if (top < 64) top = r.bottom + 10;
    if (top + h > innerHeight - 8) top = r.top - h - 10;
    el.style.left = `${Lab.clamp(r.left + r.width / 2 - w / 2, 12, innerWidth - w - 12)}px`; el.style.top = `${Math.max(8, top)}px`;
  };
  let open = true;
  const close = save => {
    if (!open) return;
    open = false; Lab.noteEditor.close = null;
    document.removeEventListener("pointerdown", outside, true);
    el.remove();
    if (save && ta.value.trim() !== value.trim()) onSave(ta.value.trim());
  };
  const outside = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(true); };
  ta.addEventListener("input", () => { grow(); place_(); });
  ta.onkeydown = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); close(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
  };
  el.querySelector("[data-s]").onclick = () => close(true);
  const res = el.querySelector("[data-r]");
  if (res) res.onclick = () => { close(false); onResolve(); };
  document.addEventListener("pointerdown", outside, true);
  Lab.noteEditor.close = close;
  grow(); place_();
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
};
Lab.when = iso => { const d = new Date(iso + "T12:00"); return isNaN(d) ? iso || "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

// ---- pages
Lab.register = function (name, page) { Lab.tabs[name] = page; Lab.order.push(name); };
Lab.enabled = name => { const p = Lab.tabs[name]; return p && (!p.enabled || p.enabled()); };
Lab.renderTabs = function () {
  const nav = document.getElementById("tabs");
  if (!nav || !Lab.S) return;
  let n = 0;
  nav.innerHTML = Lab.order.map(name => {
    const p = Lab.tabs[name], on = Lab.enabled(name), c = on && p.count ? p.count() : "";
    if (on) n++;
    return `<button data-tab="${name}" class="${name === Lab.tab ? "on" : ""}" ${on ? "" : "disabled"} data-tip="${Lab.esc(p.title)} · Alt ${n}">
      ${Lab.icon(p.icon)}<span class="t">${Lab.esc(p.title)}</span>${c !== "" && c != null ? `<span class="count">${c}</span>` : ""}</button>`;
  }).join("");
  nav.querySelectorAll("button").forEach(b => b.onclick = () => Lab.go(b.dataset.tab));
};
Lab.go = function (name, arg) {
  if (!Lab.S) return;  // (the state didn't load)
  if (!Lab.enabled(name)) { name = Lab.order.find(Lab.enabled); arg = undefined; }
  if (Lab.tab && Lab.tab !== name && Lab.tabs[Lab.tab].leave) Lab.tabs[Lab.tab].leave();
  Lab.stop(); Lab.tip.hide();
  Lab.tab = name;
  Lab.renderTabs();
  Lab.dock.attach(Lab.tabs[name].dock !== false);
  const v = Lab.view();  // (the page eases in when you arrive, not each time it re-renders)
  v.classList.add("enter"); clearTimeout(Lab._enterT); Lab._enterT = setTimeout(() => v.classList.remove("enter"), 400);
  Lab.tabs[name].show(arg);
  Lab.setHash(Lab.tabs[name].hash ? Lab.tabs[name].hash() : arg);  // (a page that remembers its item keeps it in the URL)
};
Lab.setHash = function (arg) { history.replaceState(null, "", "#" + Lab.tab + (arg ? "/" + encodeURIComponent(arg) : "")); };
window.addEventListener("hashchange", () => {
  const [tab, arg] = location.hash.slice(1).split("/");
  Lab.go(tab || Lab.order[0], arg ? decodeURIComponent(arg) : undefined);
});
Lab.status = function () {
  if (!Lab.S) return;
  const { total, decided } = Lab.decisions(), C = 2 * Math.PI * 7, f = total ? decided / total : 0;
  document.getElementById("meterTop").innerHTML = `<svg class="ring" viewBox="0 0 18 18"><defs><linearGradient id="rg" x1="0" x2="1">
      <stop offset="0" stop-color="#8b7bff"/><stop offset="1" stop-color="#5bd6ff"/></linearGradient></defs>
    <circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="2.4"/>
    ${f ? `<circle cx="9" cy="9" r="7" fill="none" stroke="url(#rg)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${(f * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 9 9)"/>` : ""}</svg>
    <span>${decided}/${total} decided</span>`;
  document.getElementById("meterTop").dataset.tip = `${decided} of ${total} sounds have a pick (or keep the shipped file) · ${Object.keys(Lab.S.clips).length} takes in all`;
  Lab.renderTabs();
};

// ---- modals: the palette (jump anywhere) and the key sheet
Lab.modal = null;
Lab.openModal = function (id, onKey) {
  const back = Lab.modal ? Lab.modal.back : document.activeElement;  // (where focus returns to when it closes)
  Lab.closeModal(true);
  const el = document.getElementById(id);
  el.hidden = false; document.getElementById("scrim").hidden = false;
  el.tabIndex = -1; el.focus();
  Lab.modal = { el, onKey, back };
  return el;
};
Lab.closeModal = function (keepFocus) {
  if (!Lab.modal) return;
  const { el, back } = Lab.modal;
  el.hidden = true; document.getElementById("scrim").hidden = true; Lab.modal = null;
  if (!keepFocus && back && back !== document.body && document.body.contains(back)) back.focus();
};
Lab.fuzzy = function (q, s) {
  const t = s.toLowerCase();
  if (!q) return { score: 0 };
  const i = t.indexOf(q);
  if (i >= 0) return { score: 100 - i + (i === 0 || /[\s_.·-]/.test(t[i - 1]) ? 25 : 0) - t.length * .05, hit: [i, i + q.length] };
  let j = 0, score = 0, prev = -2;
  for (const ch of q) {
    const k = t.indexOf(ch, j);
    if (k < 0) return null;
    score += (k === prev + 1 ? 3 : 1) + (k === 0 || /[\s_.·-]/.test(t[k - 1]) ? 2 : 0);
    prev = k; j = k + 1;
  }
  return { score: score - t.length * .05 };
};
Lab.palette = {
  items() {
    const out = [], pages = Lab.order.filter(Lab.enabled);
    pages.forEach((name, i) => out.push({ g: "Pages", icon: Lab.tabs[name].icon, label: Lab.tabs[name].title, sub: `Alt ${i + 1}`, run: () => Lab.go(name) }));
    const withTakes = new Set(Object.values(Lab.S.clips).map(c => c.name));
    for (const [n, m] of Object.entries(Lab.S.sounds)) {
      if (!withTakes.has(n)) continue;
      const pick = Lab.V.picks[n];
      if (m.kind === "pool") {
        if (Lab.enabled("instruments")) out.push({ g: "Instruments", icon: "note", label: (Lab.project.instruments || {})[n.slice(5)] || n.slice(5),
          sub: (m.palette || "").replace(/_/g, " "), run: () => Lab.go("instruments", n) });
        continue;
      }
      const c = pick && pick !== "shipped" ? Lab.S.clips[pick] : null;
      out.push({ g: "Sounds", icon: pick === "shipped" ? "keep" : pick ? "starFill" : "wave", pick: !!pick && pick !== "shipped", label: n,
        sub: pick === "shipped" ? "keeping shipped" : c ? `picked ${c.variant} · seed ${c.seed}` : "undecided", run: () => Lab.go("sounds", n) });
    }
    if (Lab.enabled("music") && Lab.S.mesh) for (const [k, c] of Object.entries(Lab.S.mesh.contexts))
      out.push({ g: "Music sets", icon: "layers", label: k.replace(".", " · "), sub: `${c.mode} · ${c.takes.length} takes`, run: () => Lab.go("music", k) });
    out.push({ g: "Actions", icon: "undo", label: "Undo the last vote or pick", sub: "Ctrl Z", run: () => Lab.undo() });
    out.push({ g: "Actions", icon: Lab.prefs.view === "spec" ? "vwave" : "vspec", label: Lab.prefs.view === "spec" ? "Show waveforms" : "Show spectrograms", sub: "V", run: () => Lab.dock.toggleView() });
    out.push({ g: "Actions", icon: Lab.prefs.muted ? "volume" : "mute", label: Lab.prefs.muted ? "Unmute" : "Mute", sub: "M", run: () => Lab.toggleMute() });
    out.push({ g: "Actions", icon: "keyboard", label: "Keyboard shortcuts", sub: "?", run: () => Lab.help.open() });
    return out;
  },
  open() {
    if (!Lab.S) return;
    const el = Lab.openModal("palette", e => this.key(e));
    el.innerHTML = `<div class="q">${Lab.icon("search")}<input type="text" id="pq" placeholder="Jump to a sound, a music set, an instrument or a page…" autocomplete="off" spellcheck="false"></div>
      <div class="res" id="pres"></div><div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>`;
    this.all = this.items(); this.cur = 0;
    const q = el.querySelector("#pq");
    q.oninput = () => { this.cur = 0; this.render(q.value); };
    this.render(""); q.focus();
  },
  render(q) {
    q = q.trim().toLowerCase();
    let list;
    if (!q) {
      const undecided = this.all.filter(x => x.g === "Sounds" && x.sub === "undecided").slice(0, 6);
      list = [...this.all.filter(x => x.g === "Pages"), ...undecided.map(x => ({ ...x, g: "Undecided sounds" })), ...this.all.filter(x => x.g === "Actions")];
    } else {
      list = this.all.map(x => ({ ...x, m: Lab.fuzzy(q, x.label) })).filter(x => x.m).sort((a, b) => b.m.score - a.m.score).slice(0, 60);
    }
    this.list = list;
    const res = document.getElementById("pres");
    if (!list.length) { res.innerHTML = `<div class="none">Nothing matches “${Lab.esc(q)}”.</div>`; return; }
    let html = "", g = null;
    list.forEach((x, i) => {
      if (!q && x.g !== g) { html += `<div class="gh">${Lab.esc(x.g)}</div>`; g = x.g; }
      const label = x.m && x.m.hit ? `${Lab.esc(x.label.slice(0, x.m.hit[0]))}<mark>${Lab.esc(x.label.slice(...x.m.hit))}</mark>${Lab.esc(x.label.slice(x.m.hit[1]))}` : Lab.esc(x.label);
      html += `<div class="it ${i === this.cur ? "on" : ""}" data-i="${i}"><span class="ic ${x.pick ? "pick" : ""}">${Lab.icon(x.icon)}</span>
        <span class="l">${label}</span><span class="s">${Lab.esc(q ? `${x.sub} · ${x.g.replace(/s$/, "").toLowerCase()}` : x.sub)}</span></div>`;
    });
    res.innerHTML = html;
    res.querySelectorAll(".it").forEach(d => {
      d.onmousemove = () => { if (this.cur !== +d.dataset.i) { this.cur = +d.dataset.i; this.mark(); } };
      d.onclick = () => this.run();
    });
  },
  mark() {
    document.querySelectorAll("#pres .it").forEach(d => d.classList.toggle("on", +d.dataset.i === this.cur));
    const on = document.querySelector("#pres .it.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  },
  run() { const x = this.list && this.list[this.cur]; Lab.closeModal(); if (x) x.run(); },
  key(e) {
    if (e.key === "Escape") { e.preventDefault(); Lab.closeModal(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.cur = Lab.clamp(this.cur + (e.key === "ArrowDown" ? 1 : -1), 0, (this.list || []).length - 1); this.mark(); }
    else if (e.key === "Enter") { e.preventDefault(); this.run(); }
  },
};
Lab.GLOBAL_KEYS = () => [["Ctrl K", "jump to a sound, set or page"], ["/", "the same, with one key"], ["Alt 1-" + Lab.order.filter(Lab.enabled).length, "switch page"],
                         ["Ctrl Z", "undo the last vote or pick"], ["V", "waveform or spectrogram"], ["M", "mute"], ["?", "this sheet"]];
Lab.help = {
  open() {
    const page = Lab.tabs[Lab.tab] || { title: "SoundLab", dock: false }, el = Lab.openModal("help", e => { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); Lab.closeModal(); } });
    const k = ([keys, what]) => `<div class="k"><span>${Lab.esc(what)}</span><span>${keys.split(" ").map(x => `<kbd>${Lab.esc(x)}</kbd>`).join("")}</span></div>`;
    const dock = page.dock !== false ? [["Click", "seek (in the dock)"], ["Drag", "loop a range (in the dock)"], ["Double-click", "clear the loop"]] : [];
    el.innerHTML = `<h2>${Lab.icon("keyboard")}Keyboard</h2><div class="dim">SoundLab is built to be driven from the keyboard: listen, vote and move on without the mouse.</div>
      <div class="cols"><div class="sect">${Lab.esc(page.title)}</div>${(page.keys || []).map(k).join("") || `<div class="dim">No keys on this page.</div>`}
      <div class="sect">Everywhere</div>${[...Lab.GLOBAL_KEYS(), ...dock].map(k).join("")}</div>`;
  },
};
Lab.toggleMute = function () {
  Lab.prefs.muted = !Lab.prefs.muted; Lab.savePrefs(); Lab.applyVolume();
  Lab.toast(Lab.prefs.muted ? "Muted" : "Sound on", { icon: Lab.prefs.muted ? "mute" : "volume" });
};

// ---- keys: the palette and global shortcuts first, then the page's own
document.addEventListener("keydown", e => {
  if (Lab.actx.state === "suspended") Lab.actx.resume();
  const t = e.target, typing = t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && t.type !== "range");
  const mod = e.ctrlKey || e.metaKey, k = e.key, page = Lab.tabs[Lab.tab];
  if (mod && k.toLowerCase() === "s") e.preventDefault();  // (never the browser's Save dialog)
  if (Lab.modal) {
    if (k === "Tab") {  // (focus stays inside the open sheet)
      const f = [...Lab.modal.el.querySelectorAll("input, button, select, textarea")].filter(x => !x.disabled), i = f.indexOf(document.activeElement);
      if (!f.length) e.preventDefault();
      else if (i < 0 || (e.shiftKey ? i === 0 : i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
      return;
    }
    Lab.modal.onKey(e); return;
  }
  if (mod && k.toLowerCase() === "k") { e.preventDefault(); Lab.palette.open(); return; }
  if (mod && k.toLowerCase() === "s") {  // (a page gets Ctrl S only if it lists it: Sounds' S and Music's S are other keys)
    if (page && page.onKey && (page.keys || []).some(([x]) => x === "Ctrl S")) page.onKey(e);
    return;
  }
  if (typing) { if (k === "Escape") t.blur(); return; }
  if (t.tagName === "INPUT" && t.type === "range") t.blur();  // (a slider keeps focus after dragging; keys go to the page)
  if (mod && k.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); Lab.undo(); return; }
  const digit = /^Digit([1-9])$/.exec(e.code || "");  // (e.key is another character under Alt on a Mac)
  if (e.altKey && digit) { e.preventDefault(); const p = Lab.order.filter(Lab.enabled)[+digit[1] - 1]; if (p) Lab.go(p); return; }
  if (mod || e.altKey) return;  // (Ctrl + / - / 0 / D… belong to the browser)
  if (k === "?") { Lab.help.open(); return; }
  if (k === "/") { e.preventDefault(); Lab.palette.open(); return; }
  if (k === "m" || k === "M") { Lab.toggleMute(); return; }
  if ((k === "v" || k === "V") && Lab.dock.active) { Lab.dock.toggleView(); return; }
  if ((k === "Enter" || k === " ") && t.closest && t.closest("button, a[href]")) return;  // (a focused button takes Enter and Space as its click, not also the page's key)
  if (page && page.onKey) page.onKey(e);
});
// A clicked button gives focus back, so Enter or Space afterwards means the page's shortcut, not "click it again".
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("button"); if (b && e.detail > 0) b.blur(); });
["pointerdown", "keydown"].forEach(ev => document.addEventListener(ev, () => { if (Lab.actx.state === "suspended") Lab.actx.resume(); }, { capture: true }));
