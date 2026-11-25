import { access } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { loadEnvFile } from 'node:process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const demo = process.argv.includes('--demo')
if (!demo) {
  try { loadEnvFile(resolve(root, '.env')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
try { await access(resolve(root, 'dist/index.html')) }
catch {
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (build.status !== 0) process.exit(1)
}
const env = demo ? {
  ...process.env, STUDIO_BIND: '127.0.0.1', STUDIO_PROVIDER_MODE: 'demo',
  STUDIO_PROVIDER_KEY: '', STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR || resolve(root, '.runtime/studio-demo'),
} : process.env
const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, stdio: 'inherit', env })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 0 : 1) })
