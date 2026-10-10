// Shared by Wails and the server worker. Transport and persistence stay outside.
export function createEngine(A) {
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
        !/^(server|script|value)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
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
        if ((field === "connection" || field === "content" || field === "ref") && values.length > 1)
          conflicts.push({ key, field, values })
      }
      snapshot[key] = fields
    }
    return { snapshot, conflicts }
  }
  function reconcile(doc, current) {
    const previous = project(doc).snapshot
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
        if (!(key in current)) d.records[key].$deleted = new A.ImmutableString("true")
      for (const [key, record] of Object.entries(current)) {
        if (!previous[key]) d.records[key].$deleted = new A.ImmutableString("false")
        // Immutable strings keep connection bundles and scripts atomic.
        for (const [field, value] of Object.entries(record))
          if (previous[key]?.[field] !== value) d.records[key][field] = new A.ImmutableString(value)
      }
    })
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
      !["connection", "content", "ref"].includes(field) ||
      !Object.values(A.getConflicts(record, field) || {})
        .map(String)
        .includes(value)
    )
      throw new Error("Conflict has changed; refresh and retry")
    return A.change(doc, (d) => {
      d.records[key][field] = new A.ImmutableString(value)
    })
  }
  return { load, save, project, reconcile, outgoing, receive, resolve, free: A.free }
}
