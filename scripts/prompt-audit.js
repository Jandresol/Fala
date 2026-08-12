import { performance } from 'node:perf_hooks';
import { chat } from '../lib/ollama.js';
import {
  MODES,
  TOPICS,
  buildSystemPrompt,
  hasFollowupQuestion,
  isRepeatingQuestion,
  parseModelJson,
} from '../lib/content.js';
import { LANGUAGE } from '../lib/language.js';

const LANGUAGE_CASES = [
  {
    id: 'pt-BR',
    code: 'pt-BR',
    targetLanguage: 'portugues brasileiro',
    targetLanguageEnglishName: 'Brazilian Portuguese',
    supportLanguage: 'English',
    learnerTurns: {
      viagem: ['Eu quero viajar.', 'Hotel.', 'Praia.'],
      sp: ['Eu gosto daqui.', 'De ônibus.', 'Perto de casa.'],
      comida: ['Eu gosto de pastel.', 'Na feira.', 'Com caldo.'],
      usp: ['Eu estudo hoje.', 'Depois eu descanso.', 'Em casa.'],
      tech: ['Eu gosto de IA.', 'No trabalho.', 'É interessante.'],
      diaadia: ['Eu vou sair.', 'Com amigos.', 'À noite.'],
    },
  },
  {
    id: 'fr-FR',
    code: 'fr-FR',
    targetLanguage: 'francais',
    targetLanguageEnglishName: 'French',
    supportLanguage: 'English',
    learnerTurns: {
      viagem: ['Je veux voyager.', 'A l hotel.', 'La plage.'],
      sp: ["J'aime ici.", 'En bus.', 'Pres de chez moi.'],
      comida: ["J'aime manger.", 'Au marche.', 'Avec du jus.'],
      usp: ['Je travaille aujourd hui.', 'Apres je me repose.', 'A la maison.'],
      tech: ["J'aime l IA.", 'Au travail.', 'C est interessant.'],
      diaadia: ['Je vais sortir.', 'Avec des amis.', 'Ce soir.'],
    },
  },
  {
    id: 'en-US',
    code: 'en-US',
    targetLanguage: 'English',
    targetLanguageEnglishName: 'English',
    supportLanguage: 'English',
    learnerTurns: {
      viagem: ['I want to travel.', 'A hotel.', 'The beach.'],
      sp: ['I like it here.', 'By bus.', 'Near home.'],
      comida: ['I like snacks.', 'At the market.', 'With juice.'],
      usp: ['I work today.', 'Then I rest.', 'At home.'],
      tech: ['I like AI.', 'At work.', 'It is interesting.'],
      diaadia: ['I will go out.', 'With friends.', 'Tonight.'],
    },
  },
];

const MODE_IDS = ['topic', 'news', 'podcast', 'debate', 'story', 'travel'];
const TOPIC_IDS = ['viagem', 'sp', 'comida', 'usp', 'tech', 'diaadia'];
const DEFAULT_LIMIT = Number(process.env.FALA_AUDIT_LIMIT || 9);
const MAX_LEARNER_TURNS = Number(process.env.FALA_AUDIT_TURNS || 2);

function configureLanguage(languageCase) {
  LANGUAGE.code = languageCase.code;
  LANGUAGE.targetLanguage = languageCase.targetLanguage;
  LANGUAGE.targetLanguageEnglishName = languageCase.targetLanguageEnglishName;
  LANGUAGE.supportLanguage = languageCase.supportLanguage;
}

function chooseCases() {
  const cases = [];
  for (const mode of MODE_IDS) {
    for (const languageCase of LANGUAGE_CASES) {
      const topic = TOPIC_IDS[cases.length % TOPIC_IDS.length];
      cases.push({ languageCase, mode, topic });
    }
  }
  return cases.slice(0, DEFAULT_LIMIT);
}

function scoreTurn(parsed, recentSpeaks) {
  const speak = parsed.speak || '';
  const lower = speak.toLocaleLowerCase(LANGUAGE.code);
  const flags = [];

  if (!hasFollowupQuestion(speak)) flags.push('missing_or_bad_followup');
  if (isRepeatingQuestion(speak, recentSpeaks)) flags.push('repeated_question');
  if (/[{[\]}]|"speak"|"translation"/i.test(speak)) flags.push('json_leak');
  if (/english/i.test(LANGUAGE.supportLanguage) && /[\u3400-\u9fff]/u.test(parsed.translation || '')) flags.push('wrong_translation_language');
  if (/portuguese/i.test(LANGUAGE.targetLanguageEnglishName) && /[¿؟]/.test(speak)) flags.push('wrong_question_mark');
  if ((speak.match(/[?？]/g) || []).length > 1) flags.push('multiple_questions');
  if (/obrigad[oa] por (explicar|compartilhar|informar)/i.test(lower)) flags.push('ends_like_summary');
  if (/que hotel bonito|ótima escolha|excelente escolha|isso é ótimo/i.test(lower)) flags.push('generic_praise');
  if (/começar a pensar|algum desses aspectos|tipo de alojamento/i.test(lower)) flags.push('stilted_prompt');
  if (speak.split(/\s+/).length > 26) flags.push('too_long_for_low_level');

  return flags;
}

async function runCase({ languageCase, mode, topic }) {
  configureLanguage(languageCase);
  const system = buildSystemPrompt({
    persona: 'amiga',
    topic,
    mode,
    difficulty: 1,
    reviewPhrases: [],
  });
  const topicMeta = TOPICS.find(t => t.id === topic);
  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `Start the conversation now in ${LANGUAGE.targetLanguageEnglishName}. Mention the topic "${topicMeta.label}: ${topicMeta.desc}" and ask one easy opening question.`,
    },
  ];

  const turns = [];
  const start = performance.now();

  const learnerTurns = (languageCase.learnerTurns[topic] || languageCase.learnerTurns.viagem).slice(0, MAX_LEARNER_TURNS);

  for (let i = 0; i < learnerTurns.length + 1; i++) {
    const raw = await chat(messages);
    const parsed = parseModelJson(raw);
    const recentSpeaks = messages
      .filter(m => m.role === 'assistant')
      .slice(-3)
      .map(m => parseModelJson(m.content).speak)
      .filter(Boolean);
    const flags = scoreTurn(parsed, recentSpeaks);
    turns.push({ assistant: parsed.speak, translation: parsed.translation, flags });
    messages.push({ role: 'assistant', content: raw });

    const learner = learnerTurns[i];
    if (!learner) break;
    messages.push({ role: 'user', content: learner });
  }

  const elapsedMs = Math.round(performance.now() - start);
  const flagCount = turns.reduce((sum, turn) => sum + turn.flags.length, 0);
  return {
    language: languageCase.id,
    mode,
    topic,
    elapsedMs,
    flagCount,
    turns,
  };
}

function summarize(results) {
  const byMode = new Map();
  const byTopic = new Map();

  for (const result of results) {
    const modeStats = byMode.get(result.mode) || { cases: 0, flags: 0 };
    modeStats.cases++;
    modeStats.flags += result.flagCount;
    byMode.set(result.mode, modeStats);

    const topicStats = byTopic.get(result.topic) || { cases: 0, flags: 0 };
    topicStats.cases++;
    topicStats.flags += result.flagCount;
    byTopic.set(result.topic, topicStats);
  }

  return {
    modes: [...byMode.entries()].map(([id, s]) => ({ id, ...s, flagsPerCase: Number((s.flags / s.cases).toFixed(2)) })),
    topics: [...byTopic.entries()].map(([id, s]) => ({ id, ...s, flagsPerCase: Number((s.flags / s.cases).toFixed(2)) })),
  };
}

async function main() {
  const cases = chooseCases();
  const results = [];

  for (const testCase of cases) {
    process.stderr.write(`Auditing ${testCase.languageCase.id} / ${testCase.mode} / ${testCase.topic}\n`);
    results.push(await runCase(testCase));
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), summary: summarize(results), results }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
