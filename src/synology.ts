import type {AxiosInstance} from 'axios'
import axios from 'axios'
import type {SynologyTask} from './types.ts'

interface ApiInfo {
  version: number
  path: string
}

interface ApiResponse<T> {
  data: T
  success: boolean
  error?: {
    code: number
  }
}

interface Folder {
  name: string
}

let token: string | undefined

const api: AxiosInstance = axios.create({
  baseURL: `${process.env.SYNOLOGY_HOST}/webapi/`,
})

api.interceptors.response.use((response) => response.data)

const login = async (): Promise<void> => {
  const loginApiName = 'SYNO.API.Auth'
  const {path, version} = await getApiInfo(loginApiName)
  const {data} = await api.get<{ sid: string }>(path, {
    params: {
      api: loginApiName,
      version,
      method: 'login',
      account: process.env.SYNOLOGY_USER,
      passwd: process.env.SYNOLOGY_PASSWORD,
    },
  })
  token = data.sid
}

const getApiInfo = async (apiName: string): Promise<ApiInfo> => {
  const {data} = await api.get<{
    [key: string]: {
      maxVersion: number;
      path: string
    }
  }>('query.cgi', {
    params: {
      api: 'SYNO.API.Info',
      version: 1,
      method: 'query',
      query: apiName,
    },
  })

  return {
    version: data[apiName].maxVersion,
    path: data[apiName].path,
  }
}

const makeRequest = async <T>(apiName: string, params: Record<string, any>): Promise<T> => {
  const {version, path} = await getApiInfo(apiName)
  const response: ApiResponse<T> = await api.get(path, {
    params: {
      ...params,
      version,
      api: apiName,
      _sid: token,
    },
  })

  if (!response.success && response.error?.code === 119) {
    await login()
    return makeRequest(apiName, params)
  } else {
    return response.data
  }
}

export const getTasks = async (): Promise<SynologyTask[]> => {
  const {task: tasks} = await makeRequest<{ task: SynologyTask[] }>('SYNO.DownloadStation2.Task', {
    method: 'list',
    additional: '["detail","transfer"]',
  })
  tasks.sort((a, b) => b.status - a.status)
  return tasks
}

export const cleanTasks = (): Promise<any> => makeRequest('SYNO.DownloadStation2.Task', {
  method: 'delete_condition',
  status: 5,
})

export const getFoldersList = async (): Promise<string[]> => {
  const {files: folders} = await makeRequest<{ files: Folder[] }>('SYNO.FileStation.List', {
    method: 'list',
    folder_path: '/video',
  })
  return folders.map(folder => folder.name)
}

export const createDownloadTask = (folder: string, fileUrl: string): Promise<any> => makeRequest('SYNO.DownloadStation2.Task', {
  method: 'create',
  create_list: false,
  destination: `video/${folder}`,
  type: 'url',
  url: fileUrl,
})
