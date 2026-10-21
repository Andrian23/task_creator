const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

export async function sendMessage(chatId, text, options = {}) {
  const response = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...options }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram sendMessage error: ${JSON.stringify(data)}`);
  }
  return data.result;
}

export async function answerCallbackQuery(callbackQueryId, text) {
  const response = await fetch(`${API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram answerCallbackQuery error: ${JSON.stringify(data)}`);
  }
  return data.result;
}

// Downloads a Telegram photo and returns it as a base64 data URL,
// so we never send the bot token to a third party (OpenAI) as part of a URL.
export async function downloadPhotoAsDataUrl(fileId) {
  const fileRes = await fetch(`${API}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const filePath = fileData?.result?.file_path;
  if (!filePath) return null;

  const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
  const imgRes = await fetch(fileUrl);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buf.toString('base64');
  const ext = filePath.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

export async function downloadTelegramFile(fileId) {
  const fileRes = await fetch(`${API}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const filePath = fileData?.result?.file_path;
  if (!filePath) throw new Error(`Telegram getFile error: ${JSON.stringify(fileData)}`);

  const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) throw new Error(`Telegram file download error: ${fileResponse.status}`);
  return Buffer.from(await fileResponse.arrayBuffer());
}
