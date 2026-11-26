<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import { ArrowDown, Search, SlidersHorizontal } from 'lucide-vue-next'
import { categories, type Case, type Ratio } from '../studio/catalog'
import { useCaseFeed } from '../studio/useCaseFeed'
import type { StudioDocument } from '../studio/document'
import { useGalleryLayout } from '../studio/useGalleryLayout'
import CaseCard from './CaseCard.vue'
import CaseDetails from './CaseDetails.vue'
import StudioLaunch from './StudioLaunch.vue'
import StudioSelect from './StudioSelect.vue'
import '../styles/gallery.css'

defineProps<{ importing: boolean; importError: string; dailyLimit?: number }>()
const emit = defineEmits<{
  choose: [item: Case, prompt?: string, title?: string, intent?: StudioDocument['intent']]
  import: [file: File]
  create: [prompt: string, ratio: Ratio, references: File[]]
}>()
const marker = useTemplateRef<HTMLElement>('marker')
const grid = useTemplateRef<HTMLElement>('grid')
const portfolio = useGalleryLayout(grid)
const details = shallowRef<Case>()
const fromFeatured = shallowRef(false)
const hasFilters = computed(() => category.value !== 'all' || industry.value !== 'all' || Boolean(query.value.trim()))
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
    <StudioLaunch :featured="featured" :importing="importing" :import-error="importError" :daily-limit="dailyLimit"
      @featured="openDetail($event, true)" @import="emit('import', $event)"
      @create="(prompt, ratio, references) => emit('create', prompt, ratio, references)" />

    <section class="sa-gallery" aria-labelledby="sa-gallery-title">
      <div class="sa-section-head">
        <div class="sa-section-intro">
          <div class="sa-section-title">
            <h2 id="sa-gallery-title" tabindex="-1">灵感案例</h2>
            <span v-if="total" class="sa-case-count" aria-live="polite">{{ matches }} 个案例</span>
          </div>
          <p>查看高清作品和提示词，选一个直接做同款。</p>
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
        <p>没有找到符合条件的案例。试试换个关键词或清除筛选。</p>
        <button v-if="hasFilters" class="sa-button" type="button" @click="clearFilters">查看全部案例</button>
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
