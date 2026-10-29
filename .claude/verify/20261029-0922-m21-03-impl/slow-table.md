# tests/slow 迎撃の塔 (M21-03)

| 試験 | 期待 | 結果 | 秒 |
|---|---|---|---|
| idle → dead (信仰が減衰して塔で止まり、一つ目の星が落ちる) | dead | 通過 | 33.1 |
| answer-only (儀式なし、祈りにだけ応える) → dead (信仰が 77 年目に工事の門 0.6 を割り、二つ目の窓で備蓄が積めず 105 年目の星が落ちる) | dead | 通過 | 57.7 |
| naive ritual without edict (儀式を最初から、止めよ無し) → dead (窓の外でも掘り続けて脈が尽き、二つ目の窓で備蓄が積めず 105 年目の星が落ちる) | dead | 通過 | 59.1 |
| naive ritual + answer without edict (儀式と応え、止めよ無し) → dead (応えは脈を戻さない。窓の外で掘り尽くし、105 年目の星が落ちる) | dead | 通過 | 57.6 |
| old solution 1: ritual + stop at three loads (儀式を最初から、備蓄 9 で止めよ) → dead (備蓄は窓ごとに 4.3 までしか積めず止めよが出ないまま脈が尽き、105 年目の星が落ちる) | dead | 通過 | 58.2 |
| old solution 2: ritual + stop at two loads (備蓄 6 で止めよ) → dead (備蓄 6 にも届かず止めよが出ないまま脈が尽き、105 年目の星が落ちる) | dead | 通過 | 57.2 |
| naive late ritual + edict loop (儀式を 20 年目から、門の間は止めよ、蓄えたら止めよ) → dead (星に届くのは 36 年目。備蓄 9 に届かず止めよが出ないまま窓の外で掘り続けて脈が 93 年目に尽き、105 年目の星が落ちる) | dead | 通過 | 57.9 |
| naive stop only (儀式 + 星に届いたら止めよ、再開しない) → dead (窓で工事が動かず、60 年目の星が落ちる) | dead | 通過 | 33.2 |
| solution 1: ritual + window rhythm (儀式 + 星に届いたら止めよ + 星が見えたら再開せよ + 砕いたら止めよ) → alive (58・102 年目に砕く) | alive | 通過 | 59.3 |
| solution 2: ritual + answer + window rhythm after the first (儀式 + 応え + 星が見えたら再開せよ + 一度目を砕いた後だけ止めよ) → alive | alive | 通過 | 59.3 |

exit 0 wall 533s (jobs 1、10 本を 1 本ずつ。2026-10-29、caffeinate -s)
