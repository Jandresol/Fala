import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chat } from './ollama.js';
import { LANGUAGE } from './language.js';
import { parseLessonJson } from './model.js';
import { normalizeVocabularyCandidates } from './vocabulary.js';

const execFileAsync = promisify(execFile);

function parseVtt(raw) {
  const lines = raw.split('\n');
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'WEBVTT') continue;
    if (/^Kind:|^Language:/i.test(trimmed)) continue;
    if (/^\d\d:\d\d:\d\d[.,]\d+\s*-->/i.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;
    const clean = trimmed.replace(/<[^>]+>/g, '').trim();
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

async function fetchTitle(url) {
  try {
    const { stdout } = await execFileAsync('yt-dlp', ['--print', 'title', '--skip-download', url]);
    return stdout.trim();
  } catch {
    return '';
  }
}

async function fetchCaptions(url) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fala-yt-'));
  try {
    try {
      await execFileAsync('yt-dlp', [
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs', LANGUAGE.captionLangs,
        '--sub-format', 'vtt',
        '-o', path.join(dir, 'video.%(ext)s'),
        url,
      ], { timeout: 60000 });
    } catch {
      // yt-dlp can exit non-zero after a rate limit on one subtitle track
      // while still having written earlier tracks to disk — check the dir before giving up.
    }
    const files = await readdir(dir);
    const vttFiles = files.filter(f => f.endsWith('.vtt'));
    if (!vttFiles.length) throw new Error(`No ${LANGUAGE.targetLanguage} captions found for this video.`);
    const languagePrefix = LANGUAGE.whisperLanguage.replace(/[^a-z0-9-]/gi, '');
    const preferred = vttFiles.find(f => new RegExp(`\\.${languagePrefix}(-orig)?\\.vtt$`, 'i').test(f)) || vttFiles[0];
    const raw = await readFile(path.join(dir, preferred), 'utf8');
    const text = parseVtt(raw);
    if (!text) throw new Error('Captions were empty after parsing.');
    return text;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function buildLessonFromVideo(url) {
  const [title, transcript] = await Promise.all([fetchTitle(url), fetchCaptions(url)]);
  const clipped = transcript.slice(0, 12000);

  const prompt = `You are a ${LANGUAGE.targetLanguageEnglishName} tutor. I will give you a YouTube transcript in the target language. Extract up to 6 useful reusable expressions, not isolated words. Write a short simple summary in ${LANGUAGE.targetLanguageEnglishName}. Create 4 speaking discussion questions, from easy to advanced, that a learner could answer about the video's theme while using vocabulary from the video. Also write a short conversation_context paragraph to guide another AI in discussing the video and recycling the extracted vocabulary. List video concepts separately; concepts help the conversation, but they are not review vocabulary.

Respond ONLY with valid JSON in this exact shape:
{"summary_pt": "...", "phrases": [{"pt": "...", "en": "..."}], "questions": ["...", "...", "...", "..."], "conversation_context": "...", "concepts": ["..."]}

Field rules:
- summary_pt, phrases[].pt, questions, and conversation_context must be in ${LANGUAGE.targetLanguageEnglishName}.
- phrases[].en must be a natural ${LANGUAGE.supportLanguage} meaning.
- concepts should be concise target-language strings.

TITLE: ${title}
TRANSCRIPT:
${clipped}`;

  const raw = await chat([{ role: 'user', content: prompt }]);
  const parsed = parseLessonJson(raw);
  const phrases = normalizeVocabularyCandidates(parsed.phrases, { limit: 6 });
  return {
    title,
    summary_pt: parsed.summary_pt,
    phrases,
    questions: parsed.questions,
    conversation_context: parsed.conversation_context,
    concepts: parsed.concepts,
    transcript: clipped,
  };
}
