import datetime
import json
import tempfile
import unittest
from pathlib import Path

from shots_update import (
    apply_round,
    browser_version,
    collect,
    group_of,
    main,
    other_failures,
    parse_args,
    refresh_versions,
    round_name_of,
    write_round,
)


def put(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class CollectTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.base = self.tmp / "baselines"
        self.stage = self.tmp / "stage"
        self.results = self.tmp / "results"

    def test_changed_and_new_and_same(self) -> None:
        put(self.base / "A-1-板.png", b"old")
        put(self.base / "A-2-板.png", b"same")
        put(self.stage / "A-1-板.png", b"old")
        put(self.stage / "A-2-板.png", b"same")
        put(self.stage / "B-1-新.png", b"new")
        put(self.results / "t" / "A-1-板-expected.png", b"old")
        put(self.results / "t" / "A-1-板-actual.png", b"changed")
        put(self.results / "t" / "A-1-板-diff.png", b"diff")
        got = {c.name: c for c in collect(self.results, self.stage, self.base)}
        self.assertEqual(set(got), {"A-1-板.png", "B-1-新.png"})
        a = got["A-1-板.png"]
        assert a.before is not None and a.diff is not None
        self.assertEqual(a.before.read_bytes(), b"old")
        self.assertEqual(a.after.read_bytes(), b"changed")
        self.assertEqual(a.diff.read_bytes(), b"diff")
        b = got["B-1-新.png"]
        self.assertIsNone(b.before)
        self.assertIsNone(b.diff)
        self.assertEqual(b.after.read_bytes(), b"new")

    def test_nothing_changed(self) -> None:
        put(self.base / "A-1-板.png", b"x")
        put(self.stage / "A-1-板.png", b"x")
        self.assertEqual(collect(self.results, self.stage, self.base), [])


class RoundTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.base = self.tmp / "baselines"
        put(self.base / "A-1-板.png", b"old")
        put(self.base / "A-2-板.png", b"keep")
        stage = self.tmp / "stage"
        put(stage / "B-1-新.png", b"new")
        res = self.tmp / "results"
        put(res / "t" / "A-1-板-expected.png", b"old")
        put(res / "t" / "A-1-板-actual.png", b"changed")
        put(res / "t" / "A-1-板-diff.png", b"diff")
        self.changes = collect(res, stage, self.base)
        self.round = self.tmp / "review" / "m25-03-x"

    def test_group_has_before_after_diff_images(self) -> None:
        group = group_of(self.changes, "m25-03-x", "chromium-1243", "26.0")
        by_title = {i["title"]: i for i in group["items"]}
        changed = by_title["A-1-板.png"]
        self.assertEqual([im["cap"] for im in changed["images"]], ["前", "後", "差"])
        self.assertTrue(all(im["local"] for im in changed["images"]))
        self.assertEqual(
            [im["cap"] for im in by_title["B-1-新.png"]["images"]],
            ["後 (新しい基準画)"],
        )
        self.assertIn("chromium-1243", group["commit"])

    def test_approved_only_are_applied(self) -> None:
        group = group_of(self.changes, "m25-03-x", "chromium-1243", "26.0")
        write_round(self.changes, group, self.round)
        ids = {i["title"]: i["id"] for i in group["items"]}
        verdicts = {
            ids["A-1-板.png"]: {"verdict": "pass"},
            ids["B-1-新.png"]: {"verdict": "hold"},
        }
        applied = apply_round(self.round, self.base, verdicts, "chromium-1243", "26.0")
        self.assertEqual(applied, ["A-1-板.png"])
        self.assertEqual((self.base / "A-1-板.png").read_bytes(), b"changed")
        self.assertEqual((self.base / "A-2-板.png").read_bytes(), b"keep")
        self.assertFalse((self.base / "B-1-新.png").exists())
        versions = json.loads((self.base / "VERSIONS.json").read_text())
        self.assertEqual(versions, {"chromium": "chromium-1243", "macos": "26.0"})

    def test_unapproved_changes_nothing(self) -> None:
        group = group_of(self.changes, "m25-03-x", "chromium-1243", "26.0")
        write_round(self.changes, group, self.round)
        self.assertEqual(apply_round(self.round, self.base, {}, "c", "m"), [])
        self.assertEqual((self.base / "A-1-板.png").read_bytes(), b"old")
        self.assertFalse((self.base / "VERSIONS.json").exists())


def _report(*messages: str) -> dict:
    return {
        "suites": [
            {
                "specs": [],
                "suites": [
                    {
                        "specs": [
                            {
                                "title": "X-1: t",
                                "tests": [
                                    {
                                        "results": [
                                            {
                                                "errors": [
                                                    {"message": m} for m in messages
                                                ]
                                            }
                                        ]
                                    }
                                ],
                            }
                        ]
                    }
                ],
            }
        ]
    }


class OtherFailuresTest(unittest.TestCase):
    def test_screenshot_mismatches_and_missing_snapshots_are_not_other_failures(
        self,
    ) -> None:
        r = _report(
            "Error: expect(locator).toHaveScreenshot(expected) failed\n 2 pixels",
            "Error: A snapshot doesn't exist at x.png, writing actual.",
        )
        self.assertEqual(other_failures(r), [])

    def test_a_lens_or_timeout_error_is_reported_with_its_test(self) -> None:
        got = other_failures(_report("Error: Timeout 5000ms exceeded.\n detail"))
        self.assertEqual(got, ["X-1: t: Error: Timeout 5000ms exceeded."])


class VersionsTest(unittest.TestCase):
    def test_only_the_version_is_rewritten_when_it_changed(self) -> None:
        base = Path(tempfile.mkdtemp())
        put(base / "a.png", b"x")
        self.assertTrue(refresh_versions(base, "chromium-1", "26.0"))
        self.assertFalse(refresh_versions(base, "chromium-1", "26.0"))
        self.assertTrue(refresh_versions(base, "chromium-2", "26.0"))
        self.assertEqual(
            json.loads((base / "VERSIONS.json").read_text())["chromium"], "chromium-2"
        )
        self.assertEqual((base / "a.png").read_bytes(), b"x")


class ArgvTest(unittest.TestCase):
    def test_a_leading_double_dash_from_pnpm_is_ignored(self) -> None:
        with self.assertRaises(SystemExit) as e:
            main(["--", "--help"])
        self.assertEqual(e.exception.code, 0)


class RoundPrefixTest(unittest.TestCase):
    def test_the_round_prefix_defaults_to_shots(self) -> None:
        self.assertEqual(parse_args([]).round, "shots-")

    def test_the_round_prefix_is_taken_from_the_argument(self) -> None:
        self.assertEqual(parse_args(["--", "--round", "m25-14-"]).round, "m25-14-")

    def test_the_round_name_is_the_prefix_then_the_local_datetime(self) -> None:
        now = datetime.datetime(2026, 10, 4, 12, 30)
        self.assertEqual(round_name_of("m25-14-", now), "m25-14-20261004-1230")
        self.assertEqual(round_name_of("shots-", now), "shots-20261004-1230")

    def test_a_prefix_without_a_trailing_hyphen_gets_one(self) -> None:
        now = datetime.datetime(2026, 10, 4, 12, 30)
        self.assertEqual(round_name_of("m25-14", now), "m25-14-20261004-1230")


class BrowserVersionTest(unittest.TestCase):
    def test_reads_the_build_number_from_the_executable_path(self) -> None:
        path = "/Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-mac/headless_shell"
        self.assertEqual(browser_version(path), "chromium-1243")
        self.assertEqual(browser_version("/nowhere"), "unknown")


if __name__ == "__main__":
    unittest.main()
