import { RequestError } from '../http.js';

export const guideFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'guide_turn',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['correct', 'partial', 'wrong'] },
        missing: { type: 'array', items: { type: 'string' } },
        reply: { type: 'string' },
        next: { type: 'string', enum: ['main', 'followup'] },
        answersMain: { type: 'boolean' }
      },
      required: ['verdict', 'missing', 'reply', 'next', 'answersMain'],
      additionalProperties: false
    }
  }
};

const kinds = { concept: '概念澄清', derive: '推导计算', contrast: '方法辨析' };

const instructions =
  '你是带学生写一份强化学习课程笔记的老师。笔记由你逐字写出，写到关键点停下，让学生自己写出这一处内容；学生答对，笔记才继续。\n' +
  '判定：\n' +
  '- target=main（原问题）：回答覆盖全部要点且没有错误陈述才判 correct。接受等价表述、不同记号和等价推导，不要求与参考答案措辞一致。多写的内容只要没错就不扣分。\n' +
  '- target=followup（追问）：只判断学生是否答对你最近一次追问。\n' +
  '回复 reply：\n' +
  '- main 判 correct：一句简短肯定，不复述答案。\n' +
  '- main 判 partial 或 wrong：至多一句点明哪部分已经对、哪一处有问题（只说位置，不说正确内容），然后问一个更窄、一步能答的追问，指向第一个缺失或错误的要点。可以用小数值例子、让学生比较两种情况、提示该关注哪个量。next=followup；若只差一处措辞且学生显然能直接补上，可以 next=main 并请学生重答原问题。\n' +
  '- followup 答对：一句承认，然后请学生回到原问题重新作答，next=main。答错：再问一个更窄的问题，next=followup。\n' +
  '- answersMain：学生本次回答单独拿出来，就已经完整、正确地回答了原问题（覆盖全部要点、没有错误）时为 true，此时 verdict=correct、missing 为空、reply 一句简短肯定；否则为 false。\n' +
  '- 学生回答为「（不会）」：从最基础的一步问起。\n' +
  '- 绝不写出参考答案、要点原文、完整公式或可以直接抄进笔记的结论；不要重复已经问过的追问。\n' +
  '- 追问不能把答案摆成选项（例如「是 A 还是 B」而其中一个就是答案），也不要点名答案里的关键概念；让学生自己说出它。\n' +
  '- missing 用要点原文列出原问题仍未覆盖的要点；main 判 correct 时为空数组。\n' +
  '- 简体中文。数学式行内写 \\(…\\)，独立公式写 \\[…\\]。reply 不超过 90 字。';

const turnShape = (turn) =>
  typeof turn?.text === 'string' &&
  turn.text.length <= 4000 &&
  ((turn.who === 'me' && ['main', 'followup'].includes(turn.target)) || turn.who === 'teacher');

export function prepareGuide(body, segments) {
  const index = segments.findIndex((segment) => segment.type === 'stop' && segment.id === body?.stopId);
  const { thread, answer, target } = body ?? {};
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
  const context = segments
    .slice(0, index)
    .map((segment) =>
      segment.type === 'text'
        ? segment.md
        : `【${segment.label}】${String(body.answers?.[segment.id] ?? '').slice(0, 2000)}`
    )
    .join('\n\n')
    .slice(-1500);
  const learnerText = [...thread.filter((turn) => turn.who === 'me').map((turn) => turn.text), answer].join('\n');
  return {
    stop,
    target,
    learnerText,
    messages: [
      { role: 'system', content: instructions },
      {
        role: 'user',
        content: JSON.stringify({
          笔记上文: context,
          停顿类型: kinds[stop.kind] ?? stop.kind,
          原问题: stop.ask,
          要点: stop.keyPoints,
          参考答案: stop.reference,
          此前对话: thread.map((turn) =>
            turn.who === 'me'
              ? { 角色: '学生', 针对: turn.target === 'main' ? '原问题' : '追问', 内容: turn.text }
              : { 角色: '老师', 内容: turn.text }
          ),
          target,
          学生本次回答: answer.trim() || '（不会）'
        })
      }
    ]
  };
}

// Formatting and spacing differ between the model and the note, so compare bare characters.
function bare(text) {
  return text.replace(/[\s$\\{}()（）,，.。、;；:：!！?？"“”'‘’*_^]/gu, '');
}

function leaks(reply, guide) {
  const said = bare(reply);
  const own = bare(guide.learnerText);
  const width = 10;
  for (const source of [guide.stop.reference, ...guide.stop.keyPoints].map(bare)) {
    for (let start = 0; start + width <= source.length; start++) {
      const piece = source.slice(start, start + width);
      if (said.includes(piece) && !own.includes(piece)) return piece;
    }
  }
  return null;
}

export function checkGuide(reply, guide) {
  let turn;
  try {
    turn = JSON.parse(reply);
  } catch {
    return { error: '不是合法 JSON' };
  }
  if (
    !['correct', 'partial', 'wrong'].includes(turn?.verdict) ||
    !['main', 'followup'].includes(turn.next) ||
    typeof turn.reply !== 'string' ||
    !Array.isArray(turn.missing)
  ) {
    return { error: '字段不全' };
  }
  const solved = turn.verdict === 'correct' && (guide.target === 'main' || turn.answersMain === true);
  if (solved && turn.missing.length) return { error: '判 correct 但仍列出缺失要点' };
  if (!solved && !turn.reply.trim()) return { error: '没有给出追问' };
  const piece = !solved && leaks(turn.reply, guide);
  if (piece) return { error: `回复泄露了参考内容「${piece}」` };
  return { value: { verdict: turn.verdict, reply: turn.reply.trim(), next: solved ? 'main' : turn.next, solved } };
}

// One turn at a stop: judge the learner's answer and, if it is not there yet, ask a narrower question.
export async function followUp(client, segments, body) {
  const guide = segments && prepareGuide(body, segments);
  if (!guide) throw new RequestError(400, '笔记停顿或回答无效，每次回答最多 4000 字符。');
  let reply = await client.complete(guide.messages, guideFormat);
  let checked = checkGuide(reply, guide);
  if (checked.error) {
    reply = await client.complete(
      [
        ...guide.messages,
        { role: 'assistant', content: reply },
        { role: 'user', content: `上一版不合格：${checked.error}。按规则重写。` }
      ],
      guideFormat
    );
    checked = checkGuide(reply, guide);
  }
  if (checked.error) throw new RequestError(502, '老师的追问没有通过检查，请重试。');
  return checked.value;
}
