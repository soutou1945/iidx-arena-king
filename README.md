# IIDX Arena King

beatmania IIDXのローカルアリーナで実施する、非公式大会向けの運営・スコア管理アプリです。

公開ページでは誰でも順位・試合結果を閲覧でき、Supabase Authでログインした運営者だけがデータを登録・変更できます。

## 主な機能

- 最大12名の参加者登録
- 4人分の順位・獲得ポイント・選曲譜面の登録
- 参加者ごとの試合消化数表示
- 予選順位と同点条件の自動集計
- 王決定戦・中位決定戦・逆王決定戦への自動組分け
- 大会名・開催日の登録と過去大会の閲覧
- 同一譜面の再選曲警告
- Supabase Authによる運営者ログイン
- GitHub ActionsによるGitHub Pages自動公開

## 技術構成

- React 19 / TypeScript
- Vite
- Supabase Database / Auth / Row Level Security
- GitHub Pages / GitHub Actions

## 1. Supabaseを準備する

1. [Supabase](https://supabase.com/)でプロジェクトを作成します。
2. Supabase Dashboardの「SQL Editor」を開きます。
3. [`supabase/schema.sql`](supabase/schema.sql)の内容を貼り付けて実行します。
4. 「Authentication」→「Users」から、大会運営用ユーザーを作成します。
5. 一般利用者が運営権限を取得できないよう、Authentication設定で新規サインアップを無効にします。

SQLには以下が含まれています。

- 大会・参加者・試合・結果テーブル
- 誰でも結果を閲覧できるSELECTポリシー
- ログイン済み運営者だけが更新できるRLSポリシー
- 試合と4人分の結果を安全に一括登録するPostgreSQL関数

## 2. ローカル環境を設定する

`.env.example`をコピーして`.env.local`を作成します。

```bash
cp .env.example .env.local
```

Supabase Dashboardの「Project Settings」→「API」に表示される値を設定します。

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

> [!CAUTION]
> `service_role`キーはRLSを迂回する秘密鍵です。ブラウザ用コード、`.env.local`以外の共有ファイル、GitHub Secretsのこの用途には設定しないでください。

## 3. ローカルで起動する

```bash
npm install
npm run dev
```

コード検査と本番ビルドは以下で実行できます。

```bash
npm run lint
npm run build
```

## 4. GitHub Pagesを設定する

### GitHub Secrets

リポジトリの「Settings」→「Secrets and variables」→「Actions」で、次のRepository secretsを登録します。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Pagesの公開元

リポジトリの「Settings」→「Pages」を開き、「Build and deployment」のSourceを「GitHub Actions」に変更します。

`.github/workflows/deploy-pages.yml`により、`main`ブランチへコミットするたびに自動でビルド・公開されます。

公開URLは次の形式です。

```text
https://soutou1945.github.io/iidx-arena-king/
```

GitHub FreeでPagesを利用する場合は、リポジトリをPublicにしてください。PrivateリポジトリからのPages公開には対応プランが必要です。

## セキュリティ方針

- Supabaseの公開用キーだけをブラウザで使用します。
- 全テーブルでRow Level Securityを有効にします。
- 未ログイン利用者は閲覧のみ可能です。
- 登録・削除はSupabase Authでログインした利用者だけに許可します。
- 1試合分の登録はDB関数内のトランザクションで処理します。

## 大会ルールへの対応

- 予選は1人6試合
- 予選上位4名・中位4名・下位4名で各順位決定戦を実施
- 予選から順位決定戦まで同一譜面を再選曲不可
- 予選同点時は1位回数、4位回数、直接対決ポイントの順で判定
- 順位決定戦同点時は予選順位を優先

## 注意事項

本アプリは非公式大会向けであり、KONAMIおよびbeatmania IIDXの公式サービスではありません。
