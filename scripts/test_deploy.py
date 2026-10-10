import contextlib
import io
import json
import unittest
from pathlib import Path

from cf_auth import Result
from deploy import (
    ConfigError,
    DeployError,
    Deps,
    Secret,
    deploy,
    dry_run,
    is_lfs_pointer,
    load_config,
    main,
    parse_config,
    plan,
    preflight,
    read_token,
    redact,
    scrub_env,
    verify_account,
    wrangler_env,
)

REPO = Path(__file__).resolve().parent.parent
TOKEN = "tok_SECRET_value_1234567890abcdefghijklmn"
ACCOUNT = "14c725d39e9cf53743be403ab146174f"
DB_ID = "4b9db893-5306-4a01-9eb9-4926c2b34d17"

RAW = {
    "account_id": ACCOUNT,
    "worker": "biotope-island",
    "d1_databases": ["biotope-harbor"],
    "keychain_service": "sim-bio-local-deploy",
    "build": {
        "script": "build:cloudflare",
        "env": {"VITE_TURNSTILE_SITEKEY": "0x4AAAAAAFFM5qcR0ciWH4Br"},
    },
    "checks": ["check:free-tier"],
    "smoke": [
        {"url": "https://biotope-island.dev-sim-bio.workers.dev/", "expect": "ok"},
        {
            "url": "https://biotope-island.dev-sim-bio.workers.dev/api/v1/chronicles",
            "expect": "json",
        },
    ],
    "branch": "main",
}
WRANGLER = {
    "name": "biotope-island",
    "account_id": ACCOUNT,
    "d1_databases": [
        {"binding": "HARBOR", "database_name": "biotope-harbor", "database_id": DB_ID}
    ],
}


def config(**overrides):
    return parse_config({**RAW, **overrides}, WRANGLER)


class FakeRunner:
    """argv の先頭の語の並びで答えを返す。呼ばれた argv と env を控える。"""

    def __init__(self, answers=None):
        self.calls = []
        self.answers = {
            ("git", "status"): Result(0, "", ""),
            ("git", "rev-parse"): Result(0, "abc123\n", ""),
            ("git", "ls-files"): Result(0, "", ""),
            ("security",): Result(0, TOKEN + "\n", ""),
            ("pnpm", "exec", "wrangler", "deployments"): Result(
                0,
                json.dumps(
                    [
                        {
                            "created_on": "2026-10-01T00:00:00Z",
                            "versions": [{"version_id": "old-v"}],
                        },
                        {
                            "created_on": "2026-10-05T00:00:00Z",
                            "versions": [{"version_id": "new-v"}],
                        },
                    ]
                ),
                "",
            ),
            **(answers or {}),
        }

    def __call__(self, argv, env, cwd):
        self.calls.append((tuple(argv), dict(env)))
        for n in range(len(argv), 0, -1):
            if tuple(argv[:n]) in self.answers:
                return self.answers[tuple(argv[:n])]
        return Result(0, f"ran {' '.join(argv)}\n", "")


class FakeHttp:
    def __init__(self, d1_body=None, d1_status=200):
        self.calls = []
        self.d1_status = d1_status
        self.d1_body = d1_body or {
            "success": True,
            "errors": [],
            "result": [{"name": "biotope-harbor", "uuid": DB_ID}],
        }

    def __call__(self, url, headers):
        self.calls.append((url, dict(headers)))
        if "/d1/database" in url:
            return self.d1_status, json.dumps(self.d1_body).encode()
        if url.endswith("/chronicles"):
            return 200, b'{"chronicles":[]}'
        return 200, b"<!doctype html>"


def deps(runner=None, http=None, heads=None):
    out = io.StringIO()
    d = Deps(
        run=runner or FakeRunner(),
        http_get=http or FakeHttp(),
        read_head=lambda p: (heads or {}).get(p, b"glTF"),
        print=lambda *a: print(*a, file=out),
        base_env={
            "PATH": "/usr/bin",
            "USER": "yasushi",
            "CLOUDFLARE_API_TOKEN": "ambient-other-account",
            "CLOUDFLARE_ACCOUNT_ID": "ffffffffffffffffffffffffffffffff",
            "CF_API_KEY": "legacy",
            "WRANGLER_API_TOKEN": "x",
        },
        cwd=REPO,
    )
    return d, out


class ParseConfigTest(unittest.TestCase):
    def test_repo_config_parses_and_matches_wrangler_jsonc(self):
        c = load_config(REPO / "deploy.config.json", REPO)
        self.assertEqual(c.account_id, ACCOUNT)
        self.assertEqual(c.worker, "biotope-island")
        self.assertEqual(c.d1, {"biotope-harbor": DB_ID})
        self.assertEqual(c.keychain_service, "sim-bio-local-deploy")
        self.assertEqual(c.branch, "main")
        self.assertEqual(
            dict(c.build_env), {"VITE_TURNSTILE_SITEKEY": "0x4AAAAAAFFM5qcR0ciWH4Br"}
        )

    def test_defaults(self):
        c = config()
        self.assertEqual(c.remote, "origin")
        self.assertIsNone(c.keychain_account)
        self.assertEqual(c.untracked_ok, (".claude/",))
        self.assertEqual(c.lfs_dirs, (".",))

    def test_rejects_bad_values(self):
        cases = {
            "account_id": {"account_id": "not-hex"},
            "worker": {"worker": ""},
            "d1_databases": {"d1_databases": "biotope-harbor"},
            "smoke": {"smoke": [{"url": "http://x/", "expect": "ok"}]},
            "smoke.expect": {"smoke": [{"url": "https://x/", "expect": "html"}]},
            "build.env": {"build": {"script": "b", "env": {"K": 1}}},
            "unknown": {"surprise": 1},
        }
        for name, override in cases.items():
            with self.subTest(name=name), self.assertRaises(ConfigError):
                config(**override)

    def test_missing_key_is_named(self):
        raw = {k: v for k, v in RAW.items() if k != "worker"}
        with self.assertRaises(ConfigError) as cm:
            parse_config(raw, WRANGLER)
        self.assertIn("worker", str(cm.exception))

    def test_must_agree_with_wrangler_jsonc(self):
        cases = {
            "account": {**WRANGLER, "account_id": "0" * 32},
            "no account": {k: v for k, v in WRANGLER.items() if k != "account_id"},
            "worker": {**WRANGLER, "name": "other"},
            "d1": {**WRANGLER, "d1_databases": []},
        }
        for name, wrangler in cases.items():
            with self.subTest(name=name), self.assertRaises(ConfigError):
                parse_config(RAW, wrangler)


class LfsPointerTest(unittest.TestCase):
    def test_detects_pointer_text(self):
        self.assertTrue(
            is_lfs_pointer(b"version https://git-lfs.github.com/spec/v1\noid sha256:")
        )

    def test_real_binaries_are_not_pointers(self):
        self.assertFalse(is_lfs_pointer(b"glTF\x02\x00\x00\x00"))
        self.assertFalse(is_lfs_pointer(b"\x89PNG\r\n\x1a\n"))
        self.assertFalse(is_lfs_pointer(b""))


class SecretTest(unittest.TestCase):
    def test_secret_never_shows_its_value(self):
        s = Secret(TOKEN)
        for shown in (str(s), repr(s), f"{s}", f"{s!r}", str([s]), str({"t": s})):
            self.assertNotIn(TOKEN, shown)
        self.assertEqual(s.reveal(), TOKEN)

    def test_empty_secret_is_refused(self):
        with self.assertRaises(DeployError):
            Secret("")

    def test_token_with_control_or_odd_characters_is_refused_without_echo(self):
        for bad in [
            TOKEN[:9] + "\r" + TOKEN[9:],
            "short",
            TOKEN + "\u00e9",
            "a b" + TOKEN,
        ]:
            with self.subTest(bad=bad):
                runner = FakeRunner({("security",): Result(0, bad + "\n", "")})
                with self.assertRaises(DeployError) as cm:
                    read_token(config(), deps(runner)[0])
                self.assertNotIn(bad.strip(), str(cm.exception))

    def test_surrounding_whitespace_is_stripped(self):
        runner = FakeRunner({("security",): Result(0, TOKEN + "\r\n", "")})
        self.assertEqual(read_token(config(), deps(runner)[0]).reveal(), TOKEN)

    def test_keychain_denied_is_not_reported_as_missing(self):
        runner = FakeRunner({("security",): Result(128, "", "")})
        with self.assertRaises(DeployError) as cm:
            read_token(config(), deps(runner)[0])
        self.assertIn("128", str(cm.exception))

    def test_redact_covers_escaped_forms(self):
        s = Secret(TOKEN)
        self.assertNotIn(TOKEN, redact(repr(TOKEN), s))

    def test_redact(self):
        self.assertEqual(redact(f"a {TOKEN} b", Secret(TOKEN)), "a *** b")
        self.assertEqual(redact("plain", None), "plain")


class EnvTest(unittest.TestCase):
    def test_scrub_removes_all_ambient_cloudflare_credentials(self):
        env = scrub_env(
            {
                "PATH": "/bin",
                "CLOUDFLARE_API_TOKEN": "a",
                "CLOUDFLARE_ACCOUNT_ID": "b",
                "CLOUDFLARE_API_KEY": "c",
                "CLOUDFLARE_EMAIL": "d",
                "CF_API_TOKEN": "e",
                "CF_ACCOUNT_ID": "f",
                "WRANGLER_API_TOKEN": "g",
            }
        )
        self.assertEqual(env, {"PATH": "/bin"})

    def test_wrangler_env_has_only_the_given_token_and_account(self):
        env = wrangler_env({"PATH": "/bin", "CF_API_KEY": "x"}, Secret(TOKEN), ACCOUNT)
        self.assertEqual(
            env,
            {
                "PATH": "/bin",
                "CLOUDFLARE_API_TOKEN": TOKEN,
                "CLOUDFLARE_ACCOUNT_ID": ACCOUNT,
                "WRANGLER_SEND_METRICS": "false",
                "CLOUDFLARE_API_BASE_URL": "https://api.cloudflare.com/client/v4",
            },
        )


class PlanTest(unittest.TestCase):
    def test_step_order(self):
        names = [s.name for s in plan(config(), check=False)]
        self.assertEqual(
            names,
            [
                "preflight",
                "token",
                "verify-account",
                "build",
                "check:free-tier",
                "migrations-list:biotope-harbor",
                "migrations-apply:biotope-harbor",
                "deploy",
                "deployments",
                "smoke",
            ],
        )

    def test_check_runs_before_reading_the_token(self):
        names = [s.name for s in plan(config(), check=True)]
        self.assertEqual(names[:3], ["preflight", "check", "token"])

    def test_wrangler_steps(self):
        steps = {s.name: s for s in plan(config(), check=False)}
        w = ("pnpm", "exec", "wrangler")
        self.assertEqual(
            steps["migrations-apply:biotope-harbor"].argv,
            (*w, "d1", "migrations", "apply", "biotope-harbor", "--remote"),
        )
        self.assertEqual(steps["deploy"].argv, (*w, "deploy"))
        self.assertTrue(steps["deploy"].wrangler)
        self.assertFalse(steps["build"].wrangler)
        self.assertEqual(steps["build"].argv, ("pnpm", "run", "build:cloudflare"))


class PreflightTest(unittest.TestCase):
    def test_clean_and_matching_tree_passes(self):
        runner = FakeRunner()
        d, _ = deps(runner)
        preflight(config(), d, allow_branch=False)
        argvs = [c[0] for c in runner.calls]
        self.assertIn(("git", "fetch", "origin", "main"), argvs)
        self.assertIn(("git", "rev-parse", "origin/main^{tree}"), argvs)

    def test_dirty_tree_is_refused(self):
        runner = FakeRunner({("git", "status"): Result(0, " M src/a.ts\0", "")})
        d, _ = deps(runner)
        with self.assertRaises(DeployError) as cm:
            preflight(config(), d, allow_branch=False)
        self.assertIn("src/a.ts", str(cm.exception))

    def test_untracked_under_allowed_prefix_is_ok_but_assets_is_not(self):
        ok = FakeRunner({("git", "status"): Result(0, "?? .claude/x.md\0", "")})
        preflight(config(), deps(ok)[0], allow_branch=False)
        bad = FakeRunner({("git", "status"): Result(0, "?? assets/new.png\0", "")})
        with self.assertRaises(DeployError):
            preflight(config(), deps(bad)[0], allow_branch=False)

    def test_branch_mismatch_is_refused_unless_allowed(self):
        trees = iter(["head-tree\n", "main-tree\n"] * 2)

        class Runner(FakeRunner):
            def __call__(self, argv, env, cwd):
                if tuple(argv[:2]) == ("git", "rev-parse"):
                    self.calls.append((tuple(argv), dict(env)))
                    return Result(0, next(trees), "")
                return super().__call__(argv, env, cwd)

        with self.assertRaises(DeployError) as cm:
            preflight(config(), deps(Runner())[0], allow_branch=False)
        self.assertIn("origin/main", str(cm.exception))
        preflight(config(), deps(Runner())[0], allow_branch=True)

    def test_quoted_untracked_paths_under_allowed_prefix_are_ok(self):
        runner = FakeRunner(
            {("git", "status"): Result(0, "?? .claude/日本 x.md\0?? .claude/a\0", "")}
        )
        preflight(config(), deps(runner)[0], allow_branch=False)
        [argv] = [a for a, _ in runner.calls if a[:2] == ("git", "status")]
        self.assertIn("-z", argv)

    def test_rename_is_dirty(self):
        runner = FakeRunner(
            {("git", "status"): Result(0, "R  new.ts\0.claude/old.ts\0", "")}
        )
        with self.assertRaises(DeployError) as cm:
            preflight(config(), deps(runner)[0], allow_branch=False)
        self.assertIn("new.ts", str(cm.exception))

    def test_lfs_check_covers_the_whole_repo(self):
        runner = FakeRunner()
        preflight(config(), deps(runner)[0], allow_branch=False)
        [argv] = [a for a, _ in runner.calls if a[:2] == ("git", "ls-files")]
        self.assertEqual(argv, ("git", "ls-files", "-z", "--", "."))

    def test_lfs_pointer_is_refused(self):
        runner = FakeRunner(
            {
                ("git", "ls-files"): Result(
                    0, "assets/models/deer.glb\0assets/notes.txt\0", ""
                )
            }
        )
        heads = {
            REPO / "assets/models/deer.glb": b"version https://git-lfs.github.com/spec"
        }
        with self.assertRaises(DeployError) as cm:
            preflight(config(), deps(runner, heads=heads)[0], allow_branch=False)
        self.assertIn("deer.glb", str(cm.exception))

    def test_preflight_never_sees_credentials(self):
        runner = FakeRunner()
        preflight(config(), deps(runner)[0], allow_branch=False)
        for _, env in runner.calls:
            self.assertFalse([k for k in env if k.startswith(("CLOUDFLARE", "CF_"))])


class VerifyAccountTest(unittest.TestCase):
    def test_matching_account_and_d1_passes(self):
        http = FakeHttp()
        verify_account(config(), Secret(TOKEN), http)
        [(url, headers)] = http.calls
        self.assertEqual(
            url,
            f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database?name=biotope-harbor",
        )
        self.assertEqual(headers["Authorization"], f"Bearer {TOKEN}")

    def test_wrong_account_fails_clearly(self):
        http = FakeHttp(
            {"success": False, "errors": [{"code": 7403, "message": "not authorized"}]},
            d1_status=403,
        )
        with self.assertRaises(DeployError) as cm:
            verify_account(config(), Secret(TOKEN), http)
        self.assertIn("7403", str(cm.exception))
        self.assertIn(ACCOUNT, str(cm.exception))

    def test_non_object_json_fails_cleanly(self):
        class Http(FakeHttp):
            def __call__(self, url, headers):
                return 200, b"[]"

        with self.assertRaises(DeployError):
            verify_account(config(), Secret(TOKEN), Http())

    def test_d1_id_mismatch_fails(self):
        http = FakeHttp(
            {"success": True, "result": [{"name": "biotope-harbor", "uuid": "other"}]}
        )
        with self.assertRaises(DeployError) as cm:
            verify_account(config(), Secret(TOKEN), http)
        self.assertIn(DB_ID, str(cm.exception))

    def test_error_text_echoing_the_token_is_redacted(self):
        http = FakeHttp(
            {"success": False, "errors": [{"code": 9109, "message": f"bad {TOKEN}"}]},
            d1_status=401,
        )
        with self.assertRaises(DeployError) as cm:
            verify_account(config(), Secret(TOKEN), http)
        self.assertNotIn(TOKEN, str(cm.exception))


class DeployTest(unittest.TestCase):
    def run_deploy(self, runner=None, http=None, **kw):
        runner = runner or FakeRunner()
        d, out = deps(runner, http)
        deploy(config(), d, check=kw.get("check", False), allow_branch=False)
        return runner, out.getvalue()

    def test_runs_steps_in_order_and_reports_the_version(self):
        runner, out = self.run_deploy()
        wr = [
            c[0][3:6] for c in runner.calls if c[0][:3] == ("pnpm", "exec", "wrangler")
        ]
        self.assertEqual(
            wr,
            [
                ("d1", "migrations", "list"),
                ("d1", "migrations", "apply"),
                ("deploy",),
                ("deployments", "list", "--json"),
            ],
        )
        pnpm_runs = [c[0] for c in runner.calls if c[0][:2] == ("pnpm", "run")]
        self.assertEqual(
            pnpm_runs,
            [("pnpm", "run", "build:cloudflare"), ("pnpm", "run", "check:free-tier")],
        )
        self.assertIn("new-v", out)
        self.assertNotIn("old-v", out)

    def test_token_only_reaches_wrangler_env(self):
        runner, out = self.run_deploy()
        for argv, env in runner.calls:
            self.assertNotIn(TOKEN, " ".join(argv))
            if argv[:3] == ("pnpm", "exec", "wrangler"):
                self.assertEqual(env["CLOUDFLARE_API_TOKEN"], TOKEN)
                self.assertEqual(env["CLOUDFLARE_ACCOUNT_ID"], ACCOUNT)
                self.assertEqual(env["WRANGLER_SEND_METRICS"], "false")
            else:
                self.assertNotIn(TOKEN, env.values())
                self.assertNotIn("CLOUDFLARE_API_TOKEN", env)
        self.assertNotIn(TOKEN, out)

    def test_build_gets_the_sitekey(self):
        runner, _ = self.run_deploy()
        [env] = [e for a, e in runner.calls if a == ("pnpm", "run", "build:cloudflare")]
        self.assertEqual(env["VITE_TURNSTILE_SITEKEY"], "0x4AAAAAAFFM5qcR0ciWH4Br")

    def test_keychain_is_read_by_service_and_user(self):
        runner, _ = self.run_deploy()
        [argv] = [a for a, _ in runner.calls if a[0] == "security"]
        self.assertEqual(
            argv,
            (
                "security",
                "find-generic-password",
                "-s",
                "sim-bio-local-deploy",
                "-a",
                "yasushi",
                "-w",
            ),
        )

    def test_wrong_account_stops_before_any_wrangler_or_build(self):
        runner = FakeRunner()
        http = FakeHttp({"success": False, "errors": [{"code": 7403}]}, d1_status=403)
        with self.assertRaises(DeployError):
            self.run_deploy(runner, http)
        self.assertFalse([a for a, _ in runner.calls if a[:2] == ("pnpm", "exec")])
        self.assertFalse([a for a, _ in runner.calls if a[:2] == ("pnpm", "run")])

    def test_failed_step_output_is_redacted_in_print_and_exception(self):
        runner = FakeRunner(
            {
                ("pnpm", "exec", "wrangler", "deploy"): Result(
                    1, f"leak {TOKEN}\n", f"err {TOKEN}\n"
                )
            }
        )
        d, out = deps(runner)
        with self.assertRaises(DeployError) as cm:
            deploy(config(), d, check=False, allow_branch=False)
        self.assertNotIn(TOKEN, str(cm.exception))
        self.assertNotIn(TOKEN, repr(cm.exception))
        self.assertNotIn(TOKEN, out.getvalue())
        self.assertIn("leak ***", out.getvalue())

    def test_failure_after_migrations_points_to_rollback(self):
        runner = FakeRunner(
            {("pnpm", "exec", "wrangler", "deploy"): Result(1, "", "boom")}
        )
        d, _ = deps(runner)
        with self.assertRaises(DeployError) as cm:
            deploy(config(), d, check=False, allow_branch=False)
        self.assertIn("deploy-runbook.md の 6", str(cm.exception))

    def test_smoke_failure_is_an_error(self):
        class Http(FakeHttp):
            def __call__(self, url, headers):
                if url.endswith("/chronicles"):
                    self.calls.append((url, dict(headers)))
                    return 200, b"<html>"
                return super().__call__(url, headers)

        with self.assertRaises(DeployError) as cm:
            self.run_deploy(http=Http())
        self.assertIn("chronicles", str(cm.exception))

    def test_smoke_requests_carry_no_token(self):
        http = FakeHttp()
        self.run_deploy(http=http)
        smoke = [h for u, h in http.calls if "api.cloudflare.com" not in u]
        self.assertEqual(len(smoke), 2)
        for headers in smoke:
            self.assertNotIn(TOKEN, json.dumps(headers))


class DryRunTest(unittest.TestCase):
    def test_dry_run_touches_nothing_and_lists_the_steps(self):
        runner, http = FakeRunner(), FakeHttp()
        d, out = deps(runner, http)
        dry_run(config(), d, check=True)
        self.assertEqual(runner.calls, [])
        self.assertEqual(http.calls, [])
        text = out.getvalue()
        for needle in [
            ACCOUNT,
            "sim-bio-local-deploy",
            "yasushi",
            "pnpm exec wrangler d1 migrations apply biotope-harbor --remote",
            "pnpm exec wrangler deploy",
            "pnpm run check",
            "https://biotope-island.dev-sim-bio.workers.dev/api/v1/chronicles",
        ]:
            self.assertIn(needle, text)
        self.assertLess(text.index("migrations apply"), text.index("wrangler deploy"))

    def test_main_dry_run_with_repo_config(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(["--dry-run", "--root", str(REPO)])
        self.assertEqual(code, 0)
        self.assertIn("biotope-harbor", out.getvalue())

    def test_main_accepts_the_pnpm_double_dash(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(["--", "--dry-run", "--check", "--root", str(REPO)])
        self.assertEqual(code, 0)
        self.assertIn("pnpm run check", out.getvalue())


if __name__ == "__main__":
    unittest.main()
