import { Ellipse, FabricImage, Gradient, Rect, StaticCanvas, Textbox, filters, type FabricObject } from 'fabric'
import type { ImageAsset } from './api'
import type { Ratio } from './catalog'
import { textColors, type Background, type CanvasItem, type Layer } from './document'
import { canvasBlob, frameImage, type Framing } from './geometry'
import { imageView } from './imageView'
import { canvasLayers } from './useCanvasLayers'

export const BOARD_WIDTH = 1000
export const boardHeight = (aspect: number) => BOARD_WIDTH / aspect
export type SceneObject = FabricObject & { studioId?: string }
export type Scene = { ratio: Ratio; aspect: number; tone: string; layer: Layer; asset: ImageAsset | null }

function typography(font: 'serif' | 'sans' = 'serif') {
  return font === 'serif'
    ? 'Songti SC, Noto Serif CJK SC, STSong, SimSun, serif'
    : 'PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif'
}
const locked = { selectable: false, evented: false, originX: 'left' as const, originY: 'top' as const }

export function layoutImage(image: FabricImage, aspect: number, framing?: Framing) {
  const { width, height } = image.getOriginalSize()
  const { crop, visible } = frameImage(width, height, aspect, framing)
  image.set({
    ...locked, left: visible.x * BOARD_WIDTH, top: visible.y * boardHeight(aspect), cropX: crop.x, cropY: crop.y,
    width: crop.width, height: crop.height,
    scaleX: visible.width * BOARD_WIDTH / crop.width, scaleY: visible.height * boardHeight(aspect) / crop.height,
  })
  return image
}

const adjustments = new WeakMap<FabricImage, string>()
export function adjustImage(image: FabricImage, background?: Background) {
  const { brightness = 0, contrast = 0, saturation = 0 } = background ?? {}
  const key = [brightness, contrast, saturation].join('/')
  if ((adjustments.get(image) ?? '0/0/0') === key) return
  image.filters = []
  if (brightness) image.filters.push(new filters.Brightness({ brightness }))
  if (contrast) image.filters.push(new filters.Contrast({ contrast }))
  if (saturation) image.filters.push(new filters.Saturation({ saturation }))
  image.applyFilters()
  adjustments.set(image, key)
}

export const paperColor = (background?: Background) => background?.color ?? '#fcfaf5'

function shade(height: number) {
  return new Rect({ ...locked, left: 0, top: 0, width: BOARD_WIDTH, height, strokeWidth: 0,
    fill: new Gradient({
      type: 'linear', coords: { x1: 0, y1: 0, x2: BOARD_WIDTH, y2: height * 0.5 },
      colorStops: [{ offset: 0, color: '#09150e96' }, { offset: 0.62, color: '#08190d20' }, { offset: 1, color: '#07110600' }],
    }),
  })
}

export async function backgroundObjects(scene: Scene, signal?: AbortSignal, view: 'preview' | 'original' = 'original'): Promise<SceneObject[]> {
  const height = boardHeight(scene.aspect)
  const background = scene.layer.background
  const items: SceneObject[] = [new Rect({
    ...locked, left: 0, top: 0, width: BOARD_WIDTH, height, strokeWidth: 0, fill: paperColor(background),
  })]
  if (scene.asset) {
    const url = view === 'preview' ? imageView(scene.asset.url, 'preview') : scene.asset.url
    const image = await FabricImage.fromURL(url, { crossOrigin: 'anonymous', signal })
    items.push(layoutImage(image, scene.aspect, background))
    adjustImage(image, background)
    if (scene.tone === 'forest') items.push(shade(height))
  }
  if (scene.tone === 'forest') items.push(new Textbox('思辰香氛', {
    ...locked, left: 90, top: height * 0.066, fontSize: 28, fontFamily: typography('sans'),
    fontWeight: 600, fill: '#fff1d6', charSpacing: 120, width: 650,
  }))
  return items
}

export function editorObjects(layer: Layer, ratio: Ratio): Array<{ id: string; options: CanvasItem }> {
  return canvasLayers(layer, ratio).map(options => ({ id: options.id, options }))
}

export function createEditorObject(item: CanvasItem, loadedImage?: FabricImage): SceneObject {
  let object: SceneObject
  if (loadedImage) object = loadedImage
  else if (item.type === 'text') object = new Textbox('', { splitByGrapheme: true, padding: 4 })
  else if (item.type === 'rectangle') object = new Rect({ rx: 12, ry: 12 })
  else object = new Ellipse()
  object.studioId = item.id
  return object
}

export function setEditorObject(object: SceneObject, item: CanvasItem, height: number, enabled: boolean) {
  const editing = object instanceof Textbox && object.isEditing
  const width = Math.max(40, item.width / 100 * BOARD_WIDTH)
  object.set({
    originX: 'left', originY: 'top', fill: item.fill ?? textColors[item.color], visible: item.visible,
    selectable: enabled && item.visible && !item.locked, evented: enabled && item.visible && !item.locked, strokeWidth: 0,
    cornerStyle: 'circle', cornerSize: 12, touchCornerSize: 27,
    cornerColor: '#fcfff9', cornerStrokeColor: '#27624d', borderColor: '#73bd96',
    transparentCorners: false, borderScaleFactor: 1.35, snapAngle: 15, snapThreshold: 4,
    lockMovementX: item.locked === true, lockMovementY: item.locked === true, lockScalingX: item.locked === true,
    lockScalingY: item.locked === true, lockRotation: item.locked === true, hasControls: item.locked !== true,
    opacity: item.opacity ?? 1,
  })
  if (!editing) {
    object.set({
      left: item.x / 100 * BOARD_WIDTH, top: item.y / 100 * height, angle: item.angle,
      scaleX: 1, scaleY: 1, flipX: item.flipX ?? false, flipY: item.flipY ?? false, width, lockScalingFlip: true,
    })
    if (object instanceof Textbox) {
      object.set({
        text: item.text || '', fontSize: item.height / 100 * BOARD_WIDTH, fontFamily: typography(item.font),
        fontWeight: item.bold === undefined ? (item.id === 'subtitle' ? 500 : 700) : (item.bold ? 700 : 400),
        fontStyle: item.italic ? 'italic' : 'normal', lineHeight: 1.13,
        editable: enabled && !item.locked, charSpacing: item.id === 'subtitle' ? 65 : 0, textAlign: item.align ?? 'left',
        shadow: item.fill || item.color === 'ink' ? null : 'rgba(7,22,14,.42) 0px 2px 6px',
      })
      object.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false })
    } else if (object instanceof FabricImage && item.asset) {
      const { width: sourceW, height: sourceH } = object.getOriginalSize()
      const boxH = Math.max(1, item.height / 100 * height)
      const { crop, visible } = frameImage(sourceW, sourceH, width / boxH, { fit: item.fit ?? 'cover' })
      const factor = visible.width * width / crop.width
      object.set({
        cropX: crop.x, cropY: crop.y, width: crop.width, height: crop.height,
        scaleX: factor, scaleY: factor,
      })
    } else if (object instanceof Ellipse) {
      object.set({ rx: width / 2, ry: item.height / 100 * height / 2 })
    } else {
      object.set({ height: item.height / 100 * height })
    }
  }
  object.setCoords()
}

export async function renderFabricImage(scene: Scene, width: number, height: number, mime: string, backgroundOnly = false) {
  const element = document.createElement('canvas')
  const canvas = new StaticCanvas(element, { width, height, enableRetinaScaling: false })
  try {
    const designHeight = boardHeight(scene.aspect)
    canvas.setViewportTransform([width / BOARD_WIDTH, 0, 0, height / designHeight, 0, 0])
    canvas.add(...await backgroundObjects(scene))
    for (const { options } of backgroundOnly ? [] : editorObjects(scene.layer, scene.ratio)) {
      if (!options.visible || options.type === 'text' && !options.text) continue
      const loaded = options.type === 'image' && options.asset
        ? await FabricImage.fromURL(options.asset.url, { crossOrigin: 'anonymous' }) : undefined
      if (options.type === 'image' && !loaded) continue
      const object = createEditorObject(options, loaded)
      setEditorObject(object, options, designHeight, false)
      canvas.add(object)
    }
    await document.fonts.ready
    canvas.renderAll()
    return await canvasBlob(element, mime)
  } finally {
    await canvas.dispose()
  }
}
