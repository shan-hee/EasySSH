// Keep dependencies used by different lazy entries separate: visiting the terminal
// must not pull in the editor, charts or AI. Split large graphs at module boundaries.
// maxSize is a pre-minification budget; single upstream modules can exceed it.
export const chunkOutput = {
  // Monaco has cyclic module graphs. Preserve initialization order when splitting
  // them, otherwise an editor constructor can run before its dependencies initialize.
  strictExecutionOrder: true,
  codeSplitting: {
    maxSize: 450_000,
    groups: [
      { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, entriesAware: true },
      { name: "monaco", test: /[\\/]node_modules[\\/]monaco-editor[\\/]/, entriesAware: true },
      { name: "charts", test: /[\\/]node_modules[\\/](echarts|zrender)[\\/]/, entriesAware: true },
      { name: "dockview", test: /[\\/]node_modules[\\/](dockview|dockview-core)[\\/]/, entriesAware: true },
      { name: "syntax-cpp", test: /[\\/]@shikijs[\\/]langs[\\/]dist[\\/]cpp(-macro)?\.mjs$/, entriesAware: true },
    ],
  },
}
