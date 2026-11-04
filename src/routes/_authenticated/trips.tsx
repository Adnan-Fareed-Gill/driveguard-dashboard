import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/trips")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "My Trips — DriverGuard" },
      { name: "description", content: "Your recorded trips: distance, speeds, drowsiness and speeding events." },
      { property: "og:title", content: "My Trips — DriverGuard" },
      { property: "og:description", content: "Your recorded trips: distance, speeds and events." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TripsPage,
});

interface TripRow {
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

function TripsPage() {
  const session = useSession();

  const { data, isLoading, error } = useQuery({
    queryKey: ["my-trips", session.user?.id],
    enabled: !!session.user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(
          "id, started_at, ended_at, distance_km, max_speed_kmh, avg_speed_kmh, drowsy_events, critical_events, speeding_events",
        )
        .order("started_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as TripRow[];
    },
  });

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function fmtDuration(start: string, end: string | null) {
    const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
    const m = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">My trips</h1>
        <p className="text-sm text-muted-foreground">Every recorded drive with its speeds and safety events.</p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">Could not load trips: {(error as Error).message}</p>}

      {data && data.length === 0 && (
        <div className="panel p-10 text-center">
          <p className="font-display text-lg font-semibold">No trips yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Start your first monitored trip from the live monitor.</p>
          <Button className="mt-5" asChild>
            <Link to="/monitor">Open live monitor</Link>
          </Button>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((t) => {
            const ongoing = !t.ended_at;
            const risky = t.drowsy_events + t.critical_events > 0;
            return (
              <Link
                key={t.id}
                to="/trips/$tripId"
                params={{ tripId: t.id }}
                className="panel flex flex-wrap items-center justify-between gap-4 p-4 transition-colors hover:border-primary/40"
              >
                <div className="min-w-[180px]">
                  <div className="font-medium">{fmtDate(t.started_at)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{fmtDuration(t.started_at, t.ended_at)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-6 text-sm">
                  <Metric label="Distance" value={`${t.distance_km.toFixed(1)} km`} />
                  <Metric label="Max" value={`${Math.round(t.max_speed_kmh)} km/h`} />
                  <Metric label="Avg" value={`${Math.round(t.avg_speed_kmh)} km/h`} />
                  <div className="flex items-center gap-2">
                    {t.drowsy_events + t.critical_events > 0 && (
                      <Badge variant="destructive">{t.drowsy_events + t.critical_events} drowsy</Badge>
                    )}
                    {t.speeding_events > 0 && <Badge className="bg-warning text-warning-foreground">{t.speeding_events} speeding</Badge>}
                    {ongoing && <Badge className="bg-primary text-primary-foreground"><span className="pulse-dot mr-1.5" aria-hidden />Ongoing</Badge>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="readout font-semibold">{value}</div>
    </div>
  );
}
