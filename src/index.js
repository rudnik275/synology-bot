import {createBot} from './bot'
import {cleanTasks, createDownloadTask, getFoldersList, getTasks} from './synology'
import {formatSynologyTask} from './utils'

/**
 * process.env variables:
 *  - BOT_TOKEN
 *  - OWNER_USERNAME
 *  - SYNOLOGY_HOST
 *  - SYNOLOGY_USER
 *  - SYNOLOGY_PASSWORD
 */

createBot()
  .addCommand('status', 'Status', async (reply) => {
    const tasks = await getTasks()
    if (tasks.length === 0)
      return reply('Downloads is empty')

    for (const task of tasks) {
      await reply(
        formatSynologyTask(task)
      )
    }
  })
  .addCommand('clean', 'Clean completed', async reply => {
    await cleanTasks()
    reply('🧹')
  })
  .onUploadFile(getFoldersList, createDownloadTask)
  .then(app => app.launch())
  .then(() => console.log('bot stopped'))
