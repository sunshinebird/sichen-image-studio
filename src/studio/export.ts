import type { ImageAsset } from './api'
import type { Clarity, Ratio } from './catalog'
import { textColors, type Layer, type Slide } from './document'
import { canvasLayers } from './useCanvasLayers'
import { canvasBlob, fittingPixels, frameAspect, frameImage, type Framing } from './geometry'

const targetSizes: Record<Ratio, Record<Clarity, [number, number]>> = {
  wide: { auto: [1280, 720], '2k': [2560, 1440], '4k': [3840, 2160] },
  portrait: { auto: [1024, 1280], '2k': [1600, 2000], '4k': [3072, 3840] },
  square: { auto: [1024, 1024], '2k': [2048, 2048], '4k': [3840, 3840] },
}

export function outputSize(ratio: Ratio, clarity: Clarity, asset: ImageAsset | null, framing?: Framing, fixed = false): [number, number] {
  const target = targetSizes[fixed ? ratio : framing?.ratio ?? ratio][clarity]
  if (!asset) return target
  const aspect = frameAspect(ratio, asset, framing, fixed)
  if (clarity !== 'auto') {
    if (Math.abs(aspect - target[0] / target[1]) < 0.000001) return target
    const longEdge = Math.max(...target)
    return aspect >= 1 ? [longEdge, Math.max(1, Math.round(longEdge / aspect))]
      : [Math.max(1, Math.round(longEdge * aspect)), longEdge]
  }
  const [width, height] = fittingPixels(asset, aspect, framing)
  const scale = Math.min(1, 2048 / Math.max(width, height))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  return image.decode().then(() => image)
}

async function pptImageData(asset: ImageAsset, width: number, height: number, fit = 'cover') {
  const image = await loadImage(asset.url)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法处理 PPT 图片。')
  const { crop, visible } = frameImage(image.naturalWidth, image.naturalHeight, width / height, { fit: fit === 'contain' ? 'contain' : 'cover' })
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height,
    visible.x * width, visible.y * height, visible.width * width, visible.height * height)
  return canvas.toDataURL('image/png')
}

function putLines(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, lineHeight: number) {
  let line = ''
  for (const char of value) {
    if (char === '\n' || (line && ctx.measureText(line + char).width > width)) {
      ctx.fillText(line, x, y)
      y += lineHeight
      line = ''
      if (char === '\n') continue
    }
    line += char
  }
  ctx.fillText(line, x, y)
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name.replace(/[\\/:*?"<>|]/g, '-')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 20000)
}

export async function exportImage(input: {
  name: string; layer: Layer; tone: string; ratio: Ratio; clarity: Clarity
  asset: ImageAsset | null; format: 'png' | 'jpeg'; slide?: Slide
}) {
  const { layer, asset, format, tone, slide } = input
  const [width, height] = outputSize(input.ratio, input.clarity, slide && slide.kind !== 'cover' ? null : asset, layer.background, Boolean(slide))
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  if (!slide || slide.kind === 'cover') {
    const { renderFabricImage } = await import('./fabricScene')
    const aspect = frameAspect(input.ratio, asset, layer.background, Boolean(slide))
    const blob = await renderFabricImage({ layer, asset, tone, ratio: input.ratio, aspect }, width, height, mime)
    download(blob, input.name + (format === 'png' ? '.png' : '.jpg'))
    return
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法导出图片。')
  ctx.fillStyle = '#f5f4eb'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'top'
  if (layer.visible && layer.titleVisible !== false) {
    ctx.fillStyle = layer.titleStyle?.fill ?? textColors[layer.color]
    const size = Math.round(width * 0.064 * layer.textScale)
    const family = layer.font === 'sans' ? 'system-ui, sans-serif' : 'Songti SC, Noto Serif CJK SC, serif'
    ctx.font = (layer.titleStyle?.italic ? 'italic ' : '') + (layer.titleStyle?.bold === false ? '400 ' : '700 ') + size + 'px ' + family
    ctx.textAlign = layer.titleAlign ?? 'left'
    putLines(ctx, layer.title, width * (layer.x + (layer.titleAlign === 'center' ? (layer.titleWidth ?? 78) / 2 : 0)) / 100,
      height * layer.y / 100, width * (layer.titleWidth ?? 78) / 100, size * 1.18)
  }
  if (layer.visible && layer.subtitleVisible !== false) {
    ctx.fillStyle = layer.subtitleStyle?.fill ?? textColors[layer.subtitleColor ?? layer.color]
    const family = layer.subtitleStyle?.font === 'serif' ? 'Songti SC, Noto Serif CJK SC, serif' : 'system-ui, sans-serif'
    ctx.font = (layer.subtitleStyle?.italic ? 'italic ' : '') + (layer.subtitleStyle?.bold ? '700 ' : '500 ')
      + Math.round(width * 0.032 * (layer.subtitleScale ?? 1)) + 'px ' + family
    ctx.textAlign = layer.subtitleAlign ?? 'left'
    const x = (layer.subtitleX ?? 9) + (layer.subtitleAlign === 'center' ? (layer.subtitleWidth ?? 78) / 2 : 0)
    ctx.fillText(layer.subtitle, width * x / 100, height * 0.30, width * 0.83)
  }
  ctx.textAlign = 'left'
  if (slide?.kind === 'features') {
    ctx.fillStyle = '#193149'
    ctx.font = Math.round(width * 0.036) + 'px system-ui'
    putLines(ctx, slide.notes, width * 0.1, height * 0.43, width * 0.8, height * 0.13)
  }
  if (slide?.kind === 'data') {
    const max = Math.max(1, ...slide.metrics.map(metric => metric.value))
    slide.metrics.forEach((metric, index) => {
      const y = height * (0.47 + index * 0.13)
      ctx.fillStyle = '#18335b'
      ctx.font = Math.round(width * 0.032) + 'px system-ui'
      ctx.fillText(metric.label, width * 0.10, y, width * 0.25)
      ctx.fillStyle = '#3156a1'
      ctx.fillRect(width * 0.38, y, width * 0.42 * metric.value / max, height * 0.06)
      ctx.fillStyle = '#18335b'
      ctx.fillText(String(metric.value), width * 0.83, y)
    })
  }
  const blob = await canvasBlob(canvas, mime)
  download(blob, input.name + (format === 'png' ? '.png' : '.jpg'))
}

async function pptCover(pages: Slide[], cover: ImageAsset | null) {
  const page = pages.find(item => item.kind === 'cover')
  if (!page || (!cover && !page.layer.background?.color)) return null
  const { renderFabricImage } = await import('./fabricScene')
  const blob = await renderFabricImage({ ratio: 'wide', aspect: 16 / 9, tone: '', layer: page.layer, asset: cover }, 1600, 900, 'image/png', true)
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法生成演示文稿封面。'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export async function exportPresentation(name: string, pages: Slide[], cover: ImageAsset | null) {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = '思辰生图工作站'
  pptx.title = name
  const backgroundData = await pptCover(pages, cover)
  for (const page of pages) {
    const slide = pptx.addSlide()
    slide.background = { color: 'F6F4EA' }
    if (page.kind === 'cover' && backgroundData) slide.addImage({ data: backgroundData, x: 0, y: 0, w: 13.333, h: 7.5 })
    for (const item of canvasLayers(page.layer, 'wide')) {
      if (!item.visible) continue
      const color = (item.fill ?? textColors[item.color]).replace('#', '').replace(/^fff$/, 'FFFFFF')
      const x = item.x * 13.333 / 100
      const y = item.id === 'subtitle' && page.kind !== 'cover' ? 2.25 : item.y * 7.5 / 100
      const w = item.width * 13.333 / 100
      const rotate = (item.angle + 360) % 360
      const transparency = Math.round((1 - (item.opacity ?? 1)) * 100)
      if (item.type === 'text' && item.text) {
        slide.addText(item.text, {
          x, y, w, h: Math.max(0.42, item.height / 6), fontSize: item.height * (page.kind === 'cover' ? 5.6 : 4.6),
          margin: 0, bold: item.bold ?? (item.id !== 'subtitle'), italic: item.italic ?? false, color,
          fontFace: item.font === 'serif' ? '宋体' : '微软雅黑',
          align: item.align ?? 'left', rotate, valign: 'top', transparency,
        })
      } else if (item.type === 'image' && item.asset) {
        const h = item.height * 7.5 / 100
        const data = await pptImageData(item.asset, Math.max(1, Math.round(w * 120)), Math.max(1, Math.round(h * 120)), item.fit)
        slide.addImage({ data, x, y, w, h, rotate, transparency, flipH: item.flipX, flipV: item.flipY })
      } else if (item.type === 'rectangle' || item.type === 'circle') {
        slide.addShape(item.type === 'rectangle' ? pptx.ShapeType.roundRect : pptx.ShapeType.ellipse, {
          x, y, w, h: item.height * 7.5 / 100, rotate, fill: { color, transparency }, line: { transparency: 100 },
        })
      }
    }
    if (page.kind === 'features') {
      slide.addText(page.notes, { x: 1.3, y: 3.05, w: 10.7, h: 3.2, fontSize: 23, color: '18335B', breakLine: false, margin: 0 })
    }
    if (page.kind === 'data') {
      slide.addChart(pptx.ChartType.bar, [{
        name: '试用反馈', labels: page.metrics.map(metric => metric.label), values: page.metrics.map(metric => metric.value),
      }], { x: 1.1, y: 3.0, w: 10.9, h: 3.8, showLegend: false, showValue: true, chartColors: ['3156A1'] })
    }
  }
  const blob = await pptx.write({ outputType: 'blob' })
  if (!(blob instanceof Blob)) throw new Error('无法生成 PPT 文件。')
  download(blob, name + '.pptx')
}
