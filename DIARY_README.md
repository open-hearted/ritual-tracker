このリポジトリに追加した日記機能の説明

- 目的: Google 認証を使ってログインしたユーザーのみが閲覧/編集できる月間日記ページ (`diary.html`) を提供します。
- データ保存: サーバー側の API (`/api/diary-get`, `/api/diary-put`) が S3 に JSON を保存/取得します。クライアントには S3 バケット名や署名付き URL を露出しません。

必要な環境変数（デプロイ先で設定）:

- GOOGLE_CLIENT_ID: Google OAuth クライアントID。クライアント側とサーバー側で検証に使用します。
- AWS_REGION: S3 バケットのリージョン
- AWS_ACCESS_KEY_ID: サーバーが S3 にアクセスするためのアクセスキー
- AWS_SECRET_ACCESS_KEY: 同上のシークレット
- S3_BUCKET: S3 バケット名（クライアントには露出しません）
- S3_MAX_UPLOAD_BYTES (任意): アップロードサイズ上限（バイト）。デフォルト 262144 (256KB)

セキュリティ上のポイント:

- Google の ID トークンはクライアント側で取得されますが、トークンの検証はサーバー側で行います。クライアントは ID トークンをメモリにのみ保持します（localStorage などには保存しません）。
- サーバーからのレスポンスには S3 バケット名やキーを含めません。
- エラーメッセージは内部のキーやバケット名を含まないようにしています。
- 完全なセキュリティを確保するには HTTPS の運用、IAM ポリシーの最小権限設定、トークン失効やログ監査を行ってください。

使い方 (ローカル):

1. 環境変数を設定する (Windows PowerShell の例):

$env:GOOGLE_CLIENT_ID = "your-google-client-id"; $env:AWS_ACCESS_KEY_ID = "..."; $env:AWS_SECRET_ACCESS_KEY = "..."; $env:AWS_REGION = "..."; $env:S3_BUCKET = "..."

2. 開発サーバー起動 (vercel がある前提):

npm install
npm run dev

3. ブラウザで `diary.html` にアクセスして Google ログインし、月を選んで日記を編集してください。


注意:
- クライアントのネットワークタブにサーバーへの POST リクエスト (例: `/api/diary-get`) が表示されますが、これらのレスポンスには S3 バケット名を含めていません。S3 バケット名や AWS クレデンシャルはサーバー側の環境変数としてのみ保持してください。
