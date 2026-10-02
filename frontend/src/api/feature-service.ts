import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 遗迹单位的归属环节只能一档一档往下推进：待清理 → 清理中 → 已绘图 → 已归位。
const STAGE_FLOW = ['待清理', '清理中', '已绘图', '已归位'] as const
type Stage = (typeof STAGE_FLOW)[number]

const ACTION_TARGETS: Record<string, Stage> = {
  提交清理: '清理中',
  完成绘图: '已绘图',
  登记归位: '已归位',
}

// 进清理前必须登记齐全的字段：缺了逐行标出来，但不挡住同批其余几条。
const REQUIRED_FIELDS = ['开口层位', '平面形状'] as const

// 缺项补齐优先级只允许探方负责人判定。
export const FILL_PRIORITIES = ['高', '中', '低'] as const
export const PRIORITY_ROLE = '探方负责人'

export type CleaningCheckItem = {
  id: number
  unitCode: string
  ok: boolean
  duplicate: boolean
  reasons: string[]
}

export type CleaningBatchResult = {
  items: CleaningCheckItem[]
  passed: number
  failed: number
  skipped: number
}

function featureRows(): EntryRow[] {
  return listRows('feature')
}

// 清单与详情两处都从这里取同一份遗迹单位数据。
export function getFeature(id: number): EntryRow | null {
  return featureRows().find((row) => Number(row.id) === id) ?? null
}

export function missingRequiredFields(row: EntryRow): string[] {
  return REQUIRED_FIELDS.filter((field) => String(row[field] ?? '').trim() === '')
}

// 逐条校验能不能进清理：先卡归属环节，再查开口层位、平面形状。返回空数组表示通过。
export function cleaningRejectReasons(row: EntryRow): string[] {
  const reasons: string[] = []
  const status = String(row.status)
  if (status !== '待清理') {
    reasons.push(`归属环节已到「${status}」，不能提交清理`)
  }
  for (const field of missingRequiredFields(row)) {
    reasons.push(`缺${field}`)
  }
  return reasons
}

// 批量提交清理：同一单位编号一批里只处理头一回，通过的进清理中，未通过的逐条给出原因。
export function submitCleaningBatch(ids: number[]): CleaningBatchResult {
  const rows = featureRows()
  const items: CleaningCheckItem[] = []
  const seen = new Set<string>()
  const passedIds = new Set<number>()

  for (const id of ids) {
    const row = rows.find((item) => Number(item.id) === id)
    if (!row) {
      items.push({ id, unitCode: `记录 ${id}`, ok: false, duplicate: false, reasons: ['没有找到这条遗迹单位'] })
      continue
    }
    const unitCode = String(row['单位编号'] ?? `记录 ${id}`)
    // 同一单位编号连着提两回只处理一次，避免冒出两条清理记录。
    if (seen.has(unitCode)) {
      items.push({ id, unitCode, ok: false, duplicate: true, reasons: ['同一单位编号重复提交，只处理一次，已跳过'] })
      continue
    }
    seen.add(unitCode)
    const reasons = cleaningRejectReasons(row)
    if (reasons.length === 0) {
      passedIds.add(Number(row.id))
    }
    items.push({ id: Number(row.id), unitCode, ok: reasons.length === 0, duplicate: false, reasons })
  }

  if (passedIds.size > 0) {
    const next = rows.map((row) =>
      passedIds.has(Number(row.id)) ? { ...row, status: '清理中', pending: true } : row,
    )
    saveRows('feature', next)
  }

  return {
    items,
    passed: items.filter((item) => item.ok).length,
    failed: items.filter((item) => !item.ok && !item.duplicate).length,
    skipped: items.filter((item) => item.duplicate).length,
  }
}

// 单条环节流转：提交清理复用批量校验，其余动作校验「只能往前走一档」。
export function advanceFeature(id: number, action: string): ActionResult {
  const target = ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `遗迹单位没有登记「${action}」这个动作` }
  }
  if (action === '提交清理') {
    const result = submitCleaningBatch([id])
    const item = result.items[0]
    if (!item || !item.ok) {
      return { ok: false, message: `未通过清理校验：${(item?.reasons ?? ['没有找到这条遗迹单位']).join('；')}` }
    }
    return { ok: true, message: `遗迹单位 ${item.unitCode} 已提交清理，当前状态「清理中」` }
  }
  const rows = featureRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的遗迹单位` }
  }
  const row = rows[index]
  const currentStage = STAGE_FLOW.indexOf(String(row.status) as Stage)
  const targetStage = STAGE_FLOW.indexOf(target)
  if (targetStage !== currentStage + 1) {
    return {
      ok: false,
      message: `遗迹单位当前在「${String(row.status)}」，不能${action}：归属环节只能一档一档往下推进（${STAGE_FLOW.join(' → ')}）`,
    }
  }
  const next = [...rows]
  next[index] = { ...row, status: target, pending: target !== '已归位' }
  saveRows('feature', next)
  return { ok: true, message: `遗迹单位已${action}，当前状态「${target}」` }
}

// 登记归位：必须走到「已绘图」，归位结论同步落到验收台账。
export function archiveFeature(id: number, conclusion: string, operator: string): ActionResult {
  const rows = featureRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的遗迹单位` }
  }
  const row = rows[index]
  if (String(row.status) !== '已绘图') {
    return {
      ok: false,
      message: `遗迹单位当前在「${String(row.status)}」，要走到「已绘图」才能登记归位`,
    }
  }
  const text = conclusion.trim()
  if (!text) {
    return { ok: false, message: '归位结论不能为空，这条结论要落到验收台账' }
  }
  const next = [...rows]
  next[index] = { ...row, status: '已归位', pending: false, 归位结论: text }
  saveRows('feature', next)
  appendAcceptanceRecord(row, text, operator)
  return { ok: true, message: '遗迹单位已登记归位，归位结论已落入验收台账' }
}

function appendAcceptanceRecord(row: EntryRow, conclusion: string, operator: string): void {
  const rows = listRows('acceptance')
  const nextId = rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const nextSeq = rows.reduce((max, item) => {
    const match = /^ACCE-(\d+)$/.exec(String(item['验收单号'] ?? ''))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  const record: EntryRow = {
    id: nextId,
    status: '待验收',
    pending: true,
    abnormal: false,
    验收单号: `ACCE-${String(nextSeq).padStart(4, '0')}`,
    验收探方: String(row['所属探方'] ?? ''),
    验收类别: '遗迹单位归位',
    验收人: operator,
    验收日期: new Date().toISOString().slice(0, 10),
    遗留问题数: 0,
    验收结论: `遗迹单位 ${String(row['单位编号'] ?? '')} 归位办结：${conclusion}`,
    验收状态: '待验收',
  }
  saveRows('acceptance', [...rows, record])
}

// 缺项补齐优先级：只能由探方负责人判定。
export function setFillPriority(id: number, priority: string, operator: string, role: string): ActionResult {
  if (role !== PRIORITY_ROLE) {
    return { ok: false, message: `缺项补齐优先级只能由${PRIORITY_ROLE}判定` }
  }
  if (!(FILL_PRIORITIES as readonly string[]).includes(priority)) {
    return { ok: false, message: `补齐优先级只能是 ${FILL_PRIORITIES.join(' / ')}` }
  }
  const rows = featureRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的遗迹单位` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 补齐优先级: priority, 优先级判定人: operator }
  saveRows('feature', next)
  return { ok: true, message: `缺项补齐优先级已定为「${priority}」（判定人：${operator}）` }
}

// 校验不过的那几条另出一份说明，可下载带走。
export function buildRejectionReport(items: CleaningCheckItem[], operator: string): { filename: string; content: string } {
  const failed = items.filter((item) => !item.ok && !item.duplicate)
  const lines = [
    '遗迹单位清理校验未通过说明',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    `经办人：${operator}`,
    '',
    `本次批量提交清理中，以下 ${failed.length} 条遗迹单位未通过校验，暂未进入清理中：`,
    '',
  ]
  failed.forEach((item, index) => {
    lines.push(`${index + 1}. 单位编号 ${item.unitCode}`)
    lines.push(`   未通过原因：${item.reasons.join('；')}`)
    if (item.reasons.some((reason) => reason.startsWith('缺'))) {
      lines.push(`   缺项补齐优先级：由${PRIORITY_ROLE}判定后在遗迹单位详情页登记`)
    }
    lines.push('')
  })
  lines.push('补齐缺项、复核归属环节后，可重新提交清理。')
  return { filename: '遗迹单位清理校验未通过说明.txt', content: lines.join('\n') }
}

export function downloadRejectionReport(items: CleaningCheckItem[], operator: string): void {
  const { filename, content } = buildRejectionReport(items, operator)
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
