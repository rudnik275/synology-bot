import axios from 'axios'

const api = axios.create({
  baseURL: `${process.env.SYNOLOGY_HOST}/webapi/`
})
api.interceptors.response.use((r) => r.data)

let token
const login = async () => {
  const loginApiName = 'SYNO.API.Auth'
  const {path, version} = await getApiInfo(loginApiName)
  const {data} = await api.get(path, {
    params: {
      api: loginApiName,
      version,
      method: 'login',
      account: process.env.SYNOLOGY_USER,
      passwd: process.env.SYNOLOGY_PASSWORD
    }
  })
  token = data.sid
}

const getApiInfo = async (apiName) => {
  const {data} = await api.get('query.cgi', {
    params: {
      api: 'SYNO.API.Info',
      version: 1,
      method: 'query',
      query: apiName
    }
  })

  return {
    version: data[apiName].maxVersion,
    path: data[apiName].path
  }
}

const makeRequest = async (apiName, params) => {
  const {version, path} = await getApiInfo(apiName)
  const {data, success, error} = await api.get(path, {
    params: {
      ...params,
      version,
      api: apiName,
      _sid: token
    }
  })

  if (!success && error.code === 119) {
    await login()
    return makeRequest(apiName, params)
  } else {
    return data
  }
}

export const getTasks = async () => {
  const {task: tasks} = await makeRequest('SYNO.DownloadStation2.Task', {
    method: 'list',
    additional: '["detail","transfer"]'
  })
  tasks.sort((a, b) => b.status - a.status)
  return tasks
}

export const cleanTasks = () => makeRequest('SYNO.DownloadStation2.Task', {
  method: 'delete_condition',
  status: 5
})

export const getFoldersList = async () => {
  const {files: folders} = await makeRequest('SYNO.FileStation.List', {
    method: 'list',
    folder_path: '/video'
  })
  return folders.map(folder => folder.name)
}

export const createDownloadTask = (folder, fileUrl) => makeRequest('SYNO.DownloadStation2.Task', {
  method: 'create',
  create_list: false,
  destination: `video/${folder}`,
  type: 'url',
  url: fileUrl
})
