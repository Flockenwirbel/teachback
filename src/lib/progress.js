import { api } from './api.js';

// Progress lives in the database. This module keeps the session's copy, so every page reads the latest answers
// at once, and sends each chapter's changes a moment after the learner stops writing.
const courses = new Map();
const sent = new Map();
const pending = new Map();
let queue = Promise.resolve();

const prefsKey = (course) => `teachback:${course.storageId}:prefs`;
const legacyNotesKey = (course) => `teachback:${course.storageId}:notes:v1`;
const legacyTeachKey = (course) => `teachback:${course.storageId}:v1`;

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// Small per-browser conveniences: typing speed, the question last open.
export const prefs = (course) => readLocal(prefsKey(course)) ?? {};
export const setPrefs = (course, values) => writeLocal(prefsKey(course), { ...prefs(course), ...values });

export function notesOf(course) {
  return courses.get(course.slug)?.note ?? {};
}

export function teachOf(course) {
  return Object.assign({}, ...Object.values(courses.get(course.slug)?.teach ?? {}));
}

// Take the progress a course arrived with as the session's copy.
export async function adopt(course) {
  const progress = course.progress ?? { note: {}, teach: {} };
  courses.set(course.slug, progress);
  for (const kind of ['note', 'teach'])
    for (const [chapterId, data] of Object.entries(progress[kind]))
      sent.set(`${course.slug}/${chapterId}/${kind}`, JSON.stringify(data));
  await importLegacy(course, progress);
  return course;
}

// Progress used to stay in the browser; carry it into the database once, then drop the browser copy.
async function importLegacy(course, progress) {
  const notes = readLocal(legacyNotesKey(course));
  const teach = readLocal(legacyTeachKey(course));
  if (!notes && !teach) return;
  const known = (id) => course.chapters.some((chapter) => chapter.id === id);
  const uploads = [];
  for (const [chapterId, sheet] of Object.entries(notes?.notes ?? {}))
    if (known(chapterId) && !progress.note[chapterId]) uploads.push(['note', chapterId, sheet]);
  const groups = {};
  for (const [questionId, record] of Object.entries(teach?.records ?? {})) {
    const chapter = course.chapters.find((entry) => questionId.startsWith(`${entry.id}-q`));
    if (chapter && !progress.teach[chapter.id]) (groups[chapter.id] ??= {})[questionId] = record;
  }
  for (const [chapterId, records] of Object.entries(groups)) uploads.push(['teach', chapterId, records]);
  try {
    for (const [kind, chapterId, data] of uploads) {
      await api.saveProgress(course.slug, chapterId, kind, JSON.stringify(data));
      progress[kind][chapterId] = data;
      sent.set(`${course.slug}/${chapterId}/${kind}`, JSON.stringify(data));
    }
  } catch {
    return;
  }
  setPrefs(course, {
    ...(notes?.speed != null ? { speed: notes.speed } : {}),
    ...(teach?.selected ? { selected: teach.selected } : {})
  });
  writeLocal(legacyNotesKey(course), null);
  writeLocal(legacyTeachKey(course), null);
}

export function saveProgress(course, kind, chapterId, data, onError) {
  const body = JSON.stringify(data);
  const key = `${course.slug}/${chapterId}/${kind}`;
  const progress = courses.get(course.slug);
  if (progress) progress[kind][chapterId] = JSON.parse(body);
  clearTimeout(pending.get(key)?.timer);
  if (sent.get(key) === body) return pending.delete(key);
  const send = (keepalive = false) => {
    pending.delete(key);
    queue = queue
      .then(() => api.saveProgress(course.slug, chapterId, kind, body, keepalive))
      .then(
        () => sent.set(key, body),
        (error) => onError?.(error)
      );
  };
  pending.set(key, { timer: setTimeout(send, 500), send });
}

// Send whatever is still waiting; pages that fetch a course wait for this first.
export function flushProgress(keepalive = false) {
  for (const { timer, send } of [...pending.values()]) {
    clearTimeout(timer);
    send(keepalive);
  }
  return queue;
}

if (typeof addEventListener === 'function') addEventListener('pagehide', () => flushProgress(true));

// The stops of a chapter where the learner needed the teacher's follow-ups, with what they wrote on the way.
export function strugglesFor(course, chapter) {
  const answers = notesOf(course)[chapter.id]?.answers ?? {};
  return Object.entries(answers)
    .filter(([, answer]) => answer.rounds > 1)
    .map(([stopId, answer]) => ({
      stopId,
      rounds: answer.rounds,
      wrong: (answer.thread ?? [])
        .filter((turn) => turn.who === 'me' && turn.target === 'main')
        .map((turn) => turn.text),
      final: answer.text
    }));
}

export function forgetCourse(course) {
  courses.delete(course.slug);
  writeLocal(prefsKey(course), null);
  writeLocal(legacyNotesKey(course), null);
  writeLocal(legacyTeachKey(course), null);
}
