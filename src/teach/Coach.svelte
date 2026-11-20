<script>
  import { onDestroy, untrack } from 'svelte';
  import { math } from '../lib/markdown.js';

  let { courseSlug, itemId, answer, turns, waiting, onWaiting, onReply, onDraft, extra } = $props();
  const verdictLabels = { correct: '讲清了', incorrect: '有一步要修正', incomplete: '还想追问' };
  let error = $state('');
  // The learner's message shows at once, while the student is still answering it.
  let pending = $state(null);
  // Messages already there when the question opened sit still; new ones pop in.
  const seen = untrack(() => turns.length);
  const shownTurns = $derived(pending ? [...turns, pending] : turns);
  const messagesOf = (turn) => (turn.reply == null ? [] : [turn.reply].flat());

  // A batch of messages arrives one by one, the student typing before each next one.
  let shown = $state(Infinity);
  let revealTimer;
  const typingTime = (message) => Math.min(2200, 400 + 35 * message.length);
  function reveal(messages, count = 1) {
    shown = count;
    if (count < messages.length)
      revealTimer = setTimeout(() => reveal(messages, count + 1), typingTime(messages[count]));
    else shown = Infinity;
  }
  onDestroy(() => clearTimeout(revealTimer));
  const typing = $derived(waiting || shown < messagesOf(turns.at(-1) ?? {}).length);

  async function ask(intent) {
    const message = answer?.trim();
    if (waiting || !message) return;
    onWaiting(true);
    error = '';
    clearTimeout(revealTimer);
    shown = Infinity;
    pending = { user: message, intent };
    onDraft('');
    let sent = false;
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
      sent = true;
      reveal(messagesOf(result));
    } catch {
      error = '无法连接本地服务，请确认它正在运行。';
    } finally {
      pending = null;
      // An unsent message goes back into the input, unless something new is being written there.
      if (!sent && !(answer ?? '').trim()) onDraft(message);
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
  {#each shownTurns as turn, turnIndex (turnIndex)}
    <div class="msg user" class:pop={turnIndex >= seen}>
      <div class="bubble">
        {#if turn.intent === 'dispute' || turn.intent === 'revise'}
          <span class="who">{turn.intent === 'dispute' ? '异议' : '补充讲解'}</span>
        {/if}
        <p use:math>{turn.user}</p>
      </div>
    </div>
    <!-- A reply comes as one or more chat messages; replies saved before that are one string. -->
    {#each turnIndex === turns.length - 1 ? messagesOf(turn).slice(0, shown) : messagesOf(turn) as message, index}
      <div class="msg bot" class:follow={index > 0} class:pop={turnIndex >= seen}>
        <span class="avatar" aria-hidden="true">生</span>
        <div class="bubble">
          {#if index === 0}<span class="who verdict-{turn.verdict}">学生 · {verdictLabels[turn.verdict]}</span>{/if}
          <p use:math>{message}</p>
        </div>
      </div>
    {/each}
  {/each}
  {#if typing}
    <div class="msg bot pop" class:follow={!waiting}>
      <span class="avatar" aria-hidden="true">生</span>
      <div class="bubble typing" role="status">
        <span class="screen-reader">学生正在输入</span><i></i><i></i><i></i>
      </div>
    </div>
  {/if}
</div>

<div class="composer">
  {#if error}<p class="coach-error" role="alert">{error}</p>{/if}
  <textarea
    aria-label="给学生的讲解"
    placeholder={turns.length
      ? '补充讲解或指出判定有误的地方…（公式用 \\(…\\)）'
      : '像给刚学这章的同学一样讲解…（公式用 \\(…\\)）'}
    rows="3"
    maxlength="12000"
    disabled={waiting}
    value={answer ?? ''}
    oninput={(event) => onDraft(event.currentTarget.value)}
    onkeydown={shortcut}></textarea>
  {#if /\\\(|\\\[|\$/.test(answer ?? '')}
    {#key answer}
      <p class="stop-preview" use:math>{answer}</p>
    {/key}
  {/if}
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
