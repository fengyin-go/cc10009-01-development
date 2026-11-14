<template>
  <section class="page" data-module="spider">
    <header class="page-head">
      <div>
        <h2>采集任务管理</h2>
        <p class="page-desc">维护采集作业的输入、执行约束与结果记录，为采集任务提供可验证的数据工程流程。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记采集作业</button>
        <button class="btn" type="button" @click="exportRows">导出采集任务清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="panel">
      <h3>可选目标站点（仅请求配置完整且已形成快照）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>站点编号</th>
            <th>域名地址</th>
            <th>请求方式</th>
            <th>字符编码</th>
            <th>请求配置快照</th>
            <th>快照状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in worklist.eligible" :key="String(item.site.id)">
            <td>{{ item.site['站点编号'] }}</td>
            <td>{{ item.site['域名地址'] }}</td>
            <td>{{ item.site['请求方式'] }}</td>
            <td>{{ item.site['字符编码'] }}</td>
            <td>{{ item.snapshot.快照编号 }} · v{{ item.snapshot.版本 }}</td>
            <td>
              <span class="badge" :class="item.snapshot.状态 === '生效' ? 'ok' : 'info'">
                {{ item.snapshot.状态 }}
              </span>
            </td>
          </tr>
          <tr v-if="!worklist.eligible.length">
            <td colspan="6" class="empty-state">
              暂无可用目标站点，请先在站点管理中完善请求配置并提交校验
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3>待执行清单（{{ worklist.pendingJobs.length }} 条 · 被阻断 {{ worklist.blockedCount }} 条）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>作业编号</th>
            <th>目标站点</th>
            <th>抽取模板</th>
            <th>阻断原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in worklist.pendingJobs" :key="String(job.id)">
            <td>{{ job['作业编号'] }}</td>
            <td>{{ job['目标站点'] }}</td>
            <td>{{ job['抽取模板'] }}</td>
            <td>
              <span v-if="job['阻断原因']" class="warn-text">{{ job['阻断原因'] }}</span>
              <span v-else class="hint-text">—</span>
            </td>
          </tr>
          <tr v-if="!worklist.pendingJobs.length">
            <td colspan="4" class="empty-state">待执行清单为空</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="search">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无采集任务数据，可先登记采集作业</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条采集任务记录</span>
      <span v-if="message" :class="messageOk ? 'hint-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  spiderWorklist,
} from '@/api/local-service'
import type { SpiderWorklist } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('spider')
const columns = ["作业编号", "目标站点", "抽取模板", "起始地址", "并发线程数", "请求间隔秒", "每日上限条数", "超时秒数"]
const actions = ["提交执行", "启动采集", "终止采集", "归档结果"]
const statuses = ["草稿", "待执行", "运行中", "已完成", "已失败"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref<{ label: string; value: number }[]>([])
const worklist = ref<SpiderWorklist>({ eligible: [], pendingJobs: [], blockedCount: 0 })
const message = ref('')
const messageOk = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function reload() {
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
  const all = listEntries(meta.key).items
  const list = spiderWorklist()
  worklist.value = list
  stats.value = [
    { label: '采集作业总数', value: all.length },
    { label: '待执行作业', value: all.filter((row) => String(row.status) === '待执行').length },
    { label: '运行中作业', value: all.filter((row) => String(row.status) === '运行中').length },
    { label: '已完成作业', value: all.filter((row) => String(row.status) === '已完成').length },
    { label: '被阻断站点数', value: list.blockedCount },
  ]
}

function search() {
  message.value = ''
  reload()
}

function resetFilters() {
  filters.value = {}
  message.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  messageOk.value = false
  message.value = '采集作业登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  reload()
  messageOk.value = result.ok
  message.value = result.message
}

onMounted(reload)
</script>
