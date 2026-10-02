import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  BatchActionResult,
  BatchItemResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

// 清单与详情取同一份数据：按 id 直接从同一个本地存储里拿。
export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === Number(id))
}

function isEmptyValue(value: string | number | boolean | undefined): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function missingFields(meta: ModuleMeta, row: EntryRow, action: string): string[] {
  const required = meta.requiredFields?.[action] ?? []
  return required.filter((field) => isEmptyValue(row[field]))
}

// 线性流转：当前档必须正好是目标档的前一档。待清理→清理中→已绘图→已归位，不能跳也不能回头。
function linearBlocked(meta: ModuleMeta, current: string, target: string): boolean {
  if (!meta.linearFlow) {
    return false
  }
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  return targetIndex !== currentIndex + 1
}

function blockedMessage(meta: ModuleMeta, action: string, current: string, target: string): string {
  if (current === target) {
    return `${meta.entity}已经是「${target}」，不用重复操作`
  }
  // 已绘图之后只剩「登记归位」，再回头提交清理要明确拦下。
  if (action === '提交清理' && (current === '已绘图' || current === '已归位')) {
    return `当前状态为「${current}」，归属环节只能一档档向前推进，不能再提交清理`
  }
  return `当前状态为「${current}」，需按顺序推进，不能直接${action}到「${target}」`
}

function applyTransition(meta: ModuleMeta, rows: EntryRow[], index: number, action: string): EntryRow {
  const target = meta.actionTargets[action]
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  return {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
}

// 归位办完的结论落到验收台账：feature 登记归位成功后，往 acceptance 模块追加一条台账。
// 按验收单号幂等，重复归位（理论上线性流转会先拦下）也不会冒出两条。
function appendAcceptanceLedger(feature: EntryRow): void {
  const ledgerKey = 'acceptance'
  const ledger = [...listRows(ledgerKey)]
  const code = String(feature['单位编号'] ?? '')
  const serial = `FEAT-GW-${code}`
  if (ledger.some((row) => String(row['验收单号']) === serial)) {
    return
  }
  const nextId = ledger.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const today = new Date().toISOString().slice(0, 10)
  const entry: EntryRow = {
    id: nextId,
    status: '已通过',
    pending: false,
    abnormal: false,
    验收单号: serial,
    验收探方: String(feature['所属探方'] ?? ''),
    验收类别: '遗迹单位归位',
    验收人: '探方负责人',
    验收日期: today,
    遗留问题数: 0,
    验收结论: `遗迹单位 ${code} 已归位，归位结论已登记`,
    验收状态: '已通过',
  }
  ledger.push(entry)
  saveRows(ledgerKey, ledger)
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = [...listRows(key)]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: blockedMessage(meta, action, current, target) }
  }
  if (linearBlocked(meta, current, target)) {
    return { ok: false, message: blockedMessage(meta, action, current, target) }
  }
  const missing = missingFields(meta, rows[index], action)
  if (missing.length > 0) {
    return {
      ok: false,
      message: `记录单缺项：${missing.join('、')}未填写，补齐后才能${action}（补齐优先级由探方负责人判定）`,
    }
  }
  const updated = applyTransition(meta, rows, index, action)
  rows[index] = updated
  saveRows(key, rows)
  if (key === 'feature' && action === '登记归位') {
    appendAcceptanceLedger(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 整批提交：逐条给出校验结果，缺项/跳档的逐行标出但不挡其余几条，合格的照常推进。
// 同一单位编号连着提两回只处理第一次，第二次记为重复，避免冒出两条清理记录。
export function runBatchAction(
  key: string,
  ids: number[],
  action: string,
  codeField = '编号',
): BatchActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    throw new Error(`${meta.entity}没有登记「${action}」这个动作`)
  }
  const rows = [...listRows(key)]
  const seenCodes = new Set<string>()
  const results: BatchItemResult[] = []
  const updates = new Map<number, EntryRow>()

  ids.forEach((id) => {
    const index = rows.findIndex((item) => Number(item.id) === Number(id))
    if (index < 0) {
      results.push({
        id,
        code: `#${id}`,
        accepted: false,
        currentStatus: '',
        targetStatus: target,
        reasons: [`没有找到该${meta.entity}`],
      })
      return
    }
    const row = rows[index]
    const code = String(row[codeField] ?? `#${id}`)
    const current = String(row.status)
    const reasons: string[] = []
    const duplicate = seenCodes.has(code)
    if (duplicate) {
      reasons.push(`单位编号 ${code} 在本批重复提交，只处理头一回，本次跳过`)
    } else {
      seenCodes.add(code)
    }
    if (current === target) {
      reasons.push(`${meta.entity}已经是「${target}」，不用重复操作`)
    } else if (linearBlocked(meta, current, target)) {
      reasons.push(blockedMessage(meta, action, current, target))
    }
    const missing = duplicate ? [] : missingFields(meta, row, action)
    if (missing.length > 0) {
      reasons.push(`记录单缺项：${missing.join('、')}未填写（补齐优先级由探方负责人判定）`)
    }

    const accepted = !duplicate && reasons.length === 0
    results.push({
      id: Number(row.id),
      code,
      accepted,
      currentStatus: current,
      targetStatus: target,
      reasons,
      duplicate,
    })
    if (accepted) {
      updates.set(Number(row.id), applyTransition(meta, rows, index, action))
    }
  })

  if (updates.size > 0) {
    const next = rows.map((row) => updates.get(Number(row.id)) ?? row)
    saveRows(key, next)
    if (key === 'feature' && action === '登记归位') {
      updates.forEach((row) => appendAcceptanceLedger(row))
    }
  }

  return {
    action,
    total: ids.length,
    accepted: results.filter((item) => item.accepted).length,
    rejected: results.filter((item) => !item.accepted).length,
    items: results,
  }
}

// 校验不过的几条另有一份说明：导出 CSV，逐行写清单位编号、当前状态与拦下原因。
export function rejectionReport(
  meta: ModuleMeta,
  result: BatchActionResult,
): { filename: string; content: string } {
  const header = ['单位编号', '当前状态', '拟办动作', '处理结果', '未通过原因']
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
  const lines = [header.join(',')]
  for (const item of result.items) {
    lines.push(
      [
        item.code,
        item.currentStatus || '未找到',
        result.action,
        item.accepted ? '已处理' : item.duplicate ? '重复跳过' : '校验未过',
        item.reasons.join('；') || '—',
      ]
        .map(escape)
        .join(','),
    )
  }
  return {
    filename: `${meta.name}-${result.action}-校验说明.csv`,
    content: `﻿${lines.join('\n')}`,
  }
}

export function downloadRejectionReport(key: string, result: BatchActionResult): void {
  const meta = moduleMeta(key)
  const { filename, content } = rejectionReport(meta, result)
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

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
