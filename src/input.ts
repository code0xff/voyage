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
    // Capture, so the keys are recorded before any UI reacts to them.
    //
    // Bubbling put this after every document listener, and the menu dialog is
    // one: closing it with Escape ran its handler first, which unpaused the
    // engine, which discarded the pending keys -- and only then did this record
    // the very Escape that had closed it. The next frame read it as a fresh
    // press and reopened the menu, so Escape appeared not to close it at all.
    //
    // Recording early costs nothing: `onDown` still ignores keys aimed at a
    // text field, which is decided by the event's target and not by its phase.
    window.addEventListener('keydown', this.onDown, true);
    window.addEventListener('keyup', this.onUp, true);
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
   * Drop every pending key.
   *
   * Clearing `pressed` is the important half. Anything that stops the frame
   * loop -- a hidden tab, a pause -- stops `endFrame()` running, so one-shot
   * keys pile up and all fire on the far side of it: the menu opens, the reef
   * changes, the world resets.
   *
   * The subtler case is a boundary the loop runs *through* rather than stops
   * at. A key pressed while the world is paused belongs to whatever had the
   * screen, and must not be handed to the world a frame later just because the
   * pause lifted in between.
   */
  clearPending(): void {
    this.held.clear();
    this.pressed.clear();
  }

  private onBlur = () => {
    this.clearPending();
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

  /**
   * -1 = harden the leech, +1 = let the head twist open. This is the vang.
   *
   * Z and X sit under the A/D helm keys so that one hand can steer and twist,
   * which is how the control actually gets used: you twist off as the boat
   * stands up in a gust, without letting go of the tiller.
   */
  get twist(): number {
    return this.axis(['z'], ['x']);
  }

  get windShift(): number {
    return this.axis(['q'], ['e']);
  }

  get windGust(): number {
    return this.axis(['[', '-'], [']', '=']);
  }

  /**
   * Press a key that nobody pressed.
   *
   * For the touch controls, which have no keyboard to press. Everything the
   * game can be told to do is already a binding read out of `pressed` once a
   * frame, so injecting there means a touch button reaches reefing, the
   * autopilot, the camera and the anchor without the engine loop growing a
   * second way to hear about any of them. Cleared by `endFrame` like a real
   * press, so it fires once.
   */
  inject(key: string): void {
    this.pressed.add(key);
  }

  wasPressed(key: string): boolean {
    return this.pressed.has(key);
  }

  /** Call at the end of every frame to clear one-shot keys. */
  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown, true);
    window.removeEventListener('keyup', this.onUp, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
  }
}
