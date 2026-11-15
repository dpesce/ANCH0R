import base64
import gzip
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import process_pending_observing_reports as pending


TARGETS = {
    key: {"source_name": key.upper(), "eligible_telescopes": ["EFF", "SRT"]}
    for key in ("first", "second", "third")
}


def issue(number, *targets, telescope="EFF", state="open"):
    payload = {
        "v": 6,
        "t": telescope,
        "at": "2026-11-15T12:00:00Z",
        "notes": f"Notes for issue {number}.",
        "targets": [[key, "trusted", "undetected"] for key in targets],
    }
    blob = base64.urlsafe_b64encode(gzip.compress(json.dumps(payload).encode())).decode().rstrip("=")
    return {
        "number": number,
        "state": state,
        "title": pending.REPORT_TITLE,
        "user": {"login": "observer"},
        "body": f"{pending.REPORT_MARKER}\n\n{pending.COMPACT_PROMPT}\n\n```anch0r-gzip\n{blob}\n```",
    }


class CollectBatchTests(unittest.TestCase):
    def test_burst_and_split_reports_keep_issue_ids_and_target_order(self):
        part_one = issue(52, "third", "second")
        part_two = issue(54, "first", telescope="SRT")
        batch = pending.collect_batch([part_two, part_one, part_two], [], TARGETS)
        self.assertEqual(batch.reports, {52: 2, 54: 1})
        self.assertEqual(
            [(row["observation_id"], row["target_id"], row["telescope"]) for row in batch.rows],
            [("ISSUE-52-001", "third", "EFF"), ("ISSUE-52-002", "second", "EFF"),
             ("ISSUE-54-001", "first", "SRT")],
        )
        self.assertIn("Submitted via GitHub issue #52 by @observer.", batch.rows[0]["notes"])
        self.assertEqual(list(batch.expansions), [52, 54])
        self.assertIn("## ANCH0R observing report", batch.expansions[52][1])

    def test_merged_issue_is_not_reimported_or_corrected_from_its_body(self):
        old_issue = issue(48, "first")
        old_rows = pending.collect_batch([old_issue], [], TARGETS).rows
        old_rows[0].update(spectrum_url="/spectra/first.png", rms_mjy_per_1_km_s="1.2")
        edited = issue(48, "second")
        new = issue(50, "third")
        batch = pending.collect_batch([new, edited], old_rows, TARGETS)
        self.assertEqual(batch.reports, {50: 1})
        self.assertEqual(old_rows[0]["spectrum_url"], "/spectra/first.png")
        self.assertEqual(old_rows[0]["rms_mjy_per_1_km_s"], "1.2")
        self.assertFalse(pending.collect_batch([new, edited], old_rows + batch.rows, TARGETS).rows)

    def test_invalid_closed_and_non_report_issues_do_not_block_valid_rows(self):
        malformed = {**issue(52, "first"), "body": pending.REPORT_MARKER}
        unrelated = {**issue(56, "third"), "title": "Unrelated issue", "body": ""}
        linked_pr = {**issue(60, "third"), "pull_request": {}}
        issues = [issue(50, "second"), malformed, issue(54, "first", state="closed"),
                  unrelated, issue(58, "first", telescope="GBT"), linked_pr]
        batch = pending.collect_batch(issues, [], TARGETS)
        self.assertEqual(batch.reports, {50: 1})
        self.assertEqual(set(batch.rejected), {52, 58})

    def test_edited_issue_is_used_and_expanded_body_is_not_rewritten(self):
        original = issue(52, "first")
        edited = issue(52, "third")
        expanded = pending.collect_batch([edited], [], TARGETS).expansions[52][1]
        batch = pending.collect_batch([original, {**edited, "body": expanded}], [], TARGETS)
        self.assertEqual([row["target_id"] for row in batch.rows], ["third"])
        self.assertFalse(batch.expansions)


class PublishTests(unittest.TestCase):
    repo = "owner/repo"
    review_ref = f"refs/heads/{pending.BATCH_BRANCH}"
    pr = {
        "number": 101,
        "title": pending.TITLE,
        "body": "previous batch",
        "base": {"ref": "main"},
        "html_url": "https://github.com/owner/repo/pull/101",
    }

    def simulate(self, batch, open_prs, *, old_head="", parent="base", old_tree="old"):
        def git_command(*args):
            replies = {
                ("rev-parse", "HEAD"): "base",
                ("rev-parse", "FETCH_HEAD"): old_head,
                ("show", "-s", "--format=%P", old_head): parent,
                ("rev-parse", f"{old_head}^{{tree}}"): old_tree,
                ("write-tree",): "new",
            }
            return replies.get(args[1:], "") + "\n"

        def api_command(repo, resource, *args, method="GET", payload=None):
            if method == "GET":
                return open_prs
            return self.pr

        with (
            patch.object(pending, "command", side_effect=git_command) as git,
            patch.object(pending, "api", side_effect=api_command) as api,
            patch.object(pending, "remote_head", side_effect=lambda ref: old_head if ref == self.review_ref else "base"),
        ):
            pending.publish(self.repo, "main", batch)
        return [call.args for call in git.call_args_list], api.call_args_list

    def test_first_batch_creates_one_pr_and_pushes_only_review_branch(self):
        batch = pending.collect_batch([issue(52, "first")], [], TARGETS)
        git, api = self.simulate(batch, [])
        self.assertIn(("git", "push", f"--force-with-lease={self.review_ref}:", "origin", f"HEAD:{self.review_ref}"), git)
        self.assertEqual(api[-1].kwargs["method"], "POST")
        self.assertEqual(api[-1].kwargs["payload"]["head"], pending.BATCH_BRANCH)

    def test_next_batch_updates_existing_pr_with_lease(self):
        batch = pending.collect_batch([issue(52, "first"), issue(54, "second")], [], TARGETS)
        git, api = self.simulate(batch, [self.pr], old_head="old-head")
        self.assertIn(("git", "push", f"--force-with-lease={self.review_ref}:old-head", "origin", f"HEAD:{self.review_ref}"), git)
        self.assertEqual(api[-1].args, (self.repo, "pulls/101"))
        self.assertEqual(api[-1].kwargs["method"], "PATCH")
        self.assertIn("#52", api[-1].kwargs["payload"]["body"])
        self.assertIn("#54", api[-1].kwargs["payload"]["body"])

    def test_same_batch_and_base_do_not_repush_or_reset_checks(self):
        batch = pending.collect_batch([issue(52, "first")], [], TARGETS)
        original = {**self.pr, "body": "Review the appended rows in `data/observations.csv` before merging.\n\n" + batch.summary()}
        git, api = self.simulate(batch, [original], old_head="old-head", old_tree="new")
        self.assertFalse(any(command[1] == "push" for command in git))
        self.assertEqual(len(api), 1)

    def test_same_data_on_a_new_base_refreshes_review_branch(self):
        batch = pending.collect_batch([issue(52, "first")], [], TARGETS)
        git, _ = self.simulate(batch, [self.pr], old_head="old-head", parent="older", old_tree="new")
        self.assertTrue(any(command[1] == "push" for command in git))

    def test_empty_batch_closes_stale_pr_without_pushing(self):
        git, api = self.simulate(pending.Batch(), [self.pr])
        self.assertFalse(any(command[1] == "push" for command in git))
        self.assertEqual(api[-1].kwargs, {"method": "PATCH", "payload": {"state": "closed"}})

    def test_main_advancing_aborts_before_mutating_remote(self):
        with (
            patch.object(pending, "command", return_value="old-base\n") as git,
            patch.object(pending, "api", return_value=[]) as api,
            patch.object(pending, "remote_head", return_value="new-base"),
        ):
            with self.assertRaisesRegex(pending.ReportError, "Default branch advanced"):
                pending.publish(self.repo, "main", pending.Batch())
        self.assertEqual(git.call_count, 1)
        self.assertEqual(api.call_count, 1)

    def test_api_writes_json_on_stdin(self):
        with patch.object(pending, "command", return_value='{"number": 101}') as command:
            result = pending.api(self.repo, "pulls/101", method="PATCH", payload={"state": "closed"})
        self.assertEqual(result["number"], 101)
        self.assertEqual(command.call_args.args[-2:], ("--input", "-"))
        self.assertEqual(json.loads(command.call_args.kwargs["stdin"]), {"state": "closed"})

    def test_expansion_skips_issue_changed_since_snapshot(self):
        with patch.object(pending, "api", return_value={"state": "open", "body": "edited"}) as api:
            pending.expand_reports(self.repo, {52: ("original", "expanded")})
        api.assert_called_once_with(self.repo, "issues/52")


if __name__ == "__main__":
    unittest.main()
