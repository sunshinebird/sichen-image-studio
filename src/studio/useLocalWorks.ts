import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'
import type { ImageAsset } from './api'
import { isStudioDocument, saveDraft, type StudioDocument } from './document'

const key = 'sichen.studio.works.v1'
interface LocalWork { document: StudioDocument; modified: number; preview?: ImageAsset }

function loadWorks(): LocalWork[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(rows)) return []
    return rows.filter(row => isStudioDocument(row?.document) && Number.isFinite(row.modified))
  } catch { return [] }
}

function hasContent(doc: StudioDocument) {
  return Boolean(doc.caseId || doc.imported || doc.version || doc.requestedVersion || doc.pendingSubmission || doc.references?.length || doc.slides ||
    doc.instructions.trim() || doc.editInstructions?.trim() || doc.layer.extras?.length || doc.layer.background)
}

export function useLocalWorks(doc: Ref<StudioDocument>, image: Readonly<Ref<ImageAsset | null>>) {
  const works = shallowRef(loadWorks())
  const warning = shallowRef('')
  let timer: ReturnType<typeof setTimeout> | undefined

  function persist(entry: LocalWork) {
    const byId = new Map<string, LocalWork>()
    for (const row of [...works.value, ...loadWorks(), entry]) {
      const id = row.document.id
      if ((byId.get(id)?.modified ?? 0) <= row.modified) byId.set(id, row)
    }
    const rows = [...byId.values()].sort((a, b) => b.modified - a.modified)
    works.value = rows
    try {
      localStorage.setItem(key, JSON.stringify(rows))
      warning.value = ''
    } catch { warning.value = '浏览器空间不足，部分作品仅保留在这个页面。' }
  }
  function updateFromStorage(event: StorageEvent) {
    if (event.key === key) works.value = loadWorks()
  }

  function flush() {
    clearTimeout(timer)
    saveDraft(doc.value)
    if (!hasContent(doc.value)) return
    // Snapshot the document. Later job status updates can mutate the active draft.
    const snapshot = JSON.parse(JSON.stringify(doc.value)) as StudioDocument
    const existing = works.value.find(row => row.document.id === snapshot.id)
    const preview = snapshot.version
      ? (image.value?.url === '/api/assets/' + snapshot.version ? image.value : existing?.preview)
      : image.value ?? undefined
    if (existing && JSON.stringify(existing.document) === JSON.stringify(snapshot) && existing.preview?.url === preview?.url) return
    persist({ document: snapshot, modified: Date.now(), preview })
  }

  function updateBackgroundWork(id: string, change: (work: StudioDocument) => StudioDocument) {
    const existing = loadWorks().find(row => row.document.id === id) ?? works.value.find(row => row.document.id === id)
    if (existing) persist({ ...existing, document: change(existing.document), modified: Date.now() })
  }

  watch([doc, image], () => {
    clearTimeout(timer)
    timer = setTimeout(flush, 250)
  }, { deep: true })
  onMounted(() => {
    flush()
    window.addEventListener('pagehide', flush)
    window.addEventListener('storage', updateFromStorage)
  })
  onBeforeUnmount(() => {
    flush()
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('storage', updateFromStorage)
  })

  return { works, warning, flush, updateBackgroundWork }
}
