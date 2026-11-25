import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { readLimited } from '../provider.mjs'
import { StudioError } from '../store.mjs'

const run = promisify(execFile)
const worker = fileURLToPath(new URL('worker.py', import.meta.url))
const weights = ['vision_encoder_quantized.onnx', 'prompt_encoder_mask_decoder_quantized.onnx']
const expireMs = 5 * 60 * 1000
const notFound = () => new StudioError(404, '选区已失效，请重新识别。', 'selection_expired')
const exists = path => access(path).then(() => true, () => false)
const validIndex = (options, index) => Number.isInteger(index) && index >= 0 && index < options.length
const pointValid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
  p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && typeof p.include === 'boolean'

export async function openVision({ python, models, resolveSource, storeImages }) {
  const text = Boolean(python && await exists(python))
  const subject = text && (await Promise.all(weights.map(name => exists(join(models, name))))).every(Boolean)
  const fill = subject && await exists(join(models, "lama_fp16.onnx"))
  const available = { text, subject, fill }
  const choices = new Map()
  const requests = new Map()
  const owners = new Set()
  let running = 0
  let filling = false

  function put(owner, source, fingerprint, data) {
    const id = randomUUID()
    const now = Date.now()
    for (const [key, value] of choices) if (value.expires <= now) choices.delete(key)
    while (choices.size >= 32) choices.delete(choices.keys().next().value)
    choices.set(id, { owner, source, fingerprint, expires: now + expireMs, ...data })
    return id
  }

  function get(owner, source, fingerprint, token, kind) {
    const value = choices.get(token)
    if (!value || value.owner !== owner || value.source !== source ||
        value.fingerprint !== fingerprint || value.kind !== kind || value.expires <= Date.now()) throw notFound()
    return value
  }

  function admit(owner) {
    if (owners.has(owner) || running >= 2) throw new StudioError(429, '画布正在分析图片，请稍后重试。', 'vision_busy')
    const now = Date.now()
    const window = requests.get(owner)
    if (window && window.until > now && window.count >= 32) {
      throw new StudioError(429, '编辑请求过于频繁，请稍后再试。', 'vision_busy')
    }
    if (requests.size >= 1024) requests.delete(requests.keys().next().value)
    requests.set(owner, window?.until > now ? { ...window, count: window.count + 1 } : { until: now + 600000, count: 1 })
    owners.add(owner)
    running++
  }

  async function work(operation, path, input, load, selection) {
    const folder = await mkdtemp(join(tmpdir(), 'sichen-vision-'))
    try {
      const manifest = join(folder, 'request.json')
      if (selection) await writeFile(join(folder, 'selection.png'), selection, { mode: 0o600 })
      await writeFile(manifest, JSON.stringify({ operation, path, models, ...input }), { mode: 0o600 })
      let response
      try {
        const { stdout } = await run(python, [worker, manifest], { timeout: 22_000, maxBuffer: 256 * 1024 })
        response = JSON.parse(stdout)
      } catch (cause) {
        // The worker has access to private filenames. Keep its full stderr out of application logs.
        console.error('Studio vision worker:', operation, cause.killed ? 'deadline' : cause.code ?? cause.name)
        throw new StudioError(503, '暂时无法分析这张图，请稍后重试。', 'vision_unavailable')
      }
      return await load(response, folder)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }

  async function resolveInput(owner, source) {
    if (typeof source !== 'string' || source.length > 180) throw new StudioError(400, '请选择工作站中的图片。')
    const path = await resolveSource(owner, source)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) throw new StudioError(404, '找不到这张图片。')
    return { path, fingerprint: path + ':' + info.size + ':' + info.mtimeMs }
  }

  async function handle(req, owner) {
    if (Number(req.headers['content-length'] || 0) > 4096) throw new StudioError(413, '编辑请求过大。')
    let input
    try { input = JSON.parse(await readLimited(req, 4096)) }
    catch { throw new StudioError(400, '无法读取编辑请求。') }
    if (!input || typeof input !== 'object') throw new StudioError(400, '无法读取编辑请求。')
    const { operation, source, token, index, points } = input
    if (!['scan', 'text', 'subject', 'extract', 'lift'].includes(operation)) throw new StudioError(400, '无法识别编辑操作。')
    const ready = operation === 'scan' || operation === 'text' ? text : operation === 'lift' ? fill : subject
    if (!ready) {
      throw new StudioError(503, '当前工作站还没有开启这个工具。', 'vision_unavailable')
    }
    if (operation === 'subject' && (!Array.isArray(points) || points.length > 6 ||
        !points.every(pointValid) || !points.some(point => point.include))) {
      throw new StudioError(400, '请先在画布上点选想要的主体。')
    }
    if (operation === 'lift' && filling) throw new StudioError(429, '背景正在处理中，请稍后重试。', 'vision_busy')
    admit(owner)
    if (operation === 'lift') filling = true
    try {
      const { path, fingerprint } = await resolveInput(owner, source)
      if (operation === 'scan') {
        return await work('scan', path, {}, ({ lines }) => ({
          token: put(owner, source, fingerprint, { kind: 'text', lines }),
          lines: lines.map(({ text: value, box, score }) => ({ text: value, box, score })),
        }))
      }
      if (operation === 'text') {
        const { lines } = get(owner, source, fingerprint, token, 'text')
        if (!validIndex(lines, index)) throw notFound()
        return await work('text', path, { line: lines[index] }, async (result, dir) => {
          if (result.unusable) throw new StudioError(422, '文字与背景难以分开，可以用画笔圈选后改图。', 'text_unusable')
          const [asset] = await storeImages(owner, [await readFile(join(dir, 'background.png'))])
          return { asset, box: result.box, fill: result.fill, angle: result.angle }
        })
      }
      if (operation === 'subject') {
        return await work('subject', path, { points }, async ({ candidates }, dir) => {
          const masks = await Promise.all(candidates.map(async ({ file, ...data }) => ({
            ...data, bytes: await readFile(join(dir, file)),
          })))
          const previews = await Promise.all(masks.map(async ({ bytes, box, area }) => {
            const alpha = await sharp(bytes).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
              .toColourspace('b-w').raw().toBuffer({ resolveWithObject: true })
            const png = await sharp({ create: { width: alpha.info.width, height: alpha.info.height, channels: 3, background: '#a78bfa' } })
              .joinChannel(alpha.data, { raw: { width: alpha.info.width, height: alpha.info.height, channels: 1 } })
              .png().toBuffer()
            return { box, area, preview: 'data:image/png;base64,' + png.toString('base64') }
          }))
          return { token: put(owner, source, fingerprint, { kind: 'subject', masks }), candidates: previews }
        })
      }
      const { masks } = get(owner, source, fingerprint, token, 'subject')
      if (!validIndex(masks, index)) throw notFound()
      const { bytes, box, area } = masks[index]
      const { width, height } = await sharp(bytes).metadata()
      const region = {
        left: Math.round(box.x * width), top: Math.round(box.y * height),
        width: Math.round(box.width * width), height: Math.round(box.height * height),
      }
      const alpha = await sharp(bytes).extract(region).toColourspace('b-w').raw().toBuffer()
      const cropped = await sharp(path).rotate().extract(region).removeAlpha().toColourspace('srgb').png().toBuffer()
      const cutout = await sharp(cropped).joinChannel(alpha, { raw: { width: region.width, height: region.height, channels: 1 } })
        .png().toBuffer()
      if (operation === 'lift') {
        if (area > 0.32) throw new StudioError(422, '主体范围太大，请缩小选区或使用对话改图。')
        return await work('fill', path, {}, async (result, dir) => {
          if (result.unusable) throw new StudioError(422, '暂时无法补全这个位置，可以仅提取主体。')
          const [asset, background] = await storeImages(owner, [cutout, await readFile(join(dir, 'background.png'))])
          return { asset, background, box }
        }, bytes)
      }
      const [asset] = await storeImages(owner, [cutout])
      return { asset, box }
    } finally {
      if (operation === 'lift') filling = false
      owners.delete(owner)
      running--
    }
  }

  async function maskFor(owner, selection, basePath, width, height) {
    if (!subject || !selection || typeof selection !== 'object' || typeof selection.token !== 'string') throw notFound()
    const { source, token, index } = selection
    const { path, fingerprint } = await resolveInput(owner, source)
    if (path !== basePath) throw new StudioError(409, '原图已变更，请重新点选。')
    const { masks } = get(owner, source, fingerprint, token, 'subject')
    if (!validIndex(masks, index)) throw notFound()
    const image = sharp(masks[index].bytes)
    const meta = await image.metadata()
    if (meta.width !== width || meta.height !== height) throw notFound()
    const alpha = await image.negate().toColourspace('b-w').raw().toBuffer()
    return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
      .joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer()
  }

  return { available, handle, maskFor }
}
