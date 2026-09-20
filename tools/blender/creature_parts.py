"""個体ごとの評価パーツ定義 (compare_ref.py / tune_colors.py が共有する)。

各個体について、
  parts            評価するパーツ名の並び (先頭が地色)
  id_colors        ID パスでそのパーツのマテリアルを描く色
  class_vis        クラス図の表示色
  material_class   マテリアル名の末尾 → パーツ名 (例: deer_teal → glow)。3D 側はこの命名規約で材質を作る
  class_materials  tune_colors.py が同じ比で補正する材質名 (パーツ → 材質末尾の一覧)
  base_colors      参照画像の量子化代表色 (材質の初期値)。<creature>-colors.json があればそちらで上書き
  classify(h, s, v, sil, yy)   参照画像を HSV からパーツへ分類する。yy は bbox 正規化した上からの位置 (0..1)
を持つ。分類は「シアン系 → glow」「暗い → dark」を基本に、個体ごとの色構成で閾値を変える。

参照画像の代表色 (量子化、背景・影を除く上位):
  rabbit: fur #D4AC54 / 濃色 #5C3C34 / 発光 #8CFCEC / 縁 #5C847C
  deer:   fur #CC9C4C, #B47C34 (陰) / 濃色 (深緑のパネル・蹄・角の根元) #2C645C / 発光 (角・縁の線・目) #A4FCF4
  wolf:   fur #EC8454 / 中間色 (面の陰) #BC5C3C / 濃色 (鼻・耳内側・脚の影) #943C2C / 発光 (縁の線) シアン
"""

CYAN_H = (140, 215)


def _cyan(h, s, v, v_min):
    return (h > CYAN_H[0]) & (h < CYAN_H[1]) & (s > 0.2) & (v > v_min)


def _rabbit(h, s, v, sil, yy):
    glow = sil & _cyan(h, s, v, 0.35)
    darkish = sil & ~glow & (v < 0.5)
    ear = darkish & (yy < 0.5)  # 上半分の暗い茶は耳の内側
    return {"fur": sil & ~glow & ~darkish, "ear_inner": ear, "dark": darkish & ~ear, "glow": glow}


def _deer(h, s, v, sil, yy):
    cyan = sil & (h > CYAN_H[0]) & (h < CYAN_H[1]) & (s > 0.2)
    glow = cyan & (v > 0.6)  # 明るいシアン: 角・縁の線・目
    dark = sil & ~glow & ((cyan & (v <= 0.6)) | (v < 0.45))  # 深緑のパネル・蹄・角の根元、鼻
    return {"fur": sil & ~glow & ~dark, "dark": dark, "glow": glow}


def _wolf(h, s, v, sil, yy):
    glow = sil & _cyan(h, s, v, 0.5)
    dark = sil & ~glow & (v < 0.66)  # 赤茶の濃い部分 (鼻・耳内側・脚の陰)。面の中間色 (v≈0.74) は fur に含める
    return {"fur": sil & ~glow & ~dark, "dark": dark, "glow": glow}


CREATURES = {
    "rabbit": {
        "parts": ["fur", "ear_inner", "dark", "glow"],
        "id_colors": {"fur": (1, 0, 0), "ear_inner": (0, 1, 0), "dark": (0, 0, 1), "glow": (1, 1, 0)},
        "class_vis": {"fur": (0.84, 0.76, 0.48), "ear_inner": (0.35, 0.23, 0.16), "dark": (0.15, 0.10, 0.07), "glow": (0.4, 0.95, 0.9)},
        "material_class": {"ear_inner": "ear_inner", "dark": "dark", "glow": "glow", "teal": "glow", "fur": "fur"},
        "class_materials": {"fur": ["fur"], "ear_inner": ["ear_inner"], "dark": ["dark"], "glow": ["glow", "teal"]},
        "base_colors": {"fur": "#D4AC54", "ear_inner": "#5C3C34", "dark": "#5C3C34", "glow": "#8CFCEC", "teal": "#5C847C"},
        "classify": _rabbit,
    },
    "deer": {
        "parts": ["fur", "dark", "glow"],
        "id_colors": {"fur": (1, 0, 0), "dark": (0, 0, 1), "glow": (1, 1, 0)},
        "class_vis": {"fur": (0.80, 0.61, 0.30), "dark": (0.17, 0.39, 0.36), "glow": (0.64, 0.99, 0.96)},
        "material_class": {"dark": "dark", "glow": "glow", "teal": "dark", "fur": "fur"},
        "class_materials": {"fur": ["fur"], "dark": ["dark", "teal"], "glow": ["glow"]},
        "base_colors": {"fur": "#CC9C4C", "dark": "#2C645C", "teal": "#2C645C", "glow": "#A4FCF4"},
        "classify": _deer,
    },
    "wolf": {
        "parts": ["fur", "dark", "glow"],
        "id_colors": {"fur": (1, 0, 0), "dark": (0, 0, 1), "glow": (1, 1, 0)},
        "class_vis": {"fur": (0.93, 0.52, 0.33), "dark": (0.58, 0.24, 0.17), "glow": (0.55, 0.98, 0.9)},
        "material_class": {"dark": "dark", "glow": "glow", "teal": "glow", "fur": "fur"},
        "class_materials": {"fur": ["fur"], "dark": ["dark"], "glow": ["glow", "teal"]},
        "base_colors": {"fur": "#EC8454", "dark": "#943C2C", "glow": "#8CFCEC", "teal": "#8CFCEC"},
        "classify": _wolf,
    },
}


def creature_from_path(*paths):
    """ファイル名 (rabbit.blend, deer-angular.png など) から個体名を推定する"""
    import os
    for p in paths:
        base = os.path.basename(str(p)).lower()
        for name in CREATURES:
            if base.startswith(name):
                return name
    raise SystemExit(f"個体名を推定できません: {paths}。ファイル名を rabbit/deer/wolf で始めるか creature=<name> を渡してください")


__all__ = ["CREATURES", "creature_from_path"]
