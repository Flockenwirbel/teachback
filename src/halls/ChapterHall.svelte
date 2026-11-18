<script>
  import { api } from '../lib/api.js';
  import { forgetCourse, notesOf, teachOf } from '../lib/progress.js';
  import CourseForm from './CourseForm.svelte';
  import Say from './Say.svelte';

  let { course, onBack, onOpen, onTeach, onChanged, onDeleted } = $props();

  const accept = '.pdf,.pptx,.md,.markdown,.txt,.html,.htm';
  const files = $derived(`./files/${course.slug}`);
  const today = new Date().toISOString().slice(0, 10);
  const noteProgress = $derived(notesOf(course));
  const teachRecords = $derived(teachOf(course));

  let bank = $state([]);
  let busy = $state({});
  let failures = $state({});
  let dragging = $state(false);
  let uploadTitle = $state('');
  let uploadError = $state('');
  let uploading = $state(false);
  let picker = $state();

  // A chapter seen parsing that turns ready gets the seal as it arrives.
  const seenParsing = new Set();
  let justReady = $state({});
  $effect(() => {
    for (const chapter of course.chapters) {
      if (chapter.status === 'parsing') seenParsing.add(chapter.id);
      else if (seenParsing.delete(chapter.id) && chapter.status === 'ready') justReady[chapter.id] = true;
    }
  });

  $effect(() => {
    api.questions(course.slug).then(
      (rows) => (bank = rows),
      () => {}
    );
  });

  const chapters = $derived(
    course.chapters.map((chapter) => {
      const saved = noteProgress[chapter.id];
      const answered = Object.keys(saved?.answers ?? {}).length;
      const items = bank.filter((item) => item.chapter === chapter.number);
      let status = chapter.status;
      if (status === 'ready') {
        const done = saved?.pos != null && answered >= chapter.stops && chapter.stops > 0;
        status = done ? 'done' : saved?.pos ? 'active' : 'ready';
      }
      return {
        ...chapter,
        state: status,
        answered,
        updatedAt: saved?.updatedAt ?? 0,
        items: items.length,
        taught: items.filter((item) => teachRecords[item.id]?.passed).length,
        upcoming: Boolean(chapter.date && chapter.date > today)
      };
    })
  );
  const ready = $derived(chapters.filter((chapter) => chapter.status === 'ready'));
  const reading = $derived(chapters.find((chapter) => chapter.status === 'parsing'));
  const resume = $derived(
    chapters.filter((chapter) => chapter.state === 'active').sort((a, b) => b.updatedAt - a.updatedAt)[0]
  );
  const totals = $derived({
    done: chapters.filter((chapter) => chapter.state === 'done').length,
    ready: ready.length,
    answered: ready.reduce((sum, chapter) => sum + chapter.answered, 0),
    stops: ready.reduce((sum, chapter) => sum + chapter.stops, 0)
  });
  const statusLabels = {
    empty: '笔记待生成',
    parsing: '老师在读课件',
    failed: '解析失败',
    ready: '可以开始',
    active: '写到一半',
    done: '已写完'
  };

  function shortDate(date) {
    const [, month, day] = date.split('-');
    return `${Number(month)}/${Number(day)}`;
  }

  async function act(id, work) {
    busy[id] = true;
    failures[id] = '';
    try {
      await work();
      onChanged();
    } catch (failure) {
      failures[id] = failure.message;
    } finally {
      busy[id] = false;
    }
  }

  const parse = (chapter) => act(chapter.id, () => api.parse(course.slug, chapter.id));
  const attach = (chapter, file) =>
    file && act(chapter.id, () => api.upload(course.slug, file, { chapterId: chapter.id }));
  function remove(chapter) {
    if (confirm(`删除「${chapter.title}」这一章和它的笔记？`))
      act(chapter.id, () => api.removeChapter(course.slug, chapter.id));
  }

  let editing = $state(false);
  async function saveCourse(fields) {
    await api.updateCourse(course.slug, fields);
    editing = false;
    onChanged();
  }

  let deleting = $state(false);
  let deleteError = $state('');
  async function removeCourse() {
    if (!confirm(`删除「${course.name}」？章节、笔记和课件会一起删除。`)) return;
    deleting = true;
    deleteError = '';
    try {
      await api.deleteCourse(course.slug);
      forgetCourse(course);
      onDeleted();
    } catch (failure) {
      deleteError = failure.message;
      deleting = false;
    }
  }

  async function upload(file) {
    if (!file || uploading) return;
    uploading = true;
    uploadError = '';
    try {
      await api.upload(course.slug, file, { title: uploadTitle.trim() });
      uploadTitle = '';
      onChanged();
    } catch (failure) {
      uploadError = failure.message;
    } finally {
      uploading = false;
      if (picker) picker.value = '';
    }
  }

  function drop(event) {
    event.preventDefault();
    dragging = false;
    upload(event.dataTransfer?.files?.[0]);
  }
</script>

<div class="hall">
  <header class="hall-head stagger">
    <button class="hall-brand hall-back" onclick={onBack}>
      <span class="brand-mark" aria-hidden="true">讲</span>
      <div>
        <p class="hall-kicker">← 课程大厅</p>
        <h1>{course.name}</h1>
      </div>
    </button>
    <p class="course-line">{[course.term, course.teacher, course.description].filter(Boolean).join(' · ')}</p>
    <dl class="hall-totals">
      <div>
        <dt>写完的笔记</dt>
        <dd><strong>{totals.done}</strong> / {totals.ready}</dd>
      </div>
      <div>
        <dt>答对的停顿</dt>
        <dd><strong>{totals.answered}</strong> / {totals.stops}</dd>
      </div>
      <div>
        <dt>章节</dt>
        <dd><strong>{chapters.length}</strong></dd>
      </div>
    </dl>
  </header>

  {#if resume}
    <Say text="《{resume.noteTitle ?? resume.title}》写到第 {resume.answered + 1} 处停顿了，接着写？">
      <button class="reply-chip" onclick={() => onOpen(resume.id)}>接着写</button>
    </Say>
  {:else if reading}
    <Say text="我在读《{reading.source}》，写好了叫你。" />
  {:else if !chapters.length}
    <Say text="这门课还是空的。把第一章的课件给我吧。">
      <button class="reply-chip" onclick={() => picker?.click()}>选一份课件</button>
    </Say>
  {:else if !ready.length}
    <Say text="课件我还没读。挑一章交给我？" />
  {:else}
    <Say text="挑一章，我们从头写。" />
  {/if}

  <ol class="chapter-grid stagger">
    {#each chapters as chapter (chapter.id)}
      <li
        class="chapter-card status-{chapter.state}"
        class:upcoming={chapter.upcoming}
        class:just-ready={justReady[chapter.id]}
        aria-busy={chapter.status === 'parsing'}
      >
        {#if justReady[chapter.id]}<span class="seal" aria-hidden="true">成稿</span>{/if}
        <div class="chapter-top">
          <span class="chapter-number" aria-hidden="true">{String(chapter.number).padStart(2, '0')}</span>
          <span class="chapter-status">{statusLabels[chapter.state]}</span>
        </div>
        <h2>
          {#if chapter.status === 'ready'}
            <button class="chapter-open" onclick={() => onOpen(chapter.id)}>
              <span class="screen-reader">第 {chapter.number} 章 </span>{chapter.title}
            </button>
          {:else}
            <span class="screen-reader">第 {chapter.number} 章 </span>{chapter.title}
          {/if}
        </h2>
        {#if chapter.summary}<p class="chapter-summary">{chapter.summary}</p>{/if}

        {#if chapter.status === 'ready'}
          <div class="chapter-note">
            <span
              class="note-mark"
              class:done={chapter.state === 'done'}
              class:started={chapter.state === 'active'}
              aria-hidden="true"
            ></span>
            <span class="note-name">{chapter.noteTitle ?? chapter.title}{chapter.sample ? ' · 示例' : ''}</span>
            <span class="note-count">{chapter.answered}/{chapter.stops}</span>
          </div>
          <div class="chapter-bar" aria-hidden="true">
            <span style="width: {chapter.stops ? (chapter.answered / chapter.stops) * 100 : 0}%"></span>
          </div>
        {:else if chapter.status === 'parsing'}
          <div class="chapter-reading" role="status">
            <svg class="ink-write" viewBox="0 0 132 26" aria-hidden="true">
              <path d="M2 15 C 12 3, 18 24, 30 13 S 46 3, 56 14 S 74 24, 84 11 S 102 5, 112 15 L 128 12" />
              <circle r="2.2" />
            </svg>
            正在读《{chapter.source}》
          </div>
        {:else}
          <div class="chapter-actions">
            {#if chapter.status === 'failed'}<p class="chapter-error">{chapter.error}</p>{/if}
            {#if chapter.source}
              <button class="primary" disabled={busy[chapter.id]} onclick={() => parse(chapter)}>
                {chapter.status === 'failed' ? '让老师重读课件' : '让老师读课件，写成笔记'}
              </button>
            {/if}
            <label class="secondary quiet file-button" class:disabled={busy[chapter.id]}>
              {chapter.source ? '换一份课件' : '上传课件生成笔记'}
              <input
                type="file"
                {accept}
                disabled={busy[chapter.id]}
                onchange={(event) => attach(chapter, event.currentTarget.files?.[0])}
              />
            </label>
            {#if failures[chapter.id]}<p class="chapter-error" role="alert">{failures[chapter.id]}</p>{/if}
          </div>
        {/if}

        <div class="chapter-foot">
          {#if chapter.date}<span
              >{chapter.upcoming ? `${shortDate(chapter.date)} 开讲` : `${shortDate(chapter.date)} 已讲`}</span
            >{/if}
          {#if chapter.source}
            <a href="{files}/{chapter.source}" target="_blank" rel="noreferrer">课件 ↗</a>
          {/if}
          {#if chapter.items}
            <button class="link-button" onclick={() => onTeach(chapter.number)}
              >讲给学生 {chapter.taught}/{chapter.items}</button
            >
          {:else if chapter.status === 'ready'}
            <button class="link-button" onclick={() => onTeach(chapter.number)}>让学生来问</button>
          {/if}
          {#if chapter.status !== 'parsing'}
            <button class="link-button danger" disabled={busy[chapter.id]} onclick={() => remove(chapter)}>删除</button>
          {/if}
        </div>
      </li>
    {/each}

    <li
      class="chapter-card chapter-upload"
      class:dragging
      ondragover={(event) => {
        event.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={drop}
    >
      <span class="chapter-number" aria-hidden="true">{String(chapters.length + 1).padStart(2, '0')}</span>
      <h2>新建一章</h2>
      <label class="upload-title">标题<input bind:value={uploadTitle} maxlength="60" placeholder="可不填" /></label>
      <label class="upload-drop" class:disabled={uploading}>
        <input
          bind:this={picker}
          type="file"
          {accept}
          disabled={uploading}
          onchange={(event) => upload(event.currentTarget.files?.[0])}
        />
        <span class="upload-icon" aria-hidden="true">⇪</span>
        <span>{uploading ? '正在上传…' : '把文件拖到这里，或点击选择'}</span>
      </label>
      {#if uploadError}<p class="chapter-error" role="alert">{uploadError}</p>{/if}
    </li>
  </ol>
  <div class="hall-foot hall-foot-row">
    <button class="link-button" onclick={() => (editing = true)}>编辑课程信息</button>
    <button class="link-button danger" disabled={deleting} onclick={removeCourse}
      >{deleting ? '正在删除…' : '删除这门课'}</button
    >
  </div>
  {#if deleteError}<p class="chapter-error" role="alert">{deleteError}</p>{/if}
  {#if editing}
    <CourseForm
      initial={{
        name: course.name,
        code: course.code,
        term: course.term,
        teacher: course.teacher,
        description: course.description
      }}
      heading="修改课程信息"
      submitLabel="保存"
      savingLabel="正在保存…"
      onSubmit={saveCourse}
      onClose={() => (editing = false)}
    />
  {/if}
</div>
