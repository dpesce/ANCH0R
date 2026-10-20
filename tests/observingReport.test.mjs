import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  buildReportSubmissions,
  MAX_REPORT_URL_LENGTH,
} from "../src/lib/observingReport.ts";

const submittedAt = "2026-10-20T01:29:00Z";
const catalog = JSON.parse(readFileSync(new URL("../public/data/catalog.json", import.meta.url)));

function target(source, index) {
  return {
    targetId: source.target_id,
    sourceName: source.source_name,
    raHms: source.ra_hms,
    decDms: source.dec_dms,
    velocityKmS: Math.round(source.velocity_km_s),
    rmsMjyPer1KmS: index === 0 ? 0 : 6 + (index % 7) / 10,
    dataQuality: ["trusted", "possible_pointing_problems", "possible_other_problems", "untrusted"][index % 4],
    detectionStatus: ["detected", "marginal", "undetected"][index % 3],
  };
}

function payload(submission) {
  const body = new URL(submission.issueUrl).searchParams.get("body");
  const encoded = body.match(/```anch0r-gzip\s+([A-Za-z0-9_-]+)\s*```/)[1];
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64url")).toString("utf8"));
}

function expectedEntries(targets) {
  return targets.map((entry) => [entry.targetId, entry.rmsMjyPer1KmS, entry.dataQuality, entry.detectionStatus]);
}

function checkPythonRoundTrip(submissions, targets, telescope, notes) {
  const result = spawnSync("python3", ["tests/report_roundtrip.py"], {
    input: JSON.stringify({
      bodies: submissions.map((entry) => new URL(entry.issueUrl).searchParams.get("body")),
      expected: {telescope, notes, submitted_at_utc: submittedAt, targets: expectedEntries(targets)},
    }),
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("52 targets fit in one prefilled compressed link with every assessment intact", async () => {
  const targets = catalog.targets.filter((entry) => entry.eligible_gbt).slice(0, 52).map(target);
  const notes = "Good weather, system temperature ~44K.";
  const submissions = await buildReportSubmissions("GBT", targets, notes, submittedAt);
  assert.equal(submissions.length, 1);
  const [submission] = submissions;
  assert.ok(submission.issueUrl.length <= MAX_REPORT_URL_LENGTH);
  assert.match(new URL(submission.issueUrl).searchParams.get("title"), /GBT 52 targets$/);
  assert.equal(payload(submission).v, 5);
  assert.deepEqual(payload(submission).targets, expectedEntries(targets));
  assert.equal(payload(submission).notes, notes);
  assert.match(submission.body, /RMS/);
  assert.ok(submission.body.includes(targets[0].sourceName));
  checkPythonRoundTrip(submissions, targets, "GBT", notes);
});

test("the entire catalog splits by encoded URL size without missing or repeating targets", async () => {
  const targets = catalog.targets.map(target);
  const notes = "Clear sky. Unicode: α, é, 水. Notes with ```json\n{}\n``` and `scan`.";
  const submissions = await buildReportSubmissions("SRT", targets, notes, submittedAt);
  assert.ok(submissions.length > 1);
  const entries = [];
  for (const [index, submission] of submissions.entries()) {
    assert.ok(submission.issueUrl.length <= MAX_REPORT_URL_LENGTH);
    assert.equal(payload(submission).notes, notes);
    assert.equal(payload(submission).at, submittedAt);
    assert.equal(payload(submission).targets.length, submission.targetCount);
    assert.match(new URL(submission.issueUrl).searchParams.get("title"), new RegExp(`Part ${index + 1} of ${submissions.length}`));
    entries.push(...payload(submission).targets);
  }
  assert.deepEqual(entries, expectedEntries(targets));
  checkPythonRoundTrip(submissions, targets, "SRT", notes);
});

test("one target fits without a part label and notes with URL punctuation round-trip", async () => {
  const targets = [target(catalog.targets[0], 0)];
  const notes = "a+b / c?d&e=f #sky %clear\n```anch0r-gzip\nnot-the-payload\n```";
  const [submission] = await buildReportSubmissions("SRT", targets, notes, submittedAt);
  assert.ok(submission.issueUrl.length <= MAX_REPORT_URL_LENGTH);
  assert.doesNotMatch(new URL(submission.issueUrl).searchParams.get("title"), /Part/);
  assert.equal(payload(submission).notes, notes);
  checkPythonRoundTrip([submission], targets, "SRT", notes);
});

test("empty reports and notes that cannot fit one target produce actionable errors", async () => {
  await assert.rejects(buildReportSubmissions("GBT", [], "", submittedAt), /at least one target/);
  const targets = [target(catalog.targets[0], 1)];
  await assert.rejects(
    buildReportSubmissions("GBT", targets, randomBytes(4_000).toString("hex"), submittedAt),
    /notes are too long/,
  );
});
