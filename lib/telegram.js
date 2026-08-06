const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

export async function sendMessage(chatId, text) {
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
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
