/**
 * Keyboard input. Continuous axes (fed to the physics step) are kept separate
 * from one-shot key presses (which drive UI actions).
 */

/**
 * What the physical key would be on a US layout: 'KeyA' -> 'a', 'Digit3' ->
 * '3', 'Space' -> ' '. Returns null for keys with no binding in this game.
 *
 * Every binding is read from both `key` and `code`, because neither alone is
 * enough. `key` is what the layout produces, which is the right thing for a
 * player on AZERTY pressing the letter printed on the cap -- but with a Korean
 * or Japanese input method switched on it is the jamo or kana, so 'a' arrives
 * as 'ㅁ' and every letter binding in the game silently stops working while
 * the arrow keys carry on. `code` is the physical key and is immune to that,
 * but it hard-codes a US layout. Accepting either costs one Set entry and
 * means the helm answers whichever way you are typing.
 */
function usKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  switch (code) {
    case 'Space':
      return ' ';
    case 'Escape':
      return 'escape';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Minus':
      return '-';
    case 'Equal':
      return '=';
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
      return code.toLowerCase();
    default:
      return null;
  }
}

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

  /**
   * The tokens one press should answer to.
   *
   * The physical key is a *fallback*, not a second binding. Taking both
   * unconditionally binds one press to two controls on any layout where the
   * caps do not match a US board: on AZERTY the A key reports key 'a' with
   * code 'KeyQ', which put the helm to port and shifted the wind at the same
   * time. When the layout produced a plain letter or digit, that is what the
   * player pressed and it is the whole answer. Only when it produced something
   * that cannot be a binding -- a jamo, a kana, an input method's placeholder
   * -- is there nothing to match and the physical key has to stand in.
   */
  private tokens(e: KeyboardEvent): string[] {
    const typed = e.key.toLowerCase();
    if (/^[a-z0-9]$/.test(typed)) return [typed];

    const out: string[] = [];
    // An input method in the middle of composing reports these instead of a
    // character. They are not keys, and holding onto one would leave a token
    // in `held` that no keyup ever clears.
    if (typed !== 'process' && typed !== 'dead' && typed !== 'unidentified') out.push(typed);
    const physical = usKey(e.code);
    if (physical && physical !== out[0]) out.push(physical);
    return out;
  }

  private onDown = (e: KeyboardEvent) => {
    // Typing into a field is typing, not steering. The seed box is the only one
    // in the game, but a stray keystroke there should not put the helm over.
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || /^(input|textarea|select)$/i.test(target?.tagName ?? '')) {
      return;
    }
    for (const k of this.tokens(e)) {
      if (!this.held.has(k)) this.pressed.add(k);
      this.held.add(k);
      if (k.startsWith('arrow') || k === ' ') e.preventDefault();
    }
  };

  private onUp = (e: KeyboardEvent) => {
    for (const k of this.tokens(e)) this.held.delete(k);
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
