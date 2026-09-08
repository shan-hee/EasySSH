import fs from 'node:fs'
import path from 'node:path'

const directory = process.argv[2] || '/tmp/easyssh-terminal-perf'
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null
}
const stats = values => ({ n: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: values.length ? Math.max(...values) : null })

function actionStats(report, predicate) {
  const actions = report.actions.filter(predicate)
  const frames = report.finalData.frames
  const intervals = frames.slice(1).map((time, index) => ({ time, duration: time - frames[index] }))
  const samples = actions.flatMap(action => intervals.filter(x => x.time >= action.start && x.time <= action.end).map(x => x.duration))
  const over25 = samples.filter(x => x > 25).length
  const over50 = samples.filter(x => x > 50).length
  return {
    windows: actions.length,
    frame: stats(samples),
    windowP95: stats(actions.map(x => x.frameP95Ms)),
    over25,
    over25Percent: samples.length ? over25 / samples.length * 100 : null,
    over50,
    longTasks: actions.reduce((sum, action) => sum + action.longTasks, 0),
    maxEventPerWindow: stats(actions.map(x => x.maxEventMs)),
  }
}
function menuSummary(report) {
  return Object.fromEntries([1, 4].map(cpu => [cpu, {
    all: actionStats(report, action => action.name.includes(`cpu${cpu}-`) && !action.name.startsWith('context-')),
    menus: Object.fromEntries(['monitor', 'sftp', 'ai', 'latency', 'docker', 'settings', 'fullscreen', 'context'].map(menu => [menu, actionStats(report, action => action.name.startsWith(`${menu}-`) && action.name.includes(`cpu${cpu}-`))])),
  }]))
}
function connectionSummary(connections) {
  return Object.fromEntries(['clickToReadyMs', 'readyToFirstMetricsMs', 'readyToSecondMetricsMs', 'readyToMonitorMountMs', 'firstMetricsToChartMs', 'clickToChartMs'].map(key => [key, stats(connections.map(x => x[key]))]))
}

const baseline = read('baseline.json')
const optimized = read('optimized-menus.json')
const coldRun = read('optimized-cold.json')
const warmRun = read('optimized-warm.json')
const cold = coldRun.connections
const warm = warmRun.connections.filter(x => x.label !== 'warmup')
const extraWarm = optimized.connections.filter(x => x.label.startsWith('warm-'))
const connections = [...cold, ...warm, ...extraWarm]
const reference = read('motion-reference.json')
const functional = read('functional.json')
const intervals = functional.monitorSamples?.slice(1).map((x, index) => x.time - functional.monitorSamples[index].time) || []
const backendStart = functional.backend?.[0]
const backendEnd = functional.backend?.at(-1)
const requests = [...optimized.requests, ...functional.requests]
const summary = {
  methodology: { quantile: 'nearest rank', frames: 'pooled rAF intervals within action windows', eventTiming: 'laboratory Event Timing, not production INP', chart: 'canvas creation plus two rAF callbacks; not animation completion' },
  runs: Object.fromEntries([['baseline', baseline], ['optimized-cold', coldRun], ['optimized-warm', warmRun], ['optimized-menus', optimized]].map(([name, run]) => [name, { completed: run.completed === true, connections: run.connections.map(x => x.label), actions: run.actions.length, errors: run.errors, fatal: run.fatal?.message }])),
  baseline: { menus: menuSummary(baseline), connections: connectionSummary(baseline.connections), cold: connectionSummary(baseline.connections.filter(x => x.label.startsWith('cold-'))), warm: connectionSummary(baseline.connections.filter(x => x.label.startsWith('warm-'))), steady: actionStats(baseline, x => x.name === 'steady-monitor-12s'), output: actionStats(baseline, x => x.name === 'terminal-output-300-lines'), errors: baseline.errors },
  optimized: { menus: menuSummary(optimized), connections: connectionSummary(connections), cold: connectionSummary(cold), warm: connectionSummary([...warm, ...extraWarm]), steady: actionStats(optimized, x => x.name === 'steady-monitor-12s'), output: actionStats(optimized, x => x.name === 'terminal-output-300-lines'), errors: optimized.errors },
  motion: Object.fromEntries([1, 4].map(rate => [rate, { windows: reference.actions.filter(x => x.rate === rate).length, windowP95: stats(reference.actions.filter(x => x.rate === rate).map(x => x.p95)), frames: reference.actions.filter(x => x.rate === rate).reduce((sum, x) => sum + x.frames, 0), over25: reference.actions.filter(x => x.rate === rate).reduce((sum, x) => sum + x.over25, 0) }])),
  backend: {
    sustainedCollectionMs: stats(functional.monitorSamples?.map(x => x.sshLatencyMs) || []),
    sustainedArrivalIntervalMs: stats(intervals),
    sustainedPacketBytes: stats(functional.monitorSamples?.map(x => x.size) || []),
    process: backendStart && backendEnd ? { sampleSeconds: (backendEnd.at - backendStart.at) / 1000, cpuPercentOfOneCore: ((backendEnd.userTicks + backendEnd.systemTicks - backendStart.userTicks - backendStart.systemTicks) / Number(process.env.CLK_TCK || 100)) / ((backendEnd.at - backendStart.at) / 1000) * 100, rssStartMB: backendStart.rssKB / 1024, rssEndMB: backendEnd.rssKB / 1024, threadsStart: backendStart.threads, threadsEnd: backendEnd.threads } : null,
    endpoints: Object.fromEntries([...new Set(requests.map(x => x.path))].filter(x => x.includes('/sftp/') || x.includes('/docker/') || x.endsWith('/auth/ticket')).map(endpoint => [endpoint, stats(requests.filter(x => x.path === endpoint).map(x => x.durationMs))])),
  },
  functional: { completed: functional.completed, checks: functional.checks, errors: functional.errors, fatal: functional.fatal },
  longTail: connections.filter(x => x.clickToReadyMs > 3000).map(x => {
    const wait = x.data.measures.find(m => m.name === 'ws-terminal-ssh-init')
    const start = wait?.start ?? x.click
    const end = wait ? start + wait.duration : x.terminalReady
    const frames = x.data.frames.slice(1).map((t, i) => ({ t, dt: t - x.data.frames[i] })).filter(f => f.t >= start && f.t <= end).map(f => f.dt)
    return { label: x.label, clickToReadyMs: x.clickToReadyMs, readyToFirstMetricsMs: x.readyToFirstMetricsMs, measures: x.data.measures, waitFrame: stats(frames), waitLongTasks: x.data.longTasks.filter(t => t.start < end && t.start + t.duration > start).length }
  }),
}
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
