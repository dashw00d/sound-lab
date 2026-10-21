import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Sound Lab app (TS + React), served by Sound Lab's Python server at /app/ (soundlab/webapp, built here). In
// development (`npm run dev`), the API, clips and shipped files come from a running `soundlab serve` (SOUNDLAB_API,
// default http://127.0.0.1:7870).
const api = process.env.SOUNDLAB_API ?? 'http://127.0.0.1:7870'

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: { outDir: '../soundlab/webapp', emptyOutDir: true },
  server: { proxy: Object.fromEntries(['/api', '/clips', '/shipped', '/web'].map(p => [p, api])) },
})
