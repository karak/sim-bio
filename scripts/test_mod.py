import argparse
import contextlib
import io
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

import mod
from cf_auth import Result, parse_oauth_file

ID_A = "a" * 64
ID_B = "0123456789abcdef" * 4
MISSING = "f" * 64

# 港の表の仮の形 (設計書 §5・§6)。M19-08 のマイグレーションができたら、ここを消して
# `wrangler d1 migrations apply --local` をかけ、mod.py の SQL を本物の列に合わせる
# M19-08: 仮の形の代わりに、Worker と同じマイグレーション (worker/migrations) をローカルの D1 に当てる
MIGRATIONS = mod.REPO / "worker" / "migrations"
POLICY = mod.REPO / "worker" / "src" / "policy.ts"
HIDDEN_AT = 1_790_388_000_000  # 2026-09-26T02:00:00Z (epoch ms)


TOKEN = "tok_SECRET_value_1234567890abcdefghijklmn"
ACCOUNT = "14c725d39e9cf53743be403ab146174f"
DB_ID = "4b9db893-5306-4a01-9eb9-4926c2b34d17"
REMOTE_ENV = {
    "PATH": "/usr/bin",
    "CLOUDFLARE_API_TOKEN": TOKEN,
    "CLOUDFLARE_ACCOUNT_ID": ACCOUNT,
}


def fake_remote_env(say):
    return dict(REMOTE_ENV)


def run_main(argv, run=subprocess.run, remote_env=fake_remote_env):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = mod.main(argv, run=run, remote_env=remote_env)
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


class KeychainRunner:
    """cf_auth の Runner の形 (argv, env, cwd)。security への答えを決める。"""

    def __init__(self, exists=0):
        self.calls = []
        self.exists = exists

    def __call__(self, argv, env, cwd):
        self.calls.append((tuple(argv), dict(env)))
        if argv[0] != "security":
            raise AssertionError(f"思わぬ呼び出し: {argv}")
        if argv[-1] == "-w":
            return Result(0, TOKEN + "\n", "")
        return Result(self.exists, "", "")


class D1Api:
    def __init__(self, status=200):
        self.calls = []
        self.status = status

    def __call__(self, url, headers):
        self.calls.append(url)
        if self.status != 200:
            body = {"success": False, "errors": [{"code": 7403}]}
        else:
            body = {
                "success": True,
                "result": [{"name": "biotope-harbor", "uuid": DB_ID}],
            }
        return self.status, json.dumps(body).encode()


def real_remote_env(keychain, api):
    def remote_env(say):
        return mod.remote_env(
            say,
            run=keychain,
            http_get=api,
            base_env={
                "PATH": "/usr/bin",
                "USER": "yasushi",
                "CLOUDFLARE_API_TOKEN": "ambient-other-account",
            },
            oauth_file=lambda: (
                Path("/x/default.toml"),
                parse_oauth_file('oauth_token = "OAUTH_SENTINEL"\nscopes = []\n'),
            ),
        )

    return remote_env


def never_run(*args, **kwargs):
    raise AssertionError("wrangler を呼んではいけない")


def budget_rows(seen):
    def run(argv, **kwargs):
        seen.append((argv, kwargs))
        return subprocess.CompletedProcess(
            argv,
            0,
            stdout='[{"results": [{"day": "2026-10-10", "bucket": "publish", "used": 1}]}]',
            stderr="",
        )

    return run


class RemoteAuthTest(unittest.TestCase):
    """--remote は Keychain のトークンを環境で wrangler にだけ渡す。端末の OAuth は使わない (M26-16)。"""

    def test_token_reaches_wrangler_only_through_the_env(self):
        seen = []
        keychain, api = KeychainRunner(), D1Api()
        code, out, err = run_main(
            ["--remote", "budget"],
            run=budget_rows(seen),
            remote_env=real_remote_env(keychain, api),
        )
        self.assertEqual(code, 0, err)
        [(argv, kwargs)] = seen
        self.assertNotIn(TOKEN, " ".join(argv))
        self.assertEqual(kwargs["env"]["CLOUDFLARE_API_TOKEN"], TOKEN)
        self.assertEqual(kwargs["env"]["CLOUDFLARE_ACCOUNT_ID"], ACCOUNT)
        self.assertNotIn("ambient-other-account", kwargs["env"].values())
        self.assertIn(f"/accounts/{ACCOUNT}/d1/database", api.calls[0])
        self.assertIn("使う道: Keychain のトークン", err)
        self.assertIn("出港 1/2,000", out)
        self.assertNotIn(TOKEN, out + err)
        self.assertNotIn("OAUTH_SENTINEL", out + err)

    def test_missing_keychain_item_stops_before_wrangler(self):
        keychain = KeychainRunner(exists=44)
        code, _, err = run_main(
            ["--remote", "budget"],
            run=never_run,
            remote_env=real_remote_env(keychain, D1Api()),
        )
        self.assertEqual(code, 1)
        self.assertIn("H11", err)
        self.assertIn("止める", err)
        self.assertFalse([a for a, _ in keychain.calls if a[-1] == "-w"])

    def test_token_of_another_account_stops_before_wrangler(self):
        code, _, err = run_main(
            ["--remote", "hide", ID_A],
            run=never_run,
            remote_env=real_remote_env(KeychainRunner(), D1Api(status=403)),
        )
        self.assertEqual(code, 1)
        self.assertIn("7403", err)

    def test_wrangler_error_text_is_redacted(self):
        def leaking(argv, **kwargs):
            return subprocess.CompletedProcess(
                argv, 1, stdout="", stderr=f"bad {TOKEN}"
            )

        code, out, err = run_main(["--remote", "hide", ID_A], run=leaking)
        self.assertEqual(code, 1)
        self.assertNotIn(TOKEN, out + err)
        self.assertIn("bad ***", err)

    def test_local_never_asks_for_a_token(self):
        def no_token(say):
            raise AssertionError("--local でトークンを読んではいけない")

        seen = []
        code, _, err = run_main(
            ["--local", "budget"], run=budget_rows(seen), remote_env=no_token
        )
        self.assertEqual(code, 0, err)
        [(_, kwargs)] = seen
        self.assertIsNone(kwargs.get("env"))


class PolicySyncTest(unittest.TestCase):
    def test_budget_caps_match_the_worker_policy(self):
        text = POLICY.read_text(encoding="utf-8")
        found = {
            bucket: (int(cap.replace("_", "")), int(shed.replace("_", "")))
            for bucket, cap, shed in re.findall(
                r"(\w+): \{ cap: ([\d_]+), shedAt: ([\d_]+),", text
            )
        }
        self.assertEqual(
            {bucket: cap for bucket, (cap, _) in found.items()},
            {bucket: cap for bucket, (_, cap) in mod.BUDGET_CAPS.items()},
        )
        self.assertEqual(max(shed for _, shed in found.values()), mod.DAY_TOTAL_CAP)


class LocalD1Test(unittest.TestCase):
    """ローカルの D1 (wrangler d1 execute --local) に仮の表を作って、各操作を通す。"""

    # M19-08: 仮の表ではなく、Worker と同じマイグレーション (worker/migrations) を当てる

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
                            "migrations_dir": str(MIGRATIONS),
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
        migrated = subprocess.run(
            [
                str(mod.WRANGLER),
                "d1",
                "migrations",
                "apply",
                mod.DATABASE,
                "--local",
                "--config",
                str(self.config),
                "--persist-to",
                str(root / "d1"),
            ],
            cwd=mod.REPO,
            capture_output=True,
            text=True,
            env={**os.environ, "CI": "true"},
            check=False,
        )
        self.assertEqual(migrated.returncode, 0, migrated.stderr or migrated.stdout)
        columns = (
            "sim_version, scenario_id, seed, inscription, verdict, year, "
            "digest_hash, body, bytes, published_at, withdraw_hash"
        )
        values = (
            "'1', 'sinking', 1, 'still-here', 'alive', 3, "
            f"'{'0' * 64}', '{{}}', 2, 1790000000000, '{'1' * 64}'"
        )
        self.sql(
            f"""
            INSERT INTO chronicles (id, {columns}, reports) VALUES
              ('{ID_A}', {values}, 3),
              ('{ID_B}', {values}, 0);
            INSERT INTO reports (chronicle_id, day, sender) VALUES
              ('{ID_A}', '2026-09-26', 's1'),
              ('{ID_A}', '2026-09-26', 's2'),
              ('{ID_A}', '2026-09-26', 's3');
            INSERT INTO daily_budget (day, bucket, used) VALUES
              ('2026-09-25', 'publish', 1500), ('2026-09-25', 'cast_cargo', 10),
              ('2026-09-26', 'publish', 12), ('2026-09-26', 'cast_cargo', 250),
              ('2026-09-26', 'report', 1000);
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
            f"SELECT reports, hidden_at FROM chronicles WHERE id = '{chronicle_id}'"
        )

    def reports(self, chronicle_id):
        return self.sql(
            f"SELECT sender FROM reports WHERE chronicle_id = '{chronicle_id}'"
        )

    def test_hide_is_idempotent_and_restore_clears_the_reports(self):
        code, out, _ = run_main([*self.target, "hide", ID_A])
        self.assertEqual(code, 0)
        self.assertIn(f"隠した: {ID_A}", out)
        [first] = self.row(ID_A)
        self.assertIsInstance(first["hidden_at"], int)

        self.sql(f"UPDATE chronicles SET hidden_at = {HIDDEN_AT} WHERE id = '{ID_A}'")
        code, out, _ = run_main([*self.target, "hide", ID_A])
        self.assertEqual(code, 0)
        self.assertIn("(2026-09-26T02:00:00Z から)", out)
        self.assertEqual(self.row(ID_A), [{"reports": 3, "hidden_at": HIDDEN_AT}])

        code, out, _ = run_main([*self.target, "restore", ID_A])
        self.assertEqual(code, 0)
        self.assertIn(f"戻した: {ID_A}", out)
        self.assertEqual(self.row(ID_A), [{"reports": 0, "hidden_at": None}])
        self.assertEqual(self.reports(ID_A), [])
        self.assertEqual(self.row(ID_B), [{"reports": 0, "hidden_at": None}])

    def test_delete_removes_only_that_chronicle_and_its_reports(self):
        code, out, _ = run_main([*self.target, "delete", ID_A, "--yes"])
        self.assertEqual(code, 0)
        self.assertIn(f"消した: {ID_A}", out)
        self.assertEqual(self.row(ID_A), [])
        self.assertEqual(self.reports(ID_A), [])
        self.assertEqual(len(self.row(ID_B)), 1)

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
        today = (
            "2026-09-26  合計 1,262/45,000 (3%)  積荷 250/5,000 (5%)"
            "  出港 12/2,000 (1%)  通報 1,000/1,000 (100%)"
        )
        code, out, _ = run_main([*self.target, "budget", "--days", "1"])
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines(), [today])

        code, out, _ = run_main([*self.target, "budget"])
        self.assertEqual(code, 0)
        self.assertEqual(
            out.splitlines(),
            [
                today,
                "2026-09-25  合計 1,510/45,000 (3%)  積荷 10/5,000 (0%)  出港 1,500/2,000 (75%)",
            ],
        )

    def test_budget_without_rows_says_so(self):
        self.sql("DELETE FROM daily_budget")
        code, out, _ = run_main([*self.target, "budget"])
        self.assertEqual(code, 0)
        self.assertEqual(
            out.splitlines(), ["daily_budget に行が無い (まだ誰も港を使っていない)"]
        )


if __name__ == "__main__":
    unittest.main()
