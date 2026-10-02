<template>
  <section class="page" data-module="feature">
    <header class="page-head">
      <div>
        <h2>遗迹单位管理</h2>
        <p class="page-desc">
          维护遗迹单位，围绕单位编号、遗迹类型、所属探方、开口层位做登记、筛选与状态流转。可勾选多条整批提交清理，登记归位到详情页办理。
        </p>
      </div>
      <div class="page-actions">
        <button
          class="btn primary"
          type="button"
          :disabled="!selectedIds.length"
          @click="submitBatch"
        >
          批量提交清理（{{ selectedIds.length }}）
        </button>
        <button class="btn" type="button" @click="openCreate">登记遗迹单位</button>
        <button class="btn" type="button" @click="exportRows">导出遗迹单位清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <section v-if="batchResult" class="batch-panel">
      <h3>
        批量提交清理结果：通过 {{ batchResult.passed }} 条，未通过 {{ batchResult.failed }} 条
        <template v-if="batchResult.skipped">，重复提交跳过 {{ batchResult.skipped }} 条</template>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>单位编号</th>
            <th>逐条校验结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in batchResult.items" :key="item.id">
            <td>{{ item.unitCode }}</td>
            <td>
              <span v-if="item.ok" class="ok-text">校验通过，已进入清理中</span>
              <span v-else-if="item.duplicate" class="muted-text">{{ item.reasons.join('；') }}</span>
              <span v-else class="error-text">{{ item.reasons.join('；') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="batch-foot">
        <button v-if="batchResult.failed" class="btn" type="button" @click="downloadReport">
          导出未通过说明
        </button>
        <button class="btn ghost" type="button" @click="batchResult = null">收起结果</button>
      </p>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th class="check-col">
            <input type="checkbox" :checked="allChecked" @change="toggleAll" />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="check-col">
            <input v-model="selectedIds" type="checkbox" :value="Number(row.id)" />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
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
            <button class="link" type="button" @click="openDetail(row)">详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无遗迹单位数据，可先登记遗迹单位</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遗迹单位记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  advanceFeature,
  downloadRejectionReport,
  submitCleaningBatch,
} from '@/api/feature-service'
import type { CleaningBatchResult } from '@/api/feature-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('feature')
const columns = ["单位编号", "遗迹类型", "所属探方", "开口层位", "平面形状", "现存深度", "保存状况", "单位状态"]
const actions = ["提交清理", "完成绘图"]
const statuses = ["待清理", "清理中", "已绘图", "已归位"]
const stats = [{"label": "清理中单位", "value": 0}, {"label": "待清理单位", "value": 0}, {"label": "已绘图单位", "value": 0}]

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedIds = ref<number[]>([])
const batchResult = ref<CleaningBatchResult | null>(null)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const allChecked = computed(
  () => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)

function toggleAll() {
  selectedIds.value = allChecked.value ? [] : rows.value.map((row) => Number(row.id))
}

// 筛选条件同步到地址栏：按遗迹类型筛到某一条进详情，退回列表时条件还在。
function syncQuery() {
  const query: Record<string, string> = {}
  for (const field of filterFields) {
    const value = (filters.value[field] ?? '').trim()
    if (value) {
      query[field] = value
    }
  }
  router.replace({ query }).catch(() => {})
}

function restoreQuery() {
  for (const field of filterFields) {
    const value = route.query[field]
    if (typeof value === 'string' && value) {
      filters.value[field] = value
    }
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遗迹单位登记入口尚未接入审批流'
}

function submitBatch() {
  errorMessage.value = ''
  noticeMessage.value = ''
  batchResult.value = submitCleaningBatch(selectedIds.value)
  selectedIds.value = []
  reload()
}

function downloadReport() {
  if (!batchResult.value) {
    return
  }
  downloadRejectionReport(batchResult.value.items, store.operator)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = advanceFeature(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function openDetail(row: EntryRow) {
  router.push({ path: `/feature/${row.id}`, query: route.query })
}

function reload() {
  errorMessage.value = ''
  syncQuery()
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遗迹单位列表读取失败'
  }
}

onMounted(() => {
  restoreQuery()
  reload()
})
</script>
