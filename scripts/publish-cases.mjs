import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { caseNameKey, liveArtKey, liveArtPath, liveInputPath, parseManifest, validateLiveArtwork } from '../server/catalog.mjs'
import { caseFingerprint, compareCases } from '../server/case-fingerprint.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = resolve(process.env.STUDIO_CASES_DIR || resolve(process.env.STUDIO_DATA_DIR || resolve(root, '.runtime/studio'), 'catalog'))
const manifest = process.argv[2]
if (!manifest) throw new Error('请提供案例清单路径。图片应已放进案例目录的 art 子目录。')

const [ownWorks, archived, curated] = await Promise.all(['cases.json', 'template-cases.json', 'gallery-cases.json'].map(async name =>
  parseManifest(await readFile(resolve(root, 'content', name)))))
const bundledIds = new Set([...ownWorks, ...archived, ...curated].map(item => item.id))
const entries = parseManifest(await readFile(manifest))
const target = resolve(directory, 'cases.json')
await mkdir(directory, { recursive: true, mode: 0o700 })
const lockPath = resolve(directory, '.publish.lock')
const lock = await open(lockPath, 'wx', 0o600)
const temporary = resolve(directory, '.publish-' + randomUUID() + '.json')
try {
  const current = await readFile(target).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return Buffer.from('[]')
  })
  const items = new Map(parseManifest(current).map(item => [item.id, item]))
  for (const item of entries) items.set(item.id, item)
  await validateLiveArtwork([...items.values()], directory, bundledIds)

  const artworks = [
    ...ownWorks.map(item => ({ item, path: resolve(root, 'public/art', item.id + '.webp') })),
    ...curated.map(item => ({ item, path: resolve(root, 'content/portfolio/art', item.id + '.webp') })),
  ]
  const names = new Map(artworks.map(({ item }) => [caseNameKey(item), item.id]))
  const works = new Map(artworks.map(({ item }) => [liveArtKey(item), item.id]))
  for (const item of items.values()) {
    const title = caseNameKey(item)
    const work = liveArtKey(item)
    const previous = works.get(work) ?? names.get(title)
    if (previous) throw new Error(`重复或同源案例：${item.id} / ${previous}`)
    names.set(title, item.id)
    works.set(work, item.id)
    async function checkMedia(path, size) {
      const meta = await sharp(path, { limitInputPixels: 16_800_000 }).metadata()
      if (meta.format !== 'webp' || meta.width !== size.width || meta.height !== size.height || meta.pages > 1) {
        throw new Error('图片实际格式或尺寸不符 ' + item.id)
      }
    }
    const path = liveArtPath(directory, item.id)
    await checkMedia(path, item)
    if (item.input) await checkMedia(liveInputPath(directory, item.id), item.input)
    artworks.push({ item, path, live: true })
  }
  const hashes = []
  for (let i = 0; i < artworks.length; i += 8) {
    const batch = artworks.slice(i, i + 8)
    const samples = await Promise.all(batch.map(({ path }) => caseFingerprint(path)))
    for (const [index, fingerprint] of samples.entries()) {
      const { item, live } = batch[index]
      if (live) {
        const previous = hashes.find(row => compareCases(row.fingerprint, fingerprint).duplicate)
        if (previous) throw new Error(`案例图片重复或过于相似：${item.id} / ${previous.id}`)
      }
      hashes.push({ id: item.id, fingerprint })
    }
  }
  await writeFile(temporary, JSON.stringify([...items.values()], null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await rename(temporary, target)
  console.log('已发布 ' + entries.length + ' 条，当前追加案例共 ' + items.size + ' 条。')
} finally {
  await lock.close()
  await unlink(lockPath)
  await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
}
