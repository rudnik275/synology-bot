import { createHmac } from 'node:crypto'

export const TEST_BOT_TOKEN = '123456:TEST_TOKEN_abcdef'

/** Build a correctly-signed initData query string for the given decoded fields. */
export function signInitData(fields: Record<string, string>, botToken = TEST_BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')
  const secretKey = new Uint8Array(createHmac('sha256', 'WebAppData').update(botToken).digest())
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  const params = new URLSearchParams(fields)
  params.set('hash', hash)
  return params.toString()
}

/** Convenience: a signed initData for a user with the given id (default 42). */
export function buildInitData(opts: { id?: number; authDate?: number; botToken?: string } = {}): string {
  return signInitData(
    {
      auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
      query_id: 'AAEtest',
      user: JSON.stringify({ id: opts.id ?? 42, first_name: 'Owner', username: 'owner' }),
    },
    opts.botToken ?? TEST_BOT_TOKEN
  )
}
