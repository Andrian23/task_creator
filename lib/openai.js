const SYSTEM_PROMPT = `Ти — асистент, що допомагає власнику Telegram-каналу створювати таски для криейторів у ClickUp.
Користувач надсилає завдання у вільній формі: текстом, скріншотом (з підписом або без), або і тим, і іншим.

Твоя мета — зібрати мінімум, необхідний для створення таски:
1. creator — ім'я/позначення криейтора-виконавця
2. title — коротка, чітка назва завдання
3. description — суть завдання докладніше (можна повторити title, якщо більше нічого не додано)

due_date і priority — опціональні. Питай про них ТІЛЬКИ якщо це критично важливо і не зрозуміло з контексту.
Задавай не більше ОДНОГО уточнюючого питання за раз. Не будь занудним — якщо суть завдання і виконавець зрозумілі,
одразу переходь до створення, не вигадуй зайвих питань.

Якщо на скріншоті вже видно достатньо контексту (наприклад переписка, бриф, ТЗ) — використовуй це замість того,
щоб перепитувати те, що вже написано.

Завжди відповідай ЛИШЕ JSON-об'єктом, без жодного тексту навколо, в одному з двох форматів:

Якщо потрібне уточнення:
{"action":"ask","question":"текст питання українською"}

Якщо готовий створити таску:
{"action":"create","creator":"ім'я","title":"коротка назва","description":"деталі","due_date":"YYYY-MM-DD або null","priority":"urgent|high|normal|low або null"}`;

export async function runAssistant(messages) {
  const apiKey = process.env.OPENAI_API_KEY;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    }),
  });

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  }

  try {
    return JSON.parse(content);
  } catch {
    // Model didn't return valid JSON - ask the user to rephrase instead of crashing.
    return { action: 'ask', question: 'Не зрозумів, можеш переформулювати завдання?' };
  }
}
