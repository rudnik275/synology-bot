import type {SynologyTask} from './types'

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

/**
 * Format Synology task information as a readable string.
 * @param task - The Synology task to format.
 * @returns A formatted string representing the task status.
 */
export const formatSynologyTask = (task: SynologyTask): string => {
  const isLoaded = task.status === 5
  const size = humanFileSize(task.size)
  if (isLoaded) {
    return `🟢 Size - ${size} \n\n${task.title}`
  } else {
    const percent = Math.round((task.additional.transfer.size_downloaded / task.size) * 100)
    const speed = humanFileSize(task.additional.transfer.speed_download)
    return `🕛 \nSize - ${size} \nDownloaded - ${percent}% \nSpeed - ${speed} \n\n${task.title}`
  }
}

let commandId = 0
const folderMap = new Map<string, number>()

/**
 * Generate a unique command name for a given folder.
 * @param folder - The folder to get the command name for.
 * @returns A unique command name for the folder.
 */
export const getCommandName = (folder: string): string => {
  if (!folderMap.has(folder)) {
    folderMap.set(folder, commandId++)
  }
  return `choose_folder_${folderMap.get(folder)}`
}
