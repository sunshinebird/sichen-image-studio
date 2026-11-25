<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { Image } from 'lucide-vue-next'
import type { ImageAsset } from '../studio/api'
import type { Ratio } from '../studio/catalog'
import { textColors, type Layer, type Slide } from '../studio/document'
import type { Rect } from '../studio/geometry'

const props = defineProps<{
  picture: ImageAsset | null; original: ImageAsset | null; originalLabel: string; ratio: Ratio
  layer: Layer; slide?: Slide; comparing: boolean; masking: boolean
  selection: Rect; editMode: boolean; baseTone: string
}>()
const emit = defineEmits<{ edit: []; move: [x: number, y: number]; selection: [region: Rect] }>()
const board = useTemplateRef<HTMLElement>('board')
const title = useTemplateRef<HTMLElement>('title')
const split = shallowRef(50)
const boardStyle = computed(() => ({
  '--layer-left': props.layer.x + '%', '--layer-top': props.layer.y + '%',
  '--title-color': props.layer.titleStyle?.fill ?? textColors[props.layer.color], '--title-scale': props.layer.textScale,
  '--title-weight': props.layer.titleStyle?.bold === false ? 400 : 700,
  '--title-style': props.layer.titleStyle?.italic ? 'italic' : 'normal',
  '--title-family': props.layer.font === 'sans' ? 'system-ui, sans-serif' : 'Songti SC, Noto Serif CJK SC, serif',
  '--subtitle-color': props.layer.subtitleStyle?.fill ?? textColors[props.layer.subtitleColor ?? props.layer.color],
  '--subtitle-weight': props.layer.subtitleStyle?.bold ? 700 : 500,
  '--subtitle-style': props.layer.subtitleStyle?.italic ? 'italic' : 'normal',
  '--subtitle-family': props.layer.subtitleStyle?.font === 'serif' ? 'Songti SC, Noto Serif CJK SC, serif' : 'system-ui, sans-serif',
  '--subtitle-left': (props.layer.subtitleX ?? 9) + '%', '--subtitle-scale': props.layer.subtitleScale ?? 1,
  '--subtitle-width': (props.layer.subtitleWidth ?? 78) + '%',
  '--subtitle-align': props.layer.subtitleAlign ?? 'left',
  '--structured-title-width': (props.layer.titleWidth ?? 78) + '%', '--structured-title-align': props.layer.titleAlign ?? 'left',
  '--compare-position': split.value + '%',
}))
const maskStyle = computed(() => ({
  left: props.selection.x * 100 + '%', top: props.selection.y * 100 + '%',
  width: props.selection.width * 100 + '%', height: props.selection.height * 100 + '%',
}))
const chartMax = computed(() => Math.max(1, ...(props.slide?.metrics.map(item => item.value) ?? [])))
let drag: { x: number; y: number; bounds: DOMRect; pointer: number; mask: boolean; titleX: number; titleY: number } | undefined

function move(x: number, y: number) {
  if (!board.value || !title.value) return
  const bounds = board.value.getBoundingClientRect()
  const text = title.value.getBoundingClientRect()
  const maxX = Math.max(2, 98 - text.width / bounds.width * 100)
  const maxY = Math.max(3, 97 - text.height / bounds.height * 100)
  emit('move', Math.max(2, Math.min(maxX, x)), Math.max(3, Math.min(maxY, y)))
}

function keyboardMove(event: KeyboardEvent) {
  if (!props.editMode) return
  const shifts: Record<string, [number, number]> = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }
  const change = shifts[event.key]
  if (!change) return
  event.preventDefault()
  move(props.layer.x + change[0], props.layer.y + change[1])
}

function pointerDown(event: PointerEvent) {
  if (!board.value || event.button !== 0 ||
      (!props.masking && (!props.editMode || event.target !== title.value))) return
  drag = {
    x: event.clientX, y: event.clientY, bounds: board.value.getBoundingClientRect(),
    pointer: event.pointerId, mask: props.masking, titleX: props.layer.x, titleY: props.layer.y,
  }
  board.value.setPointerCapture(event.pointerId)
}

function pointerMove(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return
  const { bounds } = drag
  if (!drag.mask) {
    move(drag.titleX + (event.clientX - drag.x) / bounds.width * 100,
      drag.titleY + (event.clientY - drag.y) / bounds.height * 100)
    return
  }
  const at = (coordinate: number, offset: number, length: number) => Math.max(0, Math.min(1, (coordinate - offset) / length))
  const x0 = at(drag.x, bounds.left, bounds.width)
  const y0 = at(drag.y, bounds.top, bounds.height)
  const x1 = at(event.clientX, bounds.left, bounds.width)
  const y1 = at(event.clientY, bounds.top, bounds.height)
  const width = Math.abs(x1 - x0)
  const height = Math.abs(y1 - y0)
  if (width > 0.02 && height > 0.02) emit('selection', { x: Math.min(x0, x1), y: Math.min(y0, y1), width, height })
}

function stopDrag() { drag = undefined }
</script>

<template>
  <div class="wb-stage">
    <div ref="board" class="wb-poster" :style="boardStyle" :data-ratio-shape="ratio"
      :data-paper="baseTone" :data-layer-mode="editMode" :data-mask="masking"
      :data-empty="!picture && !slide" :data-slide="slide?.kind || 'none'"
      :aria-label="layer.title || '作品画布'"
      @pointerdown="pointerDown" @pointermove="pointerMove" @lostpointercapture="stopDrag" @pointercancel="stopDrag">
      <img v-if="picture && (!slide || slide.kind === 'cover')" class="wb-photo wb-full-image" :src="picture.url" alt="" draggable="false">
      <img v-if="comparing && original" class="wb-photo wb-full-image wb-photo-original" :src="original.url" alt="" draggable="false">
      <div v-if="picture && (!slide || slide.kind === 'cover')" class="wb-shade"></div>
      <div v-if="!picture && !slide && !layer.title" class="wb-blank"><Image :size="22" /><span>创作结果会显示在这里</span></div>
      <small v-if="baseTone === 'forest'" class="wb-art-label">思辰香氛</small>
      <button v-if="layer.title && layer.visible && layer.titleVisible !== false" ref="title" class="wb-title-layer" type="button"
        aria-label="编辑标题，或使用方向键移动标题" @click="emit('edit')" @keydown="keyboardMove">{{ layer.title }}</button>
      <span v-if="layer.subtitle && layer.visible && layer.subtitleVisible !== false" class="wb-art-sub">{{ layer.subtitle }}</span>
      <ul v-if="slide?.kind === 'features'" class="slide-notes">
        <li v-for="(line, index) in slide.notes.split('\n').filter(Boolean)" :key="index">{{ line }}</li>
      </ul>
      <div v-if="slide?.kind === 'data'" class="slide-chart">
        <div v-for="(metric, index) in slide.metrics" :key="index">
          <span>{{ metric.label }}</span>
          <b :style="{ width: (metric.value / chartMax * 100) + '%' }"><small>{{ metric.value }}</small></b>
        </div>
      </div>
      <div v-if="masking" class="wb-mask" :style="maskStyle" aria-hidden="true"></div>
      <div v-if="comparing" class="wb-split" aria-hidden="true"><span></span></div>
    </div>
    <div v-if="comparing" class="wb-compare-controls">
      <span>{{ originalLabel }}</span><input v-model.number="split" type="range" min="0" max="100" aria-label="对比位置"><span>当前版本</span>
    </div>
  </div>
</template>
