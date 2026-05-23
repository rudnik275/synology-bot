import type { Bot, Context } from 'grammy'
import type { DockerClient } from '../../infra/docker/client.ts'
import { parseLastSessionDone } from '../../infra/docker/client.ts'

const SOCKET_ERROR_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'EACCES'])

/**
 * Returns a human-readable relative-time string in Russian.
 * E.g. "3 минуты назад", "1 час назад", "только что".
 */
function relativeTimeRu(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.round(diffMs / 1000)
  const diffMin = Math.round(diffSec / 60)
  const diffHour = Math.round(diffMin / 60)

  if (diffSec < 60) return 'только что'

  if (diffMin < 60) {
    const word = minuteWord(diffMin)
    return `${diffMin} ${word} назад`
  }

  const word = hourWord(diffHour)
  return `${diffHour} ${word} назад`
}

function minuteWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'минуту'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'минуты'
  return 'минут'
}

function hourWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'час'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'часа'
  return 'часов'
}

export function registerDeployStatusRoute(bot: Bot<Context>, docker: DockerClient): void {
  bot.command('deploy-status', async (ctx) => {
    let container: Awaited<ReturnType<DockerClient['getContainerByName']>>

    try {
      container = await docker.getContainerByName('watchtower')
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code && SOCKET_ERROR_CODES.has(code)) {
        await ctx.reply(
          '❌ Не удалось подключиться к Docker — Watchtower может быть недоступен'
        )
      } else {
        await ctx.reply(
          '❌ Не удалось подключиться к Docker — Watchtower может быть недоступен'
        )
      }
      return
    }

    if (container === null) {
      await ctx.reply('❌ Контейнер watchtower не найден')
      return
    }

    if (container.state !== 'running') {
      await ctx.reply(`❌ Watchtower не запущен (status: ${container.status})`)
      return
    }

    // Container is running — fetch logs and look for last Session done
    let logs = ''
    try {
      logs = await docker.getContainerLogs('watchtower', 50)
    } catch {
      // Non-fatal: we know the container is running; we just can't get the last check time
    }

    const lastCheck = parseLastSessionDone(logs)

    if (lastCheck) {
      await ctx.reply(
        `✅ Watchtower работает. Последняя проверка: ${relativeTimeRu(lastCheck)}`
      )
    } else {
      await ctx.reply('✅ Watchtower работает. Последняя проверка: нет данных')
    }
  })
}
