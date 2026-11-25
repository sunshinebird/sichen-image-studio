import type { MaskPoint, Rect } from './geometry'
import type { CaseId, CasePage, Clarity, Ratio } from './catalog'

export interface Quota {
  mode: 'guest' | 'member'
  memberRemaining?: number
  limit: number
  remaining: number
  resetTime: string
  available: boolean
}
export interface StudioAccount {
  enabled: boolean
  origin: string | null
  linked: boolean
  login: string | null
  register: string | null
  wallet: string | null
}
export interface WalletPack { id: string; images: number; cents: number }
export interface WalletOrder { id: string; package: string; images: number; cents: number }
export interface Wallet { balance: number; packages: WalletPack[]; invite: string | null; purchasePending: WalletOrder | null }
export interface AccountUpdate { sub2: StudioAccount; quota: Quota }
export const canGenerate = (quota: Quota) => (quota.memberRemaining ?? 0) > 0 || (quota.available && quota.remaining > 0)
export interface Session {
  quota: Quota
  provider: { ready: boolean; demo: boolean }
  editor?: { text: boolean; subject: boolean; fill?: boolean }
  generation: { model: string; quality: 'high' }
  sub2: StudioAccount
  github: string | null
}
export interface ImageAsset { url: string; width: number; height: number }
export interface ReferenceImage { asset: ImageAsset; name: string }
export interface DetectedText { text: string; box: Rect; score: number }
export interface SubjectPoint extends MaskPoint { include: boolean }
export interface SubjectCandidate { box: Rect; area: number; preview: string }
export interface SelectedSubject { kind: 'subject'; source: string; token: string; index: number }
export interface TextRepair { asset: ImageAsset; box: Rect; fill: string; angle: number }
export interface Job {
  id: string
  requestKey?: string
  status: 'running' | 'succeeded' | 'failed' | 'uncertain'
  stage: string
  error: string
  prompt: string
  ratio: Ratio
  mode: 'edit' | 'generate'
  baseReference: string | null
  createdAt: number
  requestedModel: string | null
  requestedSize: string | null
  resolution: Clarity | null
  demo: boolean
  asset: ImageAsset | null
}

export class ApiError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' })
  let result
  try { result = await response.json() }
  catch { throw new Error('暂时无法读取服务响应。') }
  if (!response.ok) throw new ApiError(result.error?.message ?? '工作站暂时不可用。', result.error?.code ?? 'request_failed')
  return result as T
}
function vision<T>(source: string, operation: string, input = {}, signal?: AbortSignal) {
  return request<T>('/api/vision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, source, ...input }), signal,
  })
}
const post = <T>(path: string, value: object) => request<T>('/api/account/' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
})

export const studioApi = {
  scanText: (source: string, signal?: AbortSignal) =>
    vision<{ token: string; lines: DetectedText[] }>(source, 'scan', {}, signal),
  repairText: (source: string, token: string, index: number, signal?: AbortSignal) =>
    vision<TextRepair>(source, 'text', { token, index }, signal),
  selectSubject: (source: string, points: SubjectPoint[], signal?: AbortSignal) =>
    vision<{ token: string; candidates: SubjectCandidate[] }>(source, 'subject', { points }, signal),
  extractSubject: (source: string, token: string, index: number, fill: boolean, signal?: AbortSignal) =>
    vision<{ asset: ImageAsset; box: Rect; background?: ImageAsset }>(source, fill ? 'lift' : 'extract', { token, index }, signal),
  cases: (params: URLSearchParams, signal?: AbortSignal) => request<CasePage>('/api/cases?' + params.toString(), { signal }),
  uploadMedia: (file: File) => request<{ asset: ImageAsset }>('/api/media', { method: 'POST', body: file }),
  session: () => request<Session>('/api/session'),
  startAccount: (mode: 'login' | 'register' | 'embed', page: 'editor' | 'gallery', referral?: string) =>
    post<{ state?: string; url?: string }>('start', { mode, page, referral }),
  completeAccount: (code: string, state: string) => post<AccountUpdate>('complete', { code, state }),
  unlinkAccount: () => post<AccountUpdate>('logout', {}),
  accountWallet: () => request<AccountUpdate & { wallet: Wallet }>('/api/account/wallet'),
  accountPurchase: (id: string, pack?: WalletPack) => post<AccountUpdate & { images: number }>('order', { id, pack }),
  list: (doc: string) => request<{ jobs: Job[]; quota: Quota }>('/api/jobs?document=' + encodeURIComponent(doc)),
  poll: (id: string) => request<{ job: Job; quota: Quota }>('/api/jobs/' + encodeURIComponent(id)),
  submit(input: {
    requestKey: string; document: string; prompt: string; ratio: Ratio; intent: 'edit-current' | 'create'; baseAsset?: string; baseCase?: CaseId;
    references: ReferenceImage[]; mask?: Blob; baseMedia?: string; pointMask?: SelectedSubject
  }) {
    const form = new FormData()
    for (const key of ['requestKey', 'document', 'prompt', 'ratio', 'intent', 'baseAsset', 'baseCase', 'baseMedia'] as const) {
      const value = input[key]
      if (value) form.set(key, value)
    }
    for (const reference of input.references) {
      const id = reference.asset.url.match(/^\/api\/media\/([a-f0-9]{64})$/)?.[1]
      if (id) form.append('referenceMedia', id)
    }
    if (input.pointMask) form.set('pointMask', JSON.stringify(input.pointMask))
    if (input.mask) form.append('mask', input.mask, 'mask.png')
    return request<{ job: Job; quota: Quota }>('/api/jobs', { method: 'POST', body: form })
  },
}
