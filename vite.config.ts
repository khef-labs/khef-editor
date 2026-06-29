import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Renderer build. base './' so file:// loading works in the packaged app.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [preact()],
  server: {
    port: 5273,
    strictPort: true,
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
})
