"""commit-msg hook (.githooks/commit-msg) の単体テスト。"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".githooks" / "commit-msg"
GOOD = "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
OPUS = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"


def run_hook(
    message: str, env_extra: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    env = {k: v for k, v in os.environ.items() if k != "SKIP_TRAILER_HOOK"}
    env.update(env_extra or {})
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "COMMIT_EDITMSG"
        path.write_text(message, encoding="utf-8")
        return subprocess.run(
            ["sh", str(HOOK), str(path)],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )


class CommitMsgHookTest(unittest.TestCase):
    def test_correct_trailer_passes(self) -> None:
        r = run_hook(f"feat: x\n\nbody\n\n{GOOD}\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stderr, "")

    def test_opus_trailer_rejected(self) -> None:
        r = run_hook(f"feat: x\n\n{OPUS}\n")
        self.assertEqual(r.returncode, 1)
        self.assertIn(OPUS, r.stderr)
        self.assertIn(GOOD, r.stderr)

    def test_missing_trailer_rejected(self) -> None:
        r = run_hook("feat: x\n\nbody\n")
        self.assertEqual(r.returncode, 1)
        self.assertIn(GOOD, r.stderr)

    def test_trailer_not_in_last_paragraph_rejected(self) -> None:
        r = run_hook(f"feat: x\n\n{GOOD}\n\nあとから足した段落\n")
        self.assertEqual(r.returncode, 1)

    def test_merge_message_exempt(self) -> None:
        r = run_hook("Merge branch 'a' into b\n")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_fixup_and_revert_exempt(self) -> None:
        for msg in ("fixup! feat: x\n", "squash! feat: x\n", 'Revert "feat: x"\n'):
            with self.subTest(msg=msg):
                self.assertEqual(run_hook(msg).returncode, 0)

    def test_bypass_env(self) -> None:
        r = run_hook("feat: x\n", {"SKIP_TRAILER_HOOK": "1"})
        self.assertEqual(r.returncode, 0)
        self.assertIn("SKIP_TRAILER_HOOK", r.stderr)


if __name__ == "__main__":
    unittest.main()
