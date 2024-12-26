import type {BotContext, EditTaskAction} from '../types.ts'
import {Bot} from 'grammy'
import {Menu} from '@grammyjs/menu'
import {editTask, getTasks} from '../utils/synology-api.ts'
import {formatSynologyTask, getSynologyTaskStatusIcon} from '../utils/utils.ts'

export function registerDownloadsMenu(bot: Bot<BotContext>) {
  const statusMenu = new Menu<BotContext>('statusMenu')
    .submenu('Edit', 'taskListMenu', ctx => {
      ctx.editMessageText('Choose')
    })

  bot.use(statusMenu)

  const taskListMenu = new Menu<BotContext>('taskListMenu')
    .dynamic(async (_, range) => {
      const tasks = await getTasks()
      for (const task of tasks) {
        range
          .submenu(`${getSynologyTaskStatusIcon(task.status)} ${task.title}`, 'taskEditMenu', ctx => {
            ctx.session.selectedTask = task
            ctx.editMessageText(
              formatSynologyTask(task)
            )
          })
          .row()
      }
      range.back('back', async ctx => ctx.editMessageText(await getTasksText()))
    })

  statusMenu.register(taskListMenu)

  const taskEditMenu = new Menu<BotContext>('taskEditMenu')
    .dynamic((ctx, range) => {
      const task = ctx.session.selectedTask
      const edit = async (action: EditTaskAction) => {
        await editTask(task.id, action)
        await ctx.editMessageText(await getTasksText())
        await ctx.editMessageReplyMarkup({
          reply_markup: statusMenu
        })
      }

      if (task.status === 1 || task.status === 2) {
        range.text('❚❚ Pause', () => edit('pause'))
      } else if (task.status === 3) {
        range.text('▶ Resume', () => edit('resume'))
      }
      range
        .text('🗑️ Delete', async () => edit('delete'))
        .back('⬅️ Back', ctx => {
          ctx.editMessageText('Choose')
        })
    })

  taskListMenu.register(taskEditMenu)

  const getTasksText = async () => {
    const tasks = await getTasks()
    return tasks
      .map(formatSynologyTask)
      .join('\n\n') || 'Downloads is empty'
  }

  return async (ctx: BotContext) => {
    ctx.reply('Loading...')
    ctx.reply(
      await getTasksText(),
      {
        reply_markup: statusMenu
      }
    )
  }
}
