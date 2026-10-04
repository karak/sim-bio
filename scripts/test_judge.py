import contextlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import ClassVar
from unittest import mock

from acceptance import check_results, load
from judge import (
    PlanItem,
    Question,
    StepRef,
    StepResult,
    Vote,
    apply_results,
    digest_of,
    has_pixel_baseline,
    image_result,
    images_of,
    main,
    parse_output,
    prompt_of,
    questions_of,
    records_pass,
    run,
    run_claude,
    select_steps,
    shot_numbers,
    tally,
    writes_pass,
)

Q = [Question("Q1", "ピンが見える"), Question("Q2", "文が読める")]


def answer(a1="yes", a2="yes", ev="左上に見える"):
    return json.dumps(
        {
            "total_cost_usd": 0.02,
            "duration_ms": 9000,
            "modelUsage": {"claude-sonnet-x": {}},
            "structured_output": {
                "image": "x.png",
                "answers": [
                    {"id": "Q1", "answer": a1, "evidence": ev},
                    {"id": "Q2", "answer": a2, "evidence": ev},
                ],
            },
        }
    )


def vote(a1="yes", a2="yes"):
    return parse_output(answer(a1, a2), Q)


def scenario(id_="SEL-003", mode="auto", steps=None, **over):
    row = {
        "kind": "scenario",
        "id": id_,
        "status": "active",
        "mode": mode,
        "title": "t",
        "tickets": ["M19-09"],
        "from": [],
        "steps": steps
        or [
            ["前提", "開いている"],
            ["もし", "選ぶ"],
            [
                "ならば",
                "【見た目】画 1: 琥珀のピンで、どこを選んだか分かる",
                {"judge": "llm"},
            ],
            ["かつ", "【見た目】画 2: 縁の帯が地形に沿う", {"judge": "human"}],
        ],
        "covered_by": [{"file": "a", "title": "b"}],
    }
    row.update(over)
    return row


CODE = {"kind": "code", "code": "SEL", "name": "選ぶ", "background": []}


def sot_of(*rows):
    sot, problems = load(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    )
    assert not problems
    return sot


class ParseTest(unittest.TestCase):
    def test_reads_answers_cost_time_and_model(self):
        v = parse_output(answer("yes", "no", "中央に文"), Q)
        self.assertEqual(
            v.answers, {"Q1": ("yes", "中央に文"), "Q2": ("no", "中央に文")}
        )
        self.assertEqual(
            (v.cost_usd, v.duration_ms, v.model), (0.02, 9000, "claude-sonnet-x")
        )

    def test_a_broken_reply_is_a_vote_with_an_error_not_an_exception(self):
        for bad in [
            "not json",
            "[]",
            json.dumps({"is_error": True, "result": "x"}),
            json.dumps({}),
        ]:
            v = parse_output(bad, Q)
            self.assertIsNone(v.answers, bad)
            self.assertTrue(v.error, bad)

    def test_a_question_left_unanswered_fails_the_vote(self):
        doc = json.loads(answer())
        del doc["structured_output"]["answers"][1]
        v = parse_output(json.dumps(doc), Q)
        self.assertIsNone(v.answers)
        self.assertIn("Q2", v.error)

    def test_an_answer_other_than_yes_or_no_is_not_an_answer(self):
        self.assertIsNone(parse_output(answer("maybe", "yes"), Q).answers)


class TallyTest(unittest.TestCase):
    def outcomes(self, votes):
        return {r.question.id: r.outcome for r in tally(Q, votes)}

    def test_three_yes_is_yes_and_three_no_is_no(self):
        self.assertEqual(
            self.outcomes([vote("yes", "no")] * 3), {"Q1": "yes", "Q2": "no"}
        )

    def test_a_2_1_vote_is_split_either_way(self):
        self.assertEqual(
            self.outcomes([vote("no"), vote("no"), vote("yes")])["Q1"], "split"
        )
        self.assertEqual(
            self.outcomes([vote("yes"), vote("yes"), vote("no")])["Q1"], "split"
        )

    def test_a_failed_call_never_counts_as_yes(self):
        failed = Vote(None, error="timeout")
        res = tally(Q, [vote(), vote(), failed])
        self.assertEqual({r.outcome for r in res}, {"split"})
        self.assertEqual(res[0].votes, ("yes", "yes", "error"))
        self.assertEqual(res[0].evidence[2], "timeout")

    def test_all_calls_failing_is_split_not_no(self):
        res = tally(Q, [Vote(None, error="x")] * 3)
        self.assertEqual({r.outcome for r in res}, {"split"})


class StepVerdictTest(unittest.TestCase):
    def step(self, votes, baseline=False):
        img = image_result(Q, Path("SEL-003-1.png"), votes, pixel_baseline=baseline)
        return StepResult(StepRef("SEL-003", 3, "t"), (img,))

    def test_no_beats_split_beats_yes(self):
        self.assertEqual(self.step([vote("no")] * 3).verdict, "fail")
        self.assertEqual(self.step([vote(), vote(), vote("no")]).verdict, "undecided")
        self.assertEqual(self.step([vote()] * 3).verdict, "yes")
        self.assertEqual(
            self.step([vote("yes", "no"), vote("yes", "no"), vote("no", "no")]).verdict,
            "fail",
        )

    def test_an_image_with_a_pixel_baseline_is_never_passed_by_the_llm(self):
        self.assertTrue(writes_pass(self.step([vote()] * 3)))
        self.assertFalse(writes_pass(self.step([vote()] * 3, baseline=True)))
        self.assertFalse(writes_pass(self.step([vote("no")] * 3)))


class SelectionTest(unittest.TestCase):
    sot = sot_of(CODE, scenario())

    def test_default_is_the_steps_the_sot_marks_llm(self):
        got = select_steps(self.sot, [])
        self.assertEqual([s.key for s in got], ["SEL-003/3"])

    def test_no_llm_step_means_nothing_to_judge(self):
        none = sot_of(
            CODE,
            scenario(
                steps=[["前提", "a"], ["ならば", "【見た目】b", {"judge": "human"}]]
            ),
        )
        self.assertEqual(select_steps(none, []), [])

    def test_step_spec_reaches_any_step_even_a_human_one(self):
        got = select_steps(self.sot, ["SEL-003/4"])
        self.assertEqual(
            (got[0].key, got[0].text),
            ("SEL-003/4", "【見た目】画 2: 縁の帯が地形に沿う"),
        )

    def test_bad_specs_are_refused(self):
        for bad in ["SEL-003", "SEL-003/9", "SEL-003/0", "XXX-001/1", "sel/1"]:
            with self.assertRaises(ValueError, msg=bad):
                select_steps(self.sot, [bad])


class ImagesTest(unittest.TestCase):
    shots: ClassVar = {
        "SEL-003": ("shots/SEL-003-1.png", "shots/SEL-003-2.png", "shots/SEL-003-3.png")
    }

    def test_shot_numbers_read_single_ranges_and_lists(self):
        self.assertEqual(shot_numbers("画 1: a"), {1})
        self.assertEqual(shot_numbers("画 1〜3: a"), {1, 2, 3})
        self.assertEqual(shot_numbers("画 1 (新しい島)・画 3 (離れる): a"), {1, 3})
        self.assertEqual(shot_numbers("島が見える"), frozenset())

    def test_a_step_takes_the_shots_it_names_else_all_of_the_row(self):
        root = Path("/acc/shots")
        named = images_of(StepRef("SEL-003", 3, "画 2: x"), self.shots, root)
        self.assertEqual([p.name for p in named], ["SEL-003-2.png"])
        every = images_of(StepRef("SEL-003", 3, "x"), self.shots, root)
        self.assertEqual(len(every), 3)
        self.assertEqual(every[0], Path("/acc/shots/SEL-003-1.png"))

    def test_pixel_baseline_is_the_elements_of_that_shot(self):
        with tempfile.TemporaryDirectory() as t:
            base = Path(t)
            (base / "SEL-003-1-セルの詳細.png").write_bytes(b"x")
            self.assertTrue(has_pixel_baseline(Path("a/SEL-003-1.png"), base))
            self.assertFalse(has_pixel_baseline(Path("a/SEL-003-2.png"), base))
            self.assertFalse(has_pixel_baseline(Path("a/SEL-003-1.png"), base / "none"))


class QuestionsTest(unittest.TestCase):
    def test_default_is_one_yes_no_question_made_of_the_step_sentence(self):
        qs = questions_of(
            StepRef("SEL-003", 3, "【見た目】画 1: 琥珀のピンで分かる"), {}
        )
        self.assertEqual(len(qs), 1)
        self.assertIn("琥珀のピンで分かる", qs[0].text)
        self.assertNotIn("【見た目】", qs[0].text)
        self.assertNotIn("画 1:", qs[0].text)

    def test_rubrics_json_replaces_the_default(self):
        qs = questions_of(StepRef("A-001", 2, "x"), {})
        rubric = {"SEL-003/3": [{"id": "Q1", "q": "ピンが見える"}]}
        got = questions_of(StepRef("SEL-003", 3, "x"), rubric)
        self.assertEqual(got, [Question("Q1", "ピンが見える")])
        self.assertEqual(len(qs), 1)

    def test_the_prompt_fixes_language_and_names_the_image(self):
        p = prompt_of(Q, Path("/a/b.png"))
        self.assertIn("日本語", p)
        self.assertIn("- Q1: ピンが見える", p)
        self.assertTrue(p.endswith("画像ファイル: /a/b.png"))


def results_of(votes, key_n=3, scenario_id="SEL-003"):
    img = image_result(Q, Path("SEL-003-1.png"), votes, pixel_baseline=False)
    return StepResult(StepRef(scenario_id, key_n, "t"), (img,))


NOW = {"at": "2026-10-01T00:00:00Z", "cli": "2.1.285", "model": "m"}


class WriteTest(unittest.TestCase):
    def test_fail_and_undecided_are_written_in_the_results_shape(self):
        out, skipped = apply_results({}, [results_of([vote("no")] * 3)], **NOW)
        e = out["SEL-003"]
        self.assertEqual((e["verdict"], e["by"], e["at"]), ("fail", "llm", NOW["at"]))
        self.assertIn("3 票とも no", e["note"])
        self.assertIn("SEL-003/3", e["note"])
        self.assertEqual(
            e["llm"]["steps"]["SEL-003/3"]["images"][0]["questions"][0]["votes"],
            ["no"] * 3,
        )
        self.assertEqual(skipped, [])
        und, _ = apply_results({}, [results_of([vote(), vote(), vote("no")])], **NOW)
        self.assertEqual(und["SEL-003"]["verdict"], "undecided")

    def test_the_entry_carries_the_cost_of_its_own_steps_only(self):
        out, _ = apply_results({}, [results_of([vote("no")] * 3)], **NOW)
        self.assertAlmostEqual(out["SEL-003"]["llm"]["cost_usd"], 0.06)
        self.assertEqual(out["SEL-003"]["llm"]["cli"], "2.1.285")

    def test_a_pass_writes_nothing(self):
        out, _ = apply_results({}, [results_of([vote()] * 3)], **NOW)
        self.assertEqual(out, {})

    def test_a_human_verdict_is_never_overwritten(self):
        human = {"SEL-003": {"verdict": "pass", "note": "", "at": "x"}}
        out, skipped = apply_results(human, [results_of([vote("no")] * 3)], **NOW)
        self.assertEqual(out, human)
        self.assertEqual(skipped, ["SEL-003"])

    def test_a_rerun_replaces_the_step_and_a_pass_clears_an_old_llm_entry(self):
        first, _ = apply_results({}, [results_of([vote("no")] * 3)], **NOW)
        again, _ = apply_results(first, [results_of([vote("no")] * 3)], **NOW)
        self.assertEqual(list(again["SEL-003"]["llm"]["steps"]), ["SEL-003/3"])
        cleared, _ = apply_results(first, [results_of([vote()] * 3)], **NOW)
        self.assertNotIn("SEL-003", cleared)

    def test_a_rerun_of_another_step_keeps_the_earlier_failed_step(self):
        first, _ = apply_results({}, [results_of([vote("no")] * 3, 3)], **NOW)
        both, _ = apply_results(
            first, [results_of([vote(), vote(), vote("no")], 4)], **NOW
        )
        self.assertEqual(
            sorted(both["SEL-003"]["llm"]["steps"]), ["SEL-003/3", "SEL-003/4"]
        )
        self.assertEqual(both["SEL-003"]["verdict"], "fail")

    def test_input_is_not_mutated(self):
        cur = {"X-1": {"verdict": "pass"}}
        apply_results(cur, [results_of([vote("no")] * 3)], **NOW)
        self.assertEqual(cur, {"X-1": {"verdict": "pass"}})

    def test_the_written_entry_passes_check_results_and_the_review_pages_verdict_values(
        self,
    ):
        out, _ = apply_results({}, [results_of([vote("no")] * 3)], **NOW)
        sot = sot_of(CODE, scenario())
        self.assertEqual(check_results(sot, out), [])
        self.assertIn(out["SEL-003"]["verdict"], ("fail", "undecided"))
        json.dumps(out, ensure_ascii=False)


class FakeClaude:
    """prompt から画と問いを読み、画ごとに決めた答えを返す。呼ばれた数を数える"""

    def __init__(self, replies):
        self.replies = replies
        self.calls = []
        self.references = []

    def __call__(self, prompt, image, model, reference=None):
        self.calls.append((image.name, model))
        self.references.append(reference)
        return self.replies[image.name]


def reply(q_id, a, ev="見える"):
    return json.dumps(
        {
            "total_cost_usd": 0.02,
            "duration_ms": 10,
            "modelUsage": {"m": {}},
            "structured_output": {
                "image": "",
                "answers": [{"id": q_id, "answer": a, "evidence": ev}],
            },
        }
    )


class RunBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.root = self.tmp / "repo"
        self.acc = self.tmp / "acc"
        (self.root / "docs/acceptance").mkdir(parents=True)
        (self.root / "docs/acceptance/scenarios.jsonl").write_text(
            "".join(
                json.dumps(r, ensure_ascii=False) + "\n" for r in (CODE, scenario())
            ),
            encoding="utf-8",
        )
        (self.acc / "shots").mkdir(parents=True)
        for n in (1, 2, 3):
            (self.acc / "shots" / f"SEL-003-{n}.png").write_bytes(b"png")


class RunTest(RunBase):
    def test_run_calls_three_times_per_image_writes_fail_only_and_logs_everything(self):
        fake = FakeClaude({"SEL-003-1.png": reply("S", "no", "ピンが無い")})
        steps = select_steps(sot_of(CODE, scenario()), ["SEL-003/3"])
        results, _, cost, skipped, _ = run(
            self.root, self.acc, steps, runner=fake, model="sonnet", votes=3, jobs=2
        )
        self.assertEqual(len(fake.calls), 3)
        self.assertEqual({m for _, m in fake.calls}, {"sonnet"})
        self.assertEqual(results[0].verdict, "fail")
        self.assertAlmostEqual(cost, 0.06)
        saved = json.loads((self.acc / "results.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["SEL-003"]["by"], "llm")
        self.assertIn("ピンが無い", saved["SEL-003"]["note"])
        log = json.loads((self.acc / "judge.json").read_text(encoding="utf-8"))
        self.assertEqual(log["SEL-003/3"]["verdict"], "fail")
        self.assertEqual(skipped, [])

    def test_a_passing_step_leaves_results_json_untouched_but_is_in_the_log(self):
        (self.acc / "results.json").write_text(
            '{"SEL-003": {"verdict": "hold", "note": "", "at": "x"}}'
        )
        fake = FakeClaude({"SEL-003-1.png": reply("S", "yes")})
        steps = select_steps(sot_of(CODE, scenario()), ["SEL-003/3"])
        _, _, _, skipped, _ = run(
            self.root, self.acc, steps, runner=fake, model="sonnet", votes=3, jobs=1
        )
        self.assertEqual(
            json.loads((self.acc / "results.json").read_text())["SEL-003"]["verdict"],
            "hold",
        )
        self.assertEqual(skipped, ["SEL-003"])
        log = json.loads((self.acc / "judge.json").read_text(encoding="utf-8"))
        self.assertTrue(log["SEL-003/3"]["writes_pass"])

    def test_a_baselined_shot_is_logged_as_not_passing(self):
        b = self.root / "tests/e2e/baselines"
        b.mkdir(parents=True)
        (b / "SEL-003-1-板.png").write_bytes(b"x")
        fake = FakeClaude({"SEL-003-1.png": reply("S", "yes")})
        steps = select_steps(sot_of(CODE, scenario()), ["SEL-003/3"])
        run(self.root, self.acc, steps, runner=fake, model="sonnet", votes=3, jobs=1)
        log = json.loads((self.acc / "judge.json").read_text(encoding="utf-8"))
        self.assertFalse(log["SEL-003/3"]["writes_pass"])

    def test_a_missing_image_stops_before_any_call(self):
        fake = FakeClaude({})
        steps = [StepRef("SEL-003", 3, "t")]
        (self.acc / "shots" / "SEL-003-1.png").unlink()
        for n in (2, 3):
            (self.acc / "shots" / f"SEL-003-{n}.png").unlink()
        with self.assertRaises(FileNotFoundError):
            run(
                self.root, self.acc, steps, runner=fake, model="sonnet", votes=3, jobs=1
            )
        self.assertEqual(fake.calls, [])

    def test_an_explicit_image_replaces_the_steps_shots(self):
        other = self.tmp / "defect.png"
        other.write_bytes(b"x")
        fake = FakeClaude({"defect.png": reply("S", "no")})
        steps = select_steps(sot_of(CODE, scenario()), ["SEL-003/3"])
        results, *_ = run(
            self.root,
            self.acc,
            steps,
            runner=fake,
            model="sonnet",
            votes=3,
            jobs=1,
            image_override=[other],
        )
        self.assertEqual(results[0].images[0].image, other)


class RunGuardsTest(RunBase):
    """RunTest の置き場を借りて、書いてよいときと書いてはいけないときを見る"""

    steps = select_steps(sot_of(CODE, scenario()), ["SEL-003/3"])

    def read(self, name):
        return json.loads((self.acc / name).read_text(encoding="utf-8"))

    def test_a_replaced_image_writes_neither_results_nor_the_log(self):
        other = self.tmp / "defect.png"
        other.write_bytes(b"x")
        fake = FakeClaude({"defect.png": reply("S", "no")})
        run(
            self.root,
            self.acc,
            self.steps,
            runner=fake,
            model="s",
            votes=3,
            jobs=1,
            image_override=[other],
        )
        self.assertFalse((self.acc / "results.json").exists())
        self.assertFalse((self.acc / "judge.json").exists())

    def test_a_replaced_image_takes_the_pixel_baseline_of_the_steps_own_shot(self):
        b = self.root / "tests/e2e/baselines"
        b.mkdir(parents=True)
        (b / "SEL-003-1-板.png").write_bytes(b"x")
        other = self.tmp / "defect.png"
        other.write_bytes(b"x")
        fake = FakeClaude({"defect.png": reply("S", "yes")})
        results, *_ = run(
            self.root,
            self.acc,
            self.steps,
            runner=fake,
            model="s",
            votes=3,
            jobs=1,
            image_override=[other],
        )
        self.assertTrue(results[0].images[0].pixel_baseline)

    def test_a_pass_with_no_results_file_does_not_create_one(self):
        fake = FakeClaude({"SEL-003-1.png": reply("S", "yes")})
        run(self.root, self.acc, self.steps, runner=fake, model="s", votes=3, jobs=1)
        self.assertFalse((self.acc / "results.json").exists())
        self.assertTrue((self.acc / "judge.json").exists())

    def test_broken_json_stops_before_any_call(self):
        for name in ("results.json", "judge.json"):
            (self.acc / name).write_text("{broken")
            fake = FakeClaude({"SEL-003-1.png": reply("S", "no")})
            with self.assertRaises(ValueError):
                run(
                    self.root,
                    self.acc,
                    self.steps,
                    runner=fake,
                    model="s",
                    votes=3,
                    jobs=1,
                )
            self.assertEqual(fake.calls, [], name)
            (self.acc / name).unlink()
        (self.acc / "results.json").write_text("[]")
        with self.assertRaises(ValueError):
            run(
                self.root,
                self.acc,
                self.steps,
                runner=FakeClaude({}),
                model="s",
                votes=3,
                jobs=1,
            )

    def test_when_every_call_fails_the_earlier_failure_stays_and_the_step_is_errored(
        self,
    ):
        fake = FakeClaude({"SEL-003-1.png": reply("S", "no", "ピンが無い")})
        run(self.root, self.acc, self.steps, runner=fake, model="s", votes=3, jobs=1)
        before = self.read("results.json")
        log_before = self.read("judge.json")

        def dead(prompt, image, model, reference=None):
            raise subprocess.SubprocessError("claude が終了コード 1: 認証切れ")

        results, *_ = run(
            self.root, self.acc, self.steps, runner=dead, model="s", votes=3, jobs=1
        )
        self.assertTrue(results[0].errored)
        self.assertEqual(self.read("results.json"), before)
        self.assertEqual(self.read("judge.json"), log_before)

    def test_one_vote_is_written_as_one_vote_not_as_three(self):
        fake = FakeClaude({"SEL-003-1.png": reply("S", "no")})
        run(self.root, self.acc, self.steps, runner=fake, model="s", votes=1, jobs=1)
        note = self.read("results.json")["SEL-003"]["note"]
        self.assertIn("1 票とも no", note)
        self.assertNotIn("3 票", note)

    def test_a_named_shot_that_is_missing_stops_the_run(self):
        (self.acc / "shots" / "SEL-003-2.png").unlink()
        steps = [StepRef("SEL-003", 3, "画 1〜2: x")]
        with self.assertRaises(FileNotFoundError):
            run(
                self.root,
                self.acc,
                steps,
                runner=FakeClaude({}),
                model="s",
                votes=3,
                jobs=1,
            )

    def test_a_non_object_entry_is_not_ours_to_replace(self):
        out, skipped = apply_results(
            {"SEL-003": "memo"}, [results_of([vote("no")] * 3)], **NOW
        )
        self.assertEqual((out["SEL-003"], skipped), ("memo", ["SEL-003"]))

    def test_the_temp_file_is_not_the_acceptance_servers(self):
        seen = []
        real = os.replace
        with mock.patch(
            "judge.os.replace",
            side_effect=lambda a, b: (seen.append(Path(a).name), real(a, b)),
        ):
            fake = FakeClaude({"SEL-003-1.png": reply("S", "no")})
            run(
                self.root, self.acc, self.steps, runner=fake, model="s", votes=3, jobs=1
            )
        self.assertTrue(seen)
        self.assertNotIn("results.json.tmp", seen)


class MainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        (self.tmp / "docs/acceptance").mkdir(parents=True)
        (self.tmp / "docs/acceptance/scenarios.jsonl").write_text(
            "".join(
                json.dumps(r, ensure_ascii=False) + "\n" for r in (CODE, scenario())
            ),
            encoding="utf-8",
        )
        self.acc = self.tmp / "acc"
        (self.acc / "shots").mkdir(parents=True)
        (self.acc / "shots" / "SEL-003-1.png").write_bytes(b"x")
        self.env = mock.patch.dict(os.environ, {"ACCEPTANCE_DIR": str(self.acc)})
        self.env.start()
        self.addCleanup(self.env.stop)

    def call(self, *argv, runner=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = main(list(argv), root=self.tmp, runner=runner or FakeClaude({}))
        return code, out.getvalue()

    def test_dry_run_counts_the_calls_and_makes_none(self):
        fake = FakeClaude({})
        code, out = self.call("--step", "SEL-003/3", "--dry-run", runner=fake)
        self.assertEqual(code, 0)
        self.assertIn("計 3 回", out)
        self.assertEqual(fake.calls, [])

    def test_nothing_marked_llm_is_not_an_error(self):
        (self.tmp / "docs/acceptance/scenarios.jsonl").write_text(
            "".join(
                json.dumps(r, ensure_ascii=False) + "\n"
                for r in (
                    CODE,
                    scenario(
                        steps=[
                            ["前提", "a"],
                            ["ならば", "【見た目】b", {"judge": "human"}],
                        ]
                    ),
                )
            ),
            encoding="utf-8",
        )
        code, out = self.call()
        self.assertEqual(code, 0)
        self.assertIn("llm", out)

    def test_a_leading_double_dash_from_pnpm_is_dropped(self):
        code, out = self.call("--", "--step", "SEL-003/3", "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("計 3 回", out)

    def test_when_every_call_fails_main_exits_1(self):
        def dead(prompt, image, model, reference=None):
            raise subprocess.SubprocessError("x")

        self.assertEqual(self.call("--step", "SEL-003/3", runner=dead)[0], 1)
        self.assertFalse((self.acc / "results.json").exists())

    def test_an_unknown_step_is_a_usage_error(self):
        self.assertEqual(self.call("--step", "SEL-003/9")[0], 2)

    def test_the_sot_is_not_changed(self):
        before = (self.tmp / "docs/acceptance/scenarios.jsonl").read_text(
            encoding="utf-8"
        )
        fake = FakeClaude({"SEL-003-1.png": reply("S", "no")})
        self.call("--step", "SEL-003/3", runner=fake)
        self.assertEqual(
            (self.tmp / "docs/acceptance/scenarios.jsonl").read_text(encoding="utf-8"),
            before,
        )
        self.assertTrue((self.acc / "results.json").is_file())

    def test_image_needs_exactly_one_step(self):
        with contextlib.suppress(SystemExit):
            code, _ = self.call("--image", "x.png")
            self.fail(f"exit {code}")


class RunClaudeTest(unittest.TestCase):
    def test_the_command_isolates_local_config_allows_only_read_and_drops_the_key(self):
        done = subprocess.CompletedProcess([], 0, stdout="{}")
        with (
            mock.patch("judge.subprocess.run", return_value=done) as run_mock,
            mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k", "KEEP": "1"}),
        ):
            self.assertEqual(run_claude("P", Path("/a/b.png"), "sonnet"), "{}")
        cmd = run_mock.call_args.args[0]
        kwargs = run_mock.call_args.kwargs
        self.assertEqual(cmd[:3], ["claude", "-p", "P"])
        for flag in (
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-session-persistence",
        ):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--setting-sources") + 1], "")
        self.assertEqual(cmd[cmd.index("--tools") + 1], "Read")
        self.assertEqual(cmd[cmd.index("--model") + 1], "sonnet")
        self.assertEqual(cmd[cmd.index("--add-dir") + 1], "/a")
        self.assertNotIn("--bare", cmd)
        self.assertIs(kwargs["stdin"], subprocess.DEVNULL)
        self.assertNotIn("ANTHROPIC_API_KEY", kwargs["env"])
        self.assertEqual(kwargs["env"]["KEEP"], "1")
        schema = json.loads(cmd[cmd.index("--json-schema") + 1])
        self.assertEqual(
            schema["properties"]["answers"]["items"]["properties"]["answer"]["enum"],
            ["yes", "no"],
        )

    def test_a_nonzero_exit_without_output_carries_stderr_into_the_vote(self):
        done = subprocess.CompletedProcess([], 1, stdout="", stderr="Please log in")
        with mock.patch("judge.subprocess.run", return_value=done):
            from judge import _one_vote

            v = _one_vote(run_claude, Q, Path("/a/b.png"), "sonnet")
        self.assertIsNone(v.answers)
        self.assertIn("Please log in", v.error)

    def test_a_timeout_becomes_a_failed_vote_not_a_crash(self):
        with mock.patch(
            "judge.subprocess.run", side_effect=subprocess.TimeoutExpired("claude", 1)
        ):
            from judge import _one_vote

            v = _one_vote(run_claude, Q, Path("/a/b.png"), "sonnet")
        self.assertIsNone(v.answers)


OBS_STEPS = [
    ["前提", "観察画面に入っている"],
    ["ならば", "【見た目】画 1 (集落): 島が絵として見える", {"judge": "llm"}],
    ["かつ", "【見た目】画 2 (群れ): 鹿が見える", {"judge": "llm"}],
]
OBS_RUBRICS = {
    "OBS-002/2": [
        {"id": "O1", "q": "陸が写る"},
        {"id": "O7", "q": "基準画と同じ画風", "ref": True},
    ],
    "OBS-002/3": [
        {"id": "O1", "q": "陸が写る"},
        {"id": "O7", "q": "同じ画風", "ref": True},
    ],
}


def obs_reply(a="yes"):
    return json.dumps(
        {
            "total_cost_usd": 0.02,
            "duration_ms": 10,
            "modelUsage": {"m": {}},
            "structured_output": {
                "image": "",
                "answers": [
                    {"id": i, "answer": a, "evidence": "中央に見える"}
                    for i in ("O1", "O7")
                ],
            },
        }
    )


class ObserveBase(RunBase):
    """承認済みの観察画面の基準画を並べ、3 票の yes を合格として書く (M25-07)"""

    def setUp(self):
        super().setUp()
        rows = (CODE, scenario("OBS-002", steps=OBS_STEPS, mode="auto"))
        (self.root / "docs/acceptance/scenarios.jsonl").write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
            encoding="utf-8",
        )
        (self.root / "docs/acceptance/rubrics.json").write_text(
            json.dumps(OBS_RUBRICS, ensure_ascii=False), encoding="utf-8"
        )
        self.approved = self.root / "docs/acceptance/observe-approved"
        self.approved.mkdir()
        for n in (1, 2):
            (self.acc / "shots" / f"OBS-002-{n}.png").write_bytes(b"png")
            (self.approved / f"OBS-002-{n}.png").write_bytes(b"ok")
        self.sot = sot_of(CODE, scenario("OBS-002", steps=OBS_STEPS, mode="auto"))

    def judge(self, specs, fake, **kw):
        steps = select_steps(self.sot, specs)
        return run(
            self.root,
            self.acc,
            steps,
            runner=fake,
            model="s",
            votes=3,
            jobs=1,
            expected=select_steps(self.sot, []),
            **kw,
        )

    def results(self):
        return json.loads((self.acc / "results.json").read_text(encoding="utf-8"))


class ObserveTest(ObserveBase):
    def test_the_approved_image_of_the_same_name_is_handed_over_with_the_question(self):
        fake = FakeClaude({"OBS-002-1.png": obs_reply(), "OBS-002-2.png": obs_reply()})
        self.judge([], fake)
        self.assertEqual(
            {r.name for r in fake.references if r}, {"OBS-002-1.png", "OBS-002-2.png"}
        )
        self.assertTrue(all(r.parent == self.approved for r in fake.references))

    def test_three_yes_on_every_llm_step_is_recorded_as_a_pass(self):
        fake = FakeClaude({"OBS-002-1.png": obs_reply(), "OBS-002-2.png": obs_reply()})
        self.judge([], fake)
        e = self.results()["OBS-002"]
        self.assertEqual((e["verdict"], e["by"]), ("pass", "llm"))
        self.assertEqual(sorted(e["llm"]["steps"]), ["OBS-002/2", "OBS-002/3"])
        self.assertEqual(check_results(self.sot, self.results()), [])
        log = json.loads((self.acc / "judge.json").read_text(encoding="utf-8"))
        self.assertTrue(log["OBS-002/2"]["records_pass"])

    def test_one_step_alone_leaves_the_entry_undecided_and_names_the_missing_one(self):
        fake = FakeClaude({"OBS-002-1.png": obs_reply()})
        self.judge(["OBS-002/2"], fake)
        e = self.results()["OBS-002"]
        self.assertEqual(e["verdict"], "undecided")
        self.assertIn("OBS-002/3", e["note"])

    def test_a_no_vote_is_a_fail_even_with_the_approved_image(self):
        fake = FakeClaude(
            {"OBS-002-1.png": obs_reply("no"), "OBS-002-2.png": obs_reply()}
        )
        self.judge([], fake)
        self.assertEqual(self.results()["OBS-002"]["verdict"], "fail")

    def test_a_human_verdict_is_not_replaced_by_a_pass(self):
        (self.acc / "results.json").write_text(
            '{"OBS-002": {"verdict": "hold", "note": "", "at": "x"}}'
        )
        fake = FakeClaude({"OBS-002-1.png": obs_reply(), "OBS-002-2.png": obs_reply()})
        _, _, _, skipped, _ = self.judge([], fake)
        self.assertEqual(self.results()["OBS-002"]["verdict"], "hold")
        self.assertEqual(skipped, ["OBS-002"])

    def test_a_pixel_baseline_still_blocks_the_pass(self):
        b = self.root / "tests/e2e/baselines"
        b.mkdir(parents=True)
        (b / "OBS-002-1-板.png").write_bytes(b"x")
        fake = FakeClaude({"OBS-002-1.png": obs_reply(), "OBS-002-2.png": obs_reply()})
        self.judge([], fake)
        e = self.results()["OBS-002"]
        self.assertNotIn("OBS-002/2", e["llm"]["steps"])
        self.assertEqual(e["verdict"], "undecided")
        self.assertIn("OBS-002/2", e["note"])

    def test_a_question_that_needs_the_approved_image_stops_when_it_is_missing(self):
        (self.approved / "OBS-002-2.png").unlink()
        fake = FakeClaude({})
        with self.assertRaises(FileNotFoundError):
            self.judge([], fake)
        self.assertEqual(fake.calls, [])

    def test_a_replaced_image_is_paired_with_the_approved_image_of_the_nominal_shot(
        self,
    ):
        fake = FakeClaude({"defect.png": obs_reply("no")})
        defect = self.tmp / "defect.png"
        defect.write_bytes(b"d")
        self.judge(["OBS-002/2"], fake, image_override=[defect])
        self.assertEqual({r.name for r in fake.references}, {"OBS-002-1.png"})

    def test_a_step_without_a_ref_question_is_not_recorded_as_a_pass_even_with_a_twin(
        self,
    ):
        rub = json.loads((self.root / "docs/acceptance/rubrics.json").read_text())
        rub["OBS-002/2"] = [{"id": "O1", "q": "陸が写る"}]
        (self.root / "docs/acceptance/rubrics.json").write_text(json.dumps(rub))
        fake = FakeClaude({"OBS-002-1.png": obs_reply()})
        self.judge(["OBS-002/2"], fake)
        self.assertFalse((self.acc / "results.json").exists())

    def test_a_stale_step_key_outside_the_sot_does_not_decide_the_verdict(self):
        (self.acc / "results.json").write_text(
            json.dumps(
                {
                    "OBS-002": {
                        "verdict": "fail",
                        "note": "",
                        "at": "x",
                        "by": "llm",
                        "llm": {
                            "steps": {"OBS-002/9": {"verdict": "fail", "images": []}}
                        },
                    }
                }
            )
        )
        fake = FakeClaude({"OBS-002-1.png": obs_reply(), "OBS-002-2.png": obs_reply()})
        self.judge([], fake)
        self.assertEqual(self.results()["OBS-002"]["verdict"], "pass")

    def test_an_image_with_no_approved_twin_is_not_recorded_as_a_pass(self):
        img = image_result(Q, Path("x.png"), [vote()] * 3, pixel_baseline=False)
        step = StepResult(StepRef("SEL-003", 3, "t"), (img,))
        self.assertTrue(writes_pass(step))
        self.assertFalse(records_pass(step))


class StaleTest(ObserveBase):
    """LLM の pass は、判じた画・承認済みの画・採点表の hash を持ち、合わなくなれば消える (M25-12)"""

    def judged(self):
        fake = FakeClaude({"OBS-002-1.png": obs_reply(), "OBS-002-2.png": obs_reply()})
        self.judge([], fake)
        return fake

    def digest(self, key="OBS-002/2"):
        return self.results()["OBS-002"]["llm"]["steps"][key]["digest"]

    def test_a_recorded_pass_carries_a_digest_and_the_log_has_the_same_one(self):
        self.judged()
        d = self.digest()
        self.assertRegex(d, r"^[0-9a-f]{64}$")
        log = json.loads((self.acc / "judge.json").read_text(encoding="utf-8"))
        self.assertEqual(log["OBS-002/2"]["digest"], d)
        self.assertNotEqual(self.digest("OBS-002/3"), d)

    def test_the_digest_is_the_same_when_nothing_changed(self):
        self.judged()
        before = self.digest()
        self.judged()
        self.assertEqual(self.digest(), before)

    def test_the_digest_changes_with_the_shot_the_approved_image_or_the_rubric(self):
        self.judged()
        base = self.digest()
        (self.acc / "shots" / "OBS-002-1.png").write_bytes(b"changed")
        self.judged()
        shot = self.digest()
        (self.approved / "OBS-002-1.png").write_bytes(b"changed")
        self.judged()
        approved = self.digest()
        rub = json.loads((self.root / "docs/acceptance/rubrics.json").read_text())
        rub["OBS-002/2"][0]["q"] = "陸が写り、空も描かれている"
        (self.root / "docs/acceptance/rubrics.json").write_text(json.dumps(rub))
        self.judged()
        rubric = self.digest()
        self.assertEqual(len({base, shot, approved, rubric}), 4)

    def test_a_changed_shot_drops_its_pass_even_when_the_run_judges_only_the_other_step(
        self,
    ):
        self.judged()
        (self.acc / "shots" / "OBS-002-1.png").write_bytes(b"changed")
        fake = FakeClaude({"OBS-002-2.png": obs_reply()})
        _, _, _, _, stale = self.judge(["OBS-002/3"], fake)
        e = self.results()["OBS-002"]
        self.assertEqual(sorted(e["llm"]["steps"]), ["OBS-002/3"])
        self.assertEqual(e["verdict"], "undecided")
        self.assertIn("OBS-002/2", e["note"])
        self.assertEqual(stale, ["OBS-002/2"])

    def test_a_full_run_after_a_change_judges_again_and_passes_again(self):
        self.judged()
        (self.acc / "shots" / "OBS-002-1.png").write_bytes(b"changed")
        fake = self.judged()
        self.assertEqual(len(fake.calls), 6)
        self.assertEqual(self.results()["OBS-002"]["verdict"], "pass")

    def test_a_pass_whose_inputs_did_not_change_stays_when_another_step_is_rejudged(
        self,
    ):
        self.judged()
        fake = FakeClaude({"OBS-002-2.png": obs_reply()})
        _, _, _, _, stale = self.judge(["OBS-002/3"], fake)
        e = self.results()["OBS-002"]
        self.assertEqual(sorted(e["llm"]["steps"]), ["OBS-002/2", "OBS-002/3"])
        self.assertEqual((e["verdict"], stale), ("pass", []))

    def test_a_pass_without_a_digest_is_stale(self):
        self.judged()
        doc = self.results()
        del doc["OBS-002"]["llm"]["steps"]["OBS-002/2"]["digest"]
        (self.acc / "results.json").write_text(json.dumps(doc))
        fake = FakeClaude({"OBS-002-2.png": obs_reply()})
        _, _, _, _, stale = self.judge(["OBS-002/3"], fake)
        self.assertEqual(stale, ["OBS-002/2"])
        self.assertEqual(self.results()["OBS-002"]["verdict"], "undecided")

    def test_a_recorded_fail_is_kept_when_the_shot_changes(self):
        self.judged()
        doc = self.results()
        doc["OBS-002"]["verdict"] = "fail"
        doc["OBS-002"]["llm"]["steps"]["OBS-002/3"]["verdict"] = "fail"
        (self.acc / "results.json").write_text(json.dumps(doc))
        (self.acc / "shots" / "OBS-002-2.png").write_bytes(b"changed")
        fake = FakeClaude({"OBS-002-1.png": obs_reply()})
        self.judge(["OBS-002/2"], fake)
        steps = self.results()["OBS-002"]["llm"]["steps"]
        self.assertEqual(steps["OBS-002/3"]["verdict"], "fail")

    def test_a_stale_pass_is_dropped_and_only_the_rejudged_fail_remains(self):
        self.judged()
        doc = self.results()
        doc["OBS-002"]["llm"]["steps"].pop("OBS-002/3")
        (self.acc / "results.json").write_text(json.dumps(doc))
        (self.acc / "shots" / "OBS-002-1.png").write_bytes(b"changed")
        fake = FakeClaude({"OBS-002-2.png": obs_reply("no")})
        self.judge(["OBS-002/3"], fake)
        # OBS-002/2 は消え、判じ直した OBS-002/3 の fail だけが残る
        self.assertEqual(
            sorted(self.results()["OBS-002"]["llm"]["steps"]), ["OBS-002/3"]
        )

    def test_a_human_verdict_is_never_pruned(self):
        (self.acc / "results.json").write_text(
            json.dumps(
                {
                    "OBS-002": {
                        "verdict": "pass",
                        "note": "",
                        "at": "x",
                        "llm": {"steps": {"OBS-002/2": {"verdict": "yes"}}},
                    }
                }
            )
        )
        fake = FakeClaude({"OBS-002-1.png": obs_reply(), "OBS-002-2.png": obs_reply()})
        self.judge([], fake)
        e = self.results()["OBS-002"]
        self.assertEqual(e["at"], "x")
        self.assertIn("OBS-002/2", e["llm"]["steps"])

    def test_a_trial_with_an_explicit_image_does_not_touch_the_records(self):
        self.judged()
        (self.acc / "shots" / "OBS-002-1.png").write_bytes(b"changed")
        before = (self.acc / "results.json").read_text()
        defect = self.tmp / "defect.png"
        defect.write_bytes(b"d")
        fake = FakeClaude({"defect.png": obs_reply("no")})
        self.judge(["OBS-002/2"], fake, image_override=[defect])
        self.assertEqual((self.acc / "results.json").read_text(), before)


class ReferencePromptTest(unittest.TestCase):
    def test_the_prompt_names_the_approved_image_and_says_it_is_for_style_only(self):
        p = prompt_of(Q, Path("/a/b.png"), Path("/c/b.png"))
        self.assertIn("基準画 (承認済み): /c/b.png", p)
        self.assertIn("画風の比べにだけ使う", p)
        self.assertTrue(p.endswith("画像ファイル: /a/b.png"))

    def test_the_rubric_marks_which_questions_compare_with_the_approved_image(self):
        rubric = {
            "X-001/2": [{"id": "O7", "q": "q", "ref": True}, {"id": "O1", "q": "r"}]
        }
        got = questions_of(StepRef("X-001", 2, "x"), rubric)
        self.assertEqual([q.ref for q in got], [True, False])

    def test_the_command_lets_claude_read_the_approved_dir_too(self):
        done = subprocess.CompletedProcess([], 0, stdout="{}")
        with mock.patch("judge.subprocess.run", return_value=done) as run_mock:
            run_claude("P", Path("/a/b.png"), "sonnet", Path("/c/b.png"))
        cmd = run_mock.call_args.args[0]
        dirs = [cmd[i + 1] for i, c in enumerate(cmd) if c == "--add-dir"]
        self.assertEqual(dirs, ["/a", "/c"])


REPO = Path(__file__).resolve().parent.parent


class RepoRubricsTest(unittest.TestCase):
    def test_every_rubric_names_a_real_step_with_unique_question_ids(self):
        sot, _ = load(
            (REPO / "docs/acceptance/scenarios.jsonl").read_text(encoding="utf-8")
        )
        rubrics = json.loads(
            (REPO / "docs/acceptance/rubrics.json").read_text(encoding="utf-8")
        )
        for key, rows in rubrics.items():
            select_steps(sot, [key])
            ids = [r["id"] for r in rows]
            self.assertEqual(len(ids), len(set(ids)), key)
            self.assertTrue(all(r["q"].strip() for r in rows), key)


# M25-16: 【見た目】の 5 手順 (SEL-003 の 2〜4・CNF-002 の 2〜3) は正本で judge が llm、画素の基準も持つ
LLM_STEPS = {
    "SEL-003/2": ["SEL-003-1.png"],
    "SEL-003/3": ["SEL-003-2.png"],
    "SEL-003/4": ["SEL-003-3.png"],
    "CNF-002/2": ["CNF-002-1.png", "CNF-002-2.png", "CNF-002-3.png"],
    "CNF-002/3": ["CNF-002-1.png", "CNF-002-2.png", "CNF-002-3.png"],
}


def repo_sot():
    sot, problems = load(
        (REPO / "docs/acceptance/scenarios.jsonl").read_text(encoding="utf-8")
    )
    assert not problems
    return sot


def repo_rubrics():
    return json.loads(
        (REPO / "docs/acceptance/rubrics.json").read_text(encoding="utf-8")
    )


def reply_all(ids, a):
    return json.dumps(
        {
            "total_cost_usd": 0.02,
            "duration_ms": 10,
            "modelUsage": {"m": {}},
            "structured_output": {
                "image": "",
                "answers": [
                    {"id": i, "answer": a, "evidence": f"{i} は {a}"} for i in ids
                ],
            },
        }
    )


class RepoLlmStepsTest(unittest.TestCase):
    def test_the_five_steps_are_llm_in_the_source_of_truth(self):
        keys = {s.key for s in select_steps(repo_sot(), [])}
        self.assertTrue(set(LLM_STEPS) <= keys, set(LLM_STEPS) - keys)

    def test_each_step_loads_its_own_rubric_not_the_fallback(self):
        rubrics = repo_rubrics()
        for key in LLM_STEPS:
            step = select_steps(repo_sot(), [key])[0]
            qs = questions_of(step, rubrics)
            self.assertGreaterEqual(len(qs), 3, key)
            self.assertNotEqual([q.id for q in qs], ["S"], f"{key} は採点表が無い")
            self.assertFalse(any(q.ref for q in qs), key)

    def test_the_two_trial_failures_are_tested_by_their_intent(self):
        rubrics = repo_rubrics()
        cancel = " ".join(r["q"] for r in rubrics["CNF-002/2"])
        self.assertIn("focus", cancel)
        self.assertIn("輪や光が無いなら no", cancel)
        band = " ".join(r["q"] for r in rubrics["SEL-003/3"])
        self.assertIn("途中で消えて見えない辺があるなら no", band)

    def test_each_step_points_at_the_shots_the_text_names(self):
        shots = {
            "SEL-003": [f"shots/SEL-003-{n}.png" for n in (1, 2, 3)],
            "CNF-002": [f"shots/CNF-002-{n}.png" for n in (1, 2, 3)],
        }
        for key, names in LLM_STEPS.items():
            step = select_steps(repo_sot(), [key])[0]
            got = images_of(step, shots, Path("/x/shots"))
            self.assertEqual([p.name for p in got], names, key)

    def test_the_prompt_carries_every_question_and_the_image_without_a_reference(self):
        step = select_steps(repo_sot(), ["SEL-003/3"])[0]
        qs = questions_of(step, repo_rubrics())
        prompt = prompt_of(qs, Path("/x/SEL-003-2.png"))
        for q in qs:
            self.assertIn(f"- {q.id}: {q.text}", prompt)
        self.assertTrue(prompt.endswith("画像ファイル: /x/SEL-003-2.png"))
        self.assertNotIn("基準画", prompt)

    def test_the_digest_follows_the_rubric_question(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        img = tmp / "CNF-002-1.png"
        img.write_bytes(b"png")
        step = select_steps(repo_sot(), ["CNF-002/2"])[0]
        qs = questions_of(step, repo_rubrics())
        before = digest_of([PlanItem(step, qs, img, True, None)])
        edited = [Question(qs[0].id, qs[0].text + "。", qs[0].ref), *qs[1:]]
        after = digest_of([PlanItem(step, edited, img, True, None)])
        self.assertNotEqual(before, after)


class RepoBaselinedStepsRunTest(unittest.TestCase):
    """基準画のある手順は、3 票の yes でも results.json に pass を書かず、no と割れだけを書く (ADR 0001 段 5)"""

    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.root, self.acc = tmp / "repo", tmp / "acc"
        (self.root / "docs/acceptance").mkdir(parents=True)
        for f in ("scenarios.jsonl", "rubrics.json"):
            shutil.copy(REPO / "docs/acceptance" / f, self.root / "docs/acceptance" / f)
        (self.root / "tests/e2e/baselines").mkdir(parents=True)
        (self.acc / "shots").mkdir(parents=True)
        for sid in ("SEL-003", "CNF-002"):
            for n in (1, 2, 3):
                (self.root / f"tests/e2e/baselines/{sid}-{n}-板.png").write_bytes(b"x")
                (self.acc / "shots" / f"{sid}-{n}.png").write_bytes(b"png")
        self.sot = repo_sot()
        self.ids = {k: [r["id"] for r in v] for k, v in repo_rubrics().items()}

    def judge(self, key, answers):
        ids = self.ids[key]
        fake = FakeClaude(
            {
                n: reply_all(ids, answers.get(n, "yes"))
                for n in {"SEL-003-1.png", "SEL-003-2.png", "SEL-003-3.png"}
                | {"CNF-002-1.png", "CNF-002-2.png", "CNF-002-3.png"}
            }
        )
        steps = select_steps(self.sot, [key])
        out = run(
            self.root,
            self.acc,
            steps,
            runner=fake,
            model="s",
            votes=3,
            jobs=1,
            expected=select_steps(self.sot, []),
        )
        return fake, out

    def saved(self):
        f = self.acc / "results.json"
        return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}

    def test_three_yes_votes_are_logged_but_never_written_as_a_pass(self):
        for key in ("SEL-003/3", "CNF-002/2"):
            fake, (results, *_) = self.judge(key, {})
            self.assertEqual(results[0].verdict, "yes")
            self.assertFalse(writes_pass(results[0]))
            self.assertFalse(records_pass(results[0]))
            self.assertEqual(len(fake.calls), 3 * len(results[0].images))
        self.assertEqual(self.saved(), {})
        log = json.loads((self.acc / "judge.json").read_text(encoding="utf-8"))
        self.assertFalse(log["CNF-002/2"]["writes_pass"])

    def test_three_no_votes_are_written_as_a_llm_fail(self):
        self.judge("CNF-002/2", {"CNF-002-1.png": "no"})
        entry = self.saved()["CNF-002"]
        self.assertEqual((entry["verdict"], entry["by"]), ("fail", "llm"))
        self.assertIn("CNF-002/2", entry["llm"]["steps"])
        self.assertIn("CNF-002-1.png", entry["note"])

    def test_a_later_pass_keeps_the_item_failing_while_another_step_fails(self):
        self.judge("SEL-003/3", {"SEL-003-2.png": "no"})
        self.judge("SEL-003/4", {"SEL-003-3.png": "no"})
        self.judge("SEL-003/3", {})
        entry = self.saved()["SEL-003"]
        self.assertEqual(entry["verdict"], "fail")
        self.assertNotIn("SEL-003/3", entry["llm"]["steps"])
        self.assertIn("SEL-003/4", entry["llm"]["steps"])

    def test_a_pass_after_the_only_fail_removes_the_item(self):
        self.judge("SEL-003/3", {"SEL-003-2.png": "no"})
        self.assertEqual(self.saved()["SEL-003"]["verdict"], "fail")
        self.judge("SEL-003/3", {})
        self.assertNotIn("SEL-003", self.saved())

    def test_every_image_of_the_five_steps_has_a_real_pixel_baseline(self):
        for key, names in LLM_STEPS.items():
            for n in names:
                self.assertTrue(
                    has_pixel_baseline(Path(n), REPO / "tests/e2e/baselines"), (key, n)
                )

    def test_without_baselines_the_same_yes_votes_would_be_a_pass(self):
        shutil.rmtree(self.root / "tests/e2e/baselines")
        (self.root / "tests/e2e/baselines").mkdir()
        _, (results, *_) = self.judge("SEL-003/3", {})
        self.assertTrue(writes_pass(results[0]))


if __name__ == "__main__":
    unittest.main()
