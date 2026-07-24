import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'fala.db'));

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
    questions TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];
for (const statement of schemaStatements) db.prepare(statement).run();

// --- phrases / spaced repetition (simplified SM-2) ---

const upsertPhrase = db.prepare(`
  INSERT INTO phrases (pt, en, source_video_id)
  VALUES (?, ?, ?)
  ON CONFLICT(pt) DO UPDATE SET en = CASE WHEN excluded.en != '' THEN excluded.en ELSE phrases.en END
`);

const insertOrIgnorePhrase = db.prepare(`INSERT INTO phrases (pt, en) VALUES (?, ?) ON CONFLICT(pt) DO NOTHING`);

const getPhrase = db.prepare(`SELECT * FROM phrases WHERE pt = ?`);

const updateReviewSchedule = db.prepare(`
  UPDATE phrases
  SET mastery = ?, interval_days = ?, ease = ?, next_review = date('now', ?), times_reviewed = times_reviewed + 1, last_practiced = date('now')
  WHERE pt = ?
`);

const updateStruggle = db.prepare(`
  UPDATE phrases
  SET mastery = MAX(0, mastery - 0.12), interval_days = 1, ease = MAX(1.3, ease - 0.2),
      next_review = date('now'), hesitations = hesitations + 1, last_practiced = date('now')
  WHERE pt = ?
`);

export function recordNewPhrase(pt, en, sourceVideoId = null) {
  if (!pt) return;
  upsertPhrase.run(pt, en || '', sourceVideoId);
}

export function recordReused(pt) {
  if (!pt) return;
  insertOrIgnorePhrase.run(pt, '');
  const row = getPhrase.get(pt);
  const ease = row?.ease ?? 2.3;
  const prevInterval = row?.interval_days ?? 1;
  const mastery = Math.min(1, (row?.mastery ?? 0.15) + 0.15);
  const nextInterval = mastery >= 0.85 ? prevInterval * ease : Math.max(1, prevInterval * 1.5);
  updateReviewSchedule.run(mastery, nextInterval, Math.min(3, ease + 0.05), `+${Math.round(nextInterval)} days`, pt);
}

export function recordStruggled(pt) {
  if (!pt) return;
  insertOrIgnorePhrase.run(pt, '');
  updateStruggle.run(pt);
}

export function phrasesForReview(limit = 5) {
  return db.prepare(`
    SELECT pt, en, mastery, hesitations, times_reviewed, next_review, last_practiced
    FROM phrases
    WHERE next_review <= date('now') AND mastery < 0.95
    ORDER BY next_review ASC, mastery ASC
    LIMIT ?
  `).all(limit);
}

export function allPhrases() {
  return db.prepare(`
    SELECT pt, en, mastery, hesitations, times_reviewed, next_review, last_practiced
    FROM phrases ORDER BY last_practiced DESC
  `).all();
}

export function masteryBuckets() {
  const rows = db.prepare(`SELECT mastery FROM phrases`).all();
  const buckets = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  for (const { mastery } of rows) {
    if (mastery < 0.25) buckets.new++;
    else if (mastery < 0.55) buckets.learning++;
    else if (mastery < 0.85) buckets.familiar++;
    else buckets.mastered++;
  }
  return buckets;
}

// --- sessions ---

export function startSession({ topic, persona, difficulty, mode = 'topic', videoId = null }) {
  const result = db.prepare(`
    INSERT INTO sessions (topic, persona, difficulty, mode, video_id) VALUES (?, ?, ?, ?, ?)
  `).run(topic, persona, difficulty, mode, videoId);
  return Number(result.lastInsertRowid);
}

export function recordTurn(sessionId, { clarity, struggled } = {}) {
  if (!sessionId) return;
  const setClarity = typeof clarity === 'number' ? `clarity_sum = clarity_sum + ${clarity}, clarity_count = clarity_count + 1,` : '';
  db.prepare(`
    UPDATE sessions SET turns = turns + 1, ${setClarity} struggle_count = struggle_count + ?
    WHERE id = ?
  `).run(struggled ? 1 : 0, sessionId);
}

export function endSession(sessionId) {
  if (!sessionId) return null;
  db.prepare(`UPDATE sessions SET ended_at = datetime('now') WHERE id = ?`).run(sessionId);
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
}

export function recentSessions(limit = 10) {
  return db.prepare(`
    SELECT id, started_at, topic, mode, persona, difficulty, turns, struggle_count,
      CASE WHEN clarity_count > 0 THEN clarity_sum / clarity_count ELSE NULL END AS avg_clarity
    FROM sessions ORDER BY id DESC LIMIT ?
  `).all(limit);
}

export function clarityTrend(limit = 14) {
  return db.prepare(`
    SELECT id, started_at,
      CASE WHEN clarity_count > 0 THEN clarity_sum / clarity_count ELSE NULL END AS avg_clarity
    FROM sessions
    WHERE clarity_count > 0
    ORDER BY id DESC LIMIT ?
  `).all(limit).reverse();
}

export function currentStreak() {
  const days = db.prepare(`SELECT DISTINCT date(started_at) AS d FROM sessions ORDER BY d DESC`).all();
  if (!days.length) return 0;
  let streak = 0;
  let cursor = new Date(`${days[0].d}T00:00:00`);
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
  const diffDays = (a, b) => Math.round((a - b) / 86400000);
  if (diffDays(today, cursor) > 1) return 0;
  const set = new Set(days.map(r => r.d));
  cursor = today;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

// --- adaptive difficulty ---

const getSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const setSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

export function getAdaptiveDifficulty(fallback = 3) {
  const row = getSetting.get('difficulty');
  return row ? Number(row.value) : fallback;
}

export function updateAdaptiveDifficulty(session) {
  if (!session || !session.turns) return getAdaptiveDifficulty();
  const current = getAdaptiveDifficulty(session.difficulty || 3);
  const struggleRate = session.struggle_count / session.turns;
  const avgClarity = session.clarity_count > 0 ? session.clarity_sum / session.clarity_count : null;
  let next = current;
  const strugglingALot = struggleRate > 0.4 || (avgClarity !== null && avgClarity < 0.7);
  const doingWell = struggleRate < 0.15 && (avgClarity === null || avgClarity > 0.85);
  if (strugglingALot) next = current - 1;
  else if (doingWell) next = current + 1;
  next = Math.max(1, Math.min(10, next));
  setSetting.run('difficulty', String(next));
  return next;
}

// --- video lessons (YouTube import) ---

export function saveVideoLesson({ url, title, summary_pt, conversation_context, questions }) {
  const result = db.prepare(`
    INSERT INTO videos (url, title, summary_pt, conversation_context, questions) VALUES (?, ?, ?, ?, ?)
  `).run(url, title || '', summary_pt || '', conversation_context || '', JSON.stringify(questions || []));
  return Number(result.lastInsertRowid);
}

export function getVideoLesson(id) {
  const row = db.prepare(`SELECT * FROM videos WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, questions: JSON.parse(row.questions || '[]') };
}

export function recentVideos(limit = 6) {
  return db.prepare(`SELECT id, url, title, created_at FROM videos ORDER BY id DESC LIMIT ?`).all(limit);
}
