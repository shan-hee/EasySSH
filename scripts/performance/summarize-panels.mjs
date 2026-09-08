import fs from 'node:fs'
import path from 'node:path'
const directory = process.argv[2] || '/tmp/easyssh-terminal-round2'
const stats = xs => {
  const sorted = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return { n: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1] ?? null, p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, max: sorted.at(-1) ?? null }
}
function summarize(run) {
  const intervals = run.finalData.frames.slice(1).map((t, i) => ({ t, dt: t - run.finalData.frames[i] }))
  const group = actions => {
    const frames = actions.flatMap(a => intervals.filter(x => x.t >= a.start && x.t <= a.end).map(x => x.dt))
    return { windows: actions.length, frame: stats(frames), windowP95: stats(actions.map(a => a.frameP95Ms)), over25Percent: frames.filter(t => t > 25).length / frames.length * 100, longTasks: actions.reduce((sum, a) => sum + a.longTasks, 0), eventMax: stats(actions.map(a => a.maxEventMs)) }
  }
  return {
    completed: run.completed === true, errors: run.errors,
    cpu: Object.fromEntries([1, 4].map(rate => [rate, Object.fromEntries(['all', 'monitor', 'sftp', 'ai', 'latency', 'docker', 'settings', 'fullscreen', 'context'].map(name => [name, group(run.actions.filter(a => a.name.includes(`cpu${rate}-`) && (name === 'all' ? !a.name.startsWith('context-') : a.name.startsWith(`${name}-`))))]))])),
    steady: group(run.actions.filter(a => a.name === 'steady-monitor-12s')),
    output: group(run.actions.filter(a => a.name === 'terminal-output-300-lines')),
  }
}
const summary = { methodology: { quantile: 'nearest rank', frames: 'pooled rAF intervals in action windows, including post-animation settling', cpu: 'Chromium CPU throttling only', eventTiming: 'laboratory samples, not production INP' } }
for (const name of ['before', 'after']) summary[name] = summarize(JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8')))
for (const name of ['panels-before', 'panels-after']) summary[name] = JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8'))
fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
