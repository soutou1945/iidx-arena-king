# IIDX Arena King

beatmania IIDXのローカルアリーナ非公式大会向け運営アプリです。React・Vite・Supabaseで構成し、GitHub Pagesで公開します。

## 主な機能

- 大会・参加者（12名）の登録と過去大会の閲覧
- 予選18試合（6ラウンド×3試合）の組み合わせ抽選
- 各参加者が必ず6試合出場する抽選制約
- 対戦相手の重複を抑える候補比較
- 各試合2名、各参加者3試合の配信台割り当て
- 会場モニター用のプレイヤー呼び出し画面
- 抽選表からの結果入力と試合消化数表示
- 予選順位・順位決定戦の自動集計
- 予選同点時のサドンデス対象表示
- Supabase Authによる運営者ログインとRLS

## Supabaseの更新

Supabase DashboardのSQL Editorで [`supabase/schema.sql`](supabase/schema.sql) を実行してください。既存環境では、抽選表と現在の呼び出し番号を保存する次の列が追加されます。

- `tournaments.draw_schedule`
- `tournaments.called_match_number`

SQLは再実行可能です。ブラウザには公開用（anon / publishable）キーだけを設定し、`service_role`キーは使用しないでください。

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
