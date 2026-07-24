import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chat } from './ollama.js';

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
        '--sub-langs', 'pt.*,pt',
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
    if (!vttFiles.length) throw new Error('No Portuguese captions found for this video.');
    const preferred = vttFiles.find(f => /\.pt(-orig)?\.vtt$/i.test(f)) || vttFiles[0];
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

  const prompt = `Você é uma tutora de português brasileiro. Vou te dar a transcrição de um vídeo do YouTube. Extraia até 6 expressões úteis e reutilizáveis (não palavras isoladas), escreva um resumo curto em português simples, e crie 4 perguntas de conversação (fácil ao avançado) que uma pessoa poderia responder falando sobre o tema do vídeo, usando o vocabulário dele. Também escreva um parágrafo curto de contexto para orientar outra IA a conversar sobre esse vídeo, reciclando o vocabulário extraído.

Responda SOMENTE com JSON válido neste formato exato:
{"summary_pt": "...", "phrases": [{"pt": "...", "en": "..."}], "questions": ["...", "...", "...", "..."], "context": "..."}

TÍTULO: ${title}
TRANSCRIÇÃO:
${clipped}`;

  const raw = await chat([{ role: 'user', content: prompt }]);
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw);
  return {
    title,
    summary_pt: String(parsed.summary_pt || '').trim(),
    phrases: Array.isArray(parsed.phrases) ? parsed.phrases.filter(p => p && p.pt) : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.filter(Boolean) : [],
    context: String(parsed.context || '').trim(),
    transcript: clipped,
  };
}
