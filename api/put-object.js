// /api/put-object.js
// Server-side upload endpoint: accepts base64-encoded body and uploads to S3 using server credentials.
// Expects JSON { password, key, contentType, data } where data is base64 string.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function validateKey(raw){
  if(typeof raw !== 'string') return null;
  if(!/^[A-Za-z0-9._-]+$/.test(raw)) return null;
  return raw;
}

export default async function handler(req, res){
  try{
    if(req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { password, key, contentType, data } = req.body || {};
    if(!password || password !== process.env.APP_PASSWORD) return res.status(401).send('Unauthorized');
    if(!key || !data) return res.status(400).send('key and data required');
    const safeKey = validateKey(key);
    if(!safeKey) return res.status(400).send('invalid key format');

    const bucket = process.env.S3_BUCKET;
    if(!bucket) return res.status(500).send('S3_BUCKET not set');

    // limit size: reject overly large uploads (safety)
    // data is base64; compute approx bytes
    const approxBytes = Math.floor((data.length * 3) / 4);
    const MAX_BYTES = Number(process.env.S3_MAX_UPLOAD_BYTES || 1024*1024); // default 1MB
    if(approxBytes > MAX_BYTES) return res.status(413).send('Payload too large');

    const client = new S3Client({ region: process.env.AWS_REGION, credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }});

    const body = Buffer.from(data, 'base64');
    const command = new PutObjectCommand({ Bucket: bucket, Key: safeKey, Body: body, ContentType: contentType || 'application/octet-stream' });
    await client.send(command);
    // success
    return res.status(200).json({ ok: true });
  }catch(e){
    // avoid leaking sensitive internals in response
    console.error('[upload] put-object error');
    return res.status(500).send('internal error');
  }
}
