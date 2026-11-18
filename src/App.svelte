<script>
  import { flushSync, onMount, untrack } from 'svelte';
  import { api } from './lib/api.js';
  import ChapterHall from './halls/ChapterHall.svelte';
  import CourseHall from './halls/CourseHall.svelte';
  import NoteDesk from './note/NoteDesk.svelte';
  import QuestionPrep from './teach/QuestionPrep.svelte';
  import { strugglesFor } from './lib/progress.js';
  import TeachDesk from './teach/TeachDesk.svelte';

  // #/ lists courses; #/c/<course> is its chapter hall, …/n/<chapter> a note, …/teach[/<n>] the student practice.
  function parseRoute(hash) {
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== 'c' || !parts[1]) return { view: 'courses' };
    const slug = parts[1];
    if (parts[2] === 'n' && parts[3]) return { view: 'note', slug, chapterId: parts[3] };
    if (parts[2] === 'teach') return { view: 'teach', slug, chapter: Number(parts[3]) || null };
    return { view: 'chapters', slug };
  }

  let route = $state(parseRoute(location.hash));
  let course = $state(null);
  let bank = $state(null);
  let error = $state('');
  let preparing = $state(null);
  let prepError = $state('');

  const go = (hash) => (location.hash = hash);
  const base = $derived(route.slug ? `#/c/${encodeURIComponent(route.slug)}` : '#/');

  // Deeper views turn the page forward, shallower ones back.
  const depth = (target) => ({ courses: 0, chapters: 1 })[target.view] ?? 2;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  onMount(() => {
    let turn = 0;
    const follow = async () => {
      const hash = location.hash;
      const next = parseRoute(hash);
      const mine = ++turn;
      // Fetch what the next page shows first, so the page that sweeps in is the page itself, not a loading line.
      let nextCourse = null;
      let nextBank = null;
      try {
        if (next.slug && course?.slug !== next.slug) nextCourse = await api.course(next.slug);
        if (next.view === 'teach' && (!bank || course?.slug !== next.slug)) nextBank = await api.questions(next.slug);
      } catch {}
      if (mine !== turn) return;
      const apply = () => {
        if (nextCourse) {
          course = nextCourse;
          bank = nextBank;
          error = '';
        } else if (nextBank) bank = nextBank;
        route = next;
        scrollTo({ top: 0 });
      };
      if (reduced || !document.startViewTransition) return apply();
      const root = document.documentElement;
      root.dataset.pageTransition = depth(next) < depth(route) ? 'backward' : 'forward';
      const transition = document.startViewTransition(() => flushSync(apply));
      transition.finished.finally(() => {
        if (mine === turn) delete root.dataset.pageTransition;
      });
    };
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  });

  async function load(slug) {
    try {
      const next = await api.course(slug);
      if (route.slug === slug) {
        course = next;
        error = '';
      }
    } catch (failure) {
      if (route.slug === slug) error = failure.message;
    }
  }

  $effect(() => {
    const slug = route.slug;
    if (!slug) return;
    untrack(() => {
      if (course?.slug !== slug) {
        course = null;
        bank = null;
      }
      load(slug);
    });
  });

  $effect(() => {
    if (route.view !== 'teach' || !course || bank) return;
    const slug = course.slug;
    api.questions(slug).then(
      (rows) => course?.slug === slug && (bank = rows),
      (failure) => (error = failure.message)
    );
  });

  // The student reads the chapter's note, plus where the learner got stuck in it, and prepares new questions.
  async function prepare(chapter, struggles) {
    if (preparing) return;
    preparing = chapter.id;
    prepError = '';
    try {
      bank = await api.generateQuestions(course.slug, chapter.id, struggles);
      load(course.slug);
      if (route.chapter !== chapter.number) go(`${base}/teach/${chapter.number}`);
    } catch (failure) {
      prepError = failure.message;
    } finally {
      preparing = null;
    }
  }
  const teachChapter = $derived(route.chapter ?? null);
  const chapterHasQuestions = $derived(Boolean(bank?.some((item) => !teachChapter || item.chapter === teachChapter)));

  // While the teacher is reading an attachment, check back until the chapter is ready or failed.
  $effect(() => {
    if (!course?.chapters.some((chapter) => chapter.status === 'parsing')) return;
    const slug = course.slug;
    const timer = setInterval(() => load(slug), 3000);
    return () => clearInterval(timer);
  });

  const chapter = $derived(course?.chapters.find((entry) => entry.id === route.chapterId));
</script>

<div class="page-root">
  {#if route.view === 'courses'}
    <CourseHall onOpen={(slug) => go(`#/c/${encodeURIComponent(slug)}`)} />
  {:else if error && !course}
    <div class="hall">
      <p class="hall-error" role="alert">{error}</p>
      <button class="primary" onclick={() => go('#/')}>回到课程大厅</button>
    </div>
  {:else if !course}
    <div class="hall"><p class="hall-loading">正在打开课程…</p></div>
  {:else if route.view === 'chapters'}
    <ChapterHall
      {course}
      onBack={() => go('#/')}
      onOpen={(id) => go(`${base}/n/${encodeURIComponent(id)}`)}
      onTeach={(number) => go(number ? `${base}/teach/${number}` : `${base}/teach`)}
      onChanged={() => load(course.slug)}
      onDeleted={() => go('#/')}
    />
  {:else if route.view === 'note'}
    {#if chapter?.status === 'ready'}
      <NoteDesk
        {course}
        chapterId={chapter.id}
        onOpen={(id) => go(`${base}/n/${encodeURIComponent(id)}`)}
        onHall={() => go(base)}
        onSwitch={(number) => go(`${base}/teach/${number}`)}
      />
    {:else}
      <div class="hall">
        <p class="hall-loading">这一章的笔记还没有准备好。</p>
        <button class="primary" onclick={() => go(base)}>回到章节大厅</button>
      </div>
    {/if}
  {:else if route.view === 'teach'}
    {#if bank && chapterHasQuestions}
      {#key `${course.slug}:${bank.map((item) => item.id).join()}`}
        <TeachDesk
          {course}
          {bank}
          chapter={route.chapter}
          regenerating={preparing}
          regenerateError={prepError}
          onHall={() => go(base)}
          onRegenerate={(chapterId) => {
            const target = course.chapters.find((entry) => entry.id === chapterId);
            if (target) prepare(target, strugglesFor(course, target));
          }}
        />
      {/key}
    {:else if bank}
      <QuestionPrep
        {course}
        chapterNumber={route.chapter}
        busy={preparing}
        error={prepError}
        onGenerate={prepare}
        onHall={() => go(base)}
      />
    {:else}
      <div class="hall"><p class="hall-loading">正在载入学生提问…</p></div>
    {/if}
  {/if}
</div>
