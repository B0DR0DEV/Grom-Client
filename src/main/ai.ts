import https from 'node:https';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';

// ═══════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ СБОРОК (как было)
// ═══════════════════════════════════════════════════════
export async function generateModpack(apiKey: string, prompt: string): Promise<{ name: string; mods: string[]; description: string }> {
  const systemPrompt = `Ты — помощник для генерации сборок модов Minecraft.
Пользователь описывает, какую сборку он хочет. Ты возвращаешь JSON:
{
  "name": "Название сборки",
  "description": "Краткое описание",
  "mods": ["slug1", "slug2", ...]
}
mods — это слаги модов с Modrinth (например, "sodium", "lithium", "create", "jei", "appleskin").
Отвечай ТОЛЬКО валидным JSON, без markdown, без пояснений.`;

  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Сделай JSON для сборки: ${prompt}` },
    ],
    temperature: 0.7,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
  });

  const result = await deepseekRequest(apiKey, body);
  const content = result.choices[0].message.content;
  return JSON.parse(content);
}

// ═══════════════════════════════════════════════════════
// ЧАТ С ИИ
// ═══════════════════════════════════════════════════════

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatContext {
  nickname: string;
  version: string;
  loader: string;
  ram: number;
  totalRam: number;
  theme: string;
  installedMods: string[];
}

function buildSystemPrompt(context: ChatContext): string {
  const modsList = context.installedMods.length > 0
    ? context.installedMods.join(', ')
    : 'нет установленных модов';

  return `Ты — GROM AI, встроенный помощник Minecraft-лаунчера "Grom Client".
Ты знаешь всё о Minecraft: моды, Fabric, оптимизацию, ошибки, краши, версии.
Ты помогаешь русскоязычным игрокам разобраться с их вопросами.

ТЕКУЩИЙ КОНТЕКСТ ИГРОКА:
- Ник: ${context.nickname}
- Версия Minecraft: ${context.version || 'не выбрана'}
- Загрузчик: ${context.loader}
- ОЗУ выделено: ${context.ram} МБ из ${context.totalRam} МБ
- Тема лаунчера: ${context.theme}
- Установленные моды: ${modsList}

ПРАВИЛА ОТВЕТОВ:
- Отвечай КРАТКО (2-6 предложений), по делу, на русском языке.
- Если нужен список — используй маркированный список через тире.
- Не используй эмодзи в начале каждого предложения. Максимум 1-2 эмодзи в ответе, если уместно.
- Если вопрос про моды — предлагай конкретные слаги с Modrinth (например: sodium, lithium, create).
- Если вопрос про ошибку — сначала назови причину, потом решение.
- Если не знаешь ответ — честно скажи "не знаю", не выдумывай.
- Не упоминай, что ты ИИ или языковая модель.`;
}

export async function chatWithAI(
  messages: ChatMessage[],
  context: ChatContext,
  apiKey: string
): Promise<{ success: boolean; reply?: string; error?: string }> {
  try {
    const systemPrompt = buildSystemPrompt(context);

    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const result = await deepseekRequest(apiKey, body);

    if (result.error) {
      return { success: false, error: result.error.message || 'Ошибка DeepSeek' };
    }

    const reply = result.choices?.[0]?.message?.content;
    if (!reply) {
      return { success: false, error: 'Пустой ответ от ИИ' };
    }

    return { success: true, reply };
  } catch (err: any) {
    return { success: false, error: err.message || 'Ошибка запроса' };
  }
}

// ═══════════════════════════════════════════════════════
// ОБЩИЙ ЗАПРОС К DEEPSEEK
// ═══════════════════════════════════════════════════════

function deepseekRequest(apiKey: string, body: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(DEEPSEEK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 45000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Таймаут DeepSeek (45 сек)')); });
    req.write(body);
    req.end();
  });
}