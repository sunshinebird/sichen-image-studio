import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { ApiError, canGenerate, studioApi, type AccountUpdate, type ImageAsset, type Job, type SelectedSubject, type Session } from './api'
import { getCase, type Case, type Ratio } from './catalog'
import { newDocument, readDraft, workingImage, type StudioDocument } from './document'
import { useLocalWorks } from './useLocalWorks'
import { useReferenceImages } from './useReferenceImages'
import { createMask, frameAspect, type MaskSelection } from './geometry'

const confirmationWait = 25_000
const confirmationMessage = '连接中断，正在确认这次任务。请暂时不要重新提交。'

export function useStudio() {
  const route = shallowRef<'editor' | 'gallery'>(location.pathname === '/studio' ? 'editor' : 'gallery')
  const doc = ref(readDraft() ?? newDocument())
  const session = shallowRef<Session | null>(null)
  const jobs = shallowRef<Job[]>([])
  const submitting = shallowRef(false)
  const error = shallowRef('')
  const quotaReached = shallowRef(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let initialSession: Promise<void> | undefined
  let galleryScroll = 0
  let priorScrollRestoration: ScrollRestoration
  let checkedDemoDraft: string | undefined
  let refreshSequence = 0
  const checkedMissing = shallowRef<string>()
  const checking = computed(() => Boolean(doc.value.pendingSubmission && checkedMissing.value !== doc.value.pendingSubmission.key))

  const caseInfo = computed(() => doc.value.template ?? getCase(doc.value.caseId))
  const original = computed<ImageAsset | null>(() => {
    if (doc.value.imported) return doc.value.imported
    const item = caseInfo.value
    if (!item || item.start === 'upload') return null
    return item.input ?? { url: item.image, width: item.width, height: item.height }
  })
  const completed = computed(() => jobs.value.filter(job => job.status === 'succeeded' && job.asset).slice().reverse())
  const active = computed(() => jobs.value.find(job => job.id === doc.value.version && job.asset))
  const image = computed(() => active.value?.asset ?? original.value)
  const local = useLocalWorks(doc, image)
  const referenceImages = useReferenceImages(doc, {
    ensureSession, updateSavedWork: local.updateBackgroundWork, saved: local.flush,
  })
  const busyJob = computed(() => jobs.value.find(job => job.status === 'running'))
  const uncertainJob = computed(() => jobs.value.find(job => job.status === 'uncertain'))

  function syncQuota(quota: Session['quota']) {
    if (session.value) session.value = { ...session.value, quota, sub2: { ...session.value.sub2, linked: quota.mode === 'member' } }
    if (canGenerate(quota)) quotaReached.value = false
  }

  function applyAccount(update: AccountUpdate) {
    syncQuota(update.quota)
    if (session.value) session.value = { ...session.value, sub2: update.sub2 }
    if (canGenerate(update.quota)) error.value = ''
  }

  async function refreshSession() {
    session.value = await studioApi.session()
    if (canGenerate(session.value.quota)) quotaReached.value = false
  }

  function upsertJob(job: Job) {
    jobs.value = [job, ...jobs.value.filter(row => row.id !== job.id)].sort((a, b) => b.createdAt - a.createdAt)
  }

  async function ensureSession() {
    if (session.value) return
    initialSession ??= refreshSession().catch(cause => {
      error.value = cause instanceof ApiError ? cause.message : '无法连接工作站，请刷新重试。'
    }).finally(() => { initialSession = undefined })
    return initialSession
  }

  async function refresh() {
    const { id } = doc.value
    const sequence = ++refreshSequence
    await ensureSession()
    try {
      const response = await studioApi.list(id)
      if (doc.value.id !== id || sequence !== refreshSequence) return
      const previous = new Map(jobs.value.map(job => [job.id, job.status]))
      jobs.value = response.jobs
      syncQuota(response.quota)
      const pending = doc.value.pendingSubmission
      if (pending && !submitting.value) {
        const received = response.jobs.find(job => job.requestKey === pending.key)
        if (received) {
          doc.value.requestedVersion = received.id
          doc.value.pendingSubmission = undefined
          checkedMissing.value = undefined
          error.value = ''
        } else if (Date.now() - pending.startedAt >= confirmationWait) {
          checkedMissing.value = pending.key
          error.value = '暂未找到这次任务。可以再次提交，工作台会先核对原请求。'
        }
      }
      const request = doc.value.requestedVersion
      const requested = response.jobs.find(job => job.id === request)
      const delivered = requested?.status === 'succeeded' ? requested
        : request ? undefined
        : response.jobs.find(job => job.status === 'succeeded' && ['running', 'uncertain'].includes(previous.get(job.id) ?? ''))
      if (delivered && !doc.value.keepVersion) doc.value.version = delivered.id
      if (requested?.status === 'succeeded' || requested?.status === 'failed') doc.value.requestedVersion = undefined
      if (session.value && !session.value.provider.demo && checkedDemoDraft !== id) {
        checkedDemoDraft = id
        if (active.value?.demo) {
          doc.value.version = response.jobs.find(job => !job.demo && job.status === 'succeeded')?.id
        }
      }
      if (!doc.value.version && !original.value && !doc.value.keepVersion) {
        doc.value.version = response.jobs.find(job => job.status === 'succeeded' && (!job.demo || session.value?.provider.demo))?.id
      }
    } catch { /* The next status check can recover a temporary failure. */ }
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    if (route.value !== 'editor' || (!busyJob.value && !uncertainJob.value && !checking.value)) return
    timer = setTimeout(async () => {
      await refresh()
      schedule()
    }, busyJob.value || checking.value ? 1100 : 5500)
  }

  function showRoute(next: 'gallery' | 'editor') {
    if (route.value === next) return
    if (route.value === 'gallery') galleryScroll = window.scrollY
    else local.flush()
    route.value = next
    if (next === 'gallery') void refreshSession().catch(() => {})
    void nextTick(() => {
      if (route.value === next) window.scrollTo({ top: next === 'gallery' ? galleryScroll : 0 })
    })
  }

  function navigate(next: 'gallery' | 'editor') {
    if (route.value === next) {
      window.scrollTo({ top: 0 })
      return
    }
    history.pushState({}, '', next === 'editor' ? '/studio' : '/')
    showRoute(next)
  }

  function openWork(work: StudioDocument) {
    local.flush()
    doc.value = work
    checkedDemoDraft = undefined
    checkedMissing.value = undefined
    jobs.value = []
    error.value = ''
    quotaReached.value = false
    navigate('editor')
    local.flush()
  }

  function create(item?: Case, prompt?: string, ratio?: Ratio, title?: string, intent?: StudioDocument['intent']) {
    const work = newDocument(item, prompt, ratio, title)
    if (intent) work.intent = intent
    openWork(work)
  }

  function resume(id: string) {
    if (doc.value.id === id) { navigate('editor'); return }
    const work = local.works.value.find(row => row.document.id === id)
    if (work) openWork(structuredClone(work.document))
  }

  async function importPicture(file: File) {
    const previous = doc.value.id
    await ensureSession()
    const { asset } = await studioApi.uploadMedia(file)
    if (doc.value.id !== previous || route.value !== 'gallery') return
    openWork({
      ...newDocument(), imported: asset, intent: 'edit-current',
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 64) || '导入图片',
    })
  }

  function selectVersion(id?: string) {
    doc.value.keepVersion = true
    doc.value.version = id
  }

  async function submit(prompt: string, selection?: MaskSelection | SelectedSubject, useCurrent = true) {
    if (submitting.value || busyJob.value || checking.value || referenceImages.busy.value) return false
    if (!prompt.trim()) { error.value = '先写一句你想做的图。'; return false }
    if (useCurrent && (doc.value.version ? !active.value?.asset : !image.value)) {
      error.value = '当前底图尚未就绪，请重新选择一个版本。'
      return false
    }
    if (caseInfo.value?.start === 'upload' && !referenceImages.references.value.length && !useCurrent) {
      error.value = '请先上传你要修改的原图。'
      return false
    }
    error.value = ''
    quotaReached.value = false
    submitting.value = true
    const draft = doc.value
    const references = [...referenceImages.references.value]
    const { id, ratio } = draft
    doc.value.keepVersion = false
    const requestKey = draft.pendingSubmission?.key ?? crypto.randomUUID()
    let sent = false
    const coverLayer = draft.slides?.[0]?.layer ?? draft.layer
    const base = useCurrent ? workingImage(image.value, coverLayer) : null
    const baseMedia = base?.url.match(/^\/api\/media\/([a-f0-9]{64})$/)?.[1]
    const baseAsset = base && !baseMedia ? active.value?.id : undefined
    const baseCase = base && !baseAsset && !baseMedia ? draft.caseId : undefined
    const framing = coverLayer.background
    try {
      await ensureSession()
      if (doc.value.id !== id) return false
      if (!draft.pendingSubmission && session.value && !canGenerate(session.value.quota)) {
        quotaReached.value = true
        return false
      }
      const pointMask = selection && 'kind' in selection && selection.kind === 'subject' ? selection : undefined
      const region = selection && (!('kind' in selection) || selection.kind === 'brush') ? selection : undefined
      const mask = base && region ? await createMask(base, frameAspect(ratio, base, framing, Boolean(draft.slides)), region, framing) : undefined
      if (doc.value.id !== id) return false
      checkedMissing.value = undefined
      doc.value.pendingSubmission = { key: requestKey, startedAt: Date.now() }
      local.flush()
      sent = true
      const result = await studioApi.submit({
        requestKey, document: id, prompt: prompt.trim(), ratio,
        intent: useCurrent ? 'edit-current' : 'create', baseAsset, baseCase, baseMedia, references, mask, pointMask,
      })
      syncQuota(result.quota)
      if (doc.value.id !== id) {
        local.updateBackgroundWork(id, work => ({
          ...work,
          pendingSubmission: undefined, requestedVersion: result.job.id,
        }))
        return true
      }
      refreshSequence++
      doc.value.pendingSubmission = undefined
      upsertJob(result.job)
      if (useCurrent && doc.value.editInstructions === draft.editInstructions) doc.value.editInstructions = ''
      if (result.job.asset && !doc.value.keepVersion) doc.value.version = result.job.id
      if (!result.job.asset) doc.value.requestedVersion = result.job.id
      schedule()
      return true
    } catch (cause) {
      if (doc.value.id !== id) {
        if (sent && cause instanceof ApiError && cause.code !== 'request_conflict' && cause.code !== 'internal') {
          local.updateBackgroundWork(id, work => ({ ...work, pendingSubmission: undefined }))
        }
        return false
      }
      if (!sent || (cause instanceof ApiError && cause.code !== 'request_conflict' && cause.code !== 'internal')) {
        if (sent) doc.value.pendingSubmission = undefined
        if (cause instanceof ApiError) quotaReached.value = ['guest_limit', 'member_limit', 'daily_limit'].includes(cause.code)
        error.value = cause instanceof Error ? cause.message : '这次提交未成功，请重试。'
      } else {
        error.value = confirmationMessage
      }
      return false
    } finally {
      submitting.value = false
      if (doc.value.id === id && checking.value) {
        await refresh()
        schedule()
      }
    }
  }

  function popState() { showRoute(location.pathname === '/studio' ? 'editor' : 'gallery') }
  watch([route, () => doc.value.id], async ([view]) => {
    if (timer) clearTimeout(timer)
    if (view === 'editor') {
      await refresh()
      schedule()
    }
  }, { immediate: true })
  onMounted(() => {
    priorScrollRestoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    window.addEventListener('popstate', popState)
    void ensureSession()
  })
  onUnmounted(() => {
    history.scrollRestoration = priorScrollRestoration
    window.removeEventListener('popstate', popState)
    if (timer) clearTimeout(timer)
  })

  return { route, doc, session, error, quotaReached, original, image, active, completed, busyJob,
    submitting, checking, referenceImages, timeline: computed(() => [...jobs.value].reverse()), navigate, create, resume, importPicture, selectVersion, submit, refresh,
    works: local.works, storageWarning: local.warning, flushDraft: local.flush,
    applyAccount, refreshSession }
}
