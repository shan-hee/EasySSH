// 轻量 Fig 数据加载器（基于 Vite import.meta.glob）
// - 在 src/assets/fig-specs/*.json 中放置精简过的命令规格
// - 这里使用 eager 导入以保持同步 Provider 流程（数据规模小）

const modules = import.meta.glob('../../assets/fig-specs/*.json', { eager: true });

const _specs = new Map();
const _names = new Set();

for (const path in modules) {
  try {
    const json = modules[path];
    const file = path.split('/').pop();
    const name = (file || '').replace(/\.json$/i, '').toLowerCase();
    if (name) {
      _specs.set(name, json?.default || json);
      _names.add(name);
    }
  } catch (_) {}
}

export function listCommands() {
  return Array.from(_names.values());
}

export function getSpec(name) {
  if (!name) return null;
  return _specs.get(String(name).toLowerCase()) || null;
}

export default { listCommands, getSpec };

