// src/lib/weather.ts
//
// Live weather via Open-Meteo (no API key) + rule-based weather alerts.
// Pure functions are unit-tested in src/test/weather-rules.test.ts.

export interface WeatherAlert {
  level: "warning" | "danger";
  title: string;
  message: string;
}

export interface WeatherNow {
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  code: number;
  windKmh: number;
  gustKmh: number;
  precipMm: number;
  isDay: boolean;
  fetchedAt: number;
}

export function describeWeatherCode(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 56 && code <= 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code === 80 || code === 81) return "Rain showers";
  if (code === 82) return "Violent rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

/** Rule-based driving alerts. Deterministic and unit-tested. */
export function weatherAlerts(w: WeatherNow): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  const c = w.code;

  if (c >= 95) {
    alerts.push({
      level: "danger",
      title: "Thunderstorm",
      message: "Severe weather — consider stopping until the storm passes.",
    });
  } else if ((c >= 61 && c <= 67) || c === 82) {
    alerts.push({
      level: "warning",
      title: "Heavy rain",
      message: "Wet road ahead — reduce speed and keep extra distance.",
    });
  } else if (c >= 51 && c <= 57) {
    alerts.push({
      level: "warning",
      title: "Drizzle",
      message: "Light rain — roads may be slippery.",
    });
  }

  if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) {
    alerts.push({
      level: "danger",
      title: "Snow",
      message: "Snow on the road — drive slowly and brake early.",
    });
  }

  if (c === 45 || c === 48) {
    alerts.push({
      level: "warning",
      title: "Fog",
      message: "Poor visibility — use low beams and slow down.",
    });
  }

  if (w.gustKmh >= 60) {
    alerts.push({
      level: "warning",
      title: "Strong gusts",
      message: `Wind gusts up to ${Math.round(w.gustKmh)} km/h — keep both hands on the wheel.`,
    });
  } else if (w.windKmh >= 40) {
    alerts.push({
      level: "warning",
      title: "Strong wind",
      message: `Sustained wind ${Math.round(w.windKmh)} km/h — watch crosswinds.`,
    });
  }

  if (w.tempC >= 40) {
    alerts.push({
      level: "warning",
      title: "Extreme heat",
      message: "Stay hydrated; watch for fatigue and tyre pressure.",
    });
  } else if (w.tempC <= 0) {
    alerts.push({
      level: "warning",
      title: "Freezing temperatures",
      message: "Possible ice on the road — brake gently.",
    });
  }

  return alerts;
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherNow> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_gusts_10m" +
    "&wind_speed_unit=kmh&timezone=UTC";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  const data = await res.json();
  const cur = data?.current;
  if (!cur) throw new Error("Weather response missing current data");
  return {
    tempC: cur.temperature_2m,
    feelsLikeC: cur.apparent_temperature,
    humidity: cur.relative_humidity_2m,
    code: cur.weather_code,
    windKmh: cur.wind_speed_10m,
    gustKmh: cur.wind_gusts_10m,
    precipMm: cur.precipitation,
    isDay: cur.is_day === 1,
    fetchedAt: Date.now(),
  };
}

/** Free reverse geocoding for a short place label (best effort). */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    );
    if (!res.ok) return null;
    const d = await res.json();
    return (
      [d.locality || d.city, d.principalSubdivision, d.countryName].filter(Boolean).slice(0, 2).join(", ") || null
    );
  } catch {
    return null;
  }
}
