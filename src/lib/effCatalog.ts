import type { Target } from "../types";

const NAME_WIDTH = 16;
const VELOCITY_WIDTH = 7;

function formatSexagesimal(tenths: number): string {
  const major = Math.floor(tenths / 36_000);
  const minutes = Math.floor(tenths / 600) % 60;
  const seconds = (tenths % 600) / 10;
  return [
    String(major).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    seconds.toFixed(1).padStart(4, "0"),
  ].join(" ");
}

export function formatEffCatalogRow(target: Target): string {
  if (
    !target.source_name ||
    /[^\x21-\x7e]|[;=!"]/.test(target.source_name) ||
    target.source_name.length > NAME_WIDTH
  ) {
    throw new Error(
      `Name ${JSON.stringify(target.source_name)} cannot be represented in the Effelsberg catalog's ${NAME_WIDTH}-character name field`,
    );
  }
  if (
    target.coordinate_system !== "Equatorial" ||
    target.epoch !== "J2000" ||
    target.velocity_frame !== "Heliocentric" ||
    target.velocity_convention !== "Optical"
  ) {
    throw new Error(
      `Effelsberg target ${target.source_name} requires J2000 equatorial coordinates and heliocentric optical velocities`,
    );
  }
  if (
    !Number.isFinite(target.ra_hours) ||
    target.ra_hours < 0 ||
    target.ra_hours >= 24 ||
    !Number.isFinite(target.dec_deg) ||
    Math.abs(target.dec_deg) > 90
  ) {
    throw new Error(`Invalid Effelsberg coordinates for ${target.source_name}`);
  }
  if (!Number.isFinite(target.velocity_km_s)) {
    throw new Error(`Invalid Effelsberg velocity for ${target.source_name}`);
  }
  const velocity = target.velocity_km_s.toFixed(1);
  if (velocity.length > VELOCITY_WIDTH) {
    throw new Error(
      `Velocity ${velocity} exceeds the Effelsberg catalog width of ${VELOCITY_WIDTH}`,
    );
  }

  // Parsed coordinates normalize 60-second carries; the original Dec keeps -00.
  const ra = formatSexagesimal(Math.round(target.ra_hours * 36_000) % 864_000);
  const dec = `${target.dec_dms.startsWith("-") ? "-" : "+"}${
    formatSexagesimal(Math.round(Math.abs(target.dec_deg) * 36_000))
  }`;

  return `SNAM=${target.source_name.padEnd(NAME_WIDTH)}; SLAM=${ra} S ; SBET=${dec} " ; VLSR=${velocity.padStart(VELOCITY_WIDTH)} ;`;
}

export function buildEffCatalog(targets: Target[], createdAt = new Date()): string {
  return [
    "COMMON: SBAS=-1",
    "INDIVIDUAL: SNAM SLAM SBET VLSR",
    "!",
    `! ANCH0R survey: ${targets.length} Effelsberg ${targets.length === 1 ? "target" : "targets"} not yet observed (${createdAt.toISOString().slice(0, 10)})`,
    "! J2000. VLSR column = heliocentric cz (optical convention), km/s",
    "!",
    ...targets.map(formatEffCatalogRow),
    "STOP",
    "",
  ].join("\r\n");
}
