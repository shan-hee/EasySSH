import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import viteCompression from 'vite-plugin-compression';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync } from 'fs';

// ANSI颜色代码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m'
};

// 清除终端
const clearConsole = () => {
  process.stdout.write(process.platform === 'win32' ? '\x1Bc' : '\x1B[2J\x1B[3J\x1B[H');
};

// 自定义日志输出
const customLogger = () => {
  return {
    name: 'custom-logger',
    configureServer(server) {
      // 保存原始的listen方法
      const originalListen = server.httpServer.listen.bind(server.httpServer);
      
      // 重写listen方法
      server.httpServer.listen = function(...args) {
        const callback = args[args.length - 1];
        
        if (typeof callback === 'function') {
          args[args.length - 1] = () => {
            callback();
            
            clearConsole();
            
            const protocol = server.config.server.https ? 'https' : 'http';
            const host = 'localhost';
            const port = server.config.server.port;
            const networkUrl = `${protocol}://${host}:${port}`;
            
            const projectName = 'EasySSH';
            const version = 'v1.0.0';
            const mode = server.config.mode;
            
            console.log(`\n${colors.bright}${colors.cyan}${projectName} ${colors.white}${version} ${colors.yellow}前端开发服务${colors.reset}\n`);
            
            console.log(`${colors.white}本地地址${colors.reset}    : ${colors.green}${networkUrl}${colors.reset}`);
            console.log(`${colors.white}运行模式${colors.reset}    : ${colors.green}${mode}${colors.reset}`);
            console.log(`${colors.white}开发框架${colors.reset}    : ${colors.green}Vue3 + Vite${colors.reset}`);
            
            const timestamp = new Date().toLocaleTimeString();
            console.log(`${colors.white}启动时间${colors.reset}    : ${timestamp}`);
            
            console.log(`\n${colors.bright}${colors.yellow}可用命令${colors.reset}`);
            console.log(`${colors.white}按 ${colors.bright}h${colors.reset}${colors.white} 键${colors.reset}    : 显示帮助信息`);
            console.log(`${colors.white}按 ${colors.bright}r${colors.reset}${colors.white} 键${colors.reset}    : 手动重载页面`);
            console.log(`${colors.white}按 ${colors.bright}u${colors.reset}${colors.white} 键${colors.reset}    : 显示服务器URL`);
            console.log(`${colors.white}按 ${colors.bright}q${colors.reset}${colors.white} 键${colors.reset}    : 退出开发服务器`);
            console.log(`${colors.white}按 ${colors.bright}Ctrl+C${colors.reset}${colors.white} ${colors.reset} : 退出开发服务器\n`);
          };
        }
        
        return originalListen.apply(this, args);
      };
    }
  };
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd());
  const isDev = mode === 'development';
  const isAnalyze = mode === 'analyze';

  // 读取package.json获取版本号
  const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
  const appVersion = packageJson.version;
  
  return {
    plugins: [
      vue(),
      viteCompression({
        // 生产环境下启用gzip压缩
        disable: isDev,
        threshold: 10240, // 10kb以上文件进行压缩
        algorithm: 'gzip',
        ext: '.gz'
      }),
      // 构建分析插件
      isAnalyze && visualizer({
        filename: 'dist/stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
        template: 'treemap' // 可选: sunburst, treemap, network
      }),
      customLogger() // 添加自定义日志插件
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'), // src目录别名
        'scripts': resolve(__dirname, 'scripts'), // 兼容现有目录结构
        'styles': resolve(__dirname, 'src/assets/styles'),
        'assets': resolve(__dirname, 'src/assets')
      }
    },
    // 服务器配置
    server: {
      host: '0.0.0.0', // 监听所有网络接口，允许外部访问
      port: parseInt(env.VITE_PORT || '8520'), // 从环境变量读取前端端口
      open: true, // 自动打开浏览器
      cors: true, // 启用CORS
      proxy: {
        // 开发环境API代理配置
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:8000', // 从环境变量读取API目标地址
          changeOrigin: true,
          // 不重写路径，保留/api前缀
          // rewrite: (path) => path.replace(/^\/api/, '')
        },
        // WebSocket代理配置 - SSH连接
        '/ssh': {
          target: 'ws://localhost:8000', // 后端WebSocket服务地址
          ws: true, // 启用WebSocket代理
          changeOrigin: true,
          secure: false,
          timeout: 10000, // 10秒超时
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('SSH WebSocket代理错误:', err.message);
            });
            proxy.on('proxyReq', (proxyReq, req) => {
              console.log('SSH WebSocket代理请求:', req.url);
            });
          }
        },
        // WebSocket代理配置 - 监控服务
        '/monitor': {
          target: 'ws://localhost:8000', // 监控WebSocket服务地址
          ws: true, // 启用WebSocket代理
          changeOrigin: true,
          secure: false,
          timeout: 10000, // 10秒超时
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('监控WebSocket代理错误:', err.message);
            });
            proxy.on('proxyReq', (proxyReq, req) => {
              console.log('监控WebSocket代理请求:', req.url);
            });
          }
        }
      }
    },
    // 构建配置
    build: {
      target: 'es2020',
      outDir: 'dist',
      assetsDir: 'assets',
      assetsInlineLimit: 4096, // 4kb以下的资源内联为base64
      cssCodeSplit: true,
      sourcemap: !isDev ? false : 'inline',
      minify: !isDev ? 'terser' : false,
      // 启用构建缓存
      reportCompressedSize: !isDev,
      chunkSizeWarningLimit: 1000,
      // 解决模块外部化警告
      commonjsOptions: {
        ignoreTryCatch: false
      },
      terserOptions: {
        compress: {
          drop_console: !isDev, // 生产环境下移除console
          drop_debugger: !isDev,
          pure_funcs: !isDev ? ['console.log', 'console.info', 'console.debug'] : []
        },
        mangle: {
          safari10: true
        }
      },
      rollupOptions: {
        output: {
          // 优化的分包策略，解决模块初始化顺序问题
          manualChunks: (id) => {
            // 第三方库分包
            if (id.includes('node_modules')) {
              // Vue 核心库单独分包，避免循环依赖
              if (id.includes('vue/') && !id.includes('vue-router') && !id.includes('@vue')) {
                return 'vue-core';
              }

              // Vue 路由单独分包
              if (id.includes('vue-router')) {
                return 'vue-router';
              }

              // Pinia 状态管理单独分包
              if (id.includes('pinia')) {
                return 'pinia';
              }

              // Vue 编译器和其他 Vue 生态
              if (id.includes('@vue')) {
                return 'vue-utils';
              }

              // Element Plus UI库
              if (id.includes('element-plus')) {
                return 'element-plus';
              }

              // 终端相关库
              if (id.includes('@xterm')) {
                return 'xterm-addons';
              }

              // 图表库
              if (id.includes('echarts')) {
                return 'echarts';
              }

              // 工具库
              if (id.includes('axios') || id.includes('lodash') || id.includes('dayjs')) {
                return 'utils';
              }

              // 其他第三方库
              return 'vendor';
            }

            // 应用代码分包 - 最简化策略，将所有应用代码打包到一个文件中
            // 只保留最基础的分包，避免所有循环依赖问题
            if (id.includes('/src/')) {
              return 'app-bundle';
            }
          },

          // 自定义chunk文件名
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            // 使用 assetInfo.names 或 assetInfo.originalFileNames 替代已弃用的 name 属性
            const fileName = assetInfo.names?.[0] || assetInfo.originalFileNames?.[0] || 'unknown';

            if (/\.(png|jpe?g|gif|svg|webp|ico)$/.test(fileName)) {
              return 'assets/images/[name]-[hash][extname]';
            }
            if (/\.(woff2?|eot|ttf|otf)$/.test(fileName)) {
              return 'assets/fonts/[name]-[hash][extname]';
            }
            if (/\.css$/.test(fileName)) {
              return 'assets/css/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          }
        }
      },

      // chunk大小警告阈值已在上面设置
    },
    // CSS配置
    css: {
      preprocessorOptions: {
        scss: {
          // 使用新版 Sass API, 移除错误的CSS导入
          // CSS文件应该通过main.js或组件直接导入
          additionalData: ``,
          // 抑制 Sass 弃用警告
          silenceDeprecations: ['legacy-js-api']
        }
      },
      devSourcemap: true
    },
    // 性能优化相关
    optimizeDeps: {
      include: [
        'vue',
        'vue-router',
        'pinia',
        'pinia-plugin-persistedstate',
        'element-plus',
        'element-plus/es',
        '@xterm/xterm',
        '@xterm/addon-fit',
        '@xterm/addon-web-links',
        '@xterm/addon-search',
        '@xterm/addon-webgl',
        '@xterm/addon-unicode11',
        'axios',
        'echarts/core',
        'echarts/charts',
        'echarts/components'
      ],
      // 排除一些不需要预构建的模块
      exclude: [
        '@xterm/addon-ligatures' // 排除有Node.js依赖的模块
      ],
      // 强制预构建，确保依赖关系正确
      force: true
    },



    // 定义全局常量，减少运行时检查
    define: {
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
      // 定义Node.js环境变量
      'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
      // 注入应用版本号
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion)
    }
  };
});