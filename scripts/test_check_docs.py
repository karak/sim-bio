import re
import shutil
import subprocess
import unittest
from pathlib import Path

from check_docs import (
    AUTOSAVE_TS,
    CURRENT_DOC,
    POLICY_TS,
    REQUIRED_CHECKS,
    REQUIRED_POINTERS,
    SLOTS_TS,
    TYPES_TS,
    VERSION_DOC,
    anchors_of,
    check_files,
    check_marks,
    check_pointers,
    check_version_paragraph,
    count_command_types,
    count_slots,
    facts_of,
    load_repo,
    load_with,
    slug,
)

REPO = Path(__file__).resolve().parent.parent
# M27-06 で今の決定事項の文書とポインタを足す前の feat/m19
BEFORE_M27_06 = "46fc759"

OLD = "docs/a.md"
NEW = "docs/b.md"


def pointer(target, kind="superseded by"):
    return f"# a\n\n- 作成日: 2026-09-19\n- {kind}: {target} (注)\n"


class SlugTest(unittest.TestCase):
    def test_ascii_and_kana_heading(self):
        self.assertEqual(slug("D1 の書きの予算"), "d1-の書きの予算")

    def test_numbered_heading_drops_the_dot(self):
        self.assertEqual(slug("6. 運用"), "6-運用")
        self.assertEqual(slug("2. 決定事項"), "2-決定事項")

    def test_parens_and_code_marks_are_dropped(self):
        self.assertEqual(slug("今の決定事項 (2026-10-18)"), "今の決定事項-2026-10-18")
        self.assertEqual(slug("`SIM_VERSION` の版"), "sim_version-の版")

    def test_repeated_heading_gets_a_number(self):
        anchors = anchors_of("## 改訂\n\n## 改訂\n")
        self.assertEqual(anchors, frozenset({"改訂", "改訂-1"}))

    def test_heading_in_code_block_is_not_an_anchor(self):
        self.assertEqual(anchors_of("```\n## 決定事項\n```\n"), frozenset())


class PointerTest(unittest.TestCase):
    def docs(self, old, new="# b\n\n## 決定事項\n"):
        return {OLD: old, NEW: new}

    def test_resolving_pointer_passes(self):
        self.assertEqual(check_pointers(self.docs(pointer(f"{NEW}#決定事項"))), [])

    def test_supersedes_is_checked_the_same_way(self):
        docs = self.docs(pointer(f"{NEW}#無い節", kind="supersedes"))
        errors = check_pointers(docs)
        self.assertEqual(len(errors), 1)
        self.assertIn("#無い節", errors[0])

    def test_missing_file_fails(self):
        errors = check_pointers(self.docs(pointer("docs/z.md#決定事項")))
        self.assertEqual(len(errors), 1)
        self.assertIn("docs/z.md", errors[0])
        self.assertIn("docs/a.md:4", errors[0])

    def test_missing_anchor_fails_and_names_the_rule(self):
        errors = check_pointers(self.docs(pointer(f"{NEW}#2-決定事項")))
        self.assertEqual(len(errors), 1)
        self.assertIn("#2-決定事項", errors[0])
        self.assertIn("check_docs.py", errors[0])

    def test_pointer_without_anchor_fails(self):
        errors = check_pointers(self.docs(pointer(NEW)))
        self.assertEqual(len(errors), 1)
        self.assertIn("形でない", errors[0])

    def test_nested_bullet_and_plain_line_are_pointers(self):
        for line in (
            f"  - superseded by: {NEW}#決定事項",
            f"superseded by: {NEW}#決定事項",
            f"- superseded by: `{NEW}`#決定事項",
        ):
            with self.subTest(line=line):
                self.assertEqual(check_pointers(self.docs(f"# a\n\n{line}\n")), [])

    def test_pointer_in_code_block_is_ignored(self):
        text = "# a\n\n```\nsuperseded by: docs/z.md#x\n```\n"
        self.assertEqual(check_pointers(self.docs(text)), [])

    def test_required_pointer_missing_fails(self):
        old = "docs/specs/2026-09-19-ecosystem-sim-design.md"
        errors = check_pointers({old: "# 設計書\n", CURRENT_DOC: "## 決定事項\n"})
        self.assertEqual(len(errors), 1)
        self.assertIn(old, errors[0])
        self.assertIn(f"{CURRENT_DOC}#決定事項", errors[0])
        self.assertIn("0 個", errors[0])

    def test_required_count_is_checked(self):
        old = "docs/design/2026-09-26-cloudflare-architecture.md"
        target = f"{CURRENT_DOC}#d1-の書きの予算"
        current = "## D1 の書きの予算\n"
        once = f"# x\n\nsuperseded by: {target}\n"
        twice = once + f"\n- superseded by: {target}\n"
        self.assertEqual(REQUIRED_POINTERS[old][target], 2)
        errors = check_pointers({old: once, CURRENT_DOC: current})
        self.assertEqual(len(errors), 1)
        self.assertIn("1 個", errors[0])
        self.assertEqual(check_pointers({old: twice, CURRENT_DOC: current}), [])


class VersionParagraphTest(unittest.TestCase):
    TABLE = "| C8 | 日次の枠 | pricing |\n\n"
    NOTE = "C6 の注(…):\n"
    PARA = (
        "版は 3 つある。`SaveData.version`・`SIM_VERSION`・`RUNNER_STATE_VERSION`。"
        "ADR 0002 の決定 5 (`docs/decisions/0002-architecture-fence.md`)。\n\n"
    )

    def test_paragraph_between_c8_and_c6_note_passes(self):
        self.assertEqual(
            check_version_paragraph(self.TABLE + self.PARA + self.NOTE), []
        )

    def test_missing_paragraph_fails_and_names_what_is_missing(self):
        errors = check_version_paragraph(self.TABLE + self.NOTE)
        self.assertEqual(len(errors), 1)
        self.assertIn("RUNNER_STATE_VERSION", errors[0])
        self.assertIn("0002-architecture-fence.md", errors[0])

    def test_paragraph_after_the_c6_note_does_not_count(self):
        errors = check_version_paragraph(self.TABLE + self.NOTE + self.PARA)
        self.assertEqual(len(errors), 1)


class FactTest(unittest.TestCase):
    def test_command_types_are_counted_inside_the_union_only(self):
        ts = (
            "type X = { type: 'other' };\n"
            "export type Command =\n  | { type: 'a'; n: number }\n"
            "  // { type: 'b' } はここに足さない\n  | { type: 'c' };\n"
            "type Y = { type: 'later' };\n"
        )
        self.assertEqual(count_command_types(ts), 2)

    def test_slots_spread_manual_slots(self):
        ts = (
            "export const MANUAL_SLOTS = ['m-1', 'm-2'] as const;\n"
            "export const SLOTS: readonly SlotId[] = ['auto', ...MANUAL_SLOTS];\n"
        )
        self.assertEqual(count_slots(ts), 3)

    def test_todays_code(self):
        facts = facts_of(load_repo(REPO))
        self.assertEqual(facts["command_types"], "9")
        self.assertEqual(facts["trophic_decomposer"], "decomposer")
        self.assertEqual(facts["slots"], "4")
        self.assertEqual(facts["autosave_ticks"], "90")
        self.assertEqual(facts["cap_publish"], "2000")
        self.assertEqual(facts["cap_cast_cargo"], "3000")
        self.assertEqual(facts["cap_report"], "500")
        self.assertEqual(facts["shed_max"], "45000")
        self.assertEqual(facts["policy_worst_rows"], "77000")
        self.assertTrue(REQUIRED_CHECKS <= set(facts))


class MarkTest(unittest.TestCase):
    FACTS = {name: "1" for name in REQUIRED_CHECKS} | {"e2e_specs": "21"}

    def doc(self, line):
        """line の印の外の必須の印は、値 1 で別の行に埋める"""
        named = set(re.findall(r"check: (\w+)=", line))
        rest = " ".join(
            f"{self.FACTS[n]} <!-- check: {n}={self.FACTS[n]} -->"
            for n in sorted(REQUIRED_CHECKS - named)
        )
        return f"# 今\n\n{line}\n\n{rest}\n"

    def test_matching_mark_passes(self):
        text = self.doc("| 17 | E2E は 21 本<!-- check: e2e_specs=21 --> |")
        self.assertEqual(check_marks(text, self.FACTS), [])

    def test_drifted_number_fails_and_says_both(self):
        text = self.doc("E2E は 20 本<!-- check: e2e_specs=20 -->")
        errors = check_marks(text, self.FACTS)
        self.assertEqual(len(errors), 1)
        self.assertIn("文書で 20", errors[0])
        self.assertIn("コードで 21", errors[0])

    def test_value_must_also_be_in_the_prose(self):
        text = self.doc("E2E は 20 本<!-- check: e2e_specs=21 -->")
        errors = check_marks(text, self.FACTS)
        self.assertEqual(len(errors), 1)
        self.assertIn("同じ行の文に無い", errors[0])

    def test_thousands_separator_is_read(self):
        text = self.doc("出港 2,000 <!-- check: cap_publish=2000 -->")
        self.assertEqual(check_marks(text, self.FACTS | {"cap_publish": "2000"}), [])

    def test_part_of_a_longer_number_is_not_shown(self):
        text = self.doc("出港 12,000 <!-- check: cap_publish=2000 -->")
        errors = check_marks(text, self.FACTS | {"cap_publish": "2000"})
        self.assertEqual(len(errors), 1)
        self.assertIn("同じ行の文に無い", errors[0])

    def test_unknown_mark_fails(self):
        text = self.doc("x 1 <!-- check: nothing=1 --> 21<!-- check: e2e_specs=21 -->")
        errors = check_marks(text, self.FACTS)
        self.assertEqual(len(errors), 1)
        self.assertIn("nothing", errors[0])

    def test_required_mark_missing_fails(self):
        errors = check_marks("# 今\n", self.FACTS)
        self.assertEqual(len(errors), len(REQUIRED_CHECKS))
        self.assertTrue(any("e2e_specs" in e for e in errors))


class RepoTest(unittest.TestCase):
    def test_todays_docs_pass(self):
        self.assertEqual(check_files(load_repo(REPO)), [])

    @unittest.skipUnless(shutil.which("git"), "git が無い")
    def test_docs_before_m27_06_fail(self):
        listed = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", BEFORE_M27_06],
            cwd=REPO,
            capture_output=True,
            text=True,
            check=False,
        )
        if listed.returncode != 0:
            self.skipTest(f"履歴に {BEFORE_M27_06} が無い (shallow clone)")

        def read(name):
            return subprocess.run(
                ["git", "show", f"{BEFORE_M27_06}:{name}"],
                cwd=REPO,
                capture_output=True,
                text=True,
                check=True,
            ).stdout

        files = load_with(read, listed.stdout.splitlines())
        for name in (TYPES_TS, SLOTS_TS, AUTOSAVE_TS, POLICY_TS):
            self.assertIn(name, files)
        joined = "\n".join(check_files(files))
        self.assertIn(f"{CURRENT_DOC} が無い", joined)
        for old in REQUIRED_POINTERS:
            self.assertIn(f"{old}: `superseded by:", joined)
        self.assertIn(f"{VERSION_DOC}:60: C8 の行と「C6 の注」の間に", joined)


if __name__ == "__main__":
    unittest.main()
