import type { ContactEdge, SimulationEvent, SimulationRun } from '@/shared/document'
import { sortedEvents } from '@/features/replay/lib/eventOrder'

export const edgeLabels: Record<ContactEdge, string> = {
  front: '前缘', back: '尾缘', left: '左翼', right: '右翼',
  ramp: '坡面', split: '分岔臂', link: '机关连线', start: '手动起点',
}

export interface ContactRecord {
  key: string
  occurrence: number
  /** 在本路触点序列里的位置（第几次接触，0 起） */
  index: number
  event: SimulationEvent
}

export interface MatchedContact {
  matchId: number
  a: ContactRecord
  b: ContactRecord
}

export interface RunAlignment {
  pairs: MatchedContact[]
  unmatchedA: ContactRecord[]
  unmatchedB: ContactRecord[]
  /** 两条触点序列逐项相同的最长前缀长度（共同段），分岔从下一个触点开始 */
  commonLead: number
  diverged: boolean
  recordsA: ContactRecord[]
  recordsB: ContactRecord[]
}

function contactKey(event: SimulationEvent): string | null {
  if (!event.contact) return null
  return `${event.contact.sourceId ?? '∅'}→${event.pieceId}@${event.contact.edge}`
}

/**
 * 抽出一份运行里的全部触点（含手动起点），按时间排序。
 * 同一对牌碰两次时各自保留为独立记录：key 相同、occurrence 递增，绝不合并。
 */
export function contactRecords(run: SimulationRun): ContactRecord[] {
  const records: ContactRecord[] = []
  const counts = new Map<string, number>()
  for (const event of sortedEvents(run.events)) {
    const key = contactKey(event)
    if (key === null) continue
    const occurrence = (counts.get(key) ?? 0) + 1
    counts.set(key, occurrence)
    records.push({ key, occurrence, index: records.length, event })
  }
  return records
}

/**
 * 按触点身份（来源牌 → 接收牌 @ 接触边 + 第几次发生）对齐两份运行，
 * 不按事件在列表里的行号对齐——两边事件数不同也能正确对应。
 */
export function alignRuns(a: SimulationRun, b: SimulationRun): RunAlignment {
  const recordsA = contactRecords(a)
  const recordsB = contactRecords(b)
  const bByIdentity = new Map(recordsB.map(record => [`${record.key}#${record.occurrence}`, record]))

  const pairs: MatchedContact[] = []
  const unmatchedA: ContactRecord[] = []
  const matchedB = new Set<string>()
  for (const recordA of recordsA) {
    const hit = bByIdentity.get(`${recordA.key}#${recordA.occurrence}`)
    if (hit && !matchedB.has(hit.event.id)) {
      matchedB.add(hit.event.id)
      pairs.push({ matchId: pairs.length + 1, a: recordA, b: hit })
    } else {
      unmatchedA.push(recordA)
    }
  }
  const unmatchedB = recordsB.filter(record => !matchedB.has(record.event.id))

  let commonLead = 0
  while (
    commonLead < recordsA.length && commonLead < recordsB.length
    && recordsA[commonLead].key === recordsB[commonLead].key
    && recordsA[commonLead].occurrence === recordsB[commonLead].occurrence
  ) commonLead += 1

  return {
    pairs,
    unmatchedA,
    unmatchedB,
    commonLead,
    diverged: commonLead < recordsA.length || commonLead < recordsB.length,
    recordsA,
    recordsB,
  }
}

export function pieceLabel(run: SimulationRun, pieceId: string | null): string {
  if (pieceId === null) return '∅'
  return run.pieceLabels[pieceId] ?? pieceId
}

/** 触点的一句话描述，如「起点 → d2 · 前缘」；非触点事件（中断标记）返回 null */
export function contactLabel(run: SimulationRun, event: SimulationEvent): string | null {
  if (!event.contact) return null
  const target = pieceLabel(run, event.pieceId)
  const edge = edgeLabels[event.contact.edge]
  if (event.contact.sourceId === null) return `起点 ${target} · ${edge}`
  return `${pieceLabel(run, event.contact.sourceId)} → ${target} · ${edge}`
}

/** 接触边的短描述，如「前缘接触」「机关连线」「手动起点」 */
export function edgePhrase(edge: ContactEdge): string {
  if (edge === 'link' || edge === 'start') return edgeLabels[edge]
  return `${edgeLabels[edge]}接触`
}
