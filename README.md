# Fala

Fala is a voice-based Brazilian Portuguese practice app. You talk into the microphone, a local language model plays a conversation partner, and a local text-to-speech voice reads its replies back to you.
## Architecture

Each turn moves through four local components:

1. **Speech-to-text** — [whisper.cpp](https://github.com/ggerganov/whisper.cpp) transcribes the recorded microphone audio (Portuguese) into text. `lib/speech.js` also derives a rough "clarity" score from whisper.cpp's per-token decode confidence, and can pass a `--prompt` hint built from the session's topic/video vocabulary to bias recognition toward likely words.
2. **Conversation** — [Ollama](https://ollama.com) serves `qwen2.5:3b-instruct` locally. `lib/content.js` builds the system prompt (persona, topic or video context, difficulty, conversation rules, JSON response format) and `server.js` sends the running message history to it on every turn. The model is asked to always reply in a fixed JSON shape (`speak`, `translation`, `new_phrases`, `reused_phrases`, `struggled_phrases`) so the server can parse it reliably.
3. **Text-to-speech** — [Piper](https://github.com/rhasspy/piper) synthesizes the model's reply using a Brazilian Portuguese voice. Speech rate is scaled down at lower difficulty levels so beginners get slower speech.
4. **Memory** — a local SQLite database (`data/fala.db`, via Node's built-in `node:sqlite`, see `lib/memory.js`) tracks phrases on a simplified SM-2 spaced-repetition schedule, session history, and an adaptive difficulty setting that moves up or down between sessions based on struggle rate and clarity.

Because `qwen2.5:3b-instruct` is a small model, `server.js` includes two runtime safety nets around the raw model output before it reaches the user: `isPlaceholderEcho` detects the model echoing its own JSON-format instructions back as if they were dialogue, and `isRepeatingQuestion` detects the model asking essentially the same question turn after turn (comparing just the trailing question of each reply). Either condition triggers one retry with a corrective instruction appended to the conversation.

## Features

- **Free-topic conversation** — pick a topic (travel, life in São Paulo, street food, research at USP, tech/AI policy, or general small talk) and a mode (open chat, news, podcast-style interview, debate, story, or simulated travel interaction). A random persona (student, grandmother, cashier, engineer, tourist, or friend) is assigned each session.
- **YouTube-based lessons** — paste a video URL that has Portuguese captions; `yt-dlp` fetches the captions, and the model extracts a summary, reusable phrases, and discussion questions (`lib/youtube.js`). The video's transcript excerpt is stored and given to the model during the session so it can answer questions about the video's actual content rather than only following the pre-generated question list.
- **Spaced repetition** — phrases you're introduced to, reuse correctly, or struggle with are scheduled for review using mastery/interval/ease fields per phrase, shown as review chips on the home screen.
- **Adaptive difficulty** — a 1–10 difficulty scale controls vocabulary complexity, sentence length, and verb tense range (see `difficultyInstructions` in `lib/content.js`), as well as Piper's speech rate. After each session, the app raises or lowers the suggested difficulty based on how much you struggled and how clearly whisper.cpp understood you.
- **Clarity feedback** — not true pronunciation scoring, but an honest proxy: whisper.cpp's own average per-token confidence for your speech, shown after each turn.
- **Subtitles** — an optional toggle shows the Portuguese text and English translation of what Fala just said while she speaks; auto-enables at difficulty 1–2.
- **Live transcript** — a running log of both sides of the conversation is kept visible during a session.
- **Progress dashboard** — streak, vocabulary mastery breakdown (new/learning/familiar/mastered), a clarity trend sparkline, and recent session history.

## Requirements

- macOS with [Homebrew](https://brew.sh)
- Node.js 22 or later
- Python 3.10 or later
- A working microphone and browser microphone permission

## Setup

Install the local model runtimes and CLI tools:

```bash
brew install whisper-cpp ollama ffmpeg yt-dlp
ollama pull qwen2.5:3b-instruct
brew services start ollama   # or run `ollama serve` in a separate terminal
```

Download the speech models (whisper.cpp STT model and the Piper TTS voice):

```bash
mkdir -p models/whisper models/piper/voices
curl -L -o models/whisper/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
curl -L -o models/piper/voices/pt_BR-faber-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx
curl -L -o models/piper/voices/pt_BR-faber-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json
```

Set up the Python virtual environment for Piper:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install piper-tts
```

Install Node dependencies and start the server:

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000` and allow microphone access when prompted.

## Configuration

Environment variables (set in `.env`, see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the Express server listens on. |
| `OLLAMA_URL` | `http://localhost:11434` | Base URL of the local Ollama server. |
| `OLLAMA_MODEL` | `qwen2.5:3b-instruct` | Ollama model used for conversation generation. |
| `WHISPER_MODEL` | `models/whisper/ggml-base.bin` | Path to the whisper.cpp model file. |
| `PIPER_VOICE` | `models/piper/voices/pt_BR-faber-medium.onnx` | Path to the Piper voice model. |
| `PIPER_PYTHON` | `.venv/bin/python3` | Python interpreter used to invoke Piper. |

To trade transcription speed for accuracy, download a larger whisper.cpp model (e.g. `ggml-small.bin` or `ggml-medium.bin` from the same Hugging Face repo) and point `WHISPER_MODEL` at it.

## Project structure

```
server.js          Express routes: session lifecycle, YouTube import, dashboard/state endpoints
lib/content.js     Personas, topics, modes, prompt building, model-output validation
lib/ollama.js       Thin client for the local Ollama chat API
lib/speech.js       whisper.cpp transcription and Piper synthesis
lib/youtube.js      Caption fetching (yt-dlp) and lesson extraction
lib/memory.js       SQLite schema, spaced repetition, sessions, adaptive difficulty
public/            Static frontend (index.html, app.js, style.css)
data/              SQLite database (gitignored)
models/            Downloaded whisper.cpp and Piper model files (gitignored)
```

## Notes

- The first reply after starting Ollama is slower because the model has to load into memory; subsequent replies are faster.
- Everything after setup runs offline — there are no calls to OpenAI, the YouTube Data API, or any other external service at runtime. `yt-dlp` does reach YouTube itself when importing a video's captions.
- `qwen2.5:3b-instruct` is small enough to run comfortably on a laptop, but it will occasionally repeat itself or answer inaccurately (e.g. paraphrasing video content rather than quoting it exactly). The retry logic in `server.js` catches the most common failure modes but isn't a substitute for a larger model if you have the hardware to run one.
