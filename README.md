# Fala PT

A voice-first Brazilian Portuguese immersion coach designed around a São Paulo research visit.

## Features
- Live speech-to-speech conversation in the browser
- Brazilian Portuguese coach that prioritizes user speaking time
- Gradual phrase introduction and recycling
- Research scenarios: USP, AI, Smart Sampa, surveillance, public policy
- YouTube caption extraction and conversation generation
- No typing required during practice

## Run
1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and add an OpenAI API key.
3. Run:

```bash
npm install
npm run dev
```

4. Open `http://localhost:3000` and allow microphone access.

## Notes
- YouTube ingestion requires accessible captions. Some videos block or lack captions.
- The OpenAI API key stays on the server.
- Use HTTPS when deploying; browsers generally require a secure context for microphone access.
