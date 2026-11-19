<script>
  import { onMount, tick } from 'svelte';
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

  const target = $derived(thread.findLast((turn) => turn.who === 'teacher')?.next ?? 'main');
  const attempts = $derived(
    thread.filter((turn) => turn.who === 'me' && turn.target === 'main' && !turn.settle).length
  );
  const lastTeacher = $derived(thread.findLastIndex((turn) => turn.who === 'teacher'));

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
    waiting = true;
    error = '';
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
        return;
      }
      if (result.solved) {
        closing = true;
        setTimeout(() => onSolved(result.note || text, attempts + 1, text), 320);
        return;
      }
      onThread([
        ...thread,
        settle
          ? { who: 'me', target, text: '我已经讲清楚了', settle }
          : { who: 'me', target, text: text || '（不会）' },
        { who: 'teacher', text: result.reply, verdict: result.verdict, next: result.next }
      ]);
      if (!settle) onDraft('');
      await tick();
      input?.focus({ preventScroll: true });
      bubble?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
      error = '无法连接本地服务，请确认它正在运行。';
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

  {#if thread.length}
    <ol class="stop-thread" aria-live="polite">
      {#each thread as turn, index}
        <li class="turn-{turn.who}" class:latest={index === lastTeacher}>
          {#if turn.who === 'teacher'}<span class="turn-who">老师</span>{/if}
          <p use:math>{turn.text}</p>
        </li>
      {/each}
    </ol>
  {/if}

  {#if waiting}
    <p class="stop-wait" role="status">老师在看你的回答<span class="dots" aria-hidden="true"></span></p>
  {/if}

  <label class="stop-prompt" for="stop-input-{stop.id}">
    {target === 'followup' ? '回答追问' : attempts ? '再答一次原问题' : '你的回答'}
  </label>
  <textarea
    id="stop-input-{stop.id}"
    bind:this={input}
    rows="2"
    maxlength="4000"
    disabled={waiting || closing}
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
