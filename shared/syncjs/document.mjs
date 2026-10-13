// Shared by desktop clients and the server sync worker.
export function createEngine(A) {
  const orderKey = "order/00000000-0000-4000-8000-000000000001"
  const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  const encode = (value) => {
    let text = ""
    for (let offset = 0; offset < value.length; offset += 8192)
      text += String.fromCharCode(...value.subarray(offset, offset + 8192))
    return btoa(text)
  }
  function load(value) {
    if (value) return A.load(decode(value))
    // A common, deterministic ancestor prevents concurrent root-map creation.
    const seed = A.change(
      A.init({ actor: "00000000000000000000000000000001" }),
      { time: 0 },
      (d) => {
        d.records = {}
      },
    )
    try {
      return A.clone(seed)
    } finally {
      A.free(seed)
    }
  }
  const save = (doc) => encode(A.save(doc))
  function project(doc) {
    const snapshot = {},
      conflicts = []
    if (!doc.records || typeof doc.records !== "object") throw new Error("Invalid sync document")
    const entries = Object.entries(doc.records)
    if (entries.length > 20000) throw new Error("Sync history has too many records")
    for (const [key, record] of entries) {
      if (
        !/^(server|script|value|order)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          key,
        ) ||
        !record ||
        typeof record !== "object"
      )
        throw new Error("Invalid sync record")
      if (
        String(record.$deleted) === "true" ||
        Object.values(A.getConflicts(record, "$deleted") || {})
          .map(String)
          .includes("true")
      )
        continue
      const fields = {}
      for (const [field, value] of Object.entries(record)) {
        if (field === "$deleted") continue
        if (typeof value !== "string" && !A.isImmutableString(value))
          throw new Error("Invalid sync field")
        fields[field] = String(value)
        const values = [...new Set(Object.values(A.getConflicts(record, field) || {}).map(String))]
        if (["connection", "content", "ref", "ids"].includes(field) && values.length > 1)
          conflicts.push({ key, field, values })
      }
      snapshot[key] = fields
    }
    // A membership change is not a different ordering decision. Compare the
    // effective order of live servers, ignoring removed IDs and deterministically
    // appending additions absent from an older ordering version.
    const members = Object.keys(snapshot).filter((key) => key.startsWith("server/")).map((key) => key.slice(7))
    const meaningful = conflicts.filter((conflict) => {
      if (conflict.key !== orderKey || conflict.field !== "ids") return true
      const seen = new Set()
      conflict.values = conflict.values.filter((value) => {
        const remaining = new Set(members)
        const ids = JSON.parse(value)
        if (!Array.isArray(ids)) throw new Error("Invalid server order")
        const ordered = ids.filter((id) => remaining.delete(id))
        ordered.push(...[...remaining].sort())
        const signature = JSON.stringify(ordered)
        if (seen.has(signature)) return false
        seen.add(signature)
        return true
      })
      return conflict.values.length > 1
    })
    return { snapshot, conflicts: meaningful }
  }
  function reconcile(doc, current) {
    const projected = project(doc)
    const previous = projected.snapshot
    const blocked = new Map()
    for (const conflict of projected.conflicts) {
      if (conflict.field === "ref") continue
      if (!blocked.has(conflict.key)) blocked.set(conflict.key, new Set())
      blocked.get(conflict.key).add(conflict.field)
    }
    // No order record means the implicit empty baseline. A fresh replica must
    // not publish an empty ordering decision before receiving its first data.
    if (!doc.records[orderKey] && current[orderKey]?.ids === "[]") {
      current = { ...current }
      delete current[orderKey]
    }
    // The container for a given UUID has the same creation operation on every
    // replica. Concurrent first writes then conflict on fields, not whole maps.
    for (const key of Object.keys(current)) {
      if (doc.records[key]) continue
      const actor =
        "02" +
        Array.from(new TextEncoder().encode(key), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("")
      const base = load("")
      let seed
      try {
        seed = A.clone(base, { actor })
        seed = A.change(seed, { time: 0 }, (d) => {
          d.records[key] = { $deleted: new A.ImmutableString("false") }
        })
        doc = A.merge(doc, seed)
      } finally {
        if (seed) A.free(seed)
        A.free(base)
      }
    }
    return A.change(doc, (d) => {
      for (const key of Object.keys(previous))
        if (!(key in current) && !blocked.has(key)) d.records[key].$deleted = new A.ImmutableString("true")
      for (const [key, record] of Object.entries(current)) {
        if (!previous[key]) d.records[key].$deleted = new A.ImmutableString("false")
        for (const field of Object.keys(previous[key] || {}))
          if (!(field in record) && !blocked.get(key)?.has(field)) delete d.records[key][field]
        // Immutable strings keep connection bundles and scripts atomic.
        for (const [field, value] of Object.entries(record)) {
          // A retained business value is not an explicit conflict resolution.
          if (blocked.get(key)?.has(field)) continue
          if (previous[key]?.[field] === value) continue
          // Membership changes alter the projection, not the ordering decision.
          // Keep unresolved concurrent orders when storage matches the winner.
          if (field === "ids" && key.startsWith("order/") && previous[key]?.ids) {
            const actual = JSON.parse(value)
            const members = new Set(actual)
            const expected = JSON.parse(previous[key].ids).filter((id) => members.delete(id))
            expected.push(...[...members].sort())
            if (JSON.stringify(expected) === value) continue
          }
          d.records[key][field] = new A.ImmutableString(value)
        }
      }
    })
  }
  function projectConfiguration(doc, current) {
    const { snapshot, conflicts } = project(doc)
    for (const conflict of conflicts) {
      if (!current[conflict.key]) {
        // A new conflicting record has no confirmed local version to apply.
        delete snapshot[conflict.key]
      } else if (snapshot[conflict.key]) {
        snapshot[conflict.key][conflict.field] = current[conflict.key][conflict.field]
      }
    }
    snapshot[orderKey] ??= { ids: "[]" }
    return { snapshot, conflicts }
  }
  function outgoing(doc, remoteHeads) {
    if (!remoteHeads.length) return { document: save(doc), heads: A.getHeads(doc) }
    return {
      changes: A.getChanges(A.view(doc, remoteHeads), doc).map(encode),
      heads: A.getHeads(doc),
    }
  }
  function receive(doc, peer) {
    let result
    if (peer.document) {
      const other = load(peer.document)
      try {
        result = A.merge(doc, other)
      } finally {
        A.free(other)
      }
    } else result = A.applyChanges(doc, (peer.changes || []).map(decode))[0]
    if (A.getMissingDeps(result, []).length) throw new Error("Missing sync dependencies")
    return result
  }
  function resolve(doc, key, field, value) {
    const record = doc.records[key]
    if (
      !record ||
      !["connection", "content", "ref", "ids"].includes(field) ||
      !Object.values(A.getConflicts(record, field) || {})
        .map(String)
        .includes(value)
    )
      throw new Error("Conflict has changed; refresh and retry")
    return A.change(doc, (d) => {
      d.records[key][field] = new A.ImmutableString(value)
    })
  }
  return { load, save, project, projectConfiguration, reconcile, outgoing, receive, resolve, free: A.free }
}
