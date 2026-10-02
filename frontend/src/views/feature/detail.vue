<template>
  <section class="page" data-module="feature-detail">
    <header class="page-head">
      <div>
        <h2>遗迹单位详情</h2>
        <p class="page-desc">
          与清单共用同一份遗迹单位数据；归属环节一档一档往下推进，缺项补齐优先级由探方负责人在此判定。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
      </div>
    </header>

    <p v-if="!row" class="empty-state">没有找到这条遗迹单位，可能已被移除。</p>

    <template v-else>
      <p class="status-legend">
        <span
          v-for="stage in stages"
          :key="stage"
          class="legend-item"
          :class="{ active: stage === row.status }"
        >
          {{ stage }}
        </span>
      </p>

      <p v-if="missing.length" class="warn-text">
        缺{{ missing.join('、') }}，暂不能提交清理；补齐登记后再提交。
      </p>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ row[field] || '—' }}</td>
          </tr>
          <tr>
            <th>当前状态</th>
            <td>{{ row.status }}</td>
          </tr>
          <tr v-if="row['归位结论']">
            <th>归位结论</th>
            <td>{{ row['归位结论'] }}</td>
          </tr>
        </tbody>
      </table>

      <section v-if="missing.length || row['补齐优先级']" class="panel">
        <h3>缺项补齐优先级（探方负责人判定）</h3>
        <p class="panel-desc">
          当前缺项：{{ missing.length ? missing.join('、') : '已补齐' }}；
          当前优先级：{{ row['补齐优先级'] || '未判定' }}
          <template v-if="row['优先级判定人']">（判定人：{{ row['优先级判定人'] }}）</template>
        </p>
        <div class="priority-row">
          <label v-for="item in priorities" :key="item" class="priority-item">
            <input v-model="priority" type="radio" name="fill-priority" :value="item" />
            {{ item }}
          </label>
          <button class="btn primary" type="button" @click="savePriority">判定优先级</button>
        </div>
      </section>

      <section class="panel">
        <h3>环节流转</h3>
        <div v-if="row.status === '待清理'" class="panel-actions">
          <button class="btn primary" type="button" @click="runAction('提交清理')">提交清理</button>
        </div>
        <div v-else-if="row.status === '清理中'" class="panel-actions">
          <button class="btn primary" type="button" @click="runAction('完成绘图')">完成绘图</button>
        </div>
        <div v-else-if="row.status === '已绘图'" class="panel-actions archive-form">
          <label class="filter-item">
            <span>归位结论（登记后落到验收台账）</span>
            <textarea
              v-model="archiveConclusion"
              rows="3"
              placeholder="填写归位结论，登记后同步到验收台账"
            ></textarea>
          </label>
          <button class="btn primary" type="button" @click="archive">登记归位</button>
        </div>
        <p v-else class="panel-desc">已归位，归属环节已走完；归位结论已同步到验收台账。</p>
      </section>

      <footer class="page-foot">
        <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  FILL_PRIORITIES,
  advanceFeature,
  archiveFeature,
  getFeature,
  missingRequiredFields,
  setFillPriority,
} from '@/api/feature-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const fields = ["单位编号", "遗迹类型", "所属探方", "开口层位", "平面形状", "现存深度", "保存状况", "单位状态"]
const stages = ["待清理", "清理中", "已绘图", "已归位"]
const priorities = FILL_PRIORITIES

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const row = ref<EntryRow | null>(null)
const priority = ref<string>(FILL_PRIORITIES[1])
const archiveConclusion = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')

const missing = computed(() => (row.value ? missingRequiredFields(row.value) : []))

function featureId(): number {
  return Number(route.params.id)
}

function reload() {
  row.value = getFeature(featureId())
  if (row.value && row.value['补齐优先级']) {
    priority.value = String(row.value['补齐优先级'])
  }
}

// 退回列表时把来时的筛选条件带回去。
function goBack() {
  router.push({ path: '/feature', query: route.query })
}

function runAction(action: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = advanceFeature(featureId(), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function archive() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = archiveFeature(featureId(), archiveConclusion.value, store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  archiveConclusion.value = ''
  reload()
}

function savePriority() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = setFillPriority(featureId(), priority.value, store.operator, store.role)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

onMounted(reload)
</script>
