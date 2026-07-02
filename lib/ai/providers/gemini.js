import { RECEIPT_PROMPT, parseReceiptResponseText } from '../util.js';

// imageBase64: raw base64 (no data: prefix), mimeType e.g. "image/jpeg"
export async function analyzeReceiptWithGemini({ imageBase64, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: RECEIPT_PROMPT },
              { inline_data: { mime_type: mimeType, data: imageBase64 } }
            ]
          }
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseReceiptResponseText(text);
}
