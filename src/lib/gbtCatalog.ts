import type { Target } from "../types";

export const GBT_CATALOG_HEADER = "head= name ra dec vel color";
const GBT_DEFAULT_COLOR = "red";

const FIELD_WIDTHS = {
  name: 18,
  ra: 12,
  dec: 13,
  velocity: 5,
} as const;

function assertFieldFits(label: string, value: string, width: number): void {
  if (value.length > width) {
    throw new Error(
      `${label} value ${JSON.stringify(value)} exceeds the GBT catalog width of ${width}`,
    );
  }
}

export function formatGbtCatalogRow(target: Target): string {
  const velocity = String(Math.round(target.velocity_km_s));
  const dec = /^[+-]/.test(target.dec_dms)
    ? target.dec_dms
    : ` ${target.dec_dms}`;

  assertFieldFits("Name", target.source_name, FIELD_WIDTHS.name);
  assertFieldFits("RA", target.ra_hms, FIELD_WIDTHS.ra);
  assertFieldFits("Dec", dec, FIELD_WIDTHS.dec);
  assertFieldFits("Velocity", velocity, FIELD_WIDTHS.velocity);

  return [
    target.source_name.padEnd(FIELD_WIDTHS.name),
    target.ra_hms.padEnd(FIELD_WIDTHS.ra),
    dec.padEnd(FIELD_WIDTHS.dec),
    velocity.padStart(FIELD_WIDTHS.velocity),
    "   ",
    GBT_DEFAULT_COLOR,
  ].join("");
}

export function buildGbtCatalog(targets: Target[]): string {
  return [
    GBT_CATALOG_HEADER,
    ...targets.map(formatGbtCatalogRow),
    "",
  ].join("\n");
}
