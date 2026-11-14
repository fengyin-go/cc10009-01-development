// 请求配置快照：站点「提交校验」时落一份；激活后成为「生效」版本，被替换的旧版本保留为「历史」，
// 与同域名生效版本请求方式冲突的标记为「冲突」。持久化在 localStorage，重复进入页面看到同一份。
export type SnapshotStatus = '有效' | '生效' | '历史' | '冲突'

export type SnapshotRow = {
  id: number
  快照编号: string
  站点编号: string
  域名地址: string
  请求方式: string
  字符编码: string
  请求头模板: string
  Cookie配置: string
  站点负责人: string
  版本: number
  状态: SnapshotStatus
  核验批次: string
  生成时间: string
}

// 示例快照：与 seed.ts 里 site 模块的示例站点一一对应。
// SNAP-0002 → SNAP-0003 演示同站点换字符编码后旧版本保留为历史；SNAP-0004 是已激活站点的生效版本。
export const SEED_SNAPSHOTS: SnapshotRow[] = [
  {
    id: 1,
    快照编号: 'SNAP-0001',
    站点编号: 'SITE-0001',
    域名地址: 'www.example-news.com',
    请求方式: 'GET',
    字符编码: 'UTF-8',
    请求头模板: '新闻站标准请求头',
    Cookie配置: '免登录',
    站点负责人: '陈晓',
    版本: 1,
    状态: '有效',
    核验批次: 'BATCH-20261110-0001',
    生成时间: '2026-11-10 09:30',
  },
  {
    id: 2,
    快照编号: 'SNAP-0002',
    站点编号: 'SITE-0003',
    域名地址: 'data.example-gov.cn',
    请求方式: 'GET',
    字符编码: 'UTF-8',
    请求头模板: '政务站请求头',
    Cookie配置: '会话Cookie',
    站点负责人: '李岚',
    版本: 1,
    状态: '历史',
    核验批次: 'BATCH-20261108-0001',
    生成时间: '2026-11-08 14:10',
  },
  {
    id: 3,
    快照编号: 'SNAP-0003',
    站点编号: 'SITE-0003',
    域名地址: 'data.example-gov.cn',
    请求方式: 'GET',
    字符编码: 'GBK',
    请求头模板: '政务站请求头',
    Cookie配置: '会话Cookie',
    站点负责人: '李岚',
    版本: 2,
    状态: '生效',
    核验批次: 'BATCH-20261112-0001',
    生成时间: '2026-11-12 10:20',
  },
  {
    id: 4,
    快照编号: 'SNAP-0004',
    站点编号: 'SITE-0006',
    域名地址: 'api.example-weather.com',
    请求方式: 'GET',
    字符编码: 'UTF-8',
    请求头模板: '接口调用请求头',
    Cookie配置: '免登录',
    站点负责人: '李岚',
    版本: 1,
    状态: '生效',
    核验批次: 'BATCH-20261111-0001',
    生成时间: '2026-11-11 16:40',
  },
]

const STORAGE_KEY = 'scraper-config-studio:site-snapshots'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): SnapshotRow[] {
  const fallback = clone(SEED_SNAPSHOTS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as SnapshotRow[]
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: SnapshotRow[] | null = null

export function listSnapshots(): SnapshotRow[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveSnapshots(rows: SnapshotRow[]): void {
  cache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
}

export function resetSnapshots(): SnapshotRow[] {
  const rows = clone(SEED_SNAPSHOTS)
  saveSnapshots(rows)
  return rows
}

export function snapshotStorageKey(): string {
  return STORAGE_KEY
}
