<script>
  import { onMount, tick, untrack } from 'svelte';
  import { math, renderMarkdown } from '../lib/markdown.js';
  import { readerAway } from '../lib/typewriter.js';

  let { courseSlug, chapterId, stop, number, total, answers, thread, draft, onThread, onDraft, onSolved } = $props();
  const kinds = { concept: '概念澄清', derive: '推导计算', contrast: '方法辨析' };

  let bubble = $state();
  let input = $state();
  let tail = $state(28);
  let waiting = $state(false);
  let closing = $state(false);
  let error = $state('');
  // The learner's message shows at once, while the teacher is still answering it.
  let pending = $state(null);
  // Messages already there when the bubble opened sit still; new ones pop in.
  const seen = untrack(() => thread.length);

  const target = $derived(thread.findLast((turn) => turn.who === 'teacher')?.next ?? 'main');
  const attempts = $derived(
    thread.filter((turn) => turn.who === 'me' && turn.target === 'main' && !turn.settle).length
  );
  const turns = $derived(pending ? [...thread, pending] : thread);

  // The bubble grows out of the pen: its tail sits under the caret left at the end of the text.
  function aim() {
    const pen = bubble?.closest('.note-doc')?.querySelector('.caret');
    if (!bubble || !pen) return;
    const box = bubble.getBoundingClientRect();
    const x = pen.getBoundingClientRect().left - box.left;
    tail = Math.max(22, Math.min(box.width - 22, x));
  }

  onMount(() => {
    aim();
    const later = setTimeout(aim, 350);
    addEventListener('resize', aim);
    input?.focus({ preventScroll: true });
    if (!readerAway(bubble?.closest('.note-doc'))) bubble?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return () => {
      clearTimeout(later);
      removeEventListener('resize', aim);
    };
  });

  // settle: the learner says they have explained it; the teacher re-reads the whole thread and decides.
  async function submit(giveUp = false, settle = false) {
    const text = giveUp || settle ? '' : (draft ?? '').trim();
    if (waiting || closing || (!giveUp && !settle && !text)) return;
    const mine = settle
      ? { who: 'me', target, text: '我已经讲清楚了', settle }
      : { who: 'me', target, text: text || '（不会）' };
    waiting = true;
    error = '';
    pending = mine;
    if (text) onDraft('');
    tick().then(() => bubble?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    const unsent = () => {
      pending = null;
      if (text && !(draft ?? '').trim()) onDraft(text);
    };
    try {
      const response = await fetch('./api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'guide',
          course: courseSlug,
          chapterId,
          stopId: stop.id,
          thread: thread.slice(-24),
          answer: text,
          target,
          settle,
          answers
        })
      });
      const result = await response.json();
      if (!response.ok) {
        error = result.error ?? '请求失败，请重试。';
        unsent();
        return;
      }
      if (result.solved) {
        closing = true;
        setTimeout(
          () =>
            onSolved(
              result.note || text,
              attempts + 1,
              text,
              thread.some((turn) => turn.shown)
            ),
          320
        );
        return;
      }
      onThread([
        ...thread,
        mine,
        {
          who: 'teacher',
          text: result.reply,
          verdict: result.verdict,
          next: result.next,
          shown: result.shown,
          state: result.state
        }
      ]);
      pending = null;
      await tick();
      input?.focus({ preventScroll: true });
      bubble?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
      error = '无法连接本地服务，请确认它正在运行。';
      unsent();
    } finally {
      waiting = false;
    }
  }

  function keydown(event) {
    if (!event.isComposing && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }
</script>

<section
  class="stop-bubble"
  class:closing
  bind:this={bubble}
  style="--tail-x: {tail}px"
  aria-label="停顿 {number}：{stop.label}"
>
  <span class="stop-tail" aria-hidden="true"></span>
  <header class="stop-head">
    <span class="stop-kind kind-{stop.kind}">{kinds[stop.kind] ?? stop.kind}</span>
    <span class="stop-label">{stop.label}</span>
    <span class="stop-count">{number} / {total}</span>
  </header>
  <div class="stop-ask prose" use:math>{@html renderMarkdown(stop.ask)}</div>

  {#if turns.length}
    <ol class="stop-thread" aria-live="polite">
      {#each turns as turn, index (index)}
        <li class="turn-{turn.who}" class:pop={index >= seen}>
          <span class="turn-who">{turn.who === 'teacher' ? '老师：' : '我：'}</span>
          {#if turn.shown}
            <div class="prose" use:math>{@html renderMarkdown(turn.text)}</div>
          {:else}
            <p use:math>{turn.text}</p>
          {/if}
        </li>
      {/each}
      {#if waiting && !closing}
        <li class="turn-teacher typing pop" role="status">
          <span class="turn-who">老师正在回复</span><i></i><i></i><i></i>
        </li>
      {/if}
    </ol>
  {/if}

  <label class="stop-prompt" for="stop-input-{stop.id}">
    {thread.length ? '回复老师' : '你的回答'}
  </label>
  <textarea
    id="stop-input-{stop.id}"
    bind:this={input}
    rows="2"
    maxlength="4000"
    disabled={closing}
    placeholder="公式用 \(…\)"
    value={draft ?? ''}
    oninput={(event) => onDraft(event.currentTarget.value)}
    onkeydown={keydown}></textarea>
  {#if /\\\(|\\\[|\$/.test(draft ?? '')}
    {#key draft}
      <p class="stop-preview" use:math>{draft}</p>
    {/key}
  {/if}
  {#if error}<p class="coach-error" role="alert">{error}</p>{/if}
  <div class="stop-row">
    <span class="stop-keys"></span>
    {#if thread.some((turn) => turn.who === 'me' && !turn.settle)}
      <button class="secondary quiet" disabled={waiting || closing} onclick={() => submit(false, true)}
        >我已经讲清楚了</button
      >
    {/if}
    <button class="secondary quiet" disabled={waiting || closing} onclick={() => submit(true)}>不会</button>
    <button class="send" disabled={waiting || closing || !draft?.trim()} onclick={() => submit()}>提交</button>
  </div>
</section>
