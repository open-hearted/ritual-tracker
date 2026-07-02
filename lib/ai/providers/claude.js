import { RECEIPT_PROMPT, parseReceiptResponseText } from '../util.js';

// imageBase64: raw base64 (no data: prefix), mimeType e.g. "image/jpeg"
export async function analyzeReceiptWithClaude({ imageBase64, mimeType }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: RECEIPT_PROMPT }
          ]
        }
      ]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  const text = json?.content?.[0]?.text || '';
  return parseReceiptResponseText(text);
}
