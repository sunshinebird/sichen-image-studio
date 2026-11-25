import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { defaultImageModel, imageQuality } from './image-profile.mjs'

export class UnknownResult extends Error {}
export class ImageRejected extends Error {}

const maxImageBytes = 24 * 1024 * 1024
const maxJsonBytes = 34 * 1024 * 1024

export async function readLimited(stream, maxBytes) {
  const parts = []
  let bytes = 0
  for await (const chunk of stream) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new RangeError('payload limit')
    parts.push(Buffer.from(chunk))
  }
  return Buffer.concat(parts, bytes)
}

function upstreamUrl(value) {
  const url = new URL(value)
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('Provider requires HTTPS or a loopback HTTP service')
  }
  return url
}

function makeForm(fields, sources, mask) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value))
  for (const image of sources) {
    form.append('image[]', new Blob([image.bytes], { type: 'image/png' }), 'reference.png')
  }
  if (mask) form.set('mask', new Blob([mask], { type: 'image/png' }), 'mask.png')
  return form
}

export function imageProvider(env = process.env) {
  const mode = env.STUDIO_PROVIDER_MODE || 'chatgpt2api'
  if (!['chatgpt2api', 'openai', 'demo'].includes(mode)) throw new Error('Invalid image provider mode')
  if (mode === 'demo') {
    const sample = new URL('../content/portfolio/art/s26-celadon-tea-set.webp', import.meta.url)
    return {
      mode, label: '本地示例', demo: true, ready: true, model: 'local-demo',
      async submit(task, sources, _mask, onStage) {
        onStage('正在生成演示')
        const source = sources[0]
        if (source) {
          const warm = task.prompt.includes('更暖')
          return sharp(source.bytes).modulate({ brightness: 1.10, saturation: warm ? 1.12 : 0.62 }).tint(warm ? '#f4c698' : '#c9d8e0').png().toBuffer()
        }
        const [width, height] = task.size.split('x').map(Number)
        return sharp(await readFile(sample))
          .resize(width, height, { fit: 'contain', background: '#efeae0' }).png().toBuffer()
      },
    }
  }
  const base = upstreamUrl(env.STUDIO_PROVIDER_URL || 'http://127.0.0.1:3000')
  if (mode === 'chatgpt2api' && base.pathname !== '/') throw new Error('chatgpt2api URL must be its service origin')
  const key = env.STUDIO_PROVIDER_KEY || ''
  const demo = env.STUDIO_DEMO === '1'
  const model = env.STUDIO_IMAGE_MODEL || defaultImageModel
  const origins = new Set([base.origin])
  for (const value of (env.STUDIO_ASSET_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean)) {
    origins.add(upstreamUrl(value).origin)
  }

  async function jsonRequest(path, { method = 'GET', data, timeout = 18000 } = {}) {
    const url = new URL(path, base.origin)
    const headers = { Authorization: 'Bearer ' + key }
    const body = data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data)
    if (typeof body === 'string') headers['Content-Type'] = 'application/json'
    let response
    try {
      response = await fetch(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(timeout) })
    } catch {
      throw new UnknownResult('图像服务暂时无法确认任务状态。')
    }
    if (!response.ok) {
      await response.body?.cancel()
      if ([400, 401, 403, 404, 413, 422, 429].includes(response.status) ||
          (mode === 'chatgpt2api' && response.status === 503 && method === 'POST')) {
        const message = response.status === 429 || response.status === 503
          ? '出图服务正在忙，请稍后再试。'
          : [401, 403].includes(response.status)
            ? '出图服务的授权暂不可用。'
            : '图像服务无法处理这次请求，请检查描述和参考图。'
        throw new ImageRejected(message)
      }
      throw new UnknownResult('图像服务暂时无法确认任务状态。')
    }
    try {
      return JSON.parse(await readLimited(response.body, maxJsonBytes))
    } catch {
      throw new UnknownResult('图像服务返回了无法确认的任务状态。')
    }
  }

  async function imageBytes(asset) {
    if (typeof asset?.b64_json === 'string' && asset.b64_json) {
      if (asset.b64_json.length > maxJsonBytes || !/^[a-z\d+/]+={0,2}$/i.test(asset.b64_json)) {
        throw new ImageRejected('返回的图片超出了可用范围。')
      }
      const bytes = Buffer.from(asset.b64_json, 'base64')
      if (!bytes.length || bytes.length > maxImageBytes) throw new ImageRejected('返回的图片超出了可用范围。')
      return bytes
    }
    if (typeof asset?.url !== 'string' || !asset.url) throw new ImageRejected('图像服务没有返回可交付的图片。')
    let url
    try {
      url = new URL(asset.url, base)
      if (!origins.has(url.origin) || url.username || url.password) throw new Error('asset origin')
    } catch {
      throw new ImageRejected('图像服务返回了无法读取的图片地址。')
    }
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000) })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('asset unavailable')
      }
      return await readLimited(response.body, maxImageBytes)
    } catch {
      throw new UnknownResult('图片暂时无法取回，任务仍可查询。')
    }
  }

  async function poll(id) {
    const page = await jsonRequest('/api/image-tasks?ids=' + encodeURIComponent(id), { timeout: 9000 })
    if (!Array.isArray(page?.items)) throw new UnknownResult('暂时无法读取任务进度。')
    return page.items.find(item => item.id === id) || null
  }

  async function terminalImage(row) {
    if (!row || !row.terminal) return null
    if (!['success', 'partial_success'].includes(row.status) || !row.results?.length) {
      throw new ImageRejected('本次未得到可交付的图片，次数已退回。')
    }
    return imageBytes(row.results[0])
  }

  async function submit(task, sources, mask, onStage) {
    if (!key) throw new ImageRejected('还没有配置图像服务。')
    const edit = sources.length > 0
    const suffix = edit ? 'edits' : 'generations'
    const payload = { prompt: task.prompt, model, n: 1, size: task.size, quality: imageQuality, output_format: 'png' }
    if (mode === 'openai') {
      const prefix = base.pathname.replace(/\/$/, '') || '/v1'
      const result = await jsonRequest(prefix + '/images/' + suffix, {
        method: 'POST', data: edit ? makeForm(payload, sources, mask) : payload, timeout: 300000
      })
      return imageBytes(result?.data?.[0])
    }

    payload.client_task_id = task.id
    let row
    try {
      row = await jsonRequest('/api/image-tasks/' + suffix, {
        method: 'POST', data: edit ? makeForm(payload, sources, mask) : payload, timeout: 30000
      })
    } catch (error) {
      if (!(error instanceof UnknownResult)) throw error
    }
    const end = Date.now() + 245000
    for (;;) {
      if (row && row.id !== task.id) throw new UnknownResult('图像服务返回了无法匹配的任务。')
      if (row?.terminal) return terminalImage(row)
      onStage(row?.status === 'queued' ? '等待出图' : '正在出图')
      if (Date.now() > end) throw new UnknownResult('任务仍可查询，暂未收到完成结果。')
      await delay(1400)
      row = await poll(task.id)
    }
  }

  async function recover(id) {
    if (mode !== 'chatgpt2api' || !key) return null
    return terminalImage(await poll(id))
  }

  return { label: mode === 'chatgpt2api' ? 'chatgpt2api' : '兼容图像 API', demo, ready: Boolean(key), mode, model, submit, recover }
}
