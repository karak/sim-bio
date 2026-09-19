# 捕食者・被食者モデルと振動の条件

## 1. 今の実装(M2)の位置づけ

M2 の `stepPopulations` は **Lotka-Volterra + ロジスティック被食者 + 線形(Holling I 型)摂食応答**。
この組み合わせは共存平衡点が常に安定で、振動は減衰して消える(実測どおり)。
持続する振動(リミットサイクル)を出すには、摂食応答を **飽和型(Holling II 型)** にし、
被食者の環境収容力 K を十分大きくする必要がある。これが Rosenzweig-MacArthur モデル。

## 2. Rosenzweig-MacArthur モデル

出典: [Introduction to Theoretical Ecology, Week 12](https://pojuke.github.io/TheoreticalEcologyPJK/week-12---rosenzweig-macarthur-predator-prey-model-and-mays-complexity-stability-relationship.html)

```
被食者:  dN/dt = r·N·(1 − N/K) − a·N/(1 + a·h·N) · P
捕食者:  dP/dt = e·a·N/(1 + a·h·N) · P − d·P
```

| 記号 | 意味 | 今の実装との対応 |
|---|---|---|
| r | 被食者の内的成長率 | 植物 `growthRate`、動物は `growthRate·predation·food` |
| K | 被食者の環境収容力 | 植物は 1(セル容量)。動物は餌量で暗黙に決まる |
| a | 捕食者の探索(攻撃)率 | `predation` |
| h | 1 匹を処理する時間(飽和の原因) | **未実装**。これが振動の鍵 |
| e | 同化効率 | `growthRate`(動物) |
| d | 捕食者の死亡率 | `mortality` |

### 振動の条件(nullcline の「こぶ」)

- 被食者の nullcline は `P = (r/a)·(1 − N/K)·(1 + a·h·N)`。これは N について上に凸で、
  こぶの位置は `N_hump = (K − 1/(a·h)) / 2`。
- 捕food者の nullcline は縦線 `N* = d / (a·(e − d·h))`。
- **N* < N_hump なら共存平衡は不安定になり、リミットサイクルに落ち着く。**
  N* > N_hump なら安定(減衰振動)。
- したがって「K を大きくする(餌を豊かにする)」「h を大きくする(飽和を強くする)」と振動が出る。
  K を上げすぎると振動の振幅が大きくなり、谷で捕食者が確率的に絶滅する。これが **enrichment のパラドックス**。

数値例(同ページ): `r=1.0, a=1.3, h=0.9, e=0.6, d=0.5` のとき **K=5.0 で安定、K=7.0 で振動**。
初期値 N₀=5, P₀=2。

出典: [Enrichment paradox and applications (arXiv)](https://arxiv.org/html/2010.08117)、
[Sensitivity of RM dynamics to the functional response (J Math Biol)](https://link.springer.com/article/10.1007/s00285-017-1201-y)

### 捕食者間干渉(Beddington-DeAngelis)

捕食者同士が干渉する項 `a·N / (1 + a·h·N + c·P)` を入れると、K が大きくても振動が出にくくなる(安定化)。
「狼が増えすぎると狩りの効率が落ちる」という説明がつくので、振動を抑えたい種に使える。

## 3. 空間があると何が起きるか(反応拡散)

出典: [Spatiotemporal dynamics of two generic predator-prey models](https://www.tandfonline.com/doi/full/10.1080/17513750903484321)、
[Pursuit-evasion predator-prey waves in 2D (arXiv)](https://arxiv.org/pdf/nlin/0406012)、
[Agent-based Monte Carlo for reaction-diffusion (arXiv)](https://arxiv.org/pdf/2505.18145)

- 格子上で RM 型の反応 + 拡散を回すと、**渦巻き波(spiral waves)、同心円波(target patterns)、斑点・縞・迷路模様(Turing パターン)** が出る。
- 少数の捕食者が被食者の豊かな領域に入ると **活動前線(activity front)** が広がり、通過後は空白ができ、そこに被食者が再び満ちる。
  → 画面で「狼の波が鹿の群れを追って島を横切る」見え方になる。これは密度モデルでも出る。
- 空間があると全体としては振動が **局所で位相がずれて打ち消し合い**、島全体の合計グラフは平坦に見えることがある。
  グラフには「合計」に加えて「ある地域の密度」や「セルの時系列」を出す価値がある。
- 拡散率が捕食者 > 被食者 だと不安定化(Turing 条件)しやすい。今の設定(狼 0.2 > 鹿 0.15)はその方向。

## 4. NetLogo Wolf Sheep Predation の教訓

出典: [EduTech Wiki](https://edutechwiki.unige.ch/en/NetLogo_Wolf_Sheep_Predation_model)、
[Modeling Commons (Wilensky)](https://modelingcommons.org/browse/one_model/1390)、
[Mesa 版](https://mesa.readthedocs.io/latest/examples/advanced/wolf_sheep.html)

- 個体ベースで、羊と狼はエネルギーを持ち、食べると増え、繁殖で半分を子に渡し、0 で死ぬ。
- **草なし版は必ず崩壊**する。**草あり版(食べられた草が固定時間後に再生)は持続的に振動**する。
- 既定値: 羊 100、狼 50、狼の餌エネルギー 4、羊繁殖 10%、狼繁殖 5%、**草の再生 11 tick**。
- 教訓: 資源(草)の **再生に時間遅れがある** ことがボトルネックになり、羊の爆発 → 狼の爆発 → 崩壊を防ぎ、自己調整の周期を作る。
  今の実装の草はロジスティックで即時に回復するので遅れがない。「食べられたセルは一定期間回復しない」を入れるだけで NetLogo と同じ構造になる。

## 5. この島への適用案(優先順)

1. **Holling II 型の摂食応答を入れる**: `intake = predation·food / (1 + predation·h·food)`。`h`(処理時間)を `SpeciesDef` に追加。狼に h を大きめ、鹿は小さめ。
2. **草の回復に遅れを入れる**: 食べられた分は「枯れ草」レイヤーに移り、一定 tick 後に容量に戻る。NetLogo の grass-regrowth-time 相当。
3. **K を上げて enrichment を試す**: 植生の容量を 1 → 1.5 相当(または成長率を上げる)にして、振動が出るか性質テストで確認する。谷で絶滅するなら干渉項で抑える。
4. **グラフに地域別・セル別の時系列を追加**: 合計が平坦でも局所の波が見えるようにする。
5. 振動の判定は自動テストにする: 年次合計の自己相関、または「極大値の数 ≥ N かつ振幅比 ≥ 0.3」。
