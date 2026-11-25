import { ref, type Ref } from 'vue'
import type { SimulationRun } from '@/shared/document'

const storageKey = 'chainline-jdk032-runs-v1'
const maxRuns = 12

function loadRuns(): SimulationRun[] {
  try {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return []
    const parsed = JSON.parse(saved) as SimulationRun[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(run => run && Array.isArray(run.events) && typeof run.id === 'string')
  } catch {
    return []
  }
}

/** 已保存的模拟结果档案：每次模拟自动留存，供对照回看挑选两份。 */
export function useRunArchive() {
  const runs: Ref<SimulationRun[]> = ref(loadRuns())

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(runs.value))
    } catch {
      // 存储不可用时档案仅保留在内存里
    }
  }

  function record(run: SimulationRun) {
    if (run.status === 'empty') return
    runs.value = [...runs.value.filter(item => item.id !== run.id), run].slice(-maxRuns)
    persist()
  }

  function remove(id: string) {
    runs.value = runs.value.filter(run => run.id !== id)
    persist()
  }

  return { runs, record, remove }
}
