// /api/sign-get.js
// 署名付き GET URL を発行 (短期: 60s)
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function validateKey(raw){
  if(typeof raw !== 'string') return null;
  if(!/^[A-Za-z0-9._-]+$/.test(raw)) return null;
  return raw;
}

export default async function handler(req, res){
  try{
    const { password, key } = req.query || {};
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

    const expires = Number(process.env.S3_GET_EXPIRES || 60);
    const command = new GetObjectCommand({ Bucket: bucket, Key: safeKey });
    const url = await getSignedUrl(client, command, { expiresIn: expires });
    res.status(200).json({ url, expires });
  }catch(e){
    console.error('sign-get error', e);
    res.status(500).send('internal error');
  }
}

// メモ: IAM は対象バケットの最小権限 (s3:GetObject, s3:PutObject) のみ付与
