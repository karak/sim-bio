# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""要素ごとの基準画の更新の手順 (M25-03、ADR 0001 段 3)。

基準画は tests/e2e/baselines/ にあり、手元の Mac だけで持つ。CI では比べない。
比べが落ちたとき・基準画を足すときに、前後と差の画を審査台 (.claude/localreview/<回>/) に並べる。
人が審査台で「合格」を押した画だけ、基準画を書き換える。押さない画は変わらない。

    pnpm run shots:update                          # 撮って比べ、前後と差を審査台の回に出す (基準画は書き換えない)
    pnpm run shots:update -- --apply <回の名前>    # 審査台で合格にした画だけ基準画へ写す (コミットは人がする)

回の名前は 1 つ目のコマンドが出す (m25-03-20261001-1200 の形)。
審査台は index.html が読む共有の items.json を書き換えない。回の items.json (1 つの group) を共有の groups に足すと並ぶ。
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

BASELINES = Path("tests/e2e/baselines")
VERSIONS = "VERSIONS.json"
ROUND_FILE = "items.json"
CHANGES_FILE = "changes.json"


@dataclass(frozen=True)
class Change:
    """基準画 1 枚の変わり。before が None なら新しい基準画、diff が None なら差の画は無い"""

    name: str
    before: Path | None
    after: Path
    diff: Path | None


def browser_version(executable_path: str) -> str:
    m = re.search(r"chromium\w*-(\d+)", executable_path)
    return f"chromium-{m.group(1)}" if m else "unknown"


def collect(results: Path, stage: Path, baselines: Path) -> list[Change]:
    """撮った結果から変わった基準画を集める。
    落ちた画は results の -expected/-actual/-diff、新しい画は stage に書かれ baselines に無いもの"""
    found: dict[str, Change] = {}
    for actual in sorted(results.rglob("*-actual.png")):
        stem = actual.name.removesuffix("-actual.png")
        expected = actual.with_name(f"{stem}-expected.png")
        diff = actual.with_name(f"{stem}-diff.png")
        found[f"{stem}.png"] = Change(
            f"{stem}.png",
            expected if expected.is_file() else None,
            actual,
            diff if diff.is_file() else None,
        )
    if stage.is_dir():
        for png in sorted(stage.glob("*.png")):
            if png.name not in found and not (baselines / png.name).is_file():
                found[png.name] = Change(png.name, None, png, None)
    return [found[k] for k in sorted(found)]


def _item_id(round_name: str, name: str) -> str:
    return f"{round_name}/{name.removesuffix('.png')}"


def _image(round_name: str, name: str, kind: str, cap: str) -> dict[str, object]:
    return {
        "src": f"{round_name}/{name.removesuffix('.png')}-{kind}.png",
        "cap": cap,
        "local": True,
    }


def group_of(
    changes: Sequence[Change], round_name: str, chromium: str, macos: str
) -> dict[str, object]:
    """審査台の group。項目 1 つが基準画 1 枚で、前・後・差の画を並べる"""
    items = []
    for c in changes:
        images = []
        if c.before is not None:
            images.append(_image(round_name, c.name, "before", "前"))
            images.append(_image(round_name, c.name, "after", "後"))
            if c.diff is not None:
                images.append(_image(round_name, c.name, "diff", "差"))
        else:
            images.append(_image(round_name, c.name, "after", "後 (新しい基準画)"))
        items.append(
            {
                "id": _item_id(round_name, c.name),
                "title": c.name,
                "prev": "基準画が変わる" if c.before else "新しい基準画",
                "changes": [
                    (
                        "合格にすると `pnpm run shots:update -- --apply "
                        f"{round_name}` で基準画が書き換わる。押さなければ変わらない"
                    )
                ],
                "concerns": [],
                "images": images,
            }
        )
    return {
        "name": f"基準画の更新 ({round_name})",
        "commit": f"{chromium}・macOS {macos}",
        "items": items,
    }


def write_round(
    changes: Sequence[Change], group: Mapping[str, object], dest: Path
) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for c in changes:
        stem = c.name.removesuffix(".png")
        shutil.copyfile(c.after, dest / f"{stem}-after.png")
        if c.before is not None:
            shutil.copyfile(c.before, dest / f"{stem}-before.png")
        if c.diff is not None:
            shutil.copyfile(c.diff, dest / f"{stem}-diff.png")
    (dest / ROUND_FILE).write_text(
        json.dumps(group, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    index = {i["id"]: i["title"] for i in group["items"]}  # type: ignore[index, union-attr]
    (dest / CHANGES_FILE).write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def other_failures(report: Mapping[str, object]) -> list[str]:
    """Playwright の json の報告から、基準画の比べ以外で落ちた誤りの先頭行を集める。
    それらの試験は後の画を撮れていないので、回の画は揃わない"""
    out: list[str] = []

    def walk(node: Mapping[str, object]) -> None:
        for spec in node.get("specs", []):  # type: ignore[attr-defined]
            for test in spec.get("tests", []):
                for result in test.get("results", []):
                    for err in result.get("errors", []):
                        msg = str(err.get("message", ""))
                        if (
                            "toHaveScreenshot" in msg
                            or "A snapshot doesn't exist" in msg
                        ):
                            continue
                        out.append(
                            f"{spec.get('title', '?')}: {msg.strip().splitlines()[0] if msg.strip() else ''}"
                        )
        for child in node.get("suites", []):  # type: ignore[attr-defined]
            walk(child)

    walk(report)
    return out


def apply_round(
    round_dir: Path,
    baselines: Path,
    verdicts: Mapping[str, object],
    chromium: str,
    macos: str,
) -> list[str]:
    """審査台で pass を付けた画だけ基準画へ写す。写した名前を返す。1 枚も無ければ何も書かない"""
    index: Mapping[str, str] = json.loads(
        (round_dir / CHANGES_FILE).read_text(encoding="utf-8")
    )
    applied = []
    for item_id, name in index.items():
        v = verdicts.get(item_id)
        if isinstance(v, Mapping) and v.get("verdict") == "pass":
            src = round_dir / f"{name.removesuffix('.png')}-after.png"
            baselines.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, baselines / name)
            applied.append(name)
    if applied:
        (baselines / VERSIONS).write_text(
            json.dumps({"chromium": chromium, "macos": macos}, indent=2) + "\n",
            encoding="utf-8",
        )
    return applied


def refresh_versions(baselines: Path, chromium: str, macos: str) -> bool:
    """基準画が閾値の内のまま版だけ変わったとき、版だけを書き換える (ADR 0001)。書き換えたら True"""
    path = baselines / VERSIONS
    want = {"chromium": chromium, "macos": macos}
    if not baselines.is_dir() or (
        path.is_file() and json.loads(path.read_text(encoding="utf-8")) == want
    ):
        return False
    path.write_text(json.dumps(want, indent=2) + "\n", encoding="utf-8")
    return True


def _run(
    *cmd: str, env: Mapping[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(cmd), capture_output=True, text=True, env=env, check=False
    )


def versions() -> tuple[str, str]:
    exe = _run(
        "node",
        "-e",
        "console.log(require('@playwright/test').chromium.executablePath())",
    ).stdout.strip()
    return browser_version(exe), _run("sw_vers", "-productVersion").stdout.strip()


def review_dir(root: Path) -> Path:
    common = Path(
        _run(
            "git", "rev-parse", "--path-format=absolute", "--git-common-dir"
        ).stdout.strip()
    )
    return common.parent / ".claude" / "localreview"


def main(argv: Sequence[str] | None = None, root: Path | None = None) -> int:
    root = root or Path.cwd()
    os.chdir(root)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", metavar="ROUND", help="審査台で合格にした画だけ基準画へ写す"
    )
    parser.add_argument(
        "--verdicts",
        type=Path,
        help="審査台の判定の写し (既定は審査台の verdicts.json)",
    )
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)
    localreview = review_dir(root)
    chromium, macos = versions()

    if args.apply:
        verdicts_path = args.verdicts or localreview / "verdicts.json"
        verdicts = (
            json.loads(verdicts_path.read_text(encoding="utf-8"))
            if verdicts_path.is_file()
            else {}
        )
        applied = apply_round(
            localreview / args.apply, BASELINES, verdicts, chromium, macos
        )
        for name in applied:
            print(f"基準画を書き換えた: {name}")
        print(
            f"{len(applied)} 枚 (合格でない画は変えていない)。git add {BASELINES} してコミットする"
        )
        return 0

    round_name = "m25-03-" + datetime.datetime.now().astimezone().strftime(
        "%Y%m%d-%H%M"
    )
    work = Path(tempfile.mkdtemp(prefix="shots-update-"))
    stage = work / "baselines"
    shutil.copytree(BASELINES, stage) if BASELINES.is_dir() else stage.mkdir()
    acceptance = work / "acceptance"
    env = {**os.environ, "ACCEPTANCE_DIR": str(acceptance), "BASELINES_DIR": str(stage)}
    env.pop("CI", None)
    report_path = work / "report.json"
    env["PLAYWRIGHT_JSON_OUTPUT_NAME"] = str(report_path)
    subprocess.run(
        [
            "pnpm",
            "exec",
            "playwright",
            "test",
            "tests/e2e/shots.spec.ts",
            "--reporter=line,json",
            "--update-snapshots=missing",
            "--output",
            str(work / "results"),
        ],
        env=env,
        check=False,
    )
    failures = (
        other_failures(json.loads(report_path.read_text(encoding="utf-8")))
        if report_path.is_file()
        else ["playwright の報告が無い"]
    )
    for f in failures:
        print(f"基準画の比べ以外で落ちた: {f}", file=sys.stderr)
    changes = collect(work / "results", stage, BASELINES)
    if not changes:
        if failures:
            return 1
        if refresh_versions(BASELINES, chromium, macos):
            print(f"基準画は閾値の内。版だけ {chromium}・macOS {macos} に書き換えた")
        else:
            print("基準画は変わらない")
        return 0
    dest = localreview / round_name
    write_round(changes, group_of(changes, round_name, chromium, macos), dest)
    print(f"{len(changes)} 枚の変わりを {dest} に出した。審査台で合格にした画だけ:")
    print(f"  pnpm run shots:update -- --apply {round_name}")
    if failures:
        print("上の落ちた試験の画は撮れていない。直して撮り直す", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
