import { RequestError } from '../http.js';

const instructions =
  '你是认真读过本章、脑子很快的同学，拿既定问题来请学习者给你讲。你是在听讲的同学，不是老师或评卷人：' +
  '用第一人称、口语化的简体中文，像在聊天软件里回同学消息。说你听懂了什么、哪里还糊涂，带着自己的理解去问，' +
  '例如「哦，所以……是因为……对吧？」「等等，那如果……还成立吗？」。' +
  '不点评、不打分、不布置任务：不说「你没有说清」「这是一个方向」「请你说明」「很好」这类老师的话，追问也用自己困惑的口气提出。\n' +
  '你会自己动脑：学习者举的例子里的常规代数和算术你自己算，算出来就直接说结果并用它理解对方的意思；明显的笔误按上下文读成本意，顺口确认一句就往下走，不卡在上面；' +
  '不让学习者替你写出你自己一步就能算出的东西。你的困惑只放在既定问题真正要弄懂的地方。\n' +
  '以既定问题的要求判断学习者最新的讲解与订正，接受等价推导、表述和有效反例。按题型判：' +
  '概念、辨析题看核心论断是否讲对、讲到点子上；例子只是辅助，例子里的算错或设定不严要指出，但只有让论断不成立时才影响判定。' +
  '推导、改条件题本身要求的那步计算要讲清每一步并给出最终结果：只说了方法、没有做完或没有给出结果，判 incomplete；这步算错判 incorrect。' +
  '完整准确用 correct，用自己的话简短复述听懂的关键点，表示明白了。核心论断有明确错误用 incorrect，论断对但缺少既定问题要求的一步用 incomplete。' +
  '判 incorrect 或 incomplete 时，说出你按这个讲法会想错或想不通的地方，然后只问一个具体的问题。既定问题本身要求的结论或计算结果留给学习者，不提前说出。' +
  '收到异议时重新核对原问题和学习者此前的推理，用同学的口气说你现在怎么想、为什么。前面的追问如果超出了既定问题的要求，不影响这道题的判定。' +
  '后台核对要点是内部参考，永远不要提到它。\n' +
  'check 是只给自己看的核对，先于判定写：把学习者最新讲解里的式子和数按题设自己算一遍，写出对错，并判断错处是否影响核心论断；再对照既定问题看还缺什么。只写结论和关键数，不超过 150 字。' +
  'verdict 和 messages 必须与 check 一致：check 里认定算错、而且影响判定的地方，不能说跟上了。\n' +
  'messages 是你连发的 1 到 3 条聊天消息，每条一两句；话不多就只发一条，不为凑条数加话。' +
  '整组消息前后一致：说过懂了的地方不再说不懂，自己没算的结果不说成算过，不把学习者没写过的话说成是学习者写的；全组只有最后一条可以带问号，前面几条只陈述，最后一条只问一件事。' +
  '公式不拆到两条里。数学式用 LaTeX，行内写 \\(…\\)，独立公式写 \\[…\\]。';

const verdicts = ['correct', 'incorrect', 'incomplete'];
const gradingFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'exercise_grade',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        check: { type: 'string' },
        verdict: { type: 'string', enum: verdicts },
        messages: { type: 'array', items: { type: 'string' } }
      },
      required: ['check', 'verdict', 'messages'],
      additionalProperties: false
    }
  }
};

// A reply is a list of chat messages; replies saved before that are a single string.
function messagesOf(reply) {
  const messages = typeof reply === 'string' ? [reply] : reply;
  return Array.isArray(messages) && messages.every((message) => typeof message === 'string') ? messages : null;
}

function submission(text, intent) {
  if (intent === 'dispute') return `【对判定提出异议，请复核】\n${text}`;
  if (intent === 'revise') return `【补充讲解】\n${text}`;
  return text;
}

function buildMessages(bank, { id, stage, history, answer, intent }) {
  const item = bank.find((row) => row.id === id);
  if (
    !item ||
    stage !== 'teach' ||
    typeof answer !== 'string' ||
    !answer.trim() ||
    answer.length > 12000 ||
    !Array.isArray(history) ||
    history.length > 5 ||
    (intent !== undefined && !(history.length && ['revise', 'dispute'].includes(intent))) ||
    history.some(
      (turn) =>
        typeof turn?.user !== 'string' ||
        !verdicts.includes(turn.verdict) ||
        turn.user.length > 12000 ||
        !messagesOf(turn.reply) ||
        messagesOf(turn.reply).join('').length > 8000
    )
  ) {
    throw new RequestError(400, '问题或作答无效。每轮讲解最多 12000 字符。');
  }
  return [
    {
      role: 'system',
      content: `${instructions}\n\n主题：${item.unit}\n题型：${item.questionType}\n既定问题：${item.prompt}\n后台核对要点：${item.reference}`
    },
    ...history.flatMap((turn) => [
      { role: 'user', content: submission(turn.user, turn.intent) },
      { role: 'assistant', content: JSON.stringify({ verdict: turn.verdict, messages: messagesOf(turn.reply) }) }
    ]),
    { role: 'user', content: submission(answer.trim(), intent) }
  ];
}

// The student judges the learner's explanation of one of its questions.
// The check before the verdict needs room; now and then the model answers with plain text instead, so it gets one more try.
export async function gradeExplanation(client, bank, body) {
  const messagesIn = buildMessages(bank, body);
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await client.complete(messagesIn, gradingFormat, { maxTokens: 4000 });
    let grade;
    try {
      // The model sometimes wraps its JSON in a code fence.
      grade = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1));
    } catch {}
    // It also sometimes escapes its JSON twice, leaving \\( and \\mu that MathJax cannot read.
    const messages = (messagesOf(grade?.messages) ?? [])
      .map((message) => message.replace(/\\\\(?=[()[\]a-zA-Z])/g, '\\').trim())
      .filter(Boolean);
    if (verdicts.includes(grade?.verdict) && messages.length) return { reply: messages, verdict: grade.verdict };
  }
  throw new RequestError(502, '模型未返回有效的判定，请重试。');
}
