import { activity, proposeCourse } from './hall.js';
import { RequestError, readBody, send, serveFile } from './http.js';
import { chapterPages, library } from './library.js';
import { createClient, defaultBaseUrl, defaultModel } from './openrouter.js';
import { getChapter, getCourse, listQuestions, setStopSolution } from './store.js';
import { gradeExplanation } from './student/grade.js';
import { askTeacher } from './teacher/ask.js';
import { followUp } from './teacher/guide.js';

export { defaultModel };

// Worked solutions for derivation stops are made once per stop, so a stronger model is affordable there.
const solverModel = 'anthropic/claude-sonnet-5.5';

// /api/courses manages courses and chapters, /api/activity and /api/propose feed the hall's sidebar, /api/coach runs one model turn, /files serves attachments.
export function apiMiddleware({
  key,
  baseUrl = defaultBaseUrl,
  model = defaultModel,
  parseModel,
  // The default solver is an OpenRouter model name; other providers use the main model unless one is set.
  solveModel = baseUrl === defaultBaseUrl ? solverModel : model,
  fetcher = fetch
}) {
  const client = createClient({ key, baseUrl, model, fetcher });
  const solver = createClient({ key, baseUrl, model: solveModel, fetcher });
  const reader = createClient({ key, baseUrl, model: parseModel || model, fetcher });
  return async (req, res, next) => {
    const path = req.url?.split('?')[0] ?? '';
    const isFile = path.startsWith('/files/');
    const isHall = path === '/api/activity' || path === '/api/propose';
    if (path !== '/api/coach' && !path.startsWith('/api/courses') && !isFile && !isHall) return next();
    const origin = req.headers.origin;
    const host = req.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host) || (origin && origin !== `http://${host}`)) {
      return send(res, 403, { error: '请从本地页面发起请求。' });
    }
    try {
      if (isFile) return serveFile(req, res, path.slice('/files/'.length).split('/'));
      if (path === '/api/activity' && req.method === 'GET') return send(res, 200, activity());
      if (path === '/api/propose' && req.method === 'POST') return send(res, 200, await proposeCourse(reader, req));
      if (isHall) return send(res, 405, { error: '请求方法不支持。' });
      if (path.startsWith('/api/courses'))
        return await library(req, res, reader, path.slice('/api'.length).split('/').filter(Boolean));
      if (req.method !== 'POST') return send(res, 405, { error: '请使用 POST。' });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
        return send(res, 403, { error: '请从本地页面发起请求。' });
      }
      if (!key) return send(res, 503, { error: '请在项目的 .env.local 设置 LLM_API_KEY，然后重启服务。' });
      const body = await readBody(req);
      if (!body || typeof body !== 'object') throw new RequestError(400, '请求格式有误。');
      const course = getCourse(body.course);
      if (!course) throw new RequestError(400, '没有这门课。');

      if (body.stage === 'guide') {
        const chapter = getChapter(course.slug, body.chapterId);
        const save = (stopId, solution) => setStopSolution(course.slug, body.chapterId, stopId, solution);
        return send(res, 200, await followUp(client, chapter?.segments, body, { solver, save }));
      }
      const bank = listQuestions(course.slug);
      if (body.stage === 'teacher') {
        const item = bank.find((row) => row.id === body.id && row.canAskTeacher);
        const question = typeof body.answer === 'string' ? body.answer.trim() : '';
        if (!item || !question || question.length > 2000) {
          throw new RequestError(400, '请选择关联课件的问题并输入问题，最多 2000 字符。');
        }
        const chapter = getChapter(course.slug, item.chapterId);
        const pages = chapter ? await chapterPages(course.slug, chapter) : [];
        const questions = bank.filter((row) => row.chapterId === item.chapterId);
        return send(res, 200, await askTeacher(client, { chapter, pages, questions, item, question }));
      }
      send(res, 200, await gradeExplanation(client, bank, body));
    } catch (error) {
      if (error instanceof RequestError) return send(res, error.status, { error: error.message });
      if (error?.name === 'TimeoutError') return send(res, 504, { error: '连接模型服务超时，请稍后重试。' });
      console.error(error);
      send(res, 502, { error: '连接模型服务失败，请稍后重试。' });
    }
  };
}
