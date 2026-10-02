import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from acceptance import (
    ROUND_MINUTES,
    base_of,
    check_repo,
    check_results,
    check_shots,
    check_sot,
    lens_names,
    load,
    main,
    next_id,
    page_of,
    render_feature,
    shots_of,
)

REPO = Path(__file__).resolve().parent.parent

# 再設計 (2026-09-29) の前の手順書の id。1 回目 10 件・2 回目 15 件と、本番の H9・H10。
# どれも正本のどれかの行の from に結ばれていること (黙って落とさない)
LEGACY_IDS = [
    "a-free-resume",
    "a-scenario-resume",
    "a-publish-visit",
    "a-browse",
    "a-closed",
    "a-late-publish",
    "a-cargo",
    "a-avoidance",
    "a-logs",
    "a-determinism",
    "r2-closed",
    "r2-late-publish",
    "r2-publish-visit",
    "r2-browse",
    "r2-cargo",
    "r2-avoidance",
    "r2-scenario-slot",
    "r2-cross-stage",
    "r2-restart",
    "r2-url",
    "r2-snapshot",
    "r2-cell-highlight",
    "r2-confirm",
    "r2-verdict-save",
    "r2-board-regress",
    "H9",
    "H10",
]

TEST_FILE = "tests/e2e/harbor.spec.ts"
TEST_TEXT = "test('M19-09: 出港 → リンク → 訪問', async () => {});\n"
LENS_FILE = "tests/e2e/lens.ts"
LENS_TEXT = "export const LENSES = { legible: expectLegible } as const;\n"


def code(c="HBR", name="港", background=()):
    return {"kind": "code", "code": c, "name": name, "background": list(background)}


def auto(id_="HBR-001", **over):
    row = {
        "kind": "scenario",
        "id": id_,
        "status": "active",
        "mode": "auto",
        "title": "出港して訪れる",
        "tickets": ["M19-09"],
        "from": ["a-publish-visit"],
        "steps": [
            ["前提", "判定が出た"],
            ["もし", "出港する"],
            ["ならば", "訪れられる"],
        ],
        "covered_by": [{"file": TEST_FILE, "title": "M19-09: 出港"}],
    }
    row.update(over)
    return row


def human(id_="TUR-001", **over):
    row = {
        "kind": "scenario",
        "id": id_,
        "status": "active",
        "mode": "human",
        "title": "試し読みを通す",
        "tickets": ["M19-09"],
        "from": ["r2-publish-visit"],
        "when": "round",
        "minutes": 5,
        "links": [{"label": "試し読み", "path": "/?scenario=test-ship&dev=1"}],
        "judge": "見た目だけ",
        "steps": [
            ["前提", "開いている"],
            ["もし", "進める"],
            ["ならば", "【見た目】読める", {"judge": "human"}],
        ],
        "covered_by": [],
    }
    row.update(over)
    return row


def text_of(*rows):
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)


def files(mapping):
    return lambda path: mapping.get(path)


def tickets(mapping):
    return lambda ticket: mapping.get(ticket)


def problems_of(*rows, read=None, ticket_status=None):
    sot, problems = load(text_of(*rows))
    return problems + check_sot(
        sot,
        read or files({TEST_FILE: TEST_TEXT, LENS_FILE: LENS_TEXT}),
        ticket_status or tickets({}),
    )


def rules(problems):
    return sorted({p.rule for p in problems})


BASE_ROWS = (code(), code("TUR", "人の 1 周", ["受入のビルドが立っている"]))


class LoadTest(unittest.TestCase):
    def test_reads_codes_and_scenarios_with_steps_as_keyword_text_pairs(self):
        sot, problems = load(text_of(*BASE_ROWS, auto()))
        self.assertEqual(problems, [])
        self.assertEqual([c.code for c in sot.codes], ["HBR", "TUR"])
        s = sot.scenarios[0]
        self.assertEqual(
            (s.id, s.mode, s.from_), ("HBR-001", "auto", ("a-publish-visit",))
        )
        self.assertEqual(s.steps[0], ("前提", "判定が出た"))

    def test_unknown_keys_and_broken_lines_are_problems_with_the_line_number(self):
        sot, problems = load(text_of(code(), auto(extra=1)) + "{not json\n\n")
        self.assertEqual([p.where for p in problems], ["line 2", "line 3"])
        self.assertIn("extra", problems[0].detail)
        self.assertEqual(sot.scenarios, ())


class IdTest(unittest.TestCase):
    def test_id_must_be_three_letters_dash_three_digits_of_a_declared_code(self):
        self.assertEqual(rules(problems_of(*BASE_ROWS, auto("HB-001"))), ["id"])
        self.assertEqual(rules(problems_of(*BASE_ROWS, auto("XYZ-001"))), ["id"])

    def test_the_same_id_twice_is_a_problem(self):
        self.assertEqual(rules(problems_of(*BASE_ROWS, auto(), auto())), ["id"])

    def test_a_gap_in_a_code_means_a_line_was_deleted(self):
        problems = problems_of(*BASE_ROWS, auto("HBR-001"), auto("HBR-003"))
        self.assertEqual(rules(problems), ["never-reuse"])
        self.assertIn("HBR-002", problems[0].detail)

    def test_next_id_counts_retired_rows_too(self):
        retired = auto(
            "HBR-002",
            status="retired",
            retired={
                "on": "2026-09-29",
                "reason": "畳んだ",
                "replaced_by": ["HBR-001"],
            },
        )
        sot, _ = load(text_of(*BASE_ROWS, auto(), retired))
        self.assertEqual(next_id(sot, "HBR"), "HBR-003")
        self.assertEqual(next_id(sot, "TUR"), "TUR-001")


class ShapeTest(unittest.TestCase):
    def test_steps_start_with_premise_or_when_and_have_a_then(self):
        no_then = auto(steps=[["前提", "a"], ["もし", "b"]])
        starts_with_and = auto(steps=[["かつ", "a"], ["ならば", "b"]])
        unknown = auto(steps=[["Given", "a"], ["ならば", "b"]])
        for row in (no_then, starts_with_and, unknown):
            self.assertEqual(
                rules(problems_of(*BASE_ROWS, row)), ["gherkin"], row["steps"]
            )

    def test_human_rows_carry_when_minutes_and_judge_and_auto_rows_do_not(self):
        missing = human()
        del missing["judge"]
        self.assertEqual(rules(problems_of(*BASE_ROWS, missing)), ["shape"])
        self.assertEqual(rules(problems_of(*BASE_ROWS, auto(minutes=3))), ["shape"])

    def test_links_are_root_relative_paths_without_player(self):
        for path in (
            "http://localhost:8787/?dev=1",
            "//evil.example/",
            "github.com/karak/sim-bio",
            "港つきのビルドで開く",
        ):
            row = human(links=[{"label": "x", "path": path}])
            self.assertEqual(rules(problems_of(*BASE_ROWS, row)), ["link"], path)
        many = human(links=[{"label": "x", "path": "/?dev=1&player=b"}])
        problems = problems_of(*BASE_ROWS, many)
        self.assertEqual(rules(problems), ["link"])
        self.assertIn("player=", problems[0].detail)

    def test_retired_block_only_on_retired_rows_and_replacements_exist(self):
        active_with_block = auto(
            retired={"on": "2026-09-29", "reason": "x", "replaced_by": []}
        )
        retired_without = auto(status="retired")
        dangling = auto(
            status="retired",
            retired={"on": "2026-09-29", "reason": "x", "replaced_by": ["HBR-009"]},
        )
        for row in (active_with_block, retired_without, dangling):
            self.assertEqual(rules(problems_of(*BASE_ROWS, row)), ["retired"])


def tagged(mark=None, text="【読みやすさ】板の文が読める"):
    step = ["ならば", text]
    return step if mark is None else [*step, mark]


def with_then(step):
    return [["前提", "開いている"], ["もし", "進める"], step]


LEGIBLE = {"checks": [{"lens": "legible", "target": "判定の板"}]}


class StepMarkTest(unittest.TestCase):
    def rules_of(self, step, row=human):
        return rules(problems_of(*BASE_ROWS, row(steps=with_then(step))))

    def test_a_tagged_step_without_checks_or_judge_fails_the_check(self):
        for tag in ("見た目", "読みやすさ", "手触り"):
            self.assertEqual(
                self.rules_of(tagged(text=f"【{tag}】読める")), ["step-checks"], tag
            )

    def test_a_tagged_step_passes_with_checks_or_a_judge_or_both(self):
        for mark in (
            LEGIBLE,
            {"judge": "human"},
            {"judge": "llm"},
            {**LEGIBLE, "judge": "llm"},
        ):
            self.assertEqual(self.rules_of(tagged(mark)), [], mark)

    def test_empty_marks_count_as_none(self):
        for mark in ({}, {"checks": []}):
            self.assertEqual(self.rules_of(tagged(mark)), ["step-checks"], mark)

    def test_an_unknown_lens_fails(self):
        mark = {"checks": [{"lens": "sparkle", "target": "判定の板"}]}
        problems = problems_of(*BASE_ROWS, human(steps=with_then(tagged(mark))))
        self.assertEqual(rules(problems), ["step-checks"])
        self.assertIn("sparkle", problems[0].detail)

    def test_lens_names_come_from_the_lens_file(self):
        mark = {"checks": [{"lens": "contrast", "target": "板"}]}
        step = with_then(tagged(mark))
        lens = "export const LENSES = { legible: a, contrast: b } as const;\n"
        read = files({TEST_FILE: TEST_TEXT, LENS_FILE: lens})
        self.assertEqual(problems_of(*BASE_ROWS, human(steps=step), read=read), [])

    def test_a_check_needs_a_target(self):
        mark = {"checks": [{"lens": "legible", "target": ""}]}
        self.assertEqual(self.rules_of(tagged(mark)), ["step-checks"])

    def test_an_empty_judge_is_a_bad_judge_not_a_missing_one(self):
        problems = problems_of(
            *BASE_ROWS, human(steps=with_then(tagged({"judge": ""})))
        )
        self.assertEqual(rules(problems), ["step-checks"])
        self.assertIn("judge は", problems[0].detail)

    def test_a_doc_comment_naming_lenses_is_not_the_list(self):
        lens = "/** export const LENSES = { old: x } */\n" + LENS_TEXT
        self.assertEqual(lens_names(files({LENS_FILE: lens})), {"legible"})

    def test_the_judge_is_llm_or_human(self):
        self.assertEqual(self.rules_of(tagged({"judge": "robot"})), ["step-checks"])

    def test_the_mark_is_an_object_of_checks_and_judge_only(self):
        for bad in ("human", {"judgee": "human"}, {"checks": [{"lens": "legible"}]}):
            sot, problems = load(
                text_of(*BASE_ROWS, human(steps=with_then(tagged(bad))))
            )
            self.assertEqual([p.rule for p in problems], ["shape"], bad)
            self.assertEqual(sot.scenarios, ())

    def test_untagged_steps_need_no_mark(self):
        self.assertEqual(self.rules_of(tagged(text="数が合う")), [])

    def test_auto_rows_are_held_to_it_too(self):
        self.assertEqual(self.rules_of(tagged(), row=auto), ["step-checks"])
        self.assertEqual(self.rules_of(tagged(LEGIBLE), row=auto), [])

    def test_retired_rows_are_not_held_to_it(self):
        retired = human(
            status="retired",
            steps=with_then(tagged()),
            retired={
                "on": "2026-10-01",
                "reason": "畳んだ",
                "replaced_by": ["TUR-002"],
            },
        )
        later = human("TUR-002")
        self.assertEqual(rules(problems_of(*BASE_ROWS, retired, later)), [])

    def test_a_missing_lens_file_fails_a_row_that_names_a_lens(self):
        read = files({TEST_FILE: TEST_TEXT})
        problems = problems_of(
            *BASE_ROWS, human(steps=with_then(tagged(LEGIBLE))), read=read
        )
        self.assertEqual(rules(problems), ["step-checks"])


class CoverageTest(unittest.TestCase):
    def test_a_cited_title_must_be_in_that_file(self):
        renamed = auto(
            covered_by=[{"file": TEST_FILE, "title": "M19-09: 名前を変えた"}]
        )
        problems = problems_of(*BASE_ROWS, renamed)
        self.assertEqual(rules(problems), ["cover"])
        self.assertIn(TEST_FILE, problems[0].detail)
        gone = auto(covered_by=[{"file": "tests/e2e/gone.spec.ts", "title": "x"}])
        self.assertIn("cover", rules(problems_of(*BASE_ROWS, gone)))
        empty = auto(covered_by=[{"file": TEST_FILE, "title": ""}])
        self.assertIn("cover", rules(problems_of(*BASE_ROWS, empty)))

    def test_an_active_auto_row_needs_a_test_that_exists_today(self):
        only_planned = auto(
            covered_by=[
                {
                    "file": "tests/unit/app.place.test.ts",
                    "title": "planOp",
                    "planned": "M21-07",
                }
            ]
        )
        problems = problems_of(
            *BASE_ROWS, only_planned, ticket_status=tickets({"M21-07": "todo"})
        )
        self.assertEqual(rules(problems), ["cover"])
        self.assertIn("今ある試験", problems[0].detail)

    def test_planned_names_an_open_ticket_and_is_dropped_once_the_test_exists(self):
        def planned(title, ticket="M21-07"):
            cover = {"file": TEST_FILE, "title": title, "planned": ticket}
            return auto(
                covered_by=[{"file": TEST_FILE, "title": "M19-09: 出港"}, cover]
            )

        ok = problems_of(
            *BASE_ROWS,
            planned("planOp の表"),
            ticket_status=tickets({"M21-07": "todo"}),
        )
        self.assertEqual(ok, [])
        no_ticket = problems_of(*BASE_ROWS, planned("planOp の表"))
        done = problems_of(
            *BASE_ROWS,
            planned("planOp の表"),
            ticket_status=tickets({"M21-07": "done"}),
        )
        exists = problems_of(
            *BASE_ROWS,
            planned("M19-09: 出港"),
            ticket_status=tickets({"M21-07": "todo"}),
        )
        for problems in (no_ticket, done, exists):
            self.assertEqual(rules(problems), ["cover"])
        self.assertIn("planned を外す", exists[0].detail)


class BudgetTest(unittest.TestCase):
    def test_the_human_minutes_of_one_round_stay_within_the_budget(self):
        within = problems_of(
            *BASE_ROWS, human("TUR-001", minutes=9), human("TUR-002", minutes=6)
        )
        self.assertEqual(within, [])
        over = problems_of(
            *BASE_ROWS, human("TUR-001", minutes=9), human("TUR-002", minutes=7)
        )
        self.assertEqual(rules(over), ["budget"])
        self.assertIn(str(ROUND_MINUTES), over[0].detail)

    def test_deploy_rows_are_a_separate_round(self):
        rows = (
            *BASE_ROWS,
            code("OPS", "本番"),
            human("TUR-001", minutes=9),
            human("OPS-001", when="deploy", minutes=9),
        )
        self.assertEqual(problems_of(*rows), [])


class ResultsTest(unittest.TestCase):
    def test_every_results_key_maps_to_an_id_or_a_from(self):
        sot, _ = load(text_of(*BASE_ROWS, auto(), human()))
        results = {"a-publish-visit": {}, "TUR-001": {}, "r2-publish-visit": {}}
        self.assertEqual(check_results(sot, results), [])
        problems = check_results(sot, {**results, "a-lost": {}})
        self.assertEqual([(p.where, p.rule) for p in problems], [("a-lost", "results")])


WRANGLER = {"name": "biotope-island"}


class BaseTest(unittest.TestCase):
    def test_the_round_opens_the_local_harbor_build(self):
        self.assertEqual(base_of("round", WRANGLER, {}), "http://localhost:8787")
        with_port = {**WRANGLER, "dev": {"port": 8790}}
        self.assertEqual(base_of("round", with_port, {}), "http://localhost:8790")

    def test_the_deploy_round_opens_workers_dev(self):
        self.assertEqual(
            base_of("deploy", WRANGLER, {}),
            "https://biotope-island.dev-sim-bio.workers.dev",
        )
        env = {"CLOUDFLARE_WORKERS_SUBDOMAIN": "other"}
        self.assertEqual(
            base_of("deploy", WRANGLER, env),
            "https://biotope-island.other.workers.dev",
        )


class PageTest(unittest.TestCase):
    def page(self, results=None, when="round", shots=None):
        rows = (
            *BASE_ROWS,
            code("OPS", "本番", ["配った画面を開く"]),
            auto(),
            human("TUR-001", tickets=["M19-09", "M19-18"]),
            human("OPS-001", when="deploy", links=[]),
        )
        sot, problems = load(text_of(*rows))
        self.assertEqual(problems, [])
        return page_of(
            sot,
            when=when,
            base="http://localhost:8787",
            round_label="2026-09-29 feat/m19 (abc1234)",
            results=results or {},
            shots=shots or {},
        )

    def test_the_page_keeps_the_review_page_shape_and_holds_only_this_rounds_human_rows(
        self,
    ):
        page = self.page()
        self.assertEqual(page["base"], "http://localhost:8787")
        self.assertEqual(page["round"], "2026-09-29 feat/m19 (abc1234)")
        self.assertEqual(page["prep"], ["受入のビルドが立っている"])
        [group] = page["groups"]
        self.assertEqual(group["name"], "人の 1 周")
        [item] = group["items"]
        self.assertEqual(item["id"], "TUR-001")
        self.assertEqual(item["ticket"], "M19-09・M19-18")
        self.assertEqual(
            item["links"], [{"label": "試し読み", "path": "/?scenario=test-ship&dev=1"}]
        )
        self.assertEqual(
            item["steps"], ["前提 開いている", "もし 進める", "ならば 【見た目】読める"]
        )
        self.assertEqual(item["judge"], "見た目だけ")

    def test_the_page_lists_each_items_checks_and_judge_by_step(self):
        rows = (
            *BASE_ROWS,
            human(
                steps=[
                    ["前提", "開いている"],
                    ["もし", "進める"],
                    [
                        "ならば",
                        "【読みやすさ】板の文が読める",
                        {**LEGIBLE, "judge": "llm"},
                    ],
                    ["かつ", "数が合う"],
                    ["かつ", "【手触り】押せる", {"judge": "human"}],
                ]
            ),
        )
        sot, problems = load(text_of(*rows))
        self.assertEqual(problems, [])
        page = page_of(
            sot, when="round", base="b", round_label="r", results={}, shots={}
        )
        [item] = page["groups"][0]["items"]
        self.assertEqual(
            item["marks"],
            [
                {
                    "step": "ならば 【読みやすさ】板の文が読める",
                    "checks": [{"lens": "legible", "target": "判定の板"}],
                    "judge": "llm",
                },
                {"step": "かつ 【手触り】押せる", "checks": [], "judge": "human"},
            ],
        )
        self.assertEqual(item["steps"][3], "かつ 数が合う")

    def test_an_auto_rows_marks_show_under_delegated(self):
        row = auto(steps=with_then(tagged(LEGIBLE)))
        sot, problems = load(text_of(*BASE_ROWS, row))
        self.assertEqual(problems, [])
        page = page_of(
            sot, when="round", base="b", round_label="r", results={}, shots={}
        )
        [entry] = page["delegated"]
        self.assertEqual(
            entry["marks"],
            [
                {
                    "step": "ならば 【読みやすさ】板の文が読める",
                    "checks": [{"lens": "legible", "target": "判定の板"}],
                    "judge": None,
                }
            ],
        )

    def test_old_verdicts_show_under_the_new_item_and_results_are_only_read(self):
        old = {
            "verdict": "pass",
            "note": "読めた",
            "snapshot": "",
            "at": "2026-09-28T10:00:00Z",
        }
        results = {"r2-publish-visit": old}
        page = self.page(results)
        [item] = page["groups"][0]["items"]
        self.assertEqual(item["history"], [{"id": "r2-publish-visit", **old}])
        self.assertEqual(results, {"r2-publish-visit": old})

    def test_delegated_rows_are_listed_with_their_tests_but_get_no_verdict(self):
        page = self.page()
        self.assertEqual(
            page["delegated"],
            [
                {
                    "id": "HBR-001",
                    "title": "出港して訪れる",
                    "tests": [f"{TEST_FILE} — M19-09: 出港"],
                    "marks": [],
                }
            ],
        )

    def test_the_page_lists_each_items_shots_and_an_empty_list_without_them(self):
        page = self.page(
            shots={"TUR-001": ("shots/TUR-001-1.png", "shots/TUR-001-2.png")}
        )
        [item] = page["groups"][0]["items"]
        self.assertEqual(item["shots"], ["shots/TUR-001-1.png", "shots/TUR-001-2.png"])
        [item] = self.page()["groups"][0]["items"]
        self.assertEqual(item["shots"], [])

    def test_the_deploy_page_holds_the_deploy_rows(self):
        page = self.page(when="deploy")
        self.assertEqual(
            [i["id"] for g in page["groups"] for i in g["items"]], ["OPS-001"]
        )
        self.assertEqual(page["prep"], ["配った画面を開く"])


class ShotsTest(unittest.TestCase):
    def test_shots_are_grouped_by_id_in_the_order_of_their_number(self):
        names = [
            "TUR-001-2.png",
            "TUR-001-10.png",
            "HBR-001-1.png",
            "TUR-001-1.png",
            ".DS_Store",
            "TUR-001.png",
            "TUR-001-1.jpg",
            "tur-001-1.png",
        ]
        self.assertEqual(
            shots_of(names),
            {
                "HBR-001": ("shots/HBR-001-1.png",),
                "TUR-001": (
                    "shots/TUR-001-1.png",
                    "shots/TUR-001-2.png",
                    "shots/TUR-001-10.png",
                ),
            },
        )

    def test_a_shot_names_an_active_human_row(self):
        retired = human(
            "TUR-002",
            status="retired",
            retired={
                "on": "2026-09-29",
                "reason": "畳んだ",
                "replaced_by": ["TUR-001"],
            },
        )
        sot, _ = load(text_of(*BASE_ROWS, auto(), human(), retired))
        self.assertEqual(check_shots(sot, {"TUR-001": ("shots/TUR-001-1.png",)}), [])
        shots = {
            "TUR-001": ("shots/TUR-001-1.png",),
            "HBR-001": ("shots/HBR-001-1.png",),
            "TUR-002": ("shots/TUR-002-1.png",),
            "TUR-009": ("shots/TUR-009-1.png",),
        }
        problems = check_shots(sot, shots)
        self.assertEqual(
            [(p.where, p.rule) for p in problems],
            [("HBR-001", "shots"), ("TUR-002", "shots"), ("TUR-009", "shots")],
        )
        self.assertIn("shots/TUR-009-1.png", problems[2].detail)

    def test_an_auto_row_with_an_llm_judged_step_takes_shots_too(self):
        judged = auto(
            "HBR-002",
            steps=[
                ["前提", "観察画面に入っている"],
                ["ならば", "【見た目】画 1: 島が見える", {"judge": "llm"}],
            ],
        )
        sot, _ = load(text_of(*BASE_ROWS, auto(), judged))
        self.assertEqual(check_shots(sot, {"HBR-002": ("shots/HBR-002-1.png",)}), [])
        self.assertEqual(
            [p.where for p in check_shots(sot, {"HBR-001": ("shots/HBR-001-1.png",)})],
            ["HBR-001"],
        )


class MainTest(unittest.TestCase):
    """page と dir を repo の正本で回す。items.json は一時の置き場に書く"""

    def run_main(self, argv, acceptance):
        out, err = io.StringIO(), io.StringIO()
        env = {**os.environ, "ACCEPTANCE_DIR": str(acceptance)}
        with (
            mock.patch.dict(os.environ, env, clear=True),
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            code = main(argv, root=REPO)
        return code, out.getvalue(), err.getvalue()

    def human_ids(self):
        sot, _ = load((REPO / "docs/acceptance/scenarios.jsonl").read_text("utf-8"))
        return [
            s.id
            for s in sot.scenarios
            if s.status == "active" and s.mode == "human" and s.when == "round"
        ]

    def test_page_puts_the_shots_in_the_acceptance_dir_on_the_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            acceptance = Path(tmp)
            first = self.human_ids()[0]
            (acceptance / "shots").mkdir()
            for n in (2, 1):
                (acceptance / "shots" / f"{first}-{n}.png").write_bytes(b"")
            code, _, err = self.run_main(["page", "--no-probe"], acceptance)
            self.assertEqual((code, err), (0, ""))
            page = json.loads((acceptance / "items.json").read_text("utf-8"))
            items = {i["id"]: i for g in page["groups"] for i in g["items"]}
            self.assertEqual(
                items[first]["shots"],
                [f"shots/{first}-1.png", f"shots/{first}-2.png"],
            )

    def test_page_refuses_a_shot_of_an_unknown_row_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            acceptance = Path(tmp)
            (acceptance / "shots").mkdir()
            (acceptance / "shots" / "ZZZ-001-1.png").write_bytes(b"")
            code, _, err = self.run_main(["page", "--no-probe"], acceptance)
            self.assertEqual(code, 1)
            self.assertIn("ZZZ-001", err)
            self.assertFalse((acceptance / "items.json").exists())

    def test_dir_prints_the_acceptance_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = self.run_main(["dir"], Path(tmp))
            self.assertEqual((code, out), (0, f"{tmp}\n"))


class FeatureTest(unittest.TestCase):
    def test_renders_japanese_gherkin_without_retired_rows(self):
        retired = auto(
            "HBR-002",
            title="消えた手順",
            status="retired",
            retired={
                "on": "2026-09-29",
                "reason": "畳んだ",
                "replaced_by": ["HBR-001"],
            },
        )
        sot, _ = load(text_of(code(), auto(), retired))
        text = render_feature(sot)
        self.assertTrue(text.startswith("# language: ja\n"))
        self.assertIn("機能: 港\n", text)
        self.assertIn(
            "  シナリオ: [HBR-001] 出港して訪れる\n    前提 判定が出た\n", text
        )
        self.assertNotIn("消えた手順", text)


class RepoSotTest(unittest.TestCase):
    def test_the_repo_sot_is_valid(self):
        self.assertEqual(check_repo(REPO), [])

    def test_every_tagged_step_of_the_repo_sot_has_checks_or_a_judge(self):
        sot, _ = load(
            (REPO / "docs/acceptance/scenarios.jsonl").read_text(encoding="utf-8")
        )
        tagged_steps = [
            (s.id, text)
            for s in sot.scenarios
            if s.status == "active"
            for (_, text), mark in zip(s.steps, s.marks, strict=True)
            if text.startswith("【")
            and (mark is None or not (mark.checks or mark.judge))
        ]
        self.assertEqual(tagged_steps, [])

    def test_the_round_has_only_the_one_minute_of_touch_in_tur_001(self):
        sot, _ = load(
            (REPO / "docs/acceptance/scenarios.jsonl").read_text(encoding="utf-8")
        )
        round_human = [
            s
            for s in sot.scenarios
            if s.status == "active" and s.mode == "human" and s.when == "round"
        ]
        self.assertEqual([s.id for s in round_human], ["TUR-001"])
        self.assertEqual(sum(s.minutes or 0 for s in round_human), 1)

    def test_every_tagged_step_of_tur_001_is_judged_by_a_human_and_nothing_else(self):
        sot, _ = load(
            (REPO / "docs/acceptance/scenarios.jsonl").read_text(encoding="utf-8")
        )
        tur = next(s for s in sot.scenarios if s.id == "TUR-001")
        tagged = [
            mark
            for (_, text), mark in zip(tur.steps, tur.marks, strict=True)
            if text.startswith("【")
        ]
        self.assertEqual(len(tagged), 1)
        self.assertEqual((tagged[0].judge, tagged[0].checks), ("human", ()))

    def test_tur_002_is_retired_into_the_rows_that_absorbed_it(self):
        sot, _ = load(
            (REPO / "docs/acceptance/scenarios.jsonl").read_text(encoding="utf-8")
        )
        tur = next(s for s in sot.scenarios if s.id == "TUR-002")
        self.assertEqual(tur.status, "retired")
        assert tur.retired is not None
        self.assertEqual(tur.retired.on, "2026-10-02")
        self.assertEqual(
            sorted(tur.retired.replaced_by),
            ["CNF-001", "CNF-002", "CRG-002", "CRG-005", "DEV-001", "SEL-003"],
        )
        self.assertEqual(
            tur.from_, ("r2-cargo", "r2-cell-highlight", "r2-confirm", "r2-snapshot")
        )

    def test_the_lens_names_are_read_from_the_lens_file(self):
        def read(rel):
            return (REPO / rel).read_text(encoding="utf-8")

        self.assertEqual(lens_names(read), {"legible"})

    def test_every_legacy_procedure_is_claimed(self):
        sot, _ = load(
            (REPO / "docs/acceptance/scenarios.jsonl").read_text(encoding="utf-8")
        )
        claimed = {legacy for s in sot.scenarios for legacy in s.from_}
        self.assertEqual(sorted(set(LEGACY_IDS) - claimed), [])


if __name__ == "__main__":
    unittest.main()
