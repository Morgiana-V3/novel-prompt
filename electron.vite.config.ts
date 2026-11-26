import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    // Keep the launch entry present during rebuilds; Electron may cold-start via MCP.
    build: {
      emptyOutDir: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'reverse-worker': resolve(__dirname, 'src/main/modules/reverse/worker.ts'),
        },
      },
    },
    plugins: [externalizeDepsPlugin({ exclude: ['pinyin-pro'] })],
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          canvas: resolve(__dirname, 'src/preload/canvas.ts'),
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          canvas: resolve(__dirname, 'src/renderer/canvas.html'),
        },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    plugins: [vue()],
  },
})
