import type {SynologyTask} from '../types.ts'

/**
 * Format bytes as human-readable text.
 * @param bytes - The number of bytes to format.
 * @returns A formatted string representing the human-readable file size.
 */
function humanFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const thresh = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const index = Math.floor(Math.log(bytes) / Math.log(thresh))
  return parseFloat((bytes / Math.pow(thresh, index)).toFixed(2)) + ' ' + sizes[index]
}

export const getSynologyTaskStatusIcon = (statusCode: number) => {
  switch (statusCode) {
    case 5:
    case 8:
      return '🟢'

    case 3:
      return '⏸️'

    default:
      return '🌐'
  }
}

function generateProgressBar(progress: number, length = 10) {
  const filledLength = Math.round((progress / 100) * length)
  const bar = '■'.repeat(filledLength) + '□'.repeat(length - filledLength)

  return `[${bar}] ${progress}%`
}

/**
 * Format Synology task information as a readable string.
 * @param task - The Synology task to format.
 * @returns A formatted string representing the task status.
 */
export const formatSynologyTask = (task: SynologyTask): string => {
  const isLoaded = [5, 8].includes(task.status)
  const size = humanFileSize(task.size)
  const sizeUploaded = humanFileSize(task.additional.transfer.size_uploaded)
  const statusIcon = getSynologyTaskStatusIcon(task.status)

  const itemRows = [
    `${statusIcon} ${task.title}`,
    `Size - ${size}`
  ]

  if (isLoaded) {
    itemRows.push(`Uploaded - ${sizeUploaded}`)
  } else {
    const percent = Math.round((task.additional.transfer.size_downloaded / task.size) * 100)
    const speed = humanFileSize(task.additional.transfer.speed_download)
    itemRows.push(generateProgressBar(percent))
    itemRows.push(`Speed - ${speed}`)
  }

  return itemRows.join('\n')
}

export const getFileUrl = (filePath: string) => `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`
