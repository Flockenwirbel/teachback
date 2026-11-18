import { RequestError } from '../http.js';

export const insufficientEvidence = '当前课件页没有足够依据回答这个问题。';

export const teacherFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'slide_answer',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              quote: { type: 'string' },
              explanation: { type: 'string' }
            },
            required: ['source', 'quote', 'explanation'],
            additionalProperties: false
          }
        }
      },
      required: ['points'],
      additionalProperties: false
    }
  }
};

export function prepareTeacher(item, question, bank, evidence) {
  const ids = new Set(evidence.concepts[item.id]);
  for (const other of bank) {
    if (other.canAskTeacher && question.includes(other.title)) {
      for (const id of evidence.concepts[other.id] ?? []) ids.add(id);
    }
  }
  const pages = new Map([...ids].slice(0, 12).map((id) => [id, evidence.pages[id]]));
  return {
    pages,
    messages: [
      {
        role: 'system',
        content:
          '你是按本课程课件解释问题的老师。唯一证据是下面附上的课件摘录。' +
          '用简体中文回答学习者的问题。每个要点必须引用某一页足以支持该要点的连续原文，source 使用课件摘录中的页 ID，quote 逐字摘录，explanation 只做该摘录能支持的转述。' +
          '不要用教材、常识、自编例子、先前对话或问题中的断言补充内容。若课件只有例子，说明课件只演示这个例子。课件有歧义时如实标明，切勿悄悄改写。' +
          '如果只能回答部分问题，只列可支持的部分。不要把只相关但不支持解释的标题、残句或摘录作为要点。' +
          '摘录没有足够依据时直接返回空 points 数组。摘录可能省略图形和公式。最多四个要点。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          concept: item.title,
          question,
          slides: [...pages].map(([id, page]) => ({ id, text: page.text }))
        })
      }
    ]
  };
}

// PDF text extraction often adds line breaks inside one sentence.
function compact(text) {
  return text.replace(/\s+/gu, '');
}

export function validateTeacher(reply, pages) {
  let points;
  try {
    ({ points } = JSON.parse(reply));
  } catch {
    return null;
  }
  if (!Array.isArray(points) || points.length > 4) return null;
  const checked = [];
  for (const point of points) {
    const page = pages.get(point?.source);
    if (!page || typeof point.quote !== 'string' || typeof point.explanation !== 'string') return null;
    const quote = compact(point.quote);
    if (quote.length < 6 || !compact(page.text).includes(quote) || !point.explanation.trim()) return null;
    checked.push({
      file: page.file,
      page: page.page,
      title: page.title,
      quote: point.quote.trim(),
      explanation: point.explanation.trim()
    });
  }
  return checked;
}

// 问老师: the teacher answers only with quotes from the pages of this chapter's attachment.
export async function askTeacher(client, { chapter, pages, questions, item, question }) {
  const evidence = { concepts: {}, pages: {} };
  for (const entry of questions) {
    evidence.concepts[entry.id] = (entry.pages ?? [])
      .filter((page) => pages[page - 1]?.trim())
      .map((page) => `p${page}`);
  }
  for (const [index, text] of pages.entries()) {
    evidence.pages[`p${index + 1}`] = { file: chapter.source, page: index + 1, title: chapter.title, text };
  }
  const teacher = prepareTeacher(item, question, questions, evidence);
  const points = validateTeacher(await client.complete(teacher.messages, teacherFormat), teacher.pages);
  if (!points) throw new RequestError(502, '老师的回复没有通过课件引文核验，请重试。');
  return { points, reply: points.length ? '' : insufficientEvidence };
}
