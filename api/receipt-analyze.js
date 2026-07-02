// Server endpoint to analyze a receipt image via an AI provider (see lib/ai/).
// POST { imageBase64, mimeType }, Authorization: Bearer <supabase access_token>
// Verifies the caller's Supabase session, then relays the image to the configured
// AI provider using a server-only API key (never exposed to the browser).
import { createClient } from '@supabase/supabase-js';
import { analyzeReceipt } from '../lib/ai/index.js';

// Same public values already embedded in meditation-cloud.js (anon key is safe to
// share; access is enforced by Supabase RLS / token verification, not secrecy).
const SUPABASE_URL = 'https://jlkfvijgfrvoesazegnc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yfTwumo2INpAJIJRq7_WSA_ivenN96B';

async function verifySupabaseUser(accessToken) {
  if (!accessToken) return null;
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user) return null;
    return data.user;
  } catch (e) {
    console.error('[receipt-analyze] token verification error');
    return null;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const authHeader = req.headers['authorization'] || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = await verifySupabaseUser(accessToken);
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ ok: false, error: 'imageBase64 required' });
    }
    if (!mimeType || !/^image\/(png|jpe?g|webp)$/i.test(mimeType)) {
      return res.status(400).json({ ok: false, error: 'unsupported mimeType' });
    }

    const MAX_BASE64_CHARS = Number(process.env.RECEIPT_MAX_BASE64_CHARS || 2 * 1024 * 1024);
    if (imageBase64.length > MAX_BASE64_CHARS) {
      return res.status(413).json({ ok: false, error: 'image too large' });
    }

    const data = await analyzeReceipt({ imageBase64, mimeType });
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error('[receipt-analyze] unexpected', e?.message || e);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
}
