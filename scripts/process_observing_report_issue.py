#!/usr/bin/env python3
"""Convert an ANCH0R observing-report issue into observation CSV rows."""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from build_catalog import CatalogError, build_catalog


ROOT = Path(__file__).resolve().parents[1]
OBSERVATIONS_FILE = ROOT / "data" / "observations.csv"

REPORT_MARKER = "<!-- ANCH0R_OBSERVING_REPORT_V3 -->"
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
VALID_DATA_QUALITY = {"excellent", "good", "fair", "poor", "unobserved"}
VALID_DETECTION_STATUSES = {"detected", "marginal", "undetected"}


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


def extract_report_payload(body: str) -> dict[str, Any]:
    if REPORT_MARKER not in body:
        raise ReportError("Issue body does not contain an ANCH0R observing-report marker")

    match = re.search(r"```json\s*([\s\S]*?)\s*```", body)
    if not match:
        raise ReportError("Issue body does not contain a JSON payload block")

    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise ReportError(f"Report JSON is invalid: {exc}") from exc

    if not isinstance(payload, dict):
        raise ReportError("Report JSON payload must be an object")
    return payload


def parse_utc(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ReportError(f"{field} must be an ISO UTC timestamp ending in Z")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReportError(f"{field} is not a valid ISO UTC timestamp") from exc


def validate_payload(payload: dict[str, Any]) -> None:
    if payload.get("schema_version") != 3:
        raise ReportError("Unsupported report schema_version")

    parse_utc(payload.get("submitted_at_utc"), "submitted_at_utc")

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
        target_id = compact_text(target.get("target_id"))
        if not target_id:
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
        rms = target.get("rms_mjy_per_1_km_s")
        if data_quality == "unobserved":
            if detection_status not in {"", None} or (
                rms is not None and rms != ""
            ):
                raise ReportError(
                    f"targets[{index}] cannot provide RMS or detection status "
                    "when data_quality is 'unobserved'"
                )
            continue

        if (
            not isinstance(detection_status, str)
            or detection_status not in VALID_DETECTION_STATUSES
        ):
            raise ReportError(
                f"targets[{index}] has invalid detection_status "
                f"{detection_status!r}"
            )
        if isinstance(rms, bool) or not isinstance(rms, (int, float)):
            raise ReportError(
                f"targets[{index}] rms_mjy_per_1_km_s must be numeric"
            )
        if not math.isfinite(rms) or rms < 0:
            raise ReportError(
                f"targets[{index}] rms_mjy_per_1_km_s must be finite and non-negative"
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

        data_quality = target["data_quality"]
        unobserved = data_quality == "unobserved"
        rows.append(
            {
                "observation_id": f"ISSUE-{issue_number}-{index:03d}",
                "target_id": target_id,
                "telescope": telescope,
                "observer": issue_author,
                "start_utc": "",
                "end_utc": "",
                "status": "failed" if unobserved else "observed",
                "spectrum_url": "",
                "rms_mjy_per_1_km_s": (
                    "" if unobserved else str(target["rms_mjy_per_1_km_s"])
                ),
                "data_quality": data_quality,
                "detection_status": (
                    "" if unobserved else target["detection_status"]
                ),
                "notes": notes,
            }
        )

    return rows


def process_report_issue(event_path: str | None) -> int:
    issue_number, issue_author, issue_body = parse_event(event_path)
    payload = extract_report_payload(issue_body)
    validate_payload(payload)

    prefix = f"ISSUE-{issue_number}-"
    existing_rows = [
        row for row in read_observation_rows() if not row["observation_id"].startswith(prefix)
    ]
    new_rows = make_observation_rows(payload, issue_number, issue_author)
    write_observation_rows(existing_rows + new_rows)

    print(f"Processed observing report issue #{issue_number}: {len(new_rows)} targets")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-path", help="Path to the GitHub Actions event JSON payload")
    args = parser.parse_args()

    try:
        return process_report_issue(args.event_path)
    except (CatalogError, ReportError) as exc:
        print(f"Observing report processing failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
