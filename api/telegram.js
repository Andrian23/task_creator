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

import {
  sendMessage,
  answerCallbackQuery,
  downloadPhotoAsDataUrl,
  downloadTelegramFile,
} from '../lib/telegram.js';
import { getSession, setSession, clearSession, claimOnce } from '../lib/redis.js';
import { runAssistant } from '../lib/openai.js';
import {
  createClickUpTask,
  getClickUpMembers,
} from '../lib/clickup.js';
import { getPendingUpworkOptions, resolvePendingUpworkEvent } from '../lib/upwork.js';
import { extractDocumentText } from '../lib/documents.js';
import {
  protectVerbatimSections,
  restoreVerbatimSections,
  addIncognitoFlags,
} from '../lib/verbatim.js';

function taskPreview(task) {
  const deadline = new Date(task.due_datetime).toLocaleString('uk-UA', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const description = task.description.length > 3200
    ? `${task.description.slice(0, 3200)}\n\n…опис скорочено в превʼю`
    : task.description;
  return `Переглянь таску перед створенням.\n\nНазва: ${task.title}\nДедлайн: ${deadline}\n\n${description}\n\nЯкщо все правильно — натисни «Все ок». Якщо треба щось змінити — просто напиши правку повідомленням.`;
}

async function showAssigneeSelection(chatId, task) {
  const members = await getClickUpMembers();
  await setSession(chatId, {
    pendingTask: task,
    members: members.map(({ id, username }) => ({ id, username })),
  });
  const keyboard = members.map((member) => [{
    text: member.username,
    callback_data: `assign:${member.id}`,
  }]);
  keyboard.push([{ text: 'Без виконавця', callback_data: 'assign:none' }]);
  await sendMessage(chatId, `На кого призначити таску «${task.title}»?`, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

function containsLinks(text = '') {
  return /https?:\/\/[^\s<>"]+/i.test(text);
}

function removeLinks(text = '') {
  return text
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function continueAfterTaskPrepared(chatId, task) {
  if (!containsLinks(task.description)) {
    await showAssigneeSelection(chatId, task);
    return;
  }
  await setSession(chatId, { pendingTask: task });
  await sendMessage(chatId, 'У задачі є посилання. Що з ними зробити?', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Залишити', callback_data: 'links:keep' }],
        [{ text: 'Видалити', callback_data: 'links:remove' }],
        [{ text: 'Залишити — лише інкогніто', callback_data: 'links:incognito' }],
      ],
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('Bot is running');
    return;
  }

  try {
    const update = req.body;
    if (update?.update_id !== undefined) {
      const isNewUpdate = await claimOnce(`telegram-update:${update.update_id}`);
      if (!isNewUpdate) {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
    }
    const callback = update && update.callback_query;

    if (callback?.data?.startsWith('uwopen:')) {
      const nonce = callback.data.slice('uwopen:'.length);
      const options = await getPendingUpworkOptions(nonce);
      if (!options) {
        await answerCallbackQuery(callback.id, 'Цей вибір уже неактуальний.');
      } else {
        await answerCallbackQuery(callback.id, 'Оберіть проєкт');
        const keyboard = options.projects.map((project) => [{
          text: project.name.slice(0, 50),
          callback_data: `uw:${nonce}:${project.id}`.slice(0, 64),
        }]);
        await sendMessage(callback.message.chat.id, 'До якого ClickUp-проєкту приєднати цей чат?', {
          reply_markup: { inline_keyboard: keyboard },
        });
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (callback?.data?.startsWith('uw:')) {
      const [, nonce, taskId] = callback.data.split(':');
      const result = await resolvePendingUpworkEvent(nonce, taskId);
      await answerCallbackQuery(callback.id, result.error ? 'Вибір уже неактуальний.' : 'Проєкт привʼязано');
      if (!result.error) await sendMessage(callback.message.chat.id, `Готово: чат привʼязано до «${result.project.name}».`);
      res.status(200).json({ ok: true });
      return;
    }

    if (callback?.data?.startsWith('links:')) {
      const chatId = callback.message.chat.id;
      const session = await getSession(chatId);
      if (!session?.pendingTask) {
        await answerCallbackQuery(callback.id, 'Цей вибір уже неактуальний.');
        res.status(200).json({ ok: true });
        return;
      }
      const choice = callback.data.slice('links:'.length);
      const task = { ...session.pendingTask };
      if (choice === 'remove') task.description = removeLinks(task.description);
      if (choice === 'incognito') task.description = addIncognitoFlags(task.description);
      await answerCallbackQuery(callback.id, choice === 'remove'
        ? 'Посилання видалено'
        : choice === 'incognito'
          ? 'Додано позначку про інкогніто'
          : 'Посилання залишено');
      await showAssigneeSelection(chatId, task);
      res.status(200).json({ ok: true });
      return;
    }

    if (callback?.data === 'review:approve') {
      const chatId = callback.message.chat.id;
      const session = await getSession(chatId);
      if (!session?.pendingTask) {
        await answerCallbackQuery(callback.id, 'Превʼю вже неактуальне.');
      } else {
        await answerCallbackQuery(callback.id, 'Погоджено');
        await showAssigneeSelection(chatId, session.pendingTask);
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (callback?.data?.startsWith('assign:')) {
      const chatId = callback.message.chat.id;
      const assigneeId = callback.data.slice('assign:'.length);
      const session = await getSession(chatId);
      const member = assigneeId === 'none'
        ? { id: null, username: 'нікого' }
        : session?.members?.find((item) => String(item.id) === assigneeId);

      if (!session?.pendingTask || !member) {
        await answerCallbackQuery(callback.id, 'Цей вибір уже неактуальний.');
        await sendMessage(chatId, 'Надішли завдання ще раз — попередня сесія завершилась.');
        res.status(200).json({ ok: true });
        return;
      }

      const canCreate = await claimOnce(`task-create:${chatId}:${session.pendingTask.title}`, 120);
      if (!canCreate) {
        await answerCallbackQuery(callback.id, 'Таска вже створюється.');
        res.status(200).json({ ok: true });
        return;
      }

      await answerCallbackQuery(callback.id, `Виконавець: ${member.username}`);
      const { ok, data } = await createClickUpTask({
        ...session.pendingTask,
        assigneeId: member.id,
      });

      if (ok) {
        await clearSession(chatId);
        await sendMessage(
          chatId,
          assigneeId === 'none'
            ? `Готово! Таска створена без виконавця.\n${data.url}`
            : `Готово! Таска призначена на ${member.username}.\n${data.url}`
        );
      } else {
        await sendMessage(chatId, `Помилка ClickUp: ${JSON.stringify(data)}`);
      }
      res.status(200).json({ ok: true });
      return;
    }

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
    let newProtectedSegments = [];
    if (text) {
      const protectedText = protectVerbatimSections(text);
      newProtectedSegments = protectedText.replacements;
      contentParts.push({ type: 'text', text: protectedText.text });
    }

    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1];
      const dataUrl = await downloadPhotoAsDataUrl(largest.file_id);
      if (dataUrl) {
        contentParts.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }

    if (message.document) {
      try {
        const buffer = await downloadTelegramFile(message.document.file_id);
        const documentText = await extractDocumentText(
          buffer,
          message.document.file_name,
          message.document.mime_type || ''
        );
        const protectedDocument = protectVerbatimSections(
          documentText,
          newProtectedSegments.length
        );
        newProtectedSegments.push(...protectedDocument.replacements);
        contentParts.push({
          type: 'text',
          text: `Вміст документа «${message.document.file_name || 'без назви'}»:\n\n${protectedDocument.text}`,
        });
      } catch (error) {
        const reply = error.message === 'UNSUPPORTED_DOCUMENT'
          ? 'Поки підтримую PDF, DOCX, TXT, Markdown і CSV.'
          : error.message === 'EMPTY_DOCUMENT'
            ? 'Не знайшов текст у документі. Якщо це сканований PDF, надішли сторінки як зображення.'
            : 'Не вдалося прочитати документ. Спробуй інший файл або надішли текст повідомленням.';
        await sendMessage(chatId, reply);
        res.status(200).json({ ok: true });
        return;
      }
    }

    if (contentParts.length === 0) {
      res.status(200).json({ ok: true });
      return;
    }

    // Title and deadline are explicit user decisions. Keep these two steps
    // deterministic instead of letting the model guess them from the source.
    const existing = await getSession(chatId);
    const messages = existing?.messages || [];

    if (existing?.awaitingField === 'review') {
      if (/^(все\s*(ок|добре)|ок|погоджую|готово)$/i.test(text.trim())) {
        await showAssigneeSelection(chatId, existing.pendingTask);
        res.status(200).json({ ok: true });
        return;
      }
      messages.push({ role: 'assistant', content: JSON.stringify(existing.pendingTask) });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `Внеси лише цю правку в таску: ${text}` }],
      });
      const revised = await runAssistant(messages);
      if (revised.action === 'create') {
        revised.description = addIncognitoFlags(restoreVerbatimSections(
          revised.description,
          existing.protectedSegments || []
        ));
        await setSession(chatId, {
          messages,
          awaitingField: 'review',
          pendingTask: revised,
          protectedSegments: existing.protectedSegments || [],
        });
        await sendMessage(chatId, taskPreview(revised), {
          reply_markup: { inline_keyboard: [[{ text: '✅ Все ок', callback_data: 'review:approve' }]] },
        });
      } else {
        await sendMessage(chatId, revised.question || 'Уточни, будь ласка, що саме змінити.');
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (!existing) {
      messages.push({ role: 'user', content: contentParts });
      await setSession(chatId, {
        messages,
        awaitingField: 'title',
        protectedSegments: newProtectedSegments,
      });
      await sendMessage(
        chatId,
        'Як назвати таску? Можу взяти назву файла, ID/заголовок із матеріалу або твою назву.'
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (existing.awaitingField === 'title') {
      messages.push({
        role: 'user',
        content: [{
          type: 'text',
          text: `Вказівка щодо назви таски: ${text || 'використай назву файла'}`,
        }],
      });
      await setSession(chatId, {
        messages,
        awaitingField: 'deadline',
        protectedSegments: existing.protectedSegments || [],
      });
      await sendMessage(chatId, 'На коли дедлайн?');
      res.status(200).json({ ok: true });
      return;
    }

    if (existing.awaitingField === 'deadline') {
      messages.push({
        role: 'user',
        content: [{
          type: 'text',
          text: `Вказівка щодо дедлайну: ${text}`,
        }],
      });
    } else {
      messages.push({ role: 'user', content: contentParts });
    }

    const result = await runAssistant(messages);

    if (result.action === 'create') {
      result.description = restoreVerbatimSections(
        result.description,
        existing.protectedSegments || []
      );
    }

    if (result.action === 'ask') {
      messages.push({ role: 'assistant', content: JSON.stringify(result) });
      await setSession(chatId, { messages });
      await sendMessage(chatId, result.question);
      res.status(200).json({ ok: true });
      return;
    }

    if (result.action === 'create') {
      await continueAfterTaskPrepared(chatId, result);
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
