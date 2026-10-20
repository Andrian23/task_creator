import { getActiveClickUpProjects } from './clickup.js';
import { getMappedProjectHistories } from './database.js';

const SYSTEM_PROMPT = `Ти — внутрішній AI-помічник команди, який аналізує переписки з клієнтами Upwork.
Відповідай українською, стисло й конкретно. Спирайся лише на переданий контекст.
Чітко відділяй факти з переписки від власних висновків. Якщо даних недостатньо — прямо скажи про це.
Звертай увагу на домовленості, дедлайни, відкриті питання, ризики, обіцянки команди та наступні кроки.
Не вигадуй повідомлень, статусів або дій. Ти працюєш лише в режимі читання: не обіцяй змінити ClickUp чи написати клієнту.`;

export function extractAssistantQuestion(text = '', botUsername = '') {
  const question = String(text).trim();
  if (/^\/(ai|project)(?:@\w+)?(?:\s|$)/i.test(question)) {
    return question.replace(/^\/(ai|project)(?:@\w+)?\s*/i, '').trim();
  }
  const normalizedUsername = String(botUsername).replace(/^@/, '').trim();
  if (!normalizedUsername) return null;
  const escapedUsername = normalizedUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mention = new RegExp(`@${escapedUsername}\\b`, 'i');
  if (!mention.test(question)) return null;
  return question.replace(mention, '').trim();
}

function outputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

export async function answerProjectQuestion(question) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');
  const projects = await getActiveClickUpProjects();
  const histories = await getMappedProjectHistories(projects.map(({ id }) => id), 30);
  const projectById = new Map(projects.map((project) => [String(project.id), project]));
  const context = histories.map((history) => {
    const project = projectById.get(String(history.taskId));
    return {
      project: project?.name || history.topic || history.taskId,
      status: project?.status || '',
      assignees: (project?.assignees || []).map(({ name }) => name),
      upworkRoom: history.topic || '',
      messages: history.messages.map((message) => ({
        author: message.author || 'Невідомо',
        direction: message.direction,
        timestamp: message.message_timestamp || message.received_at,
        text: message.body,
      })),
    };
  });
  if (!context.length) return 'Немає активних привʼязаних проєктів з історією повідомлень.';

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.PROJECT_AI_MODEL || 'gpt-5.4-mini',
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 1200,
      instructions: SYSTEM_PROMPT,
      input: `Запит користувача:\n${question}\n\nАктивні проєкти та останні повідомлення (JSON):\n${JSON.stringify(context)}`,
    }),
  });
  const data = await response.json();
  const answer = outputText(data);
  if (!response.ok || !answer) throw new Error(`OpenAI project assistant error: ${JSON.stringify(data)}`);
  return answer;
}
