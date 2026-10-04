"""タイトルまわりの W/F (M24-00) を SVG に書き出す。色は灰の濃淡だけ。

使い方: python3 docs/uiux/wireframes/make_wireframes.py
同じフォルダに <画面>-desktop.svg (1280x720) と <画面>-narrow.svg (390x844) を書く。
"""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent

# 灰の濃淡 (濃い順)
INK = "#222"
DARK = "#555"
MID = "#888"
LIGHT = "#bbb"
PALE = "#ddd"
PAPER = "#f2f2f2"
WHITE = "#fff"
FONT = "Hiragino Sans, Noto Sans JP, system-ui, sans-serif"


class Svg:
    def __init__(self, w: int, h: int, title: str):
        self.w, self.h = w, h
        self.parts: list[str] = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}">',
            f"<title>{escape(title)}</title>",
            f'<rect width="{w}" height="{h}" fill="{PAPER}"/>',
        ]

    def rect(self, x, y, w, h, fill=WHITE, stroke=MID, r=4, dash=False, sw=1.5):
        d = ' stroke-dasharray="6 4"' if dash else ""
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def text(self, x, y, s, size=14, fill=INK, anchor="start", weight="normal"):
        self.parts.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{escape(s)}</text>')

    def cross(self, x, y, w, h):
        """画像の置き場 (灰の四角に×)"""
        self.rect(x, y, w, h, fill=PALE, stroke=LIGHT, r=0)
        self.parts.append(f'<path d="M{x} {y}L{x + w} {y + h}M{x + w} {y}L{x} {y + h}" stroke="{LIGHT}" stroke-width="1"/>')

    def note(self, x, y, s, size=12):
        """注 (破線の吹き出し)"""
        width = int(len(s) * size * 0.95) + 16
        self.rect(x, y, width, size + 12, fill=WHITE, stroke=DARK, r=2, dash=True, sw=1)
        self.text(x + 8, y + size + 3, s, size=size, fill=DARK)

    def button(self, x, y, w, h, label, primary=False, size=16, sub=None, disabled=False):
        fill = DARK if primary else WHITE
        fg = WHITE if primary else (LIGHT if disabled else INK)
        self.rect(x, y, w, h, fill=fill, stroke=INK if primary else (PALE if disabled else MID), r=6, sw=2 if primary else 1.5)
        ty = y + h / 2 + size * 0.35 - (7 if sub else 0)
        self.text(x + 16, ty, label, size=size, fill=fg, weight="bold" if primary else "normal")
        if sub:
            self.text(x + 16, ty + 18, sub, size=12, fill=PALE if primary else MID)

    def save(self, name: str):
        self.parts.append("</svg>")
        (OUT / name).write_text("\n".join(self.parts) + "\n", encoding="utf-8")


def frame_label(s: Svg, label: str):
    s.text(s.w - 12, s.h - 10, label, size=11, fill=MID, anchor="end")


def background(s: Svg, x, y, w, h, label="背景のデモ (島・月鹿の群れ・海。操作できない)", lx=None, ly=None):
    s.cross(x, y, w, h)
    s.text(lx if lx is not None else x + w / 2, ly if ly is not None else y + h / 2, label, size=14, fill=MID, anchor="middle")


def scrim(s: Svg, x, y, w, h):
    s.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{INK}" fill-opacity="0.55"/>')


def logo(s: Svg, x, y, w, h):
    s.rect(x, y, w, h, fill=MID, stroke=INK, r=2)
    s.text(x + w / 2, y + h / 2 - 2, "ロゴ (石板と動物の紋)", size=16, fill=WHITE, anchor="middle", weight="bold")
    s.text(x + w / 2, y + h / 2 + 18, "沈みゆく島の命を、見守る", size=12, fill=PALE, anchor="middle")


MENU = [
    ("続きから", "自由モード · 12 年 · 10/04 18:40"),
    ("新規ゲーム", None),
    ("ロード", None),
    ("港", None),
    ("コンフィグ", None),
]


def menu(s: Svg, x, y, w, h=52, gap=10):
    for i, (label, sub) in enumerate(MENU):
        s.button(x, y + i * (h + gap), w, h, label, primary=i == 0, sub=sub)
    return y + len(MENU) * (h + gap)


def back_bar(s: Svg, x, y, title, w):
    s.button(x, y, 96, 36, "← 戻る", size=14)
    s.text(x + 116, y + 25, title, size=20, weight="bold")
    s.text(x + w, y + 24, "Esc でタイトルへ", size=12, fill=MID, anchor="end")


def panel_bg(s: Svg):
    """板の後ろはタイトルの背景を暗くしたもの"""
    background(s, 0, 0, s.w, s.h, label="")
    scrim(s, 0, 0, s.w, s.h)


# ---------------------------------------------------------------- タイトル

def title_desktop():
    s = Svg(1280, 720, "タイトル (デスクトップ)")
    background(s, 0, 0, 1280, 720, lx=880, ly=460)
    scrim(s, 0, 0, 470, 720)
    logo(s, 64, 72, 340, 130)
    end = menu(s, 64, 260, 300)
    s.text(64, end + 24, "↑↓ で選ぶ · Enter で決める", size=12, fill=PALE)
    s.text(64, 690, "v0.x · 港: 押すまで問い合わせない", size=11, fill=LIGHT)
    s.note(500, 290, "既定 (フォーカス): 続きがあれば「続きから」、無ければ「新規ゲーム」")
    s.note(500, 330, "「続きから」は続きが無いときは出さない (4 行になる)")
    s.note(500, 610, "背景の主役は右 2/3。メニューの左 1/3 には暗い帯 (0.55 以上)")
    s.note(500, 650, "prefers-reduced-motion なら止めた絵")
    frame_label(s, "title-desktop 1280x720")
    s.save("title-desktop.svg")


def title_narrow():
    s = Svg(390, 844, "タイトル (狭い画面)")
    background(s, 0, 0, 390, 844, label="背景のデモ (操作できない)", ly=350)
    scrim(s, 0, 380, 390, 464)
    logo(s, 40, 56, 310, 120)
    menu(s, 24, 420, 342, h=50, gap=10)
    s.note(24, 220, "主役 (群れ) は上半分")
    s.note(24, 250, "メニューは親指の届く下半分")
    frame_label(s, "title-narrow 390x844")
    s.save("title-narrow.svg")


# ---------------------------------------------------------------- 新規ゲーム (石板を選ぶ)

SCEN = [
    ("沈む欠片", "耐える", "100 年", True),
    ("星が落ちる夜", "耐える", "90 年", False),
    ("火の山の目覚め", "耐える", "130 年", False),
    ("豊かさの罠", "防ぐ", "100 年", False),
    ("生気の飢饉", "防ぐ", "100 年", False),
    ("塔の重さ", "耐える", "100 年", False),
    ("祈りに応えるな", "耐える", "100 年", False),
    ("霊脈枯れ", "耐える", "100 年", False),
    ("迎撃の塔", "防ぐ", "150 年", False),
    ("空の舟", "逃がす", "200 年", False),
]


def new_game_desktop():
    s = Svg(1280, 720, "新規ゲーム (デスクトップ)")
    panel_bg(s)
    s.rect(48, 40, 1184, 640, fill=WHITE, stroke=INK, r=8, sw=2)
    back_bar(s, 72, 60, "新規ゲーム", 1136)
    # 左: 一覧
    s.button(72, 116, 420, 56, "自由モード", sub="制約の無い島。好きに介入する")
    s.text(72, 198, "石板 (予言に抗う)", size=13, fill=MID)
    for i, (t, k, y, cont) in enumerate(SCEN):
        yy = 208 + i * 44
        sel = i == 0
        s.rect(72, yy, 420, 38, fill=PALE if sel else WHITE, stroke=INK if sel else LIGHT, r=4, sw=2 if sel else 1)
        s.text(88, yy + 25, t, size=15, weight="bold" if sel else "normal")
        s.text(330, yy + 25, f"{k} · {y}", size=12, fill=MID)
        if cont:
            s.rect(420, yy + 9, 62, 20, fill=WHITE, stroke=DARK, r=10)
            s.text(451, yy + 24, "続きあり", size=11, fill=DARK, anchor="middle")
    # 右: 詳細
    s.rect(520, 116, 688, 540, fill=PAPER, stroke=LIGHT, r=6)
    s.cross(544, 140, 640, 180)
    s.text(864, 236, "石板の絵 (動物の紋) · 任意", size=12, fill=MID, anchor="middle")
    s.text(544, 356, "沈む欠片", size=24, weight="bold")
    s.text(544, 382, "耐える · 100 年 · 続きあり (34 年)", size=13, fill=MID)
    for i in range(4):
        s.rect(544, 402 + i * 24, 620 - i * 60, 12, fill=LIGHT, stroke=LIGHT, r=2)
    s.text(544, 518, "予言の文 (石板の prophecy をそのまま)", size=12, fill=MID)
    s.button(544, 572, 240, 56, "続きから始める", primary=True)
    s.button(800, 572, 240, 56, "初めから始める")
    s.note(800, 520, "続きが無い石板は「この石板で始める」1 つだけ")
    frame_label(s, "new-game-desktop 1280x720")
    s.save("new-game-desktop.svg")


def new_game_narrow():
    s = Svg(390, 844, "新規ゲーム (狭い画面)")
    s.rect(0, 0, 390, 844, fill=WHITE, stroke=WHITE, r=0)
    back_bar(s, 16, 16, "新規ゲーム", 358)
    s.button(16, 68, 358, 56, "自由モード", sub="制約の無い島")
    s.text(16, 150, "石板 (予言に抗う)", size=13, fill=MID)
    for i, (t, k, y, cont) in enumerate(SCEN[:7]):
        yy = 160 + i * 46
        s.rect(16, yy, 358, 40, fill=WHITE, stroke=LIGHT, r=4, sw=1)
        s.text(30, yy + 26, t, size=15)
        s.text(360, yy + 26, f"{k} · {y}", size=12, fill=MID, anchor="end")
    s.text(16, 488, "… 続きは縦にスクロール", size=12, fill=MID)
    # 下から出る詳細のシート
    s.rect(0, 540, 390, 304, fill=PAPER, stroke=INK, r=14, sw=2)
    s.rect(165, 550, 60, 5, fill=MID, stroke=MID, r=2)
    s.text(16, 590, "沈む欠片", size=20, weight="bold")
    s.text(16, 612, "耐える · 100 年 · 続きあり (34 年)", size=12, fill=MID)
    for i in range(3):
        s.rect(16, 628 + i * 20, 340 - i * 50, 10, fill=LIGHT, stroke=LIGHT, r=2)
    s.button(16, 706, 358, 50, "続きから始める", primary=True)
    s.button(16, 766, 358, 50, "初めから始める")
    s.note(200, 508, "押した石板の詳細が下から出る", size=11)
    frame_label(s, "new-game-narrow 390x844")
    s.save("new-game-narrow.svg")


# ---------------------------------------------------------------- ロード

SLOTS = [
    ("自動の枠", "自由モード · 12 年 · 10/04 18:40", True),
    ("枠 1", "『沈む欠片』 · 34 年 · 10/03 21:12", True),
    ("枠 2", "自由モード · 80 年 · 10/02 09:05", True),
    ("枠 3", "空", False),
]


def load_desktop():
    s = Svg(1280, 720, "ロード (デスクトップ)")
    panel_bg(s)
    s.rect(240, 60, 800, 600, fill=WHITE, stroke=INK, r=8, sw=2)
    back_bar(s, 264, 80, "ロード", 752)
    for i, (n, sub, filled) in enumerate(SLOTS):
        yy = 140 + i * 80
        s.rect(264, yy, 752, 68, fill=WHITE if filled else PAPER, stroke=MID if filled else PALE, r=6, dash=not filled)
        s.cross(280, yy + 10, 84, 48)
        s.text(380, yy + 30, n, size=16, weight="bold", fill=INK if filled else MID)
        s.text(380, yy + 52, sub, size=13, fill=MID)
        if filled:
            s.button(880, yy + 14, 120, 40, "読み込む", size=14, primary=i == 0)
    s.button(264, 470, 260, 48, "ファイルから読む…", size=15)
    s.text(540, 500, "保存したファイル (.json) を選ぶ", size=12, fill=MID)
    s.note(264, 548, "読むと確かめ (askOf load の「舞台を移って読む」)。舞台はいつも包みの舞台")
    s.note(264, 588, "自由モードの枠を読むと自動の枠が上書きされる → 確かめの文に「(自動の枠は上書きされます)」を添える")
    frame_label(s, "load-desktop 1280x720")
    s.save("load-desktop.svg")


def load_narrow():
    s = Svg(390, 844, "ロード (狭い画面)")
    s.rect(0, 0, 390, 844, fill=WHITE, stroke=WHITE, r=0)
    back_bar(s, 16, 16, "ロード", 358)
    for i, (n, sub, filled) in enumerate(SLOTS):
        yy = 72 + i * 92
        s.rect(16, yy, 358, 80, fill=WHITE if filled else PAPER, stroke=MID if filled else PALE, r=6, dash=not filled)
        s.text(32, yy + 30, n, size=16, weight="bold", fill=INK if filled else MID)
        s.text(32, yy + 54, sub, size=12, fill=MID)
        if filled:
            s.text(358, yy + 30, "読む ›", size=14, fill=DARK, anchor="end")
    s.button(16, 450, 358, 50, "ファイルから読む…", size=15)
    # 確かめの板
    scrim(s, 0, 520, 390, 324)
    s.rect(24, 560, 342, 240, fill=WHITE, stroke=INK, r=10, sw=2)
    s.text(44, 600, "確かめ (いまの askOf load の板)", size=13, fill=MID)
    s.text(44, 630, "舞台を移って読む", size=15, weight="bold")
    s.text(44, 656, "(planSlotLoad の confirm の文)", size=12, fill=MID)
    s.button(44, 690, 302, 44, "移って読む", primary=True, size=15)
    s.button(44, 742, 302, 44, "やめる", size=15)
    s.note(150, 520 - 4, "枠を押すと確かめ (いまの板と同じ)", size=11)
    frame_label(s, "load-narrow 390x844")
    s.save("load-narrow.svg")


# ---------------------------------------------------------------- コンフィグ

def seg(s: Svg, x, y, opts, on, w=110):
    for i, o in enumerate(opts):
        sel = i == on
        s.rect(x + i * w, y, w, 36, fill=DARK if sel else WHITE, stroke=MID, r=0)
        s.text(x + i * w + w / 2, y + 24, o, size=14, fill=WHITE if sel else INK, anchor="middle")


CONFIG = [
    ("画質", "観察画面の影・草・解像度", ["自動", "軽い", "きれい"], 0),
    ("動きを減らす", "背景の動き・ピンの揺れ", ["OS に従う", "入", "切"], 0),
    ("最初の速さ", "島を開いたときの速さ (いまは 1x)", ["1x", "10x"], 0),
]


def config_desktop():
    s = Svg(1280, 720, "コンフィグ (デスクトップ)")
    panel_bg(s)
    s.rect(240, 80, 800, 560, fill=WHITE, stroke=INK, r=8, sw=2)
    back_bar(s, 264, 100, "コンフィグ", 752)
    for i, (name, sub, opts, on) in enumerate(CONFIG):
        yy = 170 + i * 96
        s.text(264, yy + 20, name, size=17, weight="bold")
        s.text(264, yy + 44, sub, size=12, fill=MID)
        seg(s, 640, yy + 2, opts, on)
        s.parts.append(f'<line x1="264" y1="{yy + 72}" x2="1016" y2="{yy + 72}" stroke="{PALE}"/>')
    s.text(264, 488, "変えた値はその場で保存し、次の起動でも戻る", size=13, fill=MID)
    s.button(264, 520, 200, 44, "既定に戻す", size=14)
    s.note(264, 584, "推し (案 A) の 3 項目。案 B なら「判定の板の位置を戻す」「手元の島を消す」が下に並ぶ")
    frame_label(s, "config-desktop 1280x720")
    s.save("config-desktop.svg")


def config_narrow():
    s = Svg(390, 844, "コンフィグ (狭い画面)")
    s.rect(0, 0, 390, 844, fill=WHITE, stroke=WHITE, r=0)
    back_bar(s, 16, 16, "コンフィグ", 358)
    for i, (name, sub, opts, on) in enumerate(CONFIG):
        yy = 80 + i * 132
        s.text(16, yy + 20, name, size=17, weight="bold")
        s.text(16, yy + 42, sub, size=12, fill=MID)
        seg(s, 16, yy + 58, opts, on, w=int(358 / len(opts)))
    s.text(16, 500, "変えた値はその場で保存", size=13, fill=MID)
    s.button(16, 520, 358, 48, "既定に戻す", size=15)
    frame_label(s, "config-narrow 390x844")
    s.save("config-narrow.svg")


# ---------------------------------------------------------------- 港 (タイトルから)

CARDS = [
    ("ムカノラの島", "「まだ、ここにいる」", "沈む欠片を 100 年、生き延びた · 3 人がたどって確かめた"),
    ("ハリンの洲", "「また始めよう」", "空の舟の 182 年目に、次の島へ逃れた"),
    ("エタモロの環", "「海が勝った」", "火の山の目覚めの 80 年目に滅びた"),
]


def harbor_desktop():
    s = Svg(1280, 720, "港 (タイトルから、デスクトップ)")
    panel_bg(s)
    s.rect(200, 40, 880, 640, fill=WHITE, stroke=INK, r=8, sw=2)
    s.text(224, 84, "港", size=22, weight="bold")
    s.text(264, 84, "流れ着いた島の年代記", size=13, fill=MID)
    s.button(952, 60, 104, 36, "閉じる", size=14)
    # 自分の判定の出た島
    s.rect(224, 112, 832, 84, fill=PAPER, stroke=MID, r=6)
    s.text(240, 140, "『沈む欠片』で最後に判定の出た島", size=14, weight="bold")
    s.text(240, 164, "港へ出す: ひとことを刻んで、港に並べる", size=12, fill=MID)
    s.button(880, 130, 160, 44, "出港する…", size=14, primary=True)
    s.text(224, 226, "港は開いている", size=12, fill=MID)
    for i, (n, ins, end) in enumerate(CARDS):
        yy = 240 + i * 100
        s.rect(224, yy, 832, 88, fill=WHITE, stroke=MID, r=6)
        s.text(240, yy + 28, n, size=16, weight="bold")
        s.text(240, yy + 52, ins, size=13, fill=DARK)
        s.text(240, yy + 74, end, size=12, fill=MID)
        s.button(900, yy + 22, 140, 44, "訪れる", size=14)
    s.button(224, 548, 180, 40, "もっと古い年代記", size=14)
    s.note(224, 606, "浜の漂着 (受け取る) は島が要るので出さない:「浜は島の中で」")
    s.note(224, 640, "閉港: HARBOR_CLOSED_TEXT / 空: HARBOR_EMPTY_TEXT +「石板を選ぶ」")
    frame_label(s, "harbor-desktop 1280x720")
    s.save("harbor-desktop.svg")


def harbor_narrow():
    s = Svg(390, 844, "港 (タイトルから、狭い画面)")
    s.rect(0, 0, 390, 844, fill=WHITE, stroke=WHITE, r=0)
    s.text(16, 44, "港", size=22, weight="bold")
    s.text(52, 44, "流れ着いた島の年代記", size=12, fill=MID)
    s.button(278, 18, 96, 36, "閉じる", size=14)
    # 空状態の例
    s.rect(16, 76, 358, 150, fill=PAPER, stroke=MID, r=6, dash=True)
    s.text(32, 108, "空のとき", size=12, fill=MID)
    s.text(32, 134, "まだ誰の年代記も流れ着いていない。", size=13)
    s.text(32, 156, "石板の判定のあとに、自分の島を港へ出せる", size=13)
    s.button(32, 172, 200, 40, "石板を選ぶ", size=14, primary=True)
    s.text(16, 254, "開いているとき", size=12, fill=MID)
    for i, (n, ins, end) in enumerate(CARDS):
        yy = 266 + i * 132
        s.rect(16, yy, 358, 120, fill=WHITE, stroke=MID, r=6)
        s.text(32, yy + 28, n, size=16, weight="bold")
        s.text(32, yy + 50, ins, size=13, fill=DARK)
        s.text(32, yy + 70, end, size=11, fill=MID)
        s.button(32, yy + 78, 120, 34, "訪れる", size=13)
    s.note(16, 668, "押すまで港に問い合わせない (M19-09)", size=11)
    frame_label(s, "harbor-narrow 390x844")
    s.save("harbor-narrow.svg")


# ---------------------------------------------------------------- 操作画面の「タイトルへ」

def stage_desktop():
    s = Svg(1280, 720, "操作画面のタイトルへ (デスクトップ)")
    background(s, 0, 0, 1280, 720, label="操作画面 (いまの作り。島の 3D の地図)")
    s.rect(12, 12, 300, 92, fill=WHITE, stroke=MID, r=6)
    s.text(24, 36, "時間の箱 (年・速さの列・3D で見る)", size=12, fill=MID)
    s.button(24, 58, 120, 34, "≡ タイトルへ", size=13, primary=True)
    s.rect(440, 12, 400, 120, fill=WHITE, stroke=MID, r=6)
    s.text(640, 76, "石板 (Tablet)", size=13, fill=MID, anchor="middle")
    s.rect(1000, 12, 268, 260, fill=WHITE, stroke=MID, r=6)
    s.text(1134, 140, "HUD (層・枠・介入)", size=13, fill=MID, anchor="middle")
    s.rect(0, 300, 48, 120, fill=WHITE, stroke=MID, r=6)
    s.text(24, 366, "港", size=14, anchor="middle")
    # 確かめ
    scrim(s, 380, 300, 520, 300)
    s.rect(420, 330, 440, 230, fill=WHITE, stroke=INK, r=10, sw=2)
    s.text(444, 364, "確かめ (判定の出た島のときだけ。いまの leave の板)", size=12, fill=MID)
    s.text(444, 396, "判定の出た島を離れる", size=18, weight="bold")
    s.text(444, 424, "判定の出た島を離れますか。枠へ保存していなければ、", size=13, fill=MID)
    s.text(444, 446, "この島には戻れません (港へ出す島は港に残ります)", size=13, fill=MID)
    s.button(444, 476, 190, 48, "離れる", primary=True, size=15)
    s.button(650, 476, 190, 48, "やめる", size=15)
    s.note(330, 640, "走っている島は確かめない (書き切ってから移る)。訪問中は何も書かない")
    frame_label(s, "stage-desktop 1280x720")
    s.save("stage-desktop.svg")


def stage_narrow():
    s = Svg(390, 844, "操作画面のタイトルへ (狭い画面)")
    background(s, 0, 0, 390, 844, label="操作画面 (いまの作り)")
    s.rect(8, 8, 374, 64, fill=WHITE, stroke=MID, r=6)
    s.button(16, 18, 112, 44, "≡ タイトルへ", size=13, primary=True)
    s.text(144, 46, "時間の箱 · 速さの列", size=12, fill=MID)
    s.rect(8, 80, 374, 90, fill=WHITE, stroke=MID, r=6)
    s.text(195, 130, "石板 (Tablet)", size=12, fill=MID, anchor="middle")
    s.rect(8, 680, 374, 156, fill=WHITE, stroke=MID, r=6)
    s.text(195, 760, "HUD (畳める)", size=12, fill=MID, anchor="middle")
    s.note(16, 190, "札は左上の時間の箱の端。指の届く大きさ (44px)", size=11)
    frame_label(s, "stage-narrow 390x844")
    s.save("stage-narrow.svg")


def main():
    for f in (title_desktop, title_narrow, new_game_desktop, new_game_narrow, load_desktop, load_narrow,
              config_desktop, config_narrow, harbor_desktop, harbor_narrow, stage_desktop, stage_narrow):
        f()
    print("\n".join(sorted(p.name for p in OUT.glob("*.svg"))))


if __name__ == "__main__":
    main()
