<script>
  import { untrack } from 'svelte';

  // One line from the teacher (or the student), typed out, then the replies the learner can tap.
  let { text, mark = '讲', who = '老师', children } = $props();

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shown = $state(0);

  $effect(() => {
    const line = text;
    untrack(() => (shown = reduced ? line.length : 0));
    if (reduced) return;
    const timer = setInterval(() => {
      if (shown >= line.length) return clearInterval(timer);
      shown += 1;
    }, 34);
    return () => clearInterval(timer);
  });
</script>

<div class="say">
  <span class="say-mark" aria-hidden="true">{mark}</span>
  <div class="say-body">
    <p class="say-bubble" aria-label="{who}：{text}">
      <span aria-hidden="true">{text.slice(0, shown)}</span>{#if shown < text.length}<span
          class="caret"
          aria-hidden="true"
        ></span>{/if}
    </p>
    {#if children && shown >= text.length}
      <div class="say-replies">{@render children()}</div>
    {/if}
  </div>
</div>
