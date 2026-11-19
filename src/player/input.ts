// Keyboard + mouse input for a desktop browser game.
// - Keys are read by physical position (KeyboardEvent.code), so WASD works with any
//   keyboard layout, including Burmese and AZERTY.
// - The mouse is captured with the Pointer Lock API. Browsers always release it on
//   Esc, so losing the lock is treated as "pause".
// - All keys are cleared when the window loses focus, so nothing gets stuck.

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyF', 'KeyK', 'KeyJ', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyR', 'KeyG',
]);

export class Input {
  private down = new Set<string>();
  private pressedOnce = new Set<string>();
  private mouseButtons = new Set<number>();
  private mousePressedOnce = new Set<number>();
  private wheelAcc = 0;
  lookX = 0;
  lookY = 0;
  locked = false;
  /** When true (QA mode) movement works without pointer lock. */
  allowUnlocked = false;
  onLockChange: (locked: boolean) => void = () => {};
  enabled = false;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressedOnce.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => document.hidden && this.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Ignore rare huge jumps some systems report right after locking.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.clear();
      this.onLockChange(this.locked);
    });
    addEventListener('mousedown', (e) => {
      if (this.enabled && (this.locked || this.allowUnlocked) && (e.button === 0 || e.button === 2)) {
        this.mouseButtons.add(e.button);
        this.mousePressedOnce.add(e.button);
      }
    });
    // Mouse back/forward buttons would navigate away from the game.
    addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
      if (this.enabled && (e.button === 3 || e.button === 4)) e.preventDefault();
    });
    addEventListener('wheel', (e) => {
      if (this.enabled && (this.locked || this.allowUnlocked)) {
        this.wheelAcc += Math.sign(e.deltaY);
      }
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  async lock() {
    if (this.locked) return true;
    try {
      // Raw mouse input (no OS acceleration) where the browser supports it.
      await (this.canvas.requestPointerLock as (o?: object) => Promise<void>).call(this.canvas, { unadjustedMovement: true });
    } catch {
      try {
        await this.canvas.requestPointerLock();
      } catch {
        // Chrome refuses to re-lock for about a second after Esc; the player just clicks again.
        return false;
      }
    }
    return true;
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() {
    this.down.clear();
    this.pressedOnce.clear();
    this.mouseButtons.clear();
    this.mousePressedOnce.clear();
    this.wheelAcc = 0;
    this.lookX = this.lookY = 0;
  }

  isDown(code: string) {
    return (this.locked || this.allowUnlocked) && this.down.has(code);
  }

  /** True once per physical key press. */
  pressed(code: string) {
    const was = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return was && (this.locked || this.allowUnlocked);
  }

  mouseDown(button = 0): boolean {
    return (this.locked || this.allowUnlocked) && this.mouseButtons.has(button);
  }

  mousePressed(button = 0): boolean {
    const was = this.mousePressedOnce.has(button);
    this.mousePressedOnce.delete(button);
    return was && (this.locked || this.allowUnlocked);
  }

  takeWheel(): number {
    const w = this.wheelAcc;
    this.wheelAcc = 0;
    return w;
  }

  takeLook() {
    const v = { x: this.lookX, y: this.lookY };
    this.lookX = this.lookY = 0;
    return v;
  }

  endFrame() {
    this.pressedOnce.clear();
    this.mousePressedOnce.clear();
  }
}
