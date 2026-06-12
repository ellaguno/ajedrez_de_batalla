export type Ease = (t: number) => number;

export const easeInOutQuad: Ease = (t) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
export const easeOutCubic: Ease = (t) => 1 - (1 - t) ** 3;
export const linear: Ease = (t) => t;

interface ActiveTween {
  duration: number;
  elapsed: number;
  ease: Ease;
  update: (k: number) => void;
  resolve: () => void;
}

/** Sistema mínimo de interpolaciones, avanzado desde el bucle de render. */
export class Tweens {
  private items: ActiveTween[] = [];

  run(duration: number, update: (k: number) => void, ease: Ease = easeInOutQuad): Promise<void> {
    return new Promise((resolve) => {
      this.items.push({ duration, elapsed: 0, ease, update, resolve });
    });
  }

  delay(seconds: number): Promise<void> {
    return this.run(seconds, () => {}, linear);
  }

  tick(dt: number): void {
    const finished: ActiveTween[] = [];
    for (const tw of this.items) {
      tw.elapsed += dt;
      const k = Math.min(1, tw.elapsed / tw.duration);
      tw.update(tw.ease(k));
      if (k >= 1) finished.push(tw);
    }
    if (finished.length > 0) {
      this.items = this.items.filter((t) => !finished.includes(t));
      for (const tw of finished) tw.resolve();
    }
  }
}
