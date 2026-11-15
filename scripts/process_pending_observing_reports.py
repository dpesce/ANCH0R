#!/usr/bin/env python3
"""Refresh the single observing-report review PR from open issues and main."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from build_catalog import CatalogError, build_catalog
from process_observing_report_issue import (
    REPORT_MARKER,
    ReportError,
    extract_report_payload,
    make_observation_rows,
    read_observation_rows,
    render_expanded_issue,
    validate_payload,
    write_observation_rows,
)


BATCH_BRANCH = "observing-report/pending"
TITLE = "Add pending ANCH0R observing reports"
CATALOG_FILES = ("data/observations.csv", "data/master_targets.csv", "public/data/catalog.json")
REPORT_TITLE = "[ANCH0R Observing Report]"
COMPACT_PROMPT = "Click Create to submit. GitHub Actions will decode the report and add a readable summary here."
LABEL = "observing-report"


@dataclass
class Batch:
    rows: list[dict[str, str]] = field(default_factory=list)
    reports: dict[int, int] = field(default_factory=dict)
    rejected: dict[int, str] = field(default_factory=dict)
    expansions: dict[int, tuple[str, str]] = field(default_factory=dict)

    def summary(self) -> str:
        lines = [f"Pending reports: **{len(self.reports)}**; new observations: **{len(self.rows)}**."]
        if self.reports:
            lines += ["", *(f"- #{number}: {count} observation(s)" for number, count in self.reports.items())]
        if self.rejected:
            links = ", ".join(f"#{number}" for number in self.rejected)
            lines += ["", f"Invalid reports excluded: {links}. See the workflow log for details."]
        return "\n".join(lines) + "\n"


def collect_batch(issues, existing_rows, targets_by_id) -> Batch:
    imported = {
        int(match[1])
        for row in existing_rows
        if (match := re.fullmatch(r"ISSUE-(\d+)-\d+", row["observation_id"]))
    }
    batch = Batch()
    # Pagination or a concurrent issue edit must not yield duplicate rows.
    unique = {issue["number"]: issue for issue in issues}
    for number, issue in sorted(unique.items()):
        if issue["state"] != "open" or "pull_request" in issue or number in imported:
            continue
        body = issue["body"] or ""
        if REPORT_MARKER not in body and not issue["title"].startswith(REPORT_TITLE):
            continue
        try:
            payload = extract_report_payload(body)
            validate_payload(payload)
            author = issue["user"]["login"]
            rows = make_observation_rows(payload, number, author, targets_by_id=targets_by_id)
            # Do not overwrite prose in issues that were already expanded.
            if COMPACT_PROMPT in body and "\n## ANCH0R observing report\n" not in body:
                expanded = render_expanded_issue(payload, body, author, targets_by_id=targets_by_id)
                expanded.encode("utf-8")
                batch.expansions[number] = body, expanded
            for row in rows:
                row["notes"].encode("utf-8")
        except (ReportError, ValueError, RecursionError) as error:
            batch.rejected[number] = str(error)
            batch.expansions.pop(number, None)
            continue
        batch.reports[number] = len(rows)
        batch.rows.extend(rows)
    return batch


def command(*args, stdin=None) -> str:
    return subprocess.run(args, input=stdin, text=True, stdout=subprocess.PIPE, check=True).stdout


def api(repo, resource, *args, method="GET", payload=None):
    return json.loads(command(
        "gh", "api", "--method", method, f"repos/{repo}/{resource}", *args,
        *(("--input", "-") if payload is not None else ()),
        stdin=json.dumps(payload) if payload is not None else None,
    ))


def remote_head(ref: str) -> str:
    result = command("git", "ls-remote", "--heads", "origin", ref).strip()
    return result.split("\t", 1)[0] if result else ""


def publish(repo: str, default_branch: str, batch: Batch) -> str:
    base_ref = f"refs/heads/{default_branch}"
    review_ref = f"refs/heads/{BATCH_BRANCH}"
    prs = api(repo, "pulls", "-f", "state=open", "-f", f"head={repo.split('/')[0]}:{BATCH_BRANCH}")
    if len(prs) > 1 or any(pr["base"]["ref"] != default_branch for pr in prs):
        raise ReportError(f"Unexpected open PRs from {BATCH_BRANCH}")
    pr = prs[0] if prs else None
    base = command("git", "rev-parse", "HEAD").strip()
    if remote_head(base_ref) != base:
        raise ReportError("Default branch advanced during reconciliation; retry with Run workflow.")

    if not batch.rows:
        if pr:
            api(repo, f"pulls/{pr['number']}", method="PATCH", payload={"state": "closed"})
        return "No pending valid observations to publish."

    command("git", "add", "--", *CATALOG_FILES)
    old_head = remote_head(review_ref)
    if old_head:
        command("git", "fetch", "--no-tags", "origin", review_ref)
        if command("git", "rev-parse", "FETCH_HEAD").strip() != old_head:
            raise ReportError("Review branch advanced during reconciliation; retry with Run workflow.")
    unchanged = (
        old_head
        and command("git", "show", "-s", "--format=%P", old_head).strip() == base
        and command("git", "rev-parse", f"{old_head}^{{tree}}").strip()
        == command("git", "write-tree").strip()
    )
    if not unchanged:
        command(
            "git", "-c", "user.name=github-actions[bot]",
            "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
            "commit", "-m", TITLE,
        )
        if remote_head(base_ref) != base:
            raise ReportError("Default branch advanced during reconciliation; retry with Run workflow.")
        command("git", "push", f"--force-with-lease={review_ref}:{old_head}", "origin", f"HEAD:{review_ref}")

    body = "Review the appended rows in `data/observations.csv` before merging.\n\n" + batch.summary()
    fields = {"title": TITLE, "body": body}
    if pr:
        if any(pr[key] != value for key, value in fields.items()):
            api(repo, f"pulls/{pr['number']}", method="PATCH", payload=fields)
        return pr["html_url"]
    compare = f"https://github.com/{repo}/compare/{default_branch}...{BATCH_BRANCH}?expand=1"
    try:
        created = api(repo, "pulls", method="POST", payload={
            **fields, "base": default_branch, "head": BATCH_BRANCH,
        })
    except subprocess.CalledProcessError as error:
        raise ReportError(f"Could not create the review PR. Open it manually at {compare}") from error
    return created["html_url"]


def expand_reports(repo, expansions):
    for number, (original, expanded) in expansions.items():
        issue = api(repo, f"issues/{number}")
        if issue["state"] != "open" or issue["body"] != original:
            continue
        labels = [label["name"] for label in issue["labels"]]
        if LABEL not in labels:
            api(repo, f"issues/{number}/labels", method="POST", payload={"labels": [LABEL]})
        api(repo, f"issues/{number}", method="PATCH", payload={"body": expanded})


def main() -> int:
    repo = os.environ["GITHUB_REPOSITORY"]
    default_branch = os.environ["DEFAULT_BRANCH"]
    pages = api(repo, "issues", "--paginate", "--slurp", "-f", "state=open", "-f", "per_page=100")
    existing = read_observation_rows()
    catalog = build_catalog(write_outputs=False)
    targets = {target["target_id"]: target for target in catalog["targets"]}
    batch = collect_batch((issue for page in pages for issue in page), existing, targets)
    for number, error in batch.rejected.items():
        print(f"Invalid report #{number} skipped: {error!r}", file=sys.stderr)
    if batch.rows:
        write_observation_rows(existing + batch.rows)
        build_catalog()
    summary = batch.summary()
    if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary_path).open("a", encoding="utf-8") as handle:
            handle.write(summary)
    print(summary)
    print(publish(repo, default_branch, batch))
    expand_reports(repo, batch.expansions)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (CatalogError, ReportError, subprocess.CalledProcessError) as error:
        print(f"Observing report batch failed: {error}", file=sys.stderr)
        sys.exit(1)
