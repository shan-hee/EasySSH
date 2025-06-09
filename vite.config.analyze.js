import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

/**
 * 专门用于构建分析的Vite配置
 * 使用方式: npm run build:analyze
 */
export default defineConfig({
  plugins: [
    vue(),
    // 详细的构建分析
    visualizer({
      filename: 'dist/bundle-analysis.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
      template: 'treemap', // treemap, sunburst, network
      title: 'EasySSH Bundle Analysis'
    }),
    // 网络图分析
    visualizer({
      filename: 'dist/bundle-network.html',
      template: 'network',
      title: 'EasySSH Dependencies Network'
    }),
    // 统计信息
    visualizer({
      filename: 'dist/bundle-stats.json',
      template: 'raw-data',
      title: 'EasySSH Bundle Statistics'
    })
  ],
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      'scripts': resolve(__dirname, 'scripts'),
      'styles': resolve(__dirname, 'src/assets/styles'),
      'assets': resolve(__dirname, 'src/assets')
    }
  },
  
  build: {
    target: 'es2015',
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 4096,
    cssCodeSplit: true,
    sourcemap: true, // 分析时启用sourcemap
    minify: 'terser',
    reportCompressedSize: true,
    
    rollupOptions: {
      output: {
        // 详细的分包策略用于分析
        manualChunks: (id) => {
          // 第三方库详细分包
          if (id.includes('node_modules')) {
            // Vue生态系统
            if (id.includes('vue') && !id.includes('vue-router')) {
              return 'vue-core';
            }
            if (id.includes('vue-router')) {
              return 'vue-router';
            }
            if (id.includes('pinia')) {
              return 'pinia';
            }
            if (id.includes('@vue')) {
              return 'vue-utils';
            }

            // UI库
            if (id.includes('element-plus')) {
              return 'element-plus';
            }

            // 终端相关
            if (id.includes('@xterm/xterm')) {
              return 'xterm-core';
            }
            if (id.includes('@xterm/addon')) {
              return 'xterm-addons';
            }

            // 代码编辑器
            if (id.includes('@codemirror')) {
              if (id.includes('lang-')) {
                return 'codemirror-languages';
              }
              return 'codemirror-core';
            }
            if (id.includes('@lezer')) {
              return 'lezer';
            }

            // 图表库
            if (id.includes('echarts')) {
              return 'echarts';
            }

            // 网络库
            if (id.includes('axios')) {
              return 'axios';
            }
            if (id.includes('socket.io')) {
              return 'socket-io';
            }

            // 加密库
            if (id.includes('crypto-js')) {
              return 'crypto';
            }

            // 工具库
            if (id.includes('lodash')) {
              return 'lodash';
            }

            // 其他第三方库
            return 'vendor-misc';
          }

          // 应用代码详细分包
          if (id.includes('/src/')) {
            if (id.includes('/services/')) {
              if (id.includes('ssh') || id.includes('terminal')) {
                return 'services-ssh';
              }
              if (id.includes('monitoring') || id.includes('log')) {
                return 'services-monitoring';
              }
              return 'services-misc';
            }

            if (id.includes('/store/')) {
              return 'store';
            }

            if (id.includes('/components/')) {
              if (id.includes('terminal')) {
                return 'components-terminal';
              }
              if (id.includes('sftp')) {
                return 'components-sftp';
              }
              if (id.includes('monitoring')) {
                return 'components-monitoring';
              }
              return 'components-misc';
            }

            if (id.includes('/views/')) {
              return 'views';
            }

            if (id.includes('/utils/')) {
              return 'utils';
            }
          }

          return 'main';
        }
      }
    }
  },

  // 性能分析相关配置
  esbuild: {
    // 保留函数名用于分析
    keepNames: true
  }
});
