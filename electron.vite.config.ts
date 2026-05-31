import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@': resolve('src/renderer'),
  '@renderer': resolve('src/renderer'),
  '@shared': resolve('src/shared')
}

export default defineConfig({
  main: {
    resolve: {
      alias
    },
    build: {
      rollupOptions: {
        // The embedding pipeline runs in a node:worker_threads worker so its
        // synchronous ONNX inference doesn't block the Electron main thread
        // (which serves IPC to the renderer). Emit it as a sibling bundle of
        // index.js so `new Worker(path.join(__dirname, 'embeddingWorker.js'))`
        // resolves both in `electron-vite dev` and in the packaged app.
        input: {
          index: resolve('src/main/index.ts'),
          embeddingWorker: resolve('src/main/lib/aiEmbedded/embeddings/embeddingWorker.ts')
        }
      }
    }
  },
  preload: {
    resolve: {
      alias
    }
  },
  renderer: {
    resolve: {
      alias
    },
    plugins: [react(), tailwindcss()]
  }
})
