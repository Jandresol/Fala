import { LANGUAGE } from './language.js';

const configuredStoplist = (process.env.FALA_VOCABULARY_STOPLIST || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

const PROPER_NOUN_HINTS = new Set(configuredStoplist);

export function normalizeVocabularyCandidates(items, { limit = Infinity } = {}) {
  if (!Array.isArray(items)) return [];

  const result = [];
  const seen = new Set();

  for (const item of items) {
    const phrase = normalizeCandidate(item);
    if (!isUsefulVocabulary(phrase)) continue;

    const key = phrase.pt.toLocaleLowerCase(LANGUAGE.code);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(phrase);
    if (result.length >= limit) break;
  }

  return result;
}

export function ingestVocabulary(items, recordNewPhrase, { sourceVideoId = null, limit = Infinity } = {}) {
  const phrases = normalizeVocabularyCandidates(items, { limit });

  for (const phrase of phrases) {
    recordNewPhrase(phrase.pt, phrase.en, sourceVideoId);
  }

  return phrases;
}

export function inferVocabularyFromSpeak(speak, { limit = 1 } = {}) {
  if (!/portuguese/i.test(LANGUAGE.targetLanguageEnglishName)) return [];

  const text = String(speak || '').trim();
  if (!text) return [];

  const candidates = PORTUGUESE_SPEAK_PATTERNS
    .map(({ re, en }) => {
      const match = text.match(re);
      return match ? { pt: (match[1] || match[0]).toLocaleLowerCase(LANGUAGE.code), en } : null;
    })
    .filter(Boolean);

  return normalizeVocabularyCandidates(candidates, { limit });
}

function normalizeCandidate(value) {
  if (!value) return { pt: '', en: '' };

  if (typeof value === 'string') {
    return { pt: value.trim(), en: '' };
  }

  if (typeof value === 'object') {
    return {
      pt: String(value.pt || '').trim(),
      en: String(value.en || '').trim(),
    };
  }

  return { pt: String(value).trim(), en: '' };
}

function isUsefulVocabulary({ pt, en }) {
  if (!pt) return false;
  if (!/\p{L}/u.test(pt)) return false;

  const words = pt.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (words.length > 8) return false;

  const normalized = pt
    .toLocaleLowerCase(LANGUAGE.code)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (PROPER_NOUN_HINTS.has(normalized)) return false;
  if (/^[A-ZÁÉÍÓÚÃÕÂÊÔÇ][\p{L}'’.-]*(\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇ][\p{L}'’.-]*)*$/u.test(pt)) return false;

  return true;
}

const PORTUGUESE_SPEAK_PATTERNS = [
  { re: /\b(em mente)\b/i, en: 'in mind' },
  { re: /\b(qual é o seu plano)\b/i, en: 'what is your plan' },
  { re: /\b(plano de viagem)\b/i, en: 'travel plan' },
  { re: /\b(gostaria de)\b/i, en: 'would like to' },
  { re: /\b(ficar hospedad[oa])\b/i, en: 'to stay as a guest' },
  { re: /\b(perto da praia)\b/i, en: 'near the beach' },
  { re: /\b(tipo de atração)\b/i, en: 'type of attraction' },
  { re: /\b(você prefere)\b/i, en: 'do you prefer' },
  { re: /\b(pode dizer)\b/i, en: 'can say' },
  { re: /\b(quem sabe)\b/i, en: 'maybe / who knows' },
  { re: /\b(algum lugar específico)\b/i, en: 'a specific place' },
];
