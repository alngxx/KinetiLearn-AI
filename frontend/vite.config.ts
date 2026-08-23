import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// apiClient throws at module scope when this is unset. Under `vite build` that
// throw becomes statically reachable, the minifier drops the whole app behind it,
// and the build still exits 0 — a silently empty bundle. Fail the build instead.
const REQUIRED_ENV = ['VITE_API_BASE_URL']

function requireEnv(): Plugin {
  return {
    name: 'require-env',
    config(_config, { mode }) {
      const env = loadEnv(mode, import.meta.dirname, 'VITE_')
      const missing = REQUIRED_ENV.filter((key) => !env[key])
      if (missing.length > 0) {
        throw new Error(
          `Missing required env var(s): ${missing.join(', ')}. ` +
            `Add them to .env.${mode} (see .env.example).`,
        )
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [requireEnv(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
