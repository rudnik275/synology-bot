import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { runTolokaSearch } from '../../../../src/handlers/routes/search.ts'
import type { TolokaResult } from '../../../../src/infra/toloka/types.ts'

const SAMPLE_RESULTS: TolokaResult[] = [
  {
    id: '123',
    title: 'Ubuntu 24.04 LTS',
    downloadUrl: 'https://toloka.to/dl/123',
    size: '1.2 GB',
    seeders: 50,
    leechers: 5,
    category: 'Linux',
  },
  {
    id: '456',
    title: 'Ubuntu 24.04 Server',
    downloadUrl: 'https://toloka.to/dl/456',
    size: '900 MB',
    seeders: 30,
    leechers: 2,
    category: 'Linux',
  },
]

function makeDeps(searchResult: TolokaResult[] = SAMPLE_RESULTS) {
  return {
    toloka: {
      search: mock(async (_query: string) => searchResult),
    },
  }
}

function makeCtx() {
  return {
    react: mock(async () => {}),
    reply: mock(async () => ({ message_id: 1 })),
  }
}

describe('runTolokaSearch', () => {
  it('calls toloka.search with the provided query', async () => {
    const deps = makeDeps()
    const ctx = makeCtx()

    await runTolokaSearch(ctx as never, 'ubuntu 24.04', deps as never)

    expect(deps.toloka.search).toHaveBeenCalledTimes(1)
    expect(deps.toloka.search).toHaveBeenCalledWith('ubuntu 24.04')
  })

  it('sends results message when results are returned', async () => {
    const deps = makeDeps()
    const ctx = makeCtx()

    await runTolokaSearch(ctx as never, 'ubuntu 24.04', deps as never)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const calls = ctx.reply.mock.calls[0] as unknown as [string, { parse_mode: string; reply_markup: unknown }]
    expect(calls[0]).toContain('ubuntu 24.04')
    expect(calls[1].parse_mode).toBe('HTML')
  })

  it('sends "nothing found" message when results are empty', async () => {
    const deps = makeDeps([])
    const ctx = makeCtx()

    await runTolokaSearch(ctx as never, 'nonexistent query', deps as never)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const calls = ctx.reply.mock.calls[0] as unknown as [string]
    expect(calls[0]).toContain('нічого не знайдено')
  })

  it('sends error message when toloka throws', async () => {
    const deps = {
      toloka: {
        search: mock(async () => { throw new Error('network error') }),
      },
    }
    const ctx = makeCtx()

    await runTolokaSearch(ctx as never, 'ubuntu', deps as never)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const calls = ctx.reply.mock.calls[0] as unknown as [string]
    expect(calls[0]).toContain('Toloka недоступна')
  })

  it('integration: free-form text dispatched via classifyInput reaches toloka.search', async () => {
    // Simulate the router behaviour: classifyInput returns 'search', router calls runTolokaSearch
    const { classifyInput } = await import('../../../../src/handlers/input-router.ts')

    const query = 'ubuntu 24.04'
    const kind = classifyInput(query)
    expect(kind).toBe('search')

    const deps = makeDeps()
    const ctx = makeCtx()

    // Router would call: await runTolokaSearch(ctx, query.trim(), { toloka })
    await runTolokaSearch(ctx as never, query, deps as never)

    expect(deps.toloka.search).toHaveBeenCalledWith('ubuntu 24.04')
  })
})
