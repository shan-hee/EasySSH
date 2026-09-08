// Loaded by Playwright before application code. Never records credentials,
// terminal output, request bodies, or WebSocket query strings.
(() => {
  const data = { frames: [], longTasks: [], longAnimationFrames: [], events: [], sockets: [], dom: [] }
  window.__terminalPerf = data
  const now = () => performance.now()
  const observers = []
  for (const [type, key] of [['longtask', 'longTasks'], ['long-animation-frame', 'longAnimationFrames']]) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) data[key].push({ start: entry.startTime, duration: entry.duration })
    })
    observer.observe({ type, buffered: true })
    observers.push(observer)
  }
  if (PerformanceObserver.supportedEntryTypes.includes('event')) {
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) data.events.push({ name: e.name, start: e.startTime, duration: e.duration, inputDelay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart, interactionId: e.interactionId })
    })
    observer.observe({ type: 'event', buffered: true, durationThreshold: 16 })
    observers.push(observer)
  }
  function tick(t) {
    data.frames.push(t)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Read only the protobuf fields used by the performance report.
  function fields(bytes) {
    const result = new Map()
    let offset = 0
    function integer() {
      let value = 0, scale = 1
      for (let n = 0; n < 10 && offset < bytes.length; n++) {
        const byte = bytes[offset++]
        value += (byte & 127) * scale
        if (!(byte & 128)) return value
        scale *= 128
      }
      throw new Error('Invalid protobuf varint')
    }
    while (offset < bytes.length) {
      const tag = integer(), field = tag >>> 3, wire = tag & 7
      if (wire === 0) result.set(field, integer())
      else if (wire === 1) {
        result.set(field, new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true))
        offset += 8
      } else if (wire === 2) {
        const length = integer()
        result.set(field, bytes.subarray(offset, offset + length))
        offset += length
      } else if (wire === 5) offset += 4
      else throw new Error('Unsupported protobuf field')
    }
    return result
  }

  const NativeSocket = window.WebSocket
  window.WebSocket = class extends NativeSocket {
    constructor(url, protocols) {
      super(url, protocols)
      const record = { path: new URL(url, location.href).pathname, start: now(), messages: [], sends: [] }
      data.sockets.push(record)
      this.addEventListener('open', () => { record.open = now() })
      this.addEventListener('close', e => { record.close = now(); record.closeCode = e.code })
      this.addEventListener('message', e => {
        const received = now()
        if (typeof e.data === 'string') {
          try {
            const message = JSON.parse(e.data)
            record.messages.push({ time: received, type: message.type })
          } catch { /* Terminal text is intentionally omitted. */ }
        } else {
          const message = { time: received, type: 'binary', size: e.data.byteLength ?? e.data.size }
          if (record.path.includes('/monitor') && e.data instanceof ArrayBuffer) {
            try {
              const values = fields(new Uint8Array(e.data))
              message.sshLatencyMs = values.get(8) ?? 0
              message.timestamp = values.get(6)
              message.cpu = values.has(2) ? fields(values.get(2)).get(1) ?? 0 : null
              message.memoryBytes = values.has(3) ? fields(values.get(3)).get(1) : null
              message.decodeMs = now() - received
            } catch { message.decodeError = true }
          }
          record.messages.push(message)
        }
      })
      const originalSend = this.send
      this.send = function (payload) {
        let type = 'binary'
        if (typeof payload === 'string') {
          try { type = JSON.parse(payload).type ?? 'text' } catch { type = 'text' }
        }
        record.sends.push({ time: now(), type })
        return originalSend.call(this, payload)
      }
    }
  }

  const seen = new Set()
  function inspect() {
    const selectors = {
      monitorMounted: '[data-monitor-density]',
      monitorData: '[data-monitor-density] [data-slot="echarts-view"]',
      chartCanvas: '[data-monitor-density] canvas',
      terminalCanvas: '.xterm canvas',
    }
    for (const [name, selector] of Object.entries(selectors)) {
      if (seen.has(name) || !document.querySelector(selector)) continue
      seen.add(name)
      data.dom.push({ name, time: now() })
      if (name === 'chartCanvas') requestAnimationFrame(() => requestAnimationFrame(() => data.dom.push({ name: 'chartPaintOpportunity', time: now() })))
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(inspect)
    observer.observe(document.body, { childList: true, subtree: true })
    inspect()
  })
})()
