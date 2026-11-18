<script>
  import { onMount } from 'svelte';

  // A modal sheet for a course's fields; the parent decides what saving means.
  let { initial = {}, heading, submitLabel, savingLabel, onSubmit, onClose } = $props();

  let form = $state({ name: '', code: '', term: '', teacher: '', description: '', ...initial });
  let saving = $state(false);
  let error = $state('');
  let nameInput;

  onMount(() => nameInput?.focus());

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    if (!form.name.trim()) {
      error = '请填写课程名称。';
      return;
    }
    saving = true;
    error = '';
    try {
      await onSubmit(form);
    } catch (failure) {
      error = failure.message;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onClose()} />

<div class="sheet-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <form class="course-form sheet-panel" onsubmit={submit} aria-label={heading}>
    <h2>{heading}</h2>
    <label
      >课程名称<input
        bind:this={nameInput}
        bind:value={form.name}
        maxlength="60"
        placeholder="例如：博弈论"
        required
      /></label
    >
    <div class="form-row">
      <label>简称<input bind:value={form.code} maxlength="20" placeholder="GT" /></label>
      <label>学期<input bind:value={form.term} maxlength="30" placeholder="2026 秋" /></label>
    </div>
    <label>任课教师<input bind:value={form.teacher} maxlength="40" /></label>
    <label
      >课程简介<textarea bind:value={form.description} maxlength="400" rows="3" placeholder="这门课讲什么，一两句话即可"
      ></textarea></label
    >
    {#if error}<p class="coach-error" role="alert">{error}</p>{/if}
    <div class="form-actions">
      <button type="button" class="secondary quiet" onclick={onClose}>取消</button>
      <button type="submit" class="send" disabled={saving}>{saving ? savingLabel : submitLabel}</button>
    </div>
  </form>
</div>
