import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'
import { ApiError, studioApi } from './api'
import { categories, type Case, type Category } from './catalog'

const filterKey = 'sichen.studio.case-filters'
function savedFilters(): { category: Category | 'all'; industry: string; sort: string; query: string } {
  const defaults = { category: 'all' as const, industry: 'all', sort: 'recommended', query: '' }
  try {
    const old = JSON.parse(sessionStorage.getItem(filterKey) || 'null')
    if (!old) return defaults
    return {
      category: categories.find(item => item.id === old.category)?.id ?? defaults.category,
      industry: typeof old.industry === 'string' ? old.industry.slice(0, 48) : defaults.industry,
      sort: old.sort === 'latest' ? 'latest' : defaults.sort,
      query: typeof old.query === 'string' ? old.query.slice(0, 80) : defaults.query,
    }
  } catch { return defaults }
}

export function useCaseFeed(marker: Readonly<Ref<HTMLElement | null>>) {
  const initial = savedFilters()
  const category = shallowRef(initial.category)
  const industry = shallowRef(initial.industry)
  const sort = shallowRef(initial.sort)
  const query = shallowRef(initial.query)
  const items = shallowRef<Case[]>([])
  const featured = shallowRef<Case | undefined>()
  const industries = shallowRef<string[]>([])
  const total = shallowRef(0)
  const matches = shallowRef(0)
  const cursor = shallowRef<string | null>(null)
  const loading = shallowRef(true)
  const error = shallowRef('')
  const refreshed = shallowRef(false)
  let epoch = 0
  let pending: AbortController | undefined
  let observer: IntersectionObserver | undefined
  let debounce: number | undefined

  function observeMarker() {
    observer?.disconnect()
    if (marker.value && cursor.value && !loading.value && !error.value) observer?.observe(marker.value)
  }

  async function load(reset = false, catalogChanged = false) {
    if (!reset && (!cursor.value || loading.value)) return
    if (reset) pending?.abort()
    const run = ++epoch
    const controller = new AbortController()
    pending = controller
    const params = new URLSearchParams({ category: category.value, industry: industry.value, sort: sort.value, q: query.value.trim() })
    if (!reset && cursor.value) params.set('cursor', cursor.value)
    if (reset) {
      items.value = []
      cursor.value = null
    }
    loading.value = true
    error.value = ''
    try {
      const page = await studioApi.cases(params, controller.signal)
      if (run !== epoch) return
      const previous = new Set(items.value.map(item => item.id))
      items.value = [...items.value, ...page.items.filter(item => !previous.has(item.id))]
      featured.value = page.featured
      cursor.value = page.nextCursor
      total.value = page.counts.total
      matches.value = page.counts.matches
      industries.value = page.industries
      refreshed.value = catalogChanged
    } catch (cause) {
      if (run !== epoch || controller.signal.aborted) return
      if (!reset && cause instanceof ApiError && cause.code === 'catalog_changed') {
        await load(true, true)
        return
      }
      error.value = '案例暂时加载失败。'
    } finally {
      if (run === epoch) { loading.value = false; observeMarker() }
    }
  }

  watch([category, industry, sort, query], ([category, industry, sort, query]) => {
    try { sessionStorage.setItem(filterKey, JSON.stringify({ category, industry, sort, query })) } catch { /* No session storage. */ }
  })
  watch([category, industry, sort], () => {
    clearTimeout(debounce)
    void load(true)
  })
  watch(query, () => {
    clearTimeout(debounce)
    debounce = window.setTimeout(() => void load(true), 200)
  })
  watch(marker, observeMarker, { flush: 'post' })

  onMounted(() => {
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) void load()
      }, { rootMargin: '0px 0px 170px 0px' })
      observeMarker()
    }
    void load(true)
  })
  onBeforeUnmount(() => {
    clearTimeout(debounce)
    observer?.disconnect()
    pending?.abort()
  })
  return { category, industry, sort, query, items, featured, industries, total, matches, cursor, loading, error, refreshed, load }
}
