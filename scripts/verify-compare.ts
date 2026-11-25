/**
 * 对照回看验证脚本
 *
 * 场景一（主验证）：同一工程的两份摆法——
 *   A：枢纽（分岔 s1）之后没有可触达元件，链路在枢纽中断；
 *   B：枢纽之后多倒三枚（d7、d8、d9）才停止。
 *   期望：共同触点 8 处，第 9 次接触起分岔，B 路独有 3 个触点，A 路触点全部对应。
 *
 * 场景二：B 路多出一个早期机关事件，事件总数不同——
 *   期望：共同触点仍按身份（来源→接收@接触边）对应，不按第几行对齐。
 *
 * 场景三：同一对牌在一遍里碰两次（重复机关连线）——
 *   期望：两次接触各自成记录（occurrence 1、2），不合成一条。
 *
 * 场景四：同一摆法、不同重力——
 *   期望：触点全部对应，但两侧事件时刻不同（选中共同触点时各跳各的时刻）。
 */
import { createDefaultDocument } from '@/shared/defaults'
import type { DominoDocument, Piece, SimulationRun } from '@/shared/document'
import { propagate } from '@/features/simulation/lib/propagate'
import { alignRuns, contactLabel, contactRecords } from '@/features/compare/lib/contacts'

const domino = (id: string, x: number, y: number, angle: number, label: string): Piece => ({
  id, kind: 'domino', x, y, angle, facing: 'east', label, height: 1.6, width: 0.42,
  fallThreshold: 0.8, friction: 0.55,
})

let seq = 0
function toRun(doc: DominoDocument): SimulationRun {
  const snapshot = structuredClone(doc)
  const result = propagate(snapshot)
  seq += 1
  return {
    id: `run-${seq}`,
    documentId: snapshot.id,
    revision: snapshot.revision,
    startedAt: Date.now(),
    startPieceId: snapshot.startPieceId,
    status: result.status,
    events: result.events,
    interruptedPieceId: result.interruptedPieceId,
    interruptionReason: result.interruptionReason,
    duration: result.duration,
    pieceLabels: Object.fromEntries(snapshot.pieces.map(piece => [piece.id, piece.label])),
  }
}

/** 摆法 A：枢纽 s1 之后无任何元件，链路在枢纽中断 */
function layoutHubBreak(): DominoDocument {
  const base = createDefaultDocument()
  return {
    ...base,
    revision: 2,
    connections: [],
    pieces: base.pieces.filter(piece => !['d7', 'd8', 'd9', 'd10', 't1'].includes(piece.id)),
  }
}

/** 摆法 B：枢纽之后接 d7 → d8 → d9，多倒三枚后停止 */
function layoutHubContinue(): DominoDocument {
  const base = layoutHubBreak()
  return {
    ...base,
    revision: 3,
    pieces: [
      ...base.pieces,
      domino('d7', 15.2, 3.7, 0, '10'),
      domino('d8', 16.8, 3.7, 0, '11'),
      domino('d9', 18.4, 3.7, 0, '12'),
    ],
  }
}

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  console.log(`  ${condition ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures += 1
}

function showRun(run: SimulationRun, tag: string) {
  console.log(`  ${tag} 路触点序列（${contactRecords(run).length} 次接触 / ${run.events.length} 个事件）：`)
  for (const record of contactRecords(run)) {
    console.log(`    #${String(record.index + 1).padStart(2, ' ')}  t=${record.event.time.toFixed(2)}  ${contactLabel(run, record.event)}`)
  }
  const interrupted = run.events.find(event => event.kind === 'interrupted')
  if (interrupted) console.log(`    ⚠ t=${interrupted.time.toFixed(2)}  中断于 ${run.pieceLabels[interrupted.pieceId] ?? interrupted.pieceId}`)
}

// ── 场景一：枢纽中断 vs 多倒三枚 ─────────────────────────────
console.log('场景一 · 一份在枢纽中断，另一份多倒三枚后才停止')
const runA = toRun(layoutHubBreak())
const runB = toRun(layoutHubContinue())
showRun(runA, 'A')
showRun(runB, 'B')

check('A 在枢纽（分岔 s1）中断', runA.status === 'interrupted' && runA.interruptedPieceId === 's1',
  `status=${runA.status}, interrupted=${runA.interruptedPieceId}`)
check('B 比 A 多倒三枚（多 3 个倒下事件）',
  runB.events.filter(e => e.kind === 'fall').length - runA.events.filter(e => e.kind === 'fall').length === 3,
  `A=${runA.events.length} 事件, B=${runB.events.length} 事件`)

const main = alignRuns(runA, runB)
console.log('  共同触点：')
for (const pair of main.pairs) {
  console.log(`    M${pair.matchId}  ${contactLabel(runA, pair.a.event)}  (A t=${pair.a.event.time.toFixed(2)} / B t=${pair.b.event.time.toFixed(2)})`)
}
console.log(`  分岔点：第 ${main.commonLead + 1} 次接触起分岔`)
console.log(`    A 路：${main.recordsA[main.commonLead] ? contactLabel(runA, main.recordsA[main.commonLead].event) : `中断于 ${runA.pieceLabels[runA.interruptedPieceId ?? ''] ?? runA.interruptedPieceId}`}`)
console.log(`    B 路：${main.recordsB[main.commonLead] ? contactLabel(runB, main.recordsB[main.commonLead].event) : '轨迹结束'}`)

check('共同触点 8 处', main.pairs.length === 8, `pairs=${main.pairs.length}`)
check('第 9 次接触起分岔', main.diverged && main.commonLead === 8, `commonLead=${main.commonLead}`)
check('A 路触点全部对应（无独有）', main.unmatchedA.length === 0)
check('B 路独有 3 个触点', main.unmatchedB.length === 3,
  main.unmatchedB.map(record => contactLabel(runB, record.event)).join(' / '))
check('B 路分岔后的首个触点是 s1 → d7',
  main.recordsB[main.commonLead]?.event.contact?.sourceId === 's1'
  && main.recordsB[main.commonLead]?.event.pieceId === 'd7')
check('共同触点按 A 路顺序编号（M1…M8）',
  main.pairs.every((pair, i) => pair.matchId === i + 1 && pair.a.index === i))

// ── 场景二：事件数不同，不按第几行对齐 ──────────────────────
console.log('\n场景二 · B 路多出一个早期机关事件（行号错位）')
const layoutShifted = (): DominoDocument => ({
  ...layoutHubContinue(),
  revision: 4,
  pieces: [...layoutHubContinue().pieces, { ...domino('tx', 2, 7.5, 0, '信号'), kind: 'trigger' as const, width: 0.7, height: 0.8 }],
  connections: [{ id: 'cx', from: 'd1', to: 'tx', delay: 0.05, enabled: true }],
})
const runB2 = toRun(layoutShifted())
const shifted = alignRuns(runA, runB2)
const pairD2 = shifted.pairs.find(pair => pair.a.event.pieceId === 'd2')
check('事件总数不同', runA.events.length !== runB2.events.length,
  `A=${runA.events.length}, B=${runB2.events.length}`)
check('共同触点仍全部对应（8 处）', shifted.pairs.length === 8, `pairs=${shifted.pairs.length}`)
check('d1→d2 在两侧的行号不同却仍对应',
  pairD2 !== undefined && pairD2.a.index === 1 && pairD2.b.index === 2,
  pairD2 ? `A 第 ${pairD2.a.index + 1} 次接触 ↔ B 第 ${pairD2.b.index + 1} 次接触` : '未匹配')
check('B 路多出的机关事件留在自己轨迹', shifted.unmatchedB.some(record => record.event.pieceId === 'tx'))

// ── 场景三：同一对牌碰两次，不合成一条 ──────────────────────
console.log('\n场景三 · 同一对牌在一遍里碰两次')
const layoutDoubleTap = (): DominoDocument => ({
  ...createDefaultDocument(),
  revision: 5,
  pieces: [
    domino('d1', 2, 4.2, 0, '起点'),
    { ...domino('t1', 15, 7.5, 0, '终点'), kind: 'trigger' as const, width: 0.7, height: 0.8 },
  ],
  connections: [
    { id: 'c1', from: 'd1', to: 't1', delay: 0.1, enabled: true },
    { id: 'c2', from: 'd1', to: 't1', delay: 0.35, enabled: true },
  ],
  startPieceId: 'd1',
})
const runD1 = toRun(layoutDoubleTap())
const runD2 = toRun(layoutDoubleTap())
const tapRecords = contactRecords(runD1).filter(record => record.key.startsWith('d1→t1'))
check('同一对牌 d1→t1 在一遍里留下两条记录', tapRecords.length === 2,
  `occurrence=${tapRecords.map(record => record.occurrence).join(',')}`)
const doubleTap = alignRuns(runD1, runD2)
const tapPairs = doubleTap.pairs.filter(pair => pair.a.event.pieceId === 't1')
check('对齐后仍是两条独立匹配（不合并）', tapPairs.length === 2
  && tapPairs[0].a.occurrence === 1 && tapPairs[1].a.occurrence === 2
  && tapPairs[0].matchId !== tapPairs[1].matchId,
  tapPairs.map(pair => `M${pair.matchId}#${pair.a.occurrence}`).join(' / '))

// ── 场景四：触点全同、时刻不同，各跳各的时刻 ────────────────
console.log('\n场景四 · 同一摆法不同重力（触点相同，时刻不同）')
const layoutFaster = (): DominoDocument => ({
  ...layoutHubContinue(),
  revision: 6,
  scene: { ...layoutHubContinue().scene, gravity: 14 },
})
const runB3 = toRun(layoutFaster())
const timed = alignRuns(runB, runB3)
const identical = timed.unmatchedA.length === 0 && timed.unmatchedB.length === 0
const shiftedTimes = timed.pairs.filter(pair => pair.a.event.time !== pair.b.event.time)
check('触点完全一致（11 处，无分岔）', identical && !timed.diverged && timed.pairs.length === 11,
  `pairs=${timed.pairs.length}`)
check('两侧事件时刻不同，需各跳各的', shiftedTimes.length >= 3,
  `${shiftedTimes.length} 处时刻不同，如 M${shiftedTimes[0]?.matchId}: A ${shiftedTimes[0]?.a.event.time.toFixed(2)}s / B ${shiftedTimes[0]?.b.event.time.toFixed(2)}s`)

console.log(failures === 0 ? '\n全部断言通过 ✓' : `\n${failures} 条断言失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
