import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LiveMap, type MapPoint } from "@/components/LiveMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/trips/$tripId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Trip detail — Drowsy Guard" },
      { name: "description", content: "Trip record with route, speeds and safety events." },
      { property: "og:title", content: "Trip detail — Drowsy Guard" },
      { property: "og:description", content: "Trip record with route, speeds and safety events." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TripDetail,
});

interface TripDetail {
  id: string;
  started_at: string;
  ended_at: string | null;
  distance_km: number;
  max_speed_kmh: number;
  avg_speed_kmh: number;
  drowsy_events: number;
  critical_events: number;
  speeding_events: number;
}

interface EventRow {
  id: string;
  type: string;
  detail: string | null;
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  occurred_at: string;
}

function TripDetail() {
  const { tripId } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["trip", tripId],
    queryFn: async () => {
      const [{ data: trip, error: e1 }, { data: events, error: e2 }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
        supabase.from("trip_events").select("*").eq("trip_id", tripId).order("occurred_at", { ascending: true }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { trip: trip as TripDetail | null, events: (events ?? []) as EventRow[] };
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  if (error || !data?.trip) {
    return (
      <div className="panel p-10 text-center">
        <p className="font-display text-lg font-semibold">Trip not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error ? (error as Error).message : "This trip hasn't synced to the cloud yet (it may still be buffered offline)."}
        </p>
        <Button className="mt-5" variant="outline" asChild>
          <Link to="/trips">Back to my trips</Link>
        </Button>
      </div>
    );
  }

  const t = data.trip;
  const points: MapPoint[] = data.events
    .filter((e) => e.type === "point" && e.lat != null && e.lng != null)
    .map((e) => ({ id: e.id, lat: e.lat!, lng: e.lng!, color: "var(--primary)" }));
  const alertPoints: MapPoint[] = data.events
    .filter((e) => e.type !== "point" && e.lat != null && e.lng != null)
    .map((e) => ({
      id: e.id,
      lat: e.lat!,
      lng: e.lng!,
      color: e.type === "critical" || e.type === "speeding" ? "#ff4d5e" : "#ffc24d",
      popupHtml: `<strong>${e.type}</strong><br/>${e.detail ?? ""}<br/><small>${new Date(e.occurred_at).toLocaleString()}</small>`,
    }));

  const eventTypeLabel: Record<string, string> = {
    drowsy: "Drowsy warning",
    critical: "Alarm",
    speeding: "Speeding",
    weather: "Weather alert",
    trip_ended: "Trip ended",
  };

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function duration() {
    const ms = (t.ended_at ? new Date(t.ended_at).getTime() : Date.now()) - new Date(t.started_at).getTime();
    const m = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold">Trip record</h1>
            {!t.ended_at && <Badge className="bg-primary text-primary-foreground">Ongoing</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {fmt(t.started_at)} → {t.ended_at ? fmt(t.ended_at) : "now"} · {duration()}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/trips">Back to my trips</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Distance" value={`${t.distance_km.toFixed(1)} km`} />
        <Stat label="Max speed" value={`${Math.round(t.max_speed_kmh)} km/h`} />
        <Stat label="Avg speed" value={`${Math.round(t.avg_speed_kmh)} km/h`} />
        <Stat label="Drowsy" value={String(t.drowsy_events)} danger={t.drowsy_events > 0} />
        <Stat label="Alarms" value={String(t.critical_events)} danger={t.critical_events > 0} />
        <Stat label="Speeding" value={String(t.speeding_events)} danger={t.speeding_events > 0} />
      </div>

      <div className="panel p-4">
        <span className="label-caps">Route & event locations</span>
        <div className="mt-3">
          {points.length + alertPoints.length > 0 ? (
            <LiveMap points={[...alertPoints, points.at(-1)!].filter(Boolean)} path={points} height={420} />
          ) : (
            <div className="flex h-[320px] items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">
              No GPS points recorded for this trip yet.
            </div>
          )}
        </div>
      </div>

      <div className="panel p-4">
        <span className="label-caps">Safety events ({data.events.filter((e) => e.type !== "point").length})</span>
        {data.events.filter((e) => e.type !== "point").length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Clean trip — no drowsiness, speeding or weather events.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {data.events
              .filter((e) => e.type !== "point")
              .map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={e.type === "critical" || e.type === "speeding" ? "destructive" : e.type === "drowsy" || e.type === "weather" ? "secondary" : "outline"}
                    >
                      {eventTypeLabel[e.type] ?? e.type}
                    </Badge>
                    <span className="text-muted-foreground">{e.detail ?? ""}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {e.speed_kmh != null && <span className="readout">{Math.round(e.speed_kmh)} km/h</span>}
                    <span>{new Date(e.occurred_at).toLocaleTimeString()}</span>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`readout text-lg font-semibold ${danger ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}
