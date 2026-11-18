<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import CourseForm from './CourseForm.svelte';
  import { forgetCourse, notesOf } from '../lib/progress.js';
  import HallChat from './HallChat.svelte';

  let { onOpen } = $props();

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let opening = $state(null);

  let courses = $state(null);
  let error = $state('');
  let creating = $state(false);

  // Each course is bound in its own cloth, chosen stably from its slug.
  const covers = ['#6f303a', '#3e5a49', '#46596b', '#5c5a37', '#573849', '#7a4a2b'];
  function cover(slug) {
    let hash = 0;
    for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return covers[hash % covers.length];
  }

  function summary(course) {
    const progress = notesOf(course);
    const ready = course.chapters.filter((chapter) => chapter.status === 'ready');
    const stops = ready.reduce((sum, chapter) => sum + chapter.stops, 0);
    const answered = ready.reduce((sum, chapter) => sum + Object.keys(progress[chapter.id]?.answers ?? {}).length, 0);
    const parsing = course.chapters.filter((chapter) => chapter.status === 'parsing').length;
    return { ready: ready.length, total: course.chapters.length, stops, answered, parsing };
  }

  async function refresh() {
    try {
      courses = await api.courses();
      error = '';
    } catch (failure) {
      error = failure.message;
    }
  }
  onMount(refresh);

  // The book leans toward the pointer and the light on its cloth follows.
  function tilt(event) {
    if (reduced || opening) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    const style = event.currentTarget.style;
    style.setProperty('--ry', `${(x * 16).toFixed(2)}deg`);
    style.setProperty('--rx', `${(-y * 12).toFixed(2)}deg`);
    style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
    style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
  }
  function rest(event) {
    for (const name of ['--ry', '--rx', '--gx', '--gy']) event.currentTarget.style.removeProperty(name);
  }

  // The cover swings open before the page turns to the course.
  function open(course) {
    if (opening) return;
    if (reduced) return onOpen(course.slug);
    opening = course.slug;
    setTimeout(() => onOpen(course.slug), 620);
  }

  function contents(course) {
    return course.chapters.slice(0, 6);
  }

  async function remove(course) {
    if (!confirm(`删除「${course.name}」？章节、笔记和课件会一起删除。`)) return;
    try {
      await api.deleteCourse(course.slug);
      forgetCourse(course);
      await refresh();
    } catch (failure) {
      error = failure.message;
    }
  }
</script>

<div class="hall hall-split">
  <div class="hall-main">
    <header class="hall-head stagger">
      <div class="hall-brand">
        <span class="brand-mark" aria-hidden="true">讲</span>
        <div>
          <h1>课程大厅</h1>
        </div>
      </div>
    </header>

    {#if error}
      <p class="hall-error" role="alert">{error}</p>
    {:else if !courses}
      <p class="hall-loading">…</p>
    {:else}
      <ul class="course-shelf stagger" class:opening>
        {#each courses as course (course.slug)}
          {@const stats = summary(course)}
          <li class="shelf-slot" class:chosen={opening === course.slug} style="--cloth: {cover(course.slug)}">
            <button
              class="book"
              class:opening={opening === course.slug}
              onpointermove={tilt}
              onpointerleave={rest}
              onclick={() => open(course)}
            >
              <span class="screen-reader">打开《{course.name}》</span>
              <span class="book-shadow" aria-hidden="true"></span>
              <span class="book-body" aria-hidden="true">
                <span class="book-back"></span>
                <span class="book-fore"></span>
                <span class="book-head"></span>
                <span class="book-leaf">
                  <span class="leaf-kicker">目录</span>
                  <span class="leaf-list">
                    {#each contents(course) as chapter (chapter.id)}
                      <span class:ready={chapter.status === 'ready'}
                        ><i>{String(chapter.number).padStart(2, '0')}</i>{chapter.title}</span
                      >
                    {:else}
                      <span class="leaf-blank">空白的一册</span>
                    {/each}
                  </span>
                </span>
                <span class="book-cover">
                  <span class="cover-inside"></span>
                  <span class="cover-front">
                    <span class="cover-rule"></span>
                    <span class="cover-code">{course.code || course.name.slice(0, 2)}</span>
                    <strong class="cover-title">{course.name}</strong>
                    <span class="cover-term">{[course.term, course.teacher].filter(Boolean).join(' · ')}</span>
                    <span class="cover-rule bottom"></span>
                    <span class="cover-gloss"></span>
                  </span>
                </span>
              </span>
            </button>
            <div class="book-caption">
              {#if course.description}<p class="course-description">{course.description}</p>{/if}
              <dl class="course-stats">
                <div>
                  <dt>笔记</dt>
                  <dd>{stats.ready} / {stats.total} 章</dd>
                </div>
                <div>
                  <dt>停顿</dt>
                  <dd>{stats.answered} / {stats.stops}</dd>
                </div>
                {#if course.questionCount}<div>
                    <dt>学生提问</dt>
                    <dd>{course.questionCount}</dd>
                  </div>{/if}
              </dl>
              {#if stats.parsing}
                <p class="course-parsing">老师正在读 {stats.parsing} 份课件…</p>
              {:else if !stats.total}
                <p class="course-parsing quiet">还是空的</p>
              {/if}
              <button class="link-button danger course-delete" onclick={() => remove(course)}>删除这门课</button>
            </div>
          </li>
        {/each}

        <li class="shelf-slot">
          <button class="book blank-book" onclick={() => (creating = true)}>
            <span class="blank-mark" aria-hidden="true">＋</span>
            <span>新建课程</span>
          </button>
        </li>
      </ul>
      {#if creating}
        <CourseForm
          heading="装订一门新课"
          submitLabel="创建空课程"
          savingLabel="正在装订…"
          onSubmit={async (fields) => onOpen((await api.createCourse(fields)).slug)}
          onClose={() => (creating = false)}
        />
      {/if}
    {/if}
  </div>
  {#if courses}
    <HallChat {courses} {onOpen} onChanged={refresh} onManual={() => (creating = true)} />
  {/if}
</div>
