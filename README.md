# IIDX Arena King

beatmania IIDXのローカルアリーナ非公式大会向け運営アプリです。React・Vite・Supabaseで構成し、GitHub Pagesで公開します。

## 主な機能

- 大会・参加者（12名）の登録と過去大会の閲覧
- 過去大会としての新規登録と、誤操作防止付きの過去回編集モード
- 過去資料から組み合わせを1試合ずつ手動追加・編集・削除
- 組み合わせが18試合揃っていない途中状態での保存
- 予選18試合（6ラウンド×3試合）の組み合わせ抽選
- 各参加者が必ず6試合出場する抽選制約
- 対戦相手の重複を抑える候補比較
- 各試合2名、各参加者3試合の配信台割り当て
- 「表示対象にする」が押されたときだけRealtime更新する配信用プレイヤー表示画面
- 抽選表からの結果入力と試合消化数表示
- 登録済み試合の参加者・順位・pt・試合区分・選曲譜面の編集
- 予選順位・順位決定戦の自動集計
- 1試合内での同率順位の登録
- 選曲譜面の入力は過去回編集モードに限定
- 参加者ごとの二つ名・選手画像の登録と後編集
- A～Dの4選手を固定表示する配信用画面
- 予選同点時のサドンデス対象表示
- Supabase Authによる運営者ログインとRLS

## Supabaseの更新

Supabase DashboardのSQL Editorで [`supabase/schema.sql`](supabase/schema.sql) を実行してください。既存環境では、抽選表・呼び出し番号・過去回判定を保存する次の列が追加されます。

- `tournaments.draw_schedule`
- `tournaments.called_match_number`
- `tournaments.is_archived`
- `participants.title`
- `participants.image_url`

同じSQLから、選手画像用の公開Storageバケット `player-images` と、ログイン済み運営者だけが画像を追加・削除できるポリシーも作成されます。
また、`tournaments` テーブルをSupabase Realtimeの対象へ追加します。OBS側で配信用画面を常時開いたままでも、「表示対象にする」を押すとA～Dの選手表示が自動で切り替わります。

SQLは再実行可能です。ブラウザには公開用（anon / publishable）キーだけを設定し、`service_role`キーは使用しないでください。

## 過去回を登録する手順

1. 運営ログイン後に「大会を追加」を選択します。
2. 大会名と開催日を入力し、「過去回として登録する」を有効にします。
3. 作成した大会で「過去回を編集」を選択します。
4. 「参加者」から当時の参加者を登録します。
5. 「組み合わせ」から判明している試合を1件ずつ手動登録します。
6. 組み合わせの「この試合の結果を入力」、または「試合結果」から当時の結果を登録します。

過去回は通常は閲覧専用です。編集するときだけ明示的に編集モードへ切り替えるため、過去データの誤変更を防げます。
登録済みの試合結果を直す場合は、「試合結果」タブで対象試合の「編集」を選択します。過去回では先に「過去回を編集」を有効にしてください。

## ローカル起動

```bash
cp .env.example .env.local
npm install
npm run dev
```

検査とビルド：

```bash
npm run lint
npm run build
```

## GitHub Pages

GitHub Actions Secretsへ `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を登録します。Pagesの公開元を「GitHub Actions」にすると、`main`へのコミット時に自動公開されます。

公開URL：`https://soutou1945.github.io/iidx-arena-king/`

## 大会ルール

- 12名、予選全18試合、1人6試合
- 予選上位・中位・下位4名ずつで順位決定戦
- 予選同点は「1位回数 → 4位回数の少なさ → サドンデス」
- サドンデスはALL ALPHABET / ANOTHERランダム1曲（合意により☆12等へ変更可）
- ☆8〜12のANOTHER / LEGGENDARIAが選曲可能
- 自身が同じ譜面を2回以上選曲することは禁止
- 版権曲のうち収益化停止曲は選曲不可
- 順位決定戦同ptは予選上位者を優先

本アプリは非公式大会向けであり、KONAMIおよびbeatmania IIDXの公式サービスではありません。
