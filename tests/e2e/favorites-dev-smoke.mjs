// Exercise development-mode Vue startup as well as the production-renderer test.
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({
  configFile: false,
  root: join(root, 'src/renderer'),
  plugins: [vue()],
  resolve: { alias: { '@shared': join(root, 'src/shared') } },
  server: { host: '127.0.0.1', port: 0 },
})
try {
  await server.listen()
  const environment = {
    ...process.env,
    NOVELPROMPT_TEST_RENDERER_URL: server.resolvedUrls.local[0],
  }
  delete environment.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      createRequire(import.meta.url)('electron'),
      [join(root, 'tests/e2e/favorites-smoke.cjs')],
      {
        cwd: root,
        env: environment,
        windowsHide: true,
        stdio: 'inherit',
      },
    )
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Development renderer timed out'))
    }, 60000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (status) => {
      clearTimeout(timeout)
      resolve(status)
    })
  })
  if (code !== 0) {
    throw new Error(`Development renderer failed (${code})`)
  }
} finally {
  await server.close()
}
