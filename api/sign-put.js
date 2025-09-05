// /api/sign-put.js
// 署名付き PUT URL を発行 (短期: 60s)
// 必須 ENV: APP_PASSWORD, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function validateKey(raw){
  if(typeof raw !== 'string') return null;
  // ディレクトリトラバーサル等を防ぎ、英数/._- のみ許可 (必要なら拡張)
  if(!/^[A-Za-z0-9._-]+$/.test(raw)) return null;
  return raw;
}

export default async function handler(req, res){
  try{
    if(req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { password, key, contentType } = req.body || {};
    if(!password || password !== process.env.APP_PASSWORD) return res.status(401).send('Unauthorized');
    if(!key) return res.status(400).send('key required');

    const safeKey = validateKey(key);
    if(!safeKey) return res.status(400).send('invalid key format');

    const client = new S3Client({ region: process.env.AWS_REGION, credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }});

    const bucket = process.env.S3_BUCKET;
    if(!bucket) return res.status(500).send('S3_BUCKET not set');

    const expires = Number(process.env.S3_PUT_EXPIRES || 60); // 秒
    const command = new PutObjectCommand({ Bucket: bucket, Key: safeKey, ContentType: contentType || 'application/octet-stream' });
    const url = await getSignedUrl(client, command, { expiresIn: expires });
    res.status(200).json({ url, expires });
  }catch(e){
    console.error('sign-put error', e);
    res.status(500).send('internal error');
  }
}
