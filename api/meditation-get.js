// Server endpoint to fetch a user's meditation payload (whole-user JSON).
// POST { idToken }
// Validates Google's ID token and returns stored JSON (plaintext) from S3 at meditations/{uid}.json
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

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
    console.error('[meditation-get] token verification error');
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
    const { idToken } = req.body || {};
    if(!idToken) return res.status(400).send('idToken required');

    const token = await verifyIdToken(idToken);
    if(!token) return res.status(401).send('Unauthorized');

    const uid = token.sub || token.email;
    if(!uid) return res.status(401).send('Unauthorized');

    const safeUid = encodeURIComponent(uid);
    const key = `meditations/${safeUid}.json`;

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
      return res.status(200).json({ ok: true, data: parsed });
    }catch(e){
      if(e?.$metadata && e.$metadata.httpStatusCode === 404){
        return res.status(200).json({ ok: true, data: {} });
      }
      console.error('[meditation-get] s3 error', e);
      // provide a slightly more informative error for debugging (non-sensitive)
      const info = {
        message: e?.message || String(e),
        s3BucketConfigured: !!process.env.S3_BUCKET,
        awsRegionConfigured: !!process.env.AWS_REGION,
        hasAwsCreds: !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY
      };
      try{ return res.status(500).json({ ok: false, error: 'internal error', info }); }catch{ return res.status(500).send('internal error'); }
    }
  }catch(e){
    console.error('[meditation-get] unexpected', e);
    const info = { message: e?.message || String(e), s3BucketConfigured: !!process.env.S3_BUCKET };
    try{ return res.status(500).json({ ok:false, error: 'unexpected', info }); }catch{ return res.status(500).send('internal error'); }
  }
}
