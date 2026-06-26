import type { TelescopeCode } from "../types";

export interface TelescopeSite {
  code: TelescopeCode;
  shortName: string;
  label: string;
  timeZone: string;
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM: number;
}

export const TELESCOPES: Record<TelescopeCode, TelescopeSite> = {
  GBT: {
    code: "GBT",
    shortName: "GBT",
    label: "Green Bank Telescope",
    timeZone: "America/New_York",
    latitudeDeg: 38.4331,
    longitudeDeg: -79.8398,
    elevationM: 824,
  },
  EFF: {
    code: "EFF",
    shortName: "Effelsberg",
    label: "Effelsberg 100m Telescope",
    timeZone: "Europe/Berlin",
    latitudeDeg: 50.5248,
    longitudeDeg: 6.8836,
    elevationM: 319,
  },
  SRT: {
    code: "SRT",
    shortName: "SRT",
    label: "Sardinia Radio Telescope",
    timeZone: "Europe/Rome",
    latitudeDeg: 39.4931,
    longitudeDeg: 9.2453,
    elevationM: 600,
  },
};

export const TELESCOPE_CODES = Object.keys(TELESCOPES) as TelescopeCode[];
