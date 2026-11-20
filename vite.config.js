import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { apiMiddleware, defaultModel } from './server/index.js';
import { configureStore, database } from './server/store.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['LLM_', 'OPENROUTER_', 'TEACHBACK_']);
  configureStore({ path: env.TEACHBACK_DB?.trim() });
  // LLM_* names any OpenAI-compatible provider; the older OPENROUTER_* names still work.
  const setting = (name) => (env[`LLM_${name}`] || env[`OPENROUTER_${name}`])?.trim() || undefined;
  const middleware = apiMiddleware({
    key: setting('API_KEY'),
    baseUrl: setting('BASE_URL'),
    model: setting('MODEL') || defaultModel,
    parseModel: setting('PARSE_MODEL'),
    solveModel: setting('SOLVE_MODEL')
  });
  return {
    base: './',
    // The database and uploaded attachments change at runtime; they are not source.
    server: { watch: { ignored: ['**/data/**'] } },
    plugins: [
      svelte(),
      {
        name: 'teachback-api',
        configureServer(server) {
          database();
          server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
          database();
          server.middlewares.use(middleware);
        }
      }
    ]
  };
});
