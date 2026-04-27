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
    const { idToken, migrationUid, altUid } = req.body || {};

    let uid = null;
    if (migrationUid) {
      uid = migrationUid; // お引越し用バイパス
    } else {
      if(!idToken) return res.status(400).send('idToken required');
      const token = await verifyIdToken(idToken);
      if(!token) return res.status(401).send('Unauthorized');
      uid = token.sub || token.email;
    }
    if(!uid) return res.status(401).send('Unauthorized');

    const bucket = process.env.S3_BUCKET;
    if(!bucket) return res.status(500).send('server misconfigured');

    const client = new S3Client({ region: process.env.AWS_REGION, credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }});

    async function fetchS3(keyStr) {
      const command = new GetObjectCommand({ Bucket: bucket, Key: keyStr });
      const out = await client.send(command);
      return await streamToString(out.Body);
    }

    try{
      const bodyStr = await fetchS3(`meditations/${encodeURIComponent(uid)}.json`);
      let parsed = {};
      try{ parsed = JSON.parse(bodyStr || '{}'); }catch(e){ parsed = {}; }
      return res.status(200).json({ ok: true, data: parsed });
    }catch(e){
      if (altUid && altUid !== uid) {
        try {
          const bodyStr2 = await fetchS3(`meditations/${encodeURIComponent(altUid)}.json`);
          let parsed2 = {};
          try{ parsed2 = JSON.parse(bodyStr2 || '{}'); }catch(ex){ parsed2 = {}; }
          return res.status(200).json({ ok: true, data: parsed2 });
        } catch(e2) {
          // ignore
        }
      }
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
