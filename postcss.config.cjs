const purgecss = require('@fullhuman/postcss-purgecss');

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
        safelist: [
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
          /^message/
        ]
      })
  ].filter(Boolean)
};

