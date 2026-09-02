import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// In development we proxy /api -> the FastAPI server so the browser only ever
// talks to the Vite origin. That sidesteps CORS entirely: no need to keep
// ALLOWED_DOMAIN on the backend in sync with whatever port Vite picked.
//
// Leave VITE_API_BASE_URL empty in .env.development and set VITE_API_PREFIX=/api.

// Same file scripts/build-apps.sh reads for the multi-app production
// builds — reused here so `APP=<name> npm run dev` can point the dev proxy
// at that one app's backend (apiBaseUrl) without duplicating the list.
const appsJsonPath = fileURLToPath(new URL('./scripts/apps.json', import.meta.url))

function findApp(name) {
  const apps = JSON.parse(readFileSync(appsJsonPath, 'utf8'))
  const app = apps.find((a) => a.name === name)
  if (!app) {
    throw new Error(`APP="${name}" not found in scripts/apps.json`)
  }
  if (!app.apiBaseUrl) {
    throw new Error(`app "${name}" in scripts/apps.json has no "apiBaseUrl"`)
  }
  return app
}

export default defineConfig(({ mode }) => {
  // loadEnv(), not `process.env` directly — this file runs before Vite has
  // loaded .env.* itself, so VITE_DEV_API_TARGET (set in .env.development)
  // wouldn't be visible here otherwise.
  const env = loadEnv(mode, process.cwd())

  // `APP` (plain process.env, not a VITE_-prefixed/.env.* value — this is a
  // dev-only selector, never meant to reach the browser bundle) picks one
  // app's backend out of scripts/apps.json instead of the single default
  // in .env.development. Falls back to the existing single-target behavior
  // when unset, so a plain `npm run dev` is unaffected.
  const selectedApp = process.env.APP ? findApp(process.env.APP) : null
  const API_TARGET = selectedApp ? selectedApp.apiBaseUrl : env.VITE_DEV_API_TARGET

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
