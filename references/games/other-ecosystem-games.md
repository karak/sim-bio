# その他の生態系ゲーム・シミュレーション

## Terra Nil(Free Lives, 2023)

出典: [TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/TerraNil)、[Shacknews レビュー](https://www.shacknews.com/article/134777/terra-nil-review-nature-appreciation)、
[Adrian Hon の分析](https://adrianhon.substack.com/p/terra-nil)

- 「逆シティビルダー」。荒地を復元し、最後は建物を回収して去る。
- **湿度・気温・毒性** の 3 指標を機械で動かし、条件が揃うと **雨が自発的に降り** タイルが緑化する。
  つまり「プレイヤーは条件を整え、あとは自然が広がる」構造。本作の「軽い介入」と同じ哲学。
- 4 つの地域(温帯の川、熱帯の島、火山の氷河、水没都市)で要求が変わる。
- 舞台の教訓: **地域ごとに「効くパラメータ」を変える** と同じ操作でも体験が変わる。

## Niche(Stray Fawn, 2017)

出典: [Steam](https://store.steampowered.com/app/440650/Niche__a_genetics_survival_game/)、[公式](https://niche-game.com/)

- ターン制。実際の遺伝(優性・劣性・共優性)と集団遺伝の 5 要素(浮動、流動、突然変異、自然選択、性選択)を教材化。
- 六角タイルの小さな島を渡り歩く。捕食者、気候変動、病気が脅威。
- 舞台の教訓: **島を「渡る」構造** で舞台を切り替える。本作でも「隣の島」を将来のシナリオ単位にできる。

## The Sapling / The Bibites

出典: [itch.io evolution simulation collection](https://itch.io/games-like/3824818/evolution-simulation)

- The Sapling: 自分で植物と動物をデザインして同じ世界に放つ短編シム。
- The Bibites: ニューラルネットを持つ個体が進化する「デジタル生命」。
- どちらも個体ベースで、本作(密度モデル)とは違うが、「種を設計して放つ」UI は種パレットの拡張の参考になる。

## Sebastian Lague「Coding Adventure: Simulating an Ecosystem」

出典: [Patreon 投稿](https://www.patreon.com/posts/coding-adventure-27523739)

- ウサギとキツネ。地図に水タイルと陸タイル、木(障害物)、植物(餌)。空腹と渇きを実装し、餌と水を探す。
- 形質(速度、感覚範囲など)を持たせ、世代を経て適応するのを観察するのが狙い。
- 舞台の教訓: **水場を離散的な資源として置く** と、動物の分布が水場の周りに集まり、見た目に「生活」が出る。

## ブラウザ系の小規模シム

- [Ecosystem Simulator (MauroDot)](https://maurodot.itch.io/ecosystem-simulator): グリッドで植物が広がり、草食獣が食べ、捕食者が狩る。成長・代謝・繁殖・災害の設定を変えて安定か崩壊かを見る。
- [EcoCycle](https://rythmic-steel45.itch.io/ecocycle): 食物連鎖ベースのグリッド戦略。
- [Ecosystem Simulator (netlify)](https://ecosimulator.netlify.app/): 環境と種を選んで個体数を置く極小シム。
- [Ecosystem Simulation Safari](https://conservationmag.org/games/ecosystem_simulation.html): 象・ライオン・シマウマの 3D。絶滅と過剰繁殖を防ぐ。
- [Ecosystem (ecosystem-game.com)](https://www.ecosystem-game.com/): 海の生物が自然選択で進化する。

共通点: どれも「パラメータをいじって安定か崩壊かを見る」だけで終わりがち。本作が差をつけるなら **「なぜそうなったか」を読める可視化**(介入マーカー付きグラフ、セル詳細、ログ)。

## SimPark(Maxis, 1996)

出典: [Wikipedia](https://en.wikipedia.org/wiki/SimPark)

- 子ども向けの公園生態系。在来種と外来種、食物連鎖のバランスをとる。SimEarth を「一つの公園」に縮めた先例で、本作の「一枚の島」スケールに近い。
