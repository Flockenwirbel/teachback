import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// TEACHBACK_DB in .env.local names the SQLite file; uploaded attachments live in files/ beside it.
let dbPath = resolve(project, 'data/teachback.db');
export let filesDir = join(dirname(dbPath), 'files');

let db;

export function configureStore({ path } = {}) {
  if (db || !path) return;
  dbPath = resolve(project, path);
  filesDir = join(dirname(dbPath), 'files');
}

export function database() {
  if (db) return db;
  mkdirSync(filesDir, { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS courses (
      slug TEXT PRIMARY KEY,
      storage_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      term TEXT NOT NULL DEFAULT '',
      teacher TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      course TEXT NOT NULL REFERENCES courses(slug) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      date TEXT,
      source_file TEXT,
      status TEXT NOT NULL CHECK (status IN ('empty', 'parsing', 'ready', 'failed')),
      error TEXT,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chapters_course ON chapters(course, number);
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      course TEXT NOT NULL REFERENCES courses(slug) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS questions_chapter ON questions(chapter_id, position);
    CREATE TABLE IF NOT EXISTS progress (
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('note', 'teach')),
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (chapter_id, kind)
    );
    -- Student questions are generated per chapter now; the static bank is gone.
    DROP TABLE IF EXISTS course_assets;
  `);
  // Page texts of a chapter's attachment back the teacher's quoted evidence.
  if (
    !db
      .prepare('PRAGMA table_info(chapters)')
      .all()
      .some((column) => column.name === 'pages')
  ) {
    db.exec('ALTER TABLE chapters ADD COLUMN pages TEXT');
  }
  // A parse runs inside the server process; one that was running when the server stopped will not finish.
  db.prepare(
    `UPDATE chapters SET status = 'failed', error = '服务重启，解析中断。请重新解析。' WHERE status = 'parsing'`
  ).run();
  return db;
}

function chapterRow(row, withNote) {
  const note = row.note ? JSON.parse(row.note) : null;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    summary: row.summary,
    date: row.date,
    source: row.source_file,
    status: row.status,
    error: row.error,
    stops: note ? note.segments.filter((segment) => segment.type === 'stop').length : 0,
    noteTitle: note?.title ?? null,
    sample: note?.sample ?? false,
    ...(withNote ? { segments: note?.segments ?? null } : {})
  };
}

function courseRow(row) {
  return {
    slug: row.slug,
    storageId: row.storage_id,
    name: row.name,
    code: row.code,
    term: row.term,
    teacher: row.teacher,
    description: row.description,
    createdAt: row.created_at
  };
}

export function listCourses() {
  const store = database();
  return store
    .prepare('SELECT * FROM courses ORDER BY created_at')
    .all()
    .map((row) => ({
      ...courseRow(row),
      chapters: store
        .prepare('SELECT * FROM chapters WHERE course = ? ORDER BY number')
        .all(row.slug)
        .map((chapter) => chapterRow(chapter, false)),
      questionCount: countQuestions(row.slug),
      progress: courseProgress(row.slug)
    }));
}

export function getCourse(slug) {
  const store = database();
  const row = store.prepare('SELECT * FROM courses WHERE slug = ?').get(slug);
  if (!row) return null;
  return {
    ...courseRow(row),
    chapters: store
      .prepare('SELECT * FROM chapters WHERE course = ? ORDER BY number')
      .all(slug)
      .map((chapter) => chapterRow(chapter, true)),
    questionCount: countQuestions(slug),
    progress: courseProgress(slug)
  };
}

export function createCourse({ name, code, term, teacher, description }) {
  const store = database();
  const base =
    (code || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'course';
  let slug = base;
  for (let n = 2; store.prepare('SELECT 1 FROM courses WHERE slug = ?').get(slug); n++) slug = `${base}-${n}`;
  store
    .prepare(
      `INSERT INTO courses (slug, storage_id, name, code, term, teacher, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(slug, slug, name, code, term, teacher, description, Date.now());
  mkdirSync(join(filesDir, slug), { recursive: true });
  return getCourse(slug);
}

export function updateCourse(slug, { name, code, term, teacher, description }) {
  database()
    .prepare('UPDATE courses SET name = ?, code = ?, term = ?, teacher = ?, description = ? WHERE slug = ?')
    .run(name, code, term, teacher, description, slug);
  return getCourse(slug);
}

// The learner's progress, per chapter: what they answered in the note, and how they taught each question.
function courseProgress(slug) {
  const progress = { note: {}, teach: {} };
  for (const row of database()
    .prepare(
      'SELECT p.chapter_id, p.kind, p.data FROM progress p JOIN chapters c ON c.id = p.chapter_id WHERE c.course = ?'
    )
    .all(slug))
    progress[row.kind][row.chapter_id] = JSON.parse(row.data);
  return progress;
}

export function saveProgress(chapterId, kind, data) {
  database()
    .prepare(
      `INSERT INTO progress (chapter_id, kind, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (chapter_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .run(chapterId, kind, data, Date.now());
}

export function clearProgress(chapterId, kind) {
  database().prepare('DELETE FROM progress WHERE chapter_id = ? AND kind = ?').run(chapterId, kind);
}

function countQuestions(slug) {
  return database().prepare('SELECT COUNT(*) AS n FROM questions WHERE course = ?').get(slug).n;
}

export function listQuestions(slug) {
  return database()
    .prepare(
      `SELECT q.body FROM questions q JOIN chapters c ON c.id = q.chapter_id
    WHERE q.course = ? ORDER BY c.number, q.position`
    )
    .all(slug)
    .map((row) => JSON.parse(row.body));
}

export function replaceQuestions(slug, chapterId, items) {
  const store = database();
  store.exec('BEGIN');
  try {
    store.prepare('DELETE FROM questions WHERE course = ? AND chapter_id = ?').run(slug, chapterId);
    clearProgress(chapterId, 'teach');
    const insert = store.prepare(
      'INSERT INTO questions (id, course, chapter_id, position, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    items.forEach((item, index) => insert.run(item.id, slug, chapterId, index, JSON.stringify(item), Date.now()));
    store.exec('COMMIT');
  } catch (error) {
    store.exec('ROLLBACK');
    throw error;
  }
}

export function getPages(slug, id) {
  const row = database().prepare('SELECT pages FROM chapters WHERE course = ? AND id = ?').get(slug, id);
  return row?.pages ? JSON.parse(row.pages) : null;
}

export function setPages(slug, id, pages) {
  database().prepare('UPDATE chapters SET pages = ? WHERE course = ? AND id = ?').run(JSON.stringify(pages), slug, id);
}

export function deleteCourse(slug) {
  const removed = database().prepare('DELETE FROM courses WHERE slug = ?').run(slug).changes > 0;
  if (removed && /^[a-z0-9-]+$/.test(slug)) rmSync(join(filesDir, slug), { recursive: true, force: true });
  return removed;
}

export function getChapter(slug, id) {
  const row = database().prepare('SELECT * FROM chapters WHERE course = ? AND id = ?').get(slug, id);
  return row ? chapterRow(row, true) : null;
}

export function addChapter(slug, { title, sourceFile }) {
  const store = database();
  const number = (store.prepare('SELECT MAX(number) AS n FROM chapters WHERE course = ?').get(slug).n ?? 0) + 1;
  const id = `${slug}-ch${number}-${Date.now().toString(36)}`;
  const now = Date.now();
  store
    .prepare(
      `INSERT INTO chapters (id, course, number, title, source_file, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'parsing', ?, ?)`
    )
    .run(id, slug, number, title, sourceFile, now, now);
  return getChapter(slug, id);
}

export function updateChapter(slug, id, values) {
  const columns = {
    title: 'title',
    summary: 'summary',
    status: 'status',
    error: 'error',
    sourceFile: 'source_file',
    note: 'note',
    pages: 'pages'
  };
  const keys = Object.keys(values).filter((key) => key in columns);
  const sql = keys.map((key) => `${columns[key]} = ?`).join(', ');
  const params = keys.map((key) =>
    ['note', 'pages'].includes(key) && values[key] ? JSON.stringify(values[key]) : (values[key] ?? null)
  );
  database()
    .prepare(`UPDATE chapters SET ${sql}, updated_at = ? WHERE course = ? AND id = ?`)
    .run(...params, Date.now(), slug, id);
  return getChapter(slug, id);
}

// A worked solution made for one stop is kept in the note, so it is made only once.
export function setStopSolution(slug, id, stopId, solution) {
  const row = database().prepare('SELECT note FROM chapters WHERE course = ? AND id = ?').get(slug, id);
  const note = row?.note ? JSON.parse(row.note) : null;
  const stop = note?.segments.find((segment) => segment.type === 'stop' && segment.id === stopId);
  if (!stop) return;
  stop.solution = solution;
  database().prepare('UPDATE chapters SET note = ? WHERE course = ? AND id = ?').run(JSON.stringify(note), slug, id);
}

export function deleteChapter(slug, id) {
  return database().prepare('DELETE FROM chapters WHERE course = ? AND id = ?').run(slug, id).changes > 0;
}
