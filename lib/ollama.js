const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';

export async function chat(messages) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, format: 'json', stream: false }),
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.message?.content || '';
}
