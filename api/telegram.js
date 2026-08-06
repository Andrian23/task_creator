// Telegram webhook -> GPT-4o-mini gathers task info (text/screenshots, follow-up
// questions) -> creates a task in ClickUp once it has enough info.
//
// Env vars required (Vercel -> Project -> Settings -> Environment Variables):
//   TELEGRAM_BOT_TOKEN   - token from @BotFather
//   CLICKUP_API_TOKEN    - ClickUp personal API token (starts with pk_)
//   CLICKUP_LIST_ID      - numeric ClickUp List ID
//   OPENAI_API_KEY       - OpenAI API key (gpt-4o-mini)
//   UPSTASH_REDIS_URL    - Upstash Redis REST URL (for conversation state)
//   UPSTASH_REDIS_TOKEN  - Upstash Redis REST token

import { sendMessage, downloadPhotoAsDataUrl } from '../lib/telegram.js';
import { getSession, setSession, clearSession } from '../lib/redis.js';
import { runAssistant } from '../lib/openai.js';
import { createClickUpTask } from '../lib/clickup.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('Bot is running');
    return;
  }

  try {
    const update = req.body;
    const message = update && update.message;

    if (!message) {
      res.status(200).json({ ok: true });
      return;
    }

    const chatId = message.chat.id;
    const text = (message.text || message.caption || '').trim();

    if (text === '/start') {
      await sendMessage(
        chatId,
        'Привіт! Кидай мені завдання для криейтора — текстом, скріншотом чи і тим, і іншим, у будь-якій формі. Якщо чогось бракуватиме — перепитаю. Команда /cancel скасовує поточне завдання.'
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (text === '/cancel') {
      await clearSession(chatId);
      await sendMessage(chatId, 'Скасував поточне завдання.');
      res.status(200).json({ ok: true });
      return;
    }

    // Build this message's content for the model (text and/or image).
    const contentParts = [];
    if (text) contentParts.push({ type: 'text', text });

    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1];
      const dataUrl = await downloadPhotoAsDataUrl(largest.file_id);
      if (dataUrl) {
        contentParts.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }

    if (contentParts.length === 0) {
      res.status(200).json({ ok: true });
      return;
    }

    // Load or start the conversation for this chat.
    const existing = await getSession(chatId);
    const messages = existing?.messages || [];
    messages.push({ role: 'user', content: contentParts });

    const result = await runAssistant(messages);

    if (result.action === 'ask') {
      messages.push({ role: 'assistant', content: JSON.stringify(result) });
      await setSession(chatId, { messages });
      await sendMessage(chatId, result.question);
      res.status(200).json({ ok: true });
      return;
    }

    if (result.action === 'create') {
      const { ok, data } = await createClickUpTask(result);
      await clearSession(chatId);

      if (ok) {
        await sendMessage(chatId, `Готово! Таска створена:\n${data.url}`);
      } else {
        await sendMessage(chatId, `Помилка ClickUp: ${JSON.stringify(data)}`);
      }
      res.status(200).json({ ok: true });
      return;
    }

    // Unexpected shape - don't lose the session, just report and keep waiting.
    await sendMessage(chatId, 'Щось пішло не так, спробуй ще раз або /cancel.');
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    // Always answer 200 so Telegram doesn't keep retrying the same update.
    res.status(200).json({ ok: true });
  }
}
