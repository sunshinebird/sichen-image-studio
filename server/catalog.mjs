import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { StudioError } from './store.mjs'

export const categories = ['product', 'poster', 'slides', 'diagram', 'story', 'retouch', 'brand']
const references = ['openai-prompting', 'openai-edit', 'open-prompts', 'youmind']
const ratios = ['portrait', 'square', 'wide']
const slug = /^[a-z][a-z0-9-]{0,47}$/
const maxManifestBytes = 2 * 1024 * 1024
const imageGroups = ['商品与零售', '餐饮与食品', '品牌与活动', '办公与科技', '教育与出版', '文旅与空间', '影视与游戏']
const industryAliases = {
  '电商': '商品与零售', '美妆': '商品与零售', '服饰': '商品与零售',
  '餐饮': '餐饮与食品', '品牌': '品牌与活动', '办公': '办公与科技', '科技': '办公与科技',
  '教育': '教育与出版', '出版': '教育与出版', '文旅': '文旅与空间', '室内': '文旅与空间',
  '影视': '影视与游戏', '游戏': '影视与游戏',
}
const industryGroup = value => Object.hasOwn(industryAliases, value) ? industryAliases[value] : value
const colors = ['cream', 'gold', 'white', 'ink']
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max
const short = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
const dimension = value => Number.isInteger(value) && value > 0 && value <= 4096

function httpsLink(value) {
  if (!short(value, 500)) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href
  } catch { /* invalid URL */ }
}

function parseCredit(value) {
  if (value === undefined) return undefined
  const credit = value && {
    author: value.author, collection: value.collection, url: httpsLink(value.url),
    license: value.license, licenseUrl: httpsLink(value.licenseUrl), changes: value.changes,
    originAuthor: value.originAuthor, originUrl: httpsLink(value.originUrl), model: value.model,
  }
  if (!credit || !short(credit.author, 72) || !short(credit.collection, 45) || !credit.url ||
      !short(credit.license, 26) || !credit.licenseUrl || !short(credit.changes, 150) ||
      (credit.originAuthor !== undefined && !short(credit.originAuthor, 80)) ||
      (credit.model !== undefined && !short(credit.model, 45))) throw new Error('案例的来源或许可信息不完整')
  return credit
}

function parseLayout(value) {
  if (value == null) return undefined
  const { x, y, titleWidth, textScale, color, subtitleX, subtitleY, subtitleWidth, subtitleScale, subtitleColor, extras } = value
  if (![x, y, subtitleX, subtitleY, titleWidth, subtitleWidth].every(part => number(part, 0, 100)) ||
      ![textScale, subtitleScale].every(part => number(part, 0.2, 3)) || ![color, subtitleColor].every(part => colors.includes(part)) ||
      !Array.isArray(extras) || extras.length > 12) throw new Error('案例布局无效')
  const textLayers = extras.map((item, index) => {
    if (!item || typeof item.text !== 'string' || item.text.length > 84 ||
        ![item.x, item.y, item.width].every(part => number(part, 0, 100)) || !number(item.height, 1, 25) ||
        !colors.includes(item.color)) throw new Error('案例的文字图层无效')
    return { id: 'template-' + (index + 1), type: 'text', text: item.text, x: item.x, y: item.y,
      width: item.width, height: item.height, color: item.color, angle: 0, visible: true, font: 'sans' }
  })
  return { x, y, titleWidth, textScale, color, subtitleX, subtitleY, subtitleWidth, subtitleScale, subtitleColor, extras: textLayers }
}

function parseOutline(outline) {
  if (!outline) return undefined
  if (!Array.isArray(outline.lines) || outline.lines.length !== 3 ||
      !outline.lines.every(line => typeof line === 'string' && line.length <= 60) ||
      !Array.isArray(outline.metrics) || outline.metrics.length !== 3 ||
      !outline.metrics.every(item => item && typeof item.label === 'string' && item.label.length <= 30 && number(item.value, 0, 99999))) {
    throw new Error('演示文稿提纲无效')
  }
  return { lines: outline.lines, metrics: outline.metrics.map(({ label, value }) => ({ label, value })) }
}

function matchesDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const value = new Date(date)
  return Number.isFinite(value.valueOf()) && value.toISOString().slice(0, 10) === date
}

export function parseManifest(bytes) {
  if (bytes.length > maxManifestBytes) throw new Error('案例清单过大')
  const items = JSON.parse(bytes)
  if (!Array.isArray(items) || items.length > 1000) throw new Error('案例清单格式无效')
  const identifiers = new Set()
  const string = (value, max) => typeof value === 'string' && value.length <= max
  return items.map(item => {
    if (!item || typeof item.id !== 'string' || !slug.test(item.id) || identifiers.has(item.id) ||
        !item.name || !string(item.name, 44) || !item.industry || !string(item.industry, 22) || !imageGroups.includes(industryGroup(item.industry)) ||
        !categories.includes(item.category) || !ratios.includes(item.ratio) ||
        !string(item.summary, 220) || !string(item.subtitle, 80) ||
        !string(item.title, 28) || !string(item.tagline, 65) ||
        !item.prompt || !string(item.prompt, 1200) || !matchesDate(item.publishedAt) ||
        ![item.width, item.height].every(dimension) ||
        !Array.isArray(item.tags) || item.tags.length > 8 || !item.tags.every(value => string(value, 22)) ||
        !Array.isArray(item.variables) || item.variables.length > 4 || !item.variables.every(field =>
          field && typeof field.key === 'string' && slug.test(field.key) && string(field.label, 36) && string(field.value, 72)) ||
        (item.reference !== undefined && !references.includes(item.reference)) ||
        (item.workKey !== undefined && (typeof item.workKey !== 'string' || !/^[a-z0-9-]{3,100}$/.test(item.workKey))) ||
        (item.model !== undefined && !short(item.model, 45)) ||
        (item.start !== undefined && !['generate', 'edit', 'upload'].includes(item.start)) ||
        (item.presentation !== undefined && !['image', 'slide-reference'].includes(item.presentation)) ||
        (item.start === 'edit' && !item.input) ||
        (item.input !== undefined && (!item.input || item.start !== 'edit' || ![item.input.width, item.input.height].every(dimension))) ||
        (item.pages !== undefined && (item.pages !== 3 || item.category !== 'slides'))) {
      throw new Error('案例条目无效或存在重复 ID')
    }
    const keys = new Set(item.variables.map(field => field.key))
    if (keys.size !== item.variables.length || [...item.prompt.matchAll(/\{\{([^{}]+)\}\}/g)].some(match => !keys.has(match[1]))) {
      throw new Error('案例提示词变量与清单不匹配')
    }
    identifiers.add(item.id)
    const { id, name, industry, category, ratio, summary, subtitle, title, tagline,
      prompt, publishedAt, width, height, tags, variables, reference, pages, collection, start, presentation, workKey, model } = item
    return { id, name, industry, category, ratio, summary, subtitle, title, tagline,
      prompt, publishedAt, width, height, tags, variables: variables.map(({ key, label, value }) => ({ key, label, value })),
      reference, pages, start, presentation, workKey, model, collection: string(collection, 38) ? collection : undefined,
      credit: parseCredit(item.credit), input: item.input ? { width: item.input.width, height: item.input.height } : undefined,
      layout: parseLayout(item.layout), outline: parseOutline(item.outline), featured: item.featured === true }
  })
}

export const liveArtPath = (directory, id) => resolve(directory, 'art', id + '.webp')
export const liveInputPath = (directory, id) => resolve(directory, 'refs', id + '.webp')
export const liveArtKey = item => item.workKey || item.id
export const caseNameKey = item => item.name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

const clearEnoughForGallery = item => Math.max(item.width, item.height) >= 1024 &&
  (!item.input || Math.max(item.input.width, item.input.height) >= 1024)

export async function validateLiveArtwork(items, directory, bundledIds) {
  // Existing artwork keeps its identity. The operator publishes a new ID when the image changes.
  for (const item of items) {
    if (bundledIds.has(item.id)) throw new Error('新案例请使用独立 ID')
    const paths = [liveArtPath(directory, item.id)]
    if (item.input) paths.push(liveInputPath(directory, item.id))
    for (const path of paths) {
      const info = await stat(path)
      if (!info.isFile() || !info.size || info.size > 6 * 1024 * 1024) throw new Error('案例图片不可用')
    }
  }
}

export async function openCatalog(root, directory) {
  const bundledBytes = await readFile(resolve(root, 'content/cases.json'))
  const templateBytes = await readFile(resolve(root, 'content/template-cases.json'))
  const curatedBytes = await readFile(resolve(root, 'content/gallery-cases.json'))
  const bundled = parseManifest(bundledBytes)
  const ownVisible = bundled.filter(item => item.id !== 'lens-exploded')
  const templates = parseManifest(templateBytes)
  const curated = parseManifest(curatedBytes)
  const bundledIds = new Set([...bundled, ...templates, ...curated].map(item => item.id))
  if (bundledIds.size !== bundled.length + templates.length + curated.length) throw new Error('内置案例 ID 冲突')
  const curatedKeys = new Set(curated.map(liveArtKey))
  if (curatedKeys.size !== curated.length) throw new Error('精选案例存在重复作品')
  const titleKeys = new Set([...curated, ...bundled].map(caseNameKey))
  if (titleKeys.size !== curated.length + bundled.length) throw new Error('精选案例如有同名，请保留唯一作品')
  const manifestPath = resolve(directory, 'cases.json')
  const baseArt = resolve(root, 'content/portfolio')
  let snapshot = buildSnapshot([])
  let observedFile
  let checkInFlight
  let checkedAt = 0

  function buildSnapshot(live) {
    const withAssetPath = (item, fromLive) => ({
      ...item,
      image: fromLive ? '/api/cases/art/' + item.id : '/art/' + item.id + '.webp',
      sourcePath: fromLive ? liveArtPath(directory, item.id) : resolve(root, 'public/art', item.id + '.webp'),
      input: item.input ? { ...item.input, url: '/api/cases/reference/' + item.id } : undefined,
      inputPath: item.input && fromLive ? liveInputPath(directory, item.id) : undefined,
    })
    // Preserve old draft URLs without putting the retired variants back in the feed.
    const archivedRows = templates.map(item => ({
      ...item, image: '/api/cases/art/' + item.id, thumbnail: '/api/cases/thumb/' + item.id,
      sourcePath: resolve(root, 'content/art', item.id + '.webp'),
      thumbPath: resolve(root, 'content/thumbs', item.id + '.webp'),
    }))
    const ownWorks = bundled.map(item => withAssetPath(item, false))
    const curatedRows = curated.map(item => ({
      ...item, image: '/api/cases/art/' + item.id, thumbnail: '/api/cases/thumb/' + item.id,
      sourcePath: resolve(baseArt, 'art', item.id + '.webp'),
      thumbPath: resolve(baseArt, 'thumbs', item.id + '.webp'),
      input: item.input ? { ...item.input, url: '/api/cases/reference/' + item.id } : undefined,
      inputPath: item.input ? resolve(baseArt, 'refs', item.id + '.webp') : undefined,
    }))
    const newRows = live.map(item => withAssetPath(item, true))
    const visibleOwn = new Set(ownVisible.map(item => item.id))
    const artwork = [...curatedRows, ...ownWorks.filter(item => visibleOwn.has(item.id))]
      .filter(clearEnoughForGallery)
    const spotlight = artwork.find(item => item.featured) ?? artwork[0] ?? ownWorks[0]
    const combined = [...artwork, ...newRows]
    const byId = new Map([...curatedRows, ...ownWorks, ...newRows, ...archivedRows].map(item => [item.id, item]))
    const rows = combined.filter(item => item.id !== spotlight?.id)
    const publicationOrder = new Map(live.map((item, index) => [item.id, index]))
    const revision = createHash('sha256').update(bundledBytes).update(curatedBytes).update(JSON.stringify(live)).digest('hex').slice(0, 20)
    return { rows, byId, publicationOrder, revision, spotlight }
  }

  async function refresh() {
    if (checkInFlight) return checkInFlight
    if (Date.now() - checkedAt < 500) return
    checkInFlight = (async () => {
      const info = await stat(manifestPath).catch(error => {
        if (error.code !== 'ENOENT') throw error
        return null
      })
      const marker = info ? info.ino + ':' + info.mtimeMs + ':' + info.size : 'missing'
      if (marker === observedFile) return
      observedFile = marker
      if (!info) { snapshot = buildSnapshot([]); return }
      if (info.size > maxManifestBytes) throw new Error('案例清单过大')
      const items = parseManifest(await readFile(manifestPath))
      const keys = new Set(curatedKeys)
      const titles = new Set(titleKeys)
      for (const item of items) {
        const key = liveArtKey(item)
        const title = caseNameKey(item)
        if (keys.has(key) || titles.has(title)) throw new Error('案例清单含有重复作品')
        keys.add(key)
        titles.add(title)
      }
      await validateLiveArtwork(items, directory, bundledIds)
      snapshot = buildSnapshot(items)
    })().catch(() => {
      console.warn('工作站保留上一版案例清单。请检查新增案例的数据和素材。')
    }).finally(() => {
      checkedAt = Date.now()
      checkInFlight = undefined
    })
    return checkInFlight
  }

  const publicRow = ({ sourcePath, inputPath, thumbPath, workKey, ...row }) => row
  async function page(params) {
    await refresh()
    const { rows, publicationOrder, revision, spotlight } = snapshot
    const category = params.get('category') || 'all'
    const industry = industryGroup(params.get('industry') || 'all')
    const query = (params.get('q') || '').trim().toLowerCase().slice(0, 80)
    const sort = params.get('sort') === 'latest' ? 'latest' : 'recommended'
    const signature = createHash('sha256').update(JSON.stringify([category, industry, query, sort])).digest('hex').slice(0, 12)
    let offset = 0
    const cursor = params.get('cursor')
    if (cursor) {
      const parts = cursor.match(/^([a-f0-9]{20})\.([a-f0-9]{12})\.(\d{1,5})$/)
      if (!parts || parts[1] !== revision || parts[2] !== signature) {
        throw new StudioError(409, '案例列表有更新，请重新加载。', 'catalog_changed')
      }
      offset = Number(parts[3])
    }

    const search = query.split(/\s+/).filter(Boolean)
    const filtered = rows.filter(item => {
      if (category !== 'all' && item.category !== category) return false
      if (industry !== 'all' && industryGroup(item.industry) !== industry) return false
      const text = [item.name, item.subtitle, item.summary, item.collection, item.credit?.author,
        item.credit?.collection, item.credit?.originAuthor, ...item.tags].join(' ').toLowerCase()
      return search.every(term => text.includes(term))
    })
    if (sort === 'latest') {
      filtered.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) ||
        (publicationOrder.get(b.id) ?? -1) - (publicationOrder.get(a.id) ?? -1))
    }
    const pageSize = 12
    const next = offset + pageSize
    return {
      items: filtered.slice(offset, next).map(publicRow),
      featured: publicRow(spotlight),
      counts: { total: rows.length, matches: filtered.length },
      industries: imageGroups,
      revision,
      nextCursor: next < filtered.length ? revision + '.' + signature + '.' + next : null,
    }
  }

  await refresh()
  return {
    page,
    async find(id) {
      if (typeof id !== 'string' || !slug.test(id)) return null
      await refresh()
      return snapshot.byId.get(id) ?? null
    },
  }
}
