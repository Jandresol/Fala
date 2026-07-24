import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

const WHISPER_MODEL = process.env.WHISPER_MODEL || path.join(process.cwd(), 'models/whisper/ggml-base.bin');
const PIPER_VOICE = process.env.PIPER_VOICE || path.join(process.cwd(), 'models/piper/voices/pt_BR-faber-medium.onnx');
const PIPER_PYTHON = process.env.PIPER_PYTHON || path.join(process.cwd(), '.venv/bin/python3');

function runWithStdin(command, args, stdinText) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${command} failed: ${stderr || err.message}`));
      resolve(stdout);
    });
    child.stdin.on('error', reject);
    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

function clarityFromTokens(transcriptionSegments) {
  const tokens = (transcriptionSegments || []).flatMap(seg => seg.tokens || []);
  const probs = tokens
    .filter(t => typeof t.p === 'number' && !t.text.trim().startsWith('[_'))
    .map(t => t.p);
  if (!probs.length) return null;
  return probs.reduce((a, b) => a + b, 0) / probs.length;
}

export async function transcribe(webmOrOggBuffer, promptHint) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fala-stt-'));
  const inputPath = path.join(dir, 'input.webm');
  const wavPath = path.join(dir, 'input16k.wav');
  const outPrefix = path.join(dir, 'out');
  try {
    await writeFile(inputPath, webmOrOggBuffer);
    await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);
    const args = [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '-l', 'pt',
      '-np',
      '--no-timestamps',
      '-ojf',
      '-of', outPrefix,
    ];
    if (promptHint) args.push('--prompt', promptHint.slice(0, 400));
    await execFileAsync('whisper-cli', args);
    const json = JSON.parse(await readFile(`${outPrefix}.json`, 'utf8'));
    const text = (json.transcription || []).map(seg => seg.text || '').join('').trim();
    const clarity = clarityFromTokens(json.transcription);
    return { text, clarity };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function lengthScaleForDifficulty(difficulty) {
  const level = Math.max(1, Math.min(10, Number(difficulty) || 3));
  if (level === 1) return 1.35;
  if (level === 2) return 1.2;
  if (level <= 4) return 1.1;
  if (level <= 6) return 1.0;
  return 0.92;
}

export async function synthesize(text, difficulty) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fala-tts-'));
  const outPath = path.join(dir, 'out.wav');
  try {
    const lengthScale = lengthScaleForDifficulty(difficulty);
    await runWithStdin(PIPER_PYTHON, [
      '-m', 'piper', '-m', PIPER_VOICE, '-f', outPath,
      '--length-scale', String(lengthScale),
    ], text);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
