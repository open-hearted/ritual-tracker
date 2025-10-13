// Server endpoint to store a user's diary for a given month.
// POST { idToken, monthKey, data }
// Verifies Google ID token, enforces size limit, and uploads JSON to S3 using server credentials.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

async function verifyIdToken(idToken){
  if(!idToken) return null;
  try{
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if(!res.ok) return null;
    const json = await res.json();
    if(!process.env.GOOGLE_CLIENT_ID) return null;
    if(json.aud !== process.env.GOOGLE_CLIENT_ID) return null;
    return json;
  }catch(e){
    console.error('[diary-put] token verification error');
    return null;
  }
}

function safeKey(raw){
  if(typeof raw !== 'string') return null;
  if(!/^[0-9A-Za-z._-]+$/.test(raw)) return null;
  return raw;
}

export default async function handler(req, res){
  try{
    if(req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { idToken, monthKey, data } = req.body || {};
    if(!idToken || !monthKey || typeof data === 'undefined') return res.status(400).send('idToken, monthKey and data required');

    const token = await verifyIdToken(idToken);
    if(!token) return res.status(401).send('Unauthorized');

    const uid = token.sub || token.email;
    if(!uid) return res.status(401).send('Unauthorized');

    const safeMonth = safeKey(monthKey);
    if(!safeMonth) return res.status(400).send('invalid monthKey');

    // stringify and size-check (limit to 256KB by default)
    const bodyStr = JSON.stringify(data || {});
    const MAX_BYTES = Number(process.env.S3_MAX_UPLOAD_BYTES || 256*1024);
    const bytes = Buffer.byteLength(bodyStr, 'utf8');
    if(bytes > MAX_BYTES) return res.status(413).send('Payload too large');

    const key = `diaries/${encodeURIComponent(uid)}/${safeMonth}.json`;
    const bucket = process.env.S3_BUCKET;
    if(!bucket) return res.status(500).send('server misconfigured');

    const client = new S3Client({ region: process.env.AWS_REGION, credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }});

    const command = new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(bodyStr, 'utf8'), ContentType: 'application/json' });
    try{
      await client.send(command);
      return res.status(200).json({ ok: true });
    }catch(e){
      console.error('[diary-put] s3 error');
      return res.status(500).send('internal error');
    }
  }catch(e){
    console.error('[diary-put] unexpected', e?.message || e);
    return res.status(500).send('internal error');
  }
}
