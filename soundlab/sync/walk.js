// The scene walk: where the music goes next. Made by Sound Lab (`soundlab sync`) from its own player's code
// (web-app/src/mixer/engine/scenewalk.ts): the game makes the choices the Mixer made. Don't edit it here; a sync
// writes it again. No dependencies: an ES module any JavaScript runs, and the algorithm to port (see README.md).
// The scene walk (2026-10-21, the designer: the music should "really flow in the game naturally, but at the same time
// always be unique ... go from chill to less chill in waves"): where the music graph's walk goes next, on its own. It
// knows nothing of audio or of the app: give it the music of a synced manifest (songs, scenes, cuts) and a few settings,
// and ask it for the next step to play. The Mixer walks the graph with it, and `soundlab sync` ships this file to the
// game as walk.js (its reference), so a game makes the choices the Mixer made. No imports, no dependencies.
//
// The walk plays a scene (songs that could pass as sections of one long piece: one lead, beat and bass, amount of noise)
// for a while, cutting from song to song at their seamless cuts (after A's bar e, B from its bar s), each song at least
// Stay bars and at most one pass round its loop; then a rest, and the next scene: the one nearest a target energy that
// rises from chill to less chill and back as a slow wave, never one of the last few, and the songs heard least.
//
// The designer's votes are in its music (2026-10-23, "lets have the votes effect whats in the game"): a transition they
// thumbed down isn't there, one they thumbed up is marked liked and taken first. Where a scene changes, or a song has no
// cut on into its own scene, the walk takes a way in (a bridge: a transition the lab judged likely to please them, from
// the bar the song stopped on into another song's phrase start), the best of those into the scenes it may go to next.
/** Bars in a phrase. */
export const LEN = 4;
/** What a transition the designer thumbed up is worth, against the energy aimed at (a cut) or the fit (a bridge). */
export const LIKED = 0.1;
/** The scenes nearest the energy aimed at that a scene change looks for a way into (2026-10-23: from the three it picks
 * among by chance, 40% of scene changes found one; from six, 59%, and the music kept as near the energy aimed at). */
export const WAY_SCENES = 6;
export class SceneWalk {
    constructor(data, settings, opts = {}) {
        this.lo = -1;
        this.hi = 1;
        this.run = null;
        this.pending = null;
        this.scene = null;
        this.bars = 0;
        this.heard = new Map();
        this.scenes = [];
        this.visits = 0;
        /** Where the last scene stopped (its song and last bar): the next scene is entered from there. */
        this.left = null;
        this.settings = typeof settings === 'function' ? settings : () => settings;
        this.rand = opts.random ?? Math.random;
        this.setData(data);
        if (opts.memory)
            this.remember(opts.memory);
    }
    /** New music (a sync, a vote): the walk goes on where it is. */
    setData(data) {
        this.data = data;
        const e = Object.values(data.songs).map(s => s.energy).sort((a, b) => a - b);
        this.lo = e.length ? e[Math.floor(e.length * 0.1)] : -1;
        this.hi = e.length ? e[Math.floor(e.length * 0.9)] : 1;
    }
    /** A fresh walk: nothing heard. */
    reset() { this.run = null; this.pending = null; this.scene = null; this.left = null; this.bars = 0; this.heard = new Map(); this.scenes = []; }
    remember(m) { this.heard = new Map(Object.entries(m.heard)); this.scenes = [...m.scenes]; this.bars = m.bars; }
    memory() { return { heard: Object.fromEntries(this.heard), scenes: this.scenes.slice(-16), bars: this.bars }; }
    /** The energy aimed at after `bars` bars: from chill (the library's 10th percentile) to less chill (its 90th) and back. */
    target(bars = this.bars) {
        return this.lo + (this.hi - this.lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * bars) / this.settings().waveBars));
    }
    energy(id) { return this.data.songs[id]?.energy ?? 0; }
    members(fid) { return (this.data.scenes[fid]?.members ?? []).filter(m => this.data.songs[m]); }
    sceneOf(id) { return Object.keys(this.data.scenes).find(f => this.data.scenes[f].members.includes(id)) ?? null; }
    /** Where song `a`, just past its bar `after`, can cut seamlessly into another member of its scene. */
    cutsAt(a, after) { return (this.data.cuts[a] ?? []).filter(c => c.after === after && this.data.songs[c.to]); }
    /** The songs a visit to `a` may cut into (to load them ahead). */
    cutsFrom(a) {
        const s = this.data.songs[a];
        return s ? [...new Set((this.data.cuts[a] ?? []).filter(c => c.after >= s.loop[0] && c.after <= s.loop[1] && this.data.songs[c.to]).map(c => c.to))] : [];
    }
    /** Where the walk is: the scene, its bars, the energy aimed at and the song's. */
    state() {
        if (!this.scene)
            return null;
        return { scene: this.scene.fid, bars: this.scene.bars, target: this.target(), energy: this.run ? this.energy(this.run.visit.song) : null };
    }
    /** On to the next scene at once (skip): its first song, which next() then plays. */
    skip() {
        this.left = this.run ? { song: this.run.visit.song, bar: this.run.lastBar } : null;
        const p = this.enterScene();
        if (p) {
            this.run = null;
            this.pending = p;
        }
        return p;
    }
    /** Enter a song at a bar (a page's choice, a skip): in its scene, keeping what was heard. */
    enter(song, start) {
        if (this.pending?.song !== song || this.pending.start !== start || !this.scene) {
            const fid = this.sceneOf(song);
            if (!fid)
                return;
            if (this.scene?.fid !== fid) {
                this.scene = { fid, bars: 0, played: [] };
                this.scenes.push(fid);
            }
            this.pending = { song, start };
        }
        this.run = null;
    }
    /** The song playing is done: the walk moves on at its next chance. */
    hurry() { if (this.run)
        this.run.played = Math.max(this.run.played, 999); }
    /** The next step: a part of a song (up to a phrase at a time while it has Stay to play, then bar by bar, so it can
     * leave at any bar that cuts well), or a rest between scenes. Null when there's nothing to play. */
    next(depth = 0) {
        const st = this.settings();
        if (depth > 4)
            return null;
        if (!this.run) {
            const p = this.pending && this.scene ? this.pending : this.enterScene();
            this.pending = null;
            if (!p)
                return null;
            this.start(p.song, p.start);
        }
        const r = this.run, sc = this.scene, song = r.visit.song;
        if (!sc.played.includes(song))
            sc.played.push(song);
        // (a song plays its loop at most once before the walk looks for a way on: a 6-bar loop under Stay 12 played three
        // times over is the same thing 18 bars running; the graph never repeats a loop)
        const loopLen = r.visit.hi - r.visit.lo + 1, stay = Math.min(st.stay, loopLen), most = Math.max(stay, Math.min(stay + LEN, loopLen));
        if (sc.bars >= st.sceneBars) { // (the scene's done: at a phrase end, or 8 bars on at most, a rest, then the next)
            if (r.played >= Math.min(stay, LEN) && (this.phraseEnd(r) || sc.bars >= st.sceneBars + 8 || r.played >= most)) {
                this.run = null;
                this.scene = null;
                this.left = { song, bar: r.lastBar };
                return { kind: 'rest', bars: st.restBars, after: song };
            }
        }
        else if (r.played >= stay) {
            // (a seamless cut into a member this scene hasn't played, toward the target energy and the least heard; a liked one first)
            const t = this.target(), cut = this.cutsAt(song, r.lastBar).filter(c => !sc.played.includes(c.to))
                .map(c => ({ c, k: Math.abs(this.energy(c.to) - t) + 0.05 * Math.log1p(this.heard.get(c.to) ?? 0) + 0.1 * this.rand() - (c.liked ? LIKED : 0) })).sort((a, b) => a.k - b.k)[0]?.c;
            if (cut) {
                this.start(cut.to, cut.start);
                return this.next(depth + 1);
            }
            if (this.phraseEnd(r) || r.played >= most) { // (no cut: a way on into a member it hasn't played, else another member)
                const way = this.wayInto(song, r.lastBar, [sc.fid], [...sc.played, song]);
                if (way) {
                    this.start(way.to, way.start);
                    return this.next(depth + 1);
                }
                const m = this.pickMember(sc.fid, t, song, sc.played);
                if (m) {
                    this.start(m, this.data.songs[m].entry);
                    return this.next(depth + 1);
                }
            }
        }
        if (r.bar > r.visit.hi)
            r.bar = r.visit.lo;
        const bars = r.played < stay ? Math.min(LEN - (r.played % LEN), stay - r.played, r.visit.hi - r.bar + 1) : 1;
        const step = { kind: 'part', visit: r.visit, song, bar: r.bar, bars, first: r.first, at: r.played };
        r.first = false;
        r.bar += bars;
        r.played += bars;
        r.lastBar = step.bar + bars - 1;
        sc.bars += bars;
        this.bars += bars;
        this.heard.set(song, (this.heard.get(song) ?? 0) + bars);
        return step;
    }
    start(song, start) {
        const s = this.data.songs[song], lo = Math.min(s.loop[0], start), hi = Math.min(this.data.bars, Math.max(s.loop[1], start + LEN - 1));
        this.run = { visit: { id: ++this.visits, song, entry: start, lo, hi }, bar: start, played: 0, lastBar: start - 1, first: true };
    }
    /** Is the visit's last bar the end of a phrase? */
    phraseEnd(r) {
        const ph = this.data.songs[r.visit.song]?.phrase;
        if (ph != null)
            return (((r.lastBar - ph) % LEN) + LEN) % LEN === LEN - 1;
        return r.played % LEN === 0;
    }
    /** The next scene: the nearest the target energy (its members' mean), a little against those heard more, never one of
     * the last few; one of the best three, so no two walks are the same. Its first song: nearest the target, heard least. */
    enterScene() {
        const t = this.target(), avoid = this.settings().avoid ?? 4;
        const recent = [...this.scenes.slice(-avoid), ...(this.scene ? [this.scene.fid] : [])];
        const fs = Object.keys(this.data.scenes).map(fid => ({ fid, ms: this.members(fid) })).filter(x => x.ms.length);
        const fresh = fs.filter(x => !recent.includes(x.fid)), from = fresh.length ? fresh : fs;
        const cost = (x) => {
            const e = x.ms.reduce((a, m) => a + this.energy(m), 0) / x.ms.length, h = x.ms.reduce((a, m) => a + (this.heard.get(m) ?? 0), 0) / x.ms.length;
            return Math.abs(e - t) + 0.02 * Math.log1p(h) + 0.15 * this.rand();
        };
        const ranked = from.map(x => ({ x, c: cost(x) })).sort((a, b) => a.c - b.c), best = ranked.slice(0, 3);
        // (from where the last scene stopped: the best way into one of the WAY_SCENES nearest; with none, one of the three
        // nearest by chance, from its first song's entry)
        const left = this.left, way = left ? this.wayInto(left.song, left.bar, ranked.slice(0, WAY_SCENES).map(b => b.x.fid)) : null;
        this.left = null;
        const fid = way ? this.sceneOf(way.to) : best.length ? best[Math.floor(this.rand() * best.length)].x.fid : null;
        const m = way ? way.to : fid ? this.pickMember(fid, t) : null;
        if (!fid || !m)
            return null;
        this.scene = { fid, bars: 0, played: [] };
        this.scenes.push(fid);
        return { song: m, start: way ? way.start : this.data.songs[m].entry };
    }
    /** The best way from song `a` past its bar `after` into a song of one of the scenes `fids` (not one of `not`): the
     * likeliest to please, a liked one first. Null when there's none. */
    wayInto(a, after, fids, not = []) {
        const ways = (this.data.bridges?.[a] ?? []).filter(w => w.after === after && this.data.songs[w.to] && !not.includes(w.to) && fids.includes(this.sceneOf(w.to) ?? ''));
        return ways.map(w => ({ w, k: w.fit + (w.liked ? LIKED : 0) + 0.1 * this.rand() })).sort((x, y) => y.k - x.k)[0]?.w ?? null;
    }
    /** A member to play: one the scene hasn't played if there is one, nearest the target energy, heard least, not `not`. */
    pickMember(fid, target, not, played = []) {
        const all = this.members(fid).filter(m => m !== not), fresh = all.filter(m => !played.includes(m)), ms = fresh.length ? fresh : all;
        return ms.map(m => ({ m, c: Math.abs(this.energy(m) - target) + 0.05 * Math.log1p(this.heard.get(m) ?? 0) + 0.1 * this.rand() }))
            .sort((a, b) => a.c - b.c)[0]?.m ?? null;
    }
}
/** The walk a synced manifest (soundlab.json) describes: its music, and its play settings. */
export function fromManifest(m, opts = {}) {
    const p = m.play;
    return new SceneWalk(m.walk, { stay: p.stay, sceneBars: p.sceneBars, waveBars: p.waveBars, restBars: p.restBars, avoid: p.avoid }, opts);
}
/** A seeded random source (mulberry32), for a walk a game can repeat. */
export function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
