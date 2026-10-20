import type { DataQuality, DetectionStatus, TelescopeCode } from "../types";

export const GITHUB_ISSUES_URL = "https://github.com/dpesce/ANCH0R/issues/new";
// A conservative URL budget, including the fully encoded title and body.
export const MAX_REPORT_URL_LENGTH = 1_800;
const MAX_READABLE_REPORT_BYTES = 60_000;
const REPORT_PAYLOAD_MARKER = "<!-- ANCH0R_OBSERVING_REPORT_V5 -->";

export const DATA_QUALITY_OPTIONS: Array<{ value: DataQuality; label: string }> = [
  { value: "trusted", label: "I trust the data" },
  {
    value: "possible_pointing_problems",
    label: "There are potential pointing problems",
  },
  {
    value: "possible_other_problems",
    label: "There are potential other problems",
  },
  { value: "untrusted", label: "I do not trust the data at all" },
];

export const DATA_QUALITY_LABELS = Object.fromEntries(
  DATA_QUALITY_OPTIONS.map(({ value, label }) => [value, label]),
) as Record<DataQuality, string>;

export interface PreparedReportTarget {
  targetId: string;
  sourceName: string;
  raHms: string;
  decDms: string;
  velocityKmS: number;
  rmsMjyPer1KmS: number;
  dataQuality: DataQuality;
  detectionStatus: DetectionStatus;
}

export interface ReportSubmission {
  issueUrl: string;
  body: string;
  filename: string;
  targetCount: number;
}

function buildReadableReport(
  telescope: TelescopeCode,
  targets: PreparedReportTarget[],
  notes: string,
  submittedAtUtc: string,
  partDescription = "",
): string {
  const targetTable = [
    "| Target | RMS (mJy / 1 km/s) | Data quality | Detection |",
    "| --- | ---: | --- | --- |",
    ...targets.map(
      (target) =>
        `| ${target.sourceName} | ${target.rmsMjyPer1KmS} | ${
          DATA_QUALITY_LABELS[target.dataQuality]
        } | ${target.detectionStatus} |`,
    ),
  ].join("\n");

  return [
    "ANCH0R observing report",
    partDescription,
    "",
    `Telescope: ${telescope}`,
    `Prepared at: ${submittedAtUtc}`,
    "",
    targetTable,
    "",
    "Notes:",
    notes || "(none)",
  ].join("\n");
}

async function compressPayload(
  telescope: TelescopeCode,
  targets: PreparedReportTarget[],
  notes: string,
  submittedAtUtc: string,
): Promise<string> {
  const payload = {
    v: 5,
    t: telescope,
    at: submittedAtUtc,
    notes,
    targets: targets.map((target) => [
      target.targetId,
      target.rmsMjyPer1KmS,
      target.dataQuality,
      target.detectionStatus,
    ]),
  };
  const stream = new Blob([JSON.stringify(payload)]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function reportIssueUrl(
  telescope: TelescopeCode,
  targetCount: number,
  encoded: string,
  partIndex: number,
  partCount: number,
): string {
  const part = partCount > 1 ? ` (Part ${partIndex} of ${partCount})` : "";
  const title = `[ANCH0R Observing Report] ${telescope} ${targetCount} target${
    targetCount === 1 ? "" : "s"
  }${part}`;
  const body = [
    REPORT_PAYLOAD_MARKER,
    "",
    `${telescope} observing report: ${targetCount} targets${part}.`,
    "",
    "Click Create to submit. GitHub Actions will decode the report and add a readable summary here.",
    "",
    "```anch0r-gzip",
    encoded,
    "```",
  ].join("\n");
  const url = new URL(GITHUB_ISSUES_URL);
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  return url.toString();
}

export async function buildReportSubmissions(
  telescope: TelescopeCode,
  targets: PreparedReportTarget[],
  notes: string,
  submittedAtUtc: string,
): Promise<ReportSubmission[]> {
  if (targets.length === 0) {
    throw new Error("Select at least one target before submitting a report.");
  }

  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser cannot compress reports. Please use an up-to-date browser.");
  }

  const encoder = new TextEncoder();
  const groups: Array<{ targets: PreparedReportTarget[]; encoded: string }> = [];
  const maxParts = targets.length;

  async function candidate(start: number, end: number) {
    const group = targets.slice(start, end);
    const encoded = await compressPayload(telescope, group, notes, submittedAtUtc);
    // Reserve the longest possible part labels before the true count is known.
    // The compressed payload itself does not change when parts are numbered.
    const url = reportIssueUrl(telescope, group.length, encoded, maxParts, maxParts);
    const readableSize = encoder.encode(
      buildReadableReport(telescope, group, notes, submittedAtUtc),
    ).length;
    return {
      targets: group,
      encoded,
      fits: url.length <= MAX_REPORT_URL_LENGTH &&
        readableSize + 2_000 <= MAX_READABLE_REPORT_BYTES,
    };
  }

  let start = 0;
  while (start < targets.length) {
    const remaining = await candidate(start, targets.length);
    if (remaining.fits) {
      groups.push(remaining);
      break;
    }

    let best = await candidate(start, start + 1);
    if (!best.fits) {
      throw new Error(
        "The report notes are too long for a GitHub report link. Shorten them before continuing; your target entries have been kept.",
      );
    }

    // Choose a fitting group using actual compressed URL lengths. Keep only
    // candidates that were measured to fit; compression ratios can vary.
    let low = start + 2;
    let high = targets.length - 1;
    while (low <= high) {
      const end = Math.floor((low + high) / 2);
      const next = await candidate(start, end);
      if (next.fits) {
        best = next;
        low = end + 1;
      } else {
        high = end - 1;
      }
    }
    groups.push(best);
    start += best.targets.length;
  }

  return groups.map(({ targets: group, encoded }, index) => {
    const part = groups.length > 1 ? `Part ${index + 1} of ${groups.length}` : "";
    return {
      issueUrl: reportIssueUrl(telescope, group.length, encoded, index + 1, groups.length),
      body: buildReadableReport(telescope, group, notes, submittedAtUtc, part),
      filename: `anch0r-report-${telescope.toLowerCase()}-${
        submittedAtUtc.slice(0, 10)
      }${part ? `-part-${index + 1}` : ""}.txt`,
      targetCount: group.length,
    };
  });
}
