import base64
import csv
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import process_observing_report_issue as processor
import build_catalog as catalog_builder


def body_for(payload=None, compressed=None):
    if compressed is None:
        compressed = gzip.compress(json.dumps(payload).encode("utf-8"))
    encoded = base64.urlsafe_b64encode(compressed).decode("ascii").rstrip("=")
    return f"{processor.REPORT_MARKER}\n\n```anch0r-gzip\n{encoded}\n```"


def compact_report():
    return {
        "v": 6, "t": "GBT", "at": "2026-10-20T01:29:00Z", "notes": "Clear sky.",
        "targets": [["galexascj00002", "trusted", "undetected"]],
    }


class ObservingReportTests(unittest.TestCase):
    def test_invalid_compressed_data_is_rejected(self):
        valid = gzip.compress(json.dumps(compact_report()).encode())
        for compressed in (b"invalid", valid[:-4], valid + b"trailing", valid + valid):
            with self.subTest(compressed=compressed[:10]):
                with self.assertRaises(processor.ReportError):
                    processor.extract_report_payload(body_for(compressed=compressed))

    def test_expansion_is_bounded_before_json_parsing(self):
        compressed = gzip.compress(b"x" * (processor.MAX_DECOMPRESSED_REPORT_BYTES + 1))
        with self.assertRaisesRegex(processor.ReportError, "exceeds"):
            processor.extract_report_payload(body_for(compressed=compressed))

    def test_invalid_assessments_and_duplicate_targets_are_rejected(self):
        variants = [
            ["galexascj00002", "excellent", "undetected"],
            ["galexascj00002", True, "undetected"],
            ["galexascj00002", "trusted", "maybe"],
            ["galexascj00002", "trusted", None],
            [None, "trusted", "undetected"],
        ]
        for row in variants:
            report = compact_report()
            report["targets"] = [row]
            with self.subTest(row=row):
                with self.assertRaises(processor.ReportError):
                    processor.validate_payload(processor.extract_report_payload(body_for(report)))
        report = compact_report()
        report["targets"] *= 2
        with self.assertRaisesRegex(processor.ReportError, "repeats"):
            processor.validate_payload(processor.extract_report_payload(body_for(report)))

    def test_unsupported_and_malformed_payloads_are_rejected(self):
        for payload in (
            [],
            {"v": 5},
            {"v": 6, "targets": [["incomplete"]]},
            {"v": 6, "targets": [["galexascj00002", 6.5, "trusted", "undetected"]]},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(processor.ReportError):
                    processor.extract_report_payload(body_for(payload))
        for field, value in (("notes", None), ("at", "2026-10-19"), ("t", "unknown")):
            report = compact_report()
            report[field] = value
            with self.assertRaises(processor.ReportError):
                processor.validate_payload(processor.extract_report_payload(body_for(report)))

    def test_issue_updates_are_idempotent_and_preserve_existing_observations(self):
        original = processor.OBSERVATIONS_FILE.read_text()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            observations = directory / "observations.csv"
            observations.write_text(original)
            event = directory / "event.json"
            event.write_text(json.dumps({"issue": {
                "number": 900001, "user": {"login": "test-observer"},
                "body": body_for(compact_report()),
            }}))
            expanded = directory / "expanded.md"
            with patch.object(processor, "OBSERVATIONS_FILE", observations):
                processor.process_report_issue(str(event), str(expanded))
                first = observations.read_text()
                processor.process_report_issue(str(event), str(expanded))
                self.assertEqual(first, observations.read_text())
                payload = processor.extract_report_payload(expanded.read_text())
                self.assertNotIn("rms_mjy_per_1_km_s", payload["targets"][0])
                self.assertNotIn("RMS", expanded.read_text())
            rows = list(csv.DictReader(first.splitlines()))
            old_rows = list(csv.DictReader(original.splitlines()))
            self.assertEqual(rows[:-1], old_rows)
            self.assertEqual(rows[-1]["observation_id"], "ISSUE-900001-001")
            self.assertEqual(rows[-1]["rms_mjy_per_1_km_s"], "")
            with patch.object(catalog_builder, "OBSERVATIONS_FILE", observations):
                catalog = catalog_builder.build_catalog(write_outputs=False)
            self.assertEqual(catalog["stats"]["observations"], len(old_rows) + 1)
            new_target = next(target for target in catalog["targets"]
                              if target["target_id"] == "galexascj00002")
            self.assertEqual(new_target["status"], "observed")
            self.assertEqual(new_target["detection_status"], "undetected")

    def test_issue_edits_preserve_calibration_by_target_and_telescope(self):
        catalog = catalog_builder.build_catalog(write_outputs=False)
        ids = [target["target_id"] for target in catalog["targets"]
               if target["eligible_gbt"]][:2]
        report = compact_report()
        report["targets"] = [[target_id, "trusted", "undetected"] for target_id in ids]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            observations = directory / "observations.csv"
            observations.write_text(processor.OBSERVATIONS_FILE.read_text())
            event = directory / "event.json"

            def submit():
                event.write_text(json.dumps({"issue": {
                    "number": 900003, "user": {"login": "test-observer"},
                    "body": body_for(report),
                }}))
                processor.process_report_issue(str(event))

            with patch.object(processor, "OBSERVATIONS_FILE", observations):
                submit()
                rows = processor.read_observation_rows()
                for index, row in enumerate(rows[-2:], 1):
                    row["rms_mjy_per_1_km_s"] = str(index + 3.5)
                    row["spectrum_url"] = f"/ANCH0R/spectra/calibrated-{index}.png"
                calibrated = {row["target_id"]: dict(row) for row in rows[-2:]}
                processor.write_observation_rows(rows)
                report["targets"].reverse()
                report["targets"][0][1] = "possible_pointing_problems"
                submit()
                for row in processor.read_observation_rows()[-2:]:
                    original = calibrated[row["target_id"]]
                    self.assertEqual(row["rms_mjy_per_1_km_s"], original["rms_mjy_per_1_km_s"])
                    self.assertEqual(row["spectrum_url"], original["spectrum_url"])
                self.assertEqual(processor.read_observation_rows()[-2]["data_quality"],
                                 "possible_pointing_problems")
                report["t"] = "SRT"
                submit()
                for row in processor.read_observation_rows()[-2:]:
                    self.assertEqual(row["rms_mjy_per_1_km_s"], "")
                    self.assertEqual(row["spectrum_url"], "")

    def test_unknown_target_does_not_write_observation_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            observations = directory / "observations.csv"
            observations.write_text(processor.OBSERVATIONS_FILE.read_text())
            before = observations.read_bytes()
            report = compact_report()
            report["targets"][0][0] = "unknown-galaxy"
            event = directory / "event.json"
            event.write_text(json.dumps({"issue": {
                "number": 900002, "user": {"login": "test-observer"},
                "body": body_for(report),
            }}))
            with patch.object(processor, "OBSERVATIONS_FILE", observations):
                with self.assertRaisesRegex(processor.ReportError, "Unknown target"):
                    processor.process_report_issue(str(event))
            self.assertEqual(observations.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
