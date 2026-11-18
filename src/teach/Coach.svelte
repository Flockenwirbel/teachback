<script>
  import { math } from '../lib/markdown.js';

  let { courseSlug, itemId, answer, turns, waiting, onWaiting, onReply, onDraft, extra } = $props();
  const verdictLabels = { correct: '讲清了', incorrect: '有一步要修正', incomplete: '还想追问' };
  let error = $state('');

  async function ask(intent) {
    const message = answer?.trim();
    if (waiting || !message) return;
    onWaiting(true);
    error = '';
    try {
      const history = turns.length <= 5 ? turns : [turns[0], ...turns.slice(-4)];
      const response = await fetch('./api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: courseSlug, id: itemId, stage: 'teach', history, answer: message, intent })
      });
      const result = await response.json();
      if (!response.ok) {
        error = result.error ?? '请求失败，请重试。';
        return;
      }
      onReply([...turns, { user: message, reply: result.reply, verdict: result.verdict, intent }]);
      onDraft('');
    } catch {
      error = '无法连接本地服务，请确认它正在运行。';
    } finally {
      onWaiting(false);
    }
  }

  function shortcut(event) {
    if (!event.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      ask(turns.length ? 'revise' : undefined);
    }
  }
</script>

<div class="turns" aria-live="polite">
  {#each turns as turn}
    <div class="msg user">
      <div class="bubble">
        {#if turn.intent === 'dispute' || turn.intent === 'revise'}
          <span class="who">{turn.intent === 'dispute' ? '异议' : '补充讲解'}</span>
        {/if}
        <p use:math>{turn.user}</p>
      </div>
    </div>
    <div class="msg bot">
      <span class="avatar" aria-hidden="true">生</span>
      <div class="bubble">
        <span class="who verdict-{turn.verdict}">学生 · {verdictLabels[turn.verdict]}</span>
        <p use:math>{turn.reply}</p>
      </div>
    </div>
  {/each}
  {#if waiting}
    <div class="msg bot">
      <span class="avatar" aria-hidden="true">生</span>
      <div class="bubble typing" role="status">学生正在看你的讲解…</div>
    </div>
  {/if}
</div>

<div class="composer">
  {#if error}<p class="coach-error" role="alert">{error}</p>{/if}
  <textarea
    aria-label="给学生的讲解"
    placeholder={turns.length ? '补充讲解或指出判定有误的地方…' : '像给刚学这章的同学一样讲解…'}
    rows="3"
    maxlength="12000"
    disabled={waiting}
    value={answer ?? ''}
    oninput={(event) => onDraft(event.currentTarget.value)}
    onkeydown={shortcut}></textarea>
  <div class="composer-row">
    <button class="send" disabled={waiting || !answer?.trim()} onclick={() => ask(turns.length ? 'revise' : undefined)}>
      {turns.length ? '补充讲解' : '回答学生'}
    </button>
    {#if turns.length}
      <button class="secondary quiet" disabled={waiting || !answer?.trim()} onclick={() => ask('dispute')}>
        提出异议并复核
      </button>
    {/if}
    {@render extra?.()}
  </div>
</div>
