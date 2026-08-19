import type { Target } from "../types";

const SRT_CATALOG_HEADER = [
  "# Comment lines to exclude them from the schedule computation",
  "#",
  "# Mandatory params:",
  "# LABEL SCANTYPE BACKEND TARGET_FRAME LONGITUDE LATITUDE",
  "# where:",
  "# SCANTYPE is defined in configuration file",
  "# BACKEND is defined in configuration file",
  "# TARGET_FRAME = [EQ, GAL, HOR]",
  "#",
  "# Optional params:",
  "# [tsys, repetitions, offset_lon, offset_lat, offset_frame, vref, vdef,",
  "# rvel]",
  "# where:",
  "# vref = [BARY, LSRK, LSRD, GALCEN, TOPCEN]",
  "# vdef = [OP, RD, Z]",
  "",
] as const;

function assertSingleField(label: string, value: string): void {
  if (!value || /\s/.test(value)) {
    throw new Error(
      `${label} value ${JSON.stringify(value)} cannot be represented in an SRT catalog field`,
    );
  }
}

export function formatSrtCatalogRow(target: Target): string {
  const velocity = String(Math.round(target.velocity_km_s));
  const ra = `${target.ra_hms}h`;

  assertSingleField("Name", target.source_name);
  assertSingleField("RA", ra);
  assertSingleField("Dec", target.dec_dms);
  assertSingleField("Velocity", velocity);

  const fields = [
    "Nodcal",
    "SARDARA",
    "EQ",
    ra,
    target.dec_dms,
    `rvel=${velocity}`,
    "vref=LSRK",
    "vdef=OP",
    "repetitions=6",
  ].join(" ");

  return `${target.source_name}   ${fields}`;
}

export function buildSrtCatalog(targets: Target[]): string {
  return [
    ...SRT_CATALOG_HEADER,
    ...targets.map(formatSrtCatalogRow),
    "",
    "",
  ].join("\r\n");
}
