import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { imageProvider, ImageRejected, readLimited, UnknownResult } from './provider.mjs'
import { imageQuality, imageRequestProfile, imageSizes } from './image-profile.mjs'
import { sendImageView } from './image-views.mjs'
import { openCatalog } from './catalog.mjs'
import { openVision } from './vision/index.mjs'
import { openStore, publicJob, sessionOwner, sessionToken, StudioError } from './store.mjs'
import { openSub2, publicRepository } from './sub2.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const demoActions = JSON.parse(await readFile(resolve(root, 'content/demo-actions.json'), 'utf8'))
const storage = resolve(process.env.STUDIO_DATA_DIR || resolve(root, '.runtime/studio'))
const staticRoot = resolve(root, 'dist')
const requestedBind = process.env.STUDIO_BIND || '127.0.0.1'
const requestedPort = Number(process.env.STUDIO_PORT || 4175)
const provider = imageProvider()
const localBind = ['127.0.0.1', '::1'].includes(requestedBind)
if (provider.demo && !localBind) throw new Error('The local fixture requires loopback')
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const assetRoot = resolve(storage, 'assets')
const mediaRoot = resolve(storage, 'media')
const mediaId = /^[a-f0-9]{64}$/
const maxBody = 24 * 1024 * 1024
const maxUpload = 10 * 1024 * 1024
const maxPixels = 18_000_000

await mkdir(assetRoot, { recursive: true, mode: 0o700 })
const catalog = await openCatalog(root, resolve(process.env.STUDIO_CASES_DIR || resolve(storage, 'catalog')))
const store = openStore(resolve(storage, 'studio.sqlite'), {
  daily: boundedInt('STUDIO_GUEST_DAILY', 5, 0, 100),
  globalDaily: boundedInt('STUDIO_GLOBAL_DAILY', 100, 0, 100000),
  addressDaily: boundedInt('STUDIO_GUEST_IP_DAILY', 25, 0, 10000),
  concurrency: boundedInt('STUDIO_CONCURRENCY', 2, 1, 4),
})

function boundedInt(name, defaultValue, min, max) {
  if (!process.env[name]) return defaultValue
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid ' + name)
  return value
}

const sub2 = openSub2(store, { enabled: !provider.demo })
const github = publicRepository()
const ancestors = sub2.origin ? "'self' " + sub2.origin : "'self'"
const generation = { model: provider.model, quality: imageQuality, sizes: imageSizes }
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
}
const recovering = new Set()
const lastRecover = new Map()
const mediaUploading = new Set()
const mediaWriting = new Set()
const visionRoot = resolve(root, '.runtime/vision')
const vision = await openVision({
  python: process.env.STUDIO_EDIT_PYTHON || (localBind ? resolve(visionRoot, 'venv/bin/python') : ''),
  models: resolve(process.env.STUDIO_EDIT_MODELS || resolve(visionRoot, 'models')),
  resolveSource: resolveEditSource,
  storeImages: async (owner, buffers) => writeMedia(owner, await Promise.all(buffers.map(raster))),
})

function respond(res, status, result) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(result))
}

function checkOrigin(req) {
  const origin = req.headers.origin
  if (req.headers['sec-fetch-site'] === 'cross-site' ||
      (origin && (origin === 'null' || new URL(origin).host !== req.headers.host))) {
    throw new StudioError(403, '请从工作站页面发起操作。')
  }
}

function guestAddress(req) {
  const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  const forwarded = req.headers['x-real-ip']
  const trustedProxy = process.env.STUDIO_TRUST_LOOPBACK_PROXY === '1' && ['127.0.0.1', '::1'].includes(peer)
  return store.addressKey(trustedProxy && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer)
}

const quotaFor = (req, owner) => store.quota(owner, provider.demo, guestAddress(req))

function ownerFromRequest(req, res, create = true) {
  const cookie = (req.headers.cookie || '').split(/;\s*/)
    .find(item => item.startsWith('sichen_guest='))?.slice('sichen_guest='.length)
  if (cookie && /^[a-z\d_-]{43}$/i.test(cookie)) return sessionOwner(cookie)
  if (!create) throw new StudioError(404, '作品不存在。')
  const token = sessionToken()
  const secure = localBind && process.env.STUDIO_SECURE_COOKIE !== '1' ? '' : '; Secure'
  res.setHeader('Set-Cookie', 'sichen_guest=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000' + secure)
  return sessionOwner(token)
}

function validDocument(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new StudioError(400, '无法识别这个作品。')
  return value
}

async function raster(bytes) {
  try {
    const image = sharp(bytes, { limitInputPixels: maxPixels })
    const metadata = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || metadata.pages > 1 ||
        !metadata.width || !metadata.height || metadata.width > 4608 || metadata.height > 4608) {
      throw new Error('raster dimensions or format')
    }
    return await image.rotate().png().toBuffer({ resolveWithObject: true })
  } catch {
    throw new StudioError(400, '请使用尺寸在 4608 像素以内的 PNG、JPEG 或 WebP 图片。')
  }
}

async function uploaded(file) {
  if (!(file instanceof File) || !file.size || file.size > maxUpload) {
    throw new StudioError(400, '每张参考图最多 10 MB。')
  }
  return raster(Buffer.from(await file.arrayBuffer()))
}

async function saveLayerImage(req, owner) {
  if (mediaUploading.has(owner)) throw new StudioError(409, '请等上一张素材上传完成。')
  if (Number(req.headers['content-length'] || 0) > maxUpload) throw new StudioError(413, '每张素材最多 10 MB。')
  mediaUploading.add(owner)
  try {
    let bytes
    try { bytes = await readLimited(req, maxUpload) }
    catch (error) {
      if (error instanceof RangeError) throw new StudioError(413, '每张素材最多 10 MB。')
      throw error
    }
    const [asset] = await writeMedia(owner, [await raster(bytes)])
    return asset
  } finally { mediaUploading.delete(owner) }
}

async function writeMedia(owner, images) {
  if (mediaWriting.has(owner)) throw new StudioError(409, '请等上一张素材保存完成。')
  mediaWriting.add(owner)
  const folder = resolve(mediaRoot, owner)
  const pending = new Map()
  const written = []
  try {
    await mkdir(folder, { recursive: true, mode: 0o700 })
    const assets = images.map(image => {
      const id = createHash('sha256').update(image.data).digest('hex')
      return { id, url: '/api/media/' + id, width: image.info.width, height: image.info.height }
    })
    const files = (await readdir(folder)).filter(name => name.endsWith('.png') && mediaId.test(name.slice(0, -4)))
    const additional = new Map()
    for (const [index, { id }] of assets.entries()) {
      const name = id + '.png'
      if (!files.includes(name)) additional.set(name, images[index].data)
    }
    if (additional.size) {
      const sizes = await Promise.all(files.map(name => stat(resolve(folder, name)).then(info => info.size)))
      const previous = sizes.reduce((sum, size) => sum + size, 0)
      const added = [...additional.values()].reduce((sum, image) => sum + image.length, 0)
      if (files.length + additional.size > 48 || previous + added > 96 * 1024 * 1024) {
        throw new StudioError(413, '当前浏览器的素材库已满。')
      }
      for (const [name, bytes] of additional) {
        const current = resolve(folder, name)
        const temporary = current + '.pending'
        pending.set(current, temporary)
        await writeFile(temporary, bytes, { mode: 0o600 })
      }
      for (const [current, temporary] of pending) {
        await rename(temporary, current)
        written.push(current)
      }
    }
    return assets.map(({ url, width, height }) => ({ url, width, height }))
  } catch (error) {
    await Promise.allSettled(written.map(path => unlink(path)))
    throw error
  } finally {
    mediaWriting.delete(owner)
    await Promise.allSettled([...pending.values()].map(path => unlink(path)))
  }
}

async function resolveEditSource(owner, url) {
  const savedMedia = /^\/api\/media\/([a-f0-9]{64})$/.exec(url)
  if (savedMedia) return resolve(mediaRoot, owner, savedMedia[1] + '.png')
  const generated = /^\/api\/assets\/([a-f0-9-]+)$/.exec(url)
  if (generated && uuid.test(generated[1])) {
    const row = store.getForOwner(generated[1], owner)
    if (row?.status === 'succeeded') return resolve(assetRoot, row.id + '.png')
  }
  const publicCase = /^\/api\/cases\/(art|reference)\/([a-z0-9-]+)$/.exec(url)
  const bundled = /^\/art\/([a-z0-9-]+)\.webp$/.exec(url)
  if (publicCase || bundled) {
    const item = await catalog.find(publicCase?.[2] ?? bundled[1])
    const path = publicCase?.[1] === 'reference' ? item?.inputPath : item?.sourcePath
    if (path) return path
  }
  throw new StudioError(404, '找不到这张图片。')
}

async function jobSubmission(req, owner) {
  const type = req.headers['content-type'] || ''
  if (!type.startsWith('multipart/form-data;')) throw new StudioError(415, '提交格式不支持。')
  if (Number(req.headers['content-length'] || 0) > maxBody) throw new StudioError(413, '参考图总大小超过 24 MB。')
  let form
  try {
    const bytes = await readLimited(req, maxBody)
    form = await new Request('http://localhost/', { method: 'POST', body: bytes, headers: { 'Content-Type': type } }).formData()
  } catch (error) {
    if (error instanceof RangeError) throw new StudioError(413, '参考图总大小超过 24 MB。')
    throw new StudioError(400, '无法读取这次提交。')
  }
  const requestKey = validDocument(form.get('requestKey'))
  const document = validDocument(form.get('document'))
  const prompt = typeof form.get('prompt') === 'string' ? form.get('prompt').trim() : ''
  if (!prompt || prompt.length > 1200) throw new StudioError(400, '请输入 1 到 1200 字的描述。')
  const ratio = form.get('ratio')
  const profile = imageRequestProfile(ratio, form.get('resolution'))
  const intent = form.get('intent')
  const baseAsset = form.get('baseAsset')
  const baseCase = form.get('baseCase')
  const baseMedia = form.get('baseMedia')
  const baseCount = [baseAsset, baseCase, baseMedia].filter(Boolean).length
  if (baseCount > 1) throw new StudioError(400, '请只选择一张基础图片。')
  if (intent !== null && intent !== 'edit-current' && intent !== 'create') throw new StudioError(400, '无法识别创作方式。')
  if (intent === 'edit-current' && !baseCount) {
    throw new StudioError(400, '改图需要当前底图，请重新选择一个版本。', 'missing_edit_base')
  }
  if (intent === 'create' && (baseCount || form.has('mask') || form.has('pointMask'))) {
    throw new StudioError(400, '请切换为「改当前图」后使用底图或选区。', 'invalid_edit_scope')
  }
  const sources = []
  let basePath
  if (baseAsset) basePath = await resolveEditSource(owner, '/api/assets/' + validDocument(baseAsset))
  if (baseCase) {
    const item = await catalog.find(baseCase)
    if (!item) throw new StudioError(404, '找不到已选择的案例原图。')
    basePath = item.inputPath ?? item.sourcePath
  }
  if (baseMedia) {
    if (typeof baseMedia !== 'string' || !mediaId.test(baseMedia)) throw new StudioError(400, '找不到已选择的素材。')
    basePath = await resolveEditSource(owner, '/api/media/' + baseMedia)
  }
  if (basePath) {
    const bytes = await readFile(basePath).catch(error => {
      if (error.code === 'ENOENT') throw new StudioError(404, '找不到已选择的原图。')
      throw error
    })
    const image = await raster(bytes)
    sources.push({ bytes: image.data, width: image.info.width, height: image.info.height })
  }
  const references = form.getAll('reference')
  const storedReferences = [...new Set(form.getAll('referenceMedia'))]
  if (references.length + storedReferences.length > 2) throw new StudioError(400, '每次最多上传两张参考图。')
  for (const reference of references) {
    const image = await uploaded(reference)
    sources.push({ bytes: image.data, width: image.info.width, height: image.info.height })
  }
  let sourceBytes = sources.reduce((sum, source) => sum + source.bytes.length, 0)
  for (const id of storedReferences) {
    if (typeof id !== 'string' || !mediaId.test(id)) throw new StudioError(400, '无法识别这张参考图。')
    const path = await resolveEditSource(owner, '/api/media/' + id)
    if (path === basePath) continue
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) throw new StudioError(404, '参考图已不可用，请重新上传。', 'missing_reference')
    if (sourceBytes + info.size > 32 * 1024 * 1024) throw new StudioError(413, '底图和参考图合计太大，请减少参考图。')
    const bytes = await readFile(path)
    const { width, height } = await sharp(bytes).metadata()
    sourceBytes += bytes.length
    sources.push({ bytes, width, height })
  }
  let mask
  if (form.has('pointMask')) {
    if (!basePath || form.has('mask')) throw new StudioError(400, '请选择点选主体时使用的原图。')
    const choice = form.get('pointMask')
    if (typeof choice !== 'string' || choice.length > 512) throw new StudioError(400, '无法读取主体选区。')
    let selection
    try { selection = JSON.parse(choice) } catch { throw new StudioError(400, '无法读取主体选区。') }
    mask = await vision.maskFor(owner, selection, basePath, sources[0].width, sources[0].height)
  } else if (form.has('mask')) {
    if (!sources.length) throw new StudioError(400, '请先选一张原图再框选。')
    const image = await uploaded(form.get('mask'))
    if (image.info.channels !== 4 || image.info.width !== sources[0].width || image.info.height !== sources[0].height) {
      throw new StudioError(400, '框选区域与原图尺寸不一致。')
    }
    mask = image.data
  }
  if (provider.demo) {
    const supported = sources.length ? demoActions.edit.some(action => action.prompt === prompt) : prompt === demoActions.generate
    if (!supported) {
      const message = sources.length ? '本地演示仅支持编辑框上方的两个示例操作。'
        : '本地演示可输入「示例生图」体验，自定义描述需要连接图像服务。'
      throw new StudioError(422, message, 'demo_prompt_unsupported')
    }
  }
  const signature = createHash('sha256').update(JSON.stringify(
    [document, prompt, ratio, profile.resolution, profile.requestedSize, provider.model, provider.demo, sources.length, Boolean(mask)],
  ))
  for (const source of sources) signature.update(createHash('sha256').update(source.bytes).digest())
  if (mask) signature.update(createHash('sha256').update(mask).digest())
  return {
    requestKey, document, prompt, ratio, sources, mask, demo: provider.demo, requestedModel: provider.model, ...profile, fingerprint: signature.digest('hex'),
    baseReference: baseAsset ? 'asset:' + baseAsset : baseCase ? 'case:' + baseCase : baseMedia ? 'media:' + baseMedia : undefined,
    mode: sources.length ? 'edit' : 'generate',
  }
}

async function publishAsset(row, bytes) {
  let image
  try {
    image = await raster(bytes)
  } catch {
    throw new ImageRejected('返回的图片无法打开，次数已退回。')
  }
  const finalPath = resolve(assetRoot, row.id + '.png')
  const pendingPath = finalPath + '.pending'
  await writeFile(pendingPath, image.data, { mode: 0o600 })
  await rename(pendingPath, finalPath)
  store.finish(row.id, 'succeeded', '', image.info)
}

async function dispatch(row, input) {
  try {
    const bytes = await provider.submit(
      { id: row.id, prompt: row.prompt, size: row.requested_size },
      input.sources, input.mask, stage => store.stage(row.id, stage),
    )
    await publishAsset(row, bytes)
  } catch (error) {
    if (error instanceof ImageRejected) {
      store.finish(row.id, 'failed', error.message)
      return
    }
    const detail = error instanceof UnknownResult ? error.message : '暂时无法确认结果，请刷新任务状态。'
    store.finish(row.id, 'uncertain', detail)
  }
}

async function resumeResult(row) {
  if (row.status !== 'uncertain' || Boolean(row.demo) !== provider.demo || provider.mode !== 'chatgpt2api' || recovering.has(row.id)) return
  const last = lastRecover.get(row.id) || 0
  if (Date.now() - last < 5000) return
  if (lastRecover.size >= 200) lastRecover.delete(lastRecover.keys().next().value)
  lastRecover.set(row.id, Date.now())
  recovering.add(row.id)
  try {
    const bytes = await provider.recover(row.id)
    if (bytes) await publishAsset(row, bytes)
  } catch (error) {
    if (error instanceof ImageRejected) store.finish(row.id, 'failed', error.message)
  } finally {
    recovering.delete(row.id)
  }
}

async function sendFile(res, path, type, cacheControl, encoding) {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new StudioError(404, '文件不存在。')
  const headers = { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': cacheControl }
  if (encoding) headers['Content-Encoding'] = encoding
  res.writeHead(200, headers)
  createReadStream(path).on('error', () => res.destroy()).pipe(res)
}

async function sendArtwork(req, res, path, type, view, shared) {
  if (await sendImageView(req, res, path, view, shared)) return
  await sendFile(res, path, type, shared ? 'public, max-age=3600' : 'private, no-store')
}

function acceptsGzip(header = '') {
  return header.split(',').some(value => {
    const [encoding, ...parameters] = value.trim().toLowerCase().split(';')
    const quality = parameters.map(part => part.trim()).find(part => part.startsWith('q='))
    return encoding.trim() === 'gzip' && (!quality || Number(quality.slice(2)) > 0)
  })
}

async function staticFile(req, res, pathname, view) {
  const name = pathname === '/' || pathname === '/studio' ? 'index.html' : pathname.slice(1)
  const type = MIME[extname(name)]
  const path = resolve(staticRoot, name)
  if (!type || !path.startsWith(staticRoot + sep)) throw new StudioError(404, '页面不存在。')
  const actual = await realpath(path).catch(() => null)
  if (!actual?.startsWith(staticRoot + sep)) throw new StudioError(404, '页面不存在。')
  if (name.startsWith('art/') && type === 'image/webp') return sendArtwork(req, res, actual, type, view, true)
  const cache = name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  if (name.startsWith('assets/') && /\.(js|css)$/.test(name)) {
    res.setHeader('Vary', 'Accept-Encoding')
    if (acceptsGzip(req.headers['accept-encoding']) && await stat(actual + '.gz').then(info => info.isFile()).catch(() => false)) {
      return sendFile(res, actual + '.gz', type, cache, 'gzip')
    }
  }
  await sendFile(res, actual, type, cache)
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors " + ancestors)
  try {
    const url = new URL(req.url, 'http://studio.local')
    const path = url.pathname
    const method = req.method
    const imageView = url.searchParams.get('view')
    if (method === 'GET' && path === '/api/health') {
      return respond(res, 200, { status: 'ok', provider: provider.label, configured: provider.ready, demo: provider.demo, generation, editor: vision.available })
    }
    if (method === 'GET' && path === '/api/session') {
      const owner = ownerFromRequest(req, res)
      return respond(res, 200, { quota: quotaFor(req, owner), provider: { ready: provider.ready, demo: provider.demo },
        generation, editor: vision.available, sub2: sub2.info(owner), github })
    }
    if (path.startsWith('/api/account/')) {
      if (method !== 'GET') checkOrigin(req)
      const owner = ownerFromRequest(req, res)
      return respond(res, 200, await sub2.handle(req, path, owner, () => quotaFor(req, owner)))
    }
    if (method === 'GET' && path === '/api/cases') {
      return respond(res, 200, await catalog.page(url.searchParams))
    }
    if (method === 'GET' && path.startsWith('/api/cases/art/')) {
      const item = await catalog.find(path.slice('/api/cases/art/'.length))
      if (!item) throw new StudioError(404, '找不到这个案例。')
      return await sendArtwork(req, res, item.sourcePath, 'image/webp', imageView, true)
    }
    if (method === 'GET' && path.startsWith('/api/cases/thumb/')) {
      const item = await catalog.find(path.slice('/api/cases/thumb/'.length))
      if (!item?.thumbPath) throw new StudioError(404, '找不到案例预览。')
      return await sendFile(res, item.thumbPath, 'image/webp', 'public, max-age=120')
    }
    if (method === 'GET' && path.startsWith('/api/cases/reference/')) {
      const item = await catalog.find(path.slice('/api/cases/reference/'.length))
      if (!item?.inputPath) throw new StudioError(404, '找不到案例原始素材。')
      return await sendArtwork(req, res, item.inputPath, 'image/webp', imageView, true)
    }
    if (method === 'POST' && path === '/api/vision') {
      checkOrigin(req)
      const owner = ownerFromRequest(req, res)
      return respond(res, 200, await vision.handle(req, owner))
    }
    if (method === 'POST' && path === '/api/media') {
      checkOrigin(req)
      const owner = ownerFromRequest(req, res)
      return respond(res, 201, { asset: await saveLayerImage(req, owner) })
    }
    if (method === 'GET' && path.startsWith('/api/media/')) {
      const owner = ownerFromRequest(req, res, false)
      const id = path.slice('/api/media/'.length)
      if (!/^[a-f0-9]{64}$/.test(id)) throw new StudioError(404, '找不到这张素材。')
      return await sendArtwork(req, res, resolve(mediaRoot, owner, id + '.png'), 'image/png', imageView, false)
    }
    if (method === 'POST' && path === '/api/jobs') {
      checkOrigin(req)
      if (!provider.ready) throw new StudioError(503, '图像服务尚未配置。')
      const owner = ownerFromRequest(req, res)
      const input = { ...await jobSubmission(req, owner), address: guestAddress(req) }
      const { row, created } = store.accept(owner, input)
      respond(res, created ? 202 : 200, { job: publicJob(row), quota: quotaFor(req, owner) })
      if (created) setImmediate(() => { void dispatch(row, input) })
      return
    }
    if (method === 'GET' && path === '/api/jobs') {
      const owner = ownerFromRequest(req, res)
      const document = validDocument(url.searchParams.get('document'))
      const jobs = store.list(owner, document)
      for (const row of jobs.slice(0, 2)) void resumeResult(row)
      return respond(res, 200, { jobs: jobs.map(publicJob), quota: quotaFor(req, owner) })
    }
    if (method === 'GET' && path.startsWith('/api/jobs/')) {
      const owner = ownerFromRequest(req, res, false)
      const row = store.getForOwner(validDocument(path.slice('/api/jobs/'.length)), owner)
      if (!row) throw new StudioError(404, '找不到这个出图任务。')
      void resumeResult(row)
      return respond(res, 200, { job: publicJob(row), quota: quotaFor(req, owner) })
    }
    if (method === 'GET' && path.startsWith('/api/assets/')) {
      const owner = ownerFromRequest(req, res, false)
      const row = store.getForOwner(validDocument(path.slice('/api/assets/'.length)), owner)
      if (!row || row.status !== 'succeeded') throw new StudioError(404, '找不到这张图。')
      return await sendArtwork(req, res, resolve(assetRoot, row.id + '.png'), 'image/png', imageView, false)
    }
    if (method === 'GET' && !path.startsWith('/api/')) return await staticFile(req, res, path, imageView)
    throw new StudioError(404, '找不到这个入口。')
  } catch (error) {
    if (res.headersSent) return res.destroy()
    if (error instanceof StudioError) return respond(res, error.status, { error: { message: error.message, code: error.code } })
    console.error('Studio request failed:', error.constructor.name)
    return respond(res, 500, { error: { message: '工作站暂时无法处理请求。', code: 'internal' } })
  }
})
server.requestTimeout = 35000
server.headersTimeout = 12000
server.listen(requestedPort, requestedBind, () => console.log('Studio ready at http://' + requestedBind + ':' + requestedPort))
server.on('error', error => {
  console.error('Cannot start studio:', error.code || error.constructor.name)
  process.exitCode = 1
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(() => process.exit(0)))
}
