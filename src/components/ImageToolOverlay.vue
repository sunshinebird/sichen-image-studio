<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import type { DetectedText, ImageAsset, SubjectCandidate, SubjectPoint } from '../studio/api'
import type { ImageTool } from '../studio/useImageTools'
import { frameImage, type Framing, type MaskPoint, type Rect } from '../studio/geometry'

const { image, aspect, framing, tool, lines, textIndex, points, candidate, busy, include, previewOnly } = defineProps<{
  image: ImageAsset; aspect: number; framing?: Framing; tool: ImageTool
  lines?: DetectedText[]; textIndex: number; points: SubjectPoint[]; candidate?: SubjectCandidate
  busy: boolean; include: boolean; previewOnly?: boolean
}>()
const emit = defineEmits<{ text: [index: number]; point: [point: MaskPoint] }>()
const target = useTemplateRef<HTMLButtonElement>('point-target')
const geometry = computed(() => frameImage(image.width, image.height, aspect, framing))
const fraction = (value: number) => value * 100 + '%'
function areaStyle(box: Rect) {
  return { left: fraction(box.x), top: fraction(box.y), width: fraction(box.width), height: fraction(box.height) }
}
const sourceStyle = computed(() => {
  const { crop } = geometry.value
  return {
    left: fraction(-crop.x / crop.width), top: fraction(-crop.y / crop.height),
    width: fraction(image.width / crop.width), height: fraction(image.height / crop.height),
  }
})
function point(event: MouseEvent) {
  const rect = target.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return
  const { crop } = geometry.value
  const within = (value: number) => Math.max(0, Math.min(1, value))
  const x = event.detail === 0 ? 0.5 : within((event.clientX - rect.left) / rect.width)
  const y = event.detail === 0 ? 0.5 : within((event.clientY - rect.top) / rect.height)
  emit('point', { x: (crop.x + x * crop.width) / image.width, y: (crop.y + y * crop.height) / image.height })
}
</script>

<template>
  <div class="image-tools-overlay" :style="areaStyle(geometry.visible)">
    <div class="image-tools-source" :style="sourceStyle">
      <template v-if="tool === 'text'">
        <button v-for="(line, index) in lines" :key="index" type="button" class="image-text-hit"
          :style="areaStyle(line.box)" :aria-label="'定位文字 ' + line.text" :aria-pressed="index === textIndex"
          :disabled="busy" @click="emit('text', index)"></button>
      </template>
      <template v-else>
        <img v-if="candidate" class="image-subject-preview" :src="candidate.preview" alt="">
        <span v-for="(mark, index) in points" :key="index" class="image-mark" :class="{ 'image-mark-minus': !mark.include }"
          :style="{ left: fraction(mark.x), top: fraction(mark.y) }" aria-hidden="true">{{ mark.include ? '+' : '−' }}</span>
      </template>
    </div>
    <button v-if="tool === 'subject' && !previewOnly" ref="point-target" type="button" class="image-point-target"
      :disabled="busy || points.length >= 6" :aria-label="include ? '在图中选择主体' : '从选区排除主体'" @click="point"></button>
  </div>
</template>

<style scoped>
.image-tools-overlay { position: absolute; z-index: 4; overflow: hidden; pointer-events: none; }
.image-tools-source, .image-point-target, .image-text-hit, .image-subject-preview, .image-mark { position: absolute; }
.image-point-target, .image-subject-preview { inset: 0; width: 100%; height: 100%; }
.image-point-target, .image-text-hit { pointer-events: auto; }
.image-point-target { background: transparent; border: 0; cursor: crosshair !important; }
.image-point-target:disabled { cursor: wait !important; }
.image-subject-preview { opacity: .65; object-fit: fill; }
.image-text-hit { border: 1.5px solid #e8dcff; background: #a48cf724; border-radius: 5px; box-shadow: 0 0 0 1px #3a2a64; }
.image-text-hit:hover, .image-text-hit[aria-pressed="true"] { background: #9270ff48; border-color: #f7edff; border-width: 2px; z-index: 1; }
.image-mark { transform: translate(-50%, -50%); display: grid; place-items: center; width: 22px; height: 22px;
  border: 2px solid #fff; border-radius: 50%; color: #fff; background: #5633b9; font: 700 14px/1 system-ui; box-shadow: 0 1px 6px #1c1239b3; }
.image-mark-minus { background: #a32763; }
</style>
