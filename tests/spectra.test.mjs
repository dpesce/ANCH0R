import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSpectrumLinksByTarget } from "../src/lib/spectra.ts";

function observation(overrides = {}) {
  return {
    observation_id: "EFF-1",
    target_id: "repeat-target",
    telescope: "EFF",
    status: "observed",
    spectrum_url: "/ANCH0R/spectra/EFF/first.png",
    ...overrides,
  };
}

test("a repeat target retains separate telescope-labeled spectra", () => {
  const first = observation();
  const second = observation({
    observation_id: "GBT-1",
    telescope: "GBT",
    spectrum_url: "/ANCH0R/spectra/GBT/second.png",
  });
  const links = buildSpectrumLinksByTarget([first, second]).get("repeat-target");
  assert.deepEqual(links.map(({ label, url }) => ({ label, url })), [
    { label: "EFF", url: first.spectrum_url },
    { label: "GBT", url: second.spectrum_url },
  ]);
});

test("multiple spectra from one telescope are not collapsed and get distinct labels", () => {
  const rows = [
    observation(),
    observation({ observation_id: "GBT-1", telescope: "GBT", spectrum_url: "/first.png" }),
    observation({ observation_id: "GBT-2", telescope: "GBT", spectrum_url: "/second.png" }),
  ];
  const original = structuredClone(rows);
  const links = buildSpectrumLinksByTarget(rows).get("repeat-target");
  assert.deepEqual(links.map((link) => link.label), ["EFF", "GBT (1)", "GBT (2)"]);
  assert.deepEqual(links.map((link) => link.observation_id), ["EFF-1", "GBT-1", "GBT-2"]);
  assert.deepEqual(rows, original);
});

test("missing spectra and observations that were not completed do not produce links", () => {
  const links = buildSpectrumLinksByTarget([
    observation({ status: "failed" }),
    observation({ status: "scheduled" }),
    observation({ spectrum_url: "" }),
  ]);
  assert.equal(links.size, 0);
  assert.equal(buildSpectrumLinksByTarget([]).size, 0);
});

test("spectra stay with their target and single links retain the telescope label", () => {
  const links = buildSpectrumLinksByTarget([
    observation(),
    observation({ observation_id: "SRT-1", target_id: "other", telescope: "SRT" }),
  ]);
  assert.deepEqual([...links.keys()], ["repeat-target", "other"]);
  assert.equal(links.get("repeat-target")[0].label, "EFF");
  assert.equal(links.get("other")[0].label, "SRT");
});

test("every available observed spectrum in the catalog remains accessible", () => {
  const catalog = JSON.parse(readFileSync(new URL("../public/data/catalog.json", import.meta.url)));
  const links = buildSpectrumLinksByTarget(catalog.observations);
  for (const row of catalog.observations) {
    if (row.status === "observed" && row.spectrum_url) {
      assert(links.get(row.target_id)?.some((link) =>
        link.observation_id === row.observation_id && link.url === row.spectrum_url
      ), `Missing spectrum for ${row.observation_id}`);
    }
  }
});
