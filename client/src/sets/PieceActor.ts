import * as THREE from 'three';
import type { ClipKey } from './types';

/**
 * Una pieza en escena: su Object3D raíz y, si el set trae animaciones,
 * un AnimationMixer con los clips canónicos. Los sets estáticos (clásico)
 * crean actores sin mixer y todas las reproducciones son no-op.
 */
export class PieceActor {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipKey, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(
    model: THREE.Object3D,
    clips: THREE.AnimationClip[] = [],
    clipNames: Partial<Record<ClipKey, string>> = {},
  ) {
    this.root.add(model);
    if (clips.length === 0) return;

    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(clipNames) as [ClipKey, string][]) {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (clip) this.actions.set(key, this.mixer.clipAction(clip));
    }
  }

  has(key: ClipKey): boolean {
    return this.actions.has(key);
  }

  /** Reproduce un clip en bucle con fundido desde el actual. */
  playLoop(key: ClipKey, randomOffset = false): void {
    const action = this.actions.get(key);
    if (!action || this.current === action) return;
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    if (randomOffset) action.time = Math.random() * action.getClip().duration;
    this.crossTo(action);
  }

  /** Reproduce un clip una vez; resuelve al terminar. Mantiene la pose final. */
  playOnce(key: ClipKey): Promise<void> {
    const action = this.actions.get(key);
    const mixer = this.mixer;
    if (!action || !mixer) return Promise.resolve();
    return new Promise((resolve) => {
      const onFinished = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== action) return;
        mixer.removeEventListener('finished', onFinished as never);
        resolve();
      };
      mixer.addEventListener('finished', onFinished as never);
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      this.crossTo(action);
    });
  }

  private crossTo(action: THREE.AnimationAction, fade = 0.18): void {
    action.play();
    if (this.current && this.current !== action) {
      this.current.crossFadeTo(action, fade, false);
    }
    this.current = action;
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}
