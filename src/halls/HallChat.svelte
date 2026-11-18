<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import CourseForm from './CourseForm.svelte';
  import Say from './Say.svelte';

  // The teacher beside the shelf: what is waiting across courses, what you did lately, and a new course from a file.
  let { courses, onOpen, onChanged, onManual } = $props();

  const accept = '.pdf,.pptx,.md,.markdown,.txt,.html,.htm';
  let activity = $state(null);
  let fresh = $state([]);
  let open = $state(false);
  let picker = $state();
  let dragging = $state(false);
  // A course being started from a file: reading → proposal → creating → created, or error.
  let draft = $state(null);
  let editing = $state(false);

  let parsing = new Set();
  async function refresh() {
    try {
      const next = await api.activity();
      const still = new Set(next.waiting.filter((item) => item.type === 'parsing').map((item) => item.chapterId));
      const failed = new Set(next.waiting.filter((item) => item.type === 'failed').map((item) => item.chapterId));
      for (const item of activity?.waiting ?? [])
        if (item.type === 'parsing' && !still.has(item.chapterId) && !failed.has(item.chapterId))
          fresh = [...fresh, { ...item, type: 'ready' }];
      const wasParsing = parsing.size;
      parsing = still;
      activity = next;
      if (wasParsing && wasParsing !== still.size) onChanged();
    } catch {}
  }
  onMount(() => {
    refresh();
    const timer = setInterval(() => parsing.size && refresh(), 4000);
    return () => clearInterval(timer);
  });

  const waiting = $derived([...fresh, ...(activity?.waiting ?? [])]);
  const greeting = $derived.by(() => {
    if (!courses.length) return '书架还是空的。把一份课件拖到下面，我来开一门课。';
    if (waiting.length) return `有 ${waiting.length} 件事在等你。`;
    const last = activity?.history[0];
    if (last) return `上次读到《${last.course}》，接着来？`;
    return '今天读哪一本？';
  });

  const go = (hash) => (location.hash = hash);
  const chapterPath = (item) => `#/c/${item.slug}/n/${encodeURIComponent(item.chapterId)}`;
  const teachPath = (item) => `#/c/${item.slug}/teach/${item.number}`;

  function line(item) {
    const where = `《${item.course}》第 ${item.number} 章`;
    if (item.type === 'parsing') return `${where}「${item.title}」我还在读…`;
    if (item.type === 'ready') return `${where}「${item.title}」写好了。`;
    if (item.type === 'failed') return `${where}没读成：${item.error ?? '请重新解析。'}`;
    if (item.type === 'note') return `${where}「${item.title}」还有 ${item.left} 处停顿没写完。`;
    if (item.type === 'ask') return `${where}写完了，学生想问你几个问题。`;
    return `${where}有 ${item.count} 个问题该回访了。`;
  }

  function past(item) {
    if (item.type === 'finished') return `写完了「${item.title}」`;
    if (item.type === 'taught') return `讲清了「${item.question}」`;
    return `在「${item.label ?? item.title}」答对了${item.rounds > 1 ? `（第 ${item.rounds} 次）` : ''}`;
  }

  function when(time) {
    const minutes = Math.round((Date.now() - time) / 60_000);
    if (minutes < 2) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const date = new Date(time);
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000);
    const clock = date.toTimeString().slice(0, 5);
    if (days === 0) return `今天 ${clock}`;
    if (days === 1) return `昨天 ${clock}`;
    if (days < 7) return `${days} 天前`;
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }

  async function read(file) {
    if (!file || draft?.phase === 'reading' || draft?.phase === 'creating') return;
    open = true;
    draft = { file, phase: 'reading' };
    try {
      const proposal = await api.propose(file);
      if (draft?.file === file) draft = { file, phase: 'proposal', proposal };
    } catch (failure) {
      if (draft?.file === file) draft = { file, phase: 'error', message: failure.message };
    } finally {
      if (picker) picker.value = '';
    }
  }

  async function create(fields) {
    const { file, proposal } = draft;
    draft = { file, proposal, phase: 'creating' };
    try {
      const course = await api.createCourse(fields);
      await api.upload(course.slug, file, { title: proposal.chapterTitle });
      draft = { file, phase: 'created', course };
      onChanged();
      refresh();
    } catch (failure) {
      draft = { file, proposal, phase: 'error', message: failure.message };
    }
  }

  function drop(event) {
    event.preventDefault();
    dragging = false;
    read(event.dataTransfer?.files?.[0]);
  }

  const fields = (proposal) =>
    [
      ['课程', proposal.name],
      ['简称', proposal.code],
      ['学期', proposal.term],
      ['教师', proposal.teacher],
      ['第一章', proposal.chapterTitle],
      ['简介', proposal.description]
    ].filter(([, value]) => value);
</script>

<aside class="hall-chat" class:open aria-label="老师">
  <div class="chat-thread">
    {#key greeting}
      <Say text={greeting}>
        {#if !waiting.length && activity?.history[0]}
          <button class="reply-chip" onclick={() => onOpen(activity.history[0].slug)}>接着读</button>
        {/if}
      </Say>
    {/key}

    {#each waiting as item, index (item.type + item.chapterId)}
      <div class="say compact" class:extra={index > 0}>
        <span class="say-mark" aria-hidden="true">讲</span>
        <div class="say-body">
          <p class="say-bubble" class:busy={item.type === 'parsing'}>{line(item)}</p>
          <div class="say-replies">
            {#if item.type === 'note' || item.type === 'ready'}
              <button class="reply-chip" onclick={() => go(chapterPath(item))}
                >{item.type === 'note' ? '接着写' : '去读'}</button
              >
            {:else if item.type === 'ask' || item.type === 'review'}
              <button class="reply-chip" onclick={() => go(teachPath(item))}>去讲</button>
            {:else if item.type === 'failed'}
              <button class="reply-chip" onclick={() => onOpen(item.slug)}>去看看</button>
            {/if}
          </div>
        </div>
      </div>
    {/each}

    {#if activity?.history.length}
      <section class="chat-history extra" aria-label="最近">
        <h2>最近</h2>
        <ol>
          {#each activity.history as item (item.type + item.chapterId + item.time)}
            <li>
              <time>{when(item.time)}</time>
              <span>{past(item)}<small>《{item.course}》</small></span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if draft}
      <div class="say compact mine">
        <span class="say-mark" aria-hidden="true">我</span>
        <div class="say-body"><p class="say-bubble">⇪ {draft.file.name}</p></div>
      </div>
      {#if draft.phase === 'reading'}
        <Say text="我翻一下这份课件…" />
      {:else if draft.phase === 'proposal' || draft.phase === 'creating'}
        <Say text="这像是一门新课，我这样记：">
          <dl class="proposal">
            {#each fields(draft.proposal) as [label, value] (label)}
              <div>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            {/each}
          </dl>
          <button class="reply-chip" disabled={draft.phase === 'creating'} onclick={() => create(draft.proposal)}
            >{draft.phase === 'creating' ? '正在装订…' : '就这样开课'}</button
          >
          <button class="reply-chip" disabled={draft.phase === 'creating'} onclick={() => (editing = true)}
            >改一改</button
          >
          <button class="reply-chip" disabled={draft.phase === 'creating'} onclick={() => (draft = null)}>算了</button>
        </Say>
      {:else if draft.phase === 'created'}
        <Say text="开好了。第一章我这就去读，读完在这里告诉你。">
          <button class="reply-chip" onclick={() => onOpen(draft.course.slug)}>打开《{draft.course.name}》</button>
        </Say>
      {:else if draft.phase === 'error'}
        <Say text={draft.message}>
          {#if draft.proposal}
            <button class="reply-chip" onclick={() => (draft = { ...draft, phase: 'proposal' })}>再试一次</button>
          {:else}
            <button class="reply-chip" onclick={() => read(draft.file)}>再读一次</button>
          {/if}
          <button class="reply-chip" onclick={() => (draft = null)}>算了</button>
        </Say>
      {/if}
    {/if}
  </div>

  <button class="chat-toggle" onclick={() => (open = !open)}
    >{open ? '收起' : waiting.length > 1 ? `展开（还有 ${waiting.length - 1} 件）` : '展开'}</button
  >

  <label
    class="chat-drop extra"
    class:dragging
    ondragover={(event) => {
      event.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={drop}
  >
    <input
      bind:this={picker}
      class="screen-reader"
      type="file"
      {accept}
      onchange={(event) => read(event.currentTarget.files?.[0])}
    />
    <span class="upload-icon" aria-hidden="true">⇪</span>
    <span>把课件拖到这里，开一门新课</span>
  </label>
  <button class="link-button chat-manual extra" onclick={onManual}>不用课件，手动填写</button>
</aside>

{#if editing && draft?.proposal}
  <CourseForm
    initial={draft.proposal}
    heading="改一改再开课"
    submitLabel="开课"
    savingLabel="正在装订…"
    onSubmit={async (values) => {
      editing = false;
      await create({ ...values, chapterTitle: draft.proposal.chapterTitle });
    }}
    onClose={() => (editing = false)}
  />
{/if}
