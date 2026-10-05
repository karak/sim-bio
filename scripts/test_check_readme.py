import shutil
import subprocess
import unittest
from pathlib import Path

from check_readme import (
    ALLOWED_HEADINGS,
    MAX_LINES,
    check_readme,
    check_repo,
    warn_tickets,
)

REPO = Path(__file__).resolve().parent.parent
# README を運用の手順ごと docs/operations/ へ移した commit (85294e0) の親
BEFORE_RELOCATION = "85294e0^"

OK_README = (
    "# タイトル\n\n## 概要\n\n本文。\n\n## 動かし方\n\n```sh\npnpm install\n```\n"
)
OK_HEADINGS = frozenset({"概要", "動かし方"})


def check(text, **kwargs):
    kwargs.setdefault("allowed_headings", OK_HEADINGS)
    return check_readme(text, **kwargs)


def ticket(status, criteria):
    return f"---\nid: X-01\nstatus: {status}\n---\n\n# t\n\n## Acceptance criteria\n\n{criteria}\n\n## 作業ログ\n\n- 手順 README\n"


class HeadingTest(unittest.TestCase):
    def test_allowed_headings_pass(self):
        self.assertEqual(check(OK_README), [])

    def test_unlisted_heading_fails_and_says_where_to_put_it(self):
        errors = check(OK_README + "\n## 配備の手順\n")
        self.assertEqual(len(errors), 1)
        self.assertIn("配備の手順", errors[0])
        self.assertIn("docs/operations/", errors[0])
        self.assertIn("docs/design/", errors[0])
        self.assertIn("ALLOWED_HEADINGS", errors[0])

    def test_unlisted_h3_fails(self):
        errors = check(OK_README + "\n### 運用\n")
        self.assertEqual(len(errors), 1)
        self.assertIn("運用", errors[0])

    def test_heading_like_line_in_code_block_is_not_a_heading(self):
        text = OK_README + "\n```sh\n## コメント\n```\n"
        self.assertEqual(check(text), [])

    def test_h1_and_h4_are_not_restricted(self):
        self.assertEqual(check(OK_README + "\n#### 小さな見出し\n"), [])


class MarkerTest(unittest.TestCase):
    def test_marker_in_code_block_fails(self):
        text = OK_README + "\n```sh\nwrangler deploy\n```\n"
        errors = check(text)
        self.assertEqual(len(errors), 1)
        self.assertIn("wrangler deploy", errors[0])
        self.assertIn("docs/operations/", errors[0])

    def test_marker_in_prose_and_table_fails(self):
        for line in (
            "手元で `gh secret set X` する。",
            "| 配る | `wrangler login` |",
            "`uv run scripts/mod.py ban`",
            "`wrangler d1 execute DB --remote`",
            "`wrangler d1 execute DB --command x --remote`",
            "`--remote`",
            "`security add-generic-password -a x`",
            "`gh workflow run deploy.yml`",
            "`gh api -X POST /x`",
            "`wrangler tail`",
            "`wrangler rollback`",
        ):
            with self.subTest(line=line):
                self.assertTrue(check(OK_README + "\n" + line + "\n"))

    def test_line_linking_into_docs_operations_passes(self):
        line = "運用 (`scripts/mod.py`) は [docs/operations/cloudflare.md](docs/operations/cloudflare.md)。"
        self.assertEqual(check(OK_README + "\n" + line + "\n"), [])

    def test_mention_of_docs_operations_without_link_does_not_exempt(self):
        line = "`wrangler deploy` (docs/operations/ を見る)"
        self.assertTrue(check(OK_README + "\n" + line + "\n"))

    def test_local_wrangler_dev_is_not_operational(self):
        self.assertEqual(check(OK_README + "\n`wrangler dev`\n"), [])


class LengthTest(unittest.TestCase):
    def test_limit_is_200(self):
        self.assertEqual(MAX_LINES, 200)

    def test_at_limit_passes(self):
        text = OK_README + "x\n" * (MAX_LINES - len(OK_README.splitlines()))
        self.assertEqual(len(text.splitlines()), MAX_LINES)
        self.assertEqual(check(text), [])

    def test_over_limit_fails(self):
        text = OK_README + "x\n" * (MAX_LINES - len(OK_README.splitlines()) + 1)
        errors = check(text)
        self.assertEqual(len(errors), 1)
        self.assertIn(str(MAX_LINES), errors[0])
        self.assertIn("docs/", errors[0])


class TicketWarningTest(unittest.TestCase):
    CRIT = "- [ ] README に配備の手順を書く"

    def test_open_tickets_warn(self):
        for status in ("todo", "in_progress", "blocked"):
            with self.subTest(status=status):
                warnings = warn_tickets({"X-01.md": ticket(status, self.CRIT)})
                self.assertEqual(len(warnings), 1)
                self.assertIn("X-01.md", warnings[0])
                self.assertIn("docs/operations/", warnings[0])

    def test_closed_tickets_do_not_warn(self):
        for status in ("review", "done"):
            with self.subTest(status=status):
                self.assertEqual(
                    warn_tickets({"X-01.md": ticket(status, self.CRIT)}), []
                )

    def test_status_with_trailing_comment_is_read(self):
        text = ticket(
            "todo        # todo | in_progress | blocked | review | done", self.CRIT
        )
        self.assertEqual(len(warn_tickets({"X-01.md": text})), 1)

    def test_needs_both_readme_and_an_operations_word(self):
        for crit in (
            "- [ ] README に遊び方を書く",
            "- [ ] 配備の手順が docs にある",
            "- [ ] 運用の文書がある",
        ):
            with self.subTest(crit=crit):
                self.assertEqual(warn_tickets({"X-01.md": ticket("todo", crit)}), [])

    def test_each_operations_word_counts(self):
        for word in ("配備", "運用", "手順", "課金"):
            with self.subTest(word=word):
                crit = f"- [ ] README に{word}を書く"
                self.assertEqual(
                    len(warn_tickets({"X-01.md": ticket("todo", crit)})), 1
                )

    def test_issues_readme_is_not_the_repository_readme(self):
        crit = "- [ ] 手順を issues/README に"
        self.assertEqual(warn_tickets({"X-01.md": ticket("todo", crit)}), [])

    def test_only_acceptance_criteria_lines_are_read(self):
        text = "---\nstatus: todo\n---\n\n## 経緯\n\nREADME に配備を書いた\n\n## Acceptance criteria\n\n- [ ] 何か\n"
        self.assertEqual(warn_tickets({"X-01.md": text}), [])

    def test_no_frontmatter_status_is_ignored(self):
        text = "# t\n\n## Acceptance criteria\n\n- README 配備\n"
        self.assertEqual(warn_tickets({"X-01.md": text}), [])


class RepoTest(unittest.TestCase):
    def test_todays_readme_passes(self):
        errors, _ = check_repo(REPO)
        self.assertEqual(errors, [])

    def test_allowed_headings_cover_todays_readme(self):
        for h in ("概要", "動かし方", "Cloudflare へ配る"):
            self.assertIn(h, ALLOWED_HEADINGS)

    @unittest.skipUnless(shutil.which("git"), "git が無い")
    def test_readme_before_relocation_fails(self):
        shown = subprocess.run(
            ["git", "show", f"{BEFORE_RELOCATION}:README.md"],
            cwd=REPO,
            capture_output=True,
            text=True,
            check=False,
        )
        if shown.returncode != 0:
            self.skipTest("履歴に 85294e0 が無い (shallow clone)")
        errors = check_readme(shown.stdout)
        joined = "\n".join(errors)
        self.assertIn("見出し", joined)
        self.assertIn("行", joined)
        self.assertIn("wrangler", joined)


if __name__ == "__main__":
    unittest.main()
