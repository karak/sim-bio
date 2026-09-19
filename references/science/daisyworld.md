# Daisyworld(アルベドフィードバックのスロット用)

出典: [University of Michigan Global Change Lab](https://globalchange.umich.edu/globalchange1/current/labs/Lab3_DaisyWorld/Intro_Stella.htm)、
[SERC Unit 4 Reading](https://serc.carleton.edu/integrate/teaching_materials/earth_modeling/student_materials/unit4_article1.html)、
[Penn State STELLA model](https://personal.ems.psu.edu/~dmb53/DaveSTELLA/Daisyworld/daisyworld_model.htm)

James Lovelock の Gaia 仮説を最小のモデルにしたもの。SimEarth にも「Daisyworld モード」として入っている。

```
惑星アルベド  A = Σ f_i · α_i + f_soil · α_soil        (f: 面積割合、α: 反射率)
受け取る熱   E = S · (1 − A)                            (S: 日射)
成長率       β_i = max(0, 1 − ((22.5 − T_i) / 17.5)²)   (5℃〜40℃で正、22.5℃で最大)
面積の変化   da_i/dt = a_i · (x · β_i − γ)               (x: 空き地、γ: 死亡率)
```

- 白いデイジー(高アルベド)は暑いと増えて惑星を冷やし、黒いデイジー(低アルベド)は寒いと増えて暖める。
  これが **負のフィードバック** になり、日射が変わっても気温が生存域に留まる。
- 局所温度 `T_i = T_planet + q·(A − α_i)` で、自分の色による局所加熱・冷却を表す。
- 空間版では突然変異を入れると振動が出る報告がある
  ([Mutation of albedo... in a spatial Daisyworld](https://www.sciencedirect.com/science/article/abs/pii/S0022519306000786))。

## この島への適用

- 設計書のスロット `feedback.vegetationToTemp` と `iceAlbedo` はこの式で埋められる。
  森(低アルベド)は局所を暖め、雪原・裸地(高アルベド)は冷やす。
- 今の気温式は `BASE + 緯度 + 標高 + 季節 + heat`。ここに `− k·(A_local − A_ref)` を足すだけで Daisyworld 型になる。
- まず係数 0 で入れ、性質テスト「全面凍結・全面砂漠に落ちない」を守りながら上げる。
