/** No polling when still; a timer followed by vsync when animating. */
export class FrameScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private frame: number | undefined;
  private last = -Infinity;
  private dirty = true;
  private running = false;
  private active = true;
  private disposed = false;
  fps = 30;
  constructor(private render: (now: number) => void, private raf: typeof requestAnimationFrame = cb => requestAnimationFrame(cb), private caf: typeof cancelAnimationFrame = id => cancelAnimationFrame(id), private now = () => performance.now()) {}
  setAnimated(value: boolean) { this.running = value; if (value) this.invalidate(); else if (!this.dirty) this.cancel(); }
  setActive(value: boolean) { this.active = value; if (value) this.invalidate(); else this.cancel(); }
  invalidate() { if (this.disposed) return; this.dirty = true; this.schedule(); }
  private schedule() {
    if (this.disposed || !this.active || this.timer !== undefined || this.frame !== undefined || (!this.dirty && !this.running)) return;
    const delay = Math.max(0, 1000 / this.fps - (this.now() - this.last));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.frame = this.raf((now) => {
        this.frame = undefined;
        if (!this.active || this.disposed) return;
        this.last = now; this.dirty = false;
        this.render(now);
        this.schedule();
      });
    }, delay);
  }
  private cancel() { if (this.timer !== undefined) clearTimeout(this.timer); if (this.frame !== undefined) this.caf(this.frame); this.timer = undefined; this.frame = undefined; }
  dispose() { this.disposed = true; this.cancel(); }
}
