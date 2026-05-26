import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { registerDeployStatusRoute } from '../../../../src/handlers/routes/deploy-status.ts'
import type { DockerClient } from '../../../../src/infra/docker/client.ts'

// Minimal grammy-like context & bot stubs
type FakeCtx = {
  reply: ReturnType<typeof mock>
}

function makeFakeCtx(): FakeCtx {
  return { reply: mock(async (_text: string) => {}) }
}

type CommandHandler = (ctx: FakeCtx) => Promise<void>

function makeFakeBot() {
  const handlers: Record<string, CommandHandler> = {}
  return {
    command(cmd: string, handler: CommandHandler) {
      handlers[cmd] = handler
    },
    async trigger(cmd: string, ctx: FakeCtx) {
      await handlers[cmd]!(ctx)
    },
  }
}

// Minimal DockerClient stub factory
function makeDockerStub(overrides: Partial<DockerClient> = {}): DockerClient {
  return {
    getContainerByName: mock(async () => null),
    getContainerLogs: mock(async () => ''),
    ...overrides,
  } as unknown as DockerClient
}

describe('/deploy_status handler', () => {
  let ctx: FakeCtx
  let bot: ReturnType<typeof makeFakeBot>

  beforeEach(() => {
    ctx = makeFakeCtx()
    bot = makeFakeBot()
  })

  it('replies with container-not-found message when container is absent', async () => {
    const docker = makeDockerStub({
      getContainerByName: mock(async () => null),
    })

    registerDeployStatusRoute(bot as never, docker)
    await bot.trigger('deploy_status', ctx)

    expect(ctx.reply.mock.calls[0]![0]).toContain('watchtower не найден')
  })

  it('replies with not-running message when container exists but is stopped', async () => {
    const docker = makeDockerStub({
      getContainerByName: mock(async () => ({
        id: 'abc123',
        state: 'exited',
        status: 'Exited (0) 2 hours ago',
        imageId: 'sha256:test',
      })),
    })

    registerDeployStatusRoute(bot as never, docker)
    await bot.trigger('deploy_status', ctx)

    const reply = ctx.reply.mock.calls[0]![0] as string
    expect(reply).toContain('Watchtower не запущен')
    expect(reply).toContain('Exited (0) 2 hours ago')
  })

  it('reports last poll time when container is running and logs have Session done', async () => {
    // A timestamp 3 minutes in the past
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000)
    const ts = threeMinutesAgo.toISOString().replace(/\.\d{3}Z$/, 'Z')
    const logLine = `${ts} time="${ts}" level=info msg="Session done"`

    const docker = makeDockerStub({
      getContainerByName: mock(async () => ({
        id: 'abc123',
        state: 'running',
        status: 'Up 10 minutes',
        imageId: 'sha256:test',
      })),
      getContainerLogs: mock(async () => logLine),
    })

    registerDeployStatusRoute(bot as never, docker)
    await bot.trigger('deploy_status', ctx)

    const reply = ctx.reply.mock.calls[0]![0] as string
    expect(reply).toContain('✅')
    expect(reply).toContain('Watchtower работает')
    expect(reply).toContain('назад')
  })

  it('reports running but no recent poll when logs have no Session done', async () => {
    const docker = makeDockerStub({
      getContainerByName: mock(async () => ({
        id: 'abc123',
        state: 'running',
        status: 'Up 10 minutes',
        imageId: 'sha256:test',
      })),
      getContainerLogs: mock(async () => 'time="2024-01-15T10:00:00Z" level=info msg="Starting"'),
    })

    registerDeployStatusRoute(bot as never, docker)
    await bot.trigger('deploy_status', ctx)

    const reply = ctx.reply.mock.calls[0]![0] as string
    expect(reply).toContain('Watchtower работает')
    // No Session done info — should note that
    expect(reply).toContain('нет данных')
  })

  it('replies with socket-unreachable message on ENOENT error', async () => {
    const err = Object.assign(new Error('connect ENOENT /var/run/docker.sock'), { code: 'ENOENT' })
    const docker = makeDockerStub({
      getContainerByName: mock(async () => { throw err }),
    })

    registerDeployStatusRoute(bot as never, docker)
    await bot.trigger('deploy_status', ctx)

    const reply = ctx.reply.mock.calls[0]![0] as string
    expect(reply).toContain('❌')
    expect(reply).toContain('Docker')
  })

  it('replies with socket-unreachable message on ECONNREFUSED error', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const docker = makeDockerStub({
      getContainerByName: mock(async () => { throw err }),
    })

    registerDeployStatusRoute(bot as never, docker)
    await bot.trigger('deploy_status', ctx)

    const reply = ctx.reply.mock.calls[0]![0] as string
    expect(reply).toContain('❌')
    expect(reply).toContain('Docker')
  })
})
