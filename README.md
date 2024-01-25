# esa-sync-importer

esa.ioにローカルの指定されたディレクトリのテキストファイル及びマークダウンファイルをインポートするツールです。  
esa.ioのAPIを利用しています。  

## 使い方

### 1. esa.ioのAPIトークンを取得する

esa.ioのAPIトークンを取得してください。  

`https://[account-id].esa.io/user/applications` にアクセスして、
`Personal access tokens` から `Generate new token` を選択します。
  
```
Token description: esa-sync-importer
Read: ON
Write: ON
```
  
として、 `Save` を押します。  

### 2. .envファイルを作成し、APIトークンを設定する

`.env.sample` をコピーして、 `.env` ファイルを作成します。  
`.env` ファイルに、APIトークンを設定します。  

```
ESA_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. 使い方

```
bin/esa-sync-importer [options] <source> <destination>
```

* options
  * `-w`, `--wip` : WIPで投稿する
  * `-n`, `--dry-run` : ドライラン
  * `-t`, `--team` : esa.ioのチーム名(必須)
  * `-i=`, `--ignore-existing` : すでに同じタイトルの記事がある場合はスキップ
* source : インポートするファイルのあるディレクトリ
* destination : インポート先のesa.ioのチーム名とカテゴリ名を指定する    
  `team-name/category-name` のように指定する。    
  例: `esa-sync-importer ./docs esa-team-name/category-name`
  

## WIPフラグ

- WIPフラグONの場合の動作
  - 新規作成の場合は、WIPフラグが付いた状態で投稿されます。
  - 更新の場合は、WIPフラグは無視されます。
