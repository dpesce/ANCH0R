import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildEffCatalog, formatEffCatalogRow } from "../src/lib/effCatalog.ts";

const catalog = JSON.parse(readFileSync(new URL("../public/data/catalog.json", import.meta.url)));
const example = readFileSync(new URL("../examples/example_EFF_catalog.cat", import.meta.url), "utf8")
  .replace(/\r?\n/g, "\r\n");
const sourceNames = [
  "GALEXASCJ00002", "SDSSJ011003.63", "SDSSJ102148.93", "VCC0815", "MCG-01-01-003",
];
const sources = sourceNames.map((name) => {
  const target = catalog.targets.find((entry) => entry.source_name === name);
  assert.ok(target, `Missing reference target ${name}`);
  return target;
});
const createdAt = new Date("2026-10-28T12:00:00Z");

test("Effelsberg export matches the supplied example with native CRLF line endings", () => {
  assert.equal(buildEffCatalog(sources, createdAt), example);
  assert.match(formatEffCatalogRow(sources[1]), /SBET=-00 00 36\.4 "/);
  assert.match(formatEffCatalogRow(sources[2]), /SBET=\+64 18 00\.0 "/);
  assert.match(formatEffCatalogRow(sources[2]), /VLSR=  524\.8 ;$/);
  assert.match(formatEffCatalogRow(sources[3]), /VLSR= -743\.8 ;$/);
});

test("coordinate rounding carries through midnight and preserves negative zero declination", () => {
  const row = formatEffCatalogRow({
    ...sources[0],
    ra_hours: 24 - 0.01 / 3600,
    ra_hms: "23:59:59.99",
    dec_deg: -0,
    dec_dms: "-00:00:00.0",
  });
  assert.match(row, /SLAM=00 00 00\.0 S ; SBET=-00 00 00\.0 " ;/);
  const pole = formatEffCatalogRow({
    ...sources[0],
    dec_deg: 90 - 0.01 / 3600,
    dec_dms: "+89:59:59.99",
  });
  assert.match(pole, /SBET=\+90 00 00\.0 " ;/);
});

test("the complete available Effelsberg catalog has aligned fields and valid coordinates", () => {
  const available = catalog.targets.filter((target) => target.eligible_eff && target.status !== "observed");
  const text = buildEffCatalog(available, createdAt);
  const lines = text.split("\r\n");
  const rows = lines.filter((line) => line.startsWith("SNAM="));
  assert.equal(rows.length, available.length);
  assert.equal(text.replaceAll("\r\n", "").includes("\n"), false);
  assert.equal(text.replaceAll("\r\n", "").includes("\r"), false);
  assert.equal(lines.at(-2), "STOP");
  assert.equal(lines.at(-1), "");
  for (const [index, row] of rows.entries()) {
    assert.equal(row.length, 78);
    assert.deepEqual([...row.matchAll(/;/g)].map((match) => match.index), [21, 41, 62, 77]);
    assert.equal(row.slice(5, 21).trim(), available[index].source_name);
    assert.match(row, /^SNAM=.{16}; SLAM=\d{2} [0-5]\d [0-5]\d\.\d S ; SBET=[+-]\d{2} [0-5]\d [0-5]\d\.\d " ; VLSR= *-?\d+\.\d ;$/);
    assert.equal(Number(row.slice(69, 76)), Number(available[index].velocity_km_s.toFixed(1)));
  }
});

test("header metadata is current and the STOP record is present for any target count", () => {
  for (const targets of [[], [sources[0]]]) {
    const text = buildEffCatalog(targets, new Date("2026-11-05T00:30:00Z"));
    assert(text.startsWith("COMMON: SBAS=-1\r\nINDIVIDUAL: SNAM SLAM SBET VLSR\r\n"));
    assert(text.includes(`! ANCH0R survey: ${targets.length} Effelsberg ${targets.length === 1 ? "target" : "targets"} not yet observed (2026-11-05)\r\n`));
    assert(text.endsWith("STOP\r\n"));
  }
});

test("invalid fields fail explicitly rather than truncating or changing coordinate conventions", () => {
  assert.equal(formatEffCatalogRow({ ...sources[0], source_name: "ABCDEFGHIJKLMNOP" }).slice(5, 21), "ABCDEFGHIJKLMNOP");
  const invalid = [
    { source_name: "" }, { source_name: "ABCDEFGHIJKLMNOPQ" },
    { source_name: "Bad Name" }, { source_name: "X;STOP" },
    { source_name: "X\nSTOP" }, { source_name: 'X"' },
    { source_name: "X\0" }, { source_name: "\u00e9" },
    { ra_hours: -1 }, { ra_hours: 24 }, { ra_hours: NaN },
    { dec_deg: 91 }, { dec_deg: -91 }, { dec_deg: Infinity },
    { velocity_km_s: NaN }, { velocity_km_s: Infinity }, { velocity_km_s: -10000 },
    { coordinate_system: "Galactic" }, { epoch: "B1950" },
    { velocity_frame: "LSRK" }, { velocity_convention: "Radio" },
  ];
  for (const updates of invalid) {
    assert.throws(() => formatEffCatalogRow({ ...sources[0], ...updates }), Error);
  }
});
