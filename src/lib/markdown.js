import { marked } from 'marked';

let mathReady;

export function loadMath() {
  if (!mathReady) {
    mathReady = new Promise((resolve, reject) => {
      window.MathJax = {
        startup: { typeset: false },
        tex: {
          inlineMath: [
            ['$', '$'],
            ['\\(', '\\)']
          ]
        }
      };
      const script = document.createElement('script');
      script.src = './vendor/mathjax/es5/tex-chtml-full.js';
      script.onload = () => window.MathJax.startup.promise.then(resolve, reject);
      script.onerror = reject;
      document.head.append(script);
    });
  }
  return mathReady;
}

export function renderMarkdown(source) {
  const formulas = [];
  // Formulas are written as \(…\) and \[…\]; hold them so Markdown leaves their backslashes alone.
  const held = source.replace(/\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$|\$(?:\\.|[^\n$])+?\$/g, (match) => {
    const index = formulas.push(match) - 1;
    return `MATHJAXTOKEN${index}END`;
  });
  return marked
    .parse(held)
    .replace(
      /<img src="([^"]+)"[^>]*>/g,
      (image, src) => `<a class="figure-link" href="${src}" target="_blank" rel="noreferrer">${image}</a>`
    )
    .replace(/MATHJAXTOKEN(\d+)END/g, (_, index) =>
      formulas[index].replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    );
}

export function math(node) {
  let mounted = true;
  if (/\$|\\\(|\\\[/.test(node.textContent)) {
    loadMath()
      .then(() => {
        if (mounted) return window.MathJax.typesetPromise([node]);
      })
      .catch(() => {
        if (mounted) node.dataset.mathUnavailable = 'true';
      });
  }
  return {
    destroy() {
      mounted = false;
      window.MathJax?.typesetClear?.([node]);
    }
  };
}
