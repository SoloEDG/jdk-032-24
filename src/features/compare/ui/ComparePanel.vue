<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, CheckCircle2, CircleStop, FastForward, GitFork, Pause, Play, SkipBack, Trash2 } from '@lucide/vue'
import type { SimulationEvent, SimulationRun } from '@/shared/document'
import { formatSeconds } from '@/shared/time'
import type { CommonPair, CompareSummary, LaneSide, LaneView } from '../model/useCompare'

const props = defineProps<{
  runs: SimulationRun[]
  aId: string | null
  bId: string | null
  laneA: LaneView
  laneB: LaneView
  summary: CompareSummary | null
  pairs: CommonPair[]
  selectedMatchId: number | null
}>()
const emit = defineEmits<{
  selectA: [string]
  selectB: [string]
  laneToggle: [LaneSide]
  laneSeek: [LaneSide, number]
  laneRestart: [LaneSide]
  laneEvent: [LaneSide, string]
  selectMatch: [number]
  removeRun: [string]
}>()

const lanes = computed(() => ([
  { side: 'a' as const, tag: 'A', view: props.laneA, selectedId: props.aId, otherId: props.bId },
  { side: 'b' as const, tag: 'B', view: props.laneB, selectedId: props.bId, otherId: props.aId },
]))

const divergenceBefore = computed(() => props.pairs.find(pair => pair.afterLead)?.matchId ?? null)
const trailingDivider = computed(() => Boolean(props.summary?.diverged && divergenceBefore.value === null))

const newestFirst = computed(() => [...props.runs].reverse())

function runLabel(run: SimulationRun) {
  const clock = new Date(run.startedAt).toTimeString().slice(0, 8)
  const status = run.status === 'complete' ? '完成' : run.status === 'interrupted' ? '中断' : '空'
  return `R${run.revision} · ${clock} · ${status} · ${run.events.length} 事件`
}
function iconFor(kind: SimulationEvent['kind']) {
  return kind === 'interrupted' ? AlertTriangle : kind === 'mechanism' ? FastForward : CheckCircle2
}
function onChoose(side: LaneSide, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (side === 'a') emit('selectA', value)
  else emit('selectB', value)
}
function onSeek(side: LaneSide, event: Event) {
  emit('laneSeek', side, Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <section class="compare-panel" aria-labelledby="compare-title">
    <div class="compare-heading">
      <div class="section-kicker"><span>06 / COMPARE</span><h2 id="compare-title">对照回看</h2></div>
      <span class="compare-count mono">{{ runs.length }} 份已存</span>
    </div>

    <div v-if="runs.length < 2" class="compare-empty">
      <GitFork :size="22" />
      <strong>{{ runs.length === 0 ? '还没有可对照的结果' : '已存 1 份结果' }}</strong>
      <p>每次模拟都会自动留存（最多 12 份）。调整摆法后再运行一次，即可把两份结果放在一起对照触点。</p>
    </div>

    <template v-else>
      <div v-if="summary" class="compare-summary" :class="{ diverged: summary.diverged }">
        <span class="summary-symbol">
          <GitFork v-if="summary.diverged" :size="16" />
          <CheckCircle2 v-else :size="16" />
        </span>
        <div class="compare-summary-copy">
          <strong v-if="summary.unrelated">两份结果没有共同触点</strong>
          <strong v-else-if="summary.identical">两路触点完全一致 · {{ summary.pairCount }} 处共同触点</strong>
          <strong v-else>共同触点 {{ summary.pairCount }} 处 · 第 {{ summary.commonLead + 1 }} 次接触起分岔</strong>
          <small v-if="summary.diverged && !summary.unrelated">
            <span>A 路：{{ summary.aNext }}</span><span>B 路：{{ summary.bNext }}</span>
          </small>
        </div>
      </div>

      <div class="compare-lanes">
        <div v-for="lane in lanes" :key="lane.side" class="compare-lane">
          <div class="lane-head">
            <span class="lane-tag mono">{{ lane.tag }}</span>
            <select class="lane-select" :aria-label="`选择 ${lane.tag} 路结果`" :value="lane.selectedId ?? ''"
              @change="onChoose(lane.side, $event)">
              <option v-for="run in newestFirst" :key="run.id" :value="run.id" :disabled="run.id === lane.otherId">
                {{ runLabel(run) }}
              </option>
            </select>
            <button v-if="lane.selectedId" class="lane-remove" :aria-label="`删除 ${lane.tag} 路当前结果`"
              @click="emit('removeRun', lane.selectedId)"><Trash2 :size="13" /></button>
          </div>
          <template v-if="lane.view.run">
            <div class="lane-controls">
              <button class="replay-icon" :aria-label="`${lane.tag} 路回到开头`" @click="emit('laneRestart', lane.side)"><SkipBack :size="13" /></button>
              <button class="replay-icon lane-play" :aria-label="lane.view.playing ? `暂停 ${lane.tag} 路` : `播放 ${lane.tag} 路`"
                @click="emit('laneToggle', lane.side)">
                <Pause v-if="lane.view.playing" :size="13" fill="currentColor" /><Play v-else :size="13" fill="currentColor" />
              </button>
              <span class="replay-clock mono">{{ formatSeconds(lane.view.time) }}</span>
              <input class="replay-range" type="range" min="0" :max="lane.view.run.duration || 0.01" step="0.01"
                :value="lane.view.time" :aria-label="`${lane.tag} 路进度`" @input="onSeek(lane.side, $event)" />
              <span class="replay-clock mono">{{ formatSeconds(lane.view.run.duration) }}</span>
            </div>
            <ol class="lane-events">
              <li v-for="row in lane.view.rows" :key="row.eventId">
                <button class="lane-event" :class="{
                    current: lane.view.currentEventId === row.eventId,
                    matched: row.matchId !== null,
                    selected: row.matchId !== null && row.matchId === selectedMatchId,
                    divergence: row.divergence,
                    interrupted: row.interrupted,
                  }" :aria-current="lane.view.currentEventId === row.eventId ? 'step' : undefined"
                  @click="emit('laneEvent', lane.side, row.eventId)">
                  <span class="event-time mono">{{ formatSeconds(row.time) }}</span>
                  <span class="event-icon"><component :is="iconFor(row.kind)" :size="12" /></span>
                  <span class="event-copy"><strong>{{ row.title }}</strong><small>{{ row.subtitle }}</small></span>
                  <span v-if="row.divergence" class="event-flag">分岔</span>
                  <span v-else-if="row.matchId !== null" class="match-tag mono">M{{ row.matchId }}</span>
                  <span v-else class="match-tag solo mono">独有</span>
                </button>
              </li>
            </ol>
          </template>
        </div>
      </div>

      <div class="compare-common">
        <div class="event-list-heading"><span>共同触点 · 按 A 路顺序</span><span>{{ pairs.length }} MATCHED</span></div>
        <ol v-if="pairs.length || trailingDivider" class="common-list">
          <template v-for="pair in pairs" :key="pair.matchId">
            <li v-if="divergenceBefore === pair.matchId" class="common-divider" aria-hidden="true">
              <AlertTriangle :size="11" /> 第 {{ (summary?.commonLead ?? 0) + 1 }} 次接触起分岔
            </li>
            <li>
              <button class="common-item" :class="{ chosen: selectedMatchId === pair.matchId }"
                @click="emit('selectMatch', pair.matchId)">
                <span class="match-tag mono">M{{ pair.matchId }}</span>
                <span class="common-label">{{ pair.label }}</span>
                <span class="common-times mono">A {{ formatSeconds(pair.timeA) }} · B {{ formatSeconds(pair.timeB) }}</span>
              </button>
            </li>
          </template>
          <li v-if="trailingDivider" class="common-divider" aria-hidden="true">
            <AlertTriangle :size="11" /> 第 {{ (summary?.commonLead ?? 0) + 1 }} 次接触起分岔
          </li>
        </ol>
        <p class="compare-hint"><CircleStop :size="11" /> 点共同触点，两路各自跳到自己的事件时刻；拖动任一路进度不影响另一路。</p>
      </div>
    </template>
  </section>
</template>
