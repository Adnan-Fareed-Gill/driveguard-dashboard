import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getAdminOverview, type AdminOverview } from "@/lib/admin.functions";
import { LiveMap, type MapPoint } from "@/components/LiveMap";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin Dashboard — Drowsy Guard" },
      { name: "description", content: "Live drivers, trips, alerts and fleet safety statistics." },
      { property: "og:title", content: "Admin Dashboard — Drowsy Guard" },
      { property: "og:description", content: "Live drivers, trips, alerts and fleet safety statistics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, dataUpdatedAt } = useQuery<AdminOverview>({
    queryKey: ["admin-overview"],
    queryFn: () => getAdminOverview(),
    refetchInterval: 15_000,
  });

  // surface fresh critical alarms from other drivers
  useEffect(() => {
    if (!data) return;
    for (const a of data.recentAlerts) {
      if (a.type !== "critical") continue;
      const key = `alert-seen-${a.id}`;
      if (sessionStorage.getItem(key)) continue;
      if (Date.now() - new Date(a.occurredAt).getTime() > 120_000) continue;
      sessionStorage.setItem(key, "1");
      toast.error(`Critical alarm — ${a.driverName ?? "a driver"}`, { description: a.detail ?? undefined });
    }
  }, [data]);

  const livePoints: MapPoint[] = (data?.liveDrivers ?? [])
    .filter((d) => d.lat != null && d.lng != null)
    .map((d) => ({
      id: d.tripId,
      lat: d.lat!,
      lng: d.lng!,
      color:
        d.state === "critical"
          ? "#ff4d5e"
          : d.state === "drowsy"
            ? "#ffc24d"
            : "#27e08a",
      popupHtml: `<strong>${d.fullName ?? "Driver"}</strong><br/>${d.vehicle ?? ""}<br/>${d.speedKmh != null ? `${Math.round(d.speedKmh)} km/h · ` : ""}${d.state}<br/><small>ping ${d.lastPingAt ? new Date(d.lastPingAt).toLocaleTimeString() : "—"}</small>`,
    }));

  const alertPoints: MapPoint[] = (data?.recentAlerts ?? [])
    .filter((a) => a.lat != null && a.lng != null && Date.now() - new Date(a.occurredAt).getTime() < 3600_000)
    .slice(0, 12)
    .map((a) => ({
      id: a.id,
      lat: a.lat!,
      lng: a.lng!,
      color: a.type === "critical" || a.type === "speeding" ? "#ff4d5e" : "#ffc24d",
      popupHtml: `<strong>${a.type}</strong><br/>${a.driverName ?? ""}<br/><small>${new Date(a.occurredAt).toLocaleString()}</small>`,
    }));

  if (error) {
    return (
      <div className="panel p-10 text-center">
        <p className="font-display text-lg font-semibold">Could not load the dashboard</p>
        <p className="mt-1 text-sm text-destructive">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Admin dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live fleet view — auto-refreshes every 15 seconds
            {dataUpdatedAt ? ` (updated ${new Date(dataUpdatedAt).toLocaleTimeString()})` : ""}.
          </p>
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ["admin-overview"] })}
        >
          Refresh now
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Registered drivers" value={data?.stats.drivers} />
        <StatCard label="On the road now" value={data?.stats.activeNow} highlight={!!data?.stats.activeNow} />
        <StatCard label="Trips today" value={data?.stats.tripsToday} />
        <StatCard label="Drowsy events today" value={data?.stats.drowsyToday} danger={!!data?.stats.drowsyToday} />
        <StatCard label="Active alarms in trips" value={data?.stats.criticalToday} danger={!!data?.stats.criticalToday} />
      </div>

      {/* Live map */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="label-caps">Live driver map</span>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Legend color="#27e08a" label="Alert" />
            <Legend color="#ffc24d" label="Drowsy" />
            <Legend color="#ff4d5e" label="Alarm" />
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-[420px] w-full rounded-xl" />
        ) : livePoints.length + alertPoints.length > 0 ? (
          <LiveMap points={[...livePoints, ...alertPoints]} height={420} zoom={6} />
        ) : (
          <div className="flex h-[320px] items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">
            No drivers are on an active trip right now.
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* Live drivers */}
        <div className="panel p-4">
          <span className="label-caps">Drivers on active trips ({data?.liveDrivers.length ?? 0})</span>
          {isLoading ? (
            <Skeleton className="mt-3 h-24 w-full" />
          ) : (data?.liveDrivers.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nobody is driving at the moment.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {data!.liveDrivers.map((d) => (
                <li key={d.tripId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="font-medium">{d.fullName ?? "Unnamed driver"}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.vehicle ?? "—"} · {d.phone ?? "no phone"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="readout text-lg font-semibold">{d.speedKmh != null ? Math.round(d.speedKmh) : "—"}<span className="ml-1 text-xs font-normal text-muted-foreground">km/h</span></span>
                    <Badge
                      variant={d.state === "critical" ? "destructive" : d.state === "drowsy" ? "secondary" : "default"}
                      className={d.state === "drowsy" ? "bg-warning text-warning-foreground" : d.state === "alert" ? "bg-primary text-primary-foreground" : ""}
                    >
                      {d.state === "alert" ? "Alert" : d.state === "drowsy" ? "Drowsy" : "ALARM"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {d.lastPingAt ? `ping ${new Date(d.lastPingAt).toLocaleTimeString()}` : "no ping"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Alerts feed */}
        <div className="panel p-4">
          <span className="label-caps">Recent safety alerts</span>
          {(data?.recentAlerts.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No alerts recorded yet.</p>
          ) : (
            <ul className="mt-3 max-h-[420px] divide-y divide-border overflow-y-auto">
              {data!.recentAlerts.map((a) => (
                <li key={a.id} className="py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge
                        variant={a.type === "critical" || a.type === "speeding" ? "destructive" : "secondary"}
                        className={a.type === "drowsy" || a.type === "weather" ? "bg-warning text-warning-foreground" : ""}
                      >
                        {a.type}
                      </Badge>
                      <span className="truncate font-medium">{a.driverName ?? "Driver"}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(a.occurredAt).toLocaleString()}</span>
                  </div>
                  {a.detail && <p className="mt-1 text-xs text-muted-foreground">{a.detail}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent trips */}
      <div className="panel p-4">
        <span className="label-caps">Recent trips (all drivers)</span>
        {(data?.recentTrips.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No trips recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Driver</th>
                  <th className="pb-2 pr-4 font-medium">Started</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 pr-4 font-medium">Distance</th>
                  <th className="pb-2 pr-4 font-medium">Max / Avg</th>
                  <th className="pb-2 font-medium">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data!.recentTrips.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 pr-4">
                      <div className="font-medium">{t.driverName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{t.vehicle ?? ""}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                      {new Date(t.startedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="py-2.5 pr-4">
                      {t.endedAt ? (
                        (() => {
                          const m = Math.max(0, Math.floor((new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime()) / 60000));
                          return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
                        })()
                      ) : (
                        <Badge className="bg-primary text-primary-foreground">Ongoing</Badge>
                      )}
                    </td>
                    <td className="readout py-2.5 pr-4">{t.distanceKm.toFixed(1)} km</td>
                    <td className="readout py-2.5 pr-4">
                      {Math.round(t.maxSpeedKmh)} / {Math.round(t.avgSpeedKmh)} km/h
                    </td>
                    <td className="py-2.5">
                      <div className="flex gap-1.5">
                        {t.drowsyEvents + t.criticalEvents > 0 && (
                          <Badge variant="destructive">{t.drowsyEvents + t.criticalEvents} drowsy</Badge>
                        )}
                        {t.speedingEvents > 0 && (
                          <Badge className="bg-warning text-warning-foreground">{t.speedingEvents} speeding</Badge>
                        )}
                        {t.drowsyEvents + t.criticalEvents + t.speedingEvents === 0 && (
                          <span className="text-xs text-muted-foreground">clean</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, danger, highlight }: { label: string; value: number | undefined; danger?: boolean; highlight?: boolean }) {
  return (
    <div className="panel p-4">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={`readout mt-1 text-2xl font-bold ${
          danger ? "text-destructive" : highlight ? "text-primary" : ""
        }`}
      >
        {value ?? <Skeleton className="h-7 w-10" />}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
