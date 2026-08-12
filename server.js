import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { PERSONAS, TOPICS, TOPIC_ALIASES, MODES, MODE_ALIASES, buildSystemPrompt, buildVideoSystemPrompt, parseModelJson, isPlaceholderEcho, isRepeatingQuestion, hasFollowupQuestion } from './lib/content.js';
import { chat, translateToEnglish } from './lib/ollama.js';
import { transcribe, synthesize } from './lib/speech.js';
import { buildLessonFromVideo } from './lib/youtube.js';
import { createTimer } from './lib/timing.js';
import { inferVocabularyFromSpeak, ingestVocabulary } from './lib/vocabulary.js';
import { LANGUAGE, SUPPORTED_LANGUAGES, applyLanguage } from './lib/language.js';
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
const MAX_HISTORY = Number(process.env.FALA_MAX_HISTORY || 10);

app.use(express.json({ limit: '2mb' }));
app.use(express.raw({ type: ['audio/webm', 'audio/ogg', 'application/octet-stream'], limit: '15mb' }));
app.use(express.static('public'));

const sessions = new Map();
const audioJobs = new Map();
const translationJobs = new Map();

function wantsStream(req) {
  return String(req.get('accept') || '').includes('application/x-ndjson');
}

function startJsonStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
}

function writeJsonEvent(res, event, data) {
  res.write(`${JSON.stringify({ event, data })}\n`);
}

function queueAudio(text, difficulty) {
  const audioId = randomUUID();
  const promise = synthesize(text, difficulty)
    .then(audio => audio.toString('base64'))
    .finally(() => {
      setTimeout(() => audioJobs.delete(audioId), 30000).unref();
    });
  promise.catch(() => {});
  audioJobs.set(audioId, promise);
  return audioId;
}

function queueTranslation(text) {
  const translationId = randomUUID();
  const promise = translateToEnglish(text, LANGUAGE.targetLanguageEnglishName)
    .finally(() => {
      setTimeout(() => translationJobs.delete(translationId), 30000).unref();
    });
  promise.catch(() => {});
  translationJobs.set(translationId, promise);
  return translationId;
}

function reviewPhraseSet(reviewPhrases = []) {
  return new Set(
    reviewPhrases
      .map(p => String(p.pt || '').trim())
      .filter(Boolean)
  );
}

function phraseKey(value) {
  return String(value || '').trim().toLocaleLowerCase(LANGUAGE.code);
}

function normalizeTranslation(parsed) {
  if (LANGUAGE.targetLanguageEnglishName === LANGUAGE.supportLanguage) {
    parsed.translation = parsed.speak;
  }
}

async function applyStandardTranslation(parsed) {
  if (LANGUAGE.targetLanguageEnglishName === LANGUAGE.supportLanguage) {
    parsed.translation = parsed.speak;
    return;
  }

  parsed.translation = await translateToEnglish(parsed.speak, LANGUAGE.targetLanguageEnglishName);
}

function collectNewPhrases(parsed, learnedPhrases = new Set()) {
  if (!parsed.new_phrases.length) {
    parsed.new_phrases = inferVocabularyFromSpeak(parsed.speak, { limit: 1 });
  }
  parsed.new_phrases = parsed.new_phrases.filter((phrase) => {
    const key = phraseKey(phrase.pt);
    if (!key || learnedPhrases.has(key)) return false;
    learnedPhrases.add(key);
    return true;
  });
  return parsed.new_phrases;
}

function applyTrackingEffects(parsed, reviewPhrases = []) {
  const allowedTracked = reviewPhraseSet(reviewPhrases);
  parsed.reused_phrases = parsed.reused_phrases.filter(pt => allowedTracked.has(pt));
  parsed.struggled_phrases = parsed.struggled_phrases.filter(pt => allowedTracked.has(pt));
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

function normalizeDifficulty(value, fallback = 2) {
  return Math.max(1, Math.min(6, Number(value) || fallback));
}

const MINI_NEWS_OPENERS = {
  'pt-BR': {
    weekend: 'Hoje tem mais gente nos parques. Você vai sair?',
    'city-life': 'Hoje o metrô está cheio. Você viu?',
    'work-study': 'Hoje muita gente trabalha de casa. Você também?',
    'movies-music': 'Hoje saiu música nova. Você ouviu?',
    travel: 'Hoje o aeroporto está cheio. Você viaja muito?',
    opinions: 'Hoje muita gente fala disso. Você concorda?',
    default: 'Hoje tem uma notícia pequena. Você viu?',
  },
  'fr-FR': {
    weekend: 'Il y a du monde au parc aujourd’hui. Tu sors?',
    'city-life': 'Le métro est plein aujourd’hui. Tu as vu?',
    'work-study': 'Beaucoup de gens travaillent chez eux aujourd’hui. Toi aussi?',
    'movies-music': 'Une nouvelle chanson sort aujourd’hui. Tu l’écoutes?',
    travel: 'L’aéroport est plein aujourd’hui. Tu voyages souvent?',
    opinions: 'Beaucoup de gens parlent de ça aujourd’hui. Tu es d’accord?',
    default: 'Il y a une petite nouvelle aujourd’hui. Tu as vu?',
  },
  'en-US': {
    weekend: 'The park is busy today. Are you going out?',
    'city-life': 'The train is full today. Did you see?',
    'work-study': 'Many people work from home today. Do you?',
    'movies-music': 'A new song is out today. Did you hear it?',
    travel: 'The airport is busy today. Do you travel often?',
    opinions: 'Many people are talking about this today. Do you agree?',
    default: 'There is a small story today. Did you see?',
  },
};

function miniNewsOpener(topic) {
  const byLanguage = MINI_NEWS_OPENERS[LANGUAGE.code] || MINI_NEWS_OPENERS['en-US'];
  return byLanguage[topic] || byLanguage.default;
}

function violatesMiniNewsMode(speak, topic) {
  const text = String(speak || '');
  if (!hasFollowupQuestion(text)) return true;
  if (topic !== 'weekend' && /\b(caf[eé]|café|almo[cç]o|jantar|comida|fome|breakfast|lunch|dinner|food|coffee)\b/i.test(text)) return true;
  return false;
}

function retryInstruction({ level, topic, mode }) {
  const modeHint = mode === 'news'
    ? 'For Mini News, include one tiny everyday news-style fact connected to the topic before the question. Do not describe a random object.'
    : 'Follow the selected mode exactly.';

  return `Try again. ${modeHint} Stay on topic "${topic}". Match CEFR level ${level} only by restricting vocabulary, grammar, and sentence length. Do not switch to an easier unrelated subject. Do not repeat a recent question. End with exactly one concrete follow-up question. Respond only with the JSON object.`;
}

function openingInstructionForLevel({ level, video, openingContext, topic, mode = 'topic', messages = [] }) {
  if (!video && mode === 'news') {
    const levelName = level === 1 ? 'A1' : level === 2 ? 'A2' : `CEFR level ${level}`;
    const example = /portuguese/i.test(LANGUAGE.targetLanguageEnglishName)
      ? 'Hoje o metrô está cheio. Você viu?'
      : /french/i.test(LANGUAGE.targetLanguageEnglishName)
        ? 'Le bus est plein aujourd’hui. Tu as vu?'
        : 'The bus is full today. Did you see?';
    return `Start in ${LANGUAGE.targetLanguageEnglishName}. Mode is Mini News and topic is ${openingContext}. Use ${levelName} language. The speak field must have this shape: one tiny news fact about the topic, then one short reaction question. It must end with "?". Example shape only: "${example}" Do not describe a random object. Do not talk about food unless the selected topic is food.`;
  }

  if (level === 1) {
    return video
      ? `Start in ${LANGUAGE.targetLanguageEnglishName}. Stay in the video lesson mode. Use one very short A1 sentence about the video and one tiny question. No greeting.`
      : `Start in ${LANGUAGE.targetLanguageEnglishName}. Stay in the selected mode and topic: ${openingContext}. Use one very short A1 sentence and one tiny question. No greeting.`;
  }

  if (level === 2) {
    return video
      ? `Start in ${LANGUAGE.targetLanguageEnglishName}. Stay in the video lesson mode. Use one short A2 sentence about the video and one simple question.`
      : `Start in ${LANGUAGE.targetLanguageEnglishName}. Stay in the selected mode and topic: ${openingContext}. Use one short A2 sentence and one simple question.`;
  }

  return video
    ? `Start the conversation now in ${LANGUAGE.targetLanguageEnglishName}. Briefly greet the learner, mention the video's theme in one sentence, and ask the first question from the video's question list.`
    : `Start the conversation now in ${LANGUAGE.targetLanguageEnglishName}. Briefly greet the learner, mention ${openingContext}, and ask one easy opening question directly related to it.`;
}

async function chatWithRetry(messages, { level = 3, topic = 'default', mode = 'topic' } = {}) {
  const retryReasons = [];
  let qwenAttempts = 1;
  let raw = await chat(messages);
  let parsed = parseModelJson(raw);
  if (isPlaceholderEcho(parsed.speak)) {
    retryReasons.push('placeholder_echo');
    qwenAttempts++;
    raw = await chat([...messages, { role: 'user', content: `Your last response copied the JSON schema instead of producing real speech. Respond again with natural ${LANGUAGE.targetLanguageEnglishName}, following the JSON format.` }]);
    parsed = parseModelJson(raw);
  }
  const recent = recentAssistantSpeaks(messages, 3);
  for (let i = 0; i < 1 && (isRepeatingQuestion(parsed.speak, recent) || !hasFollowupQuestion(parsed.speak)); i++) {
    const reason = isRepeatingQuestion(parsed.speak, recent) ? 'model_repetition_retry' : 'model_followup_retry';
    retryReasons.push(reason);
    qwenAttempts++;
    raw = await chat([...messages, {
      role: 'user',
      content: `${retryInstruction({ level, topic, mode })} Your previous speak value was invalid because it ${reason === 'model_repetition_retry' ? 'repeated a recent question' : 'did not end with a question'}.`,
    }]);
    parsed = parseModelJson(raw);
  }
  if (mode === 'news' && violatesMiniNewsMode(parsed.speak, topic)) {
    retryReasons.push('local_news_mode_guard');
    parsed.speak = miniNewsOpener(topic);
    parsed.translation = '';
    parsed.new_phrases = [];
    parsed.reused_phrases = [];
    parsed.struggled_phrases = [];
  }
  normalizeTranslation(parsed);
  raw = JSON.stringify(parsed);
  return { raw, parsed, attempts: qwenAttempts, retryReasons };
}

app.get('/api/state', (req, res) => {
  res.json({
    topics: TOPICS,
    modes: MODES,
    languages: SUPPORTED_LANGUAGES.map(({ id, label, nativeLabel }) => ({ id, label, nativeLabel })),
    selectedLanguage: LANGUAGE.code,
    suggestedDifficulty: normalizeDifficulty(getAdaptiveDifficulty(2)),
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
    adaptiveDifficulty: normalizeDifficulty(getAdaptiveDifficulty(2)),
  });
});

app.get('/api/audio/:id', async (req, res) => {
  const timer = createTimer('audio');
  const job = audioJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Audio not found.' });

  try {
    const audio = await timer.stage('piper', () => job);
    timer.log();
    res.json({ audio });
  } catch (err) {
    timer.log({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not synthesize audio.' });
  }
});

app.get('/api/translation/:id', async (req, res) => {
  const timer = createTimer('translation');
  const job = translationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Translation not found.' });

  try {
    const translation = await timer.stage('translate', () => job);
    timer.log();
    res.json({ translation });
  } catch (err) {
    timer.log({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not translate reply.' });
  }
});

app.post('/api/youtube', async (req, res) => {
  const timer = createTimer('video');
  const { url, language } = req.body || {};
  if (!url) return res.status(400).json({ error: 'YouTube URL required.' });
  try {
    applyLanguage(language);
    const lesson = await timer.stage('build_lesson', () => buildLessonFromVideo(url));
    const videoId = await timer.stage('save_video', () => saveVideoLesson({ url, ...lesson }));
    lesson.phrases = ingestVocabulary(lesson.phrases, recordNewPhrase, { sourceVideoId: videoId, limit: 6 });
    timer.mark('vocabulary');
    timer.log({ phraseCount: lesson.phrases.length });
    res.json({ videoId, ...lesson });
  } catch (err) {
    timer.log({ error: err.message });
    console.error(err);
    res.status(422).json({ error: err.message || 'Could not prepare a lesson from that video.' });
  }
});

app.post('/api/session/start', async (req, res) => {
  const timer = createTimer('session_start');
  const stream = wantsStream(req);
  if (stream) startJsonStream(res);
  try {
    const { topic, mode, difficulty, videoId, language } = req.body || {};
    const selectedLanguage = applyLanguage(language);
    const level = normalizeDifficulty(difficulty, getAdaptiveDifficulty(2));
    const persona = PERSONAS.find(p => p.id === 'friend') || PERSONAS[0];
    const review = phrasesForReview(4);

    let video = null;
    let system;
    let vocabHint;
    let openingContext;
    let conversationTopic = 'default';
    let conversationMode = 'topic';
    if (videoId) {
      video = getVideoLesson(videoId);
      if (!video) return res.status(404).json({ error: 'Video lesson not found.' });
      system = buildVideoSystemPrompt({ persona: persona.id, difficulty: level, reviewPhrases: review, video });
      vocabHint = [video.title, video.summary_pt, ...review.map(r => r.pt)].filter(Boolean).join('. ');
      openingContext = `the video "${video.title || 'this video'}"`;
      conversationMode = 'scene';
    } else {
      const resolvedTopic = TOPIC_ALIASES[topic] || topic;
      conversationTopic = resolvedTopic;
      const resolvedMode = MODE_ALIASES[mode] || mode;
      const chosenMode = MODES.some(m => m.id === resolvedMode) ? resolvedMode : 'topic';
      conversationMode = chosenMode;
      const t = TOPICS.find(x => x.id === resolvedTopic);
      if (!t) return res.status(400).json({ error: 'Invalid topic.' });
      system = buildSystemPrompt({ persona: persona.id, topic: resolvedTopic, mode: chosenMode, difficulty: level, reviewPhrases: review });
      vocabHint = [t.label, t.desc, ...review.map(r => r.pt)].filter(Boolean).join('. ');
      openingContext = `the topic "${t.label}: ${t.desc}"`;
    }

    let messages = [
      { role: 'system', content: system },
    ];
    const openingInstruction = openingInstructionForLevel({ level, video, openingContext, topic: conversationTopic, mode: conversationMode, messages });
    messages.push({ role: 'user', content: openingInstruction });
    const { raw, parsed, attempts, retryReasons } = await timer.stage('qwen', () => chatWithRetry(messages, { level, topic: conversationTopic, mode: conversationMode }));
    messages.push({ role: 'assistant', content: raw });
    console.log('OPENING MODEL PARSED:', JSON.stringify(parsed, null, 2));
    const audioId = await timer.stage('queue_audio', () => queueAudio(parsed.speak, level));
    const translationId = LANGUAGE.targetLanguageEnglishName === LANGUAGE.supportLanguage
      ? null
      : await timer.stage('queue_translation', () => queueTranslation(parsed.speak));
    if (!translationId) normalizeTranslation(parsed);

    const learnedPhrases = new Set();
    const learnedPhraseItems = await timer.stage('collect_phrases', () => collectNewPhrases(parsed, learnedPhrases));
    await timer.stage('tracking_effects', () => applyTrackingEffects(parsed, review));

    const dbId = await timer.stage('start_session', () => startSession({
      topic: video ? video.title : (TOPIC_ALIASES[topic] || topic),
      persona: persona.id,
      difficulty: level,
      mode: video ? 'video' : conversationMode,
      videoId: videoId || null,
    }));
    const sessionId = randomUUID();
    sessions.set(sessionId, { dbId, persona: persona.id, difficulty: level, topic: conversationTopic, mode: conversationMode, language: selectedLanguage.code, videoId: videoId || null, messages, vocabHint, reviewPhrases: review, learnedPhrases, learnedPhraseItems });

    timer.log({ newPhraseCount: parsed.new_phrases.length, qwenAttempts: attempts, retryReasons });
    const payload = {
      sessionId,
      persona: persona.id,
      replyText: parsed.speak,
      translation: parsed.translation,
      translationId,
      audioId,
      newPhrases: [],
    };
    if (stream) {
      writeJsonEvent(res, 'reply', payload);
      writeJsonEvent(res, 'done', { ok: true });
      res.end();
    } else {
      res.json(payload);
    }
  } catch (err) {
    timer.log({ error: err.message });
    console.error(err);
    if (stream && !res.writableEnded) {
      writeJsonEvent(res, 'error', { error: 'Could not start session. Is Ollama running?' });
      res.end();
    } else {
      res.status(500).json({ error: 'Could not start session. Is Ollama running?' });
    }
  }
});

app.post('/api/session/:id/turn', async (req, res) => {
  const timer = createTimer('turn');
  const stream = wantsStream(req);
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found. Start a new conversation.' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'No audio received.' });
  if (stream) startJsonStream(res);
  try {
    applyLanguage(session.language);
    const { text: userText, clarity } = await timer.stage('stt', () => transcribe(req.body, session.vocabHint));
    if (!userText) return res.status(422).json({ error: 'Não entendi. Pode falar novamente?' });

    session.messages.push({ role: 'user', content: userText });
    const { raw, parsed, attempts, retryReasons } =
      await timer.stage('qwen', () => chatWithRetry(session.messages, { level: session.difficulty, topic: session.topic, mode: session.mode }));
    session.messages.push({ role: 'assistant', content: raw });
    session.messages = trimHistory(session.messages);

    console.log('MODEL PARSED:', JSON.stringify(parsed, null, 2));
    const audioId = await timer.stage('queue_audio', () => queueAudio(parsed.speak, session.difficulty));
    const translationId = LANGUAGE.targetLanguageEnglishName === LANGUAGE.supportLanguage
      ? null
      : await timer.stage('queue_translation', () => queueTranslation(parsed.speak));
    if (!translationId) normalizeTranslation(parsed);

    const learnedPhraseItems = await timer.stage('collect_phrases', () => collectNewPhrases(parsed, session.learnedPhrases));
    session.learnedPhraseItems.push(...learnedPhraseItems);
    await timer.stage('tracking_effects', () => applyTrackingEffects(parsed, session.reviewPhrases));
    await timer.stage('record_turn', () => recordTurn(session.dbId, { clarity, struggled: parsed.struggled_phrases.length > 0 }));

    timer.log({ newPhraseCount: parsed.new_phrases.length, qwenAttempts: attempts, retryReasons, clarity });
    const payload = {
      userText,
      clarity,
      replyText: parsed.speak,
      translation: parsed.translation,
      translationId,
      audioId,
      newPhrases: [],
      reusedPhrases: parsed.reused_phrases,
    };
    if (stream) {
      writeJsonEvent(res, 'reply', payload);
      writeJsonEvent(res, 'done', { ok: true });
      res.end();
    } else {
      res.json(payload);
    }
  } catch (err) {
    timer.log({ error: err.message });
    console.error(err);
    if (stream && !res.writableEnded) {
      writeJsonEvent(res, 'error', { error: 'Could not process your turn.' });
      res.end();
    } else {
      res.status(500).json({ error: 'Could not process your turn.' });
    }
  }
});

app.post('/api/session/:id/end', (req, res) => {
  const session = sessions.get(req.params.id);
  sessions.delete(req.params.id);
  const learnedPhrases = session ? ingestVocabulary(session.learnedPhraseItems, recordNewPhrase, { sourceVideoId: session.videoId, limit: 12 }) : [];
  const finalRow = session ? endSession(session.dbId) : null;
  const nextDifficulty = normalizeDifficulty(finalRow ? updateAdaptiveDifficulty(finalRow) : getAdaptiveDifficulty(2));
  const avgClarity = finalRow && finalRow.clarity_count > 0
    ? finalRow.clarity_sum / finalRow.clarity_count
    : null;
  res.json({
    ok: true,
    nextDifficulty,
    turns: finalRow?.turns || 0,
    avgClarity,
    learnedPhrases,
  });
});

app.listen(port, () => console.log(`Fala running locally at http://localhost:${port}`));
