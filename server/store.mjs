import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { openEntitlements } from './entitlements.mjs'

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
export const beijingDay = (now = new Date()) => dayFormatter.format(now)

export class StudioError extends Error {
  constructor(status, message, code = 'studio_error') {
    super(message)
    this.status = status
    this.code = code
  }
}

export function sessionToken() {
  return randomBytes(32).toString('base64url')
}

export function sessionOwner(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function openStore(dbPath, { daily = 5, globalDaily = 100, addressDaily = 25, concurrency = 2 } = {}) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout = 4000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec(
    "CREATE TABLE IF NOT EXISTS jobs (" +
    "id TEXT PRIMARY KEY, owner TEXT NOT NULL, day TEXT NOT NULL, request_key TEXT NOT NULL," +
    "fingerprint TEXT NOT NULL, document TEXT NOT NULL, prompt TEXT NOT NULL, ratio TEXT NOT NULL, " +
    "mode TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', " +
    "created INTEGER NOT NULL, updated INTEGER NOT NULL, width INTEGER, height INTEGER," +
    "UNIQUE(owner, request_key));" +
    "CREATE INDEX IF NOT EXISTS jobs_owner_document ON jobs(owner, document, created); " +
    "CREATE INDEX IF NOT EXISTS jobs_quota ON jobs(day, status);"
  )
  const entitlements = openEntitlements(db)
  db.exec('CREATE TABLE IF NOT EXISTS studio_runtime (name TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare("INSERT OR IGNORE INTO studio_runtime VALUES('address_secret', ?)").run(sessionToken())
  const addressSecret = db.prepare("SELECT value FROM studio_runtime WHERE name='address_secret'").get().value
  const fields = db.prepare('PRAGMA table_info(jobs)').all()
  if (!fields.some(field => field.name === 'base_reference')) db.exec("ALTER TABLE jobs ADD COLUMN base_reference TEXT NOT NULL DEFAULT ''")
  if (!fields.some(field => field.name === 'account')) db.exec('ALTER TABLE jobs ADD COLUMN account TEXT')
  if (!fields.some(field => field.name === 'member_debit')) {
    db.exec('ALTER TABLE jobs ADD COLUMN member_debit INTEGER NOT NULL DEFAULT 0; UPDATE jobs SET member_debit=1 WHERE account IS NOT NULL;')
  }
  if (!fields.some(field => field.name === 'guest_address')) db.exec("ALTER TABLE jobs ADD COLUMN guest_address TEXT NOT NULL DEFAULT ''")
  if (!fields.some(field => field.name === 'demo')) db.exec('ALTER TABLE jobs ADD COLUMN demo INTEGER NOT NULL DEFAULT 0')
  for (const name of ['requested_model', 'requested_size', 'resolution']) {
    if (!fields.some(field => field.name === name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`)
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS jobs_account_day ON jobs(account, day) WHERE account IS NOT NULL;
    CREATE INDEX IF NOT EXISTS jobs_trial_address_day ON jobs(guest_address, day) WHERE member_debit=0;
  `)
  db.prepare("UPDATE jobs SET status = 'uncertain', stage = '等待确认', error = ?, updated = ? WHERE status = 'running'")
    .run('工作站已恢复，正在等待原任务的结果。', Date.now())

  const getOwner = db.prepare('SELECT * FROM jobs WHERE id = ? AND owner = ?')
  const get = db.prepare('SELECT * FROM jobs WHERE id = ?')
  const byRequest = db.prepare('SELECT * FROM jobs WHERE owner = ? AND request_key = ?')
  const countGuest = db.prepare("SELECT count(*) AS n FROM jobs WHERE (owner = ? OR account = ?) AND day = ? AND member_debit = 0 AND demo = ? AND status <> 'failed'")
  const countAddress = db.prepare("SELECT count(*) AS n FROM jobs WHERE guest_address = ? AND day = ? AND member_debit = 0 AND demo = ? AND status <> 'failed'")
  const countGlobal = db.prepare("SELECT count(*) AS n FROM jobs WHERE day = ? AND demo = ? AND member_debit = 0 AND status <> 'failed'")
  const guestActive = db.prepare("SELECT count(*) AS n FROM jobs WHERE (owner = ? OR account = ?) AND status = 'running'")
  const countActive = db.prepare("SELECT count(*) AS n FROM jobs WHERE status = 'running'")
  const list = db.prepare('SELECT * FROM jobs WHERE owner = ? AND document = ? ORDER BY created DESC LIMIT 40')
  const add = db.prepare(`INSERT INTO jobs (
    id, owner, day, request_key, fingerprint, document, prompt, ratio, mode, status, stage, created, updated,
    base_reference, requested_model, requested_size, resolution, demo, account, member_debit, guest_address
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  function quota(owner, demo = false, address = '') {
    const date = beijingDay()
    const member = demo ? undefined : entitlements.member(owner)
    return {
      mode: member ? 'member' : 'guest',
      ...(member ? { memberRemaining: member.remaining } : {}),
      limit: daily,
      remaining: Math.max(0, daily - countGuest.get(owner, member?.id ?? null, date, Number(demo)).n),
      resetTime: '北京时间 00:00',
      available: countGlobal.get(date, Number(demo)).n < globalDaily &&
        (!address || !addressDaily || countAddress.get(address, date, Number(demo)).n < addressDaily),
    }
  }

  function accept(owner, input) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const previous = byRequest.get(owner, input.requestKey)
      if (previous) {
        if (previous.fingerprint !== input.fingerprint) throw new StudioError(409, '这次提交已对应另一项任务，请重新发起。', 'request_conflict')
        db.exec('COMMIT')
        return { row: previous, created: false }
      }
      const date = beijingDay()
      const remaining = quota(owner, input.demo, input.address)
      const member = input.demo ? undefined : entitlements.member(owner)
      const free = remaining.available && remaining.remaining > 0
      if (!free && member && !member.remaining) throw new StudioError(429, '图张已用完，可邀请好友或购买图张。', 'member_limit')
      if (!free && !member) {
        if (!remaining.remaining) throw new StudioError(429, '今天的游客次数已用完。', 'guest_limit')
        throw new StudioError(429, '当前的免费试用名额已用完。', 'daily_limit')
      }
      if (guestActive.get(owner, member?.id ?? null).n) throw new StudioError(409, '上一张图正在生成，完成后可以继续。', 'guest_busy')
      if (countActive.get().n >= concurrency) throw new StudioError(503, '工作站正忙，请稍后再试。', 'busy')
      const charged = !free && Boolean(member)
      if (charged && !entitlements.reserve(member.id)) {
        throw new StudioError(429, '图张已用完，请补充额度。', 'member_limit')
      }
      const id = randomUUID()
      const now = Date.now()
      add.run(id, owner, date, input.requestKey, input.fingerprint, input.document, input.prompt, input.ratio, input.mode,
        'running', '正在提交', now, now, input.baseReference || '', input.requestedModel || '', input.requestedSize || '',
        input.resolution || '', Number(Boolean(input.demo)), member?.id ?? null, Number(charged), input.address || '')
      const row = get.get(id)
      db.exec('COMMIT')
      return { row, created: true }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function stage(id, value) {
    db.prepare("UPDATE jobs SET stage = ?, updated = ? WHERE id = ? AND status = 'running'").run(value, Date.now(), id)
  }

  function finish(id, status, error = '', size = {}) {
    const labels = { succeeded: '已完成', failed: '本次未出图', uncertain: '等待确认' }
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = get.get(id)
      if (row && ['running', 'uncertain'].includes(row.status)) {
        db.prepare(
          "UPDATE jobs SET status=?, stage=?, error=?, updated=?, width=?, height=? WHERE id=?"
        ).run(status, labels[status], error, Date.now(), size.width ?? null, size.height ?? null, id)
        if (row.account) entitlements.finishImage(row.account, Boolean(row.member_debit), status)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return { accept, quota, entitlements,
    addressKey: address => address ? createHmac('sha256', addressSecret).update(beijingDay() + '|' + address).digest('hex') : '',
    getForOwner: (id, owner) => getOwner.get(id, owner), list: (owner, document) => list.all(owner, document),
    stage, finish, close: () => db.close(),
  }
}

export function publicJob(row) {
  return {
    id: row.id, requestKey: row.request_key, demo: Boolean(row.demo), status: row.status, stage: row.stage, error: row.error,
    prompt: row.prompt, ratio: row.ratio, mode: row.mode, createdAt: row.created, baseReference: row.base_reference || null,
    requestedModel: row.requested_model || null, requestedSize: row.requested_size || null, resolution: row.resolution || null,
    asset: row.status === 'succeeded'
      ? { url: '/api/assets/' + row.id, width: row.width, height: row.height }
      : null,
  }
}
