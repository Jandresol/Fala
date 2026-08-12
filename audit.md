---
name: Fala Pipeline Audit
overview: Audit-only report of the Fala monolith (~12 source files). Maps all pipelines, Qwen calls, vocabulary duplication, Portuguese hardcoding, and inferred latency bottlenecks. No code changes until approved.
todos:
  - id: p0-timing
    content: Add lib/timing.js + instrument turn/video/session_start routes
    status: completed
  - id: p0-context-bug
    content: Fix youtube context → conversation_context field mismatch
    status: completed
  - id: p0-parse-boundary
    content: Centralize JSON extraction/parsing (conversation + lesson)
    status: completed
  - id: p0-vocab-pipeline
    content: "Create shared vocabulary ingest: normalize → validate → dedupe → persist"
    status: completed
  - id: p1-language-config
    content: Add lib/language.js; wire speech/youtube/content to read it
    status: completed
  - id: p1-prompt-dedup
    content: Extract shared review/vocabulary/format block in content.js
    status: completed
  - id: p1-video-concepts
    content: Separate video concepts from learner vocabulary in extraction + storage
    status: completed
  - id: p2-piper-decouple
    content: Evaluate Piper decoupling only after timing data confirms benefit
    status: pending
isProject: false
---

# Fala Pipeline Audit Report

**Scope:** 12 runtime source files under [`/Users/jasmineandresol/Fala`](/Users/jasmineandresol/Fala). Monolithic Express + static JS. No timing instrumentation exists today.

---

## 1. Current Pipeline Map

```mermaid
flowchart TB
  subgraph speak [Speak Turn]
    rec[Browser MediaRecorder webm]
    turn[POST /api/session/:id/turn]
    ff[ffmpeg 16kHz WAV]
    wh[whisper-cli -l pt]
    qwen[chatWithRetry → Ollama Qwen]
    parse[parseModelJson]
    mem[applyMemoryEffects + recordTurn]
    piper[Piper TTS]
    ui[JSON response → playBase64Wav]
    rec --> turn --> ff --> wh --> qwen --> parse --> mem --> piper --> ui
  end

  subgraph video [Video Import]
    url[POST /api/youtube]
    ytdl[yt-dlp title + pt captions parallel]
    vtt[parseVtt dedupe]
    qv[qwen lesson extraction 12k chars]
    dbv[saveVideoLesson + recordNewPhrase x N]
    url --> ytdl --> vtt --> qv --> dbv
  end

  subgraph session [Session Lifecycle]
    start[POST /api/session/start]
    end[POST /api/session/:id/end]
    map[in-memory sessions Map max 20 msgs]
    sqlite[(data/fala.db)]
    start --> qwen
    start --> mem
    start --> piper
    end --> sqlite
  end
```

| Stage | Authoritative file | Notes |
|-------|-------------------|-------|
| Orchestration | [`server.js`](/Users/jasmineandresol/Fala/server.js) | Routes, `sessions` Map, `chatWithRetry`, `applyMemoryEffects` |
| STT/TTS | [`lib/speech.js`](/Users/jasmineandresol/Fala/lib/speech.js) | ffmpeg → whisper-cli → Piper Python |
| LLM client | [`lib/ollama.js`](/Users/jasmineandresol/Fala/lib/ollama.js) | Single `chat()` → Ollama `/api/chat`, `format: 'json'` |
| Prompts + parse | [`lib/content.js`](/Users/jasmineandresol/Fala/lib/content.js) | Personas, topics, rules, `parseModelJson`, retry validators |
| Video import | [`lib/youtube.js`](/Users/jasmineandresol/Fala/lib/youtube.js) | yt-dlp captions, inline Qwen prompt, ad-hoc JSON parse |
| Persistence | [`lib/memory.js`](/Users/jasmineandresol/Fala/lib/memory.js) | SQLite: `phrases`, `sessions`, `videos`, `settings` |
| UI | [`public/app.js`](/Users/jasmineandresol/Fala/public/app.js) | Blocks on full turn response including base64 audio |

**Speak turn is fully sequential** — no parallelism after STT:

```169:196:server.js
// transcribe → qwen → memory → piper → res.json (all awaited in order)
```

**Session start** skips STT but otherwise identical: Qwen → memory → Piper → response.

**Video import** parallelizes title + captions, then one Qwen call on clipped transcript (12k chars).

---

## 2. Every Qwen Call and Why

There is **one gateway**: [`lib/ollama.js`](/Users/jasmineandresol/Fala/lib/ollama.js) `chat()`. **Two call sites**, with conditional retries at the conversation site.

| # | Call site | Trigger | Input | Expected output | Calls per invocation |
|---|-----------|---------|-------|-----------------|---------------------|
| A | `buildLessonFromVideo()` in [`lib/youtube.js:81`](/Users/jasmineandresol/Fala/lib/youtube.js) | `POST /api/youtube` | Title + transcript (≤12k chars), Portuguese extraction prompt | `{ summary_pt, phrases[], questions[], context }` | **1** |
| B | `chatWithRetry()` in [`server.js:57`](/Users/jasmineandresol/Fala/server.js) | `POST /api/session/start` | System prompt + synthetic opening user msg | `{ speak, translation, new_phrases, reused_phrases, struggled_phrases }` | **1–3** |
| C | `chatWithRetry()` | `POST /api/session/:id/turn` | Full session history (system + ≤20 turns) + user transcript | Same as B | **1–3** |

**Retry conditions (extra Qwen calls, same conversation):**
- `isPlaceholderEcho(speak)` — model echoed JSON-format instructions ([`content.js:474`](/Users/jasmineandresol/Fala/lib/content.js))
- `isRepeatingQuestion(speak, recentSpeaks)` — same question ≥60% word overlap ([`content.js:534`](/Users/jasmineandresol/Fala/lib/content.js))

**Not duplicate API calls, but duplicated context:**
- Video prep (call A) extracts summary, phrases, questions, context from full transcript.
- Video sessions (call B/C) re-inject summary, `conversation_context`, questions, and a **3k transcript excerpt** via `buildVideoSystemPrompt()` ([`content.js:383`](/Users/jasmineandresol/Fala/lib/content.js)).
- Conversation turns can still emit `new_phrases` even when phrases were pre-extracted at import.

**Qwen is NOT called redundantly within a single request** unless retries fire. The open question (needs timing) is how often retries add a 2nd/3rd call.

---

## 3. Duplicated Vocabulary / Phrase Logic

### Terminology today

| Name | Meaning | Shape | Where |
|------|---------|-------|-------|
| `speak` | Spoken reply (TTS input) | `string` | Conversation JSON — **not vocabulary** |
| `new_phrases` | New learner vocabulary from conversation | `[{pt, en}]`, max 1/turn | `parseModelJson` → `applyMemoryEffects` |
| `phrases` | Video-extracted vocabulary | `[{pt, en}]`, prompt says ≤6 | `youtube.js` → direct `recordNewPhrase` loop |
| `reused_phrases` / `struggled_phrases` | Known-phrase tracking | `string[]` | Conversation only |
| `phrases` table | Persistent SM-2 vocabulary | DB row keyed by `pt` | `lib/memory.js` |

No `concepts` field exists. Video extraction conflates **reusable expressions** with anything the model returns — all saved to `phrases` table.

### Duplication map

| Concern | Locations | Issue |
|---------|-----------|-------|
| **Dual JSON schemas** | `youtube.js` `phrases` vs `content.js` `new_phrases` | Same `{pt, en}` object, different keys and entry paths |
| **Dual normalizers** | `normalizeNewPhrases()` + `normalizeTrackedPhraseArray()` in [`content.js:602`](/Users/jasmineandresol/Fala/lib/content.js); `normalizePhrase()` in [`memory.js:99`](/Users/jasmineandresol/Fala/lib/memory.js) | Overlapping string/object handling, not shared |
| **Dual JSON parsers** | `parseModelJson()` vs inline `JSON.parse` in [`youtube.js:81-83`](/Users/jasmineandresol/Fala/lib/youtube.js) | Same `\{[\s\S]*\}` regex pattern, different error handling |
| **Dual write paths** | `applyMemoryEffects()` ([`server.js:38`](/Users/jasmineandresol/Fala/server.js)) vs video import loop ([`server.js:100`](/Users/jasmineandresol/Fala/server.js)) | Both call `recordNewPhrase`, no shared validation/dedup/filter |
| **Duplicated prompt blocks** | `buildSystemPrompt` vs `buildVideoSystemPrompt` ([`content.js:368-378`](/Users/jasmineandresol/Fala/lib/content.js) vs `447-456`) | Review-list + vocabulary rules copied verbatim |
| **Duplicated vocabHint** | [`server.js:122`](/Users/jasmineandresol/Fala/server.js) vs `128` | Same pattern, different source strings |
| **Weaker video validation** | `youtube.js:87` — `filter(p => p && p.pt)` only | No trim, no en check, no dedup, no max-6 enforcement, no proper-noun filter |

### Known bug: video context dropped

[`youtube.js:89`](/Users/jasmineandresol/Fala/lib/youtube.js) returns `context`, but [`saveVideoLesson()`](/Users/jasmineandresol/Fala/lib/memory.js) expects `conversation_context`. Spread in `saveVideoLesson({ url, ...lesson })` silently stores empty context → `buildVideoSystemPrompt` reads blank `video.conversation_context`.

### Video concepts ≠ learner vocabulary (gap)

Video prompt asks for "expressões úteis" and **all** are persisted as vocabulary ([`server.js:100`](/Users/jasmineandresol/Fala/server.js)). Proper nouns/landmarks mentioned in video context can become phrase-memory items — contradicts `VOCABULARY_MEMORY_RULES` (which excludes proper nouns) for conversation but not for video import.

---

## 4. Major Portuguese Hardcoding

No centralized language config. Portuguese assumed in **4 independent layers**:

| Layer | File | Hardcoded |
|-------|------|-----------|
| Whisper STT | [`lib/speech.js:45`](/Users/jasmineandresol/Fala/lib/speech.js) | `-l pt` (no env override) |
| Piper TTS | [`lib/speech.js:10`](/Users/jasmineandresol/Fala/lib/speech.js) | Default `pt_BR-faber-medium.onnx` (env override exists) |
| YouTube captions | [`lib/youtube.js:46,57`](/Users/jasmineandresol/Fala/lib/youtube.js) | `--sub-langs pt.*,pt`, error text |
| LLM prompts | [`lib/content.js`](/Users/jasmineandresol/Fala/lib/content.js), [`lib/youtube.js:72`](/Users/jasmineandresol/Fala/lib/youtube.js), [`server.js:61,66,131`](/Users/jasmineandresol/Fala/server.js) | All instruction text in Brazilian Portuguese |
| DB schema | [`lib/memory.js`](/Users/jasmineandresol/Fala/lib/memory.js) | Columns `pt`, `summary_pt` (acceptable for now; rename is P2/multilingual pass) |
| Product content | [`lib/content.js`](/Users/jasmineandresol/Fala/lib/content.js) TOPICS/PERSONAS | São Paulo topics — correctly locale-specific content |

**Already env-configurable:** `OLLAMA_URL`, `OLLAMA_MODEL`, `WHISPER_MODEL`, `PIPER_VOICE`, `PIPER_PYTHON` ([`.env.example`](/Users/jasmineandresol/Fala/.env.example)). Missing: `WHISPER_LANG`, caption language, target-language label for prompts.

---

## 5. Likely Latency Bottlenecks

**No measurements exist.** Inferred from architecture (timing pass is P0):

| Bottleneck | Pipeline | Why likely slow | Needs timing to confirm |
|------------|----------|-----------------|-------------------------|
| **Qwen inference** | Turn, session start, video | Dominant LLM step; 3B model still 1–5s+; up to 3× with retries; large system prompts (video mode includes 3k transcript + rules) | `qwen` ms per turn; retry rate |
| **Piper blocks UI update** | Turn, session start | Server `await synthesize()` **before** `res.json()` ([`server.js:154,187`](/Users/jasmineandresol/Fala/server.js)). Client shows "Pensando…" until audio is ready ([`app.js:329,351`](/Users/jasmineandresol/Fala/public/app.js)) | `piper` ms; compare to time until text could ship |
| **Whisper + ffmpeg** | Turn only | Subprocess chain per turn; temp file I/O | `ffmpeg` + `whisper` ms |
| **yt-dlp caption fetch** | Video import | Network + subtitle track attempts; 60s timeout ([`youtube.js:50`](/Users/jasmineandresol/Fala/lib/youtube.js)) | `captions` ms |
| **Qwen on 12k transcript** | Video import | Single large prompt | `qwen` ms in video flow |
| **Ollama cold start** | First call after idle | Documented in README; not measured | `session_start` first qwen |
| **SQLite / memory** | All | Trivial synchronous ops | Expect <20ms |

**Conversation slowness hypothesis:** `whisper + qwen (+ retries) + piper` stacked sequentially; Piper adds perceived delay even after text is ready.

**Video ~1 min hypothesis:** yt-dlp caption download (network) + 12k-char Qwen call + phrase DB writes — not multiple Qwen calls.

**Qwen over-call hypothesis:** Unlikely per turn unless retries are frequent — **measure retry rate**.

---

## 6. Recommended Modules / Consolidation Targets

Only where responsibility is genuinely duplicated today:

```text
lib/
  language.js          NEW — { code, whisperLanguage, captionLangs, targetLanguage,
                               supportLanguage, piperVoice } + env overrides
  timing.js            NEW — dev-only stage timer, [Fala timing: turn|video|session_start]
  model.js             RENAME/SPLIT from content.js — extractJson, parseConversationJson,
                               parseLessonJson (single parsing boundary)
  vocabulary.js        NEW — ingestCandidates(source, items) → normalize → validate
                               → dedupe → recordNewPhrase; shared by speak + video
  content.js           KEEP — personas, topics, modes, prompt builders (read language.js)
  speech.js            KEEP — read whisperLanguage, piperVoice from language.js
  ollama.js            KEEP
  memory.js            KEEP — persistence + SM-2; vocabulary.js calls into it
  youtube.js           KEEP — caption fetch; lesson extraction uses model.js + vocabulary.js
server.js              SLIM — orchestration only; timing wrappers at route level
```

**Prompt consolidation:** Extract shared block (review list + `VOCABULARY_MEMORY_RULES` + `RESPONSE_FORMAT`) into one helper used by both `buildSystemPrompt` and `buildVideoSystemPrompt`.

**Do NOT create** separate Speak/Video/Session modules — they are modes of the same orchestrator.

---

## 7. Top Changes Ranked

### P0 — Measure + fix correctness (before optimizing)

1. **Add dev timing instrumentation** — `[Fala timing: turn|video|session_start]` with per-stage ms and total; gate on `FALA_TIMING=1` or `NODE_ENV=development`.
2. **Fix `context` → `conversation_context` bug** — one-line mapping in `youtube.js` or `saveVideoLesson` caller; restores video conversation quality.
3. **Single model parsing boundary** — shared `extractJson(raw)` + typed parsers for conversation vs lesson JSON; eliminate ad-hoc parse in `youtube.js`.
4. **Unified vocabulary ingest pipeline** — one path: candidates → normalize → validate (incl. proper-noun rules) → dedupe → `recordNewPhrase`; used by `applyMemoryEffects` and video import.

### P1 — Consolidate without behavior change (after P0 metrics)

5. **Central `lib/language.js`** — core reads config; prompts interpolate `targetLanguage`; preserve `.env` overrides for model paths/voice.
6. **Deduplicate prompt builders** — shared review/vocabulary/format block between topic and video system prompts.
7. **Split video output: concepts vs vocabulary** — extend lesson JSON with `concepts` (video context, not auto-saved to `phrases`) vs `phrases` (learner vocabulary); filter video phrases through same validation as conversation `new_phrases`.
8. **Rename internal consistency** — normalize on `new_phrases` shape everywhere; map at API boundary if UI still expects `phrases`.

### P2 — Latency / multilingual prep (after timing data)

9. **Decouple Piper from first response** — return text/subtitles immediately, TTS via second request or streaming; only if timing confirms Piper is significant.
10. **Retry tuning** — log/metric retry triggers; tighten prompts before adding latency.
11. **Video caption caching** — avoid re-fetching same URL transcript.
12. **Schema i18n** — rename `pt`/`summary_pt` columns when adding second language (not this pass).

---

## What This Pass Will NOT Do

- Add languages, language selector, or new models
- Redesign UI or add product features
- Major database redesign
- Optimize based on guesses (timing first)

---

## Approval Gate

Confirm this audit, then implementation proceeds in order: **P0 timing + bugfix + parsing/vocabulary consolidation → P1 language config + prompt dedup → P2 only where timing justifies it.**
