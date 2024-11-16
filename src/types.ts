export interface SynologyTask {
  id: string
  status: number
  size: number
  title: string
  additional: {
    detail: any
    transfer: {
      size_downloaded: number
      speed_download: number
    }
  }
}

export type EditTaskAction = 'resume' | 'pause' | 'delete'
