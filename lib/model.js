import { LANGUAGE } from './language.js';

function normalizeTranslation(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const nested = JSON.parse(trimmed);

        if (typeof nested === 'string') return nested.trim();

        if (nested && typeof nested === 'object') {
          const candidate = nested.en ?? nested.english ?? nested.translation;
          return typeof candidate === 'string' ? candidate.trim() : '';
        }
      } catch {
        // Keep malformed JSON-looking text as-is.
      }
    }

    return trimmed === '[object Object]' ? '' : trimmed;
  }

  if (typeof value === 'object') {
    const candidate = value.en ?? value.english ?? value.translation;
    return typeof candidate === 'string' ? candidate.trim() : '';
  }

  return String(value).trim();
}

function normalizePhraseObjects(value, limit = Infinity) {
  if (!Array.isArray(value)) return [];

  const result = [];
  const seen = new Set();

  for (const item of value) {
    const pt = typeof item === 'object' && item
      ? String(item.pt || '').trim()
      : '';
    const en = typeof item === 'object' && item
      ? String(item.en || '').trim()
      : '';

    if (!pt || pt.split(/\s+/).filter(Boolean).length < 2) continue;

    const key = pt.toLocaleLowerCase(LANGUAGE.code);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ pt, en });
    if (result.length >= limit) break;
  }

  return result;
}

function normalizeTrackedPhraseArray(value) {
  if (!Array.isArray(value)) return [];

  const result = [];

  for (const item of value) {
    if (!item) continue;

    if (typeof item === 'string') {
      const phrase = item.trim();
      if (phrase) result.push(phrase);
      continue;
    }

    if (typeof item === 'object' && item.pt) {
      const phrase = String(item.pt).trim();
      if (phrase) result.push(phrase);
    }
  }

  return [...new Set(result)];
}

export function extractJson(raw) {
  const rawText = String(raw || '').trim();
  const match = rawText.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : rawText);
}

export function parseConversationJson(raw) {
  const rawText = String(raw || '').trim();

  try {
    const parsed = extractJson(rawText);
    const speak = typeof parsed.speak === 'string' ? parsed.speak.trim() : '';

    if (looksLikeJson(speak)) {
      return parseConversationJson(speak);
    }

    return {
      speak: speak || LANGUAGE.fallbackSpeak,
      translation: normalizeTranslation(parsed.translation),
      new_phrases: normalizePhraseObjects(parsed.new_phrases, 1),
      reused_phrases: normalizeTrackedPhraseArray(parsed.reused_phrases),
      struggled_phrases: normalizeTrackedPhraseArray(parsed.struggled_phrases),
    };
  } catch {
    const speak = looksLikeJson(rawText)
      ? LANGUAGE.fallbackSpeak
      : rawText || LANGUAGE.fallbackSpeak;

    return {
      speak,
      translation: '',
      new_phrases: [],
      reused_phrases: [],
      struggled_phrases: [],
    };
  }
}

function looksLikeJson(value) {
  const text = String(value || '').trim();
  return text.startsWith('{') || text.startsWith('[') || /"speak"\s*:/.test(text);
}

export function parseLessonJson(raw) {
  const parsed = extractJson(raw);

  return {
    summary_pt: String(parsed.summary_pt || '').trim(),
    phrases: normalizePhraseObjects(parsed.phrases, 6),
    questions: Array.isArray(parsed.questions)
      ? parsed.questions.map(q => String(q || '').trim()).filter(Boolean).slice(0, 4)
      : [],
    conversation_context: String(parsed.conversation_context || parsed.context || '').trim(),
    concepts: Array.isArray(parsed.concepts)
      ? parsed.concepts.map(c => String(c || '').trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}
