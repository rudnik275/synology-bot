/**
 * Format bytes as human-readable text.
 */
function humanFileSize(bytes) {
  if (bytes === 0) return '0 Bytes'
  const thresh = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const index = Math.floor(Math.log(bytes) / Math.log(thresh))
  return parseFloat((bytes / Math.pow(thresh, index)).toFixed(2)) + ' ' + sizes[index]
}

export const formatSynologyTask = (task) => {
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
const folderMap = new Map()
export const getCommandName = (folder) => {
  if (!folderMap.has(folder)) {
    folderMap.set(folder, commandId++)
  }
  return `choose_folder_${folderMap.get(folder)}`
}
