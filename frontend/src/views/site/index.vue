<template>
  <section class="page" data-module="site">
    <header class="page-head">
      <div>
        <h2>站点管理 · 站点接入总览</h2>
        <p class="page-desc">
          采集站点是站点接入的唯一总览入口：按请求方式与字符编码归集，缺少配置与请求方式冲突一眼可见。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记采集站点</button>
        <button class="btn" type="button" @click="exportRows">导出站点清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in overview.cards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="panel">
      <h3>接入总览（按请求方式 × 字符编码归集）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>请求方式</th>
            <th>字符编码</th>
            <th>站点数</th>
            <th>配置完整</th>
            <th>缺少配置</th>
            <th>已形成快照</th>
            <th>生效快照</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in overview.groups" :key="`${group.请求方式}-${group.字符编码}`">
            <td>{{ group.请求方式 }}</td>
            <td>{{ group.字符编码 }}</td>
            <td>{{ group.total }}</td>
            <td>{{ group.complete }}</td>
            <td>
              <span v-if="group.missing" class="warn-text">{{ group.missing }}</span>
              <span v-else>0</span>
            </td>
            <td>{{ group.snapshotted }}</td>
            <td>{{ group.effective }}</td>
          </tr>
          <tr v-if="!overview.groups.length">
            <td colspan="7" class="empty-state">暂无采集站点记录</td>
          </tr>
        </tbody>
      </table>
      <p v-if="overview.missingSites.length" class="flag-line">
        <span class="flag-label">缺少配置：</span>
        <span v-for="item in overview.missingSites" :key="item.id" class="legend-item warn-chip">
          {{ item.站点编号 }} · {{ item.域名地址 }}（负责人 {{ item.站点负责人 }}）缺 {{ item.missing.join('、') }}
        </span>
      </p>
      <p v-if="overview.conflicts.length" class="flag-line">
        <span class="flag-label">请求方式冲突：</span>
        <span v-for="item in overview.conflicts" :key="item.冲突快照编号" class="legend-item warn-chip">
          {{ item.域名地址 }}：以生效快照 {{ item.生效快照编号 }}（{{ item.生效请求方式 }}）为准，{{ item.冲突快照编号 }}（{{ item.冲突请求方式 }}）已标记冲突
        </span>
      </p>
      <p v-if="!overview.missingSites.length && !overview.conflicts.length" class="hint-text">
        全部站点请求配置完整，且无请求方式冲突。
      </p>
    </section>

    <form class="filter-bar" @submit.prevent="search">
      <label class="filter-item">
        <span>站点负责人</span>
        <input v-model="filters['站点负责人']" list="owner-options" placeholder="按负责人检索" />
        <datalist id="owner-options">
          <option v-for="owner in overview.owners" :key="owner" :value="owner" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>域名地址</span>
        <input v-model="filters['域名地址']" placeholder="按域名查询并定位快照" />
      </label>
      <label class="filter-item">
        <span>请求方式</span>
        <input v-model="filters['请求方式']" placeholder="按请求方式检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <section v-if="snapshotDetail" class="panel">
      <h3>
        单站请求配置快照 ·
        {{ snapshotDetail.site ? snapshotDetail.site['域名地址'] : filters['域名地址'] }}
      </h3>
      <table v-if="snapshotDetail.site && snapshotDetail.snapshots.length" class="data-table">
        <thead>
          <tr>
            <th>快照编号</th>
            <th>版本</th>
            <th>状态</th>
            <th>请求方式</th>
            <th>字符编码</th>
            <th>请求头模板</th>
            <th>Cookie配置</th>
            <th>核验批次</th>
            <th>生成时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="snap in snapshotDetail.snapshots" :key="snap.id">
            <td>{{ snap.快照编号 }}</td>
            <td>v{{ snap.版本 }}</td>
            <td><span class="badge" :class="badgeClass(snap.状态)">{{ snap.状态 }}</span></td>
            <td>{{ snap.请求方式 }}</td>
            <td>{{ snap.字符编码 }}</td>
            <td>{{ snap.请求头模板 }}</td>
            <td>{{ snap.Cookie配置 }}</td>
            <td>{{ snap.核验批次 }}</td>
            <td>{{ snap.生成时间 }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint-text">
        {{ snapshotDetail.site ? '该站点尚未形成请求配置快照，请先提交校验。' : '未找到该域名对应的采集站点。' }}
      </p>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th>站点编号</th>
          <th>站点类型</th>
          <th>字符编码</th>
          <th>站点负责人</th>
          <th>配置完整性</th>
          <th>请求配置快照</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody v-for="domain in board" :key="domain.域名地址">
        <tr class="group-row">
          <td colspan="8">域名地址：{{ domain.域名地址 }}</td>
        </tr>
        <template v-for="method in domain.methods" :key="method.请求方式">
          <tr class="subgroup-row">
            <td colspan="8">请求方式：{{ method.请求方式 }}（{{ method.rows.length }} 个站点）</td>
          </tr>
          <tr v-for="item in method.rows" :key="String(item.row.id)">
            <td>{{ item.row['站点编号'] }}</td>
            <td>{{ item.row['站点类型'] }}</td>
            <td>{{ item.row['字符编码'] || '—' }}</td>
            <td>{{ item.row['站点负责人'] }}</td>
            <td>
              <span v-if="!item.missing.length" class="badge ok">完整</span>
              <span v-else class="badge warn">缺：{{ item.missing.join('、') }}</span>
            </td>
            <td>
              <span v-if="item.snapshot" class="badge" :class="badgeClass(item.snapshot.状态)">
                {{ item.snapshot.快照编号 }} · v{{ item.snapshot.版本 }} · {{ item.snapshot.状态 }}
              </span>
              <span v-else class="hint-text">未生成</span>
            </td>
            <td>{{ item.row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, item.row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
        </template>
      </tbody>
      <tbody v-if="!board.length">
        <tr>
          <td colspan="8" class="empty-state">暂无符合条件的采集站点，可调整检索条件或先登记</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条采集站点记录 · 站点清单按域名地址与请求方式展开</span>
      <span v-if="message" :class="messageOk ? 'hint-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  siteBoard,
  siteOnboarding,
  siteSnapshotDetail,
} from '@/api/local-service'
import type {
  SiteBoardDomain,
  SiteOnboardingResult,
  SiteSnapshotDetail,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('site')
const actions = meta.actions

const overview = ref<SiteOnboardingResult>({
  cards: [],
  groups: [],
  missingSites: [],
  conflicts: [],
  owners: [],
})
const board = ref<SiteBoardDomain[]>([])
const snapshotDetail = ref<SiteSnapshotDetail | null>(null)
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
const filters = ref<Record<string, string>>({})

function badgeClass(status: string): string {
  if (status === '生效') return 'ok'
  if (status === '有效') return 'info'
  if (status === '冲突') return 'warn'
  return 'muted'
}

function reload() {
  overview.value = siteOnboarding()
  board.value = siteBoard(filters.value)
  total.value = listEntries(meta.key, filters.value).total
  const keyword = (filters.value['域名地址'] ?? '').trim()
  snapshotDetail.value = keyword ? siteSnapshotDetail(keyword) : null
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
  message.value = '采集站点登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  reload()
  messageOk.value = result.ok
  message.value = result.message
}

onMounted(reload)
</script>
