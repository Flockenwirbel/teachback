<script>
  import { onMount, tick, untrack } from 'svelte';
  import Coach from './Coach.svelte';
  import AskTeacher from './AskTeacher.svelte';
  import { math, renderMarkdown } from '../lib/markdown.js';
  import { prefs, saveProgress, setPrefs, teachOf } from '../lib/progress.js';

  let { course, bank, chapter = null, regenerating = null, regenerateError = '', onHall, onRegenerate } = $props();

  const groupLabel = '章';
  const files = `./files/${course.slug}`;
  const chapters = [...new Map(bank.map((item) => [item.chapter, item.unit]))];
  const tones = { 待回访: 'due', 讲清了: 'done', 待补充: 'active', 待讲解: 'idle' };

  let storageError = $state(false);
  const saved = untrack(() => prefs(course));
  let records = $state(untrack(() => structuredClone(teachOf(course))));
  let pending = $state({});
  const savedItem = bank.find((item) => item.id === saved.selected);
  const initialSelection =
    chapter && savedItem?.chapter !== chapter
      ? (bank.find((item) => item.chapter === chapter) ?? bank[0]).id
      : (savedItem ?? bank[0]).id;
  let selected = $state(initialSelection);
  let chapterFilter = $state(chapter ?? 'all');
  // Arriving from a chapter card narrows the list to that chapter.
  $effect(() => {
    const target = chapter;
    if (!target) return;
    untrack(() => {
      chapterFilter = target;
      if (item.chapter !== target) selected = bank.find((entry) => entry.chapter === target)?.id ?? selected;
    });
  });
  let query = $state('');
  let view = $state('all');
  let workspace = $state();
  let teacherOpen = $state(false);
  let now = $state(Date.now());

  const item = $derived(bank.find((entry) => entry.id === selected));
  const record = $derived(records[selected] ?? {});
  const currentGroup = $derived(bank.filter((entry) => entry.chapter === item.chapter));
  const next = $derived(bank[bank.indexOf(item) + 1]);
  const masteredCount = $derived(bank.filter((entry) => records[entry.id]?.passed).length);
  const due = $derived(
    bank.filter((entry) => {
      const date = records[entry.id]?.reviewAt;
      return date != null && date <= now && !records[entry.id]?.passed;
    })
  );
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
  const visible = $derived(
    bank.filter((entry) => {
      const matchesChapter = chapterFilter === 'all' || entry.chapter === Number(chapterFilter);
      const matchesView = view === 'all' || (view === 'pending' ? !records[entry.id]?.passed : due.includes(entry));
      const search = `第${entry.chapter}章 ${entry.number} ${entry.title} ${entry.unit} ${entry.questionType}`;
      return matchesChapter && matchesView && search.toLowerCase().includes(query.trim().toLowerCase());
    })
  );
  const groups = $derived(
    chapters
      .map(([chapter, title]) => ({
        chapter,
        title,
        items: visible.filter((entry) => entry.chapter === chapter)
      }))
      .filter((group) => group.items.length)
  );

  $effect(() => setPrefs(course, { selected }));
  // Records are saved per chapter, so a chapter's new questions start from a clean slate.
  $effect(() => {
    const byChapter = {};
    for (const entry of bank) if (records[entry.id]) (byChapter[entry.chapterId] ??= {})[entry.id] = records[entry.id];
    for (const [id, group] of Object.entries(byChapter))
      saveProgress(course, 'teach', id, group, () => (storageError = true));
  });

  function update(values) {
    records[selected] = { ...record, ...values };
  }

  async function choose(id) {
    selected = id;
    teacherOpen = false;
    await tick();
    workspace?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) workspace?.scrollIntoView();
  }

  function reopen() {
    now = Date.now();
    update({ passed: false, reviewAt: now });
  }

  function status(entry) {
    const saved = records[entry.id];
    if (due.includes(entry)) return '待回访';
    if (saved?.passed) return '讲清了';
    if (saved?.turns?.length) return '待补充';
    return '待讲解';
  }

  function saveTurns(id, turns) {
    const passed = turns.at(-1).verdict === 'correct';
    const existing = records[id] ?? {};
    records[id] = {
      ...existing,
      turns,
      passed,
      reviewAt: passed ? null : existing.reviewAt,
      passedAt: passed ? Date.now() : existing.passedAt
    };
  }
</script>

{#snippet bulb()}
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z" />
  </svg>
{/snippet}

{#snippet stageActions()}
  {#if record.passed}
    {#if next}
      <button class="primary" onclick={() => choose(next.id)}>
        {next.chapter === item.chapter ? '下一问' : '进入下一主题'}
      </button>
    {:else}
      <span class="done">✓ 最后一问已讲清</span>
    {/if}
    <button class="secondary" onclick={reopen}>标记需重练</button>
  {/if}
{/snippet}

<div class="app">
  <aside class="queue" aria-labelledby="queue-title">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">讲</span>
      <span>{course.name}<small>你来讲，学生来问</small></span>
    </div>
    <div class="mode-switch" role="group" aria-label="练习方式">
      <button aria-pressed="false" onclick={onHall}>老师带我</button>
      <button class="active" aria-pressed="true">我讲给学生</button>
    </div>
    <div class="score" aria-label="训练进度">
      <span><strong>{masteredCount}</strong> / {bank.length} 已讲清</span>
      <span>{chapters.length} 个主题</span>
      {#if due.length}<span class="due-note">{due.length} 项待回访</span>{/if}
    </div>
    <div class="queue-head">
      <h2 id="queue-title" class="screen-reader">题目清单</h2>
      <label class="screen-reader" for="search">搜索题目</label>
      <input id="search" type="search" placeholder={`搜索 ${bank.length} 个问题`} bind:value={query} />
      <label class="screen-reader" for="chapter">筛选{groupLabel}</label>
      <select id="chapter" bind:value={chapterFilter}>
        <option value="all">全部{groupLabel}</option>
        {#each chapters as [chapter, name]}
          <option value={chapter}>{groupLabel} {chapter} · {name}</option>
        {/each}
      </select>
      <div class="filters" aria-label="进度筛选">
        {#each [['all', '全部'], ['pending', '待讲解'], ['review', '待回访']] as [mode, label]}
          <button class:active={view === mode} aria-pressed={view === mode} onclick={() => (view = mode)}
            >{label}</button
          >
        {/each}
      </div>
    </div>
    <div class="queue-items">
      {#each groups as group}
        <h3>{groupLabel} {group.chapter} <span>{group.title}</span></h3>
        {#each group.items as entry (entry.id)}
          <button
            class:chosen={selected === entry.id}
            aria-current={selected === entry.id ? 'true' : undefined}
            onclick={() => choose(entry.id)}
          >
            <span class="problem-number">{entry.number}</span>
            <span
              >{entry.title}<small class="tone-{tones[status(entry)]}">{entry.questionType} · {status(entry)}</small
              ></span
            >
          </button>
        {/each}
      {:else}
        <p class="empty">当前筛选无题目。</p>
      {/each}
    </div>
    <div class="queue-foot">
      {#each course.chapters.filter((entry) => entry.source) as entry (entry.id)}
        <a href="{files}/{entry.source}" target="_blank" rel="noreferrer">{entry.title} ↗</a>
      {/each}
      {#if storageError}<span>进度没能保存，请确认本地服务在运行。</span>{/if}
    </div>
  </aside>

  <main class="chat" aria-labelledby="item-title" tabindex="-1" bind:this={workspace}>
    <header class="chat-head">
      <div class="chat-title">
        <span class="crumbs"
          ><span>{item.assignment}</span><span>{groupLabel} {item.chapter}</span><span>{item.number}</span></span
        >
        <h1 id="item-title">{item.title}</h1>
      </div>
      <div class="head-actions">
        <span class="status tone-{tones[status(item)]}">{status(item)}</span>
        <button
          class="secondary quiet regen"
          disabled={regenerating !== null}
          title="学生重新读这一章的笔记和你卡过的地方，换四个问题"
          onclick={() => onRegenerate(item.chapterId)}
          >{regenerating === item.chapterId ? '学生在准备新问题…' : '换一批问题'}</button
        >
      </div>
      {#if regenerateError}<p class="coach-error regen-error" role="alert">{regenerateError}</p>{/if}
      <nav class="steps" aria-label="本主题问题">
        {#each currentGroup as step, index (step.id)}
          <button
            aria-current={selected === step.id ? 'step' : undefined}
            class:now={selected === step.id}
            onclick={() => choose(step.id)}
          >
            <span>{records[step.id]?.passed ? '✓' : index + 1}</span>{step.questionType}
          </button>
        {/each}
      </nav>
    </header>

    <div class="thread">
      {#key selected}
        {@const id = selected}
        <div class="msg bot">
          <span class="avatar" aria-hidden="true">生</span>
          <div class="bubble">
            <div class="bubble-head">
              <span class="who">学生 · {item.questionType}{item.fromStruggle ? ' · 来自你在笔记里卡过的地方' : ''}</span
              >
              {#if item.canAskTeacher}
                <button class="ask-teacher" onclick={() => (teacherOpen = true)}>{@render bulb()}问老师</button>
              {/if}
            </div>
            <div class="prose" use:math>{@html renderMarkdown(item.prompt)}</div>
            {#if item.slideFile || item.sourceUrl}
              <div class="source">
                <a href={item.sourceUrl ?? `${files}/${item.slideFile}`} target="_blank" rel="noreferrer"
                  >{item.sourceLabel} ↗</a
                >
              </div>
            {/if}
          </div>
        </div>
        <Coach
          courseSlug={course.slug}
          itemId={id}
          answer={record.draft}
          turns={record.turns ?? []}
          waiting={pending[id] ?? false}
          onWaiting={(waiting) => {
            pending[id] = waiting;
          }}
          onReply={(turns) => saveTurns(id, turns)}
          onDraft={(draft) => {
            records[id] = { ...records[id], draft };
          }}
        >
          {#snippet extra()}{@render stageActions()}{/snippet}
        </Coach>
      {/key}
    </div>
  </main>
</div>

{#if item.canAskTeacher}
  {#key selected}
    <AskTeacher courseSlug={course.slug} itemId={selected} bind:open={teacherOpen} />
  {/key}
{/if}
