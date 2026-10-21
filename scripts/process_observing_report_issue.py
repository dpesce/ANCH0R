#!/usr/bin/env python3
"""Convert an ANCH0R observing-report issue into observation CSV rows."""

from __future__ import annotations

import argparse
import base64
import binascii
import csv
import json
import os
import re
import sys
import zlib
from datetime import datetime
from pathlib import Path
from typing import Any

from build_catalog import CatalogError, build_catalog


ROOT = Path(__file__).resolve().parents[1]
OBSERVATIONS_FILE = ROOT / "data" / "observations.csv"

REPORT_MARKER = "<!-- ANCH0R_OBSERVING_REPORT_V6 -->"
MAX_DECOMPRESSED_REPORT_BYTES = 1_000_000
MAX_ENCODED_REPORT_CHARACTERS = 10_000
MAX_READABLE_REPORT_BYTES = 60_000
OBSERVATION_FIELDS = [
    "observation_id",
    "target_id",
    "telescope",
    "observer",
    "start_utc",
    "end_utc",
    "status",
    "spectrum_url",
    "rms_mjy_per_1_km_s",
    "data_quality",
    "detection_status",
    "notes",
]
VALID_TELESCOPES = {"GBT", "EFF", "SRT"}
VALID_DATA_QUALITY = {
    "trusted",
    "possible_pointing_problems",
    "possible_other_problems",
    "untrusted",
}
VALID_DETECTION_STATUSES = {"detected", "marginal", "undetected"}
DATA_QUALITY_LABELS = {
    "trusted": "I trust the data",
    "possible_pointing_problems": "There are potential pointing problems",
    "possible_other_problems": "There are potential other problems",
    "untrusted": "I do not trust the data at all",
}


class ReportError(RuntimeError):
    """Raised when a report issue cannot be converted safely."""


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_event(path: str | None) -> tuple[int, str, str]:
    if not path:
        issue_number = os.environ.get("ISSUE_NUMBER", "")
        issue_author = os.environ.get("ISSUE_AUTHOR", "")
        issue_body = os.environ.get("ISSUE_BODY", "")
        if not issue_number.isdigit() or not issue_author:
            raise ReportError("Missing issue metadata; pass --event-path or ISSUE_* variables")
        return int(issue_number), issue_author, issue_body

    with Path(path).open("r", encoding="utf-8") as handle:
        event = json.load(handle)
    issue = event.get("issue") or {}
    issue_number = issue.get("number")
    issue_author = (issue.get("user") or {}).get("login")
    issue_body = issue.get("body") or ""
    if not isinstance(issue_number, int) or not issue_author:
        raise ReportError("GitHub event payload does not contain issue number/author")
    return issue_number, issue_author, issue_body


def extract_encoded_report(body: str) -> str:
    if REPORT_MARKER not in body:
        raise ReportError("Issue body does not contain an ANCH0R observing-report marker")

    match = re.search(r"```anch0r-gzip\s+([A-Za-z0-9_-]+)\s*```", body)
    if not match:
        raise ReportError("Issue body does not contain a compressed report block")
    encoded = match.group(1)
    if len(encoded) > MAX_ENCODED_REPORT_CHARACTERS:
        raise ReportError("Encoded report exceeds the supported size")
    return encoded


def extract_report_payload(body: str) -> dict[str, Any]:
    encoded = extract_encoded_report(body)

    try:
        compressed = base64.b64decode(
            encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True
        )
        # Public issues are untrusted input. Bound expansion before parsing JSON
        # and reject truncated streams, concatenated gzip members, and trailing data.
        decoder = zlib.decompressobj(wbits=31)
        raw = decoder.decompress(compressed, MAX_DECOMPRESSED_REPORT_BYTES + 1)
        if len(raw) > MAX_DECOMPRESSED_REPORT_BYTES or decoder.unconsumed_tail:
            raise ReportError("Decompressed report exceeds the supported size")
        if not decoder.eof or decoder.unused_data:
            raise ReportError("Compressed report is truncated or contains trailing data")
        compact = json.loads(raw.decode("utf-8"))
    except (binascii.Error, zlib.error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReportError(f"Compressed report is invalid: {exc}") from exc

    if not isinstance(compact, dict):
        raise ReportError("Report JSON payload must be an object")
    if compact.get("v") != 6:
        raise ReportError("Unsupported report schema_version")
    entries = compact.get("targets")
    if not isinstance(entries, list):
        raise ReportError("Report payload must contain a target list")
    targets = []
    for index, entry in enumerate(entries, 1):
        if not isinstance(entry, list) or len(entry) != 3:
            raise ReportError(f"targets[{index}] must contain ID, quality, and detection")
        target_id, quality, detection = entry
        targets.append({
            "target_id": target_id,
            "data_quality": quality,
            "detection_status": detection,
        })
    return {
        "schema_version": 6,
        "submitted_at_utc": compact.get("at"),
        "telescope": compact.get("t"),
        "notes": compact.get("notes"),
        "targets": targets,
    }


def parse_utc(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ReportError(f"{field} must be an ISO UTC timestamp ending in Z")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReportError(f"{field} is not a valid ISO UTC timestamp") from exc


def validate_payload(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != 6:
        raise ReportError("Unsupported report schema_version")

    parse_utc(payload.get("submitted_at_utc"), "submitted_at_utc")
    if not isinstance(payload.get("notes"), str):
        raise ReportError("Report notes must be text")

    telescope = payload.get("telescope")
    if not isinstance(telescope, str) or telescope not in VALID_TELESCOPES:
        raise ReportError(f"Invalid telescope {telescope!r}")

    targets = payload.get("targets")
    if not isinstance(targets, list) or not targets:
        raise ReportError("Report payload must include at least one target")
    seen_target_ids: set[str] = set()
    for index, target in enumerate(targets, 1):
        if not isinstance(target, dict):
            raise ReportError(f"targets[{index}] must be an object")
        target_id = target.get("target_id")
        if not isinstance(target_id, str) or not target_id or target_id != target_id.strip():
            raise ReportError(f"targets[{index}] is missing target_id")
        if target_id in seen_target_ids:
            raise ReportError(f"Report payload repeats target_id {target_id!r}")
        seen_target_ids.add(target_id)

        data_quality = target.get("data_quality")
        if (
            not isinstance(data_quality, str)
            or data_quality not in VALID_DATA_QUALITY
        ):
            raise ReportError(
                f"targets[{index}] has invalid data_quality {data_quality!r}"
            )

        detection_status = target.get("detection_status")
        if (
            not isinstance(detection_status, str)
            or detection_status not in VALID_DETECTION_STATUSES
        ):
            raise ReportError(
                f"targets[{index}] has invalid detection_status "
                f"{detection_status!r}"
            )


def read_observation_rows() -> list[dict[str, str]]:
    if not OBSERVATIONS_FILE.exists():
        return []

    with OBSERVATIONS_FILE.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        if fieldnames != OBSERVATION_FIELDS:
            raise ReportError(
                f"{OBSERVATIONS_FILE} columns must be exactly: {', '.join(OBSERVATION_FIELDS)}"
            )
        return [{field: row.get(field, "") for field in OBSERVATION_FIELDS} for row in reader]


def write_observation_rows(rows: list[dict[str, str]]) -> None:
    with OBSERVATIONS_FILE.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OBSERVATION_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def make_observation_rows(
    payload: dict[str, Any],
    issue_number: int,
    issue_author: str,
) -> list[dict[str, str]]:
    catalog = build_catalog(write_outputs=False)
    targets_by_id = {target["target_id"]: target for target in catalog["targets"]}

    report_notes = compact_text(payload.get("notes"))
    issue_note = f"Submitted via GitHub issue #{issue_number} by @{issue_author}."
    notes = " ".join(part for part in [report_notes, issue_note] if part)
    telescope = payload["telescope"]

    rows: list[dict[str, str]] = []
    for index, target in enumerate(payload["targets"], 1):
        target_id = compact_text(target.get("target_id"))
        if target_id not in targets_by_id:
            raise ReportError(f"Unknown target_id {target_id!r}")
        if telescope not in targets_by_id[target_id]["eligible_telescopes"]:
            raise ReportError(f"{target_id!r} is not eligible for {telescope}")

        rows.append(
            {
                "observation_id": f"ISSUE-{issue_number}-{index:03d}",
                "target_id": target_id,
                "telescope": telescope,
                "observer": issue_author,
                "start_utc": "",
                "end_utc": "",
                "status": "observed",
                "spectrum_url": "",
                "rms_mjy_per_1_km_s": "",
                "data_quality": target["data_quality"],
                "detection_status": target["detection_status"],
                "notes": notes,
            }
        )

    return rows


def render_expanded_issue(
    payload: dict[str, Any], issue_body: str, issue_author: str
) -> str:
    catalog = build_catalog(write_outputs=False)
    by_id = {target["target_id"]: target for target in catalog["targets"]}
    lines = [
        REPORT_MARKER,
        "",
        "<details>",
        "<summary>Compressed report data (used by the observing-report workflow)</summary>",
        "",
        "```anch0r-gzip",
        extract_encoded_report(issue_body),
        "```",
        "</details>",
        "",
        "## ANCH0R observing report",
        "",
        f"Telescope: {payload['telescope']} | Targets: {len(payload['targets'])}",
        f"Reported by: @{issue_author}",
        f"Prepared at: {payload['submitted_at_utc']}",
        "",
        "| Target | Data quality | Detection |",
        "| --- | --- | --- |",
    ]
    for entry in payload["targets"]:
        source_name = by_id[entry["target_id"]]["source_name"].replace("|", r"\|")
        quality = DATA_QUALITY_LABELS[entry["data_quality"]]
        detection = entry["detection_status"].capitalize()
        lines.append(
            f"| {source_name} | {quality} | {detection} |"
        )
    lines.extend(["", "### Notes", "", payload["notes"] or "(none)", ""])
    result = "\n".join(lines)
    if len(result.encode("utf-8")) > MAX_READABLE_REPORT_BYTES:
        raise ReportError("Readable report is too large; submit a smaller report part")
    return result


def process_report_issue(event_path: str | None, expanded_body_path: str | None = None) -> int:
    issue_number, issue_author, issue_body = parse_event(event_path)
    payload = extract_report_payload(issue_body)
    validate_payload(payload)

    prefix = f"ISSUE-{issue_number}-"
    current_rows = read_observation_rows()
    previous_by_target = {
        (row["target_id"], row["telescope"]): row
        for row in current_rows if row["observation_id"].startswith(prefix)
    }
    existing_rows = [
        row for row in current_rows if not row["observation_id"].startswith(prefix)
    ]
    new_rows = make_observation_rows(payload, issue_number, issue_author)
    # Reports do not own measurements and plots added after calibration.
    for row in new_rows:
        previous = previous_by_target.get((row["target_id"], row["telescope"]))
        if previous:
            for field in ("rms_mjy_per_1_km_s", "spectrum_url"):
                row[field] = previous[field]
    expanded_body = render_expanded_issue(payload, issue_body, issue_author)
    if expanded_body_path:
        Path(expanded_body_path).write_text(expanded_body, encoding="utf-8")
    write_observation_rows(existing_rows + new_rows)

    print(f"Processed observing report issue #{issue_number}: {len(new_rows)} targets")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-path", help="Path to the GitHub Actions event JSON payload")
    parser.add_argument("--expanded-body-path", help="Write a readable issue body to this path")
    args = parser.parse_args()

    try:
        return process_report_issue(args.event_path, args.expanded_body_path)
    except (CatalogError, ReportError) as exc:
        print(f"Observing report processing failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
