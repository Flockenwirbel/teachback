<script>
  import { untrack } from 'svelte';
  import StopBubble from './StopBubble.svelte';
  import { math, renderMarkdown } from '../lib/markdown.js';
  import { notesOf, prefs, saveProgress, setPrefs } from '../lib/progress.js';
  import { typewriter } from '../lib/typewriter.js';

  let { course, chapterId, onOpen, onHall, onSwitch } = $props();

  const files = `./files/${course.slug}`;
  // Every chapter with a written note is one note on the desk.
  const notes = $derived(
    course.chapters
      .filter((chapter) => chapter.status === 'ready')
      .map((chapter) => ({
        ...chapter,
        unit: chapter.title,
        title: chapter.noteTitle ?? chapter.title,
        chapter: chapter.number
      }))
  );

  const speeds = [
    ['慢', 18],
    ['中', 40],
    ['快', 90],
    ['即时', Infinity]
  ];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Answers written after the desk opened are inked in and sealed; restored ones just sit on the page.
  const openedAt = Date.now();

  let storageError = $state(false);
  // The desk starts from the saved answers once, then owns them.
  const saved = untrack(() => ({ notes: structuredClone(notesOf(course)), prefs: prefs(course) }));
  let progress = $state(saved.notes);
  const selected = $derived(chapterId);
  let speed = $state(saved.prefs.speed ?? (reducedMotion ? 3 : 1));
  let skip = $state(0);
  let opened = $state({});

  $effect(() => setPrefs(course, { speed }));
  $effect(() => {
    for (const [id, sheet] of Object.entries(progress))
      saveProgress(course, 'note', id, sheet, () => (storageError = true));
  });

  const blank = { pos: 0, answers: {}, threads: {}, drafts: {} };
  const note = $derived(notes.find((entry) => entry.id === selected));
  const sheet = $derived({ ...blank, ...progress[selected] });
  const chapter = $derived(course.chapters.find((entry) => entry.id === note.id));
  const stops = $derived(note.segments.filter((segment) => segment.type === 'stop'));
  const finished = $derived(sheet.pos >= note.segments.length);
  const typing = $derived(!finished && note.segments[sheet.pos].type === 'text');
  // The pen rests at the end of the last text written so far.
  const caretAt = $derived(
    note.segments.findLastIndex((segment, index) => segment.type === 'text' && index <= sheet.pos)
  );
  const answerTexts = $derived(
    Object.fromEntries(Object.entries(sheet.answers).map(([id, answer]) => [id, answer.text]))
  );

  function patch(id, values) {
    progress[id] = { ...blank, ...progress[id], ...values, updatedAt: Date.now() };
  }

  function typed(id, index) {
    if ((progress[id]?.pos ?? 0) === index) patch(id, { pos: index + 1 });
  }

  function solved(stop, index, text, rounds) {
    const { threads, drafts } = sheet;
    patch(selected, {
      pos: index + 1,
      answers: { ...sheet.answers, [stop.id]: { text, rounds, thread: threads[stop.id] ?? [], at: Date.now() } },
      threads: { ...threads, [stop.id]: undefined },
      drafts: { ...drafts, [stop.id]: undefined }
    });
  }

  function countFor(id) {
    const entry = notes.find((note) => note.id === id);
    const answered = Object.keys(progress[id]?.answers ?? {}).length;
    return `${answered} / ${entry.segments.filter((segment) => segment.type === 'stop').length}`;
  }

  function restart() {
    if (confirm('清空这篇笔记里你写下的回答，从头重写？')) progress[selected] = { ...blank };
  }

  function exportNote() {
    const parts = [`# ${note.title}`, `> ${course.name} · ${note.unit}`];
    for (const segment of note.segments.slice(0, sheet.pos)) {
      if (segment.type === 'text') parts.push(segment.md);
      else {
        const answer = sheet.answers[segment.id];
        const source = segment.slide ? `\n>\n> 课件：${segment.slide.file} 第 ${segment.slide.page} 页` : '';
        parts.push(`> **${segment.label}**\n>\n> ${answer.text.replaceAll('\n', '\n> ')}${source}`);
      }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([parts.join('\n\n') + '\n'], { type: 'text/markdown' }));
    link.download = `${note.id}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
</script>

<div class="app">
  <aside class="queue" aria-label="笔记清单">
    <button class="brand back-to-hall" onclick={onHall}>
      <span class="brand-mark" aria-hidden="true">讲</span>
      <span>← 章节大厅<small>{course.name}</small></span>
    </button>
    <div class="mode-switch" role="group" aria-label="练习方式">
      <button class="active" aria-pressed="true">老师带我</button>
      <button aria-pressed="false" onclick={() => onSwitch(note.chapter)}>我讲给学生</button>
    </div>
    <div class="chapter-side">
      <span class="chapter-side-number">第 {note.chapter} 章</span>
      <strong>{chapter?.title ?? note.unit}</strong>
      {#if chapter?.summary}<p>{chapter.summary}</p>{/if}
    </div>
    <div class="queue-items">
      <h3>本课笔记 <span>{notes.length} 篇</span></h3>
      {#each notes as entry (entry.id)}
        <button
          class:chosen={selected === entry.id}
          aria-current={selected === entry.id ? 'true' : undefined}
          onclick={() => onOpen(entry.id)}
        >
          <span class="problem-number">{String(entry.number).padStart(2, '0')}</span>
          <span
            >{entry.title}<small class="tone-{progress[entry.id]?.pos >= entry.segments.length ? 'done' : 'active'}"
              >{countFor(entry.id)} 处停顿{entry.sample ? ' · 示例' : ''}</small
            ></span
          >
        </button>
      {/each}
    </div>
    <div class="queue-foot">
      {#if chapter?.source}
        <a href="{files}/{chapter.source}" target="_blank" rel="noreferrer">本章课件 ↗</a>
      {/if}
      {#if storageError}<span>进度没能保存，刷新前请先导出笔记。</span>{/if}
    </div>
  </aside>

  <main class="note-main" aria-labelledby="note-title">
    <header class="note-head">
      <div class="chat-title">
        <span class="crumbs"><span>{note.unit}</span><span>课程笔记</span></span>
        <h1 id="note-title">{note.title}</h1>
      </div>
      <div class="note-tools">
        <div class="speed" role="group" aria-label="书写速度">
          {#each speeds as [label], index}
            <button class:active={speed === index} aria-pressed={speed === index} onclick={() => (speed = index)}
              >{label}</button
            >
          {/each}
        </div>
      </div>
      <ol class="stop-dots" aria-label="停顿进度">
        {#each stops as stop, index (stop.id)}
          {@const done = Boolean(sheet.answers[stop.id])}
          {@const now = !done && note.segments[sheet.pos]?.id === stop.id}
          <li class:done class:now title={stop.label}>
            <span aria-hidden="true">{done ? '✓' : index + 1}</span><span class="dot-label">{stop.label}</span>
          </li>
        {/each}
      </ol>
    </header>

    {#key selected}
      <!-- Clicking the page finishes the sentence being written. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <article class="note-doc" class:is-typing={typing} onclick={() => typing && skip++}>
        {#each note.segments.slice(0, sheet.pos + 1) as segment, index (index)}
          {#if segment.type === 'text'}
            <div
              class="note-text prose"
              use:typewriter={{
                html: renderMarkdown(segment.md),
                mode: index < sheet.pos ? 'done' : 'type',
                cps: speeds[speed][1],
                skip,
                caret: index === caretAt,
                onDone: () => typed(note.id, index)
              }}
            ></div>
          {:else if sheet.answers[segment.id]}
            {@const answer = sheet.answers[segment.id]}
            <figure class="note-answer" class:fresh={answer.at > openedAt}>
              <figcaption>{segment.label}</figcaption>
              <p use:math>{answer.text}</p>
              <div class="answer-meta">
                <span>{answer.rounds > 1 ? `第 ${answer.rounds} 次答对` : '一次答对'}</span>
                <button
                  class="link-button"
                  aria-expanded={Boolean(opened[segment.id])}
                  onclick={() => (opened[segment.id] = !opened[segment.id])}>对照老师的写法</button
                >
                {#if segment.slide}
                  <a href="{files}/{segment.slide.file}#page={segment.slide.page}" target="_blank" rel="noreferrer"
                    >课件第 {segment.slide.page} 页 ↗</a
                  >
                {/if}
              </div>
              {#if opened[segment.id]}
                <div class="answer-ref prose" use:math>{@html renderMarkdown(segment.reference)}</div>
              {/if}
            </figure>
          {:else}
            <StopBubble
              courseSlug={course.slug}
              chapterId={note.id}
              stop={segment}
              number={stops.indexOf(segment) + 1}
              total={stops.length}
              answers={answerTexts}
              thread={sheet.threads[segment.id] ?? []}
              draft={sheet.drafts[segment.id]}
              onThread={(thread) => patch(note.id, { threads: { ...sheet.threads, [segment.id]: thread } })}
              onDraft={(draft) => patch(note.id, { drafts: { ...sheet.drafts, [segment.id]: draft } })}
              onSolved={(text, rounds) => solved(segment, index, text, rounds)}
            />
          {/if}
        {/each}

        {#if finished}
          <footer class="note-end">
            <p>写完了。</p>
            <div>
              <button class="primary" onclick={exportNote}>导出 Markdown</button>
              <button class="secondary" onclick={restart}>从头重写</button>
            </div>
          </footer>
        {/if}
      </article>
    {/key}
    {#if !finished && sheet.pos > 0}
      <p class="note-foot"><button class="link-button" onclick={restart}>从头重写这篇笔记</button></p>
    {/if}
  </main>
</div>
