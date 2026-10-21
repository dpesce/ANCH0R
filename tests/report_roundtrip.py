"""Verify browser-generated report links against the real Python processor."""

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from process_observing_report_issue import (
    extract_report_payload, make_observation_rows, render_expanded_issue, validate_payload,
)

fixture = json.load(sys.stdin)
expected = fixture["expected"]
restored = []
for index, body in enumerate(fixture["bodies"], 1):
    report = extract_report_payload(body)
    validate_payload(report)
    assert report["telescope"] == expected["telescope"]
    assert report["submitted_at_utc"] == expected["submitted_at_utc"]
    assert report["notes"] == expected["notes"]
    rows = make_observation_rows(report, 900000 + index, "test-observer")
    assert len(rows) == len(report["targets"])
    assert all(row["rms_mjy_per_1_km_s"] == "" for row in rows)
    assert all("rms_mjy_per_1_km_s" not in target for target in report["targets"])
    expanded = render_expanded_issue(report, body, "test-observer")
    assert extract_report_payload(expanded) == report
    assert len(expanded.encode("utf-8")) <= 60_000
    restored.extend([
        entry["target_id"], entry["data_quality"], entry["detection_status"],
    ] for entry in report["targets"])
assert restored == expected["targets"]
