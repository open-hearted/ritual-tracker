// デプロイ確認用エンドポイント（本番運用時は index.html のバッジと一緒に削除してよい）
// Vercel が実行時に注入する Git メタデータを返す
export default function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE || null
  });
}
