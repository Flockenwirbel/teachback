import { RequestError } from '../http.js';

const types = ['概念', '推导', '辨析', '改条件'];

const questionFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'student_questions',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              questionType: { type: 'string', enum: types },
              prompt: { type: 'string' },
              reference: { type: 'string' },
              pages: { type: 'array', items: { type: 'integer' } },
              fromStruggle: { type: 'boolean' }
            },
            required: ['title', 'questionType', 'prompt', 'reference', 'pages', 'fromStruggle'],
            additionalProperties: false
          }
        }
      },
      required: ['questions'],
      additionalProperties: false
    }
  }
};

const instructions =
  '你扮演一个刚学完这一章基础的学生，要为学习者准备一组请教问题。学习者会逐个给你讲清楚，你据此判断他是否真的懂了。\n' +
  '要求：\n' +
  '- 只依据下面的章节笔记（老师写的正文、停顿问题与参考答案），不得超出笔记内容。\n' +
  '- 问题数量不固定，由章节内容决定：全章每一节讲的内容、每个停顿涉及的内容，都至少有一个问题问到；章节越长，问题越多。\n' +
  '- questionType 取：概念（追问一个核心概念为什么这样定义、它在回答什么问题）、推导（一道带具体数字或符号的一步计算或推导，给足所需条件）、辨析（两种方法或概念的区别）、改条件（改变一个条件，问结论怎样变）。四种都至少出现一次，其余按内容需要分配；问题按章节内容的先后排列。\n' +
  '- prompt 用学生第一人称，口语化，每个问题都带着一个真实初学者会有的具体误解或困惑，但不要说出正确答案。\n' +
  '- 若给出了「学习者卡过的地方」，每一处另外至少出一个问题，让学生带着学习者在对话里写过的错误想法、老师记下的错误来问，并把 fromStruggle 设为 true。这些问题是在覆盖全章的问题之外加的，不能挤掉其他内容；其余问题为 false。\n' +
  '- 不要照抄笔记里的停顿问题，换角度、换例子、换数字。\n' +
  '- title 不超过 12 字。reference 写一段讲清楚这个问题必须包含的要点和正确结论，供判定使用。\n' +
  '- pages 填与问题相关的附件页码，只能取自笔记停顿标注的页码；没有则为空数组。\n' +
  '- 简体中文，术语保留英文原文。数学式行内写 \\(…\\)，独立公式写 \\[…\\]，不要用 $。';

function toDelimiters(text) {
  return text.replace(/\$\$([\s\S]+?)\$\$/g, '\\[$1\\]').replace(/\$((?:\\.|[^\n$])+?)\$/g, '\\($1\\)');
}

function shape(reply, { chapter, pageCount, allowedPages, batch }) {
  let draft;
  try {
    draft = JSON.parse(reply);
  } catch {
    return { error: '输出不是合法 JSON' };
  }
  const questions = draft?.questions ?? [];
  const problems = [];
  const missing = types.filter((type) => !questions.some((question) => question.questionType === type));
  if (missing.length) problems.push(`缺少「${missing.join('」「')}」类型的问题`);
  questions.forEach((question, index) => {
    if (!question.prompt?.trim() || !question.reference?.trim() || !question.title?.trim())
      problems.push(`第 ${index + 1} 个问题缺少内容`);
  });
  if (problems.length) return { error: problems.join('；') };
  return {
    value: questions.map((question, index) => {
      const pages = [...new Set(question.pages)]
        .filter((page) => allowedPages.has(page) && (!pageCount || page <= pageCount))
        .slice(0, 4);
      return {
        id: `${chapter.id}-q${index + 1}-${batch}`,
        number: `${chapter.number}.${index + 1}`,
        title: question.title.trim(),
        chapter: chapter.number,
        chapterId: chapter.id,
        unit: chapter.title,
        assignment: '学生提问',
        kind: '习题',
        questionType: question.questionType,
        prompt: toDelimiters(question.prompt.trim()),
        reference: toDelimiters(question.reference.trim()),
        pages,
        fromStruggle: question.fromStruggle,
        canAskTeacher: pages.length > 0 && pageCount > 0,
        ...(pages.length && chapter.source
          ? { slideFile: `${chapter.source}#page=${pages[0]}`, sourceLabel: `课件第 ${pages[0]} 页` }
          : {})
      };
    })
  };
}

// struggles: the stops where the learner needed follow-ups in the teacher's note, sent from the browser.
export async function generateQuestions(client, { chapter, struggles, pageCount }) {
  const note = chapter.segments
    .map((segment) =>
      segment.type === 'text'
        ? segment.md
        : `【停顿：${segment.label}${segment.slide ? `（第 ${segment.slide.page} 页）` : ''}】\n问：${segment.ask}\n参考答案：${segment.reference}`
    )
    .join('\n\n');
  const allowedPages = new Set(
    chapter.segments.filter((segment) => segment.slide).map((segment) => segment.slide.page)
  );
  const messages = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: JSON.stringify({
        章节: chapter.title,
        章节笔记: note,
        学习者卡过的地方: struggles.map((entry) => ({
          停顿: entry.label,
          问题: entry.ask,
          试了几次才答对: entry.rounds,
          学习者在对话里写的: entry.said,
          老师记下的错误: entry.errors,
          老师最后的判断: entry.plan,
          最后答对的写法: entry.final
        }))
      })
    }
  ];
  const batch = Date.now().toString(36);
  const options = { maxTokens: 16000, effort: 'medium', timeout: 300_000 };
  let reply = await client.complete(messages, questionFormat, options);
  let shaped = shape(reply, { chapter, pageCount, allowedPages, batch });
  for (let attempt = 1; shaped.error && attempt < 3; attempt++) {
    reply = await client.complete(
      [
        ...messages,
        { role: 'assistant', content: reply },
        { role: 'user', content: `上一版不合格：${shaped.error}。按要求重写。` }
      ],
      questionFormat,
      options
    );
    shaped = shape(reply, { chapter, pageCount, allowedPages, batch });
  }
  if (shaped.error) throw new RequestError(502, `学生准备的问题没有通过检查：${shaped.error}`);
  return shaped.value;
}

export function readStruggles(body, chapter) {
  const stops = new Map(
    chapter.segments.filter((segment) => segment.type === 'stop').map((segment) => [segment.id, segment])
  );
  if (!Array.isArray(body?.struggles)) return [];
  return body.struggles.slice(0, 12).flatMap((entry) => {
    const stop = stops.get(entry?.stopId);
    if (!stop) return [];
    const text = (value) => (typeof value === 'string' ? value.slice(0, 1500) : '');
    return [
      {
        label: stop.label,
        ask: stop.ask,
        rounds: Number(entry.rounds) || 1,
        said: Array.isArray(entry.said) ? entry.said.slice(-12).map(text) : [],
        errors: Array.isArray(entry.errors) ? entry.errors.slice(0, 8).map(text) : [],
        plan: text(entry.plan),
        final: text(entry.final)
      }
    ];
  });
}
