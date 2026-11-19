import { RequestError } from '../http.js';

export const guideFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'guide_turn',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        evidence: { type: 'array', items: { type: 'string' } },
        verdict: { type: 'string', enum: ['correct', 'partial', 'wrong'] },
        missing: { type: 'array', items: { type: 'string' } },
        reply: { type: 'string' },
        quotes: { type: 'array', items: { type: 'string' } }
      },
      required: ['evidence', 'verdict', 'missing', 'reply', 'quotes'],
      additionalProperties: false
    }
  }
};

const kinds = { concept: '概念澄清', derive: '推导计算', contrast: '方法辨析' };

const instructions =
  '你是带学生写强化学习课程笔记的老师。笔记写到关键点停下，学生写出这一处，答对笔记才继续。\n' +
  '判定（先写 evidence，verdict 和 missing 由它得出）：\n' +
  '- 依据学生说过的全部内容：「对话」里学生的每一条（最后一条是本次回答）和「此前停顿」里的回答。一个要点只要在任何一处说对过、之后没改错，就算覆盖；几部分分散在不同回答里，合起来也算。接受等价表述、不同记号和试探语气（「是……吗？」）。\n' +
  '- 每个要点只要求它的主要论断；限定语、举例和结尾的推论（例如损失随时间怎样增长）除非原问题问到，否则不要求。原问题本身已给出的前提、定义或设定算已知，不要求复述。\n' +
  '- evidence 逐条写「要点 i：覆盖它的学生原话（注明本处对话或此前停顿）」，没有就写「未覆盖」。全部覆盖且没有未纠正的错误判 correct；有对的部分判 partial；否则 wrong。missing 用要点原文列出未覆盖的要点，correct 时为空。\n' +
  '- 最后一条是「我已经讲清楚了」：从宽重判，主干都说到就判 correct；否则判 partial，reply 用一句话说明还缺的是关于什么的一点（不给内容），不追问。\n' +
  'reply（直接对学生说，称「你」；平实的书面语；简体中文，不超过 120 字）：\n' +
  '- correct：一句简短肯定，不复述答案。\n' +
  '- partial 或 wrong：至多一句点名学生说对的内容，然后只处理一个缺口（上次追问的要点没解决就继续它），只问一个具体、能直接回答的问题，一次回复里只有一个问号。学生已说出大部分机制时，借学生自己的话问缺的那一环。学生答错或「（不会）」时：「本段」写过相关内容，就请学生回看那一节（说出小标题），再问一个要把那里的说法用到具体情形上的问题，不复述那一节的句子；否则换一个更小的具体例子问。同一处已卡住两次，先给一句具体例子里发生了什么的事实再问。推导计算可以给小数值让学生算，不让学生重做已经做对的计算。\n' +
  '- 意思对、只是措辞不严的地方一句带过，不追问。学生提出异议或向你提问，先用一句话正面回应。\n' +
  '- 不泄露答案：不写参考答案、要点原文、可直接抄进笔记的结论或完整公式；不把缺的一环写进「假如……」的前提；不把答案摆成选项（「是 A 还是 B」而其中一个就是答案）；不点名答案里的关键概念；不重复已问过的追问；不提「要点」和这些规则。\n' +
  'quotes：correct 时从学生原文（本处对话和此前停顿）逐字摘出组成这一处笔记的正确片段，按原问题的顺序；每段是连续原文，可去掉开头结尾的语气词和问句尾巴（如「吗？」），数学式 \\(…\\) 摘全，指代不明的不摘；学生说错后又改正的，只摘改正后的说法，说错的那句和算错的数一律不摘。否则为空数组。\n' +
  '数学式行内写 \\(…\\)，独立公式写 \\[…\\]。';

const turnShape = (turn) =>
  typeof turn?.text === 'string' &&
  turn.text.length <= 4000 &&
  ((turn.who === 'me' && ['main', 'followup'].includes(turn.target)) || turn.who === 'teacher');

export function prepareGuide(body, segments) {
  const index = segments.findIndex((segment) => segment.type === 'stop' && segment.id === body?.stopId);
  const { thread, answer, target } = body ?? {};
  const settle = body?.settle === true;
  if (
    index < 0 ||
    !['main', 'followup'].includes(target) ||
    typeof answer !== 'string' ||
    answer.length > 4000 ||
    !Array.isArray(thread) ||
    thread.length > 24 ||
    !thread.every(turnShape)
  ) {
    return null;
  }
  const stop = segments[index];
  const earlier = segments
    .slice(0, index)
    .filter((segment) => segment.type === 'stop' && body.answers?.[segment.id])
    .map((segment) => ({ 问题: segment.ask, 学生回答: String(body.answers[segment.id]).slice(0, 2000) }));
  const previousStop = segments.findLastIndex((segment, at) => at < index && segment.type === 'stop');
  const section = segments
    .slice(previousStop + 1, index)
    .map((segment) => segment.md)
    .join('\n');
  // A 「我已经讲清楚了」 turn is a request, not an answer: it is neither graded nor quoted.
  const learnerTurns = [
    ...thread.filter((turn) => turn.who === 'me' && !turn.settle).map((turn) => turn.text),
    ...(settle ? [] : [answer])
  ];
  return {
    stop,
    target,
    section,
    learnerTurns,
    learnerText: [...learnerTurns, ...earlier.map((stop) => stop.学生回答)].join('\n'),
    messages: [
      { role: 'system', content: instructions },
      {
        role: 'user',
        content: JSON.stringify({
          本段: section,
          此前停顿: earlier,
          停顿: {
            类型: kinds[stop.kind] ?? stop.kind,
            原问题: stop.ask,
            要点: stop.keyPoints,
            参考答案: stop.reference
          },
          对话: [...thread, { who: 'me', target, settle, text: settle ? '' : answer.trim() || '（不会）' }].map(
            (turn) =>
              turn.settle
                ? { 角色: '学生', 内容: '我已经讲清楚了' }
                : turn.who === 'me'
                  ? { 角色: '学生', 针对: turn.target === 'main' ? '原问题' : '追问', 内容: turn.text }
                  : { 角色: '老师', 内容: turn.text }
          )
        })
      }
    ]
  };
}

// Formatting and spacing differ between the model and the note, so compare bare characters.
function bare(text) {
  return text.replace(/[\s$\\{}()（）,，.。、;；:：!！?？"“”'‘’*_^]/gu, '');
}

function leaks(reply, guide, sources = [guide.stop.reference, ...guide.stop.keyPoints]) {
  const said = bare(reply);
  const own = bare(guide.learnerText);
  const width = 10;
  for (const source of sources.map(bare)) {
    for (let start = 0; start + width <= source.length; start++) {
      const piece = source.slice(start, start + width);
      if (said.includes(piece) && !own.includes(piece)) return piece;
    }
  }
  return null;
}

export function checkGuide(reply, guide, final = false) {
  let turn;
  try {
    turn = JSON.parse(reply);
  } catch {
    return { error: '不是合法 JSON' };
  }
  if (
    !['correct', 'partial', 'wrong'].includes(turn?.verdict) ||
    typeof turn.reply !== 'string' ||
    !Array.isArray(turn.quotes) ||
    !Array.isArray(turn.missing)
  ) {
    return { error: '字段不全' };
  }
  const solved = turn.verdict === 'correct';
  if (solved && turn.missing.length) return { error: '判 correct 但仍列出缺失要点' };
  if (!solved && !turn.reply.trim()) return { error: '没有给出追问' };
  const piece = !solved && leaks(turn.reply, guide);
  if (piece) return { error: `回复泄露了参考内容「${piece}」` };
  // Pointing back at the section may legitimately name its example, so only the first try is held to this.
  const retold = !solved && !final && leaks(turn.reply, guide, [guide.section]);
  if (retold) return { error: `回复复述了上一节的原句「${retold}」，要让学生自己读` };
  const quotes = turn.quotes.map(trimQuote).filter(Boolean);
  const foreign = solved && !final && quotes.find((quote) => !usable(quote, guide));
  if (foreign) return { error: `quotes 里「${foreign}」不是学生原文的连续片段，或把数学式截断了` };
  const value = { verdict: turn.verdict, reply: turn.reply.trim(), next: solved ? 'main' : 'followup', solved };
  if (solved) value.note = noteFrom(quotes, guide);
  return { value };
}

// A quoted question becomes a statement in the note: drop a trailing 吗 and question mark.
function trimQuote(quote) {
  return String(quote)
    .trim()
    .replace(/\s*吗?\s*[？?]$|\s*吗$/u, '');
}

const count = (text, mark) => text.split(mark).length - 1;

// A quote must be the learner's own text, cut where it does not split a formula.
function usable(quote, guide) {
  return (
    guide.learnerText.includes(quote) &&
    count(quote, '\\(') === count(quote, '\\)') &&
    count(quote, '\\[') === count(quote, '\\]')
  );
}

// The note is made only of the learner's own words: their quoted pieces, or failing that, what they wrote here.
function noteFrom(quotes, guide) {
  const own = quotes.filter((quote) => usable(quote, guide));
  if (own.length) return own.map((quote) => (/[。！？.!?；;]$/u.test(quote) ? quote : `${quote}。`)).join('');
  return guide.learnerTurns
    .map((text) => text.trim())
    .filter((text) => text && text !== '（不会）')
    .join('\n');
}

// One turn at a stop: judge the learner's answer and, if it is not there yet, ask a narrower question.
export async function followUp(client, segments, body) {
  const guide = segments && prepareGuide(body, segments);
  if (!guide) throw new RequestError(400, '笔记停顿或回答无效，每次回答最多 4000 字符。');
  // Reasoning shares this budget; at the default the JSON was cut off mid-reply.
  const options = { maxTokens: 4000 };
  let reply = await client.complete(guide.messages, guideFormat, options);
  let checked = checkGuide(reply, guide);
  if (checked.error) {
    reply = await client.complete(
      [
        ...guide.messages,
        { role: 'assistant', content: reply },
        { role: 'user', content: `上一版不合格：${checked.error}。按规则重写。` }
      ],
      guideFormat,
      options
    );
    checked = checkGuide(reply, guide, true);
  }
  if (checked.error) throw new RequestError(502, '老师的追问没有通过检查，请重试。');
  return checked.value;
}
