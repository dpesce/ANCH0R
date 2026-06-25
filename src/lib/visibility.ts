import type { Target } from "../types";
import type { TelescopeSite } from "./telescopes";

const DAY_MS = 86_400_000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface VisibilityWindow {
  startUtc: Date;
  endUtc: Date;
}

export interface VisibilityResult {
  observableMinutes: number;
  maxAltitudeDeg: number;
  maxAltitudeUtc: Date;
  firstObservableUtc: Date | null;
  lastObservableUtc: Date | null;
}

function normalizeHours(value: number): number {
  return ((value % 24) + 24) % 24;
}

function julianDate(date: Date): number {
  return date.getTime() / DAY_MS + 2440587.5;
}

function gmstHours(date: Date): number {
  const daysSinceJ2000 = julianDate(date) - 2451545.0;
  return normalizeHours(18.697374558 + 24.06570982441908 * daysSinceJ2000);
}

export function altitudeDeg(
  raHours: number,
  decDeg: number,
  site: TelescopeSite,
  date: Date,
): number {
  const localSiderealHours = normalizeHours(gmstHours(date) + site.longitudeDeg / 15);
  const hourAngleHours = normalizeHours(localSiderealHours - raHours + 12) - 12;
  const hourAngleRad = hourAngleHours * 15 * DEG_TO_RAD;
  const decRad = decDeg * DEG_TO_RAD;
  const latRad = site.latitudeDeg * DEG_TO_RAD;

  const sinAltitude =
    Math.sin(decRad) * Math.sin(latRad) +
    Math.cos(decRad) * Math.cos(latRad) * Math.cos(hourAngleRad);

  return Math.asin(Math.max(-1, Math.min(1, sinAltitude))) * RAD_TO_DEG;
}

export function evaluateVisibility(
  target: Target,
  site: TelescopeSite,
  window: VisibilityWindow,
  minAltitudeDeg: number,
  stepMinutes = 10,
): VisibilityResult | null {
  const startMs = window.startUtc.getTime();
  const endMs = window.endUtc.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  const stepMs = Math.max(1, stepMinutes) * 60_000;
  let observableMs = 0;
  let firstObservableUtc: Date | null = null;
  let lastObservableUtc: Date | null = null;
  let maxAltitudeDeg = -90;
  let maxAltitudeUtc = new Date(startMs);

  for (let timeMs = startMs; timeMs <= endMs; timeMs += stepMs) {
    const sampleDate = new Date(timeMs);
    const altitude = altitudeDeg(target.ra_hours, target.dec_deg, site, sampleDate);
    if (altitude > maxAltitudeDeg) {
      maxAltitudeDeg = altitude;
      maxAltitudeUtc = sampleDate;
    }
  }

  for (let timeMs = startMs; timeMs < endMs; timeMs += stepMs) {
    const intervalEndMs = Math.min(timeMs + stepMs, endMs);
    const midpoint = new Date((timeMs + intervalEndMs) / 2);
    const altitude = altitudeDeg(target.ra_hours, target.dec_deg, site, midpoint);
    if (altitude >= minAltitudeDeg) {
      observableMs += intervalEndMs - timeMs;
      if (!firstObservableUtc) {
        firstObservableUtc = new Date(timeMs);
      }
      lastObservableUtc = new Date(intervalEndMs);
    }
  }

  return {
    observableMinutes: Math.round(observableMs / 60_000),
    maxAltitudeDeg,
    maxAltitudeUtc,
    firstObservableUtc,
    lastObservableUtc,
  };
}
