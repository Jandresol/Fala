# Fala

A voice-first Brazilian Portuguese immersion coach. Runs **entirely locally** — no API keys, no cloud calls, no internet required once set up.

Rule #1: the keyboard is optional. You talk, Fala talks back.

## How it works

- **Speech-to-text**: [whisper.cpp](https://github.com/ggerganov/whisper.cpp) transcribes your microphone audio.
- **Conversation**: [Ollama](https://ollama.com) running `qwen2.5:3b-instruct` plays the conversation partner, picks a random persona each session, and tracks which phrases to introduce, reuse, or review.
- **Text-to-speech**: [Piper](https://github.com/rhasspy/piper) (Brazilian Portuguese voice) speaks the replies.
- **Memory**: a local SQLite database (`data/fala.db`, via Node's built-in `node:sqlite`) runs a simplified spaced-repetition schedule — struggled phrases resurface soon, mastered ones fade out.
- **Adaptive difficulty**: after each session, Fala nudges its difficulty (1–10) up or down based on how much you struggled and how clearly whisper.cpp understood you.
- **Pronunciation feedback**: a lightweight proxy — whisper.cpp's own per-word decode confidence, averaged into a "clarity" score shown after each turn. Not true phoneme-level scoring, just an honest signal of how easily it understood you.
- **YouTube import**: paste a video URL with Portuguese captions (`yt-dlp` fetches them) and Fala extracts reusable phrases, a summary, and conversation questions, then can hold a whole session discussing that video.
- **Modes**: beyond free-topic chat, pick news, podcast, debate, story, or simulated-travel mode for variety.
- **Progress dashboard**: streak, vocabulary mastery breakdown, clarity trend, and session history.

## Setup

Requires macOS with Homebrew, Node 22+, and Python 3.10+.

```bash
brew install whisper-cpp ollama ffmpeg yt-dlp
ollama pull qwen2.5:3b-instruct
brew services start ollama   # or: ollama serve

mkdir -p models/whisper models/piper/voices
curl -L -o models/whisper/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
curl -L -o models/piper/voices/pt_BR-faber-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx
curl -L -o models/piper/voices/pt_BR-faber-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json

python3 -m venv .venv
source .venv/bin/activate
pip install piper-tts

npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000` and allow microphone access.

## Notes

- First reply after starting Ollama is slower (model load); it warms up after that.
- Everything after setup runs offline — no OpenAI, no YouTube API, no network calls at runtime.
- YouTube-based lesson generation is planned for a later milestone and isn't implemented yet.
