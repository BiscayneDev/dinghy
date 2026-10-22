import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase before importing the modules under test (repo convention).
const fromMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: fromMock }),
}))

// paybox.ts / paybox-checkout.ts pull the PayBox SDK → @solana/web3.js
// (ERR_REQUIRE_ESM under vitest, the pre-existing baseline failure class).
// Mock the integration so only the tool definitions load.
const sdkMock = vi.hoisted(() => ({
  getRequest: vi.fn(),
  requestPayment: vi.fn(),
  requestAccountChange: vi.fn(),
}))
vi.mock('@/lib/integrations/paybox', () => ({
  isPayboxConnected: (ctx: { tokens: Record<string, unknown> }) => Boolean(ctx.tokens.paybox),
  payboxRequired: (action: string) => ({ success: false, error: `Paybox is required for ${action}` }),
  getPayboxSdk: vi.fn(async () => sdkMock),
  getPayboxAccessToken: vi.fn(async () => 'test-access-token'),
  getPayboxApiUrl: () => 'https://api.paybox.sh',
  agentResultToTool: (resp: { request_id?: string; status: string; output?: { value?: unknown } | null; approval_id?: string | null; error?: string | null }) => {
    if (resp.status === 'success') return { success: true, data: { status: 'success', output: resp.output?.value ?? null } }
    if (resp.status === 'pending_approval') return { success: true, data: { status: 'pending_approval', request_id: resp.request_id, approval_id: resp.approval_id ?? null } }
    if (resp.status === 'denied') return { success: false, error: `Denied: ${resp.error ?? ''}` }
    return { success: false, error: resp.error ?? 'Paybox returned an error' }
  },
}))

import {
  payboxCompleteCheckout,
  checkoutStartUrl,
  outputHasCard,
  claimAndCheckoutCommand,
} from '@/lib/tools/paybox-checkout'
import { payboxRequestPayment, payboxManageAccess } from '@/lib/tools/paybox'
import {
  checkoutAllowedHosts,
  scrubCardLike,
  CHECKOUT_GUARD,
  BROWSER_BOOTSTRAP,
  payboxCliSetupCommand,
  ensurePayboxCli,
} from '@/lib/computer/browser'
import { getProvider, MockManager } from '@/lib/computer/manager'
import type { UserContext } from '@/lib/llm/types'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const REQUEST = {
  request_id: 'req_abc123',
  user_id: USER_ID,
  credential_id: 'cred_card_1',
  merchant: 'acme',
  merchant_url: 'https://acme.example',
  amount_cents: 2599,
  currency: 'USD',
  status: 'issued',
}

function ctx(paybox = true): UserContext {
  return {
    userId: USER_ID,
    telegramId: 0,
    telegramChatId: 0,
    chatGuid: 'iMessage;-;+15551234567',
    name: '',
    timezone: 'UTC',
    tokens: paybox ? { paybox: { accessToken: 'tok', refreshToken: null, expiresAt: null } } : {},
  } as unknown as UserContext
}

// ---- flexible supabase fake (mirrors computer-browser.test.ts) -------------

interface Row { [k: string]: unknown }

function setDb(tables: Record<string, Row[]>) {
  const inserts: { table: string; row: Row }[] = []
  const upserts: { table: string; row: Row }[] = []
  const impl = (table: string) => {
    const rows = tables[table] ?? (tables[table] = [])
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gte: () => builder,
      update: () => builder,
      insert: (row: Row) => {
        inserts.push({ table, row })
        rows.push({ id: `row-${inserts.length}`, ...row })
        return builder
      },
      upsert: (row: Row) => {
        upserts.push({ table, row })
        rows.push(row)
        return builder
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    }
    return builder
  }
  fromMock.mockImplementation(impl)
  return { inserts, upserts }
}

beforeEach(() => {
  process.env.E2B_SANDBOX_MOCK = '1'
  delete process.env.E2B_API_KEY
  sdkMock.getRequest.mockReset()
  sdkMock.requestPayment.mockReset()
  sdkMock.requestAccountChange.mockReset()
})

// ---- pure helpers -----------------------------------------------------------

describe('checkoutStartUrl (origin guard)', () => {
  it('defaults to the recorded merchant URL', () => {
    expect(checkoutStartUrl('https://acme.example')).toEqual({ url: 'https://acme.example', host: 'acme.example' })
  })

  it('accepts a start URL on the bound origin or a subdomain', () => {
    expect(checkoutStartUrl('https://acme.example', 'https://acme.example/cart')).toEqual({ url: 'https://acme.example/cart', host: 'acme.example' })
    const sub = checkoutStartUrl('https://acme.example', 'https://shop.acme.example/checkout')
    expect(sub).toEqual({ url: 'https://shop.acme.example/checkout', host: 'acme.example' })
  })

  it('refuses a start URL off the bound origin', () => {
    const r = checkoutStartUrl('https://acme.example', 'https://evil.example/checkout')
    expect('error' in r && r.error).toContain('bound to https://acme.example')
  })

  it('refuses non-https merchant URLs', () => {
    expect('error' in checkoutStartUrl('http://acme.example') && true).toBe(true)
  })
})

describe('checkoutAllowedHosts', () => {
  it('locks to the merchant apex + subdomains plus payment infra', () => {
    const hosts = checkoutAllowedHosts('acme.example')
    expect(hosts[0]).toBe('acme.example')
    expect(hosts[1]).toBe('*.acme.example')
    expect(hosts).toContain('*.stripe.com')
  })
})

describe('outputHasCard', () => {
  it('detects card details in a request output', () => {
    expect(outputHasCard({ number: '4111', cvv: '123' })).toBe(true)
    expect(outputHasCard({ pan: '4111' })).toBe(true)
    expect(outputHasCard({ redacted: true })).toBe(false)
    expect(outputHasCard(null)).toBe(false)
    expect(outputHasCard('4111')).toBe(false)
  })
})

describe('scrubCardLike', () => {
  it('redacts PAN-shaped digit runs, keeps order ids', () => {
    expect(scrubCardLike('card 4111 1111 1111 1111 ok')).toBe('card [card number redacted] ok')
    expect(scrubCardLike('card 4111-1111-1111-1111 ok')).toBe('card [card number redacted] ok')
    expect(scrubCardLike('order A-8217 confirmed, $25.99')).toBe('order A-8217 confirmed, $25.99')
  })
})

describe('claimAndCheckoutCommand', () => {
  it('claims into a RAM file, runs the checkout, always deletes', () => {
    const cmd = claimAndCheckoutCommand('req_1', '/dev/shm/paybox-card-req_1.json', 'RUN_BROWSER')
    expect(cmd).toContain('paybox --json claim req_1')
    expect(cmd).toContain('CARD_FILE="/dev/shm/paybox-card-req_1.json"')
    expect(cmd).toContain('exit 3') // claim failure is distinguishable
    expect(cmd.indexOf('rm -f "$CARD_FILE"')).toBeGreaterThan(-1)
    expect(cmd).toContain('RUN_BROWSER')
  })
})

// ---- the tool ---------------------------------------------------------------

describe('paybox_complete_checkout', () => {
  it('refuses without a PayBox connection', async () => {
    const res = await payboxCompleteCheckout.execute({ requestId: 'req_abc123', task: 'buy the thing' }, ctx(false))
    expect(res.success).toBe(false)
    expect(String(res.error)).toMatch(/paybox/i)
  })

  it('refuses a request id Dinghy never issued', async () => {
    setDb({ paybox_payment_requests: [] })
    const res = await payboxCompleteCheckout.execute({ requestId: 'req_nope', task: 'buy' }, ctx())
    expect(res.success).toBe(false)
    expect(String(res.error)).toContain('paybox_request_payment')
    expect(sdkMock.getRequest).not.toHaveBeenCalled()
  })

  it('tells the user to approve first when still pending_approval', async () => {
    setDb({ paybox_payment_requests: [{ ...REQUEST }] })
    sdkMock.getRequest.mockResolvedValue({ request_id: 'req_abc123', status: 'pending_approval', output: null, approval_id: 'ap_1', error: null })
    const res = await payboxCompleteCheckout.execute({ requestId: 'req_abc123', task: 'buy' }, ctx())
    expect(res.success).toBe(false)
    expect(String(res.error)).toContain('not approved')
  })

  it('fails plainly on a denied request', async () => {
    setDb({ paybox_payment_requests: [{ ...REQUEST }] })
    sdkMock.getRequest.mockResolvedValue({ request_id: 'req_abc123', status: 'denied', output: null, approval_id: null, error: 'user declined' })
    const res = await payboxCompleteCheckout.execute({ requestId: 'req_abc123', task: 'buy' }, ctx())
    expect(res.success).toBe(false)
    expect(String(res.error)).toContain('denied')
  })

  it('claimed path: sandbox runs paybox claim + guarded checkout, token in env only', async () => {
    setDb({
      paybox_payment_requests: [{ ...REQUEST }],
      computer_settings: [{ user_id: USER_ID, enabled: true }],
    })
    sdkMock.getRequest.mockResolvedValue({ request_id: 'req_abc123', status: 'success', output: null, approval_id: 'ap_1', error: null })
    const res = await payboxCompleteCheckout.execute(
      { requestId: 'req_abc123', task: 'place the order', startUrl: 'https://acme.example/checkout' },
      ctx()
    )
    const provider = getProvider() as MockManager
    const last = provider.lastRun
    expect(last).toBeTruthy()
    const command = last!.command
    // the claim runs inside the sandbox, output to a RAM-backed file
    expect(command).toContain('paybox --json claim req_abc123')
    expect(command).toContain('/dev/shm/paybox-card-req_abc123.json')
    // the browser run is origin-locked to the bound merchant
    expect(command).toContain('acme.example')
    expect(command).toContain('"read_only":false')
    expect(command).toContain('"checkout":true')
    // the access token is per-run env, never in the command text
    expect(command).not.toContain('test-access-token')
    expect(last!.opts?.envs?.PAYBOX_ACCESS_TOKEN).toBe('test-access-token')
    expect(last!.opts?.envs?.PAYBOX_API_URL).toBe('https://api.paybox.sh')
    void res
  })

  it('autonomous path: card already in the request output goes via env, no claim', async () => {
    setDb({
      paybox_payment_requests: [{ ...REQUEST }],
      computer_settings: [{ user_id: USER_ID, enabled: true }],
    })
    sdkMock.getRequest.mockResolvedValue({
      request_id: 'req_abc123',
      status: 'success',
      output: { value: { number: '4111 1111 1111 1111', cvv: '123', exp_month: 12, exp_year: 2030 } },
      approval_id: null,
      error: null,
    })
    const res = await payboxCompleteCheckout.execute({ requestId: 'req_abc123', task: 'place the order' }, ctx())
    const provider = getProvider() as MockManager
    const last = provider.lastRun!
    expect(last.command).not.toContain('paybox --json claim')
    expect(last.command).not.toContain('4111')
    expect(last.opts?.envs?.PAYBOX_CARD_JSON).toContain('4111 1111 1111 1111')
    expect(last.opts?.envs?.PAYBOX_ACCESS_TOKEN).toBeUndefined()
    // nothing card-shaped leaks into the tool result
    expect(JSON.stringify(res)).not.toContain('4111')
  })

  it('rejects a start URL off the bound origin before touching the sandbox', async () => {
    setDb({ paybox_payment_requests: [{ ...REQUEST }] })
    sdkMock.getRequest.mockResolvedValue({ request_id: 'req_abc123', status: 'success', output: null, approval_id: null, error: null })
    const res = await payboxCompleteCheckout.execute(
      { requestId: 'req_abc123', task: 'buy', startUrl: 'https://evil.example' },
      ctx()
    )
    expect(res.success).toBe(false)
    expect(String(res.error)).toContain('bound to https://acme.example')
  })
})

// ---- issue-time recording ---------------------------------------------------

describe('paybox_request_payment recording', () => {
  it('records the issued request for the checkout loop', async () => {
    const { upserts } = setDb({ paybox_payment_requests: [], spend_events: [], spend_limits: [] })
    sdkMock.requestPayment.mockResolvedValue({
      request_id: 'req_new9',
      status: 'pending_approval',
      output: null,
      approval_id: 'ap_9',
      error: null,
    })
    const res = await payboxRequestPayment.execute(
      { credentialId: 'cred_card_1', merchant: 'acme', merchantUrl: 'https://acme.example', amountCents: 2599 },
      ctx()
    )
    expect(res.success).toBe(true)
    const rec = upserts.find((u) => u.table === 'paybox_payment_requests')
    expect(rec).toBeTruthy()
    expect(rec!.row).toMatchObject({
      request_id: 'req_new9',
      user_id: USER_ID,
      merchant: 'acme',
      merchant_url: 'https://acme.example',
      amount_cents: 2599,
      status: 'issued',
    })
  })
})

// ---- the manage link --------------------------------------------------------

describe('paybox_manage_access', () => {
  it('returns one link and a wait-and-resume instruction', async () => {
    setDb({})
    sdkMock.requestAccountChange.mockResolvedValue({ kind: 'account_change', client_id: 'c1', manage_url: 'https://app.paybox.sh/manage/xyz' })
    const res = await payboxManageAccess.execute({ note: 'add a card' }, ctx())
    expect(res.success).toBe(true)
    const data = res.data as { manage_url: string; instruction: string }
    expect(data.manage_url).toBe('https://app.paybox.sh/manage/xyz')
    expect(data.instruction).toContain('wait')
    expect(sdkMock.requestAccountChange).toHaveBeenCalledWith('add a card')
  })

  it('refuses without a PayBox connection', async () => {
    const res = await payboxManageAccess.execute({}, ctx(false))
    expect(res.success).toBe(false)
  })
})

// ---- CLI setup + bootstrap mirror -------------------------------------------

describe('paybox CLI in the sandbox', () => {
  it('setup command installs the CLI and writes the marker', () => {
    const cmd = payboxCliSetupCommand()
    expect(cmd).toContain('@paybox-sh/sdk@^2')
    expect(cmd).toContain('.paybox-cli-ready')
  })

  it('ensurePayboxCli is ready when the marker exists', async () => {
    const run = vi.fn(async (command: string) => ({ stdout: command.includes('paybox-cli-ready') ? 'ready' : '', stderr: '', exitCode: 0 }))
    const r = await ensurePayboxCli(run)
    expect(r.ready).toBe(true)
  })

  it('ensurePayboxCli installs when the marker is missing', async () => {
    const calls: string[] = []
    const run = vi.fn(async (command: string) => {
      calls.push(command)
      return { stdout: 'missing', stderr: '', exitCode: 0 }
    })
    const r = await ensurePayboxCli(run)
    expect(r.ready).toBe(true)
    expect(calls.some((c) => c.includes('@paybox-sh/sdk@^2'))).toBe(true)
  })

  it('bootstrap.py mirrors the checkout card-handling rule', () => {
    expect(BROWSER_BOOTSTRAP).toContain(CHECKOUT_GUARD)
    expect(BROWSER_BOOTSTRAP).toContain('PAYBOX_CARD_JSON')
    expect(BROWSER_BOOTSTRAP).toContain('def load_card')
    expect(BROWSER_BOOTSTRAP).toContain('def scrub_card')
  })
})
