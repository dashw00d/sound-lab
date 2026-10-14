// SoundLab audio: one player for every page (an <audio> element routed through Web Audio for the master volume),
// decoding and analysis (peaks and spectrograms, cached), and the take tiles that draw them.
(() => {
  const A = Lab.actx;
  Lab.master = A.createGain();
  Lab.master.connect(A.destination);
  Lab.applyVolume = () => { Lab.master.gain.value = Lab.prefs.muted ? 0 : Lab.prefs.volume; };
  Lab.applyVolume();

  // ---- the player: seeking, looping, an A-B loop region, a level per play (the Balance page plays at game level)
  const P = Lab.player = { el: new Audio(), current: null, url: null, onEnd: null, region: null, raf: 0 };
  P.el.preload = "auto";
  P.node = A.createGain();
  A.createMediaElementSource(P.el).connect(P.node).connect(Lab.master);

  Lab.play = function (url, { loop = false, id = null, onEnd = null, volume = 1, from = 0 } = {}) {
    if (!url) return;
    if (A.state === "suspended") A.resume();
    const prev = P.current;
    P.el.pause();
    if (P.url !== url) { P.el.src = url; P.url = url; }
    if (!(P.region && P.region.id === id)) P.region = null;
    P.el.loop = loop && !P.region;
    P.node.gain.setValueAtTime(volume, A.currentTime);
    P.current = id; P.onEnd = onEnd;
    try { P.el.currentTime = from || 0; } catch { /* (before metadata: becomes the start position) */ }
    P.el.play().catch(() => {});
    if (prev && prev !== id) Lab.repaintPlaying(prev);
    Lab.repaintPlaying();
    Lab.dock.sync();
  };
  Lab.stop = function () {
    const prev = P.current;
    P.el.pause(); P.current = null; P.onEnd = null;
    if (prev) Lab.repaintPlaying(prev);
    Lab.dock.sync();
  };
  // End the take now, as if it had finished (an audition moving on early).
  Lab.endNow = function () {
    const cb = P.onEnd, prev = P.current;
    P.el.pause(); P.current = null; P.onEnd = null;
    if (prev) Lab.repaintPlaying(prev);
    Lab.dock.sync();
    if (cb) cb();
  };
  P.el.addEventListener("ended", () => {
    if (P.region && P.region.id === P.current) { P.el.currentTime = P.region.a; P.el.play().catch(() => {}); return; }
    Lab.endNow();
  });
  const playing = id => document.querySelectorAll(`[data-play-id="${CSS.escape(id)}"]`);
  function frame() {
    P.raf = 0;
    if (!P.current) return;
    const t = P.el.currentTime, d = P.el.duration || 0, r = P.region;
    if (r && r.id === P.current && !P.el.paused && (t >= r.b || t < r.a - .03)) P.el.currentTime = r.a;
    const prog = d ? Lab.clamp(t / d, 0, 1) : 0;
    playing(P.current).forEach(el => { el.classList.add("playing"); Lab.paintTile(el, prog); });
    Lab.dock.frame(t, d);
    P.raf = requestAnimationFrame(frame);
  }
  Lab.repaintPlaying = function (prevId) {
    if (prevId) playing(prevId).forEach(el => { el.classList.remove("playing"); Lab.paintTile(el, -1); });
    if (P.current) { playing(P.current).forEach(el => el.classList.add("playing")); if (!P.raf) P.raf = requestAnimationFrame(frame); }
  };

  // ---- decoding: a few at a time, the dock's request first; decoded audio kept for the latest few files
  const Q = [], jobs = new Map(), LRU = new Map(), MAX_DECODED = 16;
  let running = 0;
  function pump() {
    while (running < 4 && Q.length) {
      const j = Q.shift(); jobs.delete(j.url); running++;
      j.fn().then(j.ok, j.no).finally(() => { running--; pump(); });
    }
  }
  function enqueue(url, fn, urgent) {
    return new Promise((ok, no) => { const j = { url, fn, ok, no }; jobs.set(url, j); urgent ? Q.unshift(j) : Q.push(j); pump(); });
  }
  function bump(url) { const j = jobs.get(url), i = Q.indexOf(j); if (i > 0) { Q.splice(i, 1); Q.unshift(j); } }
  Lab.decode = function (url, urgent = false) {
    if (LRU.has(url)) { const p = LRU.get(url); LRU.delete(url); LRU.set(url, p); if (urgent) bump(url); return p; }
    const p = enqueue(url, async () => {
      const b = await A.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const n = b.length, ch = b.numberOfChannels, data = new Float32Array(n);
      for (let c = 0; c < ch; c++) { const x = b.getChannelData(c); for (let i = 0; i < n; i++) data[i] += x[i] / ch; }
      return { data, sr: b.sampleRate, dur: b.duration };
    }, urgent);
    LRU.set(url, p); p.catch(() => LRU.delete(url));
    while (LRU.size > MAX_DECODED) LRU.delete(LRU.keys().next().value);
    return p;
  };
  // Peak and RMS envelopes in `n` buckets.
  Lab.buckets = function (d, n) {
    const peak = new Float32Array(n), rms = new Float32Array(n), step = d.length / n;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step), b = Math.min(d.length, Math.max(a + 1, Math.floor((i + 1) * step)));
      let m = 0, s = 0;
      for (let j = a; j < b; j++) { const v = d[j], av = v < 0 ? -v : v; if (av > m) m = av; s += v * v; }
      peak[i] = m; rms[i] = Math.sqrt(s / Math.max(1, b - a));
    }
    return { peak, rms };
  };
  const AN = new Map();
  Lab.analyse = function (url, urgent = false) {
    if (!AN.has(url)) {
      const p = Lab.decode(url, urgent).then(s => ({ dur: s.dur, ...Lab.buckets(s.data, 360) }));
      AN.set(url, p); p.catch(() => AN.delete(url));
    } else if (urgent) bump(url);
    return AN.get(url);
  };

  // ---- waveforms: mirrored peak (outer) and RMS (inner) bars; the played part lights up
  const TONES = { idle: ["#30343f", "#525870"], focus: ["#3c4157", "#8087a8"], pick: ["#4d3f20", "#ad8a40"], dim: ["#25282f", "#363a45"] };
  const amp = v => Math.min(1, Math.pow(v, .72));
  Lab.paintWave = function (cv, a, { progress = -1, tone = "idle", bar = 2, gap = 1 } = {}) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h || !a) return;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const n = Math.max(4, Math.floor((w + gap) / (bar + gap))), mid = h / 2, len = a.peak.length, [ip, ir] = TONES[tone] || TONES.idle;
    let lit = null;
    if (progress >= 0) {
      if (tone === "pick") lit = "#ffc857";
      else { lit = g.createLinearGradient(0, 0, w, 0); lit.addColorStop(0, "#8b7bff"); lit.addColorStop(1, "#5bd6ff"); }
    }
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i * len / n), e = Math.max(s + 1, Math.floor((i + 1) * len / n));
      let p = 0, r = 0;
      for (let j = s; j < e && j < len; j++) { if (a.peak[j] > p) p = a.peak[j]; if (a.rms[j] > r) r = a.rms[j]; }
      const hp = Math.max(.6, amp(p) * (mid - 1)), hr = Math.max(.5, amp(r) * (mid - 1)), x = i * (bar + gap);
      const played = lit && (i + .5) / n <= progress;
      g.globalAlpha = played ? .42 : 1; g.fillStyle = played ? lit : ip; g.fillRect(x, mid - hp, bar, hp * 2);
      g.globalAlpha = 1; g.fillStyle = played ? lit : ir; g.fillRect(x, mid - hr, bar, hr * 2);
    }
  };

  // ---- spectrograms: a log-frequency STFT, coloured ink → violet → rose → gold
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  const STOPS = [[0, [10, 11, 15]], [.16, [26, 17, 62]], [.36, [72, 40, 158]], [.55, [139, 104, 255]], [.72, [232, 94, 172]], [.87, [255, 172, 88]], [1, [255, 245, 218]]];
  const LUT = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255, k = STOPS.findIndex(s => s[0] >= x), [x1, c1] = STOPS[Math.max(1, k)], [x0, c0] = STOPS[Math.max(0, k - 1)];
    const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    for (let c = 0; c < 3; c++) LUT[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * f;
  }
  Lab.SPEC_COLORS = STOPS;
  const SPEC = new Map();
  Lab.spectrogram = function (url, s) {
    if (SPEC.has(url)) return SPEC.get(url);
    const N = s.dur > 8 ? 2048 : 1024, rows = 192, fmin = 30, fmax = Math.min(20000, s.sr / 2), d = s.data;
    const hop = Math.max(32, Math.floor(Math.max(1, d.length - N) / 1400)), frames = Math.max(1, Math.floor(Math.max(0, d.length - N) / hop) + 1);
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1));
    const binHz = s.sr / N, lo = new Float32Array(rows + 1);
    for (let r = 0; r <= rows; r++) lo[r] = fmin * Math.pow(fmax / fmin, r / rows) / binHz;
    const out = new Float32Array(frames * rows), re = new Float32Array(N), im = new Float32Array(N);
    let top = -200;
    for (let f = 0; f < frames; f++) {
      const o = f * hop;
      for (let i = 0; i < N; i++) { re[i] = (d[o + i] || 0) * win[i]; im[i] = 0; }
      fft(re, im);
      for (let r = 0; r < rows; r++) {
        const b0 = lo[r], b1 = lo[r + 1];
        let pw = 0;
        if (b1 - b0 < 1) { const b = Math.floor(b0), t = b0 - b, p0 = re[b] * re[b] + im[b] * im[b], p1 = re[b + 1] * re[b + 1] + im[b + 1] * im[b + 1]; pw = p0 + (p1 - p0) * t; }
        else for (let b = Math.floor(b0); b < Math.ceil(b1); b++) { const p = re[b] * re[b] + im[b] * im[b]; if (p > pw) pw = p; }
        const db = 10 * Math.log10(pw + 1e-12);
        out[f * rows + r] = db; if (db > top) top = db;
      }
    }
    const cv = document.createElement("canvas"); cv.width = frames; cv.height = rows;
    const g = cv.getContext("2d"), img = g.createImageData(frames, rows), RANGE = 84;
    for (let f = 0; f < frames; f++) for (let r = 0; r < rows; r++) {
      const v = Lab.clamp((out[f * rows + r] - (top - RANGE)) / RANGE, 0, 1), c = Math.round(Math.pow(v, 1.15) * 255) * 3, p = ((rows - 1 - r) * frames + f) * 4;
      img.data[p] = LUT[c]; img.data[p + 1] = LUT[c + 1]; img.data[p + 2] = LUT[c + 2]; img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    Object.assign(cv, { fmin, fmax });
    SPEC.set(url, cv);
    while (SPEC.size > 10) SPEC.delete(SPEC.keys().next().value);
    return cv;
  };
  Lab.freqAt = (cv, y01) => cv.fmin * Math.pow(cv.fmax / cv.fmin, 1 - y01);
  Lab.fmtHz = f => f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`;

  // ---- tiles: a take's waveform, caption, badges and length; drawn when scrolled into view
  const io = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); load(e.target); }
  }, { rootMargin: "400px" });
  function load(el) {
    Lab.analyse(el._url).then(a => {
      el._a = a;
      const dur = el.querySelector(".dur");
      if (dur && !dur.textContent) dur.textContent = `${a.dur.toFixed(2)}s`;
      Lab.paintTile(el);
    }).catch(() => el.classList.add("failed"));
  }
  Lab.watch = (el, url) => { el._url = url; if (url) io.observe(el); };
  Lab.tile = function (take, caption, cls = "") {
    const d = document.createElement("div");
    d.className = `tile ${cls} ${take.failed ? "failed" : ""}`;
    d.dataset.id = take.id; d.dataset.playId = take.id;
    d.innerHTML = `<canvas></canvas><div class="foot"><span class="cap">${Lab.esc(caption)}</span>
      <span class="badge up">${Lab.icon("up")}</span><span class="badge down">${Lab.icon("down")}</span>
      <span class="dur">${take.failed || take.duration == null ? "" : `${(+take.duration).toFixed(2)}s`}</span></div><span class="star">${Lab.icon("starFill")}</span>`;
    if (!take.failed) Lab.watch(d, take.url);
    return d;
  };
  Lab.paintTile = function (el, progress) {
    const cv = el._a && el.querySelector("canvas");
    if (!cv) return;
    if (progress == null) progress = P.current === el.dataset.playId && P.el.duration ? P.el.currentTime / P.el.duration : -1;
    const c = el.classList, tone = c.contains("pick") || c.contains("chosen") ? "pick" : c.contains("focus") ? "focus" : c.contains("down") ? "dim" : "idle";
    Lab.paintWave(cv, el._a, { progress, tone });
  };
  // Set a tile's state classes, repainting only when its look changes.
  Lab.tileState = function (el, st) {
    let changed = false;
    for (const [k, v] of Object.entries(st)) if (el.classList.contains(k) !== !!v) { el.classList.toggle(k, !!v); changed = true; }
    if (changed) Lab.paintTile(el);
  };
  addEventListener("resize", () => { clearTimeout(Lab._rz); Lab._rz = setTimeout(() => document.querySelectorAll(".tile, .cell").forEach(el => Lab.paintTile(el)), 150); });
})();
