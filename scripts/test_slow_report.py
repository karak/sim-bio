import contextlib
import io
import json
import re
import tempfile
import unittest
from pathlib import Path

from slow_report import (
    GROUPS,
    REST,
    Row,
    bins_of,
    check_partition,
    command_of,
    compare_rows,
    expected_of,
    format_clock,
    js_escape,
    observed_of,
    parse_args,
    pattern_of,
    render,
    rows_of,
    span_seconds,
)

ROOT = "/repo"
PLAY = f"{ROOT}/tests/slow/scenarios.playthrough.test.ts"
OBSERVE = f"{ROOT}/tests/slow/observe.scenes.test.ts"


def case(
    group: str,
    title: str,
    status: str = "passed",
    duration: float | None = 1000.0,
    failures: list[str] | None = None,
) -> dict:
    """vitest の JSON reporter の assertionResults の 1 件 (vitest 5.0.1 の形)"""
    return {
        "ancestorTitles": [group],
        "fullName": f"{group} {title}",
        "status": status,
        "title": title,
        "duration": duration,
        "failureMessages": failures or [],
        "meta": {},
        "tags": [],
    }


def report(*files: tuple[str, list[dict], int, int]) -> dict:
    return {
        "numTotalTests": sum(len(c) for _, c, _, _ in files),
        "startTime": 0,
        "success": True,
        "testResults": [
            {
                "name": name,
                "status": "passed",
                "message": "",
                "startTime": start,
                "endTime": end,
                "assertionResults": cases,
            }
            for name, cases, start, end in files
        ],
    }


class ExpectedTest(unittest.TestCase):
    def test_reads_the_verdict_after_the_arrow(self) -> None:
        self.assertEqual(expected_of("sinking: idle → dead"), "dead")
        self.assertEqual(
            expected_of("fire + trees (想定解 1) → alive"),
            "alive",
        )
        self.assertEqual(
            expected_of(
                "solution 1: 毎年 1 本植えて 20 年目に着工 → escaped (40 年目)"
            ),
            "escaped",
        )

    def test_reads_the_verdict_after_結末(self) -> None:
        self.assertEqual(
            expected_of("想定解 1 (植えて 20 年目に着工): 舟が育つ・結末 escaped"),
            "escaped",
        )

    def test_title_without_a_verdict_is_a_dash(self) -> None:
        self.assertEqual(
            expected_of("enrichment: too much rain kills the wolves (the trap)"), "—"
        )

    def test_scripted_intervention_reads_alive(self) -> None:
        self.assertEqual(expected_of("sinking: scripted intervention → alive"), "alive")


class ObservedTest(unittest.TestCase):
    def test_passed_test_saw_what_its_title_says(self) -> None:
        self.assertEqual(observed_of("passed", "dead", []), "dead")

    def test_passed_test_without_a_verdict_in_the_title_is_a_dash(self) -> None:
        self.assertEqual(observed_of("passed", "—", []), "—")

    def test_failed_test_reads_the_actual_verdict_from_the_assertion(self) -> None:
        message = (
            "AssertionError: 鹿が根付かない: expected 'alive' to be 'dead' // Object.is equality\n"
            "    at tests/slow/scenarios.playthrough.test.ts:145:31"
        )
        self.assertEqual(observed_of("failed", "dead", [message]), "alive")

    def test_timed_out_test_is_a_timeout(self) -> None:
        self.assertEqual(
            observed_of(
                "failed", "dead", ["Error: Test timed out in 600000ms.\nIf this"]
            ),
            "timeout",
        )

    def test_failed_test_with_another_error_is_a_question_mark(self) -> None:
        self.assertEqual(
            observed_of("failed", "alive", ["TypeError: x is undefined"]), "?"
        )

    def test_skipped_test_was_not_run(self) -> None:
        self.assertEqual(observed_of("skipped", "dead", []), "")


class RowsTest(unittest.TestCase):
    def test_rows_carry_the_file_relative_to_the_root_and_the_shard(self) -> None:
        data = report(
            (
                PLAY,
                [case("tower scenario v2 playthroughs (size 64)", "idle → dead")],
                0,
                1000,
            )
        )
        (row,) = rows_of(data, ROOT, shard="s1")
        self.assertEqual(
            row,
            Row(
                file="tests/slow/scenarios.playthrough.test.ts",
                group="tower scenario v2 playthroughs (size 64)",
                title="idle → dead",
                status="passed",
                expected="dead",
                observed="dead",
                seconds=1.0,
                shard="s1",
            ),
        )

    def test_missing_duration_counts_as_zero(self) -> None:
        data = report((PLAY, [case("g", "t → dead", "skipped", None)], 0, 0))
        self.assertEqual(rows_of(data, ROOT)[0].seconds, 0.0)

    def test_test_outside_any_describe_has_an_empty_group(self) -> None:
        raw = case("g", "t → dead")
        raw["ancestorTitles"] = []
        raw["fullName"] = "t → dead"
        (row,) = rows_of(report((PLAY, [raw], 0, 0)), ROOT)
        self.assertEqual(row.group, "")

    def test_span_is_first_start_to_last_end_over_files_that_ran_a_test(self) -> None:
        data = report(
            (PLAY, [case("g", "a → dead")], 1_000, 61_000),
            (OBSERVE, [case("h", "b → dead")], 2_000, 30_000),
        )
        self.assertEqual(span_seconds([data]), 60.0)

    def test_span_ignores_files_whose_tests_were_all_skipped(self) -> None:
        data = report(
            (PLAY, [case("g", "a → dead")], 5_000, 15_000),
            (OBSERVE, [case("h", "b → dead", "skipped")], 0, 0),
        )
        self.assertEqual(span_seconds([data]), 10.0)

    def test_span_of_nothing_is_zero(self) -> None:
        self.assertEqual(span_seconds([]), 0.0)


def row(title: str, status: str = "passed", shard: str = "", group: str = "g") -> Row:
    return Row(
        file="tests/slow/a.test.ts",
        group=group,
        title=title,
        status=status,
        expected=expected_of(title),
        observed=observed_of(status, expected_of(title), []),
        seconds=1.0,
        shard=shard,
    )


class PartitionTest(unittest.TestCase):
    def test_each_test_run_by_exactly_one_shard_is_clean(self) -> None:
        rows = [
            row("a → dead", "passed", "s1"),
            row("a → dead", "skipped", "s2"),
            row("b → alive", "skipped", "s1"),
            row("b → alive", "failed", "s2"),
        ]
        ran, duplicated, missing = check_partition(rows)
        self.assertEqual([r.title for r in ran], ["a → dead", "b → alive"])
        self.assertEqual(duplicated, [])
        self.assertEqual(missing, [])

    def test_a_test_run_by_two_shards_is_duplicated(self) -> None:
        rows = [row("a → dead", "passed", "s1"), row("a → dead", "passed", "s2")]
        ran, duplicated, missing = check_partition(rows)
        self.assertEqual(len(ran), 1)
        self.assertEqual(duplicated, ["tests/slow/a.test.ts > g > a → dead"])
        self.assertEqual(missing, [])

    def test_a_test_skipped_by_every_shard_is_missing(self) -> None:
        rows = [row("a → dead", "skipped", "s1"), row("a → dead", "skipped", "s2")]
        ran, _, missing = check_partition(rows)
        self.assertEqual(ran, [])
        self.assertEqual(missing, ["tests/slow/a.test.ts > g > a → dead"])

    def test_keeps_the_order_of_first_appearance(self) -> None:
        rows = [row("b → dead", "passed"), row("a → dead", "passed")]
        ran, _, _ = check_partition(rows)
        self.assertEqual([r.title for r in ran], ["b → dead", "a → dead"])


class PatternTest(unittest.TestCase):
    def test_js_escape_escapes_regex_specials_but_keeps_spaces_and_kana(self) -> None:
        self.assertEqual(
            js_escape("faith scenarios (M9-04, size 64)"),
            r"faith scenarios \(M9-04, size 64\)",
        )
        self.assertEqual(js_escape("観察画面の 4 場面"), "観察画面の 4 場面")
        self.assertEqual(
            js_escape("a.b*c+d?e^f$g{h}i|j[k]l\\m/n"),
            r"a\.b\*c\+d\?e\^f\$g\{h\}i\|j\[k\]l\\m\/n",
        )

    def test_group_pattern_anchors_at_the_describe_title(self) -> None:
        pattern = pattern_of(["tower scenario v2 playthroughs (size 64)"])
        self.assertEqual(pattern, r"^(?:tower scenario v2 playthroughs \(size 64\) )")
        js = re.compile(pattern)
        self.assertTrue(
            js.search("tower scenario v2 playthroughs (size 64) idle → dead")
        )
        self.assertFalse(
            js.search("intercept-tower scenario playthroughs (size 64) idle → dead")
        )

    def test_scenario_playthroughs_does_not_take_the_other_describes(self) -> None:
        js = re.compile(pattern_of(["scenario playthroughs (size 64)"]))
        self.assertTrue(
            js.search("scenario playthroughs (size 64) sinking: idle → dead")
        )
        self.assertFalse(
            js.search("sky-ship scenario playthroughs (size 64) idle → dead")
        )

    def test_rest_takes_everything_outside_the_named_groups(self) -> None:
        js = re.compile(pattern_of([REST]))
        names = [g for g, _ in GROUPS]
        for g in names:
            self.assertFalse(js.search(f"{g} x → dead"), g)
        self.assertTrue(js.search("a new scenario playthroughs (size 64) idle → dead"))
        self.assertTrue(js.search("top-level test outside describe"))

    def test_groups_and_rest_partition_any_name(self) -> None:
        bins = [[g for g, _ in GROUPS[:3]], [g for g, _ in GROUPS[3:]] + [REST]]
        patterns = [re.compile(pattern_of(b)) for b in bins]
        samples = [f"{g} x → dead" for g, _ in GROUPS] + ["new describe y → alive"]
        for name in samples:
            self.assertEqual(sum(1 for p in patterns if p.search(name)), 1, name)

    def test_no_group_title_is_a_prefix_of_another(self) -> None:
        names = [g for g, _ in GROUPS]
        for a in names:
            for b in names:
                if a != b:
                    self.assertFalse(b.startswith(a + " "), (a, b))


class BinsTest(unittest.TestCase):
    def test_one_job_runs_every_group_in_one_bin(self) -> None:
        bins = bins_of([("a", 3.0), ("b", 1.0)], 1)
        self.assertEqual(bins, [["a", "b", REST]])

    def test_longest_first_into_the_lightest_bin(self) -> None:
        bins = bins_of([("a", 10.0), ("b", 9.0), ("c", 6.0), ("d", 4.0)], 2)
        self.assertEqual(bins, [["a", "d", REST], ["b", "c"]])

    def test_more_jobs_than_groups_drops_empty_bins(self) -> None:
        bins = bins_of([("a", 2.0)], 4)
        self.assertEqual(bins, [["a"], [REST]])

    def test_rest_goes_to_the_lightest_bin(self) -> None:
        bins = bins_of([("a", 10.0), ("b", 3.0)], 2)
        self.assertEqual(bins, [["a"], ["b", REST]])

    def test_jobs_must_be_positive(self) -> None:
        with self.assertRaises(ValueError):
            bins_of([("a", 1.0)], 0)


class CommandTest(unittest.TestCase):
    def test_shard_command_is_a_vitest_run_with_a_name_pattern_and_json_out(
        self,
    ) -> None:
        cmd = command_of(
            "^(?:a )", Path("out/s1.json"), caffeinate="/usr/bin/caffeinate"
        )
        self.assertEqual(
            cmd,
            [
                "/usr/bin/caffeinate",
                "-ims",
                "pnpm",
                "exec",
                "vitest",
                "run",
                "-t",
                "^(?:a )",
                "--reporter=dot",
                "--reporter=json",
                "--outputFile.json=out/s1.json",
            ],
        )

    def test_without_caffeinate_runs_vitest_directly(self) -> None:
        cmd = command_of("^(?:a )", Path("o.json"), caffeinate=None)
        self.assertEqual(cmd[:4], ["pnpm", "exec", "vitest", "run"])


class RenderTest(unittest.TestCase):
    def rows(self) -> list[Row]:
        return [
            Row(
                "tests/slow/a.test.ts",
                "g1",
                "x: idle → dead",
                "passed",
                "dead",
                "dead",
                90.0,
                "s1",
            ),
            Row(
                "tests/slow/a.test.ts",
                "g2",
                "y → alive",
                "failed",
                "alive",
                "dead",
                30.0,
                "s2",
            ),
        ]

    def test_table_has_a_row_per_test_with_verdicts_and_seconds(self) -> None:
        text = render(self.rows(), wall=125.0, limit_minutes=30, label="lane")
        self.assertIn(
            "| 1 | g1 | x: idle → dead | dead | dead | pass | 90.0 | s1 |", text
        )
        self.assertIn(
            "| 2 | g2 | y → alive | alive | dead | **FAIL** | 30.0 | s2 |", text
        )

    def test_header_gives_counts_wall_clock_and_the_limit(self) -> None:
        text = render(self.rows(), wall=125.0, limit_minutes=30, label="lane")
        self.assertIn("# 通し実行 lane", text)
        self.assertIn("- 件数: 2 (pass 1、fail 1)", text)
        self.assertIn("- 合計の壁時計: 2:05 (125 s)。上限 30:00 の内", text)
        self.assertIn("- 試験の時間の和: 2:00 (120 s)", text)

    def test_load_average_at_start_and_end_is_given_when_known(self) -> None:
        text = render(
            self.rows(), wall=125.0, limit_minutes=30, label="lane", load=(1.5, 12.25)
        )
        self.assertIn("- 負荷 (1 分の load average): 始め 1.50、終わり 12.25", text)

    def test_load_line_is_left_out_when_unknown(self) -> None:
        text = render(self.rows(), wall=125.0, limit_minutes=30, label="lane")
        self.assertNotIn("負荷", text)

    def test_over_the_limit_is_said(self) -> None:
        text = render(self.rows(), wall=1900.0, limit_minutes=30, label="lane")
        self.assertIn("上限 30:00 を超えた", text)

    def test_group_summary_sums_seconds(self) -> None:
        text = render(self.rows(), wall=125.0, limit_minutes=30, label="lane")
        self.assertIn("| g1 | 1 | 1:30 |", text)
        self.assertIn("| g2 | 1 | 0:30 |", text)

    def test_partition_problems_are_listed(self) -> None:
        text = render(
            self.rows(),
            wall=1.0,
            limit_minutes=30,
            label="lane",
            duplicated=["f > g > t"],
            missing=["f > g > u"],
        )
        self.assertIn("- 二度回った: f > g > t", text)
        self.assertIn("- 回らなかった: f > g > u", text)

    def test_pipes_in_titles_are_escaped(self) -> None:
        rows = [Row("f", "g", "a|b → dead", "passed", "dead", "dead", 1.0, "")]
        text = render(rows, wall=1.0, limit_minutes=30, label="x")
        self.assertIn("a\\|b → dead", text)

    def test_format_clock(self) -> None:
        self.assertEqual(format_clock(0), "0:00")
        self.assertEqual(format_clock(59.6), "1:00")
        self.assertEqual(format_clock(3725), "1:02:05")


class CompareTest(unittest.TestCase):
    def test_same_verdicts_in_any_order_are_equal(self) -> None:
        a = [row("x → dead", "passed", "s1"), row("y → alive", "passed", "s1")]
        b = [row("y → alive", "passed", "s2"), row("x → dead", "passed", "s1")]
        self.assertEqual(compare_rows(a, b), [])

    def test_a_different_verdict_is_listed(self) -> None:
        a = [row("x → dead", "passed")]
        b = [row("x → dead", "failed")]
        self.assertEqual(
            compare_rows(a, b),
            ["tests/slow/a.test.ts > g > x → dead: dead/passed ≠ ?/failed"],
        )

    def test_a_test_on_one_side_only_is_listed(self) -> None:
        a = [row("x → dead"), row("y → dead")]
        b = [row("x → dead")]
        self.assertEqual(
            compare_rows(a, b),
            ["tests/slow/a.test.ts > g > y → dead: dead/passed ≠ (無し)"],
        )


class ArgsTest(unittest.TestCase):
    def test_report_takes_json_files_and_a_wall_clock(self) -> None:
        args = parse_args(["report", "a.json", "b.json", "--wall", "12.5"])
        self.assertEqual(args.command, "report")
        self.assertEqual(args.json, [Path("a.json"), Path("b.json")])
        self.assertEqual(args.wall, 12.5)

    def test_run_defaults_to_two_jobs(self) -> None:
        args = parse_args(["run"])
        self.assertEqual(args.command, "run")
        self.assertEqual(args.jobs, 2)
        self.assertEqual(args.limit_minutes, 30)


class EndToEndTest(unittest.TestCase):
    def test_report_command_reads_json_files_and_writes_markdown(self) -> None:
        from slow_report import main

        tmp = Path(tempfile.mkdtemp())
        a = tmp / "s1.json"
        a.write_text(
            json.dumps(
                report(
                    (
                        str(tmp / "tests/slow/x.test.ts"),
                        [case("g", "t → dead", "passed", 2000.0)],
                        0,
                        2000,
                    )
                )
            ),
            encoding="utf-8",
        )
        out = tmp / "slow.md"
        with contextlib.redirect_stdout(io.StringIO()):
            code = main(["report", str(a), "--root", str(tmp), "--out", str(out)])
        self.assertEqual(code, 0)
        text = out.read_text(encoding="utf-8")
        self.assertIn("| 1 | g | t → dead | dead | dead | pass | 2.0 | s1 |", text)
        self.assertIn("合計の壁時計: 0:02 (2 s)", text)

    def test_compare_command_reads_every_vitest_json_in_two_dirs(self) -> None:
        from slow_report import main

        tmp = Path(tempfile.mkdtemp())
        for name, shards in {
            "a": {"vitest": [case("g", "x → dead"), case("g", "y → alive")]},
            "b": {
                "s1": [case("g", "x → dead"), case("g", "y → alive", "skipped")],
                "s2": [case("g", "x → dead", "skipped"), case("g", "y → alive")],
            },
        }.items():
            (tmp / name).mkdir()
            (tmp / name / "shards.json").write_text("[]", encoding="utf-8")
            for shard, cases in shards.items():
                (tmp / name / f"{shard}.json").write_text(
                    json.dumps(report((str(tmp / "t.test.ts"), cases, 0, 1))),
                    encoding="utf-8",
                )
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(["compare", str(tmp / "a"), str(tmp / "b"), "--root", str(tmp)])
        self.assertEqual(code, 0)
        self.assertIn("2 件と 2 件を比べ、違い 0 件", out.getvalue())

    def test_report_command_fails_when_a_test_failed(self) -> None:
        from slow_report import main

        tmp = Path(tempfile.mkdtemp())
        a = tmp / "s1.json"
        a.write_text(
            json.dumps(
                report(
                    (str(tmp / "x.test.ts"), [case("g", "t → dead", "failed")], 0, 1)
                )
            ),
            encoding="utf-8",
        )
        with contextlib.redirect_stdout(io.StringIO()):
            code = main(
                ["report", str(a), "--root", str(tmp), "--out", str(tmp / "o.md")]
            )
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
