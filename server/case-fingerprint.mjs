import { createHash } from 'node:crypto'
import sharp from 'sharp'

const size = 32
const wave = Array.from({ length: 8 }, (_, k) =>
  Array.from({ length: size }, (_, i) => Math.cos(Math.PI * (i + 0.5) * k / size)),
)

function bits(values) {
  return values.reduce((value, bit) => (value << 1n) | (bit ? 1n : 0n), 0n)
}

function distance(a, b) {
  let x = a ^ b
  let n = 0
  while (x) { x &= x - 1n; n++ }
  return n
}

function luminance(pixels, width, height, flip = false) {
  const values = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue
      let total = 0
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          total += pixels[row * width + (flip ? width - col - 1 : col)] * wave[x][col] * wave[y][row]
        }
      }
      values.push(total)
    }
  }
  const median = values.slice().sort((a, b) => a - b)[31]
  return bits(values.map(value => value > median))
}

function gradients(pixels, flip = false) {
  const values = []
  const at = (x, y) => pixels[y * 9 + (flip ? 8 - x : x)]
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const value = at(x, y)
      values.push(value > at(x + 1, y), value > at(x, y + 1))
    }
  }
  return bits(values)
}

export async function caseFingerprint(path) {
  const raster = sharp(path, { limitInputPixels: 17_000_000, failOn: 'error' }).rotate()
  const [rgb, large, small] = await Promise.all([
    raster.clone().resize(48, 48, { fit: 'fill' }).toColourspace('srgb').flatten({ background: '#fff' }).raw().toBuffer(),
    raster.clone().resize(size, size, { fit: 'fill' }).flatten({ background: '#fff' }).toColourspace('b-w').raw().toBuffer(),
    raster.clone().resize(9, 9, { fit: 'fill' }).flatten({ background: '#fff' }).toColourspace('b-w').raw().toBuffer(),
  ])
  return {
    exact: createHash('sha256').update(rgb).digest('hex'),
    images: [false, true].map(flip => ({
      light: luminance(large, size, size, flip), edges: gradients(small, flip),
    })),
  }
}

export function compareCases(a, b) {
  if (a.exact === b.exact) return { duplicate: true, light: 0, edges: 0 }
  const pairs = b.images.map(image => ({
    light: distance(a.images[0].light, image.light), edges: distance(a.images[0].edges, image.edges),
  }))
  const match = pairs.find(pair => pair.light <= 9 && pair.edges <= 21)
  const nearest = pairs.sort((x, y) => 2 * x.light + x.edges - (2 * y.light + y.edges))[0]
  return { ...(match ?? nearest), duplicate: Boolean(match) }
}
