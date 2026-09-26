import argparse
import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import mod

ID_A = "a" * 64
ID_B = "0123456789abcdef" * 4
MISSING = "f" * 64

# 港の表の仮の形 (設計書 §5・§6)。M19-08 のマイグレーションができたら、ここを消して
# `wrangler d1 migrations apply --local` をかけ、mod.py の SQL を本物の列に合わせる
PROVISIONAL_SCHEMA = """
CREATE TABLE chronicles (
  id TEXT PRIMARY KEY,
  published_at TEXT NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 0,
  hidden_at TEXT
);
CREATE TABLE daily_budget (
  day TEXT PRIMARY KEY,
  publish INTEGER NOT NULL DEFAULT 0,
  cargo INTEGER NOT NULL DEFAULT 0,
  report INTEGER NOT NULL DEFAULT 0
);
"""


def run_main(argv, run=subprocess.run):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = mod.main(argv, run=run)
    return code, out.getvalue(), err.getvalue()


class ParseChronicleIdTest(unittest.TestCase):
    def test_accepts_the_same_form_as_the_harbor_contract(self):
        self.assertEqual(mod.parse_chronicle_id(ID_B), ID_B)
        with self.assertRaises(argparse.ArgumentTypeError):
            mod.parse_chronicle_id(ID_B.upper())

    def test_rejects_anything_that_could_break_out_of_the_sql_literal(self):
        for text in [
            "",
            "a" * 63,
            "a" * 65,
            "g" * 64,
            f"{'a' * 60}' --",
            "' OR 1=1 --",
        ]:
            with self.subTest(text=text), self.assertRaises(argparse.ArgumentTypeError):
                mod.parse_chronicle_id(text)


class WranglerArgvTest(unittest.TestCase):
    def test_remote_targets_the_deployed_database_only(self):
        argv = mod.wrangler_argv(mod.Target(remote=True), "SELECT 1")
        self.assertEqual(
            argv[1:],
            [
                "d1",
                "execute",
                mod.DATABASE,
                "--remote",
                "--json",
                "--command",
                "SELECT 1",
            ],
        )
        self.assertTrue(argv[0].endswith("node_modules/.bin/wrangler"))

    def test_local_passes_config_and_persist_dir(self):
        target = mod.Target(
            remote=False, config=Path("/c/w.jsonc"), persist_to=Path("/p")
        )
        self.assertEqual(
            mod.wrangler_argv(target, "SELECT 1")[1:],
            [
                "d1",
                "execute",
                mod.DATABASE,
                "--local",
                "--config",
                "/c/w.jsonc",
                "--persist-to",
                "/p",
                "--json",
                "--command",
                "SELECT 1",
            ],
        )


class CommandLineTest(unittest.TestCase):
    def never_run(self, *args, **kwargs):
        raise AssertionError("wrangler を呼んではいけない")

    def test_target_must_be_chosen_explicitly(self):
        with self.assertRaises(SystemExit) as caught:
            run_main(["hide", ID_A], run=self.never_run)
        self.assertEqual(caught.exception.code, 2)

    def test_delete_without_yes_does_not_touch_the_database(self):
        code, _, err = run_main(["--remote", "delete", ID_A], run=self.never_run)
        self.assertEqual(code, 2)
        self.assertIn("--yes", err)

    def test_persist_to_is_only_for_local(self):
        with self.assertRaises(SystemExit) as caught:
            run_main(
                ["--remote", "--persist-to", "/tmp/x", "budget"], run=self.never_run
            )
        self.assertEqual(caught.exception.code, 2)

    def test_nonzero_exit_fails_even_if_stdout_looks_like_rows(self):
        def half_done(argv, **kwargs):
            return subprocess.CompletedProcess(
                argv, 1, stdout='[{"results": [{"id": "x"}]}]', stderr="boom"
            )

        code, _, err = run_main(["--remote", "hide", ID_A], run=half_done)
        self.assertEqual(code, 1)
        self.assertIn("boom", err)

    def test_wrangler_error_is_reported_and_fails(self):
        def failing(argv, **kwargs):
            return subprocess.CompletedProcess(
                argv,
                1,
                stdout='{"error": {"text": "no such table: chronicles"}}',
                stderr="",
            )

        code, _, err = run_main(["--remote", "hide", ID_A], run=failing)
        self.assertEqual(code, 1)
        self.assertIn("no such table: chronicles", err)


class LocalD1Test(unittest.TestCase):
    """ローカルの D1 (wrangler d1 execute --local) に仮の表を作って、各操作を通す。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.config = root / "wrangler.jsonc"
        self.config.write_text(
            json.dumps(
                {
                    "name": "mod-test",
                    "compatibility_date": "2026-09-25",
                    "d1_databases": [
                        {
                            "binding": mod.DATABASE,
                            "database_name": "biotope-island-harbor",
                            "database_id": "00000000-0000-0000-0000-000000000000",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        self.target = [
            "--local",
            "--config",
            str(self.config),
            "--persist-to",
            str(root / "d1"),
        ]
        self.sql(
            PROVISIONAL_SCHEMA
            + f"""
            INSERT INTO chronicles (id, published_at, report_count) VALUES
              ('{ID_A}', '2026-09-26T00:00:00Z', 3),
              ('{ID_B}', '2026-09-26T01:00:00Z', 0);
            INSERT INTO daily_budget (day, publish, cargo, report) VALUES
              ('2026-09-25', 1500, 10, 0),
              ('2026-09-26', 12, 250, 1000);
            """
        )

    def tearDown(self):
        self.tmp.cleanup()

    def sql(self, command):
        target = mod.Target(
            remote=False, config=self.config, persist_to=Path(self.tmp.name) / "d1"
        )
        return mod.execute(target, command)

    def row(self, chronicle_id):
        return self.sql(
            f"SELECT report_count, hidden_at FROM chronicles WHERE id = '{chronicle_id}'"
        )

    def test_hide_is_idempotent_and_restore_clears_the_reports(self):
        code, out, _ = run_main([*self.target, "hide", ID_A])
        self.assertEqual(code, 0)
        self.assertIn(f"隠した: {ID_A}", out)
        [first] = self.row(ID_A)
        self.assertIsNotNone(first["hidden_at"])

        self.sql(
            f"UPDATE chronicles SET hidden_at = '2026-09-26 02:00:00' WHERE id = '{ID_A}'"
        )
        code, out, _ = run_main([*self.target, "hide", ID_A])
        self.assertEqual(code, 0)
        self.assertIn("2026-09-26 02:00:00", out)
        self.assertEqual(
            self.row(ID_A), [{"report_count": 3, "hidden_at": "2026-09-26 02:00:00"}]
        )

        code, out, _ = run_main([*self.target, "restore", ID_A])
        self.assertEqual(code, 0)
        self.assertIn(f"戻した: {ID_A}", out)
        self.assertEqual(self.row(ID_A), [{"report_count": 0, "hidden_at": None}])
        self.assertEqual(self.row(ID_B), [{"report_count": 0, "hidden_at": None}])

    def test_delete_removes_only_that_chronicle(self):
        code, out, _ = run_main([*self.target, "delete", ID_B, "--yes"])
        self.assertEqual(code, 0)
        self.assertIn(f"消した: {ID_B}", out)
        self.assertEqual(self.row(ID_B), [])
        self.assertEqual(len(self.row(ID_A)), 1)

    def test_unknown_id_fails_for_every_operation(self):
        for argv in [
            ["hide", MISSING],
            ["restore", MISSING],
            ["delete", MISSING, "--yes"],
        ]:
            with self.subTest(op=argv[0]):
                code, _, err = run_main([*self.target, *argv])
                self.assertEqual(code, 1)
                self.assertIn(f"見つからない: {MISSING}", err)

    def test_budget_shows_the_newest_days_against_the_caps(self):
        code, out, _ = run_main([*self.target, "budget", "--days", "1"])
        self.assertEqual(code, 0)
        self.assertEqual(
            out.splitlines(),
            [
                "2026-09-26  出港 12/2,000 (1%)  積荷 250/5,000 (5%)  通報 1,000/1,000 (100%)"
            ],
        )

        code, out, _ = run_main([*self.target, "budget"])
        self.assertEqual(code, 0)
        self.assertEqual(
            out.splitlines(),
            [
                "2026-09-26  出港 12/2,000 (1%)  積荷 250/5,000 (5%)  通報 1,000/1,000 (100%)",
                "2026-09-25  出港 1,500/2,000 (75%)  積荷 10/5,000 (0%)  通報 0/1,000 (0%)",
            ],
        )

    def test_budget_without_rows_says_so(self):
        self.sql("DELETE FROM daily_budget")
        code, out, _ = run_main([*self.target, "budget"])
        self.assertEqual(code, 0)
        self.assertEqual(
            out.splitlines(), ["daily_budget に行が無い (まだ誰も出港していない)"]
        )


if __name__ == "__main__":
    unittest.main()
