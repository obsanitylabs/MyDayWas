import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from the domain root by default. BASE_PATH (e.g. "landing") serves it from a subfolder.
// Slashes are optional; omitting them avoids Git Bash rewriting the value into a Windows path.
const folder = (process.env.BASE_PATH || '').replace(/^\/+|\/+$/g, '')

export default defineConfig({
  plugins: [react()],
  base: folder ? `/${folder}/` : '/'
})
