import { loadMath } from './markdown.js';

// Extra cost after a character, counted in characters, so the pen pauses at punctuation.
const pauses = { '。': 9, '！': 9, '？': 9, '：': 5, '；': 5, '，': 3, '、': 2, '.': 3, '!': 4, '?': 4, ',': 2 };
const MATH_COST = 6;

// Text nodes are revealed character by character; a typeset formula appears whole.
function collect(root) {
  const units = [];
  (function walk(element) {
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Whitespace between blocks is layout, not writing; the pen must not rest on it.
        if (child.data.trim()) units.push({ node: child, text: child.data, pos: 0 });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === 'MJX-CONTAINER') units.push({ node: child, math: true });
        else walk(child);
      }
    }
  })(root);
  return units;
}

function unhide(node, root) {
  for (
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    element && element !== root;
    element = element.parentElement
  ) {
    element.classList.remove('tw-pending');
  }
}

// Documents whose reader scrolled away from the pen; kept per document so the next paragraph does not pull them back.
const away = new WeakMap();
export const readerAway = (doc) => away.get(doc) === true;

/**
 * Writes rendered Markdown into the node like a pen.
 * params: { html, mode: 'type' | 'done', cps, skip, caret, onDone }
 */
export function typewriter(node, params) {
  let { cps, skip, caret } = params;
  let units = [];
  let index = 0;
  let budget = 0;
  let last = 0;
  let frame = 0;
  let typing = false;
  let destroyed = false;
  let followedY = scrollY;
  const pen = document.createElement('span');
  pen.className = 'caret';
  pen.setAttribute('aria-hidden', 'true');

  function placeCaret() {
    if (!caret) return pen.remove();
    const anchor = index >= units.length ? units.at(-1) : units[index].pos > 0 ? units[index] : units[index - 1];
    if (anchor) anchor.node.after(pen);
    else node.append(pen);
  }

  // A scroll the pen did not make is the reader's: scrolling up stops following, scrolling back down to the pen resumes it.
  function follow() {
    const box = pen.getBoundingClientRect();
    if (!box.height) return;
    if (scrollY < followedY - 1) away.set(node.parentElement, true);
    else if (scrollY > followedY + 1 && box.bottom <= innerHeight) away.set(node.parentElement, false);
    if (!readerAway(node.parentElement) && box.bottom > innerHeight * 0.72)
      scrollBy({ top: box.bottom - innerHeight * 0.58 });
    followedY = scrollY;
  }

  function cost() {
    const unit = units[index];
    if (unit.math) return MATH_COST;
    return 1 + (pauses[unit.text[unit.pos]] ?? 0);
  }

  function advance() {
    const unit = units[index];
    if (unit.math) {
      unhide(unit.node, node);
      index++;
      return;
    }
    unit.pos++;
    unit.node.data = unit.text.slice(0, unit.pos);
    if (unit.pos === 1) unhide(unit.node, node);
    if (unit.pos >= unit.text.length) index++;
  }

  function finish() {
    cancelAnimationFrame(frame);
    while (index < units.length) {
      const unit = units[index];
      if (!unit.math) {
        unit.pos = unit.text.length;
        unit.node.data = unit.text;
      }
      unhide(unit.node, node);
      index++;
    }
    placeCaret();
    if (typing) {
      typing = false;
      params.onDone?.();
    }
  }

  function tick(now) {
    if (destroyed) return;
    budget += last ? ((now - last) / 1000) * cps : 0;
    last = now;
    while (index < units.length && budget >= cost()) {
      budget -= cost();
      advance();
    }
    placeCaret();
    follow();
    if (index >= units.length) return finish();
    frame = requestAnimationFrame(tick);
  }

  async function start() {
    node.innerHTML = params.html;
    node.style.visibility = 'hidden';
    if (/\$|\\\(|\\\[/.test(node.textContent)) {
      try {
        await loadMath();
        if (destroyed) return;
        await window.MathJax.typesetPromise([node]);
      } catch {
        node.dataset.mathUnavailable = 'true';
      }
    }
    if (destroyed) return;
    units = collect(node);
    node.style.visibility = '';
    if (params.mode !== 'type' || cps === Infinity) {
      typing = params.mode === 'type';
      return finish();
    }
    for (const element of node.querySelectorAll('*')) {
      if (element.tagName === 'MJX-CONTAINER' || !element.closest('mjx-container')) element.classList.add('tw-pending');
    }
    for (const unit of units) if (!unit.math) unit.node.data = '';
    typing = true;
    frame = requestAnimationFrame(tick);
  }

  start();

  return {
    update(next) {
      params = next;
      cps = next.cps;
      caret = next.caret;
      if (typing && (next.skip !== skip || cps === Infinity)) finish();
      skip = next.skip;
      if (!typing && units.length) placeCaret();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      window.MathJax?.typesetClear?.([node]);
    }
  };
}
