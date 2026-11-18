<script>
  import { math } from '../lib/markdown.js';

  let { courseSlug, itemId, open = $bindable(false) } = $props();
  let dialog;
  let question = $state('');
  let waiting = $state(false);
  let error = $state('');
  let answers = $state([]);

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  async function ask(event) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || waiting) return;
    waiting = true;
    error = '';
    try {
      const response = await fetch('./api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: courseSlug, id: itemId, stage: 'teacher', answer: prompt })
      });
      const result = await response.json();
      if (!response.ok) {
        error = result.error ?? '请求失败，请重试。';
        return;
      }
      answers = [...answers, { question: prompt, points: result.points, reply: result.reply }];
      question = '';
    } catch {
      error = '无法连接本地服务，请确认它正在运行。';
    } finally {
      waiting = false;
    }
  }
</script>

<dialog
  class="teacher-dialog"
  aria-labelledby="teacher-title"
  bind:this={dialog}
  onclose={() => (open = false)}
  onclick={(event) => event.target === dialog && dialog.close()}
>
  <div class="dialog-body">
    <header>
      <h3 id="teacher-title">问老师</h3>
      <button class="close" aria-label="关闭" onclick={() => dialog.close()}>×</button>
    </header>
    <div class="prose" aria-live="polite">
      {#each answers as answer}
        <article class="slide-answer">
          <strong use:math>{answer.question}</strong>
          {#if answer.reply}<p use:math>{answer.reply}</p>{/if}
          {#each answer.points as point}
            <p use:math>{point.explanation}</p>
            <blockquote>
              {point.quote}
              <footer>
                <a href="./files/{courseSlug}/{point.file}#page={point.page}" target="_blank" rel="noreferrer"
                  >{point.file} · PDF 第 {point.page} 页 ↗</a
                >
              </footer>
            </blockquote>
          {/each}
        </article>
      {/each}
    </div>
    <form onsubmit={ask}>
      <label for="teacher-question">你想问什么？</label>
      <textarea
        id="teacher-question"
        rows="3"
        maxlength="2000"
        bind:value={question}
        disabled={waiting}
        placeholder="例如：课件怎么定义这个概念？"></textarea>
      <div class="actions">
        <button class="primary" disabled={waiting || !question.trim()}>发送问题</button>
        {#if waiting}<span role="status">老师正在查阅课件…</span>{/if}
      </div>
    </form>
    {#if error}<p class="coach-error" role="alert">{error}</p>{/if}
  </div>
</dialog>

<style>
  .teacher-dialog {
    width: min(640px, calc(100% - 32px));
    max-height: min(80vh, 760px);
    padding: 0;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 24px 60px rgba(24, 32, 46, 0.25);
  }
  .teacher-dialog::backdrop {
    background: rgba(24, 32, 46, 0.45);
  }
  .dialog-body {
    padding: 20px 24px 22px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h3 {
    margin: 0;
    font-family: var(--song);
    font-weight: 700;
    font-size: 1.3rem;
  }
  .close {
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    font-size: 1.4rem;
    line-height: 1;
  }
  .close:hover {
    background: var(--paper);
    color: var(--ink);
  }
  label {
    display: block;
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 6px;
  }
  .slide-answer {
    border-bottom: 1px solid var(--rule);
    margin-bottom: 14px;
    padding-bottom: 8px;
  }
  blockquote {
    white-space: pre-line;
  }
  footer {
    padding: 4px 0 0;
  }
  .actions {
    margin-top: 10px;
  }
</style>
