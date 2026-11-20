import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { MAX_UPLOAD, RequestError, readBody, readRaw, send } from './http.js';
import { generateQuestions, readStruggles } from './student/questions.js';
import {
  addChapter,
  clearProgress,
  createCourse,
  database,
  deleteChapter,
  deleteCourse,
  filesDir,
  getChapter,
  getCourse,
  getPages,
  listCourses,
  listQuestions,
  renumberChapter,
  replaceQuestions,
  saveProgress,
  setPages,
  updateChapter,
  updateCourse
} from './store.js';
import { acceptedTypes, pageTexts, parseChapter } from './teacher/parse.js';

// Upload names keep their readable part and never leave the course's folder.
function storedName(slug, original) {
  const ext = extname(original).toLowerCase();
  const stem =
    basename(original, extname(original))
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'attachment';
  let name = `${stem}${ext}`;
  for (let n = 2; existsSync(join(filesDir, slug, name)); n++) name = `${stem}-${n}${ext}`;
  return name;
}

// Page texts are read once per attachment; a failure only means 问老师 has no evidence for this chapter.
export async function chapterPages(slug, chapter) {
  const stored = getPages(slug, chapter.id);
  if (stored || !chapter.source) return stored ?? [];
  const pages = await pageTexts(join(filesDir, slug, chapter.source), chapter.source).catch(() => null);
  if (pages) setPages(slug, chapter.id, pages);
  return pages ?? [];
}

function startParse(client, slug, chapter, titleHint) {
  const path = join(filesDir, slug, chapter.source);
  parseChapter(client, { path, file: chapter.source, chapterId: chapter.id, titleHint })
    .then(async (note) => {
      const pages = await pageTexts(path, chapter.source).catch(() => null);
      // A new note has new stops; answers to the old ones no longer fit.
      clearProgress(chapter.id, 'note');
      updateChapter(slug, chapter.id, {
        status: 'ready',
        error: null,
        title: titleHint || note.title,
        summary: note.summary,
        note: { title: note.title, segments: note.segments },
        pages
      });
    })
    .catch((error) =>
      updateChapter(slug, chapter.id, {
        status: 'failed',
        error: error instanceof RequestError ? error.message : `解析失败：${error.message}`
      })
    );
}

async function courseFields(req) {
  const body = await readBody(req);
  const field = (key, max) => (typeof body?.[key] === 'string' ? body[key].trim().slice(0, max) : '');
  const name = field('name', 60);
  if (!name) throw new RequestError(400, '请填写课程名称。');
  return {
    name,
    code: field('code', 20),
    term: field('term', 30),
    teacher: field('teacher', 40),
    description: field('description', 400)
  };
}

export async function library(req, res, client, parts) {
  const [, slug, section, chapterId, action, kind] = parts;
  if (!slug) {
    if (req.method === 'GET') return send(res, 200, { courses: listCourses() });
    if (req.method !== 'POST') throw new RequestError(405, '请求方法不支持。');
    return send(res, 201, { course: createCourse(await courseFields(req)) });
  }
  const course = getCourse(slug);
  if (!course) throw new RequestError(404, '没有这门课。');
  if (!section && req.method === 'GET') return send(res, 200, { course });
  if (!section && req.method === 'PATCH')
    return send(res, 200, { course: updateCourse(slug, await courseFields(req)) });
  if (!section && req.method === 'DELETE') {
    if (course.chapters.some((chapter) => chapter.status === 'parsing'))
      throw new RequestError(409, '老师还在读课件，等解析结束再删除这门课。');
    deleteCourse(slug);
    return send(res, 200, { deleted: slug });
  }
  if (section === 'questions' && req.method === 'GET') return send(res, 200, { questions: listQuestions(slug) });
  if (section !== 'chapters') throw new RequestError(404, '没有这个接口。');

  if (!chapterId && req.method === 'POST') {
    const original = decodeURIComponent(req.headers['x-filename'] ?? '');
    if (!acceptedTypes.includes(extname(original).toLowerCase())) {
      throw new RequestError(415, `只支持 ${acceptedTypes.join('、')} 附件。`);
    }
    if (!client.key) throw new RequestError(503, '请在项目的 .env.local 设置 OPENROUTER_API_KEY，然后重启服务。');
    const bytes = await readRaw(req, MAX_UPLOAD, '附件超过 40 MB。');
    if (!bytes.length) throw new RequestError(400, '附件是空的。');
    const name = storedName(slug, original);
    mkdirSync(join(filesDir, slug), { recursive: true });
    writeFileSync(join(filesDir, slug, name), bytes);
    const titleHint = decodeURIComponent(req.headers['x-title'] ?? '')
      .trim()
      .slice(0, 60);
    // An upload either fills an existing chapter that has no note yet or starts a new one.
    const target = req.headers['x-chapter'] ? getChapter(slug, decodeURIComponent(req.headers['x-chapter'])) : null;
    if (target && !['empty', 'failed'].includes(target.status))
      throw new RequestError(409, '这一章已经有笔记或正在解析。');
    const chapter = target
      ? updateChapter(slug, target.id, { sourceFile: name, status: 'parsing', error: null })
      : addChapter(slug, { title: titleHint || basename(original, extname(original)), sourceFile: name });
    startParse(client, slug, chapter, target ? target.title : titleHint);
    return send(res, 202, { chapter });
  }

  const chapter = chapterId && getChapter(slug, chapterId);
  if (!chapter) throw new RequestError(404, '没有这一章。');
  if (action === 'parse' && req.method === 'POST') {
    if (!chapter.source || !existsSync(join(filesDir, slug, chapter.source)))
      throw new RequestError(409, '这一章没有可读的课件。');
    if (chapter.status === 'parsing') return send(res, 202, { chapter });
    if (!client.key) throw new RequestError(503, '请在项目的 .env.local 设置 OPENROUTER_API_KEY，然后重启服务。');
    const started = updateChapter(slug, chapter.id, { status: 'parsing', error: null });
    // A title that is only the file name is a placeholder; any other title was chosen and stays.
    const placeholder = chapter.title === basename(chapter.source, extname(chapter.source));
    startParse(client, slug, started, placeholder ? '' : chapter.title);
    return send(res, 202, { chapter: started });
  }
  if (action === 'questions' && req.method === 'POST') {
    if (chapter.status !== 'ready') throw new RequestError(409, '这一章的笔记还没写好，学生无从提问。');
    if (!client.key) throw new RequestError(503, '请在项目的 .env.local 设置 OPENROUTER_API_KEY，然后重启服务。');
    const body = await readBody(req);
    const pages = await chapterPages(slug, chapter);
    const questions = await generateQuestions(client, {
      chapter,
      struggles: readStruggles(body, chapter),
      pageCount: pages.length
    });
    replaceQuestions(slug, chapter.id, questions);
    return send(res, 201, { questions: listQuestions(slug) });
  }
  if (action === 'progress' && req.method === 'PUT') {
    if (kind !== 'note' && kind !== 'teach') throw new RequestError(404, '没有这个接口。');
    const body = await readBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, '请求格式有误。');
    saveProgress(chapter.id, kind, JSON.stringify(body));
    return send(res, 200, { saved: true });
  }
  if (!action && req.method === 'PATCH') {
    const number = (await readBody(req))?.number;
    if (!Number.isInteger(number) || number < 1 || number > 99)
      throw new RequestError(400, '章号应是 1 到 99 的整数。');
    return send(res, 200, { chapter: renumberChapter(slug, chapter.id, number) });
  }
  if (!action && req.method === 'DELETE') {
    deleteChapter(slug, chapter.id);
    const others = database()
      .prepare('SELECT COUNT(*) AS n FROM chapters WHERE course = ? AND source_file = ?')
      .get(slug, chapter.source ?? '');
    if (chapter.source && !others.n) {
      try {
        unlinkSync(join(filesDir, slug, chapter.source));
      } catch {}
    }
    return send(res, 200, { deleted: chapter.id });
  }
  throw new RequestError(405, '请求方法不支持。');
}
