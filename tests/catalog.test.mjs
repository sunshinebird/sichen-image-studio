import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { categories, openCatalog } from '../server/catalog.mjs'

test('原创示例覆盖各用途，所带素材能按实际尺寸读取', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'studio-examples-'))
  try {
    const catalog = await openCatalog(fileURLToPath(new URL('../', import.meta.url)), scratch)
    const page = await catalog.page(new URLSearchParams())
    const cases = [page.featured, ...page.items]
    assert.equal(new Set(cases.map(item => item.id)).size, cases.length)
    assert.deepEqual(new Set(cases.map(item => item.category)), new Set(categories))
    for (const item of cases) {
      const row = await catalog.find(item.id)
      const image = await sharp(row.sourcePath).metadata()
      assert.equal(image.width, row.width)
      assert.equal(image.height, row.height)
      if (item.input) assert.equal((await sharp(row.inputPath).metadata()).width, row.input.width)
    }
  } finally { await rm(scratch, { recursive: true, force: true }) }
})
