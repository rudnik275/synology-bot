import {Bot} from './bot'
import {cleanTasks, createDownloadTask, getFoldersList, getTasks} from './synology'
import {formatSynologyTask} from './utils'
import {searchToloka} from './toloka.ts'
import {gptGPTResponse} from './open-ai.ts'

/**
 * process.env variables:
 *  - BOT_TOKEN
 *  - OWNER_USERNAME
 *  - SYNOLOGY_HOST
 *  - SYNOLOGY_USER
 *  - SYNOLOGY_PASSWORD
 */

const bot = new Bot()

bot
  .addCommand('status', 'Status', async (reply) => {
    const tasks = await getTasks()
    if (tasks.length === 0)
      return reply('Downloads is empty')

    for (const task of tasks) {
      await reply(
        formatSynologyTask(task),
      )
    }
  })
  .addCommand('clean', 'Clean completed', async reply => {
    await cleanTasks()
    await reply('🧹')
  })
  .addCommand('torrent', 'Search torrent', async reply => {
    const query = await askUser('Search on torrent...')
    const results = searchToloka(query)
    await reply(results)
  })
  .addCommand('gpt', 'GPT Search torrent', async reply => {
    const query = await askUser('Search on torrent with gpt...')
    const suggestions = await gptGPTResponse(query)
    if (suggestions.length === 0) {
      await reply('Not found')
    } else {
      const suggestion = suggestions.length > 1 ? await askUser('GPT found few results: ', suggestions) : suggestions[0]
      const results = await searchToloka(suggestion)
      const filteredResults = await filterResultsByGpt(results)
      const userChoise = await askUser('Download one', filteredResults)
      const folder = await askUser('choose folder')
      await createDownloadTask(folder, userChoise.url)
      await reply(`Started download ${userChoise} to ${folder}`)
    }
  })
  .onUploadFile(getFoldersList, createDownloadTask)
  .then(() => bot.launch())
  .then(() => console.log('bot stopped'))


searchToloka('from')
