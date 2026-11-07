// src/lib/drowsiness/useDetector.ts
//
// Webcam drowsiness detector for the browser.
// Runs the trained TFLite model (public/models/drowsiness.tflite) through
// TensorFlow.js' TFLite runner. The model itself is imported dynamically so
// it never touches the server bundle.
//
// Pipeline (mirrors the mobile app):
//   webcam → center square crop (mirrored, like a front camera) →
//   320×320 grayscale replicated to 3 channels → TFLite → decodeDetections

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeDetections,
  isDrowsyClass,
  type Detection,
} from "./decoder";

export type DetectorStatus =
  | "idle"
  | "requesting-camera"
  | "loading-model"
  | "ready"
  | "error";

export interface DetectorState {
  status: DetectorStatus;
  error: string | null;
  detections: Detection[];
  hasDrowsy: boolean;
  topDrowsyScore: number;
  inferMs: number;
  fps: number;
}

const MODEL_URL = "/models/drowsiness.tflite";
const AI_SIZE = 320;
const INFER_INTERVAL_MS = 350;

type TFLiteModel = {
  predict: (input: unknown) => unknown;
};

type TFLiteRuntimeGlobal = typeof globalThis & {
  tf?: typeof import("@tensorflow/tfjs");
  tflite?: {
    loadTFLiteModel: (modelUrl: string) => Promise<TFLiteModel>;
  };
};

export function useDrowsinessDetector(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): DetectorState & { start: () => Promise<void>; stop: () => void } {
  const [state, setState] = useState<DetectorState>({
    status: "idle",
    error: null,
    detections: [],
    hasDrowsy: false,
    topDrowsyScore: 0,
    inferMs: 0,
    fps: 0,
  });

  const predictRef = useRef<((input: Float32Array) => Promise<Float32Array | null>) | null>(null);
  const runningRef = useRef(false);
  const loopTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastInferAtRef = useRef(0);
  const inferCountRef = useRef(0);
  const inferWindowStartRef = useRef(0);
  const inferMsRef = useRef(0);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    setState((s) => ({ ...s, status: "requesting-camera", error: null }));

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error:
          "Camera access was denied or is unavailable. Allow camera access in your browser and try again.",
      }));
      return;
    }

    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      setState((s) => ({ ...s, status: "error", error: "Video element not ready." }));
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});

    setState((s) => ({ ...s, status: "loading-model" }));
    try {
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      const tfliteGlobal = globalThis as TFLiteRuntimeGlobal;
      tfliteGlobal.tf = tf;
      await import("@tensorflow/tfjs-tflite/dist/tf-tflite.es2017.js");
      const loadTFLiteModel = tfliteGlobal.tflite?.loadTFLiteModel;
      if (!loadTFLiteModel) throw new Error("TensorFlow Lite runtime did not initialize.");
      const model = await loadTFLiteModel(MODEL_URL);

      predictRef.current = async (input: Float32Array) => {
        const t = tf.tensor(input, [1, AI_SIZE, AI_SIZE, 3]);
        try {
          const out = model.predict(t as never) as { data: () => Promise<Float32Array> };
          const data = await out.data();
          return data as Float32Array;
        } finally {
          t.dispose();
        }
      };
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      setState((s) => ({
        ...s,
        status: "error",
        error: "Could not load the AI model. Check your connection and reload.",
      }));
      return;
    }

    canvasRef.current = document.createElement("canvas");
    canvasRef.current.width = AI_SIZE;
    canvasRef.current.height = AI_SIZE;
    runningRef.current = true;
    inferWindowStartRef.current = Date.now();
    setState((s) => ({ ...s, status: "ready", error: null }));

    loopTimerRef.current = window.setInterval(() => {
      void runInference();
    }, INFER_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);

  const runInference = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const predict = predictRef.current;
    if (!runningRef.current || !video || !canvas || !predict) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    const now = performance.now();
    if (now - lastInferAtRef.current < INFER_INTERVAL_MS - 40) return;
    lastInferAtRef.current = now;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    // Mirror horizontally so the AI sees the same upright, unmirrored view
    // the driver sees in the preview.
    ctx.save();
    ctx.setTransform(-1, 0, 0, 1, AI_SIZE, 0);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, AI_SIZE, AI_SIZE);
    ctx.restore();

    const t0 = performance.now();
    let raw: Float32Array | null = null;
    try {
      const imageData = ctx.getImageData(0, 0, AI_SIZE, AI_SIZE).data;
      const input = new Float32Array(AI_SIZE * AI_SIZE * 3);
      for (let i = 0, p = 0; i < imageData.length; i += 4, p += 3) {
        const y = (imageData[i] ?? 0) / 255;
        input[p] = y;
        input[p + 1] = y;
        input[p + 2] = y;
      }
      raw = await predict(input);
    } catch {
      return;
    }
    const elapsed = performance.now() - t0;
    inferMsRef.current = inferMsRef.current ? inferMsRef.current * 0.8 + elapsed * 0.2 : elapsed;

    if (!raw) return;
    const detections = decodeDetections(raw);
    const top = detections.reduce<Detection | null>(
      (acc, d) => (isDrowsyClass(d.className) && (!acc || d.score > acc.score) ? d : acc),
      null,
    );

    inferCountRef.current++;
    const windowStart = inferWindowStartRef.current;
    if (Date.now() - windowStart >= 2000) {
      inferWindowStartRef.current = Date.now();
    }

    setState((s) => ({
      ...s,
      detections,
      hasDrowsy: top !== null,
      topDrowsyScore: top?.score ?? 0,
      inferMs: inferMsRef.current,
      fps: inferCountRef.current,
    }));
  }, [videoRef]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (loopTimerRef.current !== null) {
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    predictRef.current = null;
    setState((s) => ({ ...s, status: "idle", detections: [], hasDrowsy: false, topDrowsyScore: 0 }));
  }, [videoRef]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (loopTimerRef.current !== null) {
        clearInterval(loopTimerRef.current);
        loopTimerRef.current = null;
      }
      const video = videoRef.current;
      if (video?.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      }
    };
  }, [videoRef]);

  return { ...state, start, stop };
}
