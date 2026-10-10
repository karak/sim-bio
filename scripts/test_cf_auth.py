import contextlib
import io
import json
import unittest
from pathlib import Path

from cf_auth import (
    REQUIRED_OAUTH_SCOPES,
    AuthTarget,
    OAuthFile,
    Result,
    check_auth,
    main,
    parse_oauth_file,
    parse_whoami,
    wrangler_auth_file,
)

TOKEN = "tok_SECRET_value_1234567890abcdefghijklmn"
OAUTH_SENTINEL = "oauth_SENTINEL_never_print_me"
REFRESH_SENTINEL = "refresh_SENTINEL_never_print_me"
ACCOUNT = "14c725d39e9cf53743be403ab146174f"
OTHER = "0c931a90927cc9835b9b20c32230780c"
DB_ID = "4b9db893-5306-4a01-9eb9-4926c2b34d17"
TARGET = AuthTarget(
    account_id=ACCOUNT,
    d1={"biotope-harbor": DB_ID},
    keychain_service="sim-bio-local-deploy",
    keychain_account=None,
)
CONFIG_PATH = Path("/home/u/Library/Preferences/.wrangler/config/default.toml")

TOML = f'''oauth_token = "{OAUTH_SENTINEL}"
expiration_time = "2026-10-10T06:15:17.231Z"
refresh_token = "{REFRESH_SENTINEL}"
scopes = [ "user:read", "offline_access", "account:read", "workers_scripts:write", "workers_tail:read", "d1:write", "challenge-widgets.write" ]
'''


def whoami_json(accounts, scopes):
    return json.dumps(
        {
            "loggedIn": True,
            "authType": "OAuth Token",
            "email": "someone@example.com",
            "accounts": [{"id": i, "name": n} for i, n in accounts],
            "tokenPermissions": list(scopes),
        }
    )


class FakeRunner:
    """argv の先頭の語の並びで答えを返す。呼ばれた argv と env を控える。"""

    def __init__(self, answers=None):
        self.calls = []
        self.answers = {
            ("security", "find-generic-password"): Result(0, "attributes\n", ""),
            ("pnpm", "exec", "wrangler", "whoami"): Result(
                0, whoami_json([(OTHER, "other")], REQUIRED_OAUTH_SCOPES), ""
            ),
            **(answers or {}),
        }

    def __call__(self, argv, env, cwd):
        self.calls.append((tuple(argv), dict(env)))
        if argv[-1] == "-w" and ("security", "-w") in self.answers:
            return self.answers[("security", "-w")]
        if argv[-1] == "-w":
            return Result(0, TOKEN + "\n", "")
        for n in range(len(argv), 0, -1):
            if tuple(argv[:n]) in self.answers:
                return self.answers[tuple(argv[:n])]
        raise AssertionError(f"思わぬ呼び出し: {argv}")


class FakeHttp:
    def __init__(self, status=200, body=None):
        self.calls = []
        self.status = status
        self.body = body or {
            "success": True,
            "errors": [],
            "result": [{"name": "biotope-harbor", "uuid": DB_ID}],
        }

    def __call__(self, url, headers):
        self.calls.append((url, dict(headers)))
        return self.status, json.dumps(self.body).encode()


ENV = {
    "PATH": "/usr/bin",
    "USER": "yasushi",
    "CLOUDFLARE_API_TOKEN": "ambient-other-account",
}


def run_check(runner=None, http=None, oauth=None, **kw):
    runner = runner or FakeRunner()
    http = http or FakeHttp()
    oauth_file = parse_oauth_file(TOML) if oauth is None else oauth
    report = check_auth(
        TARGET,
        run=runner,
        http_get=http,
        env=ENV,
        cwd=Path("."),
        oauth_file=lambda: (CONFIG_PATH, oauth_file),
        whoami=kw.get("whoami", True),
        verify=kw.get("verify", True),
    )
    return report, runner, http, "\n".join(report.lines)


class OAuthFileTest(unittest.TestCase):
    def test_reads_only_scopes_and_expiry(self):
        parsed = parse_oauth_file(TOML)
        self.assertTrue(parsed.logged_in)
        self.assertEqual(parsed.expires, "2026-10-10T06:15:17.231Z")
        self.assertIn("d1:write", parsed.scopes)
        self.assertNotIn("offline_access", REQUIRED_OAUTH_SCOPES)
        for text in (repr(parsed), str(parsed)):
            self.assertNotIn(OAUTH_SENTINEL, text)
            self.assertNotIn(REFRESH_SENTINEL, text)

    def test_multiline_scopes(self):
        parsed = parse_oauth_file(
            'oauth_token = "x"\nscopes = [\n  "user:read",\n  "d1:write"\n]\n'
        )
        self.assertEqual(parsed.scopes, ("user:read", "d1:write"))

    def test_no_oauth_token_is_not_logged_in(self):
        parsed = parse_oauth_file('scopes = [ "user:read" ]\n')
        self.assertFalse(parsed.logged_in)

    def test_path_prefers_the_legacy_home_dir_only_when_it_exists(self):
        home = Path("/home/u")
        self.assertEqual(
            wrangler_auth_file(home, {}, "darwin", is_dir=lambda p: False),
            home / "Library/Preferences/.wrangler/config/default.toml",
        )
        self.assertEqual(
            wrangler_auth_file(
                home, {}, "darwin", is_dir=lambda p: p == home / ".wrangler"
            ),
            home / ".wrangler/config/default.toml",
        )
        self.assertEqual(
            wrangler_auth_file(
                home, {"XDG_CONFIG_HOME": "/x"}, "linux", is_dir=lambda p: False
            ),
            Path("/x/.wrangler/config/default.toml"),
        )

    def test_xdg_config_home_wins_on_macos_too(self):
        # wrangler の xdg-app-paths は、どの OS でも XDG_CONFIG_HOME を先に見る
        self.assertEqual(
            wrangler_auth_file(
                Path("/home/u"),
                {"XDG_CONFIG_HOME": "/x"},
                "darwin",
                is_dir=lambda p: False,
            ),
            Path("/x/.wrangler/config/default.toml"),
        )


class WhoamiTest(unittest.TestCase):
    def test_parses_accounts_and_scopes(self):
        w = parse_whoami(Result(0, whoami_json([(OTHER, "other")], ["d1:write"]), ""))
        self.assertTrue(w.logged_in)
        self.assertEqual(w.accounts, ((OTHER, "other"),))
        self.assertEqual(w.scopes, ("d1:write",))

    def test_nonzero_or_garbage_is_not_logged_in(self):
        self.assertFalse(parse_whoami(Result(1, "", "Not logged in")).logged_in)
        self.assertFalse(parse_whoami(Result(0, "not json", "")).logged_in)


class CheckAuthTest(unittest.TestCase):
    def test_ready_when_the_keychain_token_reaches_the_account(self):
        report, _, http, text = run_check()
        self.assertTrue(report.ready)
        self.assertEqual(report.token.reveal(), TOKEN)
        self.assertIn("使う道: Keychain のトークン", text)
        self.assertIn("端末の OAuth は使わない", text)
        self.assertIn(f"account {ACCOUNT}", text)
        self.assertIn(DB_ID, text)
        self.assertNotIn(TOKEN, text)
        self.assertNotIn(TOKEN, repr(report))
        [(url, _)] = http.calls
        self.assertIn(f"/accounts/{ACCOUNT}/d1/database", url)

    def test_missing_keychain_item_stops_without_reading_a_secret(self):
        runner = FakeRunner(
            {("security", "find-generic-password"): Result(44, "", "not found")}
        )
        report, runner, http, text = run_check(runner)
        self.assertFalse(report.ready)
        self.assertIsNone(report.token)
        self.assertIn("止める", text)
        self.assertIn("H11", text)
        self.assertIn("H12", text)
        self.assertFalse([a for a, _ in runner.calls if a[-1] == "-w"])
        self.assertEqual(http.calls, [])

    def test_existence_check_never_asks_for_the_value(self):
        _, runner, _, _ = run_check(verify=False)
        security = [a for a, _ in runner.calls if a[0] == "security"]
        self.assertEqual(
            security,
            [
                (
                    "security",
                    "find-generic-password",
                    "-s",
                    "sim-bio-local-deploy",
                    "-a",
                    "yasushi",
                )
            ],
        )

    def test_without_verify_the_token_is_left_for_later(self):
        report, _, http, text = run_check(verify=False)
        self.assertTrue(report.ready)
        self.assertIsNone(report.token)
        self.assertEqual(http.calls, [])
        self.assertIn("使う道: Keychain のトークン", text)

    def test_token_for_another_account_stops(self):
        http = FakeHttp(403, {"success": False, "errors": [{"code": 7403}]})
        report, _, _, text = run_check(http=http)
        self.assertFalse(report.ready)
        self.assertIsNone(report.token)
        self.assertIn("7403", text)
        self.assertIn("止める", text)

    def test_oauth_of_another_account_is_reported_as_unused(self):
        _, _, _, text = run_check()
        self.assertIn(OTHER, text)
        self.assertIn("sim-bio の account ではない", text)
        self.assertIn("スコープ: 要る 6 つはそろっている", text)

    def test_missing_oauth_scopes_are_named(self):
        runner = FakeRunner(
            {
                ("pnpm", "exec", "wrangler", "whoami"): Result(
                    0, whoami_json([(ACCOUNT, "sim-bio")], ["user:read"]), ""
                )
            }
        )
        _, _, _, text = run_check(runner)
        self.assertIn("足りない", text)
        self.assertIn("d1:write", text)
        self.assertIn("sim-bio の account に届く", text)

    def test_not_logged_in(self):
        runner = FakeRunner(
            {("pnpm", "exec", "wrangler", "whoami"): Result(1, "", "not logged in")}
        )
        report, _, _, text = run_check(runner, oauth=OAuthFile(False, (), None))
        self.assertTrue(report.ready)
        self.assertIn("ログインしていない", text)

    def test_whoami_failure_is_not_reported_as_logged_out(self):
        runner = FakeRunner(
            {("pnpm", "exec", "wrangler", "whoami"): Result(1, "", "network")}
        )
        report, _, _, text = run_check(runner)
        self.assertTrue(report.ready)
        self.assertNotIn("ログインしていない", text)
        self.assertIn("whoami が答えない", text)

    def test_runner_failure_stops_with_a_report_not_a_traceback(self):
        def broken(argv, env, cwd):
            raise FileNotFoundError(argv[0])

        report, _, _, text = run_check(broken)
        self.assertFalse(report.ready)
        self.assertIn("止める", text)
        self.assertIn("security", text)

    def test_whoami_sees_only_the_machine_oauth(self):
        _, runner, _, _ = run_check()
        [(argv, env)] = [
            c
            for c in runner.calls
            if c[0][:4] == ("pnpm", "exec", "wrangler", "whoami")
        ]
        self.assertEqual(argv[4:], ("--json",))
        self.assertNotIn("CLOUDFLARE_API_TOKEN", env)
        self.assertEqual(env["WRANGLER_SEND_METRICS"], "false")

    def test_without_whoami_wrangler_is_not_started(self):
        _, runner, _, text = run_check(whoami=False)
        self.assertFalse([a for a, _ in runner.calls if a[0] == "pnpm"])
        self.assertIn("pnpm run cf:auth", text)
        self.assertIn("スコープ: 要る 6 つはそろっている", text)

    def test_oauth_file_tokens_never_reach_the_report(self):
        _, _, _, text = run_check()
        self.assertNotIn(OAUTH_SENTINEL, text)
        self.assertNotIn(REFRESH_SENTINEL, text)
        self.assertIn(str(CONFIG_PATH), text)

    def test_ambient_token_is_said_to_be_ignored(self):
        _, _, _, text = run_check()
        self.assertIn("環境の CLOUDFLARE_API_TOKEN は使わない", text)
        self.assertNotIn("ambient-other-account", text)


class MainTest(unittest.TestCase):
    def test_main_reports_and_fails_when_the_token_path_is_not_ready(self):
        runner = FakeRunner({("security", "find-generic-password"): Result(44, "", "")})
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(
                [],
                run=runner,
                http_get=FakeHttp(),
                env=ENV,
                oauth_file=lambda: (CONFIG_PATH, parse_oauth_file(TOML)),
            )
        self.assertEqual(code, 1)
        self.assertIn("止める", out.getvalue())

    def test_main_succeeds_when_ready(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(
                ["--no-whoami"],
                run=FakeRunner(),
                http_get=FakeHttp(),
                env=ENV,
                oauth_file=lambda: (CONFIG_PATH, parse_oauth_file(TOML)),
            )
        self.assertEqual(code, 0)
        self.assertNotIn(TOKEN, out.getvalue())


if __name__ == "__main__":
    unittest.main()
