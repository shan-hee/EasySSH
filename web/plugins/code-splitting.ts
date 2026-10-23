// Split at feature boundaries first. The runtime is needed everywhere; splitting it
// by every lazy entry adds requests without deferring useful work.
export const chunkOutput = {
  // Monaco's cyclic modules must retain their initialization order.
  strictExecutionOrder: true,
  codeSplitting: {
    groups: [
      { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 10 },
      // Coalesce tiny icon subgroups, while keeping feature-only icons demand-loaded.
      { name: "icons", test: /[\\/]node_modules[\\/]lucide-react[\\/]/, entriesAware: true, entriesAwareMergeThreshold: 16_000 },
      // Size budgets apply only to heavy feature graphs, not the common runtime.
      { name: "monaco", test: /[\\/]node_modules[\\/]monaco-editor[\\/]/, entriesAware: true, maxSize: 450_000 },
      { name: "charts", test: /[\\/]node_modules[\\/](echarts|zrender)[\\/]/, entriesAware: true, maxSize: 450_000 },
      { name: "dockview", test: /[\\/]node_modules[\\/](dockview|dockview-core)[\\/]/, entriesAware: true, maxSize: 450_000 },
      { name: "syntax-cpp", test: /[\\/]@shikijs[\\/]langs[\\/]dist[\\/]cpp(-macro)?\.mjs$/, entriesAware: true, maxSize: 450_000 },
    ],
  },
}
