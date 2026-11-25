import { computed, ref, watch } from 'vue'
import type { SimulationEvent, SimulationRun } from '@/shared/document'
import { sortedEvents, useReview } from '@/features/replay'
import { alignRuns, contactLabel, edgePhrase, pieceLabel } from '../lib/contacts'
import { useRunArchive } from './useRunArchive'

export type LaneSide = 'a' | 'b'

export interface LaneRow {
  eventId: string
  time: number
  kind: SimulationEvent['kind']
  title: string
  subtitle: string
  matchId: number | null
  divergence: boolean
  interrupted: boolean
}

export interface LaneView {
  run: SimulationRun | null
  time: number
  playing: boolean
  currentEventId: string | null
  rows: LaneRow[]
}

export interface CompareSummary {
  pairCount: number
  commonLead: number
  diverged: boolean
  unrelated: boolean
  identical: boolean
  aNext: string | null
  bNext: string | null
}

export interface CommonPair {
  matchId: number
  label: string
  timeA: number
  timeB: number
  afterLead: boolean
}

function rowTitle(run: SimulationRun, event: SimulationEvent): string {
  if (!event.contact) return `中断 ${pieceLabel(run, event.pieceId)}`
  if (event.contact.sourceId === null) return `起点 ${pieceLabel(run, event.pieceId)}`
  return `${pieceLabel(run, event.contact.sourceId)} → ${pieceLabel(run, event.pieceId)}`
}

function rowSubtitle(event: SimulationEvent): string {
  if (!event.contact) return event.detail
  return edgePhrase(event.contact.edge)
}

export function useCompare() {
  const archive = useRunArchive()
  const aId = ref<string | null>(null)
  const bId = ref<string | null>(null)
  const selectedMatchId = ref<number | null>(null)

  const runA = computed(() => archive.runs.value.find(run => run.id === aId.value) ?? null)
  const runB = computed(() => archive.runs.value.find(run => run.id === bId.value) ?? null)

  // 两条互不影响的时间轴：各自的播放时钟、各自的进度，互不带跑
  const laneA = useReview(runA)
  const laneB = useReview(runB)

  watch(archive.runs, runs => {
    if (aId.value && !runs.some(run => run.id === aId.value)) aId.value = null
    if (bId.value && !runs.some(run => run.id === bId.value)) bId.value = null
    if (runs.length >= 2) {
      if (!bId.value) bId.value = [...runs].reverse().find(run => run.id !== aId.value)?.id ?? null
      if (!aId.value) aId.value = [...runs].reverse().find(run => run.id !== bId.value)?.id ?? null
    }
  }, { immediate: true })

  const alignment = computed(() => {
    const a = runA.value
    const b = runB.value
    return a && b ? alignRuns(a, b) : null
  })

  const matchByEventA = computed(() => new Map((alignment.value?.pairs ?? []).map(pair => [pair.a.event.id, pair.matchId])))
  const matchByEventB = computed(() => new Map((alignment.value?.pairs ?? []).map(pair => [pair.b.event.id, pair.matchId])))

  const divergenceEventA = computed(() => {
    const al = alignment.value
    return al?.diverged ? al.recordsA[al.commonLead]?.event.id ?? null : null
  })
  const divergenceEventB = computed(() => {
    const al = alignment.value
    return al?.diverged ? al.recordsB[al.commonLead]?.event.id ?? null : null
  })

  function buildRows(run: SimulationRun | null, matchByEvent: Map<string, number>, divergenceEventId: string | null): LaneRow[] {
    if (!run) return []
    return sortedEvents(run.events).map(event => ({
      eventId: event.id,
      time: event.time,
      kind: event.kind,
      title: rowTitle(run, event),
      subtitle: rowSubtitle(event),
      matchId: matchByEvent.get(event.id) ?? null,
      divergence: event.id === divergenceEventId,
      interrupted: event.kind === 'interrupted',
    }))
  }

  const laneAView = computed<LaneView>(() => ({
    run: runA.value,
    time: laneA.time.value,
    playing: laneA.playing.value,
    currentEventId: laneA.currentEvent.value?.id ?? null,
    rows: buildRows(runA.value, matchByEventA.value, divergenceEventA.value),
  }))
  const laneBView = computed<LaneView>(() => ({
    run: runB.value,
    time: laneB.time.value,
    playing: laneB.playing.value,
    currentEventId: laneB.currentEvent.value?.id ?? null,
    rows: buildRows(runB.value, matchByEventB.value, divergenceEventB.value),
  }))

  const summary = computed<CompareSummary | null>(() => {
    const al = alignment.value
    const a = runA.value
    const b = runB.value
    if (!al || !a || !b) return null
    const nextA = al.recordsA[al.commonLead]
    const nextB = al.recordsB[al.commonLead]
    const sideNext = (record: typeof nextA, run: SimulationRun) =>
      record ? contactLabel(run, record.event)
        : run.interruptedPieceId ? `中断于 ${pieceLabel(run, run.interruptedPieceId)}` : '轨迹结束'
    return {
      pairCount: al.pairs.length,
      commonLead: al.commonLead,
      diverged: al.diverged,
      unrelated: al.pairs.length === 0,
      identical: al.unmatchedA.length === 0 && al.unmatchedB.length === 0,
      aNext: al.diverged ? sideNext(nextA, a) : null,
      bNext: al.diverged ? sideNext(nextB, b) : null,
    }
  })

  const commonPairs = computed<CommonPair[]>(() => {
    const al = alignment.value
    const a = runA.value
    if (!al || !a) return []
    return al.pairs.map(pair => ({
      matchId: pair.matchId,
      label: contactLabel(a, pair.a.event) ?? '',
      timeA: pair.a.event.time,
      timeB: pair.b.event.time,
      afterLead: pair.a.index >= al.commonLead,
    }))
  })

  function chooseRun(side: LaneSide, id: string) {
    if (side === 'a') aId.value = id
    else bId.value = id
    selectedMatchId.value = null
  }

  /** 选中共同触点：两路各自跳到自己那条事件的时刻 */
  function selectMatch(matchId: number) {
    const pair = alignment.value?.pairs.find(item => item.matchId === matchId)
    if (!pair) return
    selectedMatchId.value = matchId
    laneA.focusEvent(pair.a.event.id)
    laneB.focusEvent(pair.b.event.id)
  }

  /** 选中某一路的事件：能对应上共同触点则两路联动，否则只动本路 */
  function selectLaneEvent(side: LaneSide, eventId: string) {
    const matchId = (side === 'a' ? matchByEventA.value : matchByEventB.value).get(eventId)
    if (matchId !== undefined) {
      selectMatch(matchId)
      return
    }
    selectedMatchId.value = null
    if (side === 'a') laneA.focusEvent(eventId)
    else laneB.focusEvent(eventId)
  }

  function toggleLane(side: LaneSide) { (side === 'a' ? laneA : laneB).toggle() }
  function seekLane(side: LaneSide, value: number) { (side === 'a' ? laneA : laneB).seek(value) }
  function restartLane(side: LaneSide) { (side === 'a' ? laneA : laneB).restart() }

  function record(run: SimulationRun) { archive.record(run) }
  function removeRun(id: string) {
    archive.remove(id)
    selectedMatchId.value = null
  }

  return {
    runs: archive.runs, aId, bId, selectedMatchId,
    laneAView, laneBView, summary, commonPairs,
    chooseRun, selectMatch, selectLaneEvent,
    toggleLane, seekLane, restartLane, record, removeRun,
  }
}
