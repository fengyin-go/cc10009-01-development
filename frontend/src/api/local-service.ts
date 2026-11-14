import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { listSnapshots, resetSnapshots, saveSnapshots } from '@/data/snapshots'
import type { SnapshotRow } from '@/data/snapshots'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const SITE_KEY = 'site'
const SPIDER_KEY = 'spider'

// 请求配置完整性的判定字段：缺任意一项都不能生成快照，也不能被采集任务选为目标站点。
const SITE_CONFIG_FIELDS = ['请求方式', '字符编码', '请求头模板', 'Cookie配置']
const EMPTY_MARKS = new Set(['', '—', '未配置'])
// 快照处于这两种状态时，站点才允许被采集任务选为目标站点。
const SNAPSHOT_USABLE: SnapshotRow['状态'][] = ['有效', '生效']

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDay(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function formatMinute(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// ---------- 站点接入：请求配置完整性 ----------

export function missingConfigFields(site: EntryRow): string[] {
  return SITE_CONFIG_FIELDS.filter((field) => EMPTY_MARKS.has(text(site, field)))
}

// ---------- 站点接入：请求配置快照 ----------

function sameRequestContent(snapshot: SnapshotRow, site: EntryRow): boolean {
  return (
    snapshot.请求方式 === text(site, '请求方式') &&
    snapshot.字符编码 === text(site, '字符编码') &&
    snapshot.请求头模板 === text(site, '请求头模板') &&
    snapshot.Cookie配置 === text(site, 'Cookie配置')
  )
}

/** 站点当前未归档的最新一份快照（有效 / 生效 / 冲突），历史版本不参与判定。 */
export function latestSnapshot(siteCode: string): SnapshotRow | null {
  const candidates = listSnapshots().filter(
    (row) => row.站点编号 === siteCode && row.状态 !== '历史',
  )
  if (candidates.length === 0) {
    return null
  }
  return candidates.reduce((a, b) => (a.版本 >= b.版本 ? a : b))
}

function domainEffectiveSnapshot(domain: string): SnapshotRow | null {
  return listSnapshots().find((row) => row.域名地址 === domain && row.状态 === '生效') ?? null
}

/**
 * 为站点落一份请求配置快照。
 * 幂等：同站点、同配置内容已存在未归档快照时直接复用——并发核验、重复提交只落一份有效快照。
 * 跨批次核验时配置内容变了才生成新版本，同站点旧的「有效/冲突」快照归档为历史；
 * 若同域名已存在生效快照且请求方式不同，新快照直接标记「冲突」，以当前生效版本为准。
 */
function ensureSnapshot(site: EntryRow): {
  snapshot: SnapshotRow
  created: boolean
  conflictWith: SnapshotRow | null
} {
  const snaps = listSnapshots()
  const code = text(site, '站点编号')
  const domain = text(site, '域名地址')
  const existing = snaps.find(
    (row) => row.站点编号 === code && row.状态 !== '历史' && sameRequestContent(row, site),
  )
  if (existing) {
    return { snapshot: existing, created: false, conflictWith: null }
  }
  const effective = domainEffectiveSnapshot(domain)
  const conflictWith =
    effective && effective.请求方式 !== text(site, '请求方式') ? effective : null
  const nextId = snaps.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const version =
    snaps.filter((row) => row.站点编号 === code).reduce((max, row) => Math.max(max, row.版本), 0) + 1
  const now = new Date()
  const snapshot: SnapshotRow = {
    id: nextId,
    快照编号: `SNAP-${String(nextId).padStart(4, '0')}`,
    站点编号: code,
    域名地址: domain,
    请求方式: text(site, '请求方式'),
    字符编码: text(site, '字符编码'),
    请求头模板: text(site, '请求头模板'),
    Cookie配置: text(site, 'Cookie配置'),
    站点负责人: text(site, '站点负责人'),
    版本: version,
    状态: conflictWith ? '冲突' : '有效',
    核验批次: `BATCH-${formatDay(now)}-${String(nextId).padStart(4, '0')}`,
    生成时间: formatMinute(now),
  }
  const kept = snaps.map((row) =>
    row.站点编号 === code && (row.状态 === '有效' || row.状态 === '冲突')
      ? { ...row, 状态: '历史' as const }
      : row,
  )
  saveSnapshots([...kept, snapshot])
  return { snapshot, created: true, conflictWith }
}

// ---------- 站点接入：状态流转（提交校验 / 激活站点 / 暂停站点） ----------

function runSiteAction(id: number, action: string): ActionResult {
  const rows = listRows(SITE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的采集站点` }
  }
  const site = rows[index]

  if (action === '提交校验') {
    const missing = missingConfigFields(site)
    if (missing.length > 0) {
      const next = [...rows]
      next[index] = { ...site, abnormal: true }
      saveRows(SITE_KEY, next)
      return {
        ok: false,
        message: `缺少请求配置：${missing.join('、')}，无法生成快照，已在接入总览中标记`,
      }
    }
    const { snapshot, created, conflictWith } = ensureSnapshot(site)
    const next = [...rows]
    next[index] = { ...site, status: '待校验', pending: true, abnormal: false }
    saveRows(SITE_KEY, next)
    const head = created
      ? `已生成请求配置快照 ${snapshot.快照编号}（v${snapshot.版本}）`
      : `快照 ${snapshot.快照编号}（v${snapshot.版本}）已存在，并发核验不重复生成`
    const tail = conflictWith
      ? `；与同域名已生效快照 ${conflictWith.快照编号}（${conflictWith.请求方式}）请求方式冲突，以当前生效版本为准`
      : ''
    return { ok: true, message: `${head}${tail}` }
  }

  if (action === '激活站点') {
    const snapshot = latestSnapshot(text(site, '站点编号'))
    if (!snapshot) {
      return { ok: false, message: '请先提交校验生成请求配置快照，再激活站点' }
    }
    if (snapshot.状态 === '冲突') {
      const effective = domainEffectiveSnapshot(snapshot.域名地址)
      return {
        ok: false,
        message: `同域名请求方式与已生效快照 ${effective?.快照编号 ?? ''} 冲突，以当前生效版本为准，无法激活`,
      }
    }
    if (snapshot.状态 === '生效' && String(site.status) === '已激活') {
      return { ok: false, message: '采集站点已经是「已激活」，不用重复操作' }
    }
    // 版本切换：当前快照置为生效；同域名旧生效版本保留为历史；
    // 同域名未生效且请求方式不同的快照标记冲突，以当前生效版本为准。
    const next = listSnapshots().map((row) => {
      if (row.id === snapshot.id) {
        return { ...row, 状态: '生效' as const }
      }
      if (row.域名地址 === snapshot.域名地址 && row.状态 === '生效') {
        return { ...row, 状态: '历史' as const }
      }
      if (row.域名地址 === snapshot.域名地址 && row.状态 === '有效' && row.请求方式 !== snapshot.请求方式) {
        return { ...row, 状态: '冲突' as const }
      }
      return row
    })
    saveSnapshots(next)
    const nextRows = [...rows]
    nextRows[index] = { ...site, status: '已激活', pending: false, abnormal: false }
    saveRows(SITE_KEY, nextRows)
    return {
      ok: true,
      message: `采集站点已激活，快照 ${snapshot.快照编号}（v${snapshot.版本}）成为当前生效版本，旧版本保留为历史`,
    }
  }

  if (action === '暂停站点') {
    if (String(site.status) === '已暂停') {
      return { ok: false, message: '采集站点已经是「已暂停」，不用重复操作' }
    }
    const next = [...rows]
    next[index] = { ...site, status: '已暂停', pending: false }
    saveRows(SITE_KEY, next)
    return { ok: true, message: '采集站点已暂停，当前状态「已暂停」' }
  }

  return { ok: false, message: `采集站点没有登记「${action}」这个动作` }
}

// ---------- 采集任务：启动阻断 ----------

/** 目标站点被阻断的原因；空串表示可以启动。 */
function blockedReason(target: string): string {
  if (!target) {
    return '目标站点未填写'
  }
  const site = listRows(SITE_KEY).find(
    (row) => text(row, '域名地址') === target || text(row, '站点编号') === target,
  )
  if (!site) {
    return `目标站点 ${target} 未在站点管理中登记`
  }
  const missing = missingConfigFields(site)
  if (missing.length > 0) {
    return `目标站点 ${target} 缺少请求配置：${missing.join('、')}`
  }
  const snapshot = latestSnapshot(text(site, '站点编号'))
  if (!snapshot || !SNAPSHOT_USABLE.includes(snapshot.状态)) {
    return `目标站点 ${target} 尚未形成有效请求配置快照`
  }
  return ''
}

function runSpiderAction(id: number, action: string): ActionResult {
  if (action !== '启动采集') {
    return runGenericAction(SPIDER_KEY, id, action)
  }
  const rows = listRows(SPIDER_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的采集作业` }
  }
  const job = rows[index]
  const target = text(job, '目标站点')
  const reason = blockedReason(target)
  if (reason) {
    // 启动被阻断：作业留在待执行清单并记下原因，待执行清单直接反映被阻断的站点数量。
    const next = [...rows]
    next[index] = { ...job, status: '待执行', pending: true, abnormal: true, 阻断原因: reason }
    saveRows(SPIDER_KEY, next)
    return { ok: false, message: `${reason}，作业已保留在待执行清单` }
  }
  if (String(job.status) === '运行中') {
    return { ok: false, message: '采集作业已经是「运行中」，不用重复操作' }
  }
  const next = [...rows]
  next[index] = { ...job, status: '运行中', pending: false, abnormal: false, 阻断原因: '' }
  saveRows(SPIDER_KEY, next)
  return { ok: true, message: `采集作业已启动，目标站点 ${target} 的请求配置快照生效中` }
}

// ---------- 站点接入总览 / 采集任务工作清单（页面只读，不做业务判断） ----------

export type OnboardingGroup = {
  请求方式: string
  字符编码: string
  total: number
  complete: number
  missing: number
  snapshotted: number
  effective: number
}

export type SiteOnboardingResult = {
  cards: { label: string; value: number }[]
  groups: OnboardingGroup[]
  missingSites: { id: number; 站点编号: string; 域名地址: string; 站点负责人: string; missing: string[] }[]
  conflicts: {
    域名地址: string
    生效快照编号: string
    生效请求方式: string
    冲突快照编号: string
    冲突请求方式: string
  }[]
  owners: string[]
}

/** 站点接入总览：按请求方式 × 字符编码归集，标出缺少配置与请求方式冲突的站点。 */
export function siteOnboarding(): SiteOnboardingResult {
  const sites = listRows(SITE_KEY)
  const snaps = listSnapshots()
  const groupMap = new Map<string, OnboardingGroup>()
  let activated = 0
  let verifying = 0
  let missingCount = 0
  let snapshotCount = 0
  for (const site of sites) {
    const method = text(site, '请求方式') || '未配置'
    const charset = text(site, '字符编码') || '未配置'
    const key = `${method}@@${charset}`
    const group =
      groupMap.get(key) ?? {
        请求方式: method,
        字符编码: charset,
        total: 0,
        complete: 0,
        missing: 0,
        snapshotted: 0,
        effective: 0,
      }
    group.total += 1
    if (missingConfigFields(site).length === 0) {
      group.complete += 1
    } else {
      group.missing += 1
      missingCount += 1
    }
    const snapshot = latestSnapshot(text(site, '站点编号'))
    if (snapshot) {
      group.snapshotted += 1
      snapshotCount += 1
      if (snapshot.状态 === '生效') {
        group.effective += 1
      }
    }
    groupMap.set(key, group)
    if (String(site.status) === '已激活') {
      activated += 1
    }
    if (String(site.status) === '待校验') {
      verifying += 1
    }
  }
  const missingSites = sites
    .map((site) => ({ site, missing: missingConfigFields(site) }))
    .filter((item) => item.missing.length > 0)
    .map((item) => ({
      id: Number(item.site.id),
      站点编号: text(item.site, '站点编号'),
      域名地址: text(item.site, '域名地址'),
      站点负责人: text(item.site, '站点负责人') || '未指派',
      missing: item.missing,
    }))
  const conflicts = snaps
    .filter((row) => row.状态 === '冲突')
    .map((row) => {
      const effective = snaps.find(
        (item) => item.域名地址 === row.域名地址 && item.状态 === '生效',
      )
      return {
        域名地址: row.域名地址,
        生效快照编号: effective?.快照编号 ?? '—',
        生效请求方式: effective?.请求方式 ?? '—',
        冲突快照编号: row.快照编号,
        冲突请求方式: row.请求方式,
      }
    })
  const owners = [...new Set(sites.map((site) => text(site, '站点负责人')).filter(Boolean))]
  const cards = [
    { label: '采集站点总数', value: sites.length },
    { label: '已激活站点', value: activated },
    { label: '待校验站点', value: verifying },
    { label: '缺少配置站点', value: missingCount },
    { label: '已形成快照站点', value: snapshotCount },
  ]
  return {
    cards,
    groups: [...groupMap.values()],
    missingSites,
    conflicts,
    owners,
  }
}

export type SiteRowView = {
  row: EntryRow
  missing: string[]
  snapshot: SnapshotRow | null
}

export type SiteBoardDomain = {
  域名地址: string
  methods: { 请求方式: string; rows: SiteRowView[] }[]
}

/** 站点清单：按域名地址与请求方式展开，每行带上配置完整性与最新快照。 */
export function siteBoard(filters: Record<string, string> = {}): SiteBoardDomain[] {
  const matched = filterRows(listRows(SITE_KEY), filters)
  const domainMap = new Map<string, Map<string, SiteRowView[]>>()
  for (const row of matched) {
    const domain = text(row, '域名地址') || '未配置域名'
    const method = text(row, '请求方式') || '未配置'
    let methods = domainMap.get(domain)
    if (!methods) {
      methods = new Map()
      domainMap.set(domain, methods)
    }
    const bucket = methods.get(method) ?? []
    bucket.push({
      row,
      missing: missingConfigFields(row),
      snapshot: latestSnapshot(text(row, '站点编号')),
    })
    methods.set(method, bucket)
  }
  return [...domainMap.entries()].map(([域名地址, methods]) => ({
    域名地址,
    methods: [...methods.entries()].map(([请求方式, rows]) => ({ 请求方式, rows })),
  }))
}

export type SiteSnapshotDetail = {
  site: EntryRow | null
  snapshots: SnapshotRow[]
}

/** 按域名查询定位到单个站点，并给出它的全部请求配置快照（含历史版本）。 */
export function siteSnapshotDetail(query: string): SiteSnapshotDetail | null {
  const keyword = query.trim()
  if (!keyword) {
    return null
  }
  const site =
    listRows(SITE_KEY).find((row) => text(row, '域名地址').includes(keyword)) ?? null
  if (!site) {
    return { site: null, snapshots: [] }
  }
  const snapshots = listSnapshots()
    .filter((row) => row.站点编号 === text(site, '站点编号'))
    .sort((a, b) => b.版本 - a.版本)
  return { site, snapshots }
}

export type SpiderWorklist = {
  eligible: { site: EntryRow; snapshot: SnapshotRow }[]
  pendingJobs: EntryRow[]
  blockedCount: number
}

/** 采集任务可选的目标站点：请求配置完整且已形成快照（有效或生效）。 */
export function eligibleTargetSites(): { site: EntryRow; snapshot: SnapshotRow }[] {
  const result: { site: EntryRow; snapshot: SnapshotRow }[] = []
  for (const site of listRows(SITE_KEY)) {
    if (missingConfigFields(site).length > 0) {
      continue
    }
    const snapshot = latestSnapshot(text(site, '站点编号'))
    if (snapshot && SNAPSHOT_USABLE.includes(snapshot.状态)) {
      result.push({ site, snapshot })
    }
  }
  return result
}

/** 采集任务工作清单：可选目标站点 + 待执行清单（含被阻断数量）。 */
export function spiderWorklist(): SpiderWorklist {
  const pendingJobs = listRows(SPIDER_KEY).filter((row) => String(row.status) === '待执行')
  return {
    eligible: eligibleTargetSites(),
    pendingJobs,
    blockedCount: pendingJobs.filter((row) => text(row, '阻断原因') !== '').length,
  }
}

// ---------- 通用流转与导出 ----------

function runGenericAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === SITE_KEY) {
    return runSiteAction(id, action)
  }
  if (key === SPIDER_KEY) {
    return runSpiderAction(id, action)
  }
  return runGenericAction(key, id, action)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  if (key === SITE_KEY) {
    // 站点重置时连快照一起回到示例数据，避免旧快照挡住重新演示。
    resetSnapshots()
  }
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
