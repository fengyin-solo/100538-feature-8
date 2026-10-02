<template>
  <section class="page" data-module="feature-detail">
    <header class="page-head">
      <div>
        <h2>遗迹单位详情</h2>
        <p class="page-desc">
          与清单取同一份遗迹单位数据。归属环节只能按 待清理 → 清理中 → 已绘图 → 已归位 逐档推进，归位结论会写入验收台账。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="{ name: 'feature', query: backQuery }">退回列表</RouterLink>
      </div>
    </header>

    <article v-if="row" class="detail-card">
      <div class="detail-title">
        <h3>{{ row['单位编号'] }} · {{ row['遗迹类型'] }}</h3>
        <span class="status-badge">{{ row.status }}</span>
      </div>

      <dl class="detail-grid">
        <div v-for="field in meta.fields" :key="field" class="detail-item">
          <dt>{{ field }}</dt>
          <dd>
            <span v-if="isMissing(field)" class="missing-tag">缺{{ field }}（提交清理前需补齐）</span>
            <template v-else>{{ row[field] || '—' }}</template>
          </dd>
        </div>
        <div class="detail-item">
          <dt>当前状态</dt>
          <dd>{{ row.status }}</dd>
        </div>
      </dl>

      <div class="detail-flow">
        <template v-for="(status, index) in meta.statuses" :key="status">
          <span class="flow-step" :class="{ active: status === row.status, done: isDone(index) }">{{ status }}</span>
          <span v-if="index < meta.statuses.length - 1" class="flow-arrow">→</span>
        </template>
      </div>

      <div class="detail-actions">
        <button
          v-for="action in meta.actions"
          :key="action"
          class="btn"
          :class="{ primary: action === '提交清理' }"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </div>
      <p class="detail-note">开口层位、平面形状缺项时提交清理会被拦下；缺项补齐的优先级由探方负责人判定。</p>
    </article>

    <div v-else class="detail-card">
      <p class="empty-state">没有找到这条遗迹单位，可能已被重置或编号有误。</p>
      <RouterLink class="btn" :to="{ name: 'feature', query: backQuery }">退回列表</RouterLink>
    </div>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getEntry, moduleMeta, runAction as applyAction } from '@/api/local-service'

const meta = moduleMeta('feature')
const requiredForClean = meta.requiredFields?.['提交清理'] ?? []

const route = useRoute()

const errorMessage = ref('')
const noticeMessage = ref('')
const version = ref(0)

const entryId = computed(() => Number(route.params.id))
const row = computed(() => {
  // version 变化时重新从同一份本地存储取数，保证动作后详情即时刷新。
  void version.value
  return getEntry(meta.key, entryId.value)
})

// 退回列表时带上进入详情前的筛选条件（按遗迹类型筛到某一条再退得回去）。
const backQuery = computed(() => {
  const query: Record<string, string> = {}
  for (const key of ['code', 'type', 'trench']) {
    if (typeof route.query[key] === 'string') {
      query[key] = route.query[key] as string
    }
  }
  return query
})

function isMissing(field: string): boolean {
  return Boolean(row.value) && requiredForClean.includes(field) && String(row.value?.[field] ?? '').trim() === ''
}

function isDone(index: number): boolean {
  if (!row.value) {
    return false
  }
  return index < meta.statuses.indexOf(String(row.value.status))
}

function runAction(action: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, entryId.value, action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  if (action === '登记归位') {
    noticeMessage.value += '，归位结论已写入验收台账'
  }
  version.value += 1
}

watch(entryId, () => {
  errorMessage.value = ''
  noticeMessage.value = ''
})
</script>
