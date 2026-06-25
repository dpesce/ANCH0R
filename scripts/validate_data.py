#!/usr/bin/env python3
"""Validate ANCH0R catalog inputs without deploying the website."""

from __future__ import annotations

import sys
from collections import Counter

from build_catalog import CatalogError, build_catalog


def main() -> int:
    try:
        catalog = build_catalog(write_outputs=False)
    except CatalogError as exc:
        print(f"Catalog validation failed: {exc}", file=sys.stderr)
        return 1

    target_ids = [target["target_id"] for target in catalog["targets"]]
    duplicates = [
        target_id
        for target_id, count in Counter(target_ids).items()
        if count > 1
    ]
    if duplicates:
        print(
            "Catalog validation failed: duplicate target_id values: "
            + ", ".join(sorted(duplicates)),
            file=sys.stderr,
        )
        return 1

    print(f"Validated {len(target_ids)} targets")
    print(f"Status counts: {catalog['stats']['status_counts']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
