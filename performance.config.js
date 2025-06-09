/**
 * 性能监控配置
 * 用于开发和生产环境的性能优化设置
 */

export const performanceConfig = {
  // 构建性能配置
  build: {
    // 代码分割阈值
    chunkSizeWarningLimit: 1000, // 1MB
    
    // 资源内联阈值
    assetsInlineLimit: 4096, // 4KB
    
    // 压缩配置
    compression: {
      threshold: 10240, // 10KB
      algorithm: 'gzip',
      deleteOriginalAssets: false
    },
    
    // Terser优化配置
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
        passes: 2
      },
      mangle: {
        safari10: true
      },
      format: {
        comments: false
      }
    }
  },
  
  // 运行时性能配置
  runtime: {
    // 缓存配置
    cache: {
      memory: {
        maxSize: 100,
        ttl: 1800000 // 30分钟
      },
      localStorage: {
        maxSize: 50,
        ttl: 86400000 // 24小时
      }
    },
    
    // 网络请求配置
    network: {
      timeout: 10000,
      retries: 3,
      retryDelay: 1000
    },
    
    // 虚拟滚动配置
    virtualScroll: {
      itemHeight: 40,
      bufferSize: 10,
      threshold: 100
    }
  },
  
  // 监控配置
  monitoring: {
    // 性能指标收集
    metrics: {
      enabled: true,
      sampleRate: 0.1, // 10%采样率
      maxEntries: 1000
    },
    
    // 错误监控
    errorTracking: {
      enabled: true,
      maxErrors: 100,
      ignorePatterns: [
        /Script error/,
        /Non-Error promise rejection captured/
      ]
    },
    
    // 资源监控
    resourceTiming: {
      enabled: true,
      bufferSize: 150
    }
  },
  
  // 优化策略
  optimization: {
    // 懒加载配置
    lazyLoading: {
      enabled: true,
      threshold: 0.1, // 10%可见时加载
      rootMargin: '50px'
    },
    
    // 预加载配置
    preloading: {
      enabled: true,
      priority: ['critical', 'high', 'medium'],
      maxConcurrent: 3
    },
    
    // 防抖节流配置
    debounce: {
      search: 300,
      resize: 100,
      scroll: 16
    }
  }
};

// 环境特定配置
export const getEnvironmentConfig = (env = 'development') => {
  const baseConfig = { ...performanceConfig };
  
  if (env === 'production') {
    // 生产环境优化
    baseConfig.build.terserOptions.compress.drop_console = true;
    baseConfig.monitoring.metrics.sampleRate = 0.05; // 5%采样率
    baseConfig.runtime.cache.memory.ttl = 3600000; // 1小时
  } else if (env === 'development') {
    // 开发环境优化
    baseConfig.build.terserOptions.compress.drop_console = false;
    baseConfig.monitoring.metrics.sampleRate = 1; // 100%采样率
    baseConfig.runtime.cache.memory.ttl = 300000; // 5分钟
  }
  
  return baseConfig;
};

export default performanceConfig;
