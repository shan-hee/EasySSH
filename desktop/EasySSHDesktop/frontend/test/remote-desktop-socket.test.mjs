import assert from "node:assert/strict"
import { beforeEach, mock, test } from "node:test"

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let open, writes, closes, nextFrame, endStream, stopped, available, pendingWrite
mock.module(new URL("../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice.ts", import.meta.url).href, {
  exports: {
    OpenRemoteDesktop: (...args) => open(...args),
    WriteRemoteDesktop: async (id, data) => { writes.push([id, Buffer.from(data, "base64")]); await pendingWrite?.promise },
    CloseStream: async id => { closes.push(id) },
  },
})
mock.module(new URL("../src/remote/remote-stream.ts", import.meta.url).href, {
  exports: {
    decodeRemoteBytes: value => Uint8Array.from(Buffer.from(value, "base64")),
    readRemoteStream: (_id, frame, closed) => { nextFrame = frame; endStream = closed; return () => { stopped++ } },
  },
})
mock.module(new URL("../src/remote/remote-transport.ts", import.meta.url).href, {
  exports: {
    remoteAccessEnded: error => String(error).includes("access_ended"),
    setRemoteAvailable: value => { available = value },
  },
})
const { createRemoteDesktopSocket } = await import("../src/remote/remote-desktop-socket.ts")
beforeEach(() => {
  open = async () => ({ id: "stream" })
  writes = []; closes = []; stopped = 0; available = true
  nextFrame = endStream = pendingWrite = undefined
})

test("VNC copies reused send buffers, preserves byte ordering and decodes binary output", async () => {
  const socket = createRemoteDesktopSocket("connection", "vnc")
  assert.throws(() => socket.send("early"), { name: "InvalidStateError" })
  await tick()
  assert.equal(socket.readyState, socket.OPEN)
  assert.equal(socket.protocol, "binary")
  pendingWrite = deferred()
  const source = new Uint8Array([0, 255, 128])
  socket.send(source)
  source.fill(42)
  socket.send(source)
  await tick()
  assert.equal(writes.length, 1)
  assert.deepEqual([...writes[0][1]], [0, 255, 128])
  assert.equal(socket.bufferedAmount, 6)
  pendingWrite.resolve()
  await tick()
  assert.deepEqual([...writes[1][1]], [42, 42, 42])
  assert.equal(socket.bufferedAmount, 0)
  let message
  socket.onmessage = event => { message = event.data }
  nextFrame({ encoding: "vnc.bytes", data: "AP+A" })
  assert.deepEqual([...new Uint8Array(message)], [0, 255, 128])
  socket.close()
  assert.equal(stopped, 1)
  assert.deepEqual(closes, ["stream"])
})

test("RDP preserves Unicode instructions and forwards only this connection's credentials", async () => {
  const opened = []
  open = async (...args) => { opened.push(args); return { id: "rdp-stream" } }
  const socket = createRemoteDesktopSocket("rdp-connection", "rdp")
  socket.onopen = () => socket.send(JSON.stringify({ username: "用户", password: "transient" }))
  await tick()
  assert.deepEqual(opened, [["rdp-connection", "rdp"]])
  assert.equal(writes[0][0], "rdp-stream")
  assert.deepEqual(JSON.parse(writes[0][1].toString()), { username: "用户", password: "transient" })
  let message
  socket.onmessage = event => { message = event.data }
  const instruction = '["name","桌面😀"]'
  nextFrame({ encoding: "rdp.json", data: Buffer.from(instruction).toString("base64") })
  assert.equal(message, instruction)
  socket.close()
})

test("closing during open releases the late native stream without reopening", async () => {
  const opening = deferred()
  open = () => opening.promise
  const socket = createRemoteDesktopSocket("connection", "vnc")
  let opens = 0, closed = 0
  socket.onopen = () => { opens++ }
  socket.onclose = () => { closed++ }
  await tick()
  socket.close()
  opening.resolve({ id: "late-stream" })
  await tick()
  assert.equal(opens, 0)
  assert.equal(closed, 1)
  assert.equal(socket.readyState, socket.CLOSED)
  assert.deepEqual(closes, ["late-stream"])
})

test("revocation ends the workspace and send overflow closes the channel", async () => {
  const socket = createRemoteDesktopSocket("connection", "vnc")
  await tick()
  endStream("access_ended")
  assert.equal(available, false)
  assert.equal(socket.readyState, socket.CLOSED)
  const overflow = createRemoteDesktopSocket("another", "vnc")
  await tick()
  overflow.send(new Uint8Array((1 << 20) + 1))
  assert.equal(overflow.readyState, overflow.CLOSED)
  assert.equal(writes.length, 0)
})
