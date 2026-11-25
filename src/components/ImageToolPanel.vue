<script setup lang="ts">
import { ArrowRight, Check, ScanLine, ScanSearch, X } from 'lucide-vue-next'
import type { DetectedText, SubjectCandidate } from '../studio/api'
import type { ImageTool } from '../studio/useImageTools'

const replacement = defineModel<string>('replacement', { required: true })
const include = defineModel<boolean>('include', { required: true })
const candidateIndex = defineModel<number>('candidateIndex', { required: true })
defineProps<{
  tool: ImageTool; action: 'scan' | 'point' | 'save' | null; error: string
  lines?: DetectedText[]; textIndex: number; candidates?: SubjectCandidate[]; pointCount: number
  layerFull: boolean; fillAvailable: boolean
}>()
const emit = defineEmits<{
  close: []; scan: []; select: [index: number]; applyText: []; reset: []; extract: [fill: boolean]; prompt: []
}>()
</script>

<template>
  <section class="wb-panel image-tool-panel" :aria-label="tool === 'text' ? '改图中文字' : '点选主体'" :aria-busy="Boolean(action)">
    <header class="image-tool-header">
      <div class="image-tool-icon"><ScanLine v-if="tool === 'text'" /><ScanSearch v-else /></div>
      <div><h2>{{ tool === 'text' ? '改图中文字' : '点选主体' }}</h2>
        <p>{{ tool === 'text' ? '选一段原文，把它变成可编辑文字。' : '点击画布上的对象，确认要处理的范围。' }}</p></div>
      <button class="wb-button image-tool-close" type="button" aria-label="关闭智能编辑" @click="emit('close')"><X /></button>
    </header>
    <p v-if="error" class="wb-error" role="alert">{{ error }}</p>
    <div v-if="action" class="image-tool-status" role="status"><span class="wb-spinner"></span>
      {{ action === 'scan' ? '正在识别文字…' : action === 'point' ? '正在识别主体边缘…' : '正在更新画布…' }}</div>

    <template v-if="tool === 'text'">
      <div v-if="lines?.length" class="image-tool-options" role="group" aria-label="识别到的文字">
        <button v-for="(line, index) in lines" :key="index" class="image-tool-line" type="button"
          :aria-pressed="index === textIndex" :disabled="Boolean(action)" @click="emit('select', index)">
          <span>{{ line.text }}</span><Check v-if="index === textIndex" aria-hidden="true" />
        </button>
      </div>
      <p v-else-if="lines" class="wb-help">没有识别到清晰的文字。可以返回对话，圈选需要修改的位置。</p>
      <button v-else-if="error" class="wb-button" type="button" @click="emit('scan')">重新识别</button>

      <form v-if="textIndex >= 0" class="image-tool-form" @submit.prevent="emit('applyText')">
        <label for="image-replacement">替换为</label>
        <textarea id="image-replacement" v-model="replacement" maxlength="84" rows="2"
          placeholder="留空可移除这段文字" :disabled="Boolean(action)"></textarea>
        <button type="submit" class="wb-button wb-primary" :disabled="Boolean(action) || (layerFull && Boolean(replacement.trim()))">
          {{ replacement.trim() ? '应用并保留文字层' : '移除这段文字' }} <ArrowRight />
        </button>
        <p class="wb-help">{{ layerFull && replacement.trim() ? '当前作品图层已满。' : '应用后可调整字体、颜色和位置。' }}</p>
      </form>
    </template>

    <template v-else>
      <div class="image-tool-subject-actions" role="group" aria-label="修正选区">
        <button type="button" class="wb-button" :aria-pressed="include" :disabled="Boolean(action)" @click="include = true">添加点</button>
        <button type="button" class="wb-button" :aria-pressed="!include" :disabled="Boolean(action) || !pointCount" @click="include = false">排除点</button>
        <button type="button" class="wb-button wb-quiet-button" :disabled="Boolean(action) || !pointCount" @click="emit('reset')">重选</button>
      </div>
      <p v-if="pointCount >= 6" class="wb-help">已使用 6 个定位点，可以重选。</p>
      <p v-if="candidates && !candidates.length && !action" class="wb-help">没有找到清楚的主体。可以重选对象边缘，或用画笔圈选。</p>
      <div v-else-if="candidates?.length" class="image-tool-form">
        <div v-if="candidates.length > 1" class="image-tool-subject-actions" role="group" aria-label="候选轮廓">
          <button v-for="(_, index) in candidates" :key="index" class="wb-button" type="button"
            :aria-pressed="candidateIndex === index" :disabled="Boolean(action)" @click="candidateIndex = index">轮廓 {{ index + 1 }}</button>
        </div>
        <button v-if="fillAvailable" type="button" class="wb-button wb-primary"
          :disabled="Boolean(action) || layerFull || candidates[candidateIndex].area > .32" @click="emit('extract', true)">
          分离主体与背景 <ArrowRight />
        </button>
        <button type="button" class="wb-button" :class="{ 'wb-primary': !fillAvailable }"
          :disabled="Boolean(action) || layerFull" @click="emit('extract', false)">仅提取主体</button>
        <button type="button" class="wb-button" :disabled="Boolean(action)" @click="emit('prompt')">对话修改选区</button>
        <p v-if="layerFull" class="wb-help">当前作品图层已满。</p>
        <p v-else-if="fillAvailable && candidates[candidateIndex].area > .32" class="wb-help">选区较大，可缩小范围后再补背景。</p>
        <p v-else-if="fillAvailable" class="wb-help">分离后拖动主体，原位会补上背景。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.image-tool-panel { display: grid; align-content: start; gap: 14px; }
.image-tool-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 10px; }
.image-tool-header h2 { font-size: 16px; }
.image-tool-header p { color: var(--wb-muted); font-size: 12px; line-height: 1.55; padding-top: 4px; overflow-wrap: anywhere; }
.image-tool-icon { width: 35px; height: 35px; display: grid; place-items: center; border-radius: 10px; color: var(--wb-action); background: var(--wb-soft); }
.image-tool-panel :deep(.image-tool-close) { min-height: 30px !important; width: 30px; padding: 0 !important; }
.image-tool-options { display: grid; gap: 5px; max-height: 215px; overflow: auto; padding: 2px; }
.image-tool-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 10px; text-align: left;
  min-height: 38px; width: 100%; background: var(--wb-faint); border: 1px solid transparent; border-radius: 8px; overflow-wrap: anywhere; }
.image-tool-line[aria-pressed="true"] { color: var(--wb-action); border-color: var(--wb-ring); background: var(--wb-soft); }
.image-tool-form { display: grid; gap: 8px; font-size: 13px; }
.image-tool-form textarea { resize: vertical; padding: 8px 10px; width: 100%; border: 1px solid var(--wb-line); border-radius: 8px; min-height: 52px; background: var(--wb-panel); }
.image-tool-status { display: flex; align-items: center; gap: 9px; color: var(--wb-muted); font-size: 12px; }
.image-tool-subject-actions { display: flex; flex-wrap: wrap; gap: 5px; }
</style>
