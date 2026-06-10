import { describe, it, expect, mock } from 'bun:test'
import { GrammyError, type BotError, type Context } from 'grammy'
import {
  isToleratedApiError,
  handleBotError,
  registerStaleCallbackFallback,
} from '../../../src/bot.ts'

function makeGrammyError(description: string): GrammyError {
  return new GrammyError(
    `Call to 'editMessageText' failed!`,
    { ok: false, error_code: 400, description },
    'editMessageText',
    {}
  )
}

function makeBotError(error: unknown): BotError<Context> {
  return {
    error,
    ctx: { update: { update_id: 7, callback_query: {} } },
  } as unknown as BotError<Context>
}

describe('bot error boundary (#290)', () => {
  describe('isToleratedApiError', () => {
    it.each([
      'Bad Request: message is not modified: ...',
      'Bad Request: query is too old and response timeout expired or query ID is invalid',
      'Bad Request: message to edit not found',
    ])('tolerates expected GrammyError: %s', (description) => {
      expect(isToleratedApiError(makeGrammyError(description))).toBe(true)
    })

    it('does not tolerate other GrammyErrors', () => {
      expect(isToleratedApiError(makeGrammyError('Bad Request: chat not found'))).toBe(false)
    })

    it('does not tolerate non-Grammy errors', () => {
      expect(isToleratedApiError(new Error('message is not modified'))).toBe(false)
    })
  })

  describe('handleBotError', () => {
    it('never throws — neither for tolerated nor unexpected errors', () => {
      expect(() => handleBotError(makeBotError(makeGrammyError('message is not modified')))).not.toThrow()
      expect(() => handleBotError(makeBotError(new Error('boom')))).not.toThrow()
    })
  })

  describe('stale callback fallback (#297)', () => {
    it('answers unmatched callback queries with «Кнопка устарела»', async () => {
      let registered: ((ctx: unknown) => Promise<void>) | undefined
      const fakeBot = {
        on(event: string, handler: (ctx: unknown) => Promise<void>) {
          expect(event).toBe('callback_query')
          registered = handler
        },
      }
      registerStaleCallbackFallback(fakeBot as never)
      expect(registered).toBeDefined()

      const answerCallbackQuery = mock(async () => {})
      await registered!({ answerCallbackQuery })

      const call = answerCallbackQuery.mock.calls[0] as unknown as [{ text: string }]
      expect(call[0].text).toBe('Кнопка устарела')
    })
  })
})
