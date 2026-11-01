// src/lib/drowsiness/scorer.ts
//
// Rolling-window drowsiness scorer, ported 1:1 from the mobile app
// (Driver-Drowsiness-App/src/engine/DrowsinessScorer.ts).
//
// State machine:
//   alert    → driver is fine
//   drowsy   → warning, yellow banner (≥ DROWSY_DURATION_MS of continuous drowsy frames)
//   critical → danger, alarm + vibration (≥ CRITICAL_DURATION_MS)
//   reset to alert only after SAFE_DURATION_MS of continuous safe frames.

export type DrowsinessState = "alert" | "drowsy" | "critical";

export class DrowsinessScorer {
  private drowsyStartTime: number | null = null;
  private safeStartTime: number | null = null;
  private state: DrowsinessState = "alert";

  private readonly CRITICAL_DURATION_MS = 3000;
  private readonly DROWSY_DURATION_MS = 1000;
  private readonly SAFE_DURATION_MS = 1500;

  addFrame(isDrowsy: boolean, now: number = Date.now()): DrowsinessState {
    if (!isDrowsy) {
      if (this.safeStartTime === null) {
        this.safeStartTime = now;
      }
      if (now - this.safeStartTime >= this.SAFE_DURATION_MS) {
        this.drowsyStartTime = null;
        this.state = "alert";
      }
      return this.state;
    }

    this.safeStartTime = null;

    if (this.drowsyStartTime === null) {
      this.drowsyStartTime = now;
    }

    const duration = now - this.drowsyStartTime;
    if (duration >= this.CRITICAL_DURATION_MS) {
      this.state = "critical";
    } else if (duration >= this.DROWSY_DURATION_MS) {
      this.state = "drowsy";
    }
    return this.state;
  }

  getState(): DrowsinessState {
    return this.state;
  }

  getDuration(): number {
    if (this.drowsyStartTime === null) return 0;
    return (Date.now() - this.drowsyStartTime) / 1000;
  }

  reset(): void {
    this.drowsyStartTime = null;
    this.safeStartTime = null;
    this.state = "alert";
  }
}
