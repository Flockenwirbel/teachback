# Teachback

Learn from the teacher, then teach it to a student.

- **The teacher leads**: the teacher reads the course material you upload and writes a lecture note letter by letter. At key points it stops and asks a question at the caret. A correct answer goes into the note in your own words; a wrong one gets a narrower follow-up until you get there. Finished notes export to Markdown.
- **You teach a student**: a student who has read the chapter's note asks you four questions (concept, derivation, distinction, changed conditions). Where you got stuck in the note, the student asks about it, carrying what you thought at the time. When you can't explain something, _ask the teacher_ answers by quoting only this chapter's material, with page numbers.

## Running

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local   # fill in LLM_API_KEY
pnpm dev                     # http://127.0.0.1:5174/
pnpm format                  # Prettier; Claude Code also formats each file it edits (hook in .claude/settings.json)
```

`.env.local`:

| Variable          | Used for                                                         | Default                                                            |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `LLM_API_KEY`     | the provider's API key                                           | —                                                                  |
| `LLM_BASE_URL`    | any OpenAI-compatible chat completions API                       | `https://openrouter.ai/api/v1`                                     |
| `LLM_MODEL`       | follow-ups, grading, asking the teacher                          | `anthropic/claude-haiku-5.5`                                       |
| `LLM_PARSE_MODEL` | reading material, writing the student's questions                | same as `LLM_MODEL`                                                |
| `LLM_SOLVE_MODEL` | worked solutions at derivation stops                             | `anthropic/claude-sonnet-5.5` on OpenRouter, otherwise `LLM_MODEL` |
| `TEACHBACK_DB`    | SQLite database; uploaded material is kept in `files/` beside it | `data/teachback.db`                                                |

Any provider with an OpenAI-compatible chat completions API works if it supports `json_schema` structured output. The provider also needs to accept PDF `file` parts if you upload PDFs; OpenRouter accepts them for every model. Reasoning effort and the PDF parser plugin are sent only to OpenRouter. The older `OPENROUTER_*` names still work.

Material can be PDF, PPTX, Markdown, HTML or plain text, up to 40 MB. PDFs go to the model natively, so formulas and figures are read; PPTX yields text only, so export it to PDF when you can. Quotes from 问老师 come from the PDF's page text (`pdftotext`).

Everything lives in the database: courses, chapters, notes, student questions and your progress. The browser keeps only small preferences such as typing speed.

## Layout

```
server/
  index.js          entry: /api/courses, /api/coach, /files
  library.js        routes for courses, chapters, uploads, parsing, questions and progress
  store.js          SQLite
  http.js           request bodies, JSON responses, serving attachments
  openrouter.js     model calls
  teacher/
    parse.js        reads material and writes it as a note with stops
    guide.js        judges answers at stops and asks follow-ups (rejects ones that leak the answer)
    ask.js          ask the teacher: answers only from the material, each quote checked
  student/
    questions.js    reads the note and where you got stuck, writes four questions
    grade.js        grades your explanation
src/
  App.svelte        routing and page transitions
  halls/            course hall (bookshelf), chapter hall, course form, chat bubble Say
  note/             the teacher leads: note desk and stop bubble
  teach/            you teach: teaching desk, ask the teacher, student opening
  lib/              API client, progress, Markdown and math, typewriter
  styles/           base · note · halls · motion
public/vendor/      local MathJax
```

A note is a list of `text` and `stop` segments. A `stop` has `ask`, `keyPoints`, `reference` and optional material pages. Math is written as `\(…\)` and `\[…\]`.
