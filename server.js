import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { PERSONAS, TOPICS, MODES, buildSystemPrompt, buildVideoSystemPrompt, parseModelJson, isPlaceholderEcho, isRepeatingQuestion } from './lib/content.js';
import { chat } from './lib/ollama.js';
import { transcribe, synthesize } from './lib/speech.js';
import { buildLessonFromVideo } from './lib/youtube.js';
import {
  phrasesForReview,
  allPhrases,
  masteryBuckets,
  recordNewPhrase,
  recordReused,
  recordStruggled,
  startSession,
  recordTurn,
  endSession,
  recentSessions,
  clarityTrend,
  currentStreak,
  getAdaptiveDifficulty,
  updateAdaptiveDifficulty,
  saveVideoLesson,
  getVideoLesson,
  recentVideos,
} from './lib/memory.js';

const app = express();
const port = process.env.PORT || 3000;
const MAX_HISTORY = 20;

app.use(express.json({ limit: '2mb' }));
app.use(express.raw({ type: ['audio/webm', 'audio/ogg', 'application/octet-stream'], limit: '15mb' }));
app.use(express.static('public'));

const sessions = new Map();

function applyMemoryEffects(parsed, videoId) {
  for (const p of parsed.new_phrases) recordNewPhrase(p.pt, p.en, videoId);
  for (const pt of parsed.reused_phrases) recordReused(pt);
  for (const pt of parsed.struggled_phrases) recordStruggled(pt);
}

function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY + 1) return messages;
  return [messages[0], ...messages.slice(-MAX_HISTORY)];
}

function recentAssistantSpeaks(messages, count) {
  return messages
    .filter(m => m.role === 'assistant')
    .slice(-count)
    .map(m => parseModelJson(m.content).speak)
    .filter(Boolean);
}

async function chatWithRetry(messages) {
  let raw = await chat(messages);
  let parsed = parseModelJson(raw);
  if (isPlaceholderEcho(parsed.speak)) {
    raw = await chat([...messages, { role: 'user', content: 'Sua última resposta não foi uma fala real, foi o formato do JSON copiado. Responda de novo com fala de verdade, em português, seguindo o formato.' }]);
    parsed = parseModelJson(raw);
  }
  const recent = recentAssistantSpeaks(messages, 3);
  if (isRepeatingQuestion(parsed.speak, recent)) {
    raw = await chat([...messages, { role: 'user', content: 'Você já perguntou isso antes de formas diferentes e a pessoa já respondeu. Não repita a mesma pergunta de novo. Aceite a última resposta da pessoa, reaja brevemente a ela, e mude de assunto ou avance para uma pergunta nova e diferente.' }]);
    parsed = parseModelJson(raw);
  }
  return { raw, parsed };
}

app.get('/api/state', (req, res) => {
  res.json({
    topics: TOPICS,
    modes: MODES,
    suggestedDifficulty: getAdaptiveDifficulty(3),
    review: phrasesForReview(6),
    recentSessions: recentSessions(6),
    recentVideos: recentVideos(6),
  });
});

app.get('/api/dashboard', (req, res) => {
  res.json({
    streak: currentStreak(),
    masteryBuckets: masteryBuckets(),
    phrases: allPhrases(),
    sessions: recentSessions(20),
    clarityTrend: clarityTrend(14),
    adaptiveDifficulty: getAdaptiveDifficulty(3),
  });
});

app.post('/api/youtube', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'YouTube URL required.' });
  try {
    const lesson = await buildLessonFromVideo(url);
    const videoId = saveVideoLesson({ url, ...lesson });
    for (const p of lesson.phrases) recordNewPhrase(p.pt, p.en, videoId);
    res.json({ videoId, ...lesson });
  } catch (err) {
    console.error(err);
    res.status(422).json({ error: err.message || 'Could not prepare a lesson from that video.' });
  }
});

app.post('/api/session/start', async (req, res) => {
  try {
    const { topic, mode, difficulty, videoId } = req.body || {};
    const level = Math.max(1, Math.min(10, Number(difficulty) || getAdaptiveDifficulty(3)));
    const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
    const review = phrasesForReview(4);

    let video = null;
    let system;
    let vocabHint;
    if (videoId) {
      video = getVideoLesson(videoId);
      if (!video) return res.status(404).json({ error: 'Video lesson not found.' });
      system = buildVideoSystemPrompt({ persona: persona.id, difficulty: level, reviewPhrases: review, video });
      vocabHint = [video.title, video.summary_pt, ...review.map(r => r.pt)].filter(Boolean).join('. ');
    } else {
      const chosenMode = MODES.some(m => m.id === mode) ? mode : 'topic';
      const t = TOPICS.find(x => x.id === topic);
      if (!t) return res.status(400).json({ error: 'Invalid topic.' });
      system = buildSystemPrompt({ persona: persona.id, topic, mode: chosenMode, difficulty: level, reviewPhrases: review });
      vocabHint = [t.label, t.desc, ...review.map(r => r.pt)].filter(Boolean).join('. ');
    }

    const openingInstruction = video
      ? 'Comece a conversa agora. Cumprimente brevemente, mencione rapidamente o tema do vídeo em uma frase, e faça a primeira pergunta da lista de perguntas do vídeo.'
      : 'Comece a conversa agora. Cumprimente brevemente, diga em uma frase que a conversa será só falada, e faça uma pergunta fácil para começar.';
    let messages = [
      { role: 'system', content: system },
      { role: 'user', content: openingInstruction },
    ];
    const { raw, parsed } = await chatWithRetry(messages);
    messages.push({ role: 'assistant', content: raw });
    applyMemoryEffects(parsed, videoId || null);

    const dbId = startSession({
      topic: video ? video.title : topic,
      persona: persona.id,
      difficulty: level,
      mode: video ? 'video' : (mode || 'topic'),
      videoId: videoId || null,
    });
    const sessionId = randomUUID();
    sessions.set(sessionId, { dbId, persona: persona.id, difficulty: level, videoId: videoId || null, messages, vocabHint });

    const audio = await synthesize(parsed.speak, level);
    res.json({
      sessionId,
      persona: persona.id,
      replyText: parsed.speak,
      translation: parsed.translation,
      audio: audio.toString('base64'),
      newPhrases: parsed.new_phrases,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not start session. Is Ollama running?' });
  }
});

app.post('/api/session/:id/turn', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found. Start a new conversation.' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'No audio received.' });
  try {
    const { text: userText, clarity } = await transcribe(req.body, session.vocabHint);
    if (!userText) return res.status(422).json({ error: 'Não entendi. Pode falar novamente?' });

    session.messages.push({ role: 'user', content: userText });
    const { raw, parsed } = await chatWithRetry(session.messages);
    session.messages.push({ role: 'assistant', content: raw });
    session.messages = trimHistory(session.messages);
    applyMemoryEffects(parsed, session.videoId);
    recordTurn(session.dbId, { clarity, struggled: parsed.struggled_phrases.length > 0 });

    const audio = await synthesize(parsed.speak, session.difficulty);
    res.json({
      userText,
      clarity,
      replyText: parsed.speak,
      translation: parsed.translation,
      audio: audio.toString('base64'),
      newPhrases: parsed.new_phrases,
      reusedPhrases: parsed.reused_phrases,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not process your turn.' });
  }
});

app.post('/api/session/:id/end', (req, res) => {
  const session = sessions.get(req.params.id);
  sessions.delete(req.params.id);
  const finalRow = session ? endSession(session.dbId) : null;
  const nextDifficulty = finalRow ? updateAdaptiveDifficulty(finalRow) : getAdaptiveDifficulty(3);
  res.json({ ok: true, nextDifficulty });
});

app.listen(port, () => console.log(`Fala running locally at http://localhost:${port}`));
