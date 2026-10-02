<template>
  <section class="page" data-module="feature">
    <header class="page-head">
      <div>
        <h2>遗迹单位管理</h2>
        <p class="page-desc">
          维护遗迹单位，围绕单位编号、遗迹类型、所属探方、开口层位做登记、筛选与状态流转。
          现场回来可一次勾选多条整批提交清理，逐条返回校验结果；归属环节只能待清理→清理中→已绘图→已归位逐档推进。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="selectedIds.length === 0" @click="submitBatch">
          整批提交清理（已选 {{ selectedIds.length }} 条）
        </button>
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
      <label class="filter-item">
        <span>单位编号</span>
        <input v-model="filters['单位编号']" placeholder="按单位编号检索" />
      </label>
      <label class="filter-item">
        <span>遗迹类型</span>
        <select v-model="filters['遗迹类型']">
          <option value="">全部类型</option>
          <option v-for="type in featureTypes" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>所属探方</span>
        <input v-model="filters['所属探方']" placeholder="按所属探方检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              :checked="allVisibleSelected"
              :indeterminate.prop="someVisibleSelected"
              aria-label="全选本页"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="col-check">
            <input v-model="selectedIds" type="checkbox" :value="Number(row.id)" aria-label="选择该单位" />
          </td>
          <td v-for="column in columns" :key="column">
            <template v-if="column === '单位编号'">
              <RouterLink class="link" :to="detailLink(row)">{{ row[column] || '—' }}</RouterLink>
            </template>
            <template v-else-if="isMissing(row, column)">
              <span class="missing-tag">缺{{ column }}</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
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
            <RouterLink class="link" :to="detailLink(row)">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的遗迹单位</td>
        </tr>
      </tbody>
    </table>

    <p v-if="rows.length" class="batch-hint">
      勾选后整批提交清理：开口层位、平面形状缺项的逐条标出但不挡其余；同一单位编号重复提交只处理头一回；
      缺项补齐的先后顺序由探方负责人判定。
    </p>

    <div v-if="batchResult" class="result-panel">
      <div class="result-head">
        <strong>整批提交清理结果</strong>
        <span>共 {{ batchResult.total }} 条 · 进入清理中 {{ batchResult.accepted }} 条 · 未通过 {{ batchResult.rejected }} 条</span>
        <button
          v-if="batchResult.rejected > 0"
          class="btn"
          type="button"
          @click="downloadRejections"
        >
          导出未通过说明
        </button>
        <button class="btn ghost" type="button" @click="batchResult = null">收起</button>
      </div>
      <table class="data-table result-table">
        <thead>
          <tr><th>单位编号</th><th>提交前状态</th><th>处理结果</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in batchResult.items" :key="item.id" :class="item.accepted ? 'row-ok' : 'row-bad'">
            <td>{{ item.code }}</td>
            <td>{{ item.currentStatus || '未找到' }}</td>
            <td>
              <span v-if="item.accepted" class="tag tag-ok">已进入{{ item.targetStatus }}</span>
              <span v-else-if="item.duplicate" class="tag tag-skip">重复跳过</span>
              <span v-else class="tag tag-bad">校验未过</span>
            </td>
            <td>{{ item.reasons.join('；') || '校验通过，已进入清理中' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条遗迹单位记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  downloadEntries,
  downloadRejectionReport,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  runBatchAction,
} from '@/api/local-service'
import type { BatchActionResult, EntryRow } from '@/data/types'

const meta = moduleMeta('feature')
const columns = ['单位编号', '遗迹类型', '所属探方', '开口层位', '平面形状', '现存深度', '保存状况', '单位状态']
const actions = ['提交清理', '完成绘图', '登记归位']
const requiredForClean = meta.requiredFields?.['提交清理'] ?? []
const statuses = meta.statuses

const route = useRoute()
const router = useRouter()

function queryToFilters(): Record<string, string> {
  return {
    单位编号: typeof route.query.code === 'string' ? route.query.code : '',
    遗迹类型: typeof route.query.type === 'string' ? route.query.type : '',
    所属探方: typeof route.query.trench === 'string' ? route.query.trench : '',
  }
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>(queryToFilters())
const selectedIds = ref<number[]>([])
const batchResult = ref<BatchActionResult | null>(null)

const featureTypes = computed(() => {
  const source = listEntries(meta.key).items
  return [...new Set(source.map((row) => String(row['遗迹类型'] ?? '')).filter(Boolean))]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待清理单位', value: countByStatus('待清理') },
  { label: '清理中单位', value: countByStatus('清理中') },
  { label: '已绘图单位', value: countByStatus('已绘图') },
  { label: '已归位单位', value: countByStatus('已归位') },
])

function countByStatus(status: string): number {
  return listEntries(meta.key).items.filter((row) => String(row.status) === status).length
}

const visibleIds = computed(() => rows.value.map((row) => Number(row.id)))
const allVisibleSelected = computed(
  () => visibleIds.value.length > 0 && visibleIds.value.every((id) => selectedIds.value.includes(id)),
)
const someVisibleSelected = computed(
  () => !allVisibleSelected.value && visibleIds.value.some((id) => selectedIds.value.includes(id)),
)

function isMissing(row: EntryRow, column: string): boolean {
  return requiredForClean.includes(column) && String(row[column] ?? '').trim() === ''
}

function detailLink(row: EntryRow) {
  return { path: `/feature/${row.id}`, query: syncQuery() }
}

function syncQuery(): Record<string, string> {
  return {
    ...(filters.value['单位编号']?.trim() ? { code: filters.value['单位编号'].trim() } : {}),
    ...(filters.value['遗迹类型']?.trim() ? { type: filters.value['遗迹类型'].trim() } : {}),
    ...(filters.value['所属探方']?.trim() ? { trench: filters.value['所属探方'].trim() } : {}),
  }
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  if (checked) {
    selectedIds.value = [...new Set([...selectedIds.value, ...visibleIds.value])]
  } else {
    const visible = new Set(visibleIds.value)
    selectedIds.value = selectedIds.value.filter((id) => !visible.has(id))
  }
}

function resetFilters() {
  filters.value = { 单位编号: '', 遗迹类型: '', 所属探方: '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function submitBatch() {
  errorMessage.value = ''
  noticeMessage.value = ''
  if (selectedIds.value.length === 0) {
    errorMessage.value = '请先勾选要提交清理的遗迹单位'
    return
  }
  batchResult.value = runBatchAction(meta.key, [...selectedIds.value], '提交清理', '单位编号')
  selectedIds.value = []
  reload()
}

function downloadRejections() {
  if (batchResult.value) {
    downloadRejectionReport(meta.key, batchResult.value)
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const query = syncQuery()
    if (JSON.stringify(query) !== JSON.stringify(route.query)) {
      router.replace({ name: 'feature', query })
    }
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遗迹单位列表读取失败'
  }
}

onMounted(reload)
</script>
