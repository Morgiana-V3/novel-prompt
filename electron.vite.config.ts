import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    // Keep the launch entry present during rebuilds; Electron may cold-start via MCP.
    build: { emptyOutDir: false },
    plugins: [externalizeDepsPlugin({ exclude: ['pinyin-pro'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    plugins: [vue()]
  }
})
