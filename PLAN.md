# Fala — v1 Scope & Roadmap

A voice-first Portuguese immersion app.

**Rule #1: The keyboard is optional.** Everything is designed around speaking and listening.

## Home Screen

```
Fala

Difficulty: 3/10

Today's conversation:
Travel

[ Start Talking ]

Recent videos
• Easy Portuguese
• Manual do Mundo
• Ciência Todo Dia
```

## During a Conversation

The interface stays almost empty.

```
Listening...

────────────

AI is speaking...

────────────

Vocabulary learned today

• faz sentido
• embora
• por acaso
```

No chat bubbles. No giant transcript. Just a live conversation.

## Conversation Engine

Each conversation has:

- Topic
- Difficulty
- Vocabulary goals
- Grammar goals
- Memory

Example:

```
Topic: Travel

Goal:
introduce: "vale a pena"
reuse: "faz sentido"
practice: past tense
```

## Memory — the secret

Every phrase gets a score.

```
faz sentido
mastery
████████░░
```

If you hesitate three times, the app quietly brings the phrase back tomorrow.

## YouTube Mode

Paste a URL. The app:

1. Downloads captions
2. Extracts useful phrases
3. Builds a conversation around them

Example:

```
Video: Brazilian street food

Conversation:
Você gosta de comida de rua?
↓
Qual é sua comida favorita?
↓
Você experimentaria pastel?
↓
Qual foi a melhor comida que você já comeu?
```

Without realizing it, you're using the video's vocabulary.

## Difficulty

Instead of CEFR levels, use a simple 1–10 slider.

Internally, these all increase gradually with difficulty:

- Vocabulary
- Sentence length
- Speech speed
- Grammar
- Idioms

## Corrections

Never stop the conversation.

**Bad:** "That's incorrect."

**Good:**
```
You: Eu vai amanhã.
AI:  Ah, você vai amanhã? Que horas você vai?
```

You hear the correct form naturally.

## Personality

Every conversation partner is different — sometimes a college student, a grandmother, a cashier, an engineer, a tourist, a friend. This prevents you from only understanding one speaking style.

## Tech Stack

**Frontend**
- Next.js
- React
- Tailwind CSS

**Backend**
- FastAPI

**Speech Recognition**
- Whisper.cpp

**LLM**
- Ollama
- Qwen3 8B Instruct (upgradeable later)

**Voice**
- Piper (Brazilian Portuguese)

**Video**
- yt-dlp
- faster-whisper (for videos without captions)

**Database**
- SQLite

## Folder Structure

```
fala/
├── frontend/
├── backend/
│   ├── api/
│   ├── conversation/
│   ├── memory/
│   ├── youtube/
│   ├── speech/
│   ├── tts/
│   └── llm/
├── models/
├── data/
└── docker-compose.yml
```

## The Feature to Prioritize

Don't spend months perfecting pronunciation scoring or grammar explanations. Focus on making the AI feel like someone you actually enjoy talking to.

If the conversation is engaging enough that you voluntarily spend 30–60 minutes speaking Portuguese every day, you'll accumulate hundreds of hours of meaningful practice — much harder to achieve with traditional lessons, and likely to have the biggest impact on fluency.

Once the core conversation loop feels natural, add YouTube integration, spaced repetition, pronunciation feedback, and more sophisticated progress tracking. The engaging conversation is the foundation everything else builds on.

## Milestones

**Milestone 1 (1–2 days)**
- Voice-only conversations
- Whisper.cpp for speech recognition
- Ollama for the LLM
- Piper for speech synthesis
- No typing required
- Difficulty slider
- Conversation memory

**Milestone 2**
- YouTube transcript import
- Automatic phrase extraction
- Reuse learned phrases
- Conversation based on the video

**Milestone 3**
- Spaced repetition
- Adaptive difficulty
- Pronunciation feedback
- Progress dashboard

**Milestone 4**
- Different personalities
- News mode
- Podcast mode
- Debate mode
- Story mode
- Travel mode

At that point, you'd have a polished immersion app.
