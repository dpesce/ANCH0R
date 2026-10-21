from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_catalog import CatalogError, validate_observation_assessment


def observed_row(rms=""):
    return {
        "status": "observed",
        "rms_mjy_per_1_km_s": rms,
        "data_quality": "trusted",
        "detection_status": "undetected",
    }


class ObservationAssessmentTests(unittest.TestCase):
    def test_observed_data_can_omit_rms(self):
        row = observed_row()
        validate_observation_assessment(row, Path("observations.csv"))
        self.assertEqual(row["rms_mjy_per_1_km_s"], "")

    def test_calibrated_rms_is_accepted_and_preserved(self):
        for rms in ("0", "3.8", "6.5"):
            with self.subTest(rms=rms):
                row = observed_row(rms)
                validate_observation_assessment(row, Path("observations.csv"))
                self.assertEqual(row["rms_mjy_per_1_km_s"], rms)

    def test_invalid_rms_is_still_rejected_when_present(self):
        for rms in ("-1", "nan", "inf", "not a number"):
            with self.subTest(rms=rms):
                with self.assertRaises(CatalogError):
                    validate_observation_assessment(observed_row(rms), Path("observations.csv"))

    def test_quality_and_detection_are_still_required(self):
        for field in ("data_quality", "detection_status"):
            with self.subTest(field=field):
                row = observed_row()
                row[field] = ""
                with self.assertRaises(CatalogError):
                    validate_observation_assessment(row, Path("observations.csv"))


if __name__ == "__main__":
    unittest.main()
