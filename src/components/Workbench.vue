<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { Circle, Columns2, ImagePlus, Layers, Maximize, Minus, PanelsTopLeft, Plus, Redo2, ScanLine, ScanSearch, SlidersHorizontal, Sparkles, Square, Type, Undo2 } from 'lucide-vue-next'
import UButton from '@nuxt/ui/components/Button.vue'
import Artboard from './Artboard.vue'
import ChatInspector from './ChatInspector.vue'
import LayerInspector from './LayerInspector.vue'
import ExportDialog from './ExportDialog.vue'
import ImageToolPanel from './ImageToolPanel.vue'
import ImageToolOverlay from './ImageToolOverlay.vue'
import BackgroundInspector from './BackgroundInspector.vue'
import { canGenerate, studioApi, type ImageAsset, type Job, type ReferenceImage, type SelectedSubject, type Session, type SubjectCandidate, type TextRepair } from '../studio/api'
import { ratioLabels, type Ratio } from '../studio/catalog'
import { layerForImage, workingImage, type Background, type CanvasItem, type Layer, type StudioDocument } from '../studio/document'
import { frameAspect, imageRegionOnBoard, initialMask, type BrushStroke, type MaskSelection, type Rect } from '../studio/geometry'
import { imageView } from '../studio/imageView'
import { useImageTools } from '../studio/useImageTools'
import { useCanvasLayers, type SlideContent } from '../studio/useCanvasLayers'
import type { ArrangeAction } from '../studio/arrangeLayers'
import '../styles/workbench.css'

const FabricEditor = defineAsyncComponent(() => import('./FabricEditor.vue'))
const editor = useTemplateRef<{ arrange: (action: ArrangeAction) => void }>('editor')
const doc = defineModel<StudioDocument>('document', { required: true })
const props = defineProps<{
  session: Session | null; picture: ImageAsset | null; original: ImageAsset | null; active?: Job
  versions: Job[]; timeline: Job[]; busy?: Job
  submitting: boolean; error: string; quotaReached: boolean
  checking: boolean; references: ReferenceImage[]; uploadingReferences: boolean; referenceError: string; exportSignal: number
}>()
const emit = defineEmits<{
  version: [id?: string]; submit: [prompt: string, region: MaskSelection | SelectedSubject | undefined, useCurrent: boolean]
  refresh: []; account: []
  addReferences: [files: File[]]; removeReference: [url: string]
}>()
const mode = shallowRef<'chat' | 'layers' | 'smart'>(doc.value.slides ? 'layers' : 'chat')
const property = shallowRef<'layers' | 'background'>('layers')
const inspector = useTemplateRef<HTMLElement>('inspector')
const canvasArea = useTemplateRef<HTMLElement>('canvas-area')
const chat = useTemplateRef<{ focusPrompt: () => void }>('chat')
const selectionReady = computed(() => maskMode.value === 'brush' ? Boolean(strokes.value.length) : maskMode.value === 'rect' && rectangleDrawn.value)
const comparing = shallowRef(false)
const subjectFocus = shallowRef<{ choice: SelectedSubject; candidate: SubjectCandidate }>()
const maskMode = shallowRef<'rect' | 'brush' | null>(null)
const strokes = shallowRef<BrushStroke[]>([])
const brushWidth = shallowRef(0.075)
const rectangleDrawn = shallowRef(false)
const maskError = shallowRef('')
const selection = shallowRef<Rect>({ ...initialMask })
const useCurrent = computed({
  get: () => doc.value.intent ? doc.value.intent === 'edit-current' : Boolean(doc.value.version || doc.value.imported || doc.value.template?.start === 'edit'),
  set: value => {
    const intent = value ? 'edit-current' : 'create'
    if (doc.value.intent !== intent) doc.value = { ...doc.value, intent }
  },
})
const zoom = shallowRef(1)
const visibleZoom = shallowRef(0)
const mediaInput = useTemplateRef<HTMLInputElement>('canvas-media')
const mediaBusy = shallowRef(false)
const mediaError = shallowRef('')
const smartNotice = shallowRef('')
let replaceLayerId: string | undefined
let openingImage = false
const slides = computed(() => doc.value.slides)
const page = computed(() => doc.value.page)
const ratio = computed(() => doc.value.ratio)
const slide = computed(() => slides.value?.[page.value])
const layer = computed(() => slide.value?.layer ?? doc.value.layer)
const sourceUrl = computed(() => props.picture?.url)
const displayPicture = computed(() => workingImage(props.picture, layer.value))
const displayLayer = computed(() => layerForImage(layer.value, sourceUrl.value))
const coverLayer = computed(() => layerForImage(slides.value?.[0]?.layer ?? layer.value, sourceUrl.value))
const coverPicture = computed(() => workingImage(props.picture, coverLayer.value))
const canAdjustFrame = computed(() => Boolean(props.picture || slides.value || layer.value.extras?.length))
const layerFull = computed(() => (layer.value.extras?.length ?? 0) >= 24)
const aspect = computed(() => frameAspect(ratio.value, props.picture, layer.value.background, Boolean(slides.value)))
const frameLabel = computed(() => {
  const settings = layer.value.background
  if (slides.value) return '16:9'
  if (props.picture && (!settings?.fit || settings.fit === 'original')) return '原图比例'
  return ratioLabels[settings?.ratio ?? ratio.value]
})
const changingNonCover = computed(() => Boolean(slide.value && slide.value.kind !== 'cover'))
const quota = computed(() => props.session?.quota)
const exhausted = computed(() => props.quotaReached || Boolean(quota.value && !canGenerate(quota.value)))
const versionNumber = (id: string) => props.versions.findIndex(row => row.id === id) + 1
const versionLabel = computed(() => props.active ? '版本 ' + versionNumber(props.active.id) : doc.value.imported ? '导入原图' : '案例原图')
const editingImage = computed(() => Boolean(useCurrent.value && coverPicture.value))
const tone = computed(() => doc.value.caseId ?? '')
const baseVersion = computed(() => {
  const reference = props.active?.baseReference
  if (!reference?.startsWith('asset:')) return undefined
  return props.versions.find(row => row.id === reference.slice(6))
})
const comparisonBase = computed(() => {
  if (!props.active) return null
  if (baseVersion.value) return baseVersion.value.asset
  if (props.active.baseReference?.startsWith('case:')) return props.original
  if (props.active.baseReference?.startsWith('media:')) {
    const url = '/api/media/' + props.active.baseReference.slice(6)
    return [props.original, ...Object.values(coverLayer.value.repaired ?? {})].find(asset => asset?.url === url) ?? props.original
  }
  const earlier = props.versions.slice(0, versionNumber(props.active.id) - 1).find(row => row.asset)
  return props.original ?? earlier?.asset ?? null
})
const comparisonLabel = computed(() => baseVersion.value ? '版本 ' + versionNumber(baseVersion.value.id) : props.original ? '案例原图' : '初版')
const canCompare = computed(() => Boolean(comparisonBase.value && !changingNonCover.value))
const layerHelp = computed(() => changingNonCover.value ? '文字与图表可编辑' : '双击改字 · 框选或按 Shift 多选')
const generationStyle = computed({
  get: () => doc.value.style ?? 'default',
  set: style => { doc.value = { ...doc.value, style } },
})
const instructions = computed({
  get: () => editingImage.value ? doc.value.editInstructions ?? '' : doc.value.instructions,
  set: value => {
    const field = editingImage.value ? 'editInstructions' : 'instructions'
    doc.value = { ...doc.value, [field]: value }
  },
})
const pageNames = ['封面', '介绍页', '数据页']

const slideContent = computed(() => slide.value ? { notes: slide.value.notes, metrics: slide.value.metrics } : undefined)
function updateLayer(next: Layer, content?: SlideContent) {
  if (slides.value) {
    doc.value = {
      ...doc.value, slides: slides.value.map((item, index) => index === page.value ? { ...item, ...content, layer: next } : item),
    }
  } else {
    doc.value = { ...doc.value, layer: next }
  }
}
const layers = useCanvasLayers(layer, ratio, page, updateLayer, aspect, sourceUrl, slideContent)
const { selected, current, entries, past, future, movable, selectedGroup } = layers

const smart = useImageTools(displayPicture, { text: applyImageText, subject: applySubject })
const { tool, action, error: toolError, textResult, textIndex, replacement, subjectResult, candidateIndex, points, include, currentCandidate } = smart

function insertSmartLayer(item: CanvasItem | undefined, repair?: ImageAsset) {
  const source = sourceUrl.value
  if (!source || (item && layerFull.value)) return
  const next = { ...layer.value }
  if (item) next.extras = [...(next.extras ?? []), { ...item, sourceUrl: source }]
  if (repair) next.repaired = { ...next.repaired, [source]: repair }
  layers.apply(next)
  switchMode('layers')
  layers.select(item?.id ?? [])
  smartNotice.value = item?.type === 'image' ? (repair ? '已分离，可拖动主体' : '已添加透明主体图层')
    : item ? '双击新图层继续改字' : '已移除原文'
}

function boardRegion(box: Rect) {
  const image = displayPicture.value
  return image ? imageRegionOnBoard(image, aspect.value, box, layer.value.background) : box
}

function applyImageText(repair: TextRepair, value: string) {
  const box = boardRegion(repair.box)
  const width = Math.min(100, Math.max(5, box.width * 106))
  const size = Math.max(1.7, Math.min(28, box.height / aspect.value * 112, width * 1.03 / Math.max(1, [...value].length)))
  insertSmartLayer(value ? {
    id: crypto.randomUUID(), type: 'text', text: value, x: box.x * 100, y: box.y * 100 - size * aspect.value * 0.12,
    width, height: size, angle: repair.angle, fill: repair.fill, color: 'ink', visible: true,
    font: size > 9 ? 'serif' : 'sans', bold: true,
  } : undefined, repair.asset)
}

function applySubject(asset: ImageAsset, sourceBox: Rect, background?: ImageAsset) {
  const box = boardRegion(sourceBox)
  insertSmartLayer({
    id: crypto.randomUUID(), type: 'image', asset, label: '提取的主体', visible: true, color: 'ink',
    x: box.x * 100, y: box.y * 100, width: box.width * 100, height: box.height * 100, angle: 0, fit: 'contain',
  }, background)
}

function promptWithSubject() {
  const choice = smart.selection()
  if (!choice || !currentCandidate.value) return
  const candidate = currentCandidate.value
  switchMode('chat')
  useCurrent.value = true
  subjectFocus.value = { choice, candidate }
  void nextTick(focusPrompt)
}

function focusPrompt() {
  if (window.matchMedia('(max-width: 820px)').matches) inspector.value?.scrollIntoView({ block: 'start' })
  chat.value?.focusPrompt()
}

function openSmartTool(next: 'text' | 'subject') {
  smart.open(next)
  if (next === 'subject' && window.matchMedia('(max-width: 820px)').matches) {
    void nextTick(() => canvasArea.value?.scrollIntoView({ block: 'start' }))
  }
}

function showSubjectActions() {
  inspector.value?.scrollIntoView({ block: 'start' })
  inspector.value?.querySelector<HTMLButtonElement>('.image-tool-panel button[aria-pressed="true"]')?.focus({ preventScroll: true })
}

function updateSlideNotes(notes: string) {
  layers.updateContent({ notes }, 'slide-notes')
}

function updateMetric(index: number, patch: Partial<{ label: string; value: number }>) {
  if (!slide.value) return
  const metrics = slide.value.metrics.map((metric, row) => row === index ? { ...metric, ...patch } : metric)
  layers.updateContent({ metrics }, 'slide-metric-' + index + ('value' in patch ? '-value' : '-label'))
}

function switchPage(index: number) {
  doc.value = { ...doc.value, page: index }
  smart.stop()
  subjectFocus.value = undefined
  comparing.value = false
  maskMode.value = null
  property.value = 'layers'
  if (index > 0) mode.value = 'layers'
}
function switchMode(next: 'chat' | 'layers' | 'smart') {
  if (next === 'chat' && changingNonCover.value) switchPage(0)
  mode.value = next
  smartNotice.value = ''
  if (next !== 'smart') smart.stop()
  if (next !== 'chat') {
    maskMode.value = null
    subjectFocus.value = undefined
    comparing.value = false
  }
  if (next === 'layers') property.value = 'layers'
}
function setGenerationRatio(next: Ratio) {
  doc.value = { ...doc.value, ratio: next }
}
function patchBackground(values: Partial<Background>, coalesce?: string) {
  layers.apply({ ...layer.value, background: { ...layer.value.background, ...values } }, coalesce ? 'background:' + coalesce : undefined)
}
function clearMask() {
  subjectFocus.value = undefined
  selection.value = { ...initialMask }
  rectangleDrawn.value = false
  strokes.value = []
  maskError.value = ''
}
function captureSelection(region: Rect) {
  selection.value = region
  rectangleDrawn.value = true
  maskError.value = ''
}
function openBackground() {
  switchMode('layers')
  property.value = 'background'
  void nextTick(() => {
    inspector.value?.scrollTo({ top: 0 })
    if (window.matchMedia('(max-width: 820px)').matches) inspector.value?.scrollIntoView({ block: 'start' })
  })
}
function toggleCompare() {
  subjectFocus.value = undefined
  comparing.value = !comparing.value
  if (comparing.value) maskMode.value = null
}
function setMask(tool: 'rect' | 'brush' | null) {
  maskError.value = ''
  subjectFocus.value = undefined
  maskMode.value = tool
  if (maskMode.value) {
    useCurrent.value = true
    comparing.value = false
    if (window.matchMedia('(max-width: 820px)').matches) void nextTick(() => canvasArea.value?.scrollIntoView({ block: 'start' }))
  }
}
function chooseVersion(id?: string) {
  useCurrent.value = true
  emit('version', id)
  comparing.value = false
  maskMode.value = null
  smart.stop()
  clearMask()
}
function changeZoom(direction: number) {
  zoom.value = Math.max(0.5, Math.min(2.5, zoom.value + direction * 0.25))
}
function submit(prompt: string) {
  maskError.value = ''
  if (maskMode.value === 'brush' && !strokes.value.length) {
    maskError.value = '先用画笔涂抹要改的区域。'
    return
  }
  if (maskMode.value === 'rect' && !rectangleDrawn.value) {
    maskError.value = '先在图片上拖动画出修改区域。'
    return
  }
  comparing.value = false
  const mask = maskMode.value === 'brush' ? { kind: 'brush' as const, strokes: strokes.value }
    : maskMode.value === 'rect' ? selection.value : subjectFocus.value?.choice
  emit('submit', prompt, mask, editingImage.value)
}

function chooseMedia(id?: string, open = false) {
  replaceLayerId = id
  openingImage = open
  mediaInput.value?.click()
}

async function addMedia(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  const replacing = replaceLayerId
  const open = openingImage
  openingImage = false
  replaceLayerId = undefined
  target.value = ''
  if (!file || mediaBusy.value) return
  if (file.size > 10 * 1024 * 1024) { mediaError.value = '图片素材最多 10 MB。'; return }
  const documentId = doc.value.id
  const pageIndex = page.value
  mediaBusy.value = true
  mediaError.value = ''
  try {
    const { asset } = await studioApi.uploadMedia(file)
    if (doc.value.id === documentId && page.value === pageIndex) {
      if (open && !props.picture) {
        doc.value = {
          ...doc.value, imported: asset, intent: 'edit-current',
          editInstructions: doc.value.template?.start === 'upload' ? doc.value.editInstructions ?? doc.value.instructions : doc.value.editInstructions,
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 64) || '导入图片',
        }
        useCurrent.value = true
        switchMode('chat')
      } else {
        if (replacing) layers.replaceImage(replacing, asset)
        else layers.addImage(asset)
        property.value = 'layers'
      }
    }
  } catch (cause) {
    mediaError.value = cause instanceof Error ? cause.message : '暂时无法导入这张素材。'
  } finally { mediaBusy.value = false }
}

function shortcuts(event: KeyboardEvent) {
  if (mode.value !== 'layers' || event.isComposing || event.defaultPrevented ||
      !(event.target instanceof HTMLElement) || !event.target.closest('.fabric-viewport') ||
      event.target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) layers.redo()
    else layers.undo()
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    layers.remove()
  } else {
    const movement: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const shift = movement[event.key]
    if (!shift) return
    event.preventDefault()
    layers.nudge(shift[0], shift[1])
  }
}

watch(useCurrent, next => { if (!next) { maskMode.value = null; clearMask() } })
watch(() => props.active?.id, (next, previous) => {
  if (next && next !== previous) useCurrent.value = true
  maskMode.value = null
  clearMask()
  comparing.value = false
})
watch([aspect, () => layer.value.background?.fit, () => layer.value.background?.cropX, () => layer.value.background?.cropY], clearMask)
</script>

<template>
  <main id="sichen-workbench" tabindex="-1" @keydown="shortcuts">
    <div class="wb-main" :class="{ 'wb-write-first': mode === 'chat' && !picture, 'wb-has-tool': Boolean(maskMode || tool) }">
      <div class="wb-modebar">
        <div class="wb-tabs" :class="{ 'wb-tabs-smart': session?.editor?.text || session?.editor?.subject }" role="group"  aria-label="编辑方式">
          <UButton type="button" variant="ghost" :aria-pressed="mode === 'chat'" @click="switchMode('chat')"><Sparkles :size="16" aria-hidden="true" /> {{ picture ? '对话改图' : 'AI 生图' }}</UButton>
          <UButton type="button" variant="ghost" :aria-pressed="mode === 'layers'" @click="switchMode('layers')"><Layers :size="16" aria-hidden="true" /> 画布编辑</UButton>
          <UButton v-if="session?.editor?.text || session?.editor?.subject" type="button" variant="ghost" :aria-pressed="mode === 'smart'"
            @click="switchMode('smart')"><ScanSearch :size="16" aria-hidden="true" /> 智能编辑</UButton>
        </div>
      </div>
      <section ref="canvas-area" class="wb-canvas-area" aria-label="作品画布">
        <div class="wb-tools">
          <div class="wb-tool-start">
            <span class="wb-canvas-label"><PanelsTopLeft :size="16" /> {{ slide ? pageNames[page] : '画布' }}</span>
            <template v-if="mode === 'layers'">
              <span class="wb-tool-divider"></span>
              <button class="wb-button wb-toolbar-icon" type="button" aria-label="撤销" title="撤销" :disabled="!past.length" @click="layers.undo"><Undo2 :size="17" /></button>
              <button class="wb-button wb-toolbar-icon" type="button" aria-label="重做" title="重做" :disabled="!future.length" @click="layers.redo"><Redo2 :size="17" /></button>
            </template>
          </div>
          <div class="wb-canvas-actions">
            <span class="wb-canvas-label">{{ frameLabel }}</span>
            <button v-if="!picture && !changingNonCover" type="button" class="wb-button wb-quiet-button" :disabled="mediaBusy"
              @click="chooseMedia(undefined, true)"><ImagePlus :size="15" /> {{ mediaBusy ? '正在打开…' : '打开图片' }}</button>
            <button v-if="!changingNonCover && canAdjustFrame" type="button" class="wb-button wb-quiet-button" @click="openBackground">
              <SlidersHorizontal :size="15" aria-hidden="true" /> 取景与调色
            </button>
            <button v-if="canCompare && mode === 'chat'" type="button" class="wb-button wb-quiet-button" :aria-pressed="comparing" @click="toggleCompare"><Columns2 :size="16" /> 对比</button>
          </div>
        </div>
        <p v-if="mediaError" class="wb-error wb-canvas-message" role="alert">{{ mediaError }}</p>

        <input ref="canvas-media" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="addMedia">
        <div class="wb-edit-region">
          <div v-if="mode === 'layers' && !changingNonCover" class="wb-edit-rail" role="group" aria-label="添加图层">
            <button class="wb-button" type="button" aria-label="添加文字" :disabled="(layer.extras?.length ?? 0) >= 24"
              @click="layers.add('text'); property = 'layers'"><Type :size="18" aria-hidden="true" /> 文字</button>
            <button class="wb-button" type="button" aria-label="添加矩形" :disabled="(layer.extras?.length ?? 0) >= 24"
              @click="layers.add('rectangle'); property = 'layers'"><Square :size="18" aria-hidden="true" /> 矩形</button>
            <button class="wb-button" type="button" aria-label="添加圆形" :disabled="(layer.extras?.length ?? 0) >= 24"
              @click="layers.add('circle'); property = 'layers'"><Circle :size="18" aria-hidden="true" /> 圆形</button>
            <button class="wb-button" type="button" aria-label="导入图片图层" :disabled="mediaBusy || (layer.extras?.length ?? 0) >= 24"
              @click="chooseMedia()"><ImagePlus :size="18" aria-hidden="true" /> 图片</button>
          </div>
          <Artboard v-if="changingNonCover" :picture="null" :original="null" :ratio="doc.ratio" :layer="layer" :slide="slide"
          original-label="初版" :comparing="false" :masking="false" :selection="selection" :edit-mode="true" :base-tone="tone"
          @edit="layers.select('title')" @move="(x, y) => layers.apply({ ...layer, x, y }, 'slide-title-move')" />
          <FabricEditor v-else ref="editor" :asset="displayPicture" :layer="displayLayer" :ratio="doc.ratio" :aspect="aspect" :tone="tone"
          :editing="mode === 'layers'" :interactive-overlay="mode === 'smart' && Boolean(tool)" :selected="selected" :zoom="zoom" :comparing="comparing"
          :original="comparisonBase" :original-label="comparisonLabel" :masking="Boolean(maskMode)"
          :selection="rectangleDrawn ? selection : undefined"
          :brush="maskMode === 'brush'" :brush-width="brushWidth" :strokes="strokes" @stroke="value => { strokes = [...strokes, value].slice(-40); maskError = '' }"
          @edit="() => { switchMode('layers'); property = 'layers'; layers.select('title') }"
          @select="ids => { layers.select(ids); if (ids.length) property = 'layers' }" @select-group="layers.selectGroup"
          @commit="layers.update" @commit-batch="layers.updateMany"
          @selection="captureSelection" @zoom-changed="visibleZoom = $event">
            <template #overlay>
              <ImageToolOverlay v-if="mode === 'smart' && tool && displayPicture" :image="displayPicture" :aspect="aspect"
                :framing="layer.background" :tool="tool" :lines="textResult?.lines" :text-index="textIndex"
                :points="points" :candidate="currentCandidate" :busy="Boolean(action)" :include="include"
                @text="smart.selectText" @point="smart.selectPoint" />
              <ImageToolOverlay v-else-if="subjectFocus && displayPicture" :image="displayPicture" :aspect="aspect"
                :framing="layer.background" tool="subject" :text-index="-1" :points="[]" :candidate="subjectFocus.candidate"
                :busy="false" :include="true" preview-only />
            </template>
          </FabricEditor>
        </div>

        <div class="wb-canvas-status">
          <a v-if="picture && !changingNonCover" class="wb-original-link" :href="picture.url" target="_blank" rel="noopener"
            :aria-label="'查看原图，' + picture.width + ' × ' + picture.height + ' 像素'">原图 {{ picture.width }} × {{ picture.height }}</a>
          <span v-else>{{ ratioLabels[doc.ratio] }}</span>
          <span v-if="mode === 'layers'" class="wb-layer-hint">{{ smartNotice && past.length ? smartNotice : layerHelp }}</span>
          <button v-if="selectionReady" type="button" class="wb-button wb-quiet-button wb-mask-next" @click="focusPrompt">填写改图指令</button>
          <button v-if="mode === 'smart' && tool === 'subject' && currentCandidate" type="button"
            class="wb-button wb-quiet-button wb-mask-next wb-subject-next" @click="showSubjectActions">使用这个选区</button>
          <span v-if="subjectFocus" class="wb-selection-chip">主体选区 <button type="button" aria-label="清除主体选区" @click="clearMask">×</button></span>
          <div v-if="!changingNonCover" class="wb-zoom" role="group" aria-label="画布缩放">
            <button class="wb-button wb-toolbar-icon" type="button" aria-label="缩小画布" :disabled="zoom <= 0.5" @click="changeZoom(-1)"><Minus :size="15" /></button>
            <span>{{ visibleZoom ? visibleZoom + '%' : '适应' }}</span>
            <button class="wb-button wb-toolbar-icon" type="button" aria-label="放大画布" :disabled="zoom >= 2.5" @click="changeZoom(1)"><Plus :size="15" /></button>
            <button class="wb-button wb-toolbar-icon" type="button" aria-label="适应画布" title="适应画布" @click="zoom = 1"><Maximize :size="14" /></button>
          </div>
        </div>

        <div v-if="slides" class="wb-slide-strip" aria-label="幻灯片页面">
          <button v-for="(item, index) in slides" :key="item.kind" type="button" class="wb-button"
            :aria-pressed="page === index" @click="switchPage(index)">{{ index + 1 }} · {{ pageNames[index] }}</button>
        </div>
        <div v-if="original || versions.length" class="wb-history">
          <div class="wb-history-heading"><h2>版本</h2><span>{{ versions.length + (original ? 1 : 0) }} 个</span></div>
          <div class="wb-versions" role="group" aria-label="作品版本">
            <button v-if="original" type="button" class="wb-version" :aria-pressed="!active" @click="chooseVersion()">
              <img :src="imageView(original.url, 'thumb')" alt="" loading="lazy" decoding="async">{{ doc.imported ? '导入原图' : '案例原图' }}
            </button>
            <button v-for="(version, index) in versions" :key="version.id" type="button" class="wb-version"
              :aria-pressed="active?.id === version.id" @click="chooseVersion(version.id)">
              <img v-if="version.asset" :src="imageView(version.asset.url, 'thumb')" alt="" loading="lazy" decoding="async">版本 {{ index + 1 }}<small v-if="version.demo">示例</small>
            </button>
          </div>
        </div>
      </section>

      <aside ref="inspector" class="wb-inspector" aria-label="创作和编辑">
        <ImageToolPanel v-if="mode === 'smart' && tool" v-model:replacement="replacement" v-model:include="include"
          v-model:candidate-index="candidateIndex" :tool="tool" :action="action" :error="toolError" :lines="textResult?.lines"
          :text-index="textIndex" :candidates="subjectResult?.candidates" :point-count="points.length" :layer-full="layerFull" :fill-available="Boolean(session?.editor?.fill)"
          @close="smart.stop" @scan="smart.scan" @select="smart.selectText" @apply-text="smart.changeText" @reset="smart.resetPoints"
          @extract="smart.extract" @prompt="promptWithSubject" />
        <section v-else-if="mode === 'smart'" class="wb-panel wb-smart-home" aria-label="智能编辑工具">
          <h2>智能编辑</h2>
          <p v-if="changingNonCover" class="wb-help">当前为演示页面，切到封面可处理图片。</p>
          <p v-else-if="!displayPicture" class="wb-help">先打开一张图片，或从案例开始。</p>
          <button v-if="!displayPicture" type="button" class="wb-button" :disabled="mediaBusy"
            @click="chooseMedia(undefined, true)"><ImagePlus /> 打开图片</button>
          <div v-else-if="!changingNonCover" class="wb-smart-choices">
            <button v-if="session?.editor?.text" type="button" class="wb-smart-card" @click="openSmartTool('text')">
              <span class="wb-smart-icon"><ScanLine /></span>
              <span><strong>改图中文字</strong><small>选中原文，替换成可编辑文字。</small></span>
              <span aria-hidden="true">›</span>
            </button>
            <button v-if="session?.editor?.subject" type="button" class="wb-smart-card" @click="openSmartTool('subject')">
              <span class="wb-smart-icon wb-smart-icon-subject"><ScanSearch /></span>
              <span><strong>点选主体</strong><small>提取图层，或只改选中的对象。</small></span>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </section>
        <ChatInspector v-show="mode === 'chat'" ref="chat" v-model:prompt="instructions" v-model:use-current="useCurrent"
          v-model:brush-width="brushWidth" v-model:style="generationStyle" :ratio="ratio" :fixed-ratio="Boolean(slides)"
          :picture="coverPicture" :active="active" :timeline="timeline" :versions="versions" :version-label="versionLabel"
          :requires-reference="!picture && doc.template?.start === 'upload'"
          :busy="busy" :submitting="submitting" :checking="checking" :latest-error="maskError || error" :exhausted="exhausted" :session="session"
          :mask-mode="maskMode" :has-selection="maskMode === 'brush' ? Boolean(strokes.length) : rectangleDrawn"
          :references="references" :uploading-references="uploadingReferences" :reference-error="referenceError"
          @add-references="emit('addReferences', $event)" @remove-reference="emit('removeReference', $event)"
          @submit="submit" @mask="setMask" @clear-mask="clearMask" @ratio="setGenerationRatio"
          @version="chooseVersion" @refresh="emit('refresh')" @account="emit('account')" />
        <div v-if="mode === 'layers' && !changingNonCover" class="wb-property-tabs" role="group" aria-label="编辑属性">
          <button class="wb-button" type="button" :aria-pressed="property === 'layers'" @click="property = 'layers'">图层属性</button>
          <button class="wb-button" type="button" :aria-pressed="property === 'background'" @click="property = 'background'">底图设置</button>
        </div>
        <BackgroundInspector v-if="mode === 'layers' && property === 'background' && !changingNonCover"
          :settings="layer.background" :asset="picture" :ratio="ratio" :aspect="aspect" :fixed="Boolean(slides)" @patch="patchBackground" />
        <LayerInspector v-else-if="mode === 'layers'" :entries="entries" :current="current" :has-image="Boolean(picture && !changingNonCover)"
          :selected="selected" :movable-count="movable.length" :grouped="Boolean(selectedGroup)"
          :slide="slide" :professional="!changingNonCover" :board-aspect="aspect"
          @select="layers.pickLayer" @patch="layers.patch" @align="layers.align"
          @arrange="editor?.arrange($event)" @group="layers.toggleGroup"
          @duplicate="layers.duplicate" @delete="layers.remove" @stack="layers.stack" @notes="updateSlideNotes" @metric="updateMetric"
          @replace="chooseMedia" @background="openBackground" />
      </aside>
    </div>
    <ExportDialog :signal="exportSignal" :document="doc" :picture="coverPicture" :layer="displayLayer" :slide="slide" :cover-layer="coverLayer" :version-label="active ? versionLabel : undefined" />
  </main>
</template>
