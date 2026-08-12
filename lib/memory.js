import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'fala.db'));


// ============================================================
// Schema
// ============================================================

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS phrases (
    pt TEXT PRIMARY KEY,
    en TEXT,
    mastery REAL NOT NULL DEFAULT 0.15,
    hesitations INTEGER NOT NULL DEFAULT 0,
    times_reviewed INTEGER NOT NULL DEFAULT 0,
    interval_days REAL NOT NULL DEFAULT 1,
    ease REAL NOT NULL DEFAULT 2.3,
    next_review TEXT NOT NULL DEFAULT (date('now')),
    source_video_id INTEGER,
    last_practiced TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    topic TEXT,
    mode TEXT NOT NULL DEFAULT 'topic',
    persona TEXT,
    difficulty INTEGER,
    turns INTEGER NOT NULL DEFAULT 0,
    clarity_sum REAL NOT NULL DEFAULT 0,
    clarity_count INTEGER NOT NULL DEFAULT 0,
    struggle_count INTEGER NOT NULL DEFAULT 0,
    video_id INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT,
    summary_pt TEXT,
    conversation_context TEXT,
    concepts TEXT,
    questions TEXT,
    transcript TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

for (const statement of schemaStatements) {
  db.prepare(statement).run();
}


// ============================================================
// Small migrations
// ============================================================

const videoColumns = db
  .prepare(`PRAGMA table_info(videos)`)
  .all()
  .map((column) => column.name);

if (!videoColumns.includes('transcript')) {
  db.prepare(`ALTER TABLE videos ADD COLUMN transcript TEXT`).run();
}

if (!videoColumns.includes('concepts')) {
  db.prepare(`ALTER TABLE videos ADD COLUMN concepts TEXT`).run();
}


// ============================================================
// Phrase helpers
// ============================================================

/*
 * Qwen may return phrases either as strings:
 *
 * "viajar no fim do mês"
 *
 * or objects:
 *
 * {
 *   pt: "viajar no fim do mês",
 *   en: "travel at the end of the month"
 * }
 *
 * Normalize both forms here before sending anything to SQLite.
 */
function normalizePhrase(value) {
  if (!value) {
    return {
      pt: '',
      en: '',
    };
  }

  if (typeof value === 'string') {
    return {
      pt: value.trim(),
      en: '',
    };
  }

  if (typeof value === 'object') {
    return {
      pt: String(value.pt || '').trim(),
      en: String(value.en || '').trim(),
    };
  }

  return {
    pt: String(value).trim(),
    en: '',
  };
}


// ============================================================
// Prepared phrase statements
// ============================================================

const upsertPhrase = db.prepare(`
  INSERT INTO phrases (
    pt,
    en,
    source_video_id
  )
  VALUES (?, ?, ?)

  ON CONFLICT(pt) DO UPDATE SET
    en = CASE
      WHEN excluded.en != '' THEN excluded.en
      ELSE phrases.en
    END
`);

const insertOrIgnorePhrase = db.prepare(`
  INSERT INTO phrases (pt, en)
  VALUES (?, ?)
  ON CONFLICT(pt) DO NOTHING
`);

const getPhrase = db.prepare(`
  SELECT *
  FROM phrases
  WHERE pt = ?
`);

const updateReviewSchedule = db.prepare(`
  UPDATE phrases
  SET
    mastery = ?,
    interval_days = ?,
    ease = ?,
    next_review = date('now', ?),
    times_reviewed = times_reviewed + 1,
    last_practiced = date('now')
  WHERE pt = ?
`);

const updateStruggle = db.prepare(`
  UPDATE phrases
  SET
    mastery = MAX(0, mastery - 0.12),
    interval_days = 1,
    ease = MAX(1.3, ease - 0.2),
    next_review = date('now'),
    hesitations = hesitations + 1,
    last_practiced = date('now')
  WHERE pt = ?
`);


// ============================================================
// Phrase memory / spaced repetition
// ============================================================

export function recordNewPhrase(value, en = '', sourceVideoId = null) {
  const phrase = normalizePhrase(value);

  if (!phrase.pt) return;

  // If an object contained an English translation, prefer it.
  const english = phrase.en || en || '';

  upsertPhrase.run(
    phrase.pt,
    english,
    sourceVideoId
  );
}


export function recordReused(value) {
  const phrase = normalizePhrase(value);

  if (!phrase.pt) return;

  insertOrIgnorePhrase.run(
    phrase.pt,
    phrase.en
  );

  const row = getPhrase.get(phrase.pt);

  if (!row) return;

  const ease = row.ease ?? 2.3;
  const prevInterval = row.interval_days ?? 1;

  const mastery = Math.min(
    1,
    (row.mastery ?? 0.15) + 0.15
  );

  const nextInterval =
    mastery >= 0.85
      ? prevInterval * ease
      : Math.max(1, prevInterval * 1.5);

  updateReviewSchedule.run(
    mastery,
    nextInterval,
    Math.min(3, ease + 0.05),
    `+${Math.round(nextInterval)} days`,
    phrase.pt
  );
}


export function recordStruggled(value) {
  const phrase = normalizePhrase(value);

  if (!phrase.pt) return;

  insertOrIgnorePhrase.run(
    phrase.pt,
    phrase.en
  );

  updateStruggle.run(phrase.pt);
}


export function phrasesForReview(limit = 5) {
  return db.prepare(`
    SELECT
      pt,
      en,
      mastery,
      hesitations,
      times_reviewed,
      next_review,
      last_practiced
    FROM phrases
    WHERE
      next_review <= date('now')
      AND mastery < 0.95
    ORDER BY
      next_review ASC,
      mastery ASC
    LIMIT ?
  `).all(limit);
}


export function allPhrases() {
  return db.prepare(`
    SELECT
      pt,
      en,
      mastery,
      hesitations,
      times_reviewed,
      next_review,
      last_practiced
    FROM phrases
    ORDER BY last_practiced DESC
  `).all();
}


export function masteryBuckets() {
  const rows = db
    .prepare(`SELECT mastery FROM phrases`)
    .all();

  const buckets = {
    new: 0,
    learning: 0,
    familiar: 0,
    mastered: 0,
  };

  for (const { mastery } of rows) {
    if (mastery < 0.25) {
      buckets.new++;
    } else if (mastery < 0.55) {
      buckets.learning++;
    } else if (mastery < 0.85) {
      buckets.familiar++;
    } else {
      buckets.mastered++;
    }
  }

  return buckets;
}


// ============================================================
// Sessions
// ============================================================

export function startSession({
  topic,
  persona,
  difficulty,
  mode = 'topic',
  videoId = null,
}) {
  const result = db.prepare(`
    INSERT INTO sessions (
      topic,
      persona,
      difficulty,
      mode,
      video_id
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    topic,
    persona,
    difficulty,
    mode,
    videoId
  );

  return Number(result.lastInsertRowid);
}


export function recordTurn(
  sessionId,
  {
    clarity,
    struggled,
  } = {}
) {
  if (!sessionId) return;

  /*
   * Avoid interpolating clarity into SQL.
   * Keep values parameterized instead.
   */

  if (typeof clarity === 'number') {
    db.prepare(`
      UPDATE sessions
      SET
        turns = turns + 1,
        clarity_sum = clarity_sum + ?,
        clarity_count = clarity_count + 1,
        struggle_count = struggle_count + ?
      WHERE id = ?
    `).run(
      clarity,
      struggled ? 1 : 0,
      sessionId
    );
  } else {
    db.prepare(`
      UPDATE sessions
      SET
        turns = turns + 1,
        struggle_count = struggle_count + ?
      WHERE id = ?
    `).run(
      struggled ? 1 : 0,
      sessionId
    );
  }
}


export function endSession(sessionId) {
  if (!sessionId) return null;

  db.prepare(`
    UPDATE sessions
    SET ended_at = datetime('now')
    WHERE id = ?
  `).run(sessionId);

  return db.prepare(`
    SELECT *
    FROM sessions
    WHERE id = ?
  `).get(sessionId);
}


export function recentSessions(limit = 10) {
  return db.prepare(`
    SELECT
      id,
      started_at,
      topic,
      mode,
      persona,
      difficulty,
      turns,
      struggle_count,
      CASE
        WHEN clarity_count > 0
        THEN clarity_sum / clarity_count
        ELSE NULL
      END AS avg_clarity
    FROM sessions
    WHERE turns > 0
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}


export function clarityTrend(limit = 14) {
  return db.prepare(`
    SELECT
      id,
      started_at,
      CASE
        WHEN clarity_count > 0
        THEN clarity_sum / clarity_count
        ELSE NULL
      END AS avg_clarity
    FROM sessions
    WHERE clarity_count > 0
    ORDER BY id DESC
    LIMIT ?
  `)
    .all(limit)
    .reverse();
}


// ============================================================
// Streak
// ============================================================

export function currentStreak() {
  const days = db.prepare(`
    SELECT DISTINCT date(started_at) AS d
    FROM sessions
    ORDER BY d DESC
  `).all();

  if (!days.length) {
    return 0;
  }

  let streak = 0;

  let cursor = new Date(
    `${days[0].d}T00:00:00`
  );

  const today = new Date(
    new Date().toISOString().slice(0, 10) +
    'T00:00:00'
  );

  const diffDays = (a, b) =>
    Math.round((a - b) / 86400000);

  if (diffDays(today, cursor) > 1) {
    return 0;
  }

  const set = new Set(
    days.map((row) => row.d)
  );

  cursor = today;

  while (
    set.has(
      cursor.toISOString().slice(0, 10)
    )
  ) {
    streak++;

    cursor = new Date(
      cursor.getTime() - 86400000
    );
  }

  return streak;
}


// ============================================================
// Adaptive difficulty
// ============================================================

const getSetting = db.prepare(`
  SELECT value
  FROM settings
  WHERE key = ?
`);

const setSetting = db.prepare(`
  INSERT INTO settings (
    key,
    value
  )
  VALUES (?, ?)

  ON CONFLICT(key)
  DO UPDATE SET
    value = excluded.value
`);


export function getAdaptiveDifficulty(fallback = 2) {
  const row = getSetting.get('difficulty');

  const value = row
    ? Number(row.value)
    : fallback;

  return Math.max(1, Math.min(6, value));
}


export function updateAdaptiveDifficulty(session) {
  if (!session || !session.turns) {
    return getAdaptiveDifficulty();
  }

  const current = getAdaptiveDifficulty(
    session.difficulty || 2
  );

  const struggleRate =
    session.struggle_count / session.turns;

  const avgClarity =
    session.clarity_count > 0
      ? session.clarity_sum /
        session.clarity_count
      : null;

  let next = current;

  const strugglingALot =
    struggleRate > 0.4 ||
    (
      avgClarity !== null &&
      avgClarity < 0.7
    );

  const doingWell =
    struggleRate < 0.15 &&
    (
      avgClarity === null ||
      avgClarity > 0.85
    );

  if (strugglingALot) {
    next = current - 1;
  } else if (doingWell) {
    next = current + 1;
  }

  next = Math.max(
    1,
    Math.min(6, next)
  );

  setSetting.run(
    'difficulty',
    String(next)
  );

  return next;
}


// ============================================================
// Video lessons / YouTube import
// ============================================================

export function saveVideoLesson({
  url,
  title,
  summary_pt,
  conversation_context,
  concepts,
  questions,
  transcript,
}) {
  const result = db.prepare(`
    INSERT INTO videos (
      url,
      title,
      summary_pt,
      conversation_context,
      concepts,
      questions,
      transcript
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    url,
    title || '',
    summary_pt || '',
    conversation_context || '',
    JSON.stringify(concepts || []),
    JSON.stringify(questions || []),
    transcript || ''
  );

  return Number(result.lastInsertRowid);
}


export function getVideoLesson(id) {
  const row = db.prepare(`
    SELECT *
    FROM videos
    WHERE id = ?
  `).get(id);

  if (!row) {
    return null;
  }

  let questions = [];
  let concepts = [];

  try {
    questions = JSON.parse(
      row.questions || '[]'
    );
  } catch {
    questions = [];
  }

  try {
    concepts = JSON.parse(
      row.concepts || '[]'
    );
  } catch {
    concepts = [];
  }

  return {
    ...row,
    questions,
    concepts,
  };
}


export function recentVideos(limit = 6) {
  return db.prepare(`
    SELECT
      id,
      url,
      title,
      created_at
    FROM videos
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}
