#!/usr/bin/env python3
"""Build the ANCH0R static catalog from version-controlled CSV inputs."""

from __future__ import annotations

import csv
import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

RAW_SOURCE_FILES = {
    "GBT": ROOT / "data" / "raw" / "source_list_GBT.txt",
    "SRT": ROOT / "data" / "raw" / "source_list_SRT.txt",
    "EFF": ROOT / "data" / "raw" / "source_list_Effelsberg.txt",
}

OBSERVATIONS_FILE = ROOT / "data" / "observations.csv"
MASTER_TARGETS_FILE = ROOT / "data" / "master_targets.csv"
PUBLIC_CATALOG_FILE = ROOT / "public" / "data" / "catalog.json"

TELESCOPE_LABELS = {
    "GBT": "Green Bank Telescope",
    "EFF": "Effelsberg 100m Telescope",
    "SRT": "Sardinia Radio Telescope",
}

RAW_FIELD_COUNT = 10
OBSERVATION_STATUSES = {
    "planned",
    "scheduled",
    "observed",
    "failed",
    "canceled",
    "cancelled",
}
class CatalogError(RuntimeError):
    """Raised when input data cannot be converted into a valid catalog."""


@dataclass(frozen=True)
class SourceRecord:
    telescope: str
    source_name: str
    list_label: str
    coordinate_system: str
    epoch: str
    ra_hms: str
    dec_dms: str
    velocity_frame: str
    velocity_convention: str
    velocity_km_s: float
    raw_flag: str
    line_number: int

    @property
    def ra_hours(self) -> float:
        return hms_to_hours(self.ra_hms)

    @property
    def ra_deg(self) -> float:
        return self.ra_hours * 15.0

    @property
    def dec_deg(self) -> float:
        return dms_to_degrees(self.dec_dms)

    @property
    def merge_key(self) -> tuple[str, str, str, str]:
        velocity_key = f"{self.velocity_km_s:.4f}"
        return (self.source_name, self.ra_hms, self.dec_dms, velocity_key)


def hms_to_hours(value: str) -> float:
    parts = value.split(":")
    if len(parts) != 3:
        raise CatalogError(f"Invalid RA value {value!r}; expected HH:MM:SS.s")
    hours, minutes, seconds = (float(part) for part in parts)

    if math.isclose(seconds, 60.0):
        seconds = 0.0
        minutes += 1.0
    if math.isclose(minutes, 60.0):
        minutes = 0.0
        hours += 1.0
    if math.isclose(hours, 24.0):
        hours = 0.0

    if not (0 <= hours < 24 and 0 <= minutes < 60 and 0 <= seconds < 60):
        raise CatalogError(f"RA value out of range: {value!r}")
    return hours + minutes / 60.0 + seconds / 3600.0


def dms_to_degrees(value: str) -> float:
    match = re.fullmatch(r"([+-])(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)", value)
    if not match:
        raise CatalogError(f"Invalid Dec value {value!r}; expected +/-DD:MM:SS.s")
    sign_text, degrees, minutes, seconds = match.groups()
    sign = -1.0 if sign_text == "-" else 1.0
    deg = float(degrees)
    minute = float(minutes)
    second = float(seconds)

    if math.isclose(second, 60.0):
        second = 0.0
        minute += 1.0
    if math.isclose(minute, 60.0):
        minute = 0.0
        deg += 1.0

    if not (0 <= deg <= 90 and 0 <= minute < 60 and 0 <= second < 60):
        raise CatalogError(f"Dec value out of range: {value!r}")
    if math.isclose(deg, 90.0) and (minute > 0 or second > 0):
        raise CatalogError(f"Dec value out of range: {value!r}")
    return sign * (deg + minute / 60.0 + second / 3600.0)


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "target"


def coordinate_slug(record: SourceRecord) -> str:
    ra = re.sub(r"[^0-9]", "", record.ra_hms)
    dec = record.dec_dms.replace("+", "p").replace("-", "m")
    dec = re.sub(r"[^a-zA-Z0-9]", "", dec)
    return f"ra{ra}-dec{dec}"


def read_source_list(telescope: str, path: Path) -> list[SourceRecord]:
    if not path.exists():
        raise CatalogError(f"Missing raw source list: {path}")

    records: list[SourceRecord] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        fields = [field.strip() for field in line.split(";")]
        if fields and fields[-1] == "":
            fields.pop()
        if len(fields) != RAW_FIELD_COUNT:
            raise CatalogError(
                f"{path}:{line_number} has {len(fields)} fields; expected {RAW_FIELD_COUNT}"
            )

        try:
            velocity = float(fields[8])
        except ValueError as exc:
            raise CatalogError(
                f"{path}:{line_number} has invalid velocity {fields[8]!r}"
            ) from exc

        record = SourceRecord(
            telescope=telescope,
            source_name=fields[0],
            list_label=fields[1],
            coordinate_system=fields[2],
            epoch=fields[3],
            ra_hms=fields[4],
            dec_dms=fields[5],
            velocity_frame=fields[6],
            velocity_convention=fields[7],
            velocity_km_s=velocity,
            raw_flag=fields[9],
            line_number=line_number,
        )
        hms_to_hours(record.ra_hms)
        dms_to_degrees(record.dec_dms)
        records.append(record)
    return records


def read_campaign_csv(path: Path, required_fields: list[str]) -> list[dict[str, str]]:
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        missing = [field for field in required_fields if field not in fieldnames]
        if missing:
            raise CatalogError(f"{path} is missing required columns: {', '.join(missing)}")

        rows: list[dict[str, str]] = []
        for index, row in enumerate(reader, 2):
            if None in row:
                raise CatalogError(f"{path}:{index} has too many comma-separated fields")
            cleaned = {
                key: (row.get(key) or "").strip()
                for key in fieldnames
                if key is not None
            }
            if not any(cleaned.values()):
                continue
            cleaned["_line_number"] = str(index)
            rows.append(cleaned)
        return rows


def build_targets(source_records: list[SourceRecord]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str, str], list[SourceRecord]] = defaultdict(list)
    for record in source_records:
        grouped[record.merge_key].append(record)

    merged_records = [
        sorted(records, key=lambda record: record.telescope)
        for _, records in sorted(
            grouped.items(),
            key=lambda item: (
                item[1][0].ra_hours,
                item[1][0].dec_deg,
                item[1][0].source_name,
            ),
        )
    ]

    base_ids = [slugify(records[0].source_name) for records in merged_records]
    base_counts = Counter(base_ids)
    used_ids: set[str] = set()

    targets: list[dict[str, Any]] = []
    for records, base_id in zip(merged_records, base_ids):
        canonical = records[0]
        target_id = base_id
        if base_counts[base_id] > 1:
            target_id = f"{base_id}-{coordinate_slug(canonical)}"
        if target_id in used_ids:
            raise CatalogError(f"Generated duplicate target_id {target_id!r}")
        used_ids.add(target_id)

        telescopes = sorted({record.telescope for record in records})
        raw_flags = {record.telescope: record.raw_flag for record in records}
        gbt_group = next(
            (record.list_label for record in records if record.telescope == "GBT"),
            "",
        )

        targets.append(
            {
                "target_id": target_id,
                "source_name": canonical.source_name,
                "ra_hms": canonical.ra_hms,
                "dec_dms": canonical.dec_dms,
                "ra_hours": round(canonical.ra_hours, 10),
                "ra_deg": round(canonical.ra_deg, 8),
                "dec_deg": round(canonical.dec_deg, 8),
                "velocity_km_s": canonical.velocity_km_s,
                "coordinate_system": canonical.coordinate_system,
                "epoch": canonical.epoch,
                "velocity_frame": canonical.velocity_frame,
                "velocity_convention": canonical.velocity_convention,
                "eligible_telescopes": telescopes,
                "eligible_gbt": "GBT" in telescopes,
                "eligible_eff": "EFF" in telescopes,
                "eligible_srt": "SRT" in telescopes,
                "gbt_group": gbt_group,
                "raw_flags": raw_flags,
                "status": "unobserved",
                "assigned_telescope": "",
                "spectrum_url": "",
                "notes": "",
                "observations_count": 0,
            }
        )

    return targets


def normalize_status(row: dict[str, str], path: Path, allowed: set[str]) -> str:
    status = row.get("status", "").strip().lower()
    if status not in allowed:
        line = row.get("_line_number", "?")
        raise CatalogError(
            f"{path}:{line} has invalid status {status!r}; "
            f"allowed values are {', '.join(sorted(allowed))}"
        )
    return status


def validate_telescope(row: dict[str, str], path: Path) -> str:
    telescope = row.get("telescope", "").strip().upper()
    if telescope not in TELESCOPE_LABELS:
        line = row.get("_line_number", "?")
        raise CatalogError(
            f"{path}:{line} has invalid telescope {telescope!r}; "
            f"allowed values are {', '.join(TELESCOPE_LABELS)}"
        )
    return telescope


def validate_datetime_order(row: dict[str, str], path: Path) -> None:
    start = row.get("start_utc", "")
    end = row.get("end_utc", "")
    if start and end and start >= end:
        line = row.get("_line_number", "?")
        raise CatalogError(f"{path}:{line} has start_utc >= end_utc")


def apply_campaign_state(
    targets: list[dict[str, Any]],
    observations: list[dict[str, str]],
) -> None:
    by_id = {target["target_id"]: target for target in targets}

    for row in observations:
        target_id = row.get("target_id", "")
        if target_id not in by_id:
            line = row.get("_line_number", "?")
            raise CatalogError(f"{OBSERVATIONS_FILE}:{line} references unknown target_id {target_id!r}")
        row["status"] = normalize_status(row, OBSERVATIONS_FILE, OBSERVATION_STATUSES)
        row["telescope"] = validate_telescope(row, OBSERVATIONS_FILE)
        if row["telescope"] not in by_id[target_id]["eligible_telescopes"]:
            line = row.get("_line_number", "?")
            raise CatalogError(
                f"{OBSERVATIONS_FILE}:{line} uses {row['telescope']} for target "
                f"{target_id!r}, but that target is not eligible for that telescope"
            )
        validate_datetime_order(row, OBSERVATIONS_FILE)

    observations_by_target: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in observations:
        observations_by_target[row["target_id"]].append(row)

    for target in targets:
        target_id = target["target_id"]
        target_observations = observations_by_target.get(target_id, [])

        observed_rows = [
            row for row in target_observations if row.get("status") == "observed"
        ]

        target["observations_count"] = len(observed_rows)
        if observed_rows:
            latest = sorted(
                observed_rows,
                key=lambda row: row.get("end_utc") or row.get("start_utc") or "",
            )[-1]
            target["status"] = "observed"
            target["assigned_telescope"] = latest.get("telescope", "")
            target["spectrum_url"] = latest.get("spectrum_url", "")
            target["notes"] = latest.get("notes", "")


def build_catalog(write_outputs: bool = True) -> dict[str, Any]:
    source_records: list[SourceRecord] = []
    raw_stats: dict[str, Any] = {}
    for telescope, path in RAW_SOURCE_FILES.items():
        records = read_source_list(telescope, path)
        source_records.extend(records)
        raw_stats[telescope] = {
            "path": str(path.relative_to(ROOT)),
            "rows": len(records),
            "unique_names": len({record.source_name for record in records}),
        }

    targets = build_targets(source_records)
    observations = read_campaign_csv(
        OBSERVATIONS_FILE,
        [
            "observation_id",
            "target_id",
            "telescope",
            "observer",
            "start_utc",
            "end_utc",
            "status",
            "spectrum_url",
            "notes",
        ],
    )

    apply_campaign_state(targets, observations)

    status_counts = Counter(target["status"] for target in targets)
    eligible_by_telescope = {
        telescope: sum(
            1 for target in targets if telescope in target["eligible_telescopes"]
        )
        for telescope in TELESCOPE_LABELS
    }
    overlap_counts = Counter("+".join(target["eligible_telescopes"]) for target in targets)

    catalog = {
        "schema_version": 1,
        "project": {
            "name": "ANCH0R",
            "description": "A multi-telescope 22 GHz spectral survey of nearby galaxies.",
        },
        "telescopes": TELESCOPE_LABELS,
        "stats": {
            "total_targets": len(targets),
            "raw_sources": raw_stats,
            "eligible_by_telescope": eligible_by_telescope,
            "status_counts": dict(sorted(status_counts.items())),
            "eligibility_overlap_counts": dict(sorted(overlap_counts.items())),
            "observations": len(observations),
        },
        "targets": targets,
        "observations": strip_private_fields(observations),
    }

    if write_outputs:
        write_catalog_outputs(catalog)

    return catalog


def strip_private_fields(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {key: value for key, value in row.items() if not key.startswith("_")}
        for row in rows
    ]


def write_catalog_outputs(catalog: dict[str, Any]) -> None:
    PUBLIC_CATALOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_CATALOG_FILE.write_text(
        json.dumps(catalog, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    MASTER_TARGETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "target_id",
        "source_name",
        "ra_hms",
        "dec_dms",
        "ra_deg",
        "dec_deg",
        "velocity_km_s",
        "eligible_gbt",
        "eligible_eff",
        "eligible_srt",
        "gbt_group",
        "status",
        "assigned_telescope",
        "spectrum_url",
        "observations_count",
        "notes",
    ]
    with MASTER_TARGETS_FILE.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for target in catalog["targets"]:
            writer.writerow({field: target.get(field, "") for field in fieldnames})


def print_summary(catalog: dict[str, Any]) -> None:
    stats = catalog["stats"]
    print(f"Built {stats['total_targets']} targets")
    print(f"Eligibility: {stats['eligible_by_telescope']}")
    print(f"Status: {stats['status_counts']}")
    print(f"Wrote {PUBLIC_CATALOG_FILE.relative_to(ROOT)}")
    print(f"Wrote {MASTER_TARGETS_FILE.relative_to(ROOT)}")


def main() -> int:
    try:
        catalog = build_catalog(write_outputs=True)
    except CatalogError as exc:
        print(f"Catalog build failed: {exc}", file=sys.stderr)
        return 1

    print_summary(catalog)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
