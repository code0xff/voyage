/**
 * Keyboard input. Continuous axes (fed to the physics step) are kept separate
 * from one-shot key presses (which drive UI actions).
 */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();

  autoTrim = true;

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  private onDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!this.held.has(k)) this.pressed.add(k);
    this.held.add(k);
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  };

  private onUp = (e: KeyboardEvent) => {
    this.held.delete(e.key.toLowerCase());
  };

  /**
   * Drop every pending key when focus is lost or the tab is hidden.
   *
   * Clearing `pressed` is the important half. A hidden tab stops receiving
   * requestAnimationFrame callbacks, so endFrame() never runs and one-shot keys
   * pile up. Switching back would then fire all of them at once: the menu
   * opens, the reef changes, the race resets.
   */
  private onBlur = () => {
    this.held.clear();
    this.pressed.clear();
  };

  private axis(neg: string[], pos: string[]): number {
    return (
      (pos.some((k) => this.held.has(k)) ? 1 : 0) - (neg.some((k) => this.held.has(k)) ? 1 : 0)
    );
  }

  /**
   * Which way the helm is being moved: -1 to port, +1 to starboard, 0 for not
   * moving. This is a rate, not a position -- the engine integrates it, so the
   * helm stays where it is left.
   */
  get rudder(): number {
    return this.axis(['arrowleft', 'a'], ['arrowright', 'd']);
  }

  /**
   * Centre the helm. Space, or both directions at once -- which is what a hand
   * does on a tiller when it wants the boat to go straight, and is worth
   * supporting because it is the first thing anyone tries.
   */
  get centreHelm(): boolean {
    const port = this.held.has('arrowleft') || this.held.has('a');
    const stbd = this.held.has('arrowright') || this.held.has('d');
    return this.held.has(' ') || (port && stbd);
  }

  /** -1 = trim in, +1 = ease out. */
  get sheet(): number {
    return this.axis(['arrowup', 'w'], ['arrowdown', 's']);
  }

  get windShift(): number {
    return this.axis(['q'], ['e']);
  }

  get windGust(): number {
    return this.axis(['[', '-'], [']', '=']);
  }

  wasPressed(key: string): boolean {
    return this.pressed.has(key);
  }

  /** Call at the end of every frame to clear one-shot keys. */
  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
  }
}
