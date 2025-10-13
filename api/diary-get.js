// Server endpoint to fetch a user's diary for a given month.
// POST { idToken, monthKey }
// Validates Google's ID token (tokeninfo) and uses server-side S3 to return JSON data.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

async function verifyIdToken(idToken){
  if(!idToken) return null;
  try{
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if(!res.ok) return null;
    const json = await res.json();
    // Expected fields: aud, sub, email
    if(!process.env.GOOGLE_CLIENT_ID) return null;
    if(json.aud !== process.env.GOOGLE_CLIENT_ID) return null;
    return json; // contains sub, email, etc.
  }catch(e){
    console.error('[diary-get] token verification error');
    return null;
  }
}

function safeKey(raw){
  if(typeof raw !== 'string') return null;
  if(!/^[0-9A-Za-z._-]+$/.test(raw)) return null;
  return raw;
}

async function streamToString(stream){
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res){
  try{
    if(req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { idToken, monthKey } = req.body || {};
    if(!idToken || !monthKey) return res.status(400).send('idToken and monthKey required');

    const token = await verifyIdToken(idToken);
    if(!token) return res.status(401).send('Unauthorized');

    const uid = token.sub || token.email;
    if(!uid) return res.status(401).send('Unauthorized');

    const safeMonth = safeKey(monthKey);
    if(!safeMonth) return res.status(400).send('invalid monthKey');

    const key = `diaries/${encodeURIComponent(uid)}/${safeMonth}.json`;

    const bucket = process.env.S3_BUCKET;
    if(!bucket) return res.status(500).send('server misconfigured');

    const client = new S3Client({ region: process.env.AWS_REGION, credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }});

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    try{
      const out = await client.send(command);
      const bodyStr = await streamToString(out.Body);
      let parsed = {};
      try{ parsed = JSON.parse(bodyStr || '{}'); }catch(e){ parsed = {}; }
      // return only the diary JSON; do not leak bucket/key
      return res.status(200).json({ ok: true, data: parsed });
    }catch(e){
      // missing object -> treat as empty diary; avoid leaking S3 details
      // log a minimal message
      if(e?.$metadata && e.$metadata.httpStatusCode === 404) {
        return res.status(200).json({ ok: true, data: {} });
      }
      console.error('[diary-get] s3 error');
      return res.status(500).send('internal error');
    }
  }catch(e){
    console.error('[diary-get] unexpected', e?.message || e);
    return res.status(500).send('internal error');
  }
}
