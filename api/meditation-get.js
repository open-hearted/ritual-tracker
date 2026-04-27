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
    const { idToken, migrationUid, altUid, candidateUids } = req.body || {};

    let uidsToTry = [];
    if (candidateUids && Array.isArray(candidateUids)) {
      uidsToTry = candidateUids;
    } else if (migrationUid) {
      uidsToTry = [migrationUid, altUid];
    } else {
      if(!idToken) return res.status(400).send('idToken required');
      const token = await verifyIdToken(idToken);
      if(!token) return res.status(401).send('Unauthorized');
      uidsToTry = [token.sub || token.email];
    }

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

    // 候補のuidをすべて試す。見つかったら即返す
    for (const uid of uidsToTry) {
      if (!uid) continue;
      try {
        const bodyStr = await fetchS3(`meditations/${encodeURIComponent(uid)}.json`);
        let parsed = {};
        try{ parsed = JSON.parse(bodyStr || '{}'); }catch(e){ parsed = {}; }
        // 空っぽじゃない有意義なデータが見つかったらそれを採用
        if (parsed && parsed.data && Object.keys(parsed.data).length > 0) {
          return res.status(200).json({ ok: true, data: parsed, migrated_from: uid });
        }
      } catch (e) {
        // 見つからなければ次の候補へ(404)
      }
    }

    return res.status(200).json({ ok: true, data: {} });
  }catch(e){
    console.error('[meditation-get] unexpected', e);
    const info = { message: e?.message || String(e), s3BucketConfigured: !!process.env.S3_BUCKET };
    try{ return res.status(500).json({ ok:false, error: 'unexpected', info }); }catch{ return res.status(500).send('internal error'); }
  }
}
