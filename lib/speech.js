import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { LANGUAGE } from './language.js';

const execFileAsync = promisify(execFile);

const WHISPER_MODEL = process.env.WHISPER_MODEL || path.join(process.cwd(), 'models/whisper/ggml-base.bin');
const PIPER_PYTHON = process.env.PIPER_PYTHON || path.join(process.cwd(), '.venv/bin/python3');
const PIPER_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'piper_worker.py');
const PIPER_WORKER_TIMEOUT_MS = Number(process.env.PIPER_WORKER_TIMEOUT_MS || 45000);
const piperWorkers = new Map();

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

class PiperWorker {
  constructor(voicePath) {
    this.voicePath = voicePath;
    this.child = null;
    this.buffer = '';
    this.ready = null;
    this.queue = Promise.resolve();
    this.pending = [];
  }

  start() {
    if (this.child && !this.child.killed) return this.ready;

    this.buffer = '';
    this.pending = [];
    this.child = spawn(PIPER_PYTHON, [PIPER_WORKER, this.voicePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.ready = new Promise((resolve, reject) => {
      const readyPending = {
        reject,
        onMessage: null,
      };
      const timeout = setTimeout(() => {
        this.pending = this.pending.filter(pending => pending !== readyPending);
        this.stop();
        reject(new Error('Piper worker startup timed out.'));
      }, PIPER_WORKER_TIMEOUT_MS);
      const onReady = (message) => {
        if (message.ready) {
          clearTimeout(timeout);
          resolve();
          return true;
        }
        if (message.error) {
          clearTimeout(timeout);
          reject(new Error(message.error));
          return true;
        }
        return false;
      };
      readyPending.onMessage = onReady;
      this.pending.push(readyPending);
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.handleStdout(chunk));
    this.child.stderr.on('data', chunk => {
      const text = String(chunk).trim();
      if (text) console.error('[piper worker]', text);
    });
    this.child.on('error', err => this.rejectAll(err));
    this.child.on('exit', (code, signal) => {
      this.rejectAll(new Error(`Piper worker exited (${code ?? signal}).`));
      this.child = null;
      this.ready = null;
    });

    return this.ready;
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (err) {
        this.rejectAll(new Error(`Invalid Piper worker response: ${line}`));
        continue;
      }

      const pending = this.pending.shift();
      if (!pending) continue;
      if (pending.onMessage && pending.onMessage(message)) continue;
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(Buffer.from(message.audio || '', 'base64'));
    }
  }

  rejectAll(err) {
    for (const pending of this.pending.splice(0)) pending.reject(err);
  }

  stop() {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.ready = null;
  }

  synthesize(text, lengthScale) {
    const next = this.queue.catch(() => {}).then(() => this.synthesizeNow(text, lengthScale));
    this.queue = next;
    return next;
  }

  async synthesizeNow(text, lengthScale) {
    await this.start();
    return new Promise((resolve, reject) => {
      const pending = {
        resolve: audio => {
          clearTimeout(timeout);
          resolve(audio);
        },
        reject: err => {
          clearTimeout(timeout);
          reject(err);
        },
      };
      const timeout = setTimeout(() => {
        this.pending = this.pending.filter(item => item !== pending);
        this.stop();
        reject(new Error('Piper worker synthesis timed out.'));
      }, PIPER_WORKER_TIMEOUT_MS);
      this.pending.push(pending);
      this.child.stdin.write(`${JSON.stringify({ text, lengthScale })}\n`);
    });
  }
}

function piperWorkerForVoice(voicePath) {
  if (!piperWorkers.has(voicePath)) piperWorkers.set(voicePath, new PiperWorker(voicePath));
  return piperWorkers.get(voicePath);
}

async function synthesizeWithCli(text, difficulty) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fala-tts-'));
  const outPath = path.join(dir, 'out.wav');
  try {
    const lengthScale = lengthScaleForDifficulty(difficulty);
    await runWithStdin(PIPER_PYTHON, [
      '-m', 'piper', '-m', LANGUAGE.piperVoice, '-f', outPath,
      '--length-scale', String(lengthScale),
    ], text);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
      '-l', LANGUAGE.whisperLanguage,
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
  const level = Math.max(1, Math.min(6, Number(difficulty) || 2));
  if (level === 1) return 1.35;
  if (level === 2) return 1.2;
  if (level === 3) return 1.08;
  if (level === 4) return 1.0;
  if (level === 5) return 0.95;
  return 0.9;
}

export async function synthesize(text, difficulty) {
  const voicePath = LANGUAGE.piperVoice;
  const lengthScale = lengthScaleForDifficulty(difficulty);
  try {
    return await piperWorkerForVoice(voicePath).synthesize(text, lengthScale);
  } catch (err) {
    console.error('[piper worker fallback]', err.message);
    piperWorkers.get(voicePath)?.stop();
    piperWorkers.delete(voicePath);
    return synthesizeWithCli(text, difficulty);
  }
}
