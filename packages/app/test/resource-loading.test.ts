import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { describe, it } from "node:test"
import { createInstance } from "i18next"
import { createElement, Suspense } from "react"
import { renderToString } from "react-dom/server"
import { createRetryableLoader } from "../src/lib/retryable-loader"
import { createPreloadableComponent } from "../src/lib/preloadable-component"
import { createNamespaceBackend, type NamespaceLoaders } from "../src/i18n/namespace-backend"

describe("retryable page loading", () => {
  it("deduplicates pending requests and retries only after an explicit reset", async () => {
    let attempts = 0
    const resource = createRetryableLoader(async () => {
      if (++attempts === 1) throw new Error("offline")
      return "loaded"
    })
    const pending = resource.load()
    assert.equal(resource.load(), pending)
    await pending
    assert.throws(() => resource.read(), /offline/)
    await resource.load()
    assert.equal(attempts, 1)
    resource.reset()
    await resource.load()
    assert.equal(resource.read(), "loaded")
    resource.reset()
    await resource.load()
    assert.equal(attempts, 2)
  })
})

describe("preloaded component rendering", () => {
  it("shares concurrent preloads and renders immediately without the Suspense fallback", async () => {
    let attempts = 0
    const { Component, preload } = createPreloadableComponent(async () => {
      attempts += 1
      return { default: ({ label }: { label: string }) => createElement("span", null, label) }
    })

    await Promise.all([preload(), preload()])
    const html = renderToString(createElement(
      Suspense,
      { fallback: createElement("p", null, "loading-fallback") },
      createElement(Component, { label: "connection-ready" }),
    ))

    assert.equal(attempts, 1)
    assert.match(html, /<span>connection-ready<\/span>/)
    assert.doesNotMatch(html, /loading-fallback/)
  })
})

describe("namespace translations", () => {
  it("loads only the requested locale and namespaces, then switches language", async () => {
    const requested: string[] = []
    const loaders: NamespaceLoaders = {}
    for (const locale of ["zh-CN", "en-US"]) {
      for (const ns of ["common", "terminal"]) {
        loaders[`./messages/${locale}/${ns}.json`] = async () => {
          requested.push(`${locale}/${ns}`)
          return { title: `${locale}/${ns}` }
        }
      }
    }
    const i18n = createInstance()
    await i18n.use(createNamespaceBackend(loaders, assert.fail)).init({
      lng: "zh-CN", fallbackLng: false, load: "currentOnly", ns: ["common"], defaultNS: "common",
    })
    assert.deepEqual(requested, ["zh-CN/common"])
    await i18n.loadNamespaces("terminal")
    assert.equal(i18n.t("terminal:title"), "zh-CN/terminal")
    await i18n.changeLanguage("en-US")
    assert.equal(i18n.t("terminal:title"), "en-US/terminal")
    assert.equal(i18n.t("title"), "en-US/common")
    assert.equal(requested.length, 4)
  })

  it("reports failed loads and recovers on a fresh page initialization", async () => {
    let offline = true
    const errors: Error[] = []
    const i18n = createInstance()
    const backend = createNamespaceBackend({
      "./messages/zh-CN/common.json": async () => {
        if (offline) throw new Error("offline")
        return { title: "已恢复" }
      },
    }, (error) => errors.push(error))
    const options = {
      lng: "zh-CN", fallbackLng: false, load: "currentOnly", ns: ["common"], defaultNS: "common",
    } as const
    await i18n.use(backend).init(options)
    assert.equal(errors.length, 1)
    offline = false
    const reloaded = createInstance()
    await reloaded.use(backend).init(options)
    assert.equal(reloaded.t("title"), "已恢复")
  })

  it("keeps every Chinese translation key available in English", async () => {
    const root = new URL("../src/i18n/messages/", import.meta.url)
    const files = await readdir(new URL("zh-CN/", root))
    const keys = (object: Record<string, unknown>, prefix = ""): string[] => Object.entries(object).flatMap(
      ([key, value]) => value !== null && typeof value === "object"
        ? keys(value as Record<string, unknown>, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    )
    for (const file of files) {
      const zh = JSON.parse(await readFile(new URL(`zh-CN/${file}`, root), "utf8"))
      const en = JSON.parse(await readFile(new URL(`en-US/${file}`, root), "utf8"))
      const englishKeys = new Set(keys(en))
      assert.deepEqual(keys(zh).filter((key) => !englishKeys.has(key)), [], file)
    }
  })
})
