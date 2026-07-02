import { analyzeReceiptWithOpenAI } from './providers/openai.js';
import { analyzeReceiptWithClaude } from './providers/claude.js';
import { analyzeReceiptWithGemini } from './providers/gemini.js';

const PROVIDERS = {
  openai: analyzeReceiptWithOpenAI,
  claude: analyzeReceiptWithClaude,
  gemini: analyzeReceiptWithGemini
};

// { imageBase64, mimeType } -> { store, date, total, category }
export async function analyzeReceipt({ imageBase64, mimeType }) {
  const providerName = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown AI_PROVIDER: ${providerName}`);
  return provider({ imageBase64, mimeType });
}
