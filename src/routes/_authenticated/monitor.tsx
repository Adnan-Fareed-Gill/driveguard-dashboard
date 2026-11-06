import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LiveMap } from "@/components/LiveMap";
import { useSession } from "@/hooks/useSession";
import { useTripTracker } from "@/lib/trips/useTripTracker";
import { useDrowsinessDetector } from "@/lib/drowsiness/useDetector";
import { DrowsinessScorer, type DrowsinessState } from "@/lib/drowsiness/scorer";
import { isDrowsyClass, CLASS_NAMES, type Detection } from "@/lib/drowsiness/decoder";
import { fetchWeather, weatherAlerts, describeWeatherCode, reverseGeocode, type WeatherNow, type WeatherAlert } from "@/lib/weather";

export const Route = createFileRoute("/_authenticated/monitor")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Live Monitor — Drowsy Guard" },
      { name: "description", content: "Live drowsiness detection, speed, location and weather for your trip." },
      { property: "og:title", content: "Live Monitor — Drowsy Guard" },
      { property: "og:description", content: "Live drowsiness detection, speed, location and weather." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MonitorPage,
});

const CONF_CLASSES = CLASS_NAMES;

function MonitorPage() {
  const session = useSession();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detector = useDrowsinessDetector(videoRef, true);
  const tracker = useTripTracker(session.profile?.id ?? null, session.profile?.speed_limit_kmh ?? 80);
  const scorerRef = useRef(new DrowsinessScorer());
  const [aiState, setAiState] = useState<DrowsinessState>("alert");
  const alarmRef = useRef<HTMLAudioElement | null>(null);
  const alertedRef = useRef<Set<string>>(new Set());
  const lastWeatherPosRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [weatherAlertList, setWeatherAlertList] = useState<WeatherAlert[]>([]);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // clock tick for duration readout
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const audio = new Audio("/sounds/alarm.mp3");
    audio.loop = true;
    alarmRef.current = audio;
    return () => {
      audio.pause();
      alarmRef.current = null;
    };
  }, []);

  // feed detector output through the rolling scorer (same thresholds as the
  // mobile app: drowsy ≥1s, critical ≥3s, safe reset ≥1.5s)
  useEffect(() => {
    if (detector.status !== "ready") return;
    const prev = scorerRef.current.getState();
    const next = scorerRef.current.addFrame(detector.hasDrowsy);
    if (next === prev) return;

    setAiState(next);
    tracker.setCurrentState(next);

    if (next === "drowsy") {
      tracker.logDrowsiness("drowsy", "Drowsy signs detected for over 1 second");
      toast.warning("Drowsy signs detected — stay focused.");
      navigator.vibrate?.([200, 100, 200]);
    } else if (next === "critical") {
      tracker.logDrowsiness("critical", "Critical drowsiness — alarm triggered");
      toast.error("ALARM — pull over and rest!");
      navigator.vibrate?.([400, 150, 400, 150, 400]);
    } else if (next === "alert") {
      alertedRef.current = new Set();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detector.hasDrowsy, detector.status]);

  // alarm audio follows the scorer state
  useEffect(() => {
    const audio = alarmRef.current;
    if (!audio) return;
    if (aiState === "critical") {
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [aiState]);

  // live weather whenever we have a fresh-enough / far-enough position
  const updateWeather = useCallback(async () => {
    const pos = tracker.position;
    if (!pos) return;
    const last = lastWeatherPosRef.current;
    const movedFar = !last || Math.abs(pos.lat - last.lat) + Math.abs(pos.lng - last.lng) > 0.05;
    const stale = !last || Date.now() - last.at > 5 * 60_000;
    if (!movedFar && !stale) return;
    lastWeatherPosRef.current = { lat: pos.lat, lng: pos.lng, at: Date.now() };
    try {
      const [w, label] = await Promise.all([fetchWeather(pos.lat, pos.lng), reverseGeocode(pos.lat, pos.lng)]);
      setWeather(w);
      const alerts = weatherAlerts(w);
      setWeatherAlertList(alerts);
      if (label) setPlaceLabel(label);
      for (const a of alerts) {
        if (tracker.activeTrip && !alertedRef.current.has(a.title)) {
          alertedRef.current.add(a.title);
          tracker.logWeatherAlert(a.title, a.message);
          if (a.level === "danger") toast.error(`Weather: ${a.title}`);
        }
      }
    } catch {
      // weather is best-effort; never disturb the monitoring session
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracker.position, tracker.activeTrip?.id]);

  useEffect(() => {
    void updateWeather();
    const t = setInterval(() => void updateWeather(), 60_000);
    return () => clearInterval(t);
  }, [updateWeather]);

  const trip = tracker.activeTrip;
  const durationSec = trip ? Math.floor((now - trip.startedAt) / 1000) : 0;
  const durationLabel = useMemo(() => {
    const h = Math.floor(durationSec / 3600);
    const m = Math.floor((durationSec % 3600) / 60);
    const s = durationSec % 60;
    return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [durationSec]);

  const handOff = detector.detections.some((d) => d.className === "Hand Off Steering Wheel" && d.score > 0.5);

  // FR-7: steering-wheel hand activity — warn (throttled) when the driver's
  // hands leave the wheel, even while otherwise alert.
  const handOffWarnedAt = useRef(0);
  useEffect(() => {
    if (handOff && Date.now() - handOffWarnedAt.current > 10_000) {
      handOffWarnedAt.current = Date.now();
      toast.warning("Hands off steering wheel detected!");
      navigator.vibrate?.([150, 80, 150]);
    }
  }, [handOff]);

  const banner =
    aiState === "critical"
      ? { label: "ALARM!", cls: "bg-destructive text-destructive-foreground alarm-flash" }
      : aiState === "drowsy"
        ? { label: "DROWSY", cls: "bg-warning text-warning-foreground" }
        : { label: "SAFE", cls: "bg-primary text-primary-foreground" };

  const speedPct = Math.min(100, (tracker.speedKmh / Math.max(session.profile?.speed_limit_kmh ?? 80, 1)) * 100);
  const scorePct = Math.min(100, detector.topDrowsyScore * 100);
  const gpsColor = { ok: "text-primary", acquiring: "text-warning", error: "text-destructive", off: "text-muted-foreground" }[tracker.gpsStatus];

  const detectionsByClass = useMemo(() => {
    const map = new Map<string, Detection>();
    for (const d of detector.detections) {
      const cur = map.get(d.className);
      if (!cur || d.score > cur.score) map.set(d.className, d);
    }
    return map;
  }, [detector.detections]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Live monitor</h1>
          <p className="text-sm text-muted-foreground">
            {trip ? "Trip in progress — logs sync automatically, even offline." : "Start a trip to record speed, location, weather and drowsiness events."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {trip && (
            <div className="panel flex items-center gap-2 px-3 py-2 text-sm">
              <span className="pulse-dot text-primary" aria-hidden />
              <span className="readout">{durationLabel}</span>
            </div>
          )}
          {trip ? (
            <Button variant="destructive" onClick={() => { tracker.endTrip(); toast.success("Trip ended and saved."); }}>
              End trip
            </Button>
          ) : (
            <Button onClick={() => { tracker.startTrip(); toast.success("Trip started — you are being monitored."); }} disabled={!session.profile}>
              Start trip
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Camera + AI panel */}
        <div className="space-y-5">
          <div className="panel overflow-hidden">
            <div className="relative aspect-square w-full bg-black sm:max-h-[520px]">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
              />
              {detector.status !== "ready" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
                  <span className="pulse-dot text-primary" />
                  <p className="text-sm text-muted-foreground">
                    {detector.status === "idle" && "Camera starting…"}
                    {detector.status === "requesting-camera" && "Waiting for camera permission…"}
                    {detector.status === "loading-model" && "Loading your trained AI model…"}
                    {detector.status === "error" && detector.error}
                  </p>
                  {detector.status === "error" && (
                    <Button size="sm" variant="outline" onClick={() => void detector.start()}>
                      Try again
                    </Button>
                  )}
                </div>
              )}
              <div className={`absolute left-4 top-4 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold tracking-wide ${banner.cls}`}>
                {aiState !== "alert" && <span className="pulse-dot" />}
                {banner.label}
              </div>

              {handOff && (
                <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-warning px-4 py-2 text-sm font-bold tracking-wide text-warning-foreground">
                  HANDS OFF WHEEL
                </div>
              )}

              {/* bounding boxes map 1:1 onto the square preview */}
              {detector.detections.map((d, i) => (
                <div
                  key={`${d.className}-${i}`}
                  className="pointer-events-none absolute rounded border-2"
                  style={{
                    left: `${d.bbox.x * 100}%`,
                    top: `${d.bbox.y * 100}%`,
                    width: `${d.bbox.w * 100}%`,
                    height: `${d.bbox.h * 100}%`,
                    borderColor: isDrowsyClass(d.className) ? "var(--destructive)" : "var(--primary)",
                  }}
                >
                  <span
                    className="absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold"
                    style={{
                      backgroundColor: isDrowsyClass(d.className) ? "var(--destructive)" : "var(--primary)",
                      color: isDrowsyClass(d.className) ? "var(--destructive-foreground)" : "var(--primary-foreground)",
                    }}
                  >
                    {d.className} {Math.round(d.score * 100)}%
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="label-caps">AI engine</span>
                <span className="readout text-xs text-muted-foreground">
                  {detector.inferMs > 0 ? `${Math.round(detector.inferMs)} ms / frame` : ""}
                </span>
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Drowsiness score</span>
                  <span className={`readout text-lg font-bold ${detector.topDrowsyScore > 0.5 ? "text-destructive" : "text-primary"}`}>
                    {detector.topDrowsyScore.toFixed(2)}
                  </span>
                </div>
                <Progress value={scorePct} className="h-2" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {CONF_CLASSES.map((cls) => {
                  const det = detectionsByClass.get(cls);
                  const val = det ? det.score : 0;
                  const bad = isDrowsyClass(cls);
                  return (
                    <div key={cls} className="flex items-center gap-2">
                      <span className="w-36 shrink-0 truncate text-[11px] text-muted-foreground">{cls}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${val * 100}%`, backgroundColor: bad ? "var(--destructive)" : "var(--primary)" }}
                        />
                      </div>
                      <span className="readout w-8 text-right text-[11px]">{Math.round(val * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Speed panel */}
          <div className="panel p-5">
            <div className="flex items-start justify-between">
              <div>
                <span className="label-caps">Live speed</span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className={`readout text-5xl font-bold ${tracker.speedKmh > (session.profile?.speed_limit_kmh ?? 80) ? "text-destructive" : "text-foreground"}`}>
                    {Math.round(tracker.speedKmh)}
                  </span>
                  <span className="text-sm text-muted-foreground">km/h</span>
                </div>
              </div>
              <div className="text-right">
                <span className="label-caps">Your limit</span>
                <div className="readout mt-1 text-xl font-semibold text-muted-foreground">
                  {session.profile?.speed_limit_kmh ?? 80} km/h
                </div>
                <div className={`mt-1 flex items-center justify-end gap-1.5 text-xs ${gpsColor}`}>
                  <span className="pulse-dot" aria-hidden />
                  {tracker.gpsStatus === "ok" && `GPS ±${tracker.position?.accuracy ? Math.round(tracker.position.accuracy) : "?"} m`}
                  {tracker.gpsStatus === "acquiring" && "GPS acquiring…"}
                  {tracker.gpsStatus === "error" && "GPS error"}
                  {tracker.gpsStatus === "off" && "GPS off"}
                </div>
              </div>
            </div>
            <Progress value={speedPct} className="mt-4 h-2" />
            {tracker.gpsError && <p className="mt-3 text-xs text-destructive">{tracker.gpsError}</p>}
          </div>
        </div>

        {/* Side column: location, weather, trip stats */}
        <div className="space-y-5">
          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="label-caps">Live location</span>
              {placeLabel && <span className="truncate text-xs text-muted-foreground">{placeLabel}</span>}
            </div>
            {tracker.position ? (
              <LiveMap
                points={[{ id: "me", lat: tracker.position.lat, lng: tracker.position.lng, label: "You" }]}
                height={220}
                zoom={15}
              />
            ) : (
              <div className="flex h-[220px] items-center justify-center rounded-xl border border-border text-sm text-muted-foreground">
                Waiting for GPS position…
              </div>
            )}
          </div>

          <div className="panel p-4">
            <span className="label-caps">Live weather {placeLabel ? `· ${placeLabel}` : ""}</span>
            {weather ? (
              <>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="readout text-4xl font-bold">{Math.round(weather.tempC)}°</span>
                  <span className="text-sm text-muted-foreground">{describeWeatherCode(weather.code)}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <span>Wind <span className="readout text-foreground">{Math.round(weather.windKmh)}</span> km/h</span>
                  <span>Gusts <span className="readout text-foreground">{Math.round(weather.gustKmh)}</span></span>
                  <span>Rain <span className="readout text-foreground">{weather.precipMm}</span> mm</span>
                </div>
                {weatherAlertList.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {weatherAlertList.map((a) => (
                      <li
                        key={a.title}
                        className={`rounded-lg border p-2 text-xs ${a.level === "danger" ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-warning/50 bg-warning/10 text-warning-foreground"}`}
                      >
                        <strong className="font-semibold">{a.title}.</strong> {a.message}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Weather appears once GPS has a fix.</p>
            )}
          </div>

          <div className="panel p-4">
            <span className="label-caps">This trip</span>
            {trip ? (
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <Stat label="Distance" value={`${trip.distanceKm.toFixed(1)} km`} />
                <Stat label="Max speed" value={`${Math.round(trip.maxSpeedKmh)} km/h`} />
                <Stat label="Avg speed" value={`${Math.round(trip.avgSpeedKmh)} km/h`} />
                <Stat label="Drowsy events" value={String(trip.drowsyEvents + trip.criticalEvents)} danger={trip.drowsyEvents + trip.criticalEvents > 0} />
                <Stat label="Speeding events" value={String(trip.speedingEvents)} danger={trip.speedingEvents > 0} />
                <Stat label="Alarm events" value={String(trip.criticalEvents)} danger={trip.criticalEvents > 0} />
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No active trip. Press “Start trip”.</p>
            )}
          </div>

          <OfflineBanner online={tracker.outbox.online} pending={tracker.outbox.pending} error={tracker.outbox.lastFlushError} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`readout text-lg font-semibold ${danger ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function OfflineBanner({ online, pending, error }: { online: boolean; pending: number; error: string | null }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <span className="label-caps">Sync status</span>
        <Badge variant={online ? "secondary" : "destructive"}>
          <span className={`pulse-dot mr-1.5 ${online ? "text-primary" : "text-destructive"}`} aria-hidden />
          {online ? "Online" : "Offline"}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {online
          ? pending === 0
            ? "All trip logs are saved to the cloud."
            : `Syncing ${pending} buffered log${pending === 1 ? "" : "s"}…`
          : pending === 0
            ? "No internet — new logs will be stored on this device and synced automatically."
            : `No internet — ${pending} log${pending === 1 ? "" : "s"} stored on this device, syncing when you reconnect.`}
      </p>
      {online && error && <p className="mt-1 text-xs text-destructive">Last sync issue: {error}</p>}
    </div>
  );
}
