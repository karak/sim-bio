import tempfile
import unittest
from pathlib import Path

from check_free_tier import (
    MAX_FILE_BYTES,
    MAX_FILES,
    IgnoreRules,
    check_assets,
    check_assetsignore,
    check_config,
    check_repo,
    parse_jsonc,
)

REPO = Path(__file__).resolve().parent.parent
BASE_CONFIG = {
    "name": "biotope-island",
    "main": "worker/src/index.ts",
    "compatibility_date": "2026-09-25",
    "assets": {"directory": "./dist"},
}
ASSETSIGNORE = "*.blend\ntextures/concept/**\n"


def where_of(violations):
    return [(v.rule, v.where) for v in violations]


class ParseJsoncTest(unittest.TestCase):
    def test_drops_comments_and_trailing_commas_but_keeps_slashes_in_strings(self):
        text = """{
          // 行のコメント
          "$schema": "https://example.com/a//b", /* 塊の
          コメント */
          "list": [1, 2,],
          "s": "a /* not a comment */ b",
          "t": "x, ]",
        }"""
        self.assertEqual(
            parse_jsonc(text),
            {
                "$schema": "https://example.com/a//b",
                "list": [1, 2],
                "s": "a /* not a comment */ b",
                "t": "x, ]",
            },
        )

    def test_keeps_escaped_quotes_inside_strings(self):
        self.assertEqual(parse_jsonc('{"a": "x\\" // y"}'), {"a": 'x" // y'})


class CheckConfigTest(unittest.TestCase):
    def test_current_wrangler_jsonc_passes(self):
        config = parse_jsonc((REPO / "wrangler.jsonc").read_text(encoding="utf-8"))
        self.assertEqual(check_config(config), [])

    def test_bindings_outside_the_design_fail(self):
        for key in [
            "r2_buckets",
            "queues",
            "analytics_engine_datasets",
            "browser",
            "ai",
            "vectorize",
            "kv_namespaces",
            "durable_objects",
            "hyperdrive",
            "logpush",
        ]:
            with self.subTest(key=key):
                violations = check_config({**BASE_CONFIG, key: [{"binding": "X"}]})
                self.assertEqual(where_of(violations), [("binding", key)])

    def test_r2_says_it_would_bill(self):
        [violation] = check_config({**BASE_CONFIG, "r2_buckets": []})
        self.assertIn("課金", violation.why)

    def test_unknown_key_fails_until_it_is_added_to_the_table(self):
        violations = check_config({**BASE_CONFIG, "some_future_product": {}})
        self.assertEqual(where_of(violations), [("binding", "some_future_product")])
        self.assertIn("表に無い", violations[0].why)

    def test_d1_ratelimits_and_cron_are_allowed_for_m19_08(self):
        config = {
            **BASE_CONFIG,
            "d1_databases": [
                {"binding": "HARBOR", "database_name": "h", "database_id": "0"}
            ],
            "ratelimits": [
                {
                    "name": "PUBLISH",
                    "namespace_id": "1001",
                    "simple": {"limit": 5, "period": 60},
                }
            ],
            "triggers": {"crons": ["0 3 * * *"]},
            "vars": {"TURNSTILE_SITE_KEY": "x"},
        }
        self.assertEqual(check_config(config), [])

    def test_usage_model_fails_whatever_its_value(self):
        for value in ["unbound", "bundled", "standard"]:
            with self.subTest(value=value):
                violations = check_config({**BASE_CONFIG, "usage_model": value})
                self.assertEqual(where_of(violations), [("usage_model", "usage_model")])

    def test_limits_override_fails(self):
        violations = check_config({**BASE_CONFIG, "limits": {"cpu_ms": 300000}})
        self.assertEqual(where_of(violations), [("limits", "limits")])

    def test_environments_are_checked_like_the_top_level(self):
        config = {
            **BASE_CONFIG,
            "env": {
                "staging": {"name": "s", "r2_buckets": []},
                "production": {"limits": {"cpu_ms": 50}},
            },
        }
        self.assertEqual(
            where_of(check_config(config)),
            [
                ("binding", "env.staging.r2_buckets"),
                ("limits", "env.production.limits"),
            ],
        )


class IgnoreRulesTest(unittest.TestCase):
    def test_matches_like_gitignore(self):
        cases = [
            ("*.blend", "deer.blend", True),
            ("*.blend", "models/deer.blend", True),
            ("*.blend", "models/deer.blend.glb", False),
            ("/models/*.glb", "models/deer.glb", True),
            ("/models/*.glb", "models/observe/deer.glb", False),
            ("/models/*.glb", "x/models/deer.glb", False),
            ("textures/concept/**", "textures/concept/a/b.png", True),
            ("textures/concept/**", "textures/conceptual/b.png", False),
            ("textures/concept/**", "x/textures/concept/b.png", False),
            ("**/README.md", "README.md", True),
            ("**/README.md", "models/README.md", True),
            ("**/.gitkeep", "a/b/.gitkeep", True),
            ("drafts/", "drafts/a.png", True),
            ("drafts/", "drafts", False),
            ("models", "models/observe/a.glb", True),
            ("a?.png", "ab.png", True),
            ("a?.png", "a/.png", False),
        ]
        for pattern, path, expected in cases:
            with self.subTest(pattern=pattern, path=path):
                self.assertEqual(IgnoreRules.parse(pattern).ignores(path), expected)

    def test_comments_blank_lines_and_negation(self):
        rules = IgnoreRules.parse("# *.png\n\n*.blend\n!keep.blend\n")
        self.assertFalse(rules.ignores("a.png"))
        self.assertTrue(rules.ignores("a.blend"))
        self.assertFalse(rules.ignores("keep.blend"))

    def test_rejects_syntax_it_cannot_match_instead_of_miscounting(self):
        for pattern in ["*.[ch]", "\\#file", "a\\ b"]:
            with self.subTest(pattern=pattern), self.assertRaises(ValueError):
                IgnoreRules.parse(pattern)


class CheckAssetsignoreTest(unittest.TestCase):
    def test_current_assetsignore_passes(self):
        text = (REPO / "assets" / ".assetsignore").read_text(encoding="utf-8")
        self.assertEqual(check_assetsignore(IgnoreRules.parse(text)), [])

    def test_missing_blend_fails(self):
        violations = check_assetsignore(IgnoreRules.parse("textures/concept/**\n"))
        self.assertEqual(where_of(violations), [("assetsignore", "*.blend")])

    def test_missing_concept_fails(self):
        violations = check_assetsignore(IgnoreRules.parse("*.blend\n"))
        self.assertEqual(
            where_of(violations), [("assetsignore", "textures/concept/**")]
        )

    def test_commented_out_negated_or_narrowed_lines_fail(self):
        for text in [
            "# *.blend\ntextures/concept/**\n",
            "*.blend\n!deer.blend\ntextures/concept/**\n",
            "/*.blend\ntextures/concept/**\n",
        ]:
            with self.subTest(text=text):
                violations = check_assetsignore(IgnoreRules.parse(text))
                self.assertEqual(where_of(violations), [("assetsignore", "*.blend")])

    def test_concept_without_its_subfolders_fails(self):
        violations = check_assetsignore(
            IgnoreRules.parse("*.blend\ntextures/concept/*.png\n")
        )
        self.assertEqual(
            where_of(violations), [("assetsignore", "textures/concept/**")]
        )


class CheckAssetsTest(unittest.TestCase):
    rules = IgnoreRules.parse(ASSETSIGNORE)

    def files(self, n):
        return [(f"data/{i}.json", 10) for i in range(n)]

    def test_file_count_at_the_limit_passes_and_one_more_fails(self):
        self.assertEqual(check_assets(self.files(MAX_FILES), self.rules), [])
        violations = check_assets(self.files(MAX_FILES + 1), self.rules)
        self.assertEqual(where_of(violations), [("file_count", "20001 files")])

    def test_file_size_at_the_limit_passes_and_one_byte_more_fails(self):
        self.assertEqual(
            check_assets([("models/a.glb", MAX_FILE_BYTES)], self.rules), []
        )
        violations = check_assets([("models/a.glb", MAX_FILE_BYTES + 1)], self.rules)
        self.assertEqual(where_of(violations), [("file_size", "models/a.glb")])

    def test_ignored_files_are_neither_counted_nor_sized(self):
        entries = [
            *self.files(MAX_FILES),
            ("models/deer.blend", MAX_FILE_BYTES * 4),
            ("textures/concept/a.png", 10),
        ]
        self.assertEqual(check_assets(entries, self.rules), [])


class CheckRepoTest(unittest.TestCase):
    def make_repo(self, root: Path, assetsignore: str | None = ASSETSIGNORE):
        (root / "wrangler.jsonc").write_text(
            '{\n  // 設計書 §3.3\n  "name": "t",\n  "assets": { "directory": "./dist", },\n}\n',
            encoding="utf-8",
        )
        dist = root / "dist"
        (dist / "models").mkdir(parents=True)
        (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
        if assetsignore is not None:
            (dist / ".assetsignore").write_text(assetsignore, encoding="utf-8")
        return dist

    def sparse(self, path: Path, size: int):
        with path.open("wb") as f:
            f.truncate(size)

    def test_passes_when_the_big_file_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = self.make_repo(Path(tmp))
            self.sparse(dist / "models" / "deer.blend", MAX_FILE_BYTES + 1)
            self.assertEqual(check_repo(Path(tmp)), [])

    def test_skips_the_files_wrangler_never_uploads(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = self.make_repo(Path(tmp))
            for name in ["_headers", "_redirects"]:
                self.sparse(dist / name, MAX_FILE_BYTES + 1)
            self.sparse(dist / "models" / "_headers", MAX_FILE_BYTES + 1)
            self.assertEqual(
                where_of(check_repo(Path(tmp))), [("file_size", "models/_headers")]
            )

    def test_fails_on_a_big_file_that_is_deployed(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = self.make_repo(Path(tmp))
            self.sparse(dist / "models" / "deer.glb", MAX_FILE_BYTES + 1)
            self.assertEqual(
                where_of(check_repo(Path(tmp))), [("file_size", "models/deer.glb")]
            )

    def test_fails_when_dist_has_no_assetsignore(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.make_repo(Path(tmp), assetsignore=None)
            self.assertEqual(
                where_of(check_repo(Path(tmp))),
                [("assetsignore", "dist/.assetsignore")],
            )

    def test_fails_when_dist_is_not_built(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = self.make_repo(Path(tmp))
            for path in sorted(dist.rglob("*"), reverse=True):
                path.rmdir() if path.is_dir() else path.unlink()
            dist.rmdir()
            violations = check_repo(Path(tmp))
            self.assertEqual(where_of(violations), [("dist", "dist")])
            self.assertIn("build:cloudflare", violations[0].why)

    def test_config_violations_are_reported_with_the_asset_ones(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.make_repo(Path(tmp), assetsignore="textures/concept/**\n")
            (Path(tmp) / "wrangler.jsonc").write_text(
                '{"name": "t", "assets": {"directory": "./dist"}, "r2_buckets": []}',
                encoding="utf-8",
            )
            self.assertEqual(
                where_of(check_repo(Path(tmp))),
                [("binding", "r2_buckets"), ("assetsignore", "*.blend")],
            )


if __name__ == "__main__":
    unittest.main()
