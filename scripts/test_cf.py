import contextlib
import io
import unittest

import cf
from cf_auth import AuthError

TOKEN = "tok_SECRET_value_1234567890abcdefghijklmn"
ACCOUNT = "14c725d39e9cf53743be403ab146174f"
REMOTE_ENV = {
    "PATH": "/usr/bin",
    "CLOUDFLARE_API_TOKEN": TOKEN,
    "CLOUDFLARE_ACCOUNT_ID": ACCOUNT,
}


class Wrangler:
    def __init__(self, code=0):
        self.code = code
        self.calls = []

    def __call__(self, argv, env):
        self.calls.append((list(argv), dict(env)))
        return self.code


class Auth:
    def __init__(self, error=None):
        self.error = error
        self.asked = 0

    def __call__(self, say):
        self.asked += 1
        say("使う道: Keychain のトークン")
        if self.error:
            raise self.error
        return dict(REMOTE_ENV)


def run_main(argv, wrangler, auth):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cf.main(argv, wrangler=wrangler, remote_env=auth)
    return code, out.getvalue(), err.getvalue()


class CfTest(unittest.TestCase):
    def test_wrangler_gets_the_args_and_the_token_only_through_the_env(self):
        wrangler, auth = Wrangler(), Auth()
        code, out, err = run_main(
            ["tail", "biotope-island", "--format", "pretty"], wrangler, auth
        )
        self.assertEqual(code, 0)
        [(argv, env)] = wrangler.calls
        self.assertEqual(argv[1:], ["tail", "biotope-island", "--format", "pretty"])
        self.assertTrue(argv[0].endswith("node_modules/.bin/wrangler"))
        self.assertEqual(env["CLOUDFLARE_API_TOKEN"], TOKEN)
        self.assertEqual(env["CLOUDFLARE_ACCOUNT_ID"], ACCOUNT)
        self.assertNotIn(TOKEN, " ".join(argv) + out + err)
        self.assertIn("使う道: Keychain のトークン", err)

    def test_pnpm_separator_is_dropped(self):
        wrangler = Wrangler()
        run_main(["--", "secret", "list"], wrangler, Auth())
        self.assertEqual(wrangler.calls[0][0][1:], ["secret", "list"])

    def test_exit_code_is_wranglers(self):
        code, _, _ = run_main(["deployments", "list"], Wrangler(code=3), Auth())
        self.assertEqual(code, 3)

    def test_auth_failure_stops_before_wrangler(self):
        wrangler = Wrangler()
        code, _, err = run_main(
            ["secret", "list"], wrangler, Auth(AuthError("項目が無い (H11・H12)"))
        )
        self.assertEqual(code, 1)
        self.assertEqual(wrangler.calls, [])
        self.assertIn("項目が無い (H11・H12)", err)

    def test_login_and_logout_are_refused_without_reading_the_token(self):
        for sub in ("login", "logout"):
            with self.subTest(sub=sub):
                wrangler, auth = Wrangler(), Auth()
                code, _, err = run_main([sub], wrangler, auth)
                self.assertEqual(code, 2)
                self.assertEqual((wrangler.calls, auth.asked), ([], 0))
                self.assertIn("deploy-runbook.md", err)

    def test_no_args_prints_usage_without_reading_the_token(self):
        wrangler, auth = Wrangler(), Auth()
        code, _, err = run_main([], wrangler, auth)
        self.assertEqual(code, 2)
        self.assertEqual((wrangler.calls, auth.asked), ([], 0))
        self.assertIn("pnpm run cf", err)


if __name__ == "__main__":
    unittest.main()
