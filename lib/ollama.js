const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';
const NUM_PREDICT = Math.max(120, Number(process.env.OLLAMA_NUM_PREDICT || 180));
const TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE || 0.6);
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '10m';

export async function chat(messages) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      format: 'json',
      stream: false,
      keep_alive: KEEP_ALIVE,
      options: {
        num_predict: NUM_PREDICT,
        temperature: TEMPERATURE,
      },
    }),
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.message?.content || '';
}

export async function translateToEnglish(text, sourceLanguage) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: [
            'You are a deterministic translation engine.',
            'Translate the user text into standard English.',
            'Preserve the meaning exactly.',
            'Do not add explanations, commentary, alternatives, notes, markdown, or quotation marks.',
            'Do not answer the question. Only translate it.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Source language: ${sourceLanguage}\nText: ${text}`,
        },
      ],
      stream: false,
      keep_alive: KEEP_ALIVE,
      options: {
        num_predict: Math.max(40, Math.min(120, NUM_PREDICT)),
        temperature: 0,
        seed: 1,
      },
    }),
  });
  if (!r.ok) throw new Error(`Ollama translation error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return String(data.message?.content || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
}
