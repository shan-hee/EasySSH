import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { createFolderBundle, uploadFoldersFromInput } from "../src/lib/folder-upload"

function selected(path: string, content: string): File {
  const file = new File([content], path.split("/").pop() ?? path)
  Object.defineProperty(file, "webkitRelativePath", { value: path })
  return file
}

describe("folder upload", () => {
  it("lists ancestor directories before their children", () => {
    const [folder, ...rest] = uploadFoldersFromInput([
      selected("site/assets/js/app.js", "app"),
      selected("site/index.html", "<html>"),
    ] as unknown as FileList)

    assert.equal(rest.length, 0)
    assert.equal(folder?.name, "site")
    assert.deepEqual(folder?.directories, ["assets", "assets/js"])
    assert.deepEqual(folder?.files.map(({ path }) => path), ["assets/js/app.js", "index.html"])
  })

  it("encodes the manifest ahead of the file contents", async () => {
    const bundle = createFolderBundle({
      name: "site",
      directories: ["empty"],
      files: [{ path: "a.txt", file: new File(["aa"], "a.txt") }, { path: "b.txt", file: new File(["bbb"], "b.txt") }],
    })
    const bytes = new Uint8Array(await bundle.arrayBuffer())
    const magic = "EASYSSH-FOLDER-1\n"
    assert.equal(new TextDecoder().decode(bytes.subarray(0, magic.length)), magic)
    const size = new DataView(bytes.buffer).getUint32(magic.length)
    const manifestEnd = magic.length + 4 + size
    assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes.subarray(magic.length + 4, manifestEnd))), {
      directories: ["empty"],
      files: [{ path: "a.txt", size: 2 }, { path: "b.txt", size: 3 }],
    })
    assert.equal(new TextDecoder().decode(bytes.subarray(manifestEnd)), "aabbb")
  })
})
