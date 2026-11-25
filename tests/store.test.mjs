import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { beijingDay, openStore, publicJob, sessionOwner, sessionToken } from '../server/store.mjs'

const request = (requestKey, overrides = {}) => ({
  requestKey, fingerprint: requestKey, document: 'draft', prompt: '咖啡产品图',
  ratio: 'square', mode: 'generate', ...overrides,
})

test('提交去重、明确失败退回，成功和待确认保留次数', () => {
  const store = openStore(':memory:', { daily: 2 })
  const owner = sessionOwner(sessionToken())
  try {
    const accepted = store.accept(owner, request('a'))
    assert.equal(store.quota(owner).remaining, 1)
    const repeated = store.accept(owner, request('a'))
    assert.equal(repeated.created, false)
    assert.equal(repeated.row.id, accepted.row.id)
    assert.throws(() => store.accept(owner, request('a', { fingerprint: 'changed' })), { code: 'request_conflict' })
    assert.throws(() => store.accept(owner, request('b')), { code: 'guest_busy' })
    store.finish(accepted.row.id, 'failed', '无法出图')
    assert.equal(store.quota(owner).remaining, 2)

    const completed = store.accept(owner, request('b')).row
    store.finish(completed.id, 'succeeded', '', { width: 1024, height: 1024 })
    const unknown = store.accept(owner, request('c')).row
    store.finish(unknown.id, 'uncertain', '稍后确认')
    assert.equal(store.quota(owner).remaining, 0)
    assert.throws(() => store.accept(owner, request('d')), { code: 'guest_limit' })
    assert.equal(store.getForOwner(completed.id, sessionOwner(sessionToken())), undefined)
    assert.deepEqual(publicJob(store.getForOwner(completed.id, owner)).asset, { url: '/api/assets/' + completed.id, width: 1024, height: 1024 })
  } finally { store.close() }
})

test('全站名额限制按北京时间日期独立计算', () => {
  assert.equal(beijingDay(new Date('2026-11-23T15:59:59Z')), '2026-11-23')
  assert.equal(beijingDay(new Date('2026-11-23T16:00:00Z')), '2026-11-24')
  const store = openStore(':memory:', { daily: 5, globalDaily: 1 })
  try {
    const first = store.accept('first', request('a')).row
    assert.throws(() => store.accept('second', request('b')), { code: 'daily_limit' })
    store.finish(first.id, 'failed')
    assert.equal(store.accept('second', request('b')).created, true)
  } finally { store.close() }
})

test('演示出图与正式试用额度独立，历史保留示例标记', () => {
  const store = openStore(':memory:', { daily: 1, globalDaily: 1 })
  try {
    const sample = store.accept('visitor', request('demo', { demo: true })).row
    store.finish(sample.id, 'succeeded', '', { width: 600, height: 400 })
    assert.equal(store.quota('visitor', true).remaining, 0)
    assert.equal(store.quota('visitor').remaining, 1)
    assert.equal(store.quota('second').available, true)
    const actual = store.accept('visitor', request('real')).row
    assert.equal(store.quota('visitor').remaining, 0)
    assert.equal(publicJob(store.getForOwner(sample.id, 'visitor')).demo, true)
    assert.equal(publicJob(actual).demo, false)
  } finally { store.close() }
})

test('邮箱注册和首图奖励只到账一次，付费图张失败退回', () => {
  const store = openStore(':memory:', { daily: 1, globalDaily: 1 })
  const { entitlements: accounts } = store
  const link = (owner, id, extra = {}) => {
    const state = accounts.start(owner)
    const identity = { id, credential: sessionToken(), verifiedSignup: true, ...extra }
    assert.equal(accounts.claim('other-browser', state, identity), false)
    assert.equal(accounts.claim(owner, state, identity), true)
    assert.equal(accounts.claim(owner, state, identity), false)
  }
  try {
    link('referrer', '1', { verifiedSignup: false })
    link('friend', '2', { inviter: '1' })
    link('friend-other-tab', '2', { inviter: '1' })
    assert.equal(store.quota('friend').memberRemaining, 5)
    assert.equal(store.quota('referrer').memberRemaining, 0)
    const image = store.accept('friend', request('first')).row
    assert.equal(image.member_debit, 0)
    assert.throws(() => store.accept('friend-other-tab', request('second')), { code: 'guest_busy' })
    store.finish(image.id, 'uncertain')
    assert.equal(store.quota('referrer').memberRemaining, 0)
    store.finish(image.id, 'succeeded')
    store.finish(image.id, 'succeeded')
    assert.equal(store.quota('referrer').memberRemaining, 5)
    const paidImage = store.accept('friend-other-tab', request('second')).row
    assert.equal(paidImage.member_debit, 1)
    assert.equal(store.quota('friend').memberRemaining, 4)
    store.finish(paidImage.id, 'failed')
    store.finish(paidImage.id, 'failed')
    assert.equal(store.quota('friend').memberRemaining, 5)
    link('friend', '2', { inviter: '1' })
    assert.equal(store.quota('referrer').memberRemaining, 5)
    assert.equal(store.quota('friend').memberRemaining, 5)
  } finally { store.close() }
})

test('购买回执绑定订单和账户，重复回执只到账一次', () => {
  const store = openStore(':memory:')
  const { entitlements: accounts } = store
  try {
    const state = accounts.start('visitor')
    accounts.claim('visitor', state, { id: '7', credential: sessionToken() })
    const pack = { id: 'starter', images: 10, cents: 100 }
    const order = accounts.startOrder('7', randomUUID(), pack)
    assert.equal(accounts.startOrder('7', randomUUID(), pack).id, order.id)
    const receipt = { id: order.id, account: '7', package: pack.id, images: 10, cents: 100 }
    for (const mismatch of [{ cents: 50 }, { account: '2' }, { images: 20 }]) {
      assert.throws(() => accounts.creditOrder('7', order, { ...receipt, ...mismatch }), /Mismatched wallet receipt/)
    }
    assert.equal(store.quota('visitor').memberRemaining, 0)
    assert.equal(accounts.creditOrder('7', order, receipt), 10)
    assert.equal(accounts.creditOrder('7', order, receipt), 10)
    assert.equal(accounts.pendingOrder('7'), undefined)
  } finally { store.close() }
})
