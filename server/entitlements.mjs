import { randomBytes } from 'node:crypto'

const signupImages = 5
const referralImages = 5
const linkDuration = 12 * 60 * 60 * 1000
const attemptDuration = 30 * 60 * 1000

export function openEntitlements(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_accounts (
      id TEXT PRIMARY KEY, remaining INTEGER NOT NULL DEFAULT 0 CHECK(remaining >= 0),
      signup_reward INTEGER NOT NULL DEFAULT 0, inviter TEXT, first_image INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS studio_auth_attempts (
      state TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_sessions (
      owner TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES studio_accounts(id), credential TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studio_wallet_orders (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES studio_accounts(id),
      package TEXT NOT NULL, images INTEGER NOT NULL CHECK(images > 0), cents INTEGER NOT NULL CHECK(cents > 0),
      status TEXT NOT NULL CHECK(status IN ('pending','credited','rejected')),
      created INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS studio_one_pending_order
      ON studio_wallet_orders(account) WHERE status='pending';
  `)

  const account = db.prepare('SELECT * FROM studio_accounts WHERE id=?')
  const addAccount = db.prepare('INSERT OR IGNORE INTO studio_accounts(id) VALUES(?)')
  const session = db.prepare(`
    SELECT a.*, s.credential FROM studio_sessions s JOIN studio_accounts a ON a.id=s.account
    WHERE s.owner=? AND s.expires>?
  `)
  const setSession = db.prepare(`
    INSERT INTO studio_sessions VALUES(?,?,?,?) ON CONFLICT(owner)
    DO UPDATE SET account=excluded.account, credential=excluded.credential, expires=excluded.expires
  `)
  const getState = db.prepare('SELECT 1 FROM studio_auth_attempts WHERE owner=? AND state=? AND expires>?')
  const deleteState = db.prepare('DELETE FROM studio_auth_attempts WHERE owner=? AND state=? AND expires>?')
  const signup = db.prepare('UPDATE studio_accounts SET signup_reward=?, remaining=remaining+?, inviter=? WHERE id=? AND signup_reward=0')
  const credit = db.prepare('UPDATE studio_accounts SET remaining=remaining+? WHERE id=?')
  const reserveImage = db.prepare('UPDATE studio_accounts SET remaining=remaining-1 WHERE id=? AND remaining>0')
  const firstImage = db.prepare('UPDATE studio_accounts SET first_image=1 WHERE id=? AND first_image=0 AND signup_reward>0')
  const pending = db.prepare("SELECT * FROM studio_wallet_orders WHERE account=? AND status='pending'")
  const getOrder = db.prepare("SELECT * FROM studio_wallet_orders WHERE account=? AND id=?")
  const createOrder = db.prepare("INSERT INTO studio_wallet_orders VALUES(?,?,?,?,?,'pending',?)")
  const setOrderStatus = db.prepare("UPDATE studio_wallet_orders SET status=? WHERE id=? AND account=? AND status='pending'")

  function atomic(callback) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = callback()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function start(owner) {
    const now = Date.now()
    db.prepare('DELETE FROM studio_auth_attempts WHERE expires<=?').run(now)
    db.prepare('DELETE FROM studio_sessions WHERE expires<=?').run(now)
    const state = randomBytes(32).toString('base64url')
    db.prepare('INSERT INTO studio_auth_attempts VALUES(?,?,?)').run(state, owner, now + attemptDuration)
    return state
  }

  function claim(owner, state, identity) {
    return atomic(() => {
      const now = Date.now()
      if (!deleteState.run(owner, state, now).changes) return false
      addAccount.run(identity.id)
      if (identity.verifiedSignup) {
        const inviter = identity.inviter && identity.inviter !== identity.id ? identity.inviter : null
        if (inviter) addAccount.run(inviter)
        signup.run(signupImages, signupImages, inviter, identity.id)
      }
      setSession.run(owner, identity.id, identity.credential, now + linkDuration)
      return true
    })
  }

  function finishImage(id, charged, status) {
    if (status === 'failed' && charged) credit.run(1, id)
    if (status !== 'succeeded' || !firstImage.run(id).changes) return
    const { inviter } = account.get(id)
    if (inviter) credit.run(referralImages, inviter)
  }

  function startOrder(id, orderID, pack) {
    return atomic(() => {
      const replay = getOrder.get(id, orderID)
      if (replay) return replay
      const existing = pending.get(id)
      if (existing) return existing
      createOrder.run(orderID, id, pack.id, pack.images, pack.cents, Date.now())
      return pending.get(id)
    })
  }

  function creditOrder(id, order, receipt) {
    if (receipt.id !== order.id || receipt.account !== id || receipt.package !== order.package ||
        receipt.images !== order.images || receipt.cents !== order.cents) {
      throw new Error('Mismatched wallet receipt')
    }
    return atomic(() => {
      if (setOrderStatus.run('credited', order.id, id).changes) credit.run(order.images, id)
      return account.get(id).remaining
    })
  }

  return {
    start, claim, allows: (owner, state) => Boolean(getState.get(owner, state, Date.now())),
    member: owner => session.get(owner, Date.now()),
    unlink: (owner, credential) => db.prepare('DELETE FROM studio_sessions WHERE owner=? AND credential=?').run(owner, credential),
    reserve: id => Boolean(reserveImage.run(id).changes), finishImage,
    pendingOrder: id => pending.get(id), order: (id, orderID) => getOrder.get(id, orderID), startOrder, creditOrder,
    rejectOrder: (id, order) => setOrderStatus.run('rejected', order, id),
  }
}
