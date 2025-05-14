import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import viteCompression from 'vite-plugin-compression';

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
export default defineConfig(({ command, mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd());
  const isDev = mode === 'development';
  
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
      customLogger() // 添加自定义日志插件
    ],
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
      host: 'localhost',
      port: parseInt(env.VITE_PORT || '3000'), // 从环境变量读取前端端口
      open: true, // 自动打开浏览器
      cors: true, // 启用CORS
      proxy: {
        // 开发环境API代理配置
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:8000', // 从环境变量读取API目标地址
          changeOrigin: true,
          // 不重写路径，保留/api前缀
          // rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    },
    // 构建配置
    build: {
      target: 'es2015',
      outDir: 'dist',
      assetsDir: 'assets',
      assetsInlineLimit: 4096, // 4kb以下的资源内联为base64
      cssCodeSplit: true,
      sourcemap: !isDev ? false : 'inline',
      minify: !isDev ? 'terser' : false,
      terserOptions: {
        compress: {
          drop_console: !isDev, // 生产环境下移除console
          drop_debugger: !isDev
        }
      },
      rollupOptions: {
        output: {
          // 分包策略，将依赖分离打包
          manualChunks: {
            vue: ['vue', 'vue-router', 'pinia'],
            elementPlus: ['element-plus'],
            terminal: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links']
          },
          // 自定义chunk文件名
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const extType = assetInfo.name.split('.').at(1);
            if (/\.(png|jpe?g|gif|svg|webp|ico)$/.test(assetInfo.name)) {
              return 'assets/images/[name]-[hash][extname]';
            }
            if (/\.(woff2?|eot|ttf|otf)$/.test(assetInfo.name)) {
              return 'assets/fonts/[name]-[hash][extname]';
            }
            if (/\.css$/.test(assetInfo.name)) {
              return 'assets/css/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          }
        }
      }
    },
    // CSS配置
    css: {
      preprocessorOptions: {
        scss: {
          // 使用新版 Sass API, 使用相对路径导入
          additionalData: `@import "./src/assets/styles/base/base.css";`
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
        'element-plus',
        '@xterm/xterm',
        '@xterm/addon-fit',
        '@xterm/addon-web-links',
        '@xterm/addon-search',
        '@xterm/addon-webgl',
        '@xterm/addon-unicode11',
        '@xterm/addon-ligatures'
      ]
    }
  };
});