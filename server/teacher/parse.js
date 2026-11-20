import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { RequestError } from '../http.js';

const run = promisify(execFile);

export const acceptedTypes = ['.pdf', '.pptx', '.md', '.markdown', '.txt', '.html', '.htm'];

const kinds = ['concept', 'derive', 'contrast'];

const chapterFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'chapter_note',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['text', 'stop'] },
              md: { type: 'string' },
              kind: { type: 'string', enum: ['', ...kinds] },
              label: { type: 'string' },
              ask: { type: 'string' },
              keyPoints: { type: 'array', items: { type: 'string' } },
              reference: { type: 'string' },
              page: { type: 'integer' }
            },
            required: ['type', 'md', 'kind', 'label', 'ask', 'keyPoints', 'reference', 'page'],
            additionalProperties: false
          }
        }
      },
      required: ['title', 'summary', 'segments'],
      additionalProperties: false
    }
  }
};

const instructions =
  '你是这门课的老师，要根据附件为一章写一篇「带停顿的课程笔记」。学生看着你逐字写出笔记；写到关键处你停下来，让学生自己写出这一处，学生答对后你接着写。\n' +
  '要求：\n' +
  '- 只依据附件内容，附件没有讲的不要补充。按附件的讲解顺序组织。\n' +
  '- title 是本章的简短标题；summary 用一句话概括本章内容，不超过 40 字。\n' +
  '- segments 中 text 与 stop 交替出现：第一段和最后一段都是 text，不能连续出现两个 stop。\n' +
  '- text：md 写 Markdown 正文，像老师讲课一样交代动机、定义、推导和例子，语言平实、书面，可用 ## 小标题，每段 80 到 400 字。其余字段留空，page 填 0。\n' +
  '- stop：放在真正的关键点，kind 为 concept（概念澄清）、derive（公式推导或计算）或 contrast（方法辨析）。全篇 4 到 8 个 stop，覆盖本章最重要的知识点。md 留空。\n' +
  '  - ask：一个具体、几句话能答完的问题；推导和计算题要给足所需条件。用平实的书面语，不用口语俗语和夸张说法（如「吃大亏」）。\n' +
  '  - label：6 到 12 字的小标题。\n' +
  '  - keyPoints：2 到 3 条判定答对必须覆盖的要点，每条一句，只写回答这个问题必需的核心论断或核心机制的一步。由它直接推出的后果、数量级、增长速度等不写进要点（除非 ask 直接问它），放进 reference。ask 里已经给出的前提、定义或设定不写进要点。derive 的要点写成关键的方法或步骤（例如「令导数为零，解出使两项平衡的 m」），最终式子放进 reference。\n' +
  '  - reference：一段完整的参考答案。\n' +
  '  - page：支撑这个停顿的附件页码（PDF 页码从 1 开始；附件没有页码时填 0）。\n' +
  '- stop 之前的 text 要把学生引到问题跟前，但绝不能提前写出答案；stop 之后的 text 可以在答案的基础上继续讲。\n' +
  '- 简体中文，术语保留英文原文（如 regret、bootstrap）。数学式行内写 \\(…\\)，独立公式写 \\[…\\]，不要用 $。';

async function pdfPages(path) {
  try {
    const { stdout } = await run('pdfinfo', [path]);
    return Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]) || 0;
  } catch {
    return 0;
  }
}

async function pptxText(path) {
  const { stdout: list } = await run('unzip', ['-Z1', path], { maxBuffer: 8 << 20 });
  const slides = list
    .split('\n')
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const pages = [];
  for (const [index, name] of slides.entries()) {
    const { stdout: xml } = await run('unzip', ['-p', path, name], { maxBuffer: 16 << 20 });
    const text = xml
      .split('</a:p>')
      .map((paragraph) => [...paragraph.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''))
      .filter((line) => line.trim())
      .join('\n')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&');
    pages.push(text);
  }
  return {
    text: pages.map((text, index) => `【第 ${index + 1} 页】\n${text}`).join('\n\n'),
    pages: slides.length,
    slides: pages
  };
}

// Plain text of each page, so quoted evidence can be checked against the attachment.
export async function pageTexts(path, filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.pdf') {
    const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], { maxBuffer: 64 << 20 });
    const pages = stdout.split('\f');
    if (pages.at(-1)?.trim() === '') pages.pop();
    return pages;
  }
  if (ext === '.pptx') return (await pptxText(path)).slides;
  return null;
}

// Turns the attachment into message parts the model can read, plus the number of pages to cite.
export async function readAttachment(path, filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.pdf') {
    return {
      pages: await pdfPages(path),
      viewable: true,
      parts: [
        {
          type: 'file',
          file: { filename, file_data: `data:application/pdf;base64,${readFileSync(path).toString('base64')}` }
        }
      ],
      plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }]
    };
  }
  if (ext === '.pptx') {
    const { text, pages } = await pptxText(path);
    if (!text.trim())
      throw new RequestError(422, '这个 PPTX 里没有读到文字。请导出为 PDF 再上传，老师就能看到公式和图。');
    return {
      pages,
      viewable: false,
      parts: [{ type: 'text', text: `以下是 PPTX 各页提取出的文字（图片和公式对象无法提取）：\n\n${text}` }]
    };
  }
  let text = readFileSync(path, 'utf8');
  if (ext === '.html' || ext === '.htm') {
    text = text
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n\n');
  }
  return {
    pages: 0,
    viewable: ext === '.html' || ext === '.htm',
    parts: [{ type: 'text', text: `附件正文：\n\n${text.slice(0, 200_000)}` }]
  };
}

function bare(text) {
  return text.replace(/[\s$\\{}()（）,，.。、;；:：!！?？"“”'‘’*_^#]/gu, '');
}

function toDelimiters(text) {
  return text.replace(/\$\$([\s\S]+?)\$\$/g, '\\[$1\\]').replace(/\$((?:\\.|[^\n$])+?)\$/g, '\\($1\\)');
}

// Checks the model's chapter and turns it into note segments, or explains what to fix.
function shape(reply, { chapterId, file, pages, viewable }) {
  let draft;
  try {
    draft = JSON.parse(reply);
  } catch {
    return { error: '输出不是合法 JSON' };
  }
  const segments = Array.isArray(draft?.segments) ? draft.segments : [];
  const problems = [];
  if (!draft?.title?.trim()) problems.push('缺少 title');
  if (segments[0]?.type !== 'text' || segments.at(-1)?.type !== 'text') problems.push('第一段和最后一段必须是 text');
  const stops = segments.filter((segment) => segment.type === 'stop');
  if (stops.length < 3 || stops.length > 10) problems.push(`stop 数量为 ${stops.length}，应为 4 到 8 个`);
  const out = [];
  let stopNumber = 0;
  segments.forEach((segment, index) => {
    if (segment.type === 'text') {
      if (!segment.md?.trim()) problems.push(`第 ${index + 1} 段 text 为空`);
      out.push({ type: 'text', md: toDelimiters(segment.md.trim()) });
      return;
    }
    stopNumber++;
    if (segments[index - 1]?.type === 'stop') problems.push(`第 ${stopNumber} 个 stop 紧跟在另一个 stop 后`);
    if (!kinds.includes(segment.kind)) problems.push(`第 ${stopNumber} 个 stop 的 kind 无效`);
    if (!segment.ask?.trim() || !segment.reference?.trim() || !segment.label?.trim())
      problems.push(`第 ${stopNumber} 个 stop 缺少 ask、label 或 reference`);
    const keyPoints = (segment.keyPoints ?? []).map((point) => point.trim()).filter(Boolean);
    if (!keyPoints.length) problems.push(`第 ${stopNumber} 个 stop 没有 keyPoints`);
    // Shared terms are expected; the stop fails only when the text before it already carries much of the answer.
    const before = bare(segments[index - 1]?.md ?? '');
    const reference = bare(segment.reference ?? '');
    const windows = Math.max(0, reference.length - 7);
    let given = 0;
    for (let start = 0; start < windows; start++) if (before.includes(reference.slice(start, start + 8))) given++;
    if (windows && given / windows > 0.35) {
      problems.push(`第 ${stopNumber} 个 stop 之前的正文已经写出了大部分答案，请把答案留到 stop 之后`);
    }
    const page =
      Number.isInteger(segment.page) && segment.page > 0 && (!pages || segment.page <= pages) ? segment.page : 0;
    out.push({
      type: 'stop',
      id: `${chapterId}-s${stopNumber}`,
      kind: segment.kind,
      label: segment.label.trim(),
      ask: toDelimiters(segment.ask.trim()),
      keyPoints: keyPoints.map(toDelimiters),
      reference: toDelimiters(segment.reference.trim()),
      ...(page && viewable ? { slide: { file, page } } : {})
    });
  });
  if (problems.length) return { error: problems.join('；') };
  return { value: { title: draft.title.trim(), summary: (draft.summary ?? '').trim(), segments: out } };
}

export async function parseChapter(client, { path, file, chapterId, titleHint }) {
  const attachment = await readAttachment(path, file);
  const messages = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `附件文件名：${file}${attachment.pages ? `，共 ${attachment.pages} 页` : ''}。${titleHint ? `学生给这一章起的标题：${titleHint}。` : ''}请据此写出本章笔记。`
        },
        ...attachment.parts
      ]
    }
  ];
  const options = { maxTokens: 16_000, effort: 'medium', plugins: attachment.plugins, timeout: 300_000 };
  let reply = await client.complete(messages, chapterFormat, options);
  let shaped = shape(reply, { chapterId, file, ...attachment });
  for (let attempt = 1; shaped.error && attempt < 3; attempt++) {
    reply = await client.complete(
      [
        ...messages,
        { role: 'assistant', content: reply },
        { role: 'user', content: `上一版不合格：${shaped.error}。按要求重写整篇。` }
      ],
      chapterFormat,
      options
    );
    shaped = shape(reply, { chapterId, file, ...attachment });
  }
  if (shaped.error) throw new RequestError(502, `老师写出的笔记没有通过检查：${shaped.error}`);
  return shaped.value;
}
