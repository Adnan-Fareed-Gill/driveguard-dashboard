// src/server/admin.ts
//
// Privileged admin reads. Every function verifies the caller's admin role
// through the database before returning any cross-driver data.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

interface AuthedContext {
  supabase: SupabaseClient<Database>;
  userId: string;
}

export interface AdminLiveDriver {
  tripId: string;
  driverId: string;
  fullName: string | null;
  vehicle: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  state: string;
  lastPingAt: string | null;
  startedAt: string;
  drowsyEvents: number;
  criticalEvents: number;
  speedingEvents: number;
  distanceKm: number;
}

export interface AdminRecentTrip {
  id: string;
  driverName: string | null;
  vehicle: string | null;
  startedAt: string;
  endedAt: string | null;
  distanceKm: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  drowsyEvents: number;
  criticalEvents: number;
  speedingEvents: number;
}

export interface AdminRecentAlert {
  id: string;
  type: string;
  detail: string | null;
  occurredAt: string;
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  driverName: string | null;
  vehicle: string | null;
}

export interface AdminOverview {
  liveDrivers: AdminLiveDriver[];
  recentTrips: AdminRecentTrip[];
  recentAlerts: AdminRecentAlert[];
  stats: {
    drivers: number;
    activeNow: number;
    tripsToday: number;
    drowsyToday: number;
    criticalToday: number;
  };
}

async function requireAdmin(context: AuthedContext) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !isAdmin) throw new Error("Forbidden — admin access required");
}

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminOverview> => {
    const ctx = context as AuthedContext;
    await requireAdmin(ctx);
    const supabase = ctx.supabase;

    const since = new Date(Date.now() - 3 * 60_000).toISOString(); // pinged within 3 minutes = live
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [activeRes, tripsRes, alertsRes, driversRes, tripsTodayRes, drowsyTodayRes] = await Promise.all([
      supabase
        .from("trips")
        .select(
          "id, driver_id, started_at, current_lat, current_lng, current_speed_kmh, current_state, last_ping_at, drowsy_events, critical_events, speeding_events, distance_km, profiles(full_name, vehicle, phone)",
        )
        .is("ended_at", null)
        .gte("last_ping_at", since)
        .order("last_ping_at", { ascending: false }),
      supabase
        .from("trips")
        .select(
          "id, started_at, ended_at, distance_km, max_speed_kmh, avg_speed_kmh, drowsy_events, critical_events, speeding_events, profiles(full_name, vehicle)",
        )
        .order("started_at", { ascending: false })
        .limit(30),
      supabase
        .from("trip_events")
        .select("id, type, detail, occurred_at, lat, lng, speed_kmh, driver_id, profiles(full_name, vehicle)")
        .in("type", ["drowsy", "critical", "speeding", "weather", "trip_started", "trip_ended"])
        .order("occurred_at", { ascending: false })
        .limit(40),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase
        .from("trips")
        .select("id", { count: "exact", head: true })
        .gte("started_at", startOfDay.toISOString()),
      supabase
        .from("trip_events")
        .select("type", { count: "exact", head: true })
        .in("type", ["drowsy", "critical"])
        .gte("occurred_at", startOfDay.toISOString()),
    ]);

    const profileOf = (row: { profiles: unknown }): { full_name: string | null; vehicle: string | null; phone: string | null } => {
      const p = Array.isArray(row.profiles) ? row.profiles[0] : (row.profiles as Record<string, string> | null);
      return {
        full_name: p?.full_name ?? null,
        vehicle: p?.vehicle ?? null,
        phone: p?.phone ?? null,
      };
    };

    const liveDrivers: AdminLiveDriver[] = (activeRes.data ?? []).map((row: any) => {
      const p = profileOf(row);
      return {
        tripId: row.id,
        driverId: row.driver_id,
        fullName: p.full_name,
        vehicle: p.vehicle,
        phone: p.phone,
        lat: row.current_lat,
        lng: row.current_lng,
        speedKmh: row.current_speed_kmh,
        state: row.current_state,
        lastPingAt: row.last_ping_at,
        startedAt: row.started_at,
        drowsyEvents: row.drowsy_events,
        criticalEvents: row.critical_events,
        speedingEvents: row.speeding_events,
        distanceKm: row.distance_km,
      };
    });

    const recentTrips: AdminRecentTrip[] = (tripsRes.data ?? []).map((row: any) => {
      const p = profileOf(row);
      return {
        id: row.id,
        driverName: p.full_name,
        vehicle: p.vehicle,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        distanceKm: row.distance_km,
        maxSpeedKmh: row.max_speed_kmh,
        avgSpeedKmh: row.avg_speed_kmh,
        drowsyEvents: row.drowsy_events,
        criticalEvents: row.critical_events,
        speedingEvents: row.speeding_events,
      };
    });

    const recentAlerts: AdminRecentAlert[] = (alertsRes.data ?? []).map((row: any) => {
      const p = profileOf(row);
      return {
        id: row.id,
        type: row.type,
        detail: row.detail,
        occurredAt: row.occurred_at,
        lat: row.lat,
        lng: row.lng,
        speedKmh: row.speed_kmh,
        driverName: p.full_name,
        vehicle: p.vehicle,
      };
    });

    const drowsyCount = drowsyTodayRes.count ?? 0;

    return {
      liveDrivers,
      recentTrips,
      recentAlerts,
      stats: {
        drivers: driversRes.count ?? 0,
        activeNow: liveDrivers.length,
        tripsToday: tripsTodayRes.count ?? 0,
        drowsyToday: drowsyCount,
        criticalToday: liveDrivers.reduce((n, d) => n + d.criticalEvents, 0),
      },
    };
  });

export const getAdminDriverDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { driverId: string }) => input)
  .handler(async ({ data, context }) => {
    const ctx = context as AuthedContext;
    await requireAdmin(ctx);
    const supabase = ctx.supabase;

    const [{ data: profile }, { data: trips }, { data: events }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", data.driverId).maybeSingle(),
      supabase.from("trips").select("*").eq("driver_id", data.driverId).order("started_at", { ascending: false }).limit(20),
      supabase
        .from("trip_events")
        .select("id, trip_id, type, detail, occurred_at, lat, lng, speed_kmh")
        .eq("driver_id", data.driverId)
        .in("type", ["drowsy", "critical", "speeding", "weather"])
        .order("occurred_at", { ascending: false })
        .limit(60),
    ]);

    return { profile, trips: trips ?? [], events: events ?? [] };
  });
