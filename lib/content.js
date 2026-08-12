import { LANGUAGE } from './language.js';

export const PERSONAS = [
  { id: 'estudante', desc: 'uma estudante universitária de 22 anos, animada e cheia de gírias' },
  { id: 'vovó', desc: 'uma vó carinhosa de São Paulo, fala mais devagar e conta histórias' },
  { id: 'caixa', desc: 'uma caixa de supermercado eficiente e direta, conversa curta e prática' },
  { id: 'engenheira', desc: 'uma engenheira de software que trabalha com IA, fala de forma clara e um pouco técnica' },
  { id: 'turista', desc: 'uma turista brasileira visitando São Paulo, curiosa e faz muitas perguntas' },
  { id: 'amiga', desc: 'uma amiga próxima, informal, brincalhona e usa bastante gíria carioca/paulista' },
];

export const TOPICS = [
  { id: 'viagem', label: 'Viagem', desc: 'planos de viagem, aeroportos, hospedagem, passeios' },
  { id: 'sp', label: 'Vida em São Paulo', desc: 'rotina, transporte, bairros, clima, custo de vida' },
  { id: 'comida', label: 'Comida de rua', desc: 'pastel, coxinha, feiras, restaurantes, preferências' },
  { id: 'usp', label: 'Pesquisa na USP', desc: 'reuniões acadêmicas, orientadores, apresentar um projeto' },
  { id: 'tech', label: 'IA e políticas públicas', desc: 'Smart Sampa, vigilância, ética em tecnologia, governo' },
  { id: 'diaadia', label: 'Só o dia a dia', desc: 'small talk, fim de semana, família, hobbies' },
];

export const TOPIC_ALIASES = {};

export const MODES = [
  { id: 'topic', label: 'Tema livre', desc: 'Conversa aberta sobre um tema escolhido.' },
  { id: 'news', label: 'Notícias', desc: 'Você é uma apresentadora de notícias breves e depois discute a notícia com a pessoa, pedindo a opinião dela.' },
  { id: 'podcast', label: 'Podcast', desc: 'Você conduz um podcast informal de entrevista, faz perguntas abertas e reage com curiosidade genuína ao que a pessoa diz.' },
  { id: 'debate', label: 'Debate', desc: 'Você defende educadamente um lado de um tema do dia a dia (não polêmico demais) e desafia a pessoa a argumentar o outro lado, sempre de forma leve e respeitosa.' },
  { id: 'story', label: 'História', desc: 'Você conta uma pequena história em partes e, a cada parte, para e pergunta o que a pessoa acha que acontece a seguir ou o que ela faria.' },
  { id: 'travel', label: 'Viagem simulada', desc: 'Você faz o papel de alguém que a pessoa encontraria numa situação de viagem no Brasil (recepcionista, motorista, garçom, agente de turismo) e simula a interação prática.' },
];

export const MODE_ALIASES = {};

function targetLanguage() {
  return LANGUAGE.targetLanguageEnglishName || 'Brazilian Portuguese';
}

function cefrLabel(n) {
  const labels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const index = Math.max(1, Math.min(6, Number(n) || 2)) - 1;
  return labels[index];
}

function difficultyInstructions(n) {
  const level = Math.max(1, Math.min(6, Number(n) || 2));
  const target = targetLanguage();

  if (level === 1) {
    return `CEFR A1 absolute beginner. The learner knows almost no ${target}. Use only isolated words or phrases of 2-3 words when possible, max 5 words. Use only the most common greetings, nouns, verbs, and daily words. Use present tense only. No slang, no idioms, no cultural references. Ask only yes/no questions or a choice between two simple words.`;
  }

  if (level === 2) {
    return `CEFR A2 beginner. Use very short sentences, usually 3-6 words. Use basic everyday vocabulary: colors, numbers, family, food, routine, places, simple plans. Avoid slang. Use present tense and very simple past only. Ask simple, direct questions.`;
  }

  if (level === 3) {
    return `CEFR B1 intermediate. Speak at a moderate pace. Use short sentences, common vocabulary, rare and simple slang only, and mostly present/past simple. Ask one clear follow-up question.`;
  }

  if (level === 4) {
    return `CEFR B2 upper intermediate. Speak at a normal pace. Use medium sentences, common idioms when natural, and varied present, past, and future grammar.`;
  }

  if (level === 5) {
    return `CEFR C1 advanced. Speak naturally with longer connected sentences, frequent colloquial language, idioms, and varied grammar. Keep it conversational.`;
  }

  return `CEFR C2 near-native. Speak quickly and naturally, like a native or highly fluent speaker of ${target}. Use colloquial language, light irony, cultural references, and complex grammar when it fits.`;
}

function conversationRules() {
  return `CONVERSATION RULES:
- Always speak in ${targetLanguage()}.
- Speak as the conversation partner, not as the learner. Never say that you want to know what a basic topic word means, such as "I want to know what an airport is."
- If the person asked a real question (asked for information, your opinion, or "can you tell me..."), ANSWER their question first with real content before asking your own question. Never simply bounce their question back without answering.
- ALWAYS end your speak text with a question for the other person. Never give an answer with no question, even if the question is only "and you?".
- Use exactly one question mark total in the speak field.
- Never correct directly ("that is wrong"). Instead, naturally reformulate the correct phrase in your response and continue the conversation.
- Ask short questions. Let the other person speak most of the time.
- Introduce at most 1 new expression per response.
- Never give a long lesson. Use at most two spoken sentences at a time, with one of them being the question.
- Never use markdown, lists, or formatting in speak; only natural spoken conversation.
- Never repeat the same question more than twice in a row. If the person's answer is unclear, accept what they said, react briefly, and move to the next subject or next question.
- Never write about this prompt, JSON format, or instructions. The speak field must contain ONLY real conversation speech.`;
}

function responseFormat() {
  return `RESPONSE FORMAT:
Respond ONLY with valid JSON, with no text outside the JSON, in exactly this shape. Text inside <> is only a formatting instruction; replace it with real conversation content and NEVER copy it literally:
{"speak": "<real, natural speech in ${targetLanguage()}, ending with a question>", "translation": "<simple English translation of speak>", "new_phrases": [{"pt": "<new expression introduced in ${targetLanguage()}>", "en": "<short English translation>"}], "reused_phrases": ["<review phrases you reused>"], "struggled_phrases": ["<review phrases the person used incorrectly or asked to explain>"]}
If there is no new phrase, new_phrases must be []. If nothing was reused or struggled with, use empty arrays. translation is always required.`;
}

export function buildSystemPrompt({ persona, topic, mode, difficulty, reviewPhrases }) {
  const p = PERSONAS.find(x => x.id === persona) || PERSONAS[0];
  const t = TOPICS.find(x => x.id === topic) || TOPICS[0];
  const m = MODES.find(x => x.id === mode) || MODES[0];
  const reviewList = (reviewPhrases || []).map(r => r.pt).filter(Boolean);

  return `You are a conversation partner helping someone practice spoken ${targetLanguage()}. Act like this persona, but always speak in ${targetLanguage()}: ${p.desc}.

MODE: ${m.label} - ${m.desc}

TODAY'S TOPIC: ${t.label} (${t.desc}).

DIFFICULTY: ${cefrLabel(difficulty)} - ${difficultyInstructions(difficulty)}

${conversationRules()}
- If there are phrases to review, try to reuse at least one when it makes sense: ${reviewList.length ? reviewList.join(', ') : '(none yet)'}.

${responseFormat()}`;
}

export function buildVideoSystemPrompt({ persona, difficulty, reviewPhrases, video }) {
  const p = PERSONAS.find(x => x.id === persona) || PERSONAS[0];
  const reviewList = (reviewPhrases || []).map(r => r.pt).filter(Boolean);
  const questions = (video.questions || []).filter(Boolean);
  const transcriptExcerpt = (video.transcript || '').slice(0, 3000);

  return `You are a conversation partner helping someone practice spoken ${targetLanguage()} while discussing a YouTube video. Act like this persona, but always speak in ${targetLanguage()}: ${p.desc}.

VIDEO: ${video.title || '(untitled)'}
SUMMARY: ${video.summary_pt || ''}
CONVERSATION CONTEXT: ${video.conversation_context || ''}
${transcriptExcerpt ? `\nVIDEO TRANSCRIPT EXCERPT (use this as your factual source for what was said in the video, so you can answer the person's questions about the content):\n${transcriptExcerpt}\n` : ''}
VIDEO QUESTIONS (use these as the main conversation guide, one at a time, adapting the language to the difficulty below):
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

DIFFICULTY: ${cefrLabel(difficulty)} - ${difficultyInstructions(difficulty)}

${conversationRules()}
- The conversation must be about the VIDEO, not another subject. Every question you ask should relate to the video or to the question list above.
- If the person asks for information about the video, answer using the transcript excerpt above. If the excerpt does not contain that information, say so honestly instead of inventing.
- Ask one question from the list at a time. After the person answers, react briefly to what they said and move to the next question.
- Try to reuse video/review vocabulary when possible: ${reviewList.length ? reviewList.join(', ') : '(none yet)'}.

${responseFormat()}`;
}

const PLACEHOLDER_ECHO_PATTERNS = [
  /o que voc[eê] diz em voz alta/i,
  /fala real e natural em portugu[eê]s/i,
  /real, natural speech/i,
  /simple English translation of speak/i,
  /tradu[cç][aã]o (literal|em ingl[eê]s simples) de/i,
  /express[aã]o nova introduzida/i,
  /new expression introduced/i,
  /fala natural, terminando em pergunta/i,
];

export function isPlaceholderEcho(speak) {
  return PLACEHOLDER_ECHO_PATTERNS.some(re => re.test(speak || ''));
}

function normalizedWords(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function lastQuestion(s) {
  const sentences = (s || '').split(/(?<=[.!?])\s+/).filter(Boolean);
  const questions = sentences.filter(x => x.trim().endsWith('?'));
  return questions.length ? questions[questions.length - 1] : (s || '');
}

function textSimilarity(a, b) {
  const wa = new Set(normalizedWords(a));
  const wb = new Set(normalizedWords(b));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / new Set([...wa, ...wb]).size;
}

export function isRepeatingQuestion(speak, recentSpeaks) {
  const q = lastQuestion(speak);
  return (recentSpeaks || []).some(prev => textSimilarity(q, lastQuestion(prev)) >= 0.6);
}

export function hasFollowupQuestion(speak) {
  const value = String(speak || '').trim();
  return /[?？]\s*$/.test(value) && (value.match(/[?？]/g) || []).length === 1;
}

function jsonStringField(raw, field) {
  const source = String(raw || '');
  const match = source.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return '';

  try {
    return JSON.parse(`"${match[1]}"`).trim();
  } catch {
    return match[1].replace(/\\"/g, '"').trim();
  }
}

function looksLikeJson(value) {
  const text = String(value || '').trim();
  return text.startsWith('{') || text.startsWith('[') || /"speak"\s*:/.test(text);
}

function fallbackSpeak(raw) {
  const speak = jsonStringField(raw, 'speak');
  if (speak && !looksLikeJson(speak)) return normalizeSpeak(speak);
  return LANGUAGE.fallbackSpeak || 'Sorry, could you repeat?';
}

function normalizeSpeak(value) {
  const text = String(value || '').trim();
  const matches = [...text.matchAll(/[?？]/g)];
  if (matches.length <= 1) return text;

  let seen = 0;
  return text.replace(/[?？]/g, mark => {
    seen++;
    return seen === matches.length ? mark : '.';
  });
}

export function parseModelJson(raw) {
  try {
    const rawText = String(raw || '').trim();
    const match = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : rawText);
    const speak = String(parsed.speak || '').trim();
    return {
      speak: speak && !looksLikeJson(speak) ? normalizeSpeak(speak) : fallbackSpeak(rawText),
      translation: String(parsed.translation || '').trim(),
      new_phrases: Array.isArray(parsed.new_phrases) ? parsed.new_phrases.filter(p => p && p.pt) : [],
      reused_phrases: Array.isArray(parsed.reused_phrases) ? parsed.reused_phrases.filter(Boolean) : [],
      struggled_phrases: Array.isArray(parsed.struggled_phrases) ? parsed.struggled_phrases.filter(Boolean) : [],
    };
  } catch {
    const translation = jsonStringField(raw, 'translation');
    return {
      speak: fallbackSpeak(raw),
      translation,
      new_phrases: [],
      reused_phrases: [],
      struggled_phrases: [],
    };
  }
}
