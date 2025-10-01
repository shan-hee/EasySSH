// @fullhuman/postcss-purgecss v7 is ESM; require() returns a namespace object.
// Use the default export so we can call it as a function in CJS.
const purgecss = require('@fullhuman/postcss-purgecss').default;

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  plugins: [
    // 仅在生产环境启用，清理未使用的选择器
    isProd &&
      purgecss({
        content: [
          'index.html',
          'src/**/*.{vue,js,ts,jsx,tsx}',
          // 也扫描脚本目录中可能含有内联模板/类名的文件
          'scripts/**/*.{js,ts}'
        ],
        defaultExtractor: content => content.match(/[A-Za-z0-9-_:/.]+/g) || [],
        // 保留 @font-face 与关键帧，避免被误删
        fontFace: false,
        keyframes: false,
        safelist: [
          // 保留全局根选择器，避免清理监控主题的 CSS 变量
          ':root',
          /:root\[data-theme=.*\]/,
          // Element Plus & 运行态生成类
          /^el-/,
          /^is-/,
          // Vue 过渡类
          /^v-/,
          /-(enter|leave|appear)(|-(to|from|active))$/,
          // Router 链接态
          /^router-link/,
          // 主题切换相关
          /^dark-theme$/,
          /^light-theme$/,
          // 火箭加载器动态阶段类（在模板中通过计算属性生成）
          /^phase-/,
          // 动态图标与徽章类（基于 name/type 拼接）
          /^toolbar-icon--/,
          /^monitoring-icon--/,
          /^autocomplete-type--/,
          // 监控加载器动态状态与尺寸类
          /^loader-/,
          // 第三方库前缀
          /^xterm/,
          /^cm-/,
          // 项目自定义命名空间（组件/模块）
          /^monitor-/,
          /^sftp-/,
          /^terminal-/,
          /^app-/,
          /^ai-/,
          /^dashboard-/,
          /^card-/,
          /^btn-/,
          /^icon/,
          /^tooltip/,
          /^popper/,
          /^message/,
          // 设置面板 & 其他自定义 Modal 类名
          // 使用正则，保证组合选择器（如 .user-settings-modal.modal-container）不会被误删
          /user-settings-modal/,
          /mfa-verify-modal/,
          /mfa-disable-modal/,
          /logout-devices-modal/,
          /mfa-modal/,
          /connection-modal/,
          // 常见的容器类，防止与自定义类组合时被清理
          /modal-container/
        ]
      })
  ].filter(Boolean)
};
