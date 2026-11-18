import { RequestError } from '../http.js';

const instructions =
  '你是刚学过本章基础的学生，正在请学习者给你讲清一个既定问题。' +
  '以既定问题的要求评估学习者最新的讲解与订正。接受等价推导、表述和有效反例。' +
  '完整准确用 correct，用第一人称简短复述我听懂的关键点，结束本问。' +
  '讲解里有明确的错误用 incorrect，回答正确但确实缺少既定问题要求的一步时用 incomplete。' +
  '判 incorrect 或 incomplete 时，至多用一句话反馈，然后只提一个具体追问。保留待补的部分，让学习者自己推导，不提前给计算结果或完整答案。' +
  '收到异议时重新核对原问题和学习者此前的推理，说明维持或改判及原因。前面的追问如果超出了既定问题的要求，不影响这道题的判定。' +
  '后台核对要点是内部参考，永远不要在反馈中提到它。' +
  '反馈写简体中文。数学式用 LaTeX，行内写 \\(…\\)，独立公式写 \\[…\\]。';

const verdicts = ['correct', 'incorrect', 'incomplete'];
const gradingFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'exercise_grade',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: verdicts },
        feedback: { type: 'string' }
      },
      required: ['verdict', 'feedback'],
      additionalProperties: false
    }
  }
};

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
        typeof turn.reply !== 'string' ||
        !verdicts.includes(turn.verdict) ||
        turn.user.length > 12000 ||
        turn.reply.length > 8000
    )
  ) {
    throw new RequestError(400, '问题或作答无效。每轮讲解最多 12000 字符。');
  }
  return [
    {
      role: 'system',
      content: `${instructions}\n\n主题：${item.unit}\n既定问题：${item.prompt}\n后台核对要点：${item.reference}`
    },
    ...history.flatMap((turn) => [
      { role: 'user', content: submission(turn.user, turn.intent) },
      { role: 'assistant', content: JSON.stringify({ verdict: turn.verdict, feedback: turn.reply }) }
    ]),
    { role: 'user', content: submission(answer.trim(), intent) }
  ];
}

// The student judges the learner's explanation of one of its questions.
export async function gradeExplanation(client, bank, body) {
  const reply = await client.complete(buildMessages(bank, body), gradingFormat);
  let grade;
  try {
    grade = JSON.parse(reply);
  } catch {}
  if (!verdicts.includes(grade?.verdict) || typeof grade.feedback !== 'string' || !grade.feedback.trim()) {
    throw new RequestError(502, '模型未返回有效的判定，请重试。');
  }
  return { reply: grade.feedback.trim(), verdict: grade.verdict };
}
