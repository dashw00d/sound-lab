// One AudioContext for the app (the player's: player/store). Started suspended; the first play resumes it.
let ctx: AudioContext | null = null
export const audio = (): AudioContext => (ctx ??= new AudioContext())
