<script setup lang="ts">
import { computed } from 'vue'
import { Image, RotateCcw } from 'lucide-vue-next'
import StudioSelect from './StudioSelect.vue'
import type { ImageAsset } from '../studio/api'
import { ratioOptions, type Ratio } from '../studio/catalog'
import type { Background } from '../studio/document'
import { coverBox, type BackgroundFit } from '../studio/geometry'

const props = defineProps<{
  settings?: Background; asset: ImageAsset | null; ratio: Ratio; aspect: number; fixed: boolean
}>()
const emit = defineEmits<{ patch: [value: Partial<Background>, coalesce?: string] }>()
const framingChoices = [
  { value: 'original', label: '原图比例' },
  { value: 'contain', label: '完整保留' },
  { value: 'cover', label: '铺满裁切' },
] as const
const choices = computed(() => props.fixed ? framingChoices.slice(1) : framingChoices)
const fit = computed<BackgroundFit>(() => {
  const selected = props.settings?.fit
  return props.fixed && selected !== 'cover' ? 'contain' : selected ?? 'original'
})
const crop = computed(() => props.asset && fit.value === 'cover' ? coverBox(props.asset.width, props.asset.height, props.aspect) : undefined)
const tones = [
  { key: 'brightness', label: '亮度' }, { key: 'contrast', label: '对比度' }, { key: 'saturation', label: '饱和度' },
] as const

function slider(event: Event) { return (event.target as HTMLInputElement).valueAsNumber / 100 }

function chooseFit(value: BackgroundFit) {
  emit('patch', { fit: value, ratio: props.settings?.ratio ?? props.ratio })
}
</script>

<template>
  <section class="wb-panel wb-background" aria-label="底图设置">
    <div class="wb-property-head">
      <span class="wb-property-icon"><Image :size="16" aria-hidden="true" /></span>
      <div><h2>底图</h2><p v-if="asset">{{ asset.width }} × {{ asset.height }} 像素</p></div>
    </div>
    <div class="wb-property-section">
      <div v-if="asset" class="wb-property-row">
        <span>图像取景</span>
        <StudioSelect :model-value="fit" :items="choices" label="图像取景" @update:model-value="chooseFit" />
      </div>
      <div v-if="!fixed && (!asset || fit !== 'original')" class="wb-property-row">
        <span>画布比例</span>
        <StudioSelect :model-value="settings?.ratio ?? ratio" :items="ratioOptions" label="画布比例"
          @update:model-value="emit('patch', { ratio: $event })" />
      </div>
      <label class="wb-property-row">底色
        <input type="color" class="wb-color-field" :value="settings?.color ?? '#fcfaf5'" aria-label="画布底色"
          @input="emit('patch', { color: ($event.target as HTMLInputElement).value }, 'paper-color')">
      </label>
      <label v-if="crop && asset && asset.width - crop.width > 1" class="wb-slider-field">
        <span>水平裁切位置 <span class="wb-slider-value" aria-hidden="true">{{ Math.round((settings?.cropX ?? 0.5) * 100) }}%</span></span>
        <input type="range" min="0" max="100" aria-label="水平裁切位置" :value="(settings?.cropX ?? 0.5) * 100" @input="emit('patch', { cropX: slider($event) }, 'crop-x')">
      </label>
      <label v-if="crop && asset && asset.height - crop.height > 1" class="wb-slider-field">
        <span>垂直裁切位置 <span class="wb-slider-value" aria-hidden="true">{{ Math.round((settings?.cropY ?? 0.5) * 100) }}%</span></span>
        <input type="range" min="0" max="100" aria-label="垂直裁切位置" :value="(settings?.cropY ?? 0.5) * 100" @input="emit('patch', { cropY: slider($event) }, 'crop-y')">
      </label>
    </div>
    <div v-if="asset" class="wb-property-section">
      <div class="wb-layer-list-head"><h2>调色</h2>
        <button class="wb-button wb-text-button" type="button" @click="emit('patch', { brightness: 0, contrast: 0, saturation: 0 })">
          <RotateCcw :size="14" aria-hidden="true" /> 重置
        </button>
      </div>
      <label v-for="tone in tones" :key="tone.key" class="wb-slider-field">
        <span>{{ tone.label }} <span class="wb-slider-value" aria-hidden="true">{{ Math.round((settings?.[tone.key] ?? 0) * 100) }}</span></span>
        <input type="range" min="-80" max="80" :aria-label="tone.label" :value="(settings?.[tone.key] ?? 0) * 100"
          @input="emit('patch', { [tone.key]: slider($event) }, tone.key)">
      </label>
    </div>
  </section>
</template>
