// src/lib/trips/useTripTracker.ts
//
// Live trip tracking: GPS speed, live location, trip records, speeding
// detection, and live status pings for the admin dashboard. Every write goes
// through the outbox, so trips and logs keep recording offline and sync
// automatically when the connection returns.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  enqueueOutbox,
  getOutboxState,
  installOutboxWatchers,
  subscribeOutbox,
} from "./outbox";

export interface ActiveTrip {
  /** local id; equals the database id once the trip row synced */
  id: string;
  startedAt: number;
  distanceKm: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  drowsyEvents: number;
  criticalEvents: number;
  speedingEvents: number;
  currentState: "alert" | "drowsy" | "critical";
}

export interface GpsPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export type GpsStatus = "off" | "acquiring" | "ok" | "error";

const PING_INTERVAL_MS = 10_000;
const POINT_EVENT_INTERVAL_MS = 15_000;
const SPEEDING_REPEAT_MS = 60_000;
const SPEED_MIN_KMH = 10;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function kmh(ms: number | null | undefined): number | null {
  if (ms == null || !isFinite(ms) || ms < 0) return null;
  return ms * 3.6;
}

export function useTripTracker(driverId: string | null, speedLimitKmh: number) {
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [speedKmh, setSpeedKmh] = useState<number>(0);
  const [position, setPosition] = useState<GpsPosition | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("off");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState(getOutboxState());

  const tripRef = useRef<ActiveTrip | null>(null);
  const posRef = useRef<GpsPosition | null>(null);
  const speedRef = useRef(0);
  const prevPosRef = useRef<GpsPosition | null>(null);
  const prevPosTimeRef = useRef<number | null>(null);
  const lastPointRef = useRef(0);
  const lastSpeedingRef = useRef(0);
  const watchIdRef = useRef<number | null>(null);
  const limitRef = useRef(speedLimitKmh);
  limitRef.current = speedLimitKmh;

  const setTrip = (t: ActiveTrip | null) => {
    tripRef.current = t;
    setActiveTrip(t ? { ...t } : null);
  };

  useEffect(() => {
    installOutboxWatchers();
    return subscribeOutbox(setOutbox);
  }, []);

  // Resolve the real database trip id once an offline-created trip syncs.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ localId: string; realId: string }>).detail;
      const t = tripRef.current;
      if (t && t.id === detail.localId) {
        setTrip({ ...t, id: detail.realId });
      }
    };
    window.addEventListener("driverguard:trip-id-resolved", handler);
    return () => window.removeEventListener("driverguard:trip-id-resolved", handler);
  }, []);

  const pushPing = useCallback(() => {
    const t = tripRef.current;
    const p = posRef.current;
    if (!t || !p) return;
    const payload = {
      current_lat: p.lat,
      current_lng: p.lng,
      current_speed_kmh: Math.round(speedRef.current * 10) / 10,
      current_state: t.currentState,
      last_ping_at: new Date().toISOString(),
      distance_km: Math.round(t.distanceKm * 1000) / 1000,
      max_speed_kmh: Math.round(t.maxSpeedKmh * 10) / 10,
      avg_speed_kmh: Math.round(t.avgSpeedKmh * 10) / 10,
      drowsy_events: t.drowsyEvents,
      critical_events: t.criticalEvents,
      speeding_events: t.speedingEvents,
      ended_at: null,
    };
    enqueueOutbox({ kind: "ping", tripId: t.id, payload });
  }, []);

  const pushPoint = useCallback(() => {
    const t = tripRef.current;
    const p = posRef.current;
    if (!t || !p) return;
    enqueueOutbox({
      kind: "event",
      tripId: t.id,
      payload: {
        driver_id: driverId,
        type: "point",
        lat: p.lat,
        lng: p.lng,
        speed_kmh: Math.round(speedRef.current * 10) / 10,
        occurred_at: new Date().toISOString(),
      },
    });
  }, [driverId]);

  const startTrip = useCallback(() => {
    if (!driverId || tripRef.current) return;
    const localId = crypto.randomUUID();
    const now = new Date().toISOString();
    enqueueOutbox({
      kind: "trip-start",
      tripId: localId,
      payload: { driver_id: driverId, started_at: now, current_state: "alert" },
    });
    setTrip({
      id: localId,
      startedAt: Date.now(),
      distanceKm: 0,
      maxSpeedKmh: 0,
      avgSpeedKmh: 0,
      drowsyEvents: 0,
      criticalEvents: 0,
      speedingEvents: 0,
      currentState: "alert",
    });

    if (watchIdRef.current === null) {
      setGpsStatus("acquiring");
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const p: GpsPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          };
          const t = kmh(pos.coords.speed);
          let speed = t ?? 0;
          const prev = prevPosRef.current;
          const prevTime = prevPosTimeRef.current;
          if (t == null && prev && prevTime) {
            const dtH = (Date.now() - prevTime) / 3_600_000;
            const dKm = haversineKm(prev.lat, prev.lng, p.lat, p.lng);
            if (dtH > 0) speed = dKm / dtH;
          }
          prevPosRef.current = p;
          prevPosTimeRef.current = Date.now();
          posRef.current = p;
          speedRef.current = Math.min(speed, 250);
          setPosition(p);
          setSpeedKmh(speedRef.current);
          setGpsStatus("ok");
          setGpsError(null);

          const trip = tripRef.current;
          if (trip) {
            if (prev) {
              const dKm = haversineKm(prev.lat, prev.lng, p.lat, p.lng);
              // ignore GPS jitter
              if (dKm < 0.5) trip.distanceKm += dKm;
            }
            trip.maxSpeedKmh = Math.max(trip.maxSpeedKmh, speedRef.current);
            const hours = (Date.now() - trip.startedAt) / 3_600_000;
            trip.avgSpeedKmh = hours > 1 / 60 ? trip.distanceKm / hours : 0;

            if (
              speedRef.current > limitRef.current &&
              speedRef.current > SPEED_MIN_KMH &&
              Date.now() - lastSpeedingRef.current > SPEEDING_REPEAT_MS
            ) {
              lastSpeedingRef.current = Date.now();
              trip.speedingEvents += 1;
              enqueueOutbox({
                kind: "event",
                tripId: trip.id,
                payload: {
                  driver_id: driverId,
                  type: "speeding",
                  lat: p.lat,
                  lng: p.lng,
                  speed_kmh: Math.round(speedRef.current),
                  value: limitRef.current,
                  detail: `Speed ${Math.round(speedRef.current)} km/h over the ${limitRef.current} km/h limit`,
                  occurred_at: new Date().toISOString(),
                },
              });
            }

            if (Date.now() - lastPointRef.current > POINT_EVENT_INTERVAL_MS) {
              lastPointRef.current = Date.now();
              pushPoint();
            }
          }
        },
        (err) => {
          setGpsStatus("error");
          setGpsError(
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied — enable it to track trips."
              : "Location unavailable — GPS signal not found.",
          );
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    }
  }, [driverId, pushPoint]);

  const endTrip = useCallback(() => {
    const t = tripRef.current;
    if (!t) return;
    const elapsedH = (Date.now() - t.startedAt) / 3_600_000;
    const avg = elapsedH > 1 / 60 ? t.distanceKm / elapsedH : 0;
    const p = posRef.current;
    enqueueOutbox({
      kind: "trip-end",
      tripId: t.id,
      payload: {
        ended_at: new Date().toISOString(),
        distance_km: Math.round(t.distanceKm * 1000) / 1000,
        max_speed_kmh: Math.round(t.maxSpeedKmh * 10) / 10,
        avg_speed_kmh: Math.round(avg * 10) / 10,
        drowsy_events: t.drowsyEvents,
        critical_events: t.criticalEvents,
        speeding_events: t.speedingEvents,
        current_state: "alert",
      },
    });
    if (p) {
      enqueueOutbox({
        kind: "event",
        tripId: t.id,
        payload: {
          driver_id: driverId,
          type: "trip_ended",
          lat: p.lat,
          lng: p.lng,
          occurred_at: new Date().toISOString(),
        },
      });
    }
    setTrip(null);
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setGpsStatus("off");
  }, [driverId]);

  // Periodic live-status ping while a trip is active.
  useEffect(() => {
    if (!activeTrip) return;
    const timer = setInterval(pushPing, PING_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeTrip?.id, pushPing]);

  const logDrowsiness = useCallback(
    (level: "drowsy" | "critical", detail: string) => {
      const t = tripRef.current;
      const p = posRef.current;
      if (!t) return;
      if (level === "drowsy") t.drowsyEvents += 1;
      else t.criticalEvents += 1;
      enqueueOutbox({
        kind: "event",
        tripId: t.id,
        payload: {
          driver_id: driverId,
          type: level,
          lat: p?.lat ?? null,
          lng: p?.lng ?? null,
          speed_kmh: Math.round(speedRef.current),
          detail,
          occurred_at: new Date().toISOString(),
        },
      });
    },
    [driverId],
  );

  const logWeatherAlert = useCallback(
    (title: string, message: string) => {
      const t = tripRef.current;
      const p = posRef.current;
      if (!t) return;
      enqueueOutbox({
        kind: "event",
        tripId: t.id,
        payload: {
          driver_id: driverId,
          type: "weather",
          lat: p?.lat ?? null,
          lng: p?.lng ?? null,
          detail: `${title}: ${message}`,
          occurred_at: new Date().toISOString(),
        },
      });
    },
    [driverId],
  );

  const setCurrentState = useCallback((s: "alert" | "drowsy" | "critical") => {
    const t = tripRef.current;
    if (t) {
      t.currentState = s;
      setActiveTrip({ ...t });
    }
  }, []);

  useEffect(
    () => () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    },
    [],
  );

  return {
    activeTrip,
    speedKmh,
    position,
    gpsStatus,
    gpsError,
    outbox,
    startTrip,
    endTrip,
    logDrowsiness,
    logWeatherAlert,
    setCurrentState,
  };
}
