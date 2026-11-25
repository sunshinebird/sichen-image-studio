import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import sharp from 'sharp'
import { StudioError } from './store.mjs'

const variants = {
  thumb: { width: 256, height: 256, quality: 75 },
  card: { width: 384, quality: 80 },
  'card-hd': { width: 768, quality: 82 },
  cover: { width: 1280, quality: 85 },
  preview: { width: 1280, height: 1280, quality: 86 },
  detail: { width: 1792, height: 1792, quality: 89 },
}
const maxCacheBytes = 16 * 1024 * 1024
const maxPending = 48
const cache = new Map()
const pending = new Map()
let cachedBytes = 0

async function variantBytes(path, key, variant) {
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  if (pending.has(key)) return pending.get(key)
  if (pending.size >= maxPending) throw new StudioError(503, '预览暂时繁忙，请稍后重试。')

  const { quality, ...size } = variant
  const task = sharp(path, { limitInputPixels: 18_000_000 })
    .resize({ ...size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 3 })
    .toBuffer()
    .then(bytes => {
      if (bytes.length <= maxCacheBytes) {
        cache.set(key, bytes)
        cachedBytes += bytes.length
        for (const [oldKey, oldBytes] of cache) {
          if (cachedBytes <= maxCacheBytes) break
          cache.delete(oldKey)
          cachedBytes -= oldBytes.length
        }
      }
      return bytes
    })
    .finally(() => pending.delete(key))
  pending.set(key, task)
  return task
}

export async function sendImageView(req, res, path, view, shared) {
  if (!Object.hasOwn(variants, view)) return false
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new StudioError(404, '文件不存在。')

  const key = createHash('sha256')
    .update(JSON.stringify(['webp-v1', path, info.ino, info.mtimeMs, info.size, view]))
    .digest('hex')
  const tag = '"' + key + '"'
  const headers = {
    ETag: tag,
    'Cache-Control': shared ? 'public, max-age=86400' : 'private, max-age=1800',
    ...(shared ? {} : { Vary: 'Cookie' }),
  }
  const matches = req.headers['if-none-match']?.split(',').some(value => {
    const candidate = value.trim()
    return candidate === '*' || candidate.replace(/^W\//, '') === tag
  })
  if (matches) {
    res.writeHead(304, headers).end()
    return true
  }

  const bytes = await variantBytes(path, key, variants[view])
  res.writeHead(200, { ...headers, 'Content-Type': 'image/webp', 'Content-Length': bytes.length })
  res.end(bytes)
  return true
}
