<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { Image } from 'lucide-vue-next'
import { ActiveSelection, Canvas, FabricImage, Rect, Textbox } from 'fabric'
import type { ImageAsset } from '../studio/api'
import type { Ratio } from '../studio/catalog'
import type { CanvasItem, Layer } from '../studio/document'
import { adjustImage, backgroundObjects, BOARD_WIDTH, boardHeight, createEditorObject, editorObjects, layoutImage, paperColor, setEditorObject, type SceneObject } from '../studio/fabricScene'
import { drawBrush, frameImage, type BrushStroke, type MaskPoint, type Rect as MaskRegion } from '../studio/geometry'
import { arrangeLayers, type ArrangeAction } from '../studio/arrangeLayers'
import { canMoveTogether } from '../studio/useCanvasLayers'
import { imageView } from '../studio/imageView'

const props = defineProps<{
  asset: ImageAsset | null; layer: Layer; ratio: Ratio; aspect: number; tone: string; editing: boolean; interactiveOverlay?: boolean; selected: string[]
  zoom: number; comparing: boolean; original: ImageAsset | null; originalLabel: string
  masking: boolean; selection?: MaskRegion
  brush: boolean; brushWidth: number; strokes: BrushStroke[]
}>()
const emit = defineEmits<{
  select: [ids: string[]]; selectGroup: [id: string]
  commit: [item: CanvasItem, group?: string]; commitBatch: [items: CanvasItem[]]; selection: [region: MaskRegion]; edit: []
  zoomChanged: [value: number]
  stroke: [value: BrushStroke]
}>()

const target = useTemplateRef<HTMLCanvasElement>('target')
const viewport = useTemplateRef<HTMLDivElement>('viewport')
const mask = useTemplateRef<HTMLDivElement>('mask')
const brushCanvas = useTemplateRef<HTMLCanvasElement>('brush-canvas')
const loadError = shallowRef(false)
const loadingBackground = shallowRef(Boolean(props.asset))
const hasPaintedImage = shallowRef(false)
const split = shallowRef(50)
const bounds = shallowRef({ width: 1, height: 1 })
const previewView = computed(() => {
  const renderedEdge = Math.max(bounds.value.width, bounds.value.height) * Math.min(window.devicePixelRatio || 1, 2)
  const pictures = props.comparing ? [props.asset, props.original] : [props.asset]
  const hasLargePicture = pictures.some(asset => asset && Math.max(asset.width, asset.height) > 1280)
  return renderedEdge > 1280 && hasLargePicture ? 'detail' : 'preview'
})
const guides = shallowRef<{ x?: number; y?: number }>({})
const entries = computed(() => props.interactiveOverlay ? [] : editorObjects(props.layer, props.ratio))
const region = computed(() => props.asset ? frameImage(props.asset.width, props.asset.height, props.aspect, props.layer.background).visible
  : { x: 0, y: 0, width: 1, height: 1 })
const maskBounds = computed(() => regionStyle(region.value))
const regionPixels = computed(() => ({
  width: Math.max(1, Math.round(bounds.value.width * region.value.width)),
  height: Math.max(1, Math.round(bounds.value.height * region.value.height)),
}))
const maskStyle = computed(() => props.selection ? regionStyle(props.selection) : undefined)
const canvasPlain = computed(() => !props.asset && !entries.value.some(({ options: item }) => item.visible && (item.type !== 'text' || item.text)))
let canvas: Canvas | undefined
let comparisonClip: Rect | undefined
let comparisonImage: FabricImage | undefined
let background: SceneObject[] = []
let imageRequest: AbortController | undefined
let observer: ResizeObserver | undefined
let applying = false
let maskStart: { x: number; y: number; box: DOMRect } | undefined
let trace: MaskPoint[] = []
let linkedDrag: { id: string; members: CanvasItem[] } | undefined
const objects = new Map<string, SceneObject>()
const loadingImages = new Map<string, { controller: AbortController; url: string }>()
const imageUrls = new Map<string, string>()
const round = (value: number) => Math.round(value * 100) / 100

function regionStyle(box: MaskRegion) {
  return {
    left: box.x * 100 + '%', top: box.y * 100 + '%',
    width: box.width * 100 + '%', height: box.height * 100 + '%',
  }
}

class PreviewCanvas extends Canvas {
  getRetinaScaling() {
    const area = this.getWidth() * this.getHeight()
    return Math.max(1, Math.min(super.getRetinaScaling(), 2, Math.sqrt(4_000_000 / Math.max(area, 1))))
  }
}

function withProgrammaticSelection(action: () => void) {
  const previous = applying
  applying = true
  try { action() } finally { applying = previous }
}

function activeObjects() {
  return (canvas?.getActiveObjects() ?? []) as SceneObject[]
}

function configureSelection(selection: ActiveSelection) {
  selection.set({
    hasControls: false, lockScalingX: true, lockScalingY: true, lockRotation: true,
    borderColor: '#5ba786', borderScaleFactor: 1.2,
  })
}

function fit() {
  if (!canvas || !viewport.value) return
  const stage = viewport.value
  const height = boardHeight(props.aspect)
  const padding = getComputedStyle(stage)
  const availableWidth = Math.max(1, stage.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight))
  const availableHeight = Math.max(1, stage.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom))
  const fitting = Math.min(availableWidth / BOARD_WIDTH, availableHeight / height)
  const maxScale = Math.sqrt(6_000_000 / (BOARD_WIDTH * height))
  const zoom = Math.min(maxScale, fitting * props.zoom)
  const width = Math.max(1, Math.round(BOARD_WIDTH * zoom))
  const pixelHeight = Math.max(1, Math.round(height * zoom))
  bounds.value = { width, height: pixelHeight }
  canvas.setDimensions({ width, height: pixelHeight })
  canvas.setViewportTransform([zoom, 0, 0, zoom, 0, 0])
  emit('zoomChanged', Math.round(zoom / fitting * 100))
}

function renderComparison() {
  comparisonClip?.set('width', BOARD_WIDTH * split.value / 100)
  for (const object of background) object.dirty = true
  canvas?.requestRenderAll()
}

async function renderBackground() {
  if (!canvas) return
  imageRequest?.abort()
  const current = new AbortController()
  imageRequest = current
  loadingBackground.value = Boolean(props.asset)
  const instance = canvas
  const height = boardHeight(props.aspect)
  const view = previewView.value
  let items: SceneObject[] = []
  try {
    items = await backgroundObjects({ layer: props.layer, ratio: props.ratio, aspect: props.aspect, tone: props.tone, asset: props.asset }, current.signal, view)
    let clip: Rect | undefined
    let compare: FabricImage | undefined
    if (props.comparing && props.original) {
      const image = await FabricImage.fromURL(imageView(props.original.url, view), { crossOrigin: 'anonymous', signal: current.signal })
      clip = new Rect({
        originX: 'left', originY: 'top', left: 0, top: 0, width: BOARD_WIDTH * split.value / 100,
        height, strokeWidth: 0, absolutePositioned: true,
      })
      layoutImage(image, props.aspect, props.layer.background).set('clipPath', clip)
      items.splice(2, 0, image)
      compare = image
    }
    if (current.signal.aborted || canvas !== instance) {
      items.forEach(item => item.dispose())
      return
    }
    comparisonClip = clip
    comparisonImage = compare
    instance.remove(...background)
    background.forEach(item => item.dispose())
    background = items
    updateFraming()
    instance.insertAt(0, ...items)
    hasPaintedImage.value = items[1] instanceof FabricImage
    loadError.value = false
    renderObjects()
  } catch {
    items.forEach(item => item.dispose())
    if (!current.signal.aborted) loadError.value = true
  } finally {
    if (imageRequest === current && !current.signal.aborted) loadingBackground.value = false
  }
}

function updateFraming() {
  const [paper, image] = background
  paper?.set({ height: boardHeight(props.aspect), fill: paperColor(props.layer.background) })
  if (image instanceof FabricImage) {
    layoutImage(image, props.aspect, props.layer.background)
    adjustImage(image, props.layer.background)
  }
  if (comparisonImage) layoutImage(comparisonImage, props.aspect, props.layer.background)
  renderComparison()
}

function renderSelection() {
  const instance = canvas
  if (!instance || !props.editing) return
  const selected = props.selected.map(id => objects.get(id)).filter((object): object is SceneObject =>
    Boolean(object?.visible && (props.selected.length === 1 || !object.lockMovementX)),
  )
  const active = activeObjects()
  if (active.length === selected.length && active.every(object => selected.includes(object))) return
  withProgrammaticSelection(() => {
    instance.discardActiveObject()
    if (selected.length === 1) instance.setActiveObject(selected[0])
    if (selected.length > 1) {
      const choice = new ActiveSelection(selected, { canvas: instance })
      configureSelection(choice)
      instance.setActiveObject(choice)
    }
  })
  instance.requestRenderAll()
}

function renderObjects() {
  const instance = canvas
  if (!instance) return
  // Fabric stores selected objects relative to the selection. Restore their scene
  // coordinates before mirroring positions from the document.
  if (instance.getActiveObject() instanceof ActiveSelection) {
    withProgrammaticSelection(() => { instance.discardActiveObject() })
  }
  const height = boardHeight(props.aspect)
  const remaining = new Map(entries.value.map(entry => [entry.id, entry.options.asset?.url]))
  for (const [id, object] of objects) {
    if (remaining.has(id) && remaining.get(id) === imageUrls.get(id)) continue
    withProgrammaticSelection(() => { instance.remove(object) })
    object.dispose()
    objects.delete(id)
    imageUrls.delete(id)
  }
  for (const [id, request] of loadingImages) {
    if (remaining.get(id) !== request.url) { request.controller.abort(); loadingImages.delete(id) }
  }
  entries.value.forEach(({ id, options }, index) => {
    let object = objects.get(id)
    if (!object) {
      if (options.type === 'image') {
        if (options.asset && !loadingImages.has(id)) void loadLayerImage(options)
        return
      }
      object = createEditorObject(options)
      objects.set(id, object)
      instance.add(object)
    }
    const composing = object instanceof Textbox && object.isEditing
    setEditorObject(object, { ...options, visible: options.visible && (options.type !== 'text' || Boolean(options.text) || composing) }, height, props.editing)
    instance.moveObjectTo(object, background.length + index)
  })
  renderSelection()
  instance.requestRenderAll()
}

async function loadLayerImage(item: CanvasItem) {
  if (!item.asset) return
  const controller = new AbortController()
  const url = item.asset.url
  loadingImages.set(item.id, { controller, url })
  try {
    const image = await FabricImage.fromURL(imageView(item.asset.url, 'preview'), { crossOrigin: 'anonymous', signal: controller.signal })
    if (!canvas || controller.signal.aborted) { image.dispose(); return }
    const object = createEditorObject(item, image)
    objects.set(item.id, object)
    imageUrls.set(item.id, url)
    canvas.add(object)
    renderObjects()
  } catch {
    if (!controller.signal.aborted) loadError.value = true
  } finally {
    if (loadingImages.get(item.id)?.controller === controller) loadingImages.delete(item.id)
  }
}

function snapObject(object: SceneObject, precision: boolean) {
  if (precision || object.lockMovementX) { guides.value = {}; return }
  const height = boardHeight(props.aspect)
  const limit = 7 / Math.max(0.15, canvas?.getZoom() ?? 1)
  const rect = object.getBoundingRect()
  const match = (start: number, size: number, edge: number) => {
    const options = [
      { line: 0, change: -start },
      { line: edge / 2, change: edge / 2 - (start + size / 2) },
      { line: edge, change: edge - (start + size) },
    ]
    return options.find(item => Math.abs(item.change) <= limit)
  }
  const x = match(rect.left, rect.width, BOARD_WIDTH)
  const y = match(rect.top, rect.height, height)
  if (x) object.set('left', object.left + x.change)
  if (y) object.set('top', object.top + y.change)
  object.setCoords()
  guides.value = { x: x ? x.line / BOARD_WIDTH * 100 : undefined, y: y ? y.line / height * 100 : undefined }
}

function commit(object: SceneObject | undefined, textual = false) {
  if (!object?.studioId) return
  const previous = entries.value.find(item => item.id === object.studioId)?.options
  if (!previous) return
  const bound = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, round(value)))
  const text = object instanceof Textbox
  const normalized = {
    ...previous,
    x: bound(object.left / BOARD_WIDTH * 100, -35, 98),
    y: bound(object.top / boardHeight(props.aspect) * 100, -28, 98),
    width: bound((object.width * object.scaleX) / BOARD_WIDTH * 100, 4, 100),
    height: text
      ? bound((object.fontSize * object.scaleY) / BOARD_WIDTH * 100, 1.7, 28)
      : bound((object.height * object.scaleY) / boardHeight(props.aspect) * 100, 3, 100),
    angle: round(((object.angle + 180) % 360 + 360) % 360 - 180),
  }
  if (text && textual) normalized.text = object.text.slice(0, previous.id === 'title' ? 28 : 84)
  emit('commit', normalized, textual ? 'canvas-text:' + previous.id : undefined)
}

function translatedLayers(members: CanvasItem[], anchor: SceneObject) {
  const prior = members.find(item => item.id === anchor.studioId)
  if (!prior) return []
  const point = anchor.getXY()
  const dx = point.x / BOARD_WIDTH * 100 - prior.x
  const dy = point.y / boardHeight(props.aspect) * 100 - prior.y
  if (members.some(item => item.x + dx < -35 || item.x + dx > 98 || item.y + dy < -28 || item.y + dy > 98)) return []
  return members.map(item => ({ ...item, x: round(item.x + dx), y: round(item.y + dy) }))
}

function moveSelection(selection: ActiveSelection) {
  const selected = selection.getObjects() as SceneObject[]
  const members = entries.value.map(item => item.options).filter(item =>
    canMoveTogether(item) && selected.some(object => object.studioId === item.id),
  )
  const anchor = selected.find(object => object.studioId === members[0]?.id)
  const positions = anchor ? translatedLayers(members, anchor) : []
  if (positions.length) emit('commitBatch', positions)
  else renderObjects()
}

function followLinkedDrag(object: SceneObject, independent: boolean) {
  const id = object.studioId
  if (!id || object.lockMovementX) return
  if (!linkedDrag && !independent) {
    const group = props.layer.groups?.find(ids => ids.includes(id))
    const members = group ? entries.value.map(item => item.options).filter(item => group.includes(item.id) && canMoveTogether(item)) : []
    if (members.length > 1) linkedDrag = { id, members }
  }
  if (linkedDrag?.id !== id) return
  const positions = translatedLayers(linkedDrag.members, object)
  const height = boardHeight(props.aspect)
  // The first drag from an unselected group is targeted at the clicked object.
  // Move its other members live, then commit all positions together on release.
  for (const member of positions.length ? positions : linkedDrag.members) {
    const sibling = objects.get(member.id)
    if (!sibling || sibling === object) continue
    sibling.set({ left: member.x * BOARD_WIDTH / 100, top: member.y * height / 100 })
    sibling.setCoords()
  }
}

function arrange(action: ArrangeAction) {
  if (!props.editing) return
  const items = entries.value.flatMap(({ id, options }) => {
    const object = objects.get(id)
    return object && props.selected.includes(id) && canMoveTogether(options)
      ? [{ options, box: object.getBoundingRect() }] : []
  })
  const offsets = arrangeLayers(items.map(item => item.box), action)
  if (!offsets.length) return
  const height = boardHeight(props.aspect)
  emit('commitBatch', items.map(({ options }, index) => ({
    ...options, x: round(options.x + offsets[index].x / BOARD_WIDTH * 100),
    y: round(options.y + offsets[index].y / height * 100),
  })))
}

defineExpose({ arrange })

onMounted(() => {
  if (!target.value || !viewport.value) return
  canvas = new PreviewCanvas(target.value, {
    selection: false, preserveObjectStacking: true, uniformScaling: true,
    fireRightClick: false, fireMiddleClick: false,
  })
  const selectionChanged = () => {
    if (applying || !props.editing) return
    const active = canvas?.getActiveObject()
    if (active instanceof ActiveSelection) configureSelection(active)
    const objects = activeObjects()
    emit('select', objects.flatMap(item =>
      item.studioId && (objects.length === 1 || !item.lockMovementX) ? [item.studioId] : [],
    ))
  }
  canvas.on('selection:created', selectionChanged)
  canvas.on('selection:updated', selectionChanged)
  canvas.on('selection:cleared', selectionChanged)
  canvas.on('object:moving', event => {
    snapObject(event.target, event.e.shiftKey)
    followLinkedDrag(event.target, event.e.altKey || event.e.shiftKey)
  })
  canvas.on('mouse:up', event => {
    guides.value = {}
    linkedDrag = undefined
    if (!props.editing || !event.isClick || event.e.shiftKey || event.e.altKey) return
    const selected = activeObjects()
    const object = selected[0]
    const id = object?.studioId
    if (selected.length === 1 && id && object === event.target &&
        !(object instanceof Textbox && object.isEditing)) emit('selectGroup', id)
  })
  canvas.on('mouse:dblclick', event => {
    const object = event.target
    if (!props.editing || !(object instanceof Textbox) || object.isEditing) return
    canvas?.setActiveObject(object)
    object.enterEditing(event.e)
    object.selectAll()
    canvas?.requestRenderAll()
  })
  canvas.on('object:modified', event => {
    const object = event.target as SceneObject | undefined
    if (object && linkedDrag && object.studioId === linkedDrag.id) {
      const positions = translatedLayers(linkedDrag.members, object)
      if (positions.length) emit('commitBatch', positions)
      else renderObjects()
      emit('selectGroup', linkedDrag.id)
    } else if (object instanceof ActiveSelection) moveSelection(object)
    else if (object?.studioId && (!(object instanceof Textbox) || !object.isEditing)) commit(object)
  })
  canvas.on('text:editing:entered', event => {
    const object = event.target
    object.hiddenTextarea?.addEventListener('blur', () => {
      if (object.isEditing) object.exitEditing()
    }, { once: true })
  })
  canvas.on('text:changed', event => { commit(event.target, true) })
  canvas.on('text:editing:exited', () => renderObjects())
  observer = new ResizeObserver(fit)
  observer.observe(viewport.value)
  fit()
  renderObjects()
  watch([() => props.asset?.url, () => props.original?.url, () => props.comparing, () => props.tone, () => props.aspect, previewView],
    () => void renderBackground(), { immediate: true, flush: 'post' })
})

function maskDown(event: PointerEvent) {
  if (event.button !== 0 || !mask.value) return
  maskStart = { x: event.clientX, y: event.clientY, box: mask.value.getBoundingClientRect() }
  if (props.brush) { trace = [brushPoint(event, maskStart.box)]; renderBrush() }
  mask.value.setPointerCapture(event.pointerId)
}
const unit = (part: number, size: number) => Math.max(0, Math.min(1, part / size))
function brushPoint(event: PointerEvent, box: DOMRect) {
  return { x: unit(event.clientX - box.left, box.width), y: unit(event.clientY - box.top, box.height) }
}
function renderBrush() {
  const board = brushCanvas.value
  const ctx = board?.getContext('2d')
  if (!board || !ctx) return
  ctx.clearRect(0, 0, board.width, board.height)
  ctx.strokeStyle = '#f7c568'
  ctx.fillStyle = '#f7c568'
  ctx.globalAlpha = 0.57
  const strokes = trace.length ? [...props.strokes, { points: trace, width: props.brushWidth }] : props.strokes
  drawBrush(ctx, strokes, board.width, board.height)
}
function finishMask() {
  if (props.brush && trace.length) emit('stroke', { points: trace, width: props.brushWidth })
  trace = []
  maskStart = undefined
}
function maskMove(event: PointerEvent) {
  if (!maskStart) return
  const { x, y, box } = maskStart
  if (props.brush) {
    if (trace.length < 500) trace.push(brushPoint(event, box))
    renderBrush()
    return
  }
  const x0 = unit(x - box.left, box.width), y0 = unit(y - box.top, box.height)
  const x1 = unit(event.clientX - box.left, box.width), y1 = unit(event.clientY - box.top, box.height)
  const width = Math.abs(x0 - x1), height = Math.abs(y0 - y1)
  if (width >= 0.02 && height >= 0.02) emit('selection', { x: Math.min(x0, x1), y: Math.min(y0, y1), width, height })
}

watch(() => props.layer.background, updateFraming)
watch(() => [props.aspect, props.zoom, props.asset?.width], fit)
watch(() => [props.layer, props.aspect, props.ratio, props.editing, props.interactiveOverlay], () => {
  if (canvas) canvas.selection = props.editing
  if (!props.editing) {
    const active = canvas?.getActiveObject()
    if (active instanceof Textbox && active.isEditing) active.exitEditing()
    withProgrammaticSelection(() => { canvas?.discardActiveObject() })
  }
  renderObjects()
})
watch(() => props.selected, renderSelection)
watch(split, renderComparison)
watch([() => props.strokes, bounds, brushCanvas], renderBrush, { flush: 'post' })
onBeforeUnmount(() => {
  imageRequest?.abort()
  for (const request of loadingImages.values()) request.controller.abort()
  observer?.disconnect()
  void canvas?.dispose()
  canvas = undefined
})
</script>

<template>
  <div class="fabric-stage">
    <div ref="viewport" class="fabric-viewport" :class="{ 'fabric-read-only': !editing, 'fabric-overview': zoom === 1 }"
      aria-label="作品画布" :tabindex="editing ? 0 : undefined" @pointerdown="editing && viewport?.focus({ preventScroll: true })">
      <div class="fabric-frame" :style="{ width: bounds.width + 'px', height: bounds.height + 'px' }">
        <canvas ref="target" aria-label="可编辑图像画布"></canvas>
        <div v-if="loadingBackground" class="fabric-loading" :class="{ 'fabric-loading-small': hasPaintedImage }" role="status">
          <span class="wb-spinner" aria-hidden="true"></span>{{ comparing ? '正在载入对比…' : '正在载入画布…' }}
        </div>
        <div v-if="canvasPlain" class="fabric-blank">
          <span class="fabric-blank-icon"><Image :size="21" aria-hidden="true" /></span>
          <strong>{{ editing ? '空白画布' : '预览区' }}</strong>
          <p>{{ editing ? '添加文字、形状或图片开始排版。' : '填写描述生成图片，或打开一张图继续编辑。' }}</p>
        </div>
        <button v-if="asset && !editing && !interactiveOverlay && !masking && !comparing && layer.title && layer.visible" class="fabric-title-shortcut"
          aria-label="编辑画布标题" type="button" :style="{ left: layer.x + '%', top: layer.y + '%', height: (layer.textScale * 12) + '%' }"
          @click="emit('edit')"></button>
        <div v-if="masking" ref="mask" class="fabric-mask-overlay" :style="maskBounds" @pointerdown="maskDown" @pointermove="maskMove" @lostpointercapture="finishMask">
          <canvas v-if="brush" ref="brush-canvas" class="fabric-brush-canvas" :width="regionPixels.width" :height="regionPixels.height" aria-hidden="true"></canvas>
          <div v-else-if="selection" class="wb-mask" :style="maskStyle" aria-hidden="true"></div>
        </div>
        <slot name="overlay" />
        <div v-if="comparing" class="wb-split" :style="{ left: split + '%' }" aria-hidden="true"><span></span></div>
        <div v-if="guides.x !== undefined" class="fabric-guide fabric-guide-x" :style="{ left: guides.x + '%' }" aria-hidden="true"></div>
        <div v-if="guides.y !== undefined" class="fabric-guide fabric-guide-y" :style="{ top: guides.y + '%' }" aria-hidden="true"></div>
      </div>
    </div>
    <div v-if="comparing" class="wb-compare-controls fabric-compare">
      <span>{{ originalLabel }}</span><input v-model.number="split" type="range" min="0" max="100" aria-label="对比位置"><span>当前版本</span>
    </div>
    <p v-if="loadError" class="fabric-warning" role="status">图片加载失败，切换版本可重试。</p>
  </div>
</template>
