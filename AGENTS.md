# GitHub操作時のルール

GitHub に関する操作を行う前に、必ず以下を最初に明示してください。

## 必須出力

1. 対象リポジトリ名
2. 対象ブランチ名
3. 現在のHEADコミット
4. 目的
5. 実施する操作の種類
6. 影響範囲
7. 危険な操作の有無
8. 実行前に人間の確認が必要な点

## 出力フォーマット

* 対象リポジトリ: <repo>
* 対象ブランチ: <branch>
* HEAD: <commit>
* 目的: <purpose>
* 操作: <operation>
* 影響範囲: <scope>
* 危険な操作: <yes/no>
* 確認事項: <items>

## 実行ルール

### 共通

* 推測でリポジトリやブランチを決めない。
* 認証情報や秘密情報を出力しない。
* PAT・Token・Cookie・Secret・SSH秘密鍵を表示しない。
* Git Credential Manager を利用し、認証情報をコマンドへ埋め込まない。
* Authorization Header を生成しない。
* Remote URL に認証情報を含めない。

### 作業開始前

必ず以下を確認する。

* git remote -v
* git branch --show-current
* git status

### 変更前

必ず以下を提示する。

* 変更対象ファイル一覧
* git diff 要約
* 追加・更新・削除ファイル一覧

### 人間の事前承認が必須な操作

以下は実行前に停止し、承認を求める。

* merge
* rebase
* release
* tag
* delete
* force push
* branch削除
* workflow変更
* GitHub Actions変更
* secrets変更
* permissions変更
* repository settings変更

### 高危険操作

以下は常に危険操作として扱う。

* git push --force
* git reset --hard
* git clean -fd
* branch削除
* tag削除
* release削除
* workflow変更
* secrets変更
* credential変更

### 実行後

必ず以下を報告する。

* 実施した操作
* 変更ファイル数
* 実行結果
* エラー有無

### 禁止事項

* mergeを自動実行しない
* force pushを自動実行しない
* tokenを生成・表示しない
* PATを要求しない
* 認証情報をログへ出力しない
* 承認なしでmain/masterへ変更を反映しない
* README.md以外のドキュメント（docs/配下のファイルや画像など）をGit/GitHubにpush（コミット）しない。ドキュメント類はローカルのみで管理すること

## 例

* 対象リポジトリ: my-org/example
* 対象ブランチ: feature/fix-auth
* HEAD: a1b2c3d
* 目的: GitHub認証エラーの修正
* 操作: コード修正とテスト実行
* 影響範囲: 認証処理と関連テスト
* 危険な操作: no
* 確認事項: push前に差分確認が必要
