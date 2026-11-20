import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { MAX_UPLOAD, RequestError, readRaw } from './http.js';
import { getCourse, listCourses, listQuestions } from './store.js';
import { acceptedTypes, pageTexts } from './teacher/parse.js';

const order = { parsing: 0, failed: 1, note: 2, review: 3, ask: 4 };

// What the course hall's sidebar talks about: what is waiting in each course, and what the learner did lately.
export function activity(now = Date.now()) {
  const waiting = [];
  const history = [];
  for (const { slug } of listCourses()) {
    const course = getCourse(slug);
    const questions = listQuestions(slug);
    const teach = Object.assign({}, ...Object.values(course.progress.teach));
    const base = { slug, course: course.name };
    for (const chapter of course.chapters) {
      const at = { ...base, chapterId: chapter.id, number: chapter.number, title: chapter.title };
      if (chapter.status === 'parsing') waiting.push({ type: 'parsing', ...at });
      if (chapter.status === 'failed' && chapter.source) waiting.push({ type: 'failed', ...at, error: chapter.error });
      if (chapter.status !== 'ready') continue;

      const sheet = course.progress.note[chapter.id];
      const answers = Object.entries(sheet?.answers ?? {});
      const finished = chapter.stops > 0 && answers.length >= chapter.stops;
      const asked = questions.filter((question) => question.chapterId === chapter.id);
      if (sheet?.pos && !finished)
        waiting.push({ type: 'note', ...at, left: chapter.stops - answers.length, time: sheet.updatedAt ?? 0 });
      if (finished && !asked.length) waiting.push({ type: 'ask', ...at });
      const due = asked.filter((question) => {
        const record = teach[question.id];
        return record?.reviewAt != null && record.reviewAt <= now && !record.passed;
      });
      if (due.length) waiting.push({ type: 'review', ...at, count: due.length });

      if (finished) {
        const time = Math.max(...answers.map(([, answer]) => answer.at ?? 0));
        if (time) history.push({ type: 'finished', ...at, time });
      } else if (answers.length) {
        const [stopId, answer] = answers.reduce((last, entry) =>
          (entry[1].at ?? 0) > (last[1].at ?? 0) ? entry : last
        );
        const label = chapter.segments?.find((segment) => segment.id === stopId)?.label;
        if (answer.at) history.push({ type: 'answered', ...at, label, rounds: answer.rounds, time: answer.at });
      }
      for (const question of asked) {
        const record = teach[question.id];
        if (record?.passed && record.passedAt)
          history.push({ type: 'taught', ...at, question: question.title, time: record.passedAt });
      }
    }
  }
  waiting.sort((a, b) => order[a.type] - order[b.type] || (b.time ?? 0) - (a.time ?? 0));
  history.sort((a, b) => b.time - a.time);
  return { waiting, history: history.slice(0, 6) };
}

const proposalFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'course_proposal',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        code: { type: 'string' },
        term: { type: 'string' },
        teacher: { type: 'string' },
        description: { type: 'string' },
        chapterTitle: { type: 'string' }
      },
      required: ['name', 'code', 'term', 'teacher', 'description', 'chapterTitle'],
      additionalProperties: false
    }
  }
};

const instructions =
  '你是一位老师，学生把一份课件交给你，想为它开一门课。根据课件开头的文字，提出这门课的信息，用 JSON 回答：\n' +
  '- name：课程名称，用课件的语言，不超过 20 字。\n' +
  '- code：课程简称或课号，如 GT、CS188；看不出就给一个 2 到 6 个字母的英文缩写。\n' +
  '- term：学期，如「2026 秋」；课件里看不出就留空。\n' +
  '- teacher：任课教师姓名；看不出就留空。\n' +
  '- description：一句话说这门课讲什么，不超过 60 字。\n' +
  '- chapterTitle：这份课件作为第一章的标题，不超过 20 字。\n' +
  '只依据课件内容，不要编造教师或学期。';

// Skims the opening of an attachment and proposes a course for it; the file itself is uploaded once confirmed.
export async function proposeCourse(client, req) {
  const original = decodeURIComponent(req.headers['x-filename'] ?? '');
  const ext = extname(original).toLowerCase();
  if (!acceptedTypes.includes(ext)) throw new RequestError(415, `只支持 ${acceptedTypes.join('、')} 附件。`);
  if (!client.key) throw new RequestError(503, '请在项目的 .env.local 设置 LLM_API_KEY，然后重启服务。');
  const bytes = await readRaw(req, MAX_UPLOAD, '附件超过 40 MB。');
  if (!bytes.length) throw new RequestError(400, '附件是空的。');

  let text;
  if (ext === '.pdf' || ext === '.pptx') {
    const dir = mkdtempSync(join(tmpdir(), 'teachback-'));
    try {
      const path = join(dir, `attachment${ext}`);
      writeFileSync(path, bytes);
      text = ((await pageTexts(path, original).catch(() => null)) ?? []).slice(0, 4).join('\n\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    text = bytes.toString('utf8');
    if (ext === '.html' || ext === '.htm')
      text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ');
  }
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, 6000);

  const reply = await client.complete(
    [
      { role: 'system', content: instructions },
      { role: 'user', content: `文件名：${original}\n\n课件开头：\n\n${text || '（没有读到文字）'}` }
    ],
    proposalFormat,
    { maxTokens: 600 }
  );
  let proposal;
  try {
    proposal = JSON.parse(reply);
  } catch {
    throw new RequestError(502, '老师没看明白这份课件，请重试。');
  }
  const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  return {
    name: clip(proposal.name, 60) || original.replace(/\.[^.]+$/, '').slice(0, 60),
    code: clip(proposal.code, 20),
    term: clip(proposal.term, 30),
    teacher: clip(proposal.teacher, 40),
    description: clip(proposal.description, 400),
    chapterTitle: clip(proposal.chapterTitle, 60)
  };
}
