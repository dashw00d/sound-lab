// The scene walk: where the music goes next. Made by Sound Lab (`soundlab sync`) from its own player's code
// (web-app/src/mixer/engine/scenewalk.ts): the game makes the choices the Mixer made. Don't edit it here; a sync
// writes it again. No dependencies: an ES module any JavaScript runs, and the algorithm to port (see README.md).
/** Bars in a phrase. */
export declare const LEN = 4;
export interface WalkSong {
    /** The bars it loops between (1-based, inclusive): its mellow cues. */
    loop: [number, number];
    /** Where it's entered on its own: its first phrase start inside the loop. */
    entry: number;
    /** The bar its phrases start on (they're 4 bars), or null when it has no clear phrasing. */
    phrase: number | null;
    /** How un-chill it is (the library's own scale: higher is busier, brighter, more percussive). */
    energy: number;
}
/** A seamless cut: after this song's bar `after`, the song `to` from its bar `start`. */
export interface WalkCut {
    to: string;
    after: number;
    start: number;
}
export interface WalkData {
    /** Bars in each song's file (the loop is inside them). */
    bars: number;
    songs: Record<string, WalkSong>;
    scenes: Record<string, {
        members: string[];
    }>;
    cuts: Record<string, WalkCut[]>;
}
export interface WalkSettings {
    /** Bars a song plays at least before the walk looks for a way on. */
    stay: number;
    /** Bars in a scene before it rests and moves on. */
    sceneBars: number;
    /** Bars in one wave of the target energy, chill to less chill and back. */
    waveBars: number;
    /** Bars of silence between scenes. */
    restBars: number;
    /** Scenes the next one is never one of (the last few played). Default 4. */
    avoid?: number;
}
/** A song's visit: it's entered at `entry` and loops between `lo` and `hi` until the walk leaves it. */
export interface Visit {
    id: number;
    song: string;
    entry: number;
    lo: number;
    hi: number;
}
export type Step = {
    kind: 'part';
    visit: Visit;
    song: string;
    bar: number;
    bars: number;
    first: boolean;
    at: number;
} | {
    kind: 'rest';
    bars: number;
    after: string;
};
/** What to keep between sessions, so the walk stays unique across them: bars heard of each song, the scenes lately. */
export interface WalkMemory {
    heard: Record<string, number>;
    scenes: string[];
    bars: number;
}
export declare class SceneWalk {
    private data;
    private settings;
    private rand;
    private lo;
    private hi;
    private run;
    private pending;
    private scene;
    private bars;
    private heard;
    private scenes;
    private visits;
    constructor(data: WalkData, settings: WalkSettings | (() => WalkSettings), opts?: {
        random?: () => number;
        memory?: WalkMemory;
    });
    /** New music (a sync, a vote): the walk goes on where it is. */
    setData(data: WalkData): void;
    /** A fresh walk: nothing heard. */
    reset(): void;
    remember(m: WalkMemory): void;
    memory(): WalkMemory;
    /** The energy aimed at after `bars` bars: from chill (the library's 10th percentile) to less chill (its 90th) and back. */
    target(bars?: number): number;
    energy(id: string): number;
    members(fid: string): string[];
    sceneOf(id: string): string | null;
    /** Where song `a`, just past its bar `after`, can cut seamlessly into another member of its scene. */
    cutsAt(a: string, after: number): WalkCut[];
    /** The songs a visit to `a` may cut into (to load them ahead). */
    cutsFrom(a: string): string[];
    /** Where the walk is: the scene, its bars, the energy aimed at and the song's. */
    state(): {
        scene: string;
        bars: number;
        target: number;
        energy: number | null;
    } | null;
    /** On to the next scene at once (skip): its first song, which next() then plays. */
    skip(): {
        song: string;
        start: number;
    } | null;
    /** Enter a song at a bar (a page's choice, a skip): in its scene, keeping what was heard. */
    enter(song: string, start: number): void;
    /** The song playing is done: the walk moves on at its next chance. */
    hurry(): void;
    /** The next step: a part of a song (up to a phrase at a time while it has Stay to play, then bar by bar, so it can
     * leave at any bar that cuts well), or a rest between scenes. Null when there's nothing to play. */
    next(depth?: number): Step | null;
    private start;
    /** Is the visit's last bar the end of a phrase? */
    private phraseEnd;
    /** The next scene: the nearest the target energy (its members' mean), a little against those heard more, never one of
     * the last few; one of the best three, so no two walks are the same. Its first song: nearest the target, heard least. */
    private enterScene;
    /** A member to play: one the scene hasn't played if there is one, nearest the target energy, heard least, not `not`. */
    private pickMember;
}
/** The walk a synced manifest (soundlab.json) describes: its music, and its play settings. */
export declare function fromManifest(m: {
    walk: WalkData;
    play: WalkSettings;
}, opts?: {
    random?: () => number;
    memory?: WalkMemory;
}): SceneWalk;
/** A seeded random source (mulberry32), for a walk a game can repeat. */
export declare function seeded(seed: number): () => number;
