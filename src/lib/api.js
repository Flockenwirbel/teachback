import { adopt, flushProgress } from './progress.js';

async function call(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('无法连接本地服务，请确认它正在运行。');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）。`);
  return body;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

export const api = {
  courses: () =>
    flushProgress()
      .then(() => call('./api/courses'))
      .then((body) => Promise.all(body.courses.map(adopt))),
  course: (slug) =>
    flushProgress()
      .then(() => call(`./api/courses/${slug}`))
      .then((body) => adopt(body.course)),
  saveProgress: (slug, chapterId, kind, body, keepalive = false) =>
    call(`./api/courses/${slug}/chapters/${chapterId}/progress/${kind}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: keepalive && body.length < 60_000
    }),
  activity: () => flushProgress().then(() => call('./api/activity')),
  propose: (file) =>
    call('./api/propose', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(file.name) },
      body: file
    }),
  questions: (slug) => call(`./api/courses/${slug}/questions`).then((body) => body.questions),
  generateQuestions: (slug, chapterId, struggles) =>
    call(`./api/courses/${slug}/chapters/${chapterId}/questions`, json('POST', { struggles })).then(
      (body) => body.questions
    ),
  deleteCourse: (slug) => call(`./api/courses/${slug}`, { method: 'DELETE' }),
  updateCourse: (slug, fields) => call(`./api/courses/${slug}`, json('PATCH', fields)).then((body) => body.course),
  createCourse: (fields) => call('./api/courses', json('POST', fields)).then((body) => body.course),
  upload: (slug, file, { title = '', chapterId = '' } = {}) =>
    call(`./api/courses/${slug}/chapters`, {
      method: 'POST',
      headers: {
        'X-Filename': encodeURIComponent(file.name),
        'X-Title': encodeURIComponent(title),
        ...(chapterId ? { 'X-Chapter': encodeURIComponent(chapterId) } : {})
      },
      body: file
    }).then((body) => body.chapter),
  parse: (slug, id) =>
    call(`./api/courses/${slug}/chapters/${id}/parse`, { method: 'POST' }).then((body) => body.chapter),
  removeChapter: (slug, id) => call(`./api/courses/${slug}/chapters/${id}`, { method: 'DELETE' })
};
