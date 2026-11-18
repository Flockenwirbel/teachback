<script>
  import Say from '../halls/Say.svelte';
  import { strugglesFor } from '../lib/progress.js';

  let { course, chapterNumber = null, busy = null, error = '', onGenerate, onHall } = $props();

  const ready = $derived(course.chapters.filter((chapter) => chapter.status === 'ready'));
  const shown = $derived(chapterNumber ? ready.filter((chapter) => chapter.number === chapterNumber) : ready);
  const missing = $derived(chapterNumber && !shown.length);

  // The student speaks: where the learner got stuck in the note is where the student is unsure too.
  function line(chapter, struggles) {
    const labels = struggles
      .map((entry) => chapter.segments.find((segment) => segment.id === entry.stopId)?.label)
      .filter(Boolean);
    if (labels.length)
      return `第 ${chapter.number} 章我读完了。「${labels.join('」「')}」那里我也没太想通，能问问你吗？`;
    return `第 ${chapter.number} 章我读完了，有几个地方想问你。`;
  }
</script>

<div class="hall prep">
  <header class="hall-head">
    <button class="hall-brand hall-back" onclick={onHall}>
      <span class="brand-mark" aria-hidden="true">讲</span>
      <div>
        <p class="hall-kicker">← {course.name}</p>
        <h1>我讲给学生</h1>
      </div>
    </button>
  </header>

  {#if missing || !shown.length}
    <Say mark="生" who="学生" text="这一章的笔记还没写好，我还没法问你。">
      <button class="reply-chip" onclick={onHall}>回去写笔记</button>
    </Say>
  {:else}
    <ul class="prep-list stagger">
      {#each shown as chapter (chapter.id)}
        {@const struggles = strugglesFor(course, chapter)}
        <li>
          <Say mark="生" who="学生" text={busy === chapter.id ? '我在想怎么问…' : line(chapter, struggles)}>
            <button class="reply-chip" disabled={busy !== null} onclick={() => onGenerate(chapter, struggles)}
              >问吧</button
            >
          </Say>
        </li>
      {/each}
    </ul>
    {#if error}<p class="chapter-error" role="alert">{error}</p>{/if}
  {/if}
</div>
