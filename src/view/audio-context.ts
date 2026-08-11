/**
 * The one Web Audio context shared by the view and the engine.
 *
 * The first button press can arrive before the renderer chunk has finished
 * loading. Creating the context here, synchronously in that press, preserves
 * the browser's user-gesture grant; SoundEngine then builds its graph on the
 * same context once the chunk is ready.
 */
let context: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (context?.state === "closed") context = null;
  return (context ??= new AudioContext());
}

/** Prime the context from a user gesture without constructing the sound graph. */
export function primeAudio(): void {
  void getAudioContext().resume();
}

export function closeAudioContext(ctx: AudioContext): void {
  if (context === ctx) context = null;
  void ctx.close();
}
