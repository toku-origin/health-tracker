# CLAUDE.md — health-tracker

このリポジトリで作業する Claude 向けの引き継ぎメモです。作業を始める前に必ず読んでください。

## このリポジトリについて

体重・運動・食事・睡眠・水分・疲労度とストレスを記録し、カロリー収支を出す Web アプリです。
HTML / CSS / JavaScript だけで作っています（ビルドなし、ライブラリなし）。
記録データの保存先として、非公開リポジトリ `toku-origin/health-data` と組で使います。

## 進め方のルール（必ず守る）

- 会話と説明は日本語で行う。
- **作る前に仕様を説明し、OK をもらってから作る。** 画面・データ形式・計算方法・出典を具体的に示す。
- **コミットの前に、何をどうコミットするかを伝える。** コミットは意味のある単位に分ける。
- オーナーはプログラミングを学習中。コードには日本語のコメントをつけ、変更したら要点を説明する。
- このリポジトリは**公開**。個人の健康データや個人的な事情は書かない。記録データは `health-data`（非公開）に置く。
- 計算に使う数値（成分表、METs、推定式）は、一次資料で確認してから使い、出典をコードと README に残す。確認できない値を使うときは、そのことを明記してオーナーに伝える。

## 設計書

`docs/DESIGN.md` に記録項目・画面・同期方式・バーコードの設計と、作る順番がある。新しい機能は、まずここを読む。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の骨組み。タブは「記録・直近7日・マイ食品・設定」 |
| `style.css` | 見た目。スマホ幅が基準、ダークモード対応。色はすべて `:root` のトークン |
| `app.js` | 画面の表示・入力・保存。入力欄の `data-path`（例：`sleep.bedtime`）の道筋で記録に書き込む |
| `nutrients.js` | 栄養素53項目の定義、`foods.json` の読み込み、食材検索、栄養計算 |
| `body.js` | METs の表、運動の消費カロリー、基礎代謝、BMI |
| `foods.json` | 成分表を変換したデータ（2,538食品＋呼び名68件）。手で編集しない |
| `tools/convert_foods.py` | 成分表の Excel → `foods.json`。呼び名は `ALIASES` で定義 |
| `tools/extract_mets.py` | メッツ表の PDF → 全活動の METs 一覧（`body.js` の値の確認用） |
| `tests/` | `node --test` で動くテスト。`load-app.js` がブラウザなしで app.js を読み込む |

スクリプトの読み込み順は `nutrients.js` → `body.js` → `app.js`。モジュールは使わず、グローバル関数で連携しています。

## データ

- 今はブラウザの localStorage（キー `health-tracker:v1`）に `{ schemaVersion, records, settings, myFoods }` を保存。
  `schemaVersion`（今は 1）を上げたら、`migrate` に古い形の読み替えを足す。
- `records` は `{ "YYYY-MM-DD": 1日分の記録 }`。形は README を参照。
- **削除の印**：消した日は `{ date, deleted: true, updatedAt }` に置き換える（同期で「消した」を伝えるため）。
  記録を読むときは `getRecord`・`liveRecords`、マイ食品は `activeMyFoods` を通して印を除く。
- 食材は `{ foodId, name, foodName, grams, servings, nutrients }`。運動は `{ type, minutes, intensity, mets, kcal }`。
  計算結果（`nutrients`・`mets`・`kcal`）も保存する。あとで Claude がデータだけで分析できるようにするため。
- 古い形式（食材が文字列だった頃の記録）も `normalizeIngredient` で読めるようにしてある。
- `settings`：`cupMl`、`profile`（`heightCm`・`birthMonth`・`sex`・`activityLevel`）、`mets`（`{ 種類: [軽い, 普通, きつい] }`）、`metsVersion`。
- `myFoods`：`{ id: "my:...", name, basis: "100g" | "serving", servingLabel, servingGrams, values, updatedAt }`。
  消したものは `deleted: true` をつけて値は残す（過去の記録の再計算に使う）。
- 初回だけサンプルの記録（`sample: true`）が入る。書き出しには含めない。

## 計算と出典

| 項目 | 方法 | 出典 |
|---|---|---|
| 食事の栄養 | 可食部100gあたりの値 × グラム数 ÷ 100 | 日本食品標準成分表（八訂）増補2023年（文部科学省） |
| 成分表の記号 | Tr → 0、(数値) → その数値、- と * → 値なし | 同上 |
| 運動の消費カロリー | METs × 体重(kg) × 時間 | 改訂第2版『身体活動のメッツ(METs)表』成人版（2024） |
| 基礎代謝 | 国立健康・栄養研究所の式 | Ganpule et al. (2007) |
| 普段の活動量 | 1.50 / 1.75 / 2.00 | 日本人の食事摂取基準（2025年版） |
| 1日の消費 | 基礎代謝 × 普段の活動量 ＋ Σ(METs − 1) × 体重 × 時間 | 基礎代謝との二重計上を避けるため 1 METs を引く |
| 体脂肪の目安 | 7,200 kcal/kg | よく使われる目安 |
| BMI の判定 | 18.5 / 25 / 30 / 35 / 40 で区分 | 日本肥満学会 |

- METs の値は `body.js` の `METS_DETAIL` に、メッツ表のコード番号つきで持っている。**値を変えたら `METS_VERSION` を上げる**（保存済みの設定の初期の運動が新しい値に置き換わる）。
- 成分表の呼び名を足すときは `tools/convert_foods.py` の `ALIASES` に追加し、`foods.json` を作り直す。対応した食品名を出力で必ず確認する（「耳」「芽キャベツ」などに当たりやすい）。

## これまでに決めたこと

- データ共有は「案A」：アプリは GitHub Pages、記録は `health-data`（非公開）に GitHub API で JSON 保存。外部 DB や Claude のアーティファクトは使わない。
- 保存は「保存」ボタンに加えて、日付・画面の切り替え時とページを閉じる時に自動保存。
- 歩数からは消費カロリーを計算しない（ウォーキングと二重になるため）。
- 表にない運動は 軽い3.0／普通4.5／きつい6.0 の仮の値。設定画面で運動と値を追加できる。
- 腹囲はまだ記録しない（将来は `body` に項目を足す）。
- プロトタイプは claude.ai のアーティファクトでも公開している。アーティファクト版の `index.html` は doctype と head がない形で、**このリポジトリ版が正**。

## 次にやること

1. **`health-data` との同期（ステップ4）**：作る前に仕組みとトークンの作り方を説明する。
   - fine-grained personal access token（`health-data` だけ、Contents の読み書きのみ、有効期限90日）を設定画面で入力し、端末の localStorage に保存。
   - 保存先：`data/YYYY-MM.json`（月ごと）、`my-foods.json`、`settings.json`。
   - 2台で同時に保存したときは、ファイルの `sha` で競合を検出して扱う。
2. **GitHub Pages で公開**し、スマホのホーム画面に追加できるようにする（ステップ5）。
3. 腹囲の記録（任意）。
4. Claude による週次振り返り（スケジュールタスクで `health-data` を読む）。

## 動作確認

- `python3 -m http.server 8000` で開く（`foods.json` の読み込みにサーバーが必要）。
- 計算は `node` で関数単体を確認できる（`nutrients.js`・`body.js` は `vm` で読み込める）。
- テストは `node --test`（Node.js 18 以上。ライブラリは不要）。機能を足したら `tests/` にテストも足す。
