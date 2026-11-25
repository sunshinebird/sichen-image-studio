import { aspectValues, type Ratio } from './catalog'
import type { ImageAsset } from './api'

export interface Rect { x: number; y: number; width: number; height: number }
export interface MaskPoint { x: number; y: number }
export interface BrushStroke { points: MaskPoint[]; width: number }
export interface BrushMask { kind: 'brush'; strokes: BrushStroke[] }
export type MaskSelection = Rect | BrushMask
export type BackgroundFit = 'original' | 'contain' | 'cover'
export interface Framing {
  fit?: BackgroundFit
  ratio?: Ratio
  cropX?: number
  cropY?: number
}
export const initialMask: Rect = { x: 0.08, y: 0.10, width: 0.30, height: 0.26 }

export function frameAspect(ratio: Ratio, asset: ImageAsset | null, framing?: Framing, fixed = false) {
  if (!fixed && asset && (!framing?.fit || framing.fit === 'original')) return asset.width / asset.height
  return aspectValues[fixed ? ratio : framing?.ratio ?? ratio]
}

export function frameImage(width: number, height: number, aspect: number, framing?: Framing) {
  const crop = framing?.fit === 'cover'
    ? coverBox(width, height, aspect)
    : { x: 0, y: 0, width, height }
  if (framing?.fit === 'cover') {
    crop.x = (width - crop.width) * (framing.cropX ?? 0.5)
    crop.y = (height - crop.height) * (framing.cropY ?? 0.5)
  }
  const scale = Math.min(aspect / crop.width, 1 / crop.height)
  const visibleWidth = crop.width * scale / aspect
  const visibleHeight = crop.height * scale
  return {
    crop,
    visible: { x: (1 - visibleWidth) / 2, y: (1 - visibleHeight) / 2, width: visibleWidth, height: visibleHeight },
  }
}

export function imageRegionOnBoard(image: ImageAsset, aspect: number, box: Rect, framing?: Framing): Rect {
  const { crop, visible } = frameImage(image.width, image.height, aspect, framing)
  return {
    x: visible.x + (box.x * image.width - crop.x) / crop.width * visible.width,
    y: visible.y + (box.y * image.height - crop.y) / crop.height * visible.height,
    width: box.width * image.width / crop.width * visible.width,
    height: box.height * image.height / crop.height * visible.height,
  }
}

export function fittingPixels(asset: ImageAsset, aspect: number, framing?: Framing): [number, number] {
  const { visible, crop } = frameImage(asset.width, asset.height, aspect, framing)
  return [crop.width / visible.width, crop.height / visible.height]
}

export function coverBox(width: number, height: number, aspect: number) {
  if (width / height > aspect) {
    const visible = height * aspect
    return { x: (width - visible) / 2, y: 0, width: visible, height }
  }
  const visible = width / aspect
  return { x: 0, y: (height - visible) / 2, width, height: visible }
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成图片文件。')), type, 0.94)
  })
}

export async function createMask(asset: ImageAsset, aspect: number, region: MaskSelection, framing?: Framing) {
  const mask = document.createElement('canvas')
  mask.width = asset.width
  mask.height = asset.height
  const ctx = mask.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法创建选区。')
  const { crop } = frameImage(asset.width, asset.height, aspect, framing)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, asset.width, asset.height)
  if ('kind' in region) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.save()
    ctx.beginPath()
    ctx.rect(crop.x, crop.y, crop.width, crop.height)
    ctx.clip()
    ctx.translate(crop.x, crop.y)
    drawBrush(ctx, region.strokes, crop.width, crop.height)
    ctx.restore()
  } else {
    ctx.clearRect(
      crop.x + crop.width * region.x, crop.y + crop.height * region.y,
      crop.width * region.width, crop.height * region.height,
    )
  }
  return canvasBlob(mask)
}

export function drawBrush(ctx: CanvasRenderingContext2D, strokes: BrushStroke[], width: number, height: number) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    const first = stroke.points[0]
    if (!first) continue
    const thick = Math.min(width, height) * stroke.width
    ctx.beginPath()
    if (stroke.points.length === 1) {
      ctx.arc(first.x * width, first.y * height, thick / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.lineWidth = thick
    ctx.moveTo(first.x * width, first.y * height)
    for (let index = 1; index < stroke.points.length; index++) {
      const point = stroke.points[index]
      ctx.lineTo(point.x * width, point.y * height)
    }
    ctx.stroke()
  }
}
