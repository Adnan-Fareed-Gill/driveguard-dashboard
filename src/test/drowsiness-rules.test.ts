import { describe, expect, it } from "vitest";
import { DrowsinessScorer } from "@/lib/drowsiness/scorer";
import { weatherAlerts, type WeatherNow } from "@/lib/weather";

// Rules from the user's mobile app: drowsy warning ≥1s, critical alarm ≥3s,
// safe reset after ≥1.5s of safe frames.
describe("drowsiness scorer thresholds", () => {
  it("stays alert for the first second of drowsy frames", () => {
    const s = new DrowsinessScorer();
    const t0 = 1_000_000;
    expect(s.addFrame(true, t0)).toBe("alert");
    expect(s.addFrame(true, t0 + 900)).toBe("alert");
  });

  it("turns drowsy at 1s and critical at 3s of continuous drowsy frames", () => {
    const s = new DrowsinessScorer();
    const t0 = 1_000_000;
    s.addFrame(true, t0);
    expect(s.addFrame(true, t0 + 1000)).toBe("drowsy");
    expect(s.addFrame(true, t0 + 2999)).toBe("drowsy");
    expect(s.addFrame(true, t0 + 3000)).toBe("critical");
  });

  it("resets to alert only after 1.5s of safe frames", () => {
    const s = new DrowsinessScorer();
    const t0 = 1_000_000;
    s.addFrame(true, t0);
    s.addFrame(true, t0 + 1000); // drowsy
    expect(s.addFrame(false, t0 + 1100)).toBe("drowsy");
    expect(s.addFrame(false, t0 + 2500)).toBe("drowsy");
    expect(s.addFrame(false, t0 + 2601)).toBe("alert");
  });
});

// Weather alert rules shown to drivers and logged on trips.
describe("weather alert rules", () => {
  const base: WeatherNow = {
    tempC: 25,
    feelsLikeC: 25,
    humidity: 40,
    code: 0,
    windKmh: 10,
    gustKmh: 15,
    precipMm: 0,
    isDay: true,
    fetchedAt: 0,
  };

  it("clear conditions raise no alert", () => {
    expect(weatherAlerts(base)).toEqual([]);
  });

  it("thunderstorm is a danger alert", () => {
    const alerts = weatherAlerts({ ...base, code: 95 });
    expect(alerts.some((a) => a.level === "danger" && a.title === "Thunderstorm")).toBe(true);
  });

  it("rain raises a warning", () => {
    const alerts = weatherAlerts({ ...base, code: 63 });
    expect(alerts.some((a) => a.level === "warning" && a.title === "Heavy rain")).toBe(true);
  });

  it("snow raises a danger alert", () => {
    const alerts = weatherAlerts({ ...base, code: 73 });
    expect(alerts.some((a) => a.level === "danger" && a.title === "Snow")).toBe(true);
  });

  it("fog raises a warning", () => {
    expect(weatherAlerts({ ...base, code: 45 }).some((a) => a.title === "Fog")).toBe(true);
  });

  it("strong wind and gusts raise warnings", () => {
    expect(weatherAlerts({ ...base, windKmh: 45 }).some((a) => a.title === "Strong wind")).toBe(true);
    expect(weatherAlerts({ ...base, gustKmh: 70 }).some((a) => a.title === "Strong gusts")).toBe(true);
  });

  it("extreme heat and freezing temperatures raise warnings", () => {
    expect(weatherAlerts({ ...base, tempC: 42 }).some((a) => a.title === "Extreme heat")).toBe(true);
    expect(weatherAlerts({ ...base, tempC: -3 }).some((a) => a.title === "Freezing temperatures")).toBe(true);
  });
});
