/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 为 true 时动作只能把状态从当前档推进到紧挨着的下一档，不允许跳档或回退。
  linearFlow?: boolean
  // 每个动作执行前必须填齐的字段，缺一项就拦下这一条，但不影响同批其余条。
  requiredFields?: Record<string, string[]>
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 批量动作里每一条的处理结论：accepted=已处理，rejected=校验未过（不动数据）。
export type BatchItemResult = {
  id: number
  code: string
  accepted: boolean
  currentStatus: string
  targetStatus: string
  reasons: string[]
  // 同一单位编号在这批里重复提交时，第二次起标为重复，只处理头一回。
  duplicate?: boolean
}

export type BatchActionResult = {
  action: string
  total: number
  accepted: number
  rejected: number
  items: BatchItemResult[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
