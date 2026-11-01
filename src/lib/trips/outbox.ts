// src/lib/trips/outbox.ts
//
// Offline-first queue for trip data. While the driver has no internet, every
// write (trip start, point, drowsy event, ping, trip end) is queued locally in
// localStorage and flushed to Lovable Cloud automatically when connectivity
// returns. Queue order is preserved; trip ids created offline are remapped to
// the real database ids on flush.
//
// Flushing happens on: enqueue, browser "online" event, and a periodic timer.

import { supabase } from "@/integrations/supabase/client";

export type OutboxKind = "trip-start" | "trip-end" | "ping" | "event";

export interface OutboxItem {
  id: string;
  queuedAt: number;
  kind: OutboxKind;
  /** local (possibly temporary) trip id */
  tripId: string;
  payload: Record<string, unknown>;
}

export interface OutboxState {
  online: boolean;
  pending: number;
  lastFlushError: string | null;
}

const KEY = "driverguard-outbox";
const MAX_ITEMS = 2000;

type Listener = (state: OutboxState) => void;

const listeners = new Set<Listener>();
let state: OutboxState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  pending: 0,
  lastFlushError: null,
};

function readQueue(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: OutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX_ITEMS)));
  } catch {
    // storage full — drop oldest half
    try {
      localStorage.setItem(KEY, JSON.stringify(items.slice(-Math.floor(MAX_ITEMS / 2))));
    } catch {
      /* ignore */
    }
  }
}

function update(patch: Partial<OutboxState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getOutboxState(): OutboxState {
  return state;
}

function refreshPending() {
  update({ pending: readQueue().length });
}

let installed = false;
export function installOutboxWatchers() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("online", () => {
    update({ online: true });
    void flushOutbox();
  });
  window.addEventListener("offline", () => update({ online: false }));
  refreshPending();
  setInterval(() => {
    if (navigator.onLine) void flushOutbox();
  }, 30_000);
}

export function enqueueOutbox(item: Omit<OutboxItem, "id" | "queuedAt">): OutboxItem {
  const full: OutboxItem = { ...item, id: crypto.randomUUID(), queuedAt: Date.now() };
  const queue = readQueue();
  queue.push(full);
  writeQueue(queue);
  refreshPending();
  void flushOutbox();
  return full;
}

export function clearOutbox() {
  writeQueue([]);
  refreshPending();
}

/**
 * Flush the queue in order. Returns the number of items successfully synced.
 * A failed item stops the flush to preserve ordering (it stays at the head).
 */
export async function flushOutbox(): Promise<number> {
  const queue = readQueue();
  if (queue.length === 0 || !navigator.onLine) return 0;

  const tripIdMap = new Map<string, string>();
  let synced = 0;
  let stopError: string | null = null;

  for (const item of queue) {
    const realTripId = tripIdMap.get(item.tripId) ?? item.tripId;
    try {
      if (item.kind === "trip-start") {
        const { data, error } = await supabase
          .from("trips")
          .insert(item.payload)
          .select("id")
          .single();
        if (error) throw error;
        tripIdMap.set(item.tripId, data.id);
        if (realTripId !== item.tripId) tripIdMap.set(realTripId, data.id);
      } else if (item.kind === "trip-end") {
        const { error } = await supabase
          .from("trips")
          .update(item.payload)
          .eq("id", realTripId);
        if (error) throw error;
      } else if (item.kind === "ping") {
        const { error } = await supabase
          .from("trips")
          .update(item.payload)
          .eq("id", realTripId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("trip_events").insert({
          ...item.payload,
          trip_id: realTripId,
        });
        if (error) throw error;
      }
      synced++;
    } catch (err) {
      stopError = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  if (synced > 0) {
    writeQueue(queue.slice(synced));
    refreshPending();
  }
  update({ lastFlushError: synced > 0 && !stopError ? null : stopError });
  if (synced === 0 && stopError) update({ lastFlushError: stopError });
  return synced;
}
