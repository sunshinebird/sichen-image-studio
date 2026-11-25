<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { Download, AlignCenter, AlignLeft, ArrowDown, ArrowUp, Bold, Circle, CopyPlus, Crop, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Group, Image, ImagePlus, Italic, ListChecks, Lock, LockOpen, Square, Trash2, Type, Ungroup,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalSpaceAround,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalSpaceAround } from 'lucide-vue-next'
import { textColors, type CanvasItem, type Slide, type TextColor } from '../studio/document'
import type { ArrangeAction } from '../studio/arrangeLayers'

const props = defineProps<{
  entries: CanvasItem[]; current?: CanvasItem; hasImage: boolean; slide?: Slide; professional: boolean; boardAspect: number
  selected: string[]; movableCount: number; grouped: boolean
}>()
const emit = defineEmits<{
  select: [id: string, extend: boolean]; patch: [values: Partial<CanvasItem>, group?: string]
  align: [center: boolean]; duplicate: []; delete: []; stack: [direction: number]
  arrange: [action: ArrangeAction]; group: []
  notes: [value: string]; metric: [index: number, patch: Partial<{ label: string; value: number }>]
  replace: [id: string]; background: []
}>()
const colorChoices: { color: TextColor; name: string }[] = [
  { color: 'cream', name: '米白色' }, { color: 'gold', name: '暖金色' },
  { color: 'white', name: '纯白色' }, { color: 'ink', name: '墨蓝色' },
]
const indices = computed(() => props.entries.filter(item => item.id !== 'title' && item.id !== 'subtitle').map(item => item.id))
const multi = shallowRef(false)
const actions = [
  { action: 'left', label: '左对齐', icon: AlignHorizontalJustifyStart },
  { action: 'center-x', label: '水平居中', icon: AlignHorizontalJustifyCenter },
  { action: 'right', label: '右对齐', icon: AlignHorizontalJustifyEnd },
  { action: 'space-x', label: '水平等距', icon: AlignHorizontalSpaceAround },
  { action: 'top', label: '顶端对齐', icon: AlignVerticalJustifyStart },
  { action: 'center-y', label: '垂直居中', icon: AlignVerticalJustifyCenter },
  { action: 'bottom', label: '底端对齐', icon: AlignVerticalJustifyEnd },
  { action: 'space-y', label: '垂直等距', icon: AlignVerticalSpaceAround },
] as const
const displayName = (item: CanvasItem) => item.id === 'title' ? '标题' : item.id === 'subtitle' ? '副标题'
  : item.type === 'circle' ? '圆形' : item.type === 'rectangle' ? '矩形' : item.type === 'image' ? (item.label || '图片素材') : item.text || '文字'
const from = (event: Event) => (event.target as HTMLInputElement).value
const number = (event: Event) => (event.target as HTMLInputElement).valueAsNumber
const transforms = [
  { key: 'x', label: '横向位置', min: -35, max: 98 },
  { key: 'y', label: '纵向位置', min: -28, max: 98 },
  { key: 'width', label: '宽度', min: 4, max: 100 },
  { key: 'height', label: '高度', min: 3, max: 100 },
  { key: 'angle', label: '旋转角度', min: -180, max: 180 },
] as const

function changeNumber(key: 'x' | 'y' | 'width' | 'height' | 'angle', minimum: number, maximum: number, event: Event) {
  const field = event.target as HTMLInputElement
  const value = field.valueAsNumber
  if (!Number.isFinite(value)) {
    field.value = String(props.current?.[key] ?? '')
    return
  }
  const bounded = Math.max(minimum, Math.min(maximum, value))
  field.value = String(bounded)
  emit('patch', { [key]: bounded }, key)
}

function colorOf(item: CanvasItem) {
  const color = item.fill ?? textColors[item.color]
  return color === '#fff' ? '#ffffff' : color
}
</script>

<template>
  <section class="wb-panel wb-layers" aria-label="图层属性">
    <div class="wb-layer-list">
      <div class="wb-layer-list-head">
        <h2>图层</h2>
        <button v-if="professional && entries.length > 1" type="button" class="wb-button wb-layer-multi" :aria-pressed="multi" @click="multi = !multi">
          <ListChecks :size="14" /> 多选
        </button>
      </div>
      <p v-if="!entries.length && !hasImage" class="wb-help">使用画布工具添加文字、形状或图片。</p>
      <button v-for="item in entries.slice().reverse()" :key="item.id" type="button" class="wb-layer-row"
        :class="{ 'wb-layer-active': selected.includes(item.id) }" :aria-label="'图层 ' + displayName(item)"
        :aria-pressed="selected.includes(item.id)" @click="emit('select', item.id, professional && (multi || $event.shiftKey))">
        <Circle v-if="item.type === 'circle'" :size="16" /><Square v-else-if="item.type === 'rectangle'" :size="16" />
        <Image v-else-if="item.type === 'image'" :size="16" /><Type v-else :size="16" />
        <strong>{{ displayName(item) }}</strong>
        <Lock v-if="item.locked" :size="14" aria-label="已锁定" />
        <Eye v-else-if="item.visible" :size="14" aria-label="可见" /><EyeOff v-else :size="14" aria-label="已隐藏" />
      </button>
      <button v-if="hasImage" type="button" class="wb-layer-row wb-locked-layer" aria-label="编辑图片底图" @click="emit('background')">
        <Image :size="16" aria-hidden="true" /><strong>图片底图</strong><span>取景与调色</span>
      </button>
    </div>

    <div v-if="professional && movableCount > 1" class="wb-layer-fields">
      <div class="wb-layer-properties-head">
        <h2>已选 {{ movableCount }} 个图层</h2>
        <button class="wb-button" type="button" @click="emit('group')">
          <Ungroup v-if="grouped" :size="15" /><Group v-else :size="15" /> {{ grouped ? '取消组合' : '组合' }}
        </button>
      </div>
      <div class="wb-arrange-actions" role="group" aria-label="图层对齐与分布">
        <button v-for="tool in actions" :key="tool.action" type="button" class="wb-button icon-button" :aria-label="tool.label"
          :title="tool.label" :disabled="tool.action.startsWith('space-') && movableCount < 3" @click="emit('arrange', tool.action)">
          <component :is="tool.icon" :size="17" />
        </button>
      </div>
    </div>

    <div v-else-if="current" class="wb-layer-fields">
      <div class="wb-layer-properties-head">
        <h2>{{ displayName(current) }}</h2>
        <div class="wb-layer-tools">
          <button v-if="professional" class="wb-button icon-button" type="button" :aria-label="current.locked ? '解锁图层' : '锁定图层'"
            @click="emit('patch', { locked: !current.locked })"><Lock v-if="current.locked" :size="15" /><LockOpen v-else :size="15" /></button>
          <button class="wb-button icon-button" type="button" :aria-label="current.visible ? '隐藏图层' : '显示图层'" @click="emit('patch', { visible: !current.visible })">
            <Eye v-if="current.visible" :size="16" /><EyeOff v-else :size="16" />
          </button>
        </div>
      </div>
      <template v-if="current.type === 'text'">
        <label :for="'canvas-text-' + current.id">{{ current.id === 'title' ? '标题' : current.id === 'subtitle' ? '副标题' : '文字' }}</label>
        <input :id="'canvas-text-' + current.id" :value="current.text" type="text" :maxlength="current.id === 'title' ? 28 : 84" :disabled="current.locked"
          @input="emit('patch', { text: from($event), visible: true }, 'text')">
        <div class="wb-layer-tools">
          <label class="wb-font-field">
            <span class="visually-hidden">字体</span>
            <select aria-label="字体" :disabled="current.locked" :value="current.font ?? 'sans'"
              @change="emit('patch', { font: from($event) === 'serif' ? 'serif' : 'sans' })">
              <option value="serif">宋体</option><option value="sans">黑体</option>
            </select>
          </label>
          <button class="wb-button icon-button" type="button" aria-label="粗体" :disabled="current.locked"
            :aria-pressed="current.bold ?? (current.id !== 'subtitle')" @click="emit('patch', { bold: !(current.bold ?? (current.id !== 'subtitle')) })">
            <Bold :size="15" aria-hidden="true" />
          </button>
          <button class="wb-button icon-button" type="button" aria-label="斜体" :disabled="current.locked"
            :aria-pressed="current.italic ?? false" @click="emit('patch', { italic: !current.italic })"><Italic :size="15" aria-hidden="true" /></button>
        </div>
        <div class="wb-layer-tools">
          <button class="wb-button" type="button" :disabled="current.locked" @click="emit('align', false)"><AlignLeft :size="15" /> 靠左</button>
          <button class="wb-button" type="button" :disabled="current.locked" @click="emit('align', true)"><AlignCenter :size="15" /> 居中</button>
        </div>
        <label for="canvas-font-size">字号</label>
        <input id="canvas-font-size" type="range" min="1.7" max="28" step="0.1" :value="current.height" :disabled="current.locked"
          @input="emit('patch', { height: number($event) }, 'size')">
      </template>
      <div v-if="current.type === 'image'" class="wb-layer-tools">
        <a v-if="current.asset" class="wb-button icon-button" :href="current.asset.url" :download="(current.label || '图层素材') + '.png'"
          aria-label="下载图层素材" title="下载图层素材"><Download :size="15" aria-hidden="true" /></a>
        <button type="button" class="wb-button" :disabled="current.locked" @click="emit('replace', current.id)"><ImagePlus :size="15" aria-hidden="true" /> 替换图片</button>
        <button type="button" class="wb-button" :disabled="current.locked" @click="emit('patch', { fit: 'cover', height: current.width * boardAspect })"><Crop :size="15" /> 方形裁切</button>
        <button type="button" class="wb-button" :disabled="current.locked" @click="emit('patch', { fit: 'contain' })">显示完整图片</button>
        <button class="wb-button icon-button" type="button" aria-label="水平翻转" :aria-pressed="current.flipX ?? false"
          :disabled="current.locked" @click="emit('patch', { flipX: !current.flipX })"><FlipHorizontal2 :size="16" aria-hidden="true" /></button>
        <button class="wb-button icon-button" type="button" aria-label="垂直翻转" :aria-pressed="current.flipY ?? false"
          :disabled="current.locked" @click="emit('patch', { flipY: !current.flipY })"><FlipVertical2 :size="16" aria-hidden="true" /></button>
      </div>
      <div v-else class="wb-layer-color" role="group" aria-label="图层颜色">
        <span>颜色</span>
        <button v-for="item in colorChoices" :key="item.color" class="wb-swatch" type="button"
          :style="{ background: textColors[item.color] }" :aria-label="item.name" :aria-pressed="!current.fill && current.color === item.color" :disabled="current.locked"
          @click="emit('patch', { color: item.color, fill: undefined })"></button>
        <input class="wb-color-field" type="color" :value="colorOf(current)" aria-label="自定义图层颜色" :disabled="current.locked"
          @input="emit('patch', { fill: from($event) }, 'fill')">
      </div>
      <template v-if="professional">
        <label for="canvas-opacity">透明度 <span>{{ Math.round((current.opacity ?? 1) * 100) }}%</span></label>
        <input id="canvas-opacity" :value="current.opacity ?? 1" type="range" min="0" max="1" step="0.05" :disabled="current.locked"
          @input="emit('patch', { opacity: number($event) }, 'opacity')">
      </template>
      <details v-if="professional" class="wb-transform">
        <summary>位置与尺寸</summary>
        <div class="wb-transform-grid">
          <label v-for="field in transforms.filter(field => field.key !== 'height' || current?.type !== 'text')" :key="field.key">
            <span>{{ field.label }} {{ field.key === 'angle' ? '°' : '%' }}</span>
            <input type="number" :value="current[field.key]" :min="field.min" :max="field.max" step="0.1"
              :disabled="current.locked" :aria-label="field.label" @change="changeNumber(field.key, field.min, field.max, $event)">
          </label>
        </div>
      </details>
      <div v-if="professional" class="wb-layer-tools wb-layer-operations">
        <button class="wb-button icon-button" type="button" aria-label="复制图层" :disabled="current.type === 'text' && !current.text" @click="emit('duplicate')"><CopyPlus :size="16" /></button>
        <button class="wb-button icon-button" type="button" aria-label="下移图层" :disabled="indices.indexOf(current.id) <= 0" @click="emit('stack', -1)"><ArrowDown :size="16" /></button>
        <button class="wb-button icon-button" type="button" aria-label="上移图层" :disabled="indices.indexOf(current.id) < 0 || indices.at(-1) === current.id" @click="emit('stack', 1)"><ArrowUp :size="16" /></button>
        <button class="wb-button icon-button" type="button" aria-label="删除图层" :disabled="current.locked" @click="emit('delete')"><Trash2 :size="16" /></button>
      </div>
    </div>
    <div v-if="slide?.kind === 'features'" class="wb-layer-fields">
      <label for="slide-notes">正文</label>
      <textarea id="slide-notes" :value="slide.notes" maxlength="240" rows="3" @input="emit('notes', from($event))"></textarea>
    </div>
    <div v-if="slide?.kind === 'data'" class="wb-layer-fields">
      <h2>图表数据</h2>
      <div v-for="(metric, index) in slide.metrics" :key="index" class="wb-metric">
        <input :aria-label="'标签 ' + (index + 1)" type="text" maxlength="18" :value="metric.label" @input="emit('metric', index, { label: from($event) })">
        <input :aria-label="'数值 ' + (index + 1)" type="number" min="0" max="99999" :value="metric.value"
          @input="emit('metric', index, { value: Math.max(0, Math.min(99999, number($event) || 0)) })">
      </div>
    </div>
  </section>
</template>
