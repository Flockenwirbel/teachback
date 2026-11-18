import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { apiMiddleware, defaultModel } from './server/index.js';
import { configureStore, database } from './server/store.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['OPENROUTER_', 'TEACHBACK_']);
  configureStore({ path: env.TEACHBACK_DB?.trim() });
  const middleware = apiMiddleware({
    key: env.OPENROUTER_API_KEY?.trim(),
    model: env.OPENROUTER_MODEL?.trim() || defaultModel,
    parseModel: env.OPENROUTER_PARSE_MODEL?.trim()
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
