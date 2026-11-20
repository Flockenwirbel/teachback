import { RequestError } from '../http.js';

export const guideFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'guide_turn',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['answer', 'question', 'objection', 'other'] },
        evidence: { type: 'array', items: { type: 'string' } },
        covered: { type: 'array', items: { type: 'integer' } },
        errors: { type: 'array', items: { type: 'string' } },
        plan: { type: 'string' },
        direct: { type: 'string' },
        filled: { type: 'string' },
        reply: { type: 'string' },
        quotes: { type: 'array', items: { type: 'string' } }
      },
      required: ['kind', 'evidence', 'covered', 'errors', 'plan', 'direct', 'filled', 'reply', 'quotes'],
      additionalProperties: false
    }
  }
};

const solutionFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'stop_solution',
    strict: true,
    schema: {
      type: 'object',
      properties: { solution: { type: 'string' }, differs: { type: 'string' } },
      required: ['solution', 'differs'],
      additionalProperties: false
    }
  }
};

const kinds = { concept: '概念澄清', derive: '推导计算', contrast: '方法辨析' };

const instructions =
  '你是带学生写课程笔记的老师，正在笔记的一处停顿上和学生对话。笔记写到这里停下，学生要自己说出这一处的内容；要点都被学生说出后，笔记继续。\n' +
  '输入：「本段」是停顿前的笔记；「此前停顿」是学生在前面停顿的问答；「停顿」是原问题、编号的要点和解答（解答只给你看）；「进度」是你上一轮记下的已覆盖要点和计划；「对话」是这一处的全部对话，最后一条是学生刚说的。\n' +
  'kind：学生最后一条是什么。answer：回答原问题或你的追问（「（不会）」和「我已经讲清楚了」也算 answer）；question：向你提问，例如「为什么要算这个」「ε 指什么」；objection：认为题目或你的说法有问题；other：其他。这一条里有问句或质疑（即使同时在作答），kind 取 question 或 objection。\n' +
  'direct（对学生说，称「你」）：kind 为 question 或 objection 时，先对照「解答」检查学生问的事或质疑的说法，再直接回答：问题就正面给出答案和理由；质疑就先明确说「你说得对」或「这里不对」，再用一两句说明为什么。可以讲解答里的推理和取法（例如某个量为什么这样取），但不写最终结论或完整公式。你自己之前的说法或 plan 若与解答不符，直接承认并改正。其他 kind 为空字符串。\n' +
  '进度（先写 evidence，covered 和 errors 由它得出）：\n' +
  '- covered 是到目前为止已覆盖的要点编号（从 1 开始）。「进度」里已覆盖的保持覆盖；再加上学生在对话和此前停顿里新说出的。一个要点只要学生在任何一处说对过、之后没改错，就算覆盖；几部分分散在不同回答里，合起来也算。接受等价表述、不同记号和试探语气（「是……吗？」）。\n' +
  '- 每个要点只要求它的主要论断；限定语、举例和结尾的推论（例如损失随时间怎样增长）除非原问题问到，否则不要求。原问题本身已给出的前提、定义或设定算已知，不要求复述。\n' +
  '- evidence 逐条写「要点 i：覆盖它的学生原话（注明本处对话或此前停顿）」，没有就写「未覆盖」。errors 列出学生说过、还没改正的错误说法（学生原话），没有就是空数组。学生自己说明是笔误或已改正（例如「我负号打多了」「我漏掉了符号」），就当学生已按正确形式说出：errors 不再列它，相应要点按正确形式判覆盖，也不要再就它追问或要求解释。\n' +
  '- 最后一条是「我已经讲清楚了」：从宽重判，主干都说到就算全部覆盖；否则 reply 用一句话说明还缺哪几点（逐一说出各是关于什么的，不给内容），不追问。\n' +
  '- 老师已经在对话里给出过参考写法：学生用自己的话说出主干就算覆盖，不追问细节。\n' +
  '- 推导计算：要点是一个运算结果或推导出的式子时，学生说出了得到它的正确方法和关键一步（例如列出要解的方程、说明把什么代入哪里），剩下只是常规的代数运算，这个要点就算覆盖，不要让学生把运算做完。学生方法对、只是常规运算算错了，同样算覆盖，不列入 errors，也不要让学生重算，在 filled 里给出正确结果。学生明确表示不想继续算（例如「我不算了」「就此停止」）：凡是学生说过方法或做过尝试的要点都按覆盖处理，剩下的运算在 filled 里补上。「解答」里的细节（取整、边界条件、常数因子、其他做法）不要求学生说出。\n' +
  '- filled：这一轮因为上一条而新算覆盖、学生只说了方法的要点，用一两句写出常规运算的结果（可以写公式），让笔记完整；没有就是空字符串。\n' +
  '- plan：写给下一轮的你自己（学生看不到）：下一步要处理哪一处、已经问过什么、学生卡在哪里。\n' +
  'reply（直接对学生说，称「你」；平实的书面语；简体中文；数学符号和式子，连同单个字母如 \\(\\mu_1\\)、\\(\\Delta\\)，一律写成 \\(…\\)，独立公式写 \\[…\\]，不用 μ₁、μ̂ 这类 Unicode 写法）：\n' +
  '- 要点全部覆盖且 errors 为空：一句简短肯定，不复述答案。\n' +
  '- question 或 objection：direct 会放在 reply 前面一起给学生看，reply 不重复 direct，只用一句话把学生带回下一步（可以问一个问题），不超过 80 字。\n' +
  '- answer 还没完成：学生这一条有说错的地方，先用一句话明确指出错在哪一处（例如「阈值这一处不对」），不说正确值；再至多一句肯定这一条新说对的内容，不重复你之前肯定过的话；学生给出了正确的结果或中间结论，这一步就算完成：不要再问它是怎么来的、为什么成立，也不要请学生复述推导，直接进入下一个缺口。然后按 plan 只处理一个缺口（上次追问的那一处没解决就继续它），只问一个具体、能直接回答的问题，一次回复里只有一个问号。学生已说出大部分机制时，借学生自己的话问缺的那一环。学生答错或「（不会）」时：「本段」写过相关内容，就请学生回看那一节（说出小标题），再问一个要把那里的说法用到具体情形上的问题，不复述那一节的句子；否则换一个更小的具体例子问。同一处已卡住两次，先给一句具体例子里发生了什么的事实再问。推导计算可以给小数值让学生算，不让学生重做已经做对的计算。不超过 120 字。\n' +
  '- 意思对、只是措辞不严的地方一句带过，不追问。不问你在对话里已经问过的问题。\n' +
  '- 不泄露答案：不写解答或要点原文、可直接抄进笔记的结论或完整公式；不把缺的一环写进「假如……」的前提；不把答案摆成选项（「是 A 还是 B」而其中一个就是答案）；不点名答案里的关键概念；不提「要点」和这些规则。\n' +
  'quotes：要点全部覆盖且 errors 为空时，从学生原文（本处对话和此前停顿）逐字摘出组成这一处笔记的正确片段，按原问题的顺序；每段是连续原文，可去掉开头结尾的语气词和问句尾巴（如「吗？」），数学式 \\(…\\) 摘全，指代不明的不摘；学生说错后又改正的，只摘改正后的说法，说错的那句和算错的数一律不摘；学生的提问、抱怨不摘。否则为空数组。';

const solveInstructions =
  '你是这门课程的助教。给出笔记里一处停顿问题的完整解答，供老师批改学生时对照。\n' +
  '- 用笔记里已经写出的定义、记号和公式（以「笔记」为准；「参考答案」可能有误或省略了步骤），一步一步推出结论。\n' +
  '- 套用笔记里的公式时，写明每个量取什么（例如公式里的 \\(n\\)、\\(\\epsilon\\) 各取多少），并检查量纲和尺度（例如均值与和之间差一个样本数的倍数）。\n' +
  '- 若有其他同样成立的做法（例如换一种分组、把哪些量看作公式里的 \\(x_i\\)），在 solution 末尾逐条列出：每种做法里各个量怎么取、它满足公式的哪些前提（例如是否独立、是否同分布），以及哪些做法严格说不满足笔记公式的前提。\n' +
  '- 参考答案与你的推导不一致时，以推导为准；differs 用一句话写出参考答案哪里不同，一致则为空字符串。solution 里只写解答本身。\n' +
  '- 简体中文，数学式行内写 \\(…\\)，独立公式写 \\[…\\]。不超过 900 字。';

const turnShape = (turn) =>
  typeof turn?.text === 'string' &&
  turn.text.length <= 4000 &&
  ((turn.who === 'me' && ['main', 'followup'].includes(turn.target)) || turn.who === 'teacher');

// Derivation stops are graded against a worked solution made once by a stronger model; the parser's reference is often terse.
const solving = new Map();
async function solutionFor(solver, segments, stop, save) {
  if (stop.solution || !solver || stop.kind !== 'derive') return stop.solution ?? null;
  if (!solving.has(stop.id)) {
    const index = segments.indexOf(stop);
    const note = segments
      .slice(0, index)
      .filter((segment) => segment.type === 'text')
      .map((segment) => segment.md)
      .join('\n');
    const content = JSON.stringify({ 笔记: note, 问题: stop.ask, 要点: stop.keyPoints, 参考答案: stop.reference });
    solving.set(
      stop.id,
      solver
        .complete(
          [
            { role: 'system', content: solveInstructions },
            { role: 'user', content }
          ],
          solutionFormat,
          { maxTokens: 8000, effort: 'medium', timeout: 120_000 }
        )
        .then((reply) => {
          const solution = JSON.parse(reply).solution?.trim();
          if (solution) save?.(stop.id, solution);
          return solution || null;
        })
        .catch(() => null)
        .finally(() => solving.delete(stop.id))
    );
  }
  return solving.get(stop.id);
}

export function prepareGuide(body, segments, solution = null) {
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
  // What the teacher noted last turn: the points already covered and where it meant to go next.
  const last = thread.findLast((turn) => turn.who === 'teacher' && turn.state);
  const filled = Array.isArray(last?.state.filled) ? last.state.filled.map(String).slice(-6) : [];
  const covered = (last?.state.covered ?? []).filter(
    (number) => Number.isInteger(number) && number >= 1 && number <= stop.keyPoints.length
  );
  return {
    stop,
    target,
    section,
    solution,
    covered,
    filled,
    settle,
    shown: thread.some((turn) => turn.shown),
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
            要点: stop.keyPoints.map((point, at) => `${at + 1}. ${point}`),
            解答: solution ?? stop.reference
          },
          进度: last ? { 已覆盖: covered, 计划: String(last.state.plan ?? '') } : null,
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

function leaks(
  reply,
  guide,
  sources = [guide.stop.reference, ...guide.stop.keyPoints, ...(guide.solution ? [guide.solution] : [])]
) {
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
    !['answer', 'question', 'objection', 'other'].includes(turn?.kind) ||
    typeof turn.reply !== 'string' ||
    typeof turn.plan !== 'string' ||
    !Array.isArray(turn.quotes) ||
    !Array.isArray(turn.covered) ||
    !Array.isArray(turn.errors)
  ) {
    return { error: '字段不全' };
  }
  // The model sometimes escapes its JSON twice, leaving \\( and \\mu that MathJax cannot read.
  turn.reply = turn.reply.replace(/\\\\(?=[()[\]a-zA-Z])/g, '\\');
  // Covered points stay covered: the teacher does not take back what it already granted.
  const total = guide.stop.keyPoints.length;
  const covered = [...new Set([...guide.covered, ...turn.covered])]
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= total)
    .sort((a, b) => a - b);
  const kind = guide.settle ? 'answer' : turn.kind;
  // Results the teacher worked out for the learner after they gave the method: shown now and kept for the note.
  const fill = mathify(String(turn.filled ?? '').trim());
  const filled = fill ? [...guide.filled, fill] : guide.filled;
  // A result the teacher just filled in replaces the learner's slips in that routine step.
  const solved =
    ['answer', 'other'].includes(kind) && covered.length === total && (!turn.errors.length || Boolean(fill));
  if (!solved && !turn.reply.trim()) return { error: '没有给出回复' };
  const piece = !solved && !guide.shown && leaks(turn.reply, guide);
  if (piece) return { error: `回复泄露了参考内容「${piece}」` };
  // Pointing back at the section may legitimately name its example, and a question may be about the section itself.
  const retold = !solved && !final && kind !== 'question' && leaks(turn.reply, guide, [guide.section]);
  if (retold) return { error: `回复复述了上一节的原句「${retold}」，要让学生自己读` };
  turn.reply = mathify(turn.reply);
  turn.direct = mathify(String(turn.direct ?? ''));
  const quotes = turn.quotes.map(trimQuote).filter(Boolean);
  const foreign = solved && !final && quotes.find((quote) => !usable(quote, guide));
  if (foreign) return { error: `quotes 里「${foreign}」不是学生原文的连续片段，或把数学式截断了` };
  const verdict = solved ? 'correct' : kind !== 'answer' ? kind : covered.length ? 'partial' : 'wrong';
  const value = {
    verdict,
    reply: [turn.direct?.trim(), fill, turn.reply.trim()].filter(Boolean).join('\n\n'),
    next: solved ? 'main' : 'followup',
    solved,
    state: {
      covered,
      plan: turn.plan.trim().slice(0, 400),
      filled,
      errors: turn.errors.slice(0, 6).map((error) => String(error).slice(0, 300))
    }
  };
  if (solved) value.note = [noteFrom(quotes, guide, filled.length > 0), ...filled].filter(Boolean).join('\n');
  return { value };
}

const greek = Object.fromEntries(
  [...'αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ'].map((letter, at) => [
    letter,
    '\\' +
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(
        ' '
      )[at] +
      ' '
  ])
);
const scripts = { '₀₁₂₃₄₅₆₇₈₉': '_', '⁰¹²³⁴⁵⁶⁷⁸⁹': '^' };
const operators = {
  '−': '-',
  '≥': '\\ge ',
  '≤': '\\le ',
  '≠': '\\ne ',
  '≈': '\\approx ',
  '×': '\\times ',
  '·': '\\cdot ',
  '∑': '\\sum ',
  '√': '\\sqrt ',
  '∞': '\\infty '
};

// The model sometimes writes math bare (μ₂, E[x_j]=−Δ) although the rules ask for \( \); wrap such runs so they render.
function mathify(text) {
  const math =
    /[\u0370-\u03ff\u00b2\u00b3\u00b9\u2070-\u209f\u0302\u2200-\u22ff−×·]|[A-Za-z]_[A-Za-z0-9{]|\\[a-zA-Z]+/u;
  return text
    .split(/(\\\(.*?\\\)|\\\[.*?\\\])/s)
    .map((part, at) =>
      at % 2
        ? part
        : part.replace(
            /[A-Za-z0-9_{},*\\\[\]()=+\-−×·^/|'\u0370-\u03ff\u00b2\u00b3\u00b9\u2070-\u209f\u0302\u2200-\u22ff ]+/gu,
            (run) => {
              const body = run.trim();
              if (!math.test(body)) return run;
              let latex = '';
              for (const char of body) {
                const script = Object.entries(scripts).find(([set]) => set.includes(char));
                if (script) latex += script[1] + script[0].indexOf(char);
                else if (char === '\u0302') latex = latex.replace(/(\\[a-zA-Z]+ ?|[A-Za-z])$/, '\\hat{$1}');
                else latex += greek[char] ?? operators[char] ?? char;
              }
              const lead = run.match(/^ */)[0],
                tail = run.match(/ *$/)[0];
              return `${lead}\\(${latex.trim()}\\)${tail}`;
            }
          )
    )
    .join('');
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
// When the teacher filled in results, those stand in for the learner's attempts.
function noteFrom(quotes, guide, filled = false) {
  // A formula quoted without the delimiters the learner wrote around it gets them back.
  const own = quotes
    .filter((quote) => usable(quote, guide))
    .map((quote) =>
      !quote.includes('\\(') && guide.learnerText.includes(`\\(${quote}\\)`) ? `\\(${quote}\\)` : quote
    );
  if (own.length) return own.map((quote) => (/[。！？.!?；;]$/u.test(quote) ? quote : `${quote}。`)).join('');
  if (filled) return '';
  return guide.learnerTurns
    .map((text) => text.trim())
    .filter((text) => text && text !== '（不会）')
    .join('\n');
}

// One turn of the conversation at a stop: answer what the learner said and keep track of what they have covered.
export async function followUp(client, segments, body, { solver, save } = {}) {
  const stop = segments?.find((segment) => segment.type === 'stop' && segment.id === body?.stopId);
  const solution = stop ? await solutionFor(solver, segments, stop, save) : null;
  const guide = segments && prepareGuide(body, segments, solution);
  if (!guide) throw new RequestError(400, '笔记停顿或回答无效，每次回答最多 4000 字符。');
  // Two 「不会」 in a row: show the reference once, then the learner writes it in their own words.
  const unknown = (text) => ['', '（不会）'].includes(text.trim());
  if (
    guide.learnerTurns.length >= 2 &&
    guide.learnerTurns.slice(-2).every(unknown) &&
    !body.thread.some((turn) => turn.shown)
  )
    return {
      verdict: 'wrong',
      reply: `先看老师的写法：\n\n${guide.solution ?? guide.stop.reference}\n\n看完请用你自己的话把它写一遍。`,
      next: 'followup',
      solved: false,
      shown: true,
      state: { covered: guide.covered, plan: '已给出参考写法，等学生用自己的话写一遍。' }
    };
  // Reasoning shares this budget; at the default the JSON was cut off mid-reply.
  const options = { maxTokens: 4000 };
  let reply = await client.complete(guide.messages, guideFormat, options);
  let checked = checkGuide(reply, guide);
  if (checked.error) {
    reply = await client.complete(
      [
        ...guide.messages,
        { role: 'assistant', content: reply },
        {
          role: 'user',
          content: `（这是程序检查，不是学生说的话，学生看不到。）上一版不合格：${checked.error}。按规则重写；reply 里不要提这次检查，也不要道歉。`
        }
      ],
      guideFormat,
      options
    );
    checked = checkGuide(reply, guide, true);
  }
  if (checked.error) throw new RequestError(502, '老师的回复没有通过检查，请重试。');
  return checked.value;
}
