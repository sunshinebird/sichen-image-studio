import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, '.runtime/vision')
const models = join(directory, 'models')
const slimsam = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/'
const entries = [
  {
    name: 'vision_encoder_quantized.onnx', base: slimsam, bytes: 8882165,
    digest: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
  },
  {
    name: 'prompt_encoder_mask_decoder_quantized.onnx', base: slimsam, bytes: 4903810,
    digest: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
  },
]
if (process.argv.includes('--with-background')) {
  entries.push({
    name: 'lama_fp16.onnx', bytes: 106183330,
    base: 'https://huggingface.co/ipsilondev/lama-onnx/resolve/59d0468fc499153dc92107dfa7ccd3d4d0ee3284/',
    digest: 'f45fe5e9b535a1bead6995c19f49aee458ad1167a024b911fbc7983ba6eb4b32',
  })
}
const command = (file, args) => {
  const result = spawnSync(file, args, { cwd: root, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw result.error ?? new Error(file + ' exited with ' + result.status)
}
const python = join(directory, 'venv/bin/python')
await mkdir(models, { recursive: true, mode: 0o700 })
const exists = spawnSync(python, ['--version'], { stdio: 'ignore' }).status === 0
if (!exists) command('uv', ['venv', '--python', '3.12', join(directory, 'venv')])
command('uv', ['pip', 'install', '--quiet', '--no-cache', '--python', python, '-r', 'server/vision/requirements.txt'])

for (const { name, base, bytes, digest } of entries) {
  const path = join(models, name)
  const valid = data => data?.length === bytes && createHash('sha256').update(data).digest('hex') === digest
  if (valid(await readFile(path).catch(() => null))) continue
  const response = await fetch(base + name, { signal: AbortSignal.timeout(180000) })
  if (!response.ok || !response.body) throw new Error('Model download failed: ' + name)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > bytes) throw new Error('Model size mismatch: ' + name)
    chunks.push(chunk)
  }
  const data = Buffer.concat(chunks)
  if (!valid(data)) throw new Error('Model checksum mismatch: ' + name)
  const temporary = path + '.part-' + process.pid
  try {
    await writeFile(temporary, data, { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
command(python, ['-c', 'import cv2, onnxruntime, rapidocr'])
console.log('本机智能编辑组件已就绪。')
