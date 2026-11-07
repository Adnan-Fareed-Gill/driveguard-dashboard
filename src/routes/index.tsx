import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-night-drive.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Drowsy Guard — AI Drowsiness Monitoring for Every Drive" },
      {
        name: "description",
        content:
          "Webcam-based AI drowsiness detection, trip records, live location, weather alerts and live speed monitoring — with a dedicated admin dashboard for fleet oversight.",
      },
      { property: "og:title", content: "Drowsy Guard — AI Drowsiness Monitoring for Every Drive" },
      {
        property: "og:description",
        content:
          "Webcam-based AI drowsiness detection, trip records, live location, weather alerts and speed monitoring.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    title: "AI drowsiness detection",
    body: "Your trained model watches the driver through the webcam and raises a drowsy warning after 1 second and a full alarm after 3 seconds of closed eyes, yawning or head tilt.",
  },
  {
    title: "Trip records",
    body: "Every trip logs start, end, distance, top and average speed, drowsiness and speeding events — kept even when the internet drops and synced once it returns.",
  },
  {
    title: "Live location & speed",
    body: "GPS keeps a live position and speed readout during every trip; admins watch their drivers move on a live map.",
  },
  {
    title: "Live weather & alerts",
    body: "Current conditions along the route with automatic alerts for rain, storms, fog, snow, strong wind and extreme temperatures.",
  },
  {
    title: "Driver dashboard",
    body: "Start a monitored session, follow your own speed, location, weather and alarm status in one instrument panel.",
  },
  {
    title: "Admin dashboard",
    body: "A separate control room: live map of active drivers, their current speed and alarm state, plus every trip and alert across the fleet.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="pulse-dot text-primary" aria-hidden />
            <span className="font-display text-lg font-700 tracking-tight">Drowsy Guard</span>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild size="sm" variant="ghost">
              <Link to="/auth" search={{ portal: "admin" }}>Admin portal</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth" search={{ portal: "driver" }}>Driver portal</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <img
          src={heroImage}
          alt="Night drive from inside a car cockpit with glowing dashboard"
          className="absolute inset-0 h-full w-full object-cover opacity-40"
          width={1600}
          height={912}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/40 to-background" />
        <div className="relative mx-auto max-w-6xl px-6 py-28 sm:py-36">
          <p className="label-caps mb-4 text-primary">AI safety co-pilot</p>
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-tight sm:text-6xl">
            The drowsiness watchdog for every driver — and every fleet.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Drowsy Guard runs your trained AI model live in the browser, watches for closed eyes,
            yawning and head tilt, records every trip, and gives admins a live map, speed and
            weather oversight.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Button asChild size="lg" className="text-base">
              <Link to="/auth" search={{ portal: "driver", mode: "signup" }}>Start monitoring</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base">
              <Link to="/auth" search={{ portal: "admin" }}>Admin sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-2xl font-bold sm:text-3xl">Everything on watch, in one app</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="panel p-6">
              <div className="mb-3 h-1 w-10 rounded-full bg-primary/70" />
              <h3 className="font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 text-sm text-muted-foreground">
          <span>Drowsy Guard — drive alert, arrive safe.</span>
          <Link to="/auth" className="hover:text-foreground">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
