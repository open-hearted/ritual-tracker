// Shared prompt + response parsing for receipt image analysis.
// Every provider adapter returns the same shape via parseReceiptResponseText().
export const RECEIPT_CATEGORIES = ['食費', '日用品', '交通費', '娯楽', 'その他'];

export const RECEIPT_PROMPT = `これはレシート画像です。次のJSON形式のみで結果を返してください。説明文やコードブロックは付けないでください。
{
  "store": "店名の文字列。支店名・店舗名（例: ○○店、○○支店、○丁目店など）が読み取れる場合は、店名にできるだけ含めて1つの文字列として返してください（例: 「セブンイレブン新宿三丁目店」「東武ストア王子店」）。支店名まで判読できず店のブランド名しか読み取れない場合はブランド名のみで構いません。店名自体が読み取れなければ null",
  "date": "レシートの日付。YYYY-MM-DD形式の文字列、読み取れなければ null",
  "time": "レシートに印字された購入時刻。HH:MM形式（24時間）、読み取れなければ null",
  "total": "実際の購入金額（税込合計。「合計」「小計+税」「ご請求金額」などと印字された金額）を数値のみで。現金払いの場合にレシートへ併記される「お預かり」「お預り」「預り金」（客が渡した現金の額）や「おつり」「お釣り」（返金額）は購入金額ではないので total には絶対に使わないでください。お預かりの金額の方が大きくても、totalには必ず合計金額の方を採用してください。読み取れなければ null",
  "category": "次のいずれか1つ: 食費, 日用品, 交通費, 娯楽, その他。判断できなければ null"
}
読み取れない項目は必ず null にしてください。数値にカンマや通貨記号を含めないでください。`;

export function parseReceiptResponseText(text) {
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = {};
  }
  const store = typeof parsed.store === 'string' && parsed.store.trim() ? parsed.store.trim().slice(0, 120) : null;
  const date = typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
  let time = null;
  if(typeof parsed.time === 'string'){
    const m = parsed.time.trim().match(/^(\d{1,2}):(\d{2})/);
    if(m){
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) time = `${String(hh).padStart(2, '0')}:${m[2]}`;
    }
  }
  const totalNum = Number(parsed.total);
  const total = parsed.total !== null && parsed.total !== undefined && Number.isFinite(totalNum) ? Math.round(totalNum) : null;
  const category = RECEIPT_CATEGORIES.includes(parsed.category) ? parsed.category : null;
  return { store, date, time, total, category };
}
