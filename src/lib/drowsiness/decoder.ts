// src/lib/drowsiness/decoder.ts
//
// Decodes the raw TFLite output tensor into detections.
// Ported from the mobile app's modelDecoder.ts — same model, same layout.
//
// Model output shape: [1, 11, 2100]
//   - 2100 candidate boxes, 11 values per box:
//     0..3 → x_center, y_center, width, height (normalized)
//     4..10 → class scores:
//       Eyes Closed, Hand Off Steering Wheel, Head Tilted Down,
//       Normal Head Position, Not_Yawning, Yawning, eye open
//
// Raw Float32Array is column-major per channel: value at [row, col] = raw[row * NUM_BOXES + col].

export const CLASS_NAMES: string[] = [
  "Eyes Closed",
  "Hand Off Steering Wheel",
  "Head Tilted Down",
  "Normal Head Position",
  "Not_Yawning",
  "Yawning",
  "eye open",
];

export interface Detection {
  className: string;
  score: number;
  bbox: { x: number; y: number; w: number; h: number };
}

const NUM_BOXES = 2100;
const CLASS_DIM = 7;
const BBOX_OFFSET = 4;
const CONFIDENCE_THRESHOLD = 0.35;

const DROWSY_CLASSES = new Set([
  "Eyes Closed",
  "Head Tilted Down",
  "Yawning",
  "Hand Off Steering Wheel",
]);

export function isDrowsyClass(className: string | null): boolean {
  if (className === null) return false;
  return DROWSY_CLASSES.has(className);
}

/** Decode ALL detections above the confidence threshold. */
export function decodeDetections(raw: Float32Array): Detection[] {
  const detections: Detection[] = [];
  for (let box = 0; box < NUM_BOXES; box++) {
    let bestScore = 0;
    let bestClass = -1;
    for (let cls = 0; cls < CLASS_DIM; cls++) {
      const score = raw[(BBOX_OFFSET + cls) * NUM_BOXES + box];
      if (score > bestScore) {
        bestScore = score;
        bestClass = cls;
      }
    }
    if (bestScore > CONFIDENCE_THRESHOLD) {
      const centerX = raw[0 * NUM_BOXES + box];
      const centerY = raw[1 * NUM_BOXES + box];
      const w = raw[2 * NUM_BOXES + box];
      const h = raw[3 * NUM_BOXES + box];
      detections.push({
        className: CLASS_NAMES[bestClass],
        score: bestScore,
        bbox: { x: centerX - w / 2, y: centerY - h / 2, w, h },
      });
    }
  }
  return detections;
}

/** Highest-scoring drowsy detection in a frame, or null. */
export function topDrowsyDetection(detections: Detection[]): Detection | null {
  let top: Detection | null = null;
  for (const d of detections) {
    if (isDrowsyClass(d.className) && (!top || d.score > top.score)) top = d;
  }
  return top;
}
