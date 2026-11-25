<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import { ArrowDown, ArrowUpRight, Image, ImagePlus, RectangleHorizontal, Search, SlidersHorizontal } from 'lucide-vue-next'
import UButton from '@nuxt/ui/components/Button.vue'
import UTextarea from '@nuxt/ui/components/Textarea.vue'
import { categories, ratioOptions, type Case, type Ratio } from '../studio/catalog'
import { galleryCoverSizes, gallerySources } from '../studio/imageView'
import { useCaseFeed } from '../studio/useCaseFeed'
import { validReferenceFile } from '../studio/useReferenceImages'
import type { StudioDocument } from '../studio/document'
import { useGalleryLayout } from '../studio/useGalleryLayout'
import CaseCard from './CaseCard.vue'
import CaseDetails from './CaseDetails.vue'
import StudioSelect from './StudioSelect.vue'
import '../styles/gallery.css'

defineProps<{ importing: boolean; importError: string }>()
const emit = defineEmits<{
  choose: [item: Case, prompt?: string, title?: string, intent?: StudioDocument['intent']]
  import: [file: File]
  create: [prompt: string, ratio: Ratio, references: File[]]
}>()
const idea = shallowRef('')
const ratio = shallowRef<Ratio>('portrait')
const references = shallowRef<File[]>([])
const referenceMessage = shallowRef('')
const upload = useTemplateRef<HTMLInputElement>('upload')
const importInput = useTemplateRef<HTMLInputElement>('import-input')
const marker = useTemplateRef<HTMLElement>('marker')
const grid = useTemplateRef<HTMLElement>('grid')
const portfolio = useGalleryLayout(grid)
const details = shallowRef<Case>()
const fromFeatured = shallowRef(false)
const hasFilters = computed(() => category.value !== 'all' || industry.value !== 'all' || Boolean(query.value.trim()))
function begin() {
  if (!idea.value.trim()) {
    referenceMessage.value = '请先写一句你想做的图。'
    document.getElementById('gallery-prompt')?.focus()
    return
  }
  emit('create', idea.value.trim(), ratio.value, references.value)
}
function openImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!validReferenceFile(file)) {
    referenceMessage.value = '请选择 10 MB 以内的 PNG、JPEG 或 WebP。'
    return
  }
  referenceMessage.value = ''
  emit('import', file)
}
watch(idea, () => {
  if (referenceMessage.value === '请先写一句你想做的图。') referenceMessage.value = ''
})
const {
  category, industry, sort, query, items, featured, industries, total, matches,
  cursor, loading, error, refreshed, load,
} = useCaseFeed(marker)
const detailItems = computed(() => fromFeatured.value && featured.value ? [featured.value, ...items.value] : items.value)
const detailIndex = computed(() => detailItems.value.findIndex(item => item.id === details.value?.id))
const industryOptions = computed(() => [
  { value: 'all', label: '所有行业' },
  ...industries.value.map(value => ({ value, label: value })),
])
watch(industries, values => { if (industry.value !== 'all' && !values.includes(industry.value)) industry.value = 'all' })

function addReferences(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.some(file => !validReferenceFile(file))) {
    referenceMessage.value = '参考图须为 10 MB 以内的 PNG、JPEG 或 WebP。'
    return
  }
  references.value = files.slice(0, 2)
  referenceMessage.value = files.length > 2 ? '参考图最多带入 2 张。' : ''
}

function openDetail(item: Case, featuredCase = false) {
  fromFeatured.value = featuredCase
  details.value = item
}

async function stepCase(direction: -1 | 1) {
  const index = detailIndex.value
  if (index < 0) return
  if (direction === 1 && !detailItems.value[index + 1] && cursor.value) await load()
  if (detailIndex.value !== index) return
  const item = detailItems.value[index + direction]
  if (item) details.value = item
}

function clearFilters() {
  category.value = 'all'
  industry.value = 'all'
  query.value = ''
}
</script>

<template>
  <main id="sichen-atelier" class="gallery-page" tabindex="-1">
    <section class="sa-hero">
      <div class="sa-hero-copy">
        <h1>一句话，<br><em>开始创作</em></h1>
        <p class="sa-hero-note">从一句描述开始，或直接编辑现有图片。</p>
        <form class="sa-composer" @submit.prevent="begin">
          <label class="visually-hidden" for="gallery-prompt">描述要生成的图片</label>
          <UTextarea id="gallery-prompt" v-model="idea" name="prompt" :rows="2" :maxlength="1200" autocomplete="off"
            variant="none" placeholder="例如，给秋季上新的香氛做一张海报…" />
          <div class="sa-compose-bar">
            <div class="sa-quick">
              <button class="sa-tool" type="button" @click="upload?.click()"><ImagePlus :size="16" aria-hidden="true" /> 参考图</button>
              <input ref="upload" type="file" multiple accept="image/png,image/jpeg,image/webp" hidden @change="addReferences">
              <StudioSelect v-model="ratio" label="预选画布比例" :items="ratioOptions">
                <template #icon><RectangleHorizontal :size="16" aria-hidden="true" /></template>
              </StudioSelect>
            </div>
            <UButton type="submit" class="sa-button sa-primary">开始创作 <ArrowUpRight :size="16" aria-hidden="true" /></UButton>
          </div>
          <div v-if="references.length" class="sa-upload-note">
            <span role="status">{{ references.length }} 张参考图</span>
            <button class="sa-clear sa-plain" type="button" @click="references = []; referenceMessage = ''">清除参考图</button>
          </div>
          <p v-if="referenceMessage" class="sa-form-message" role="status">{{ referenceMessage }}</p>
        </form>
        <div class="sa-start-actions">
          <button class="sa-button" type="button" :disabled="importing" @click="importInput?.click()"><Image :size="16" aria-hidden="true" /> {{ importing ? '正在打开…' : '上传图片编辑' }}</button>
          <input ref="import-input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="openImage">
          <a href="#sa-gallery-title" class="sa-browse">浏览案例 <ArrowDown :size="14" aria-hidden="true" /></a>
        </div>
        <p v-if="importError" class="sa-form-message" role="alert">{{ importError }}</p>
      </div>

      <button v-if="featured" type="button" class="sa-feature sa-media sa-plain" :aria-label="featured.name + '，查看精选作品'" @click="openDetail(featured, true)">
        <span class="sa-feature-art">
          <img :src="featured.image" :srcset="gallerySources(featured.image, featured.width, true)" :sizes="galleryCoverSizes"
            alt="" :width="featured.width" :height="featured.height" fetchpriority="high">
        </span>
        <span class="sa-feature-footer">
          <span><small>{{ featured.subtitle }}</small><strong>{{ featured.name }}</strong></span>
          <span class="sa-feature-cta">查看作品 <ArrowUpRight :size="16" aria-hidden="true" /></span>
        </span>
      </button>
      <div v-else class="sa-feature sa-feature-loading" aria-hidden="true"></div>
    </section>

    <section class="sa-gallery" aria-labelledby="sa-gallery-title">
      <div class="sa-section-head">
        <div class="sa-section-title">
          <h2 id="sa-gallery-title">灵感案例</h2>
          <span v-if="total" class="sa-case-count" aria-live="polite">{{ matches }} 个案例</span>
        </div>
        <div class="sa-list-tools">
          <label class="sa-search">
            <Search :size="17" aria-hidden="true" /><input v-model="query" aria-label="搜索案例" name="case-search" type="search"
              maxlength="80" autocomplete="off" placeholder="搜索案例或关键词">
          </label>
          <div class="sa-sorts" role="group" aria-label="案例排序">
            <button type="button" :aria-pressed="sort === 'recommended'" @click="sort = 'recommended'">推荐</button>
            <button type="button" :aria-pressed="sort === 'latest'" @click="sort = 'latest'">最新</button>
          </div>
        </div>
      </div>
      <div class="sa-filters" role="group" aria-label="筛选案例">
        <button v-for="item in categories" :key="item.id" class="sa-plain" type="button" :aria-pressed="category === item.id" @click="category = item.id">{{ item.label }}</button>
        <StudioSelect v-model="industry" class="industry-filter" label="行业筛选" :items="industryOptions">
          <template #icon><SlidersHorizontal :size="15" aria-hidden="true" /></template>
        </StudioSelect>
      </div>
      <div v-if="hasFilters" class="sa-filter-summary">
        <span v-if="query.trim()">“{{ query.trim() }}”</span>
        <button class="sa-clear sa-plain" type="button" @click="clearFilters">清除筛选</button>
      </div>
      <div v-if="items.length" ref="grid" class="sa-case-grid" :class="{ 'sa-masonry': portfolio.width.value }">
        <CaseCard v-for="(item, index) in items" :key="item.id" :item="item" :eager="index < 4" :style="portfolio.layout(item)"
          @details="openDetail(item)" @choose="emit('choose', item)" />
      </div>
      <div v-else-if="!loading && !error" class="sa-empty-filter">
        <p>没有找到符合条件的案例。</p>
      </div>

      <div v-if="cursor || loading || error" ref="marker" class="sa-load-more">
        <p v-if="loading" class="sa-feed-status" role="status">正在加载案例…</p>
        <template v-else-if="error">
          <p role="status">{{ error }}</p><button class="sa-button" type="button" @click="load(!cursor)">重试</button>
        </template>
        <button v-else class="sa-button sa-load-more-button" type="button" @click="load()"><ArrowDown :size="15" /> 加载更多</button>
      </div>
      <p v-else-if="items.length" class="sa-feed-status sa-feed-end">已显示 {{ items.length }} 个案例</p>
      <p v-if="refreshed" class="visually-hidden" role="status">已载入更新后的案例目录。</p>
    </section>
    <CaseDetails v-if="details" :item="details" :has-previous="detailIndex > 0"
      :has-next="detailIndex >= 0 && (detailIndex + 1 < detailItems.length || Boolean(cursor && !error))" :loading-next="loading && detailIndex + 1 === detailItems.length" @step="stepCase" @close="details = undefined"
      @choose="(item, prompt, title, intent) => { details = undefined; emit('choose', item, prompt, title, intent) }" />
  </main>
</template>
