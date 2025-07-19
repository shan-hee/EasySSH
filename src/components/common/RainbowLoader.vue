<template>
  <div class="rainbow-loader-container">
    <div class="rainbow-morph"> <!-- 外部容器 -->
      <div class="morph-with-liquid"></div> <!-- 变形液体效果元素 -->
    </div>
  </div>
</template>

<script>
export default {
  name: 'RainbowLoader'
}
</script>

<style scoped>
.rainbow-loader-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

/* 彩虹变形形状的外部容器 */
.rainbow-morph {
  position: relative; /* 相对定位，为内部元素和伪元素提供定位基准 */
  width: 120px; /* 设置宽度 */
  height: 120px; /* 设置高度 */
  overflow: visible; /* 允许内容溢出以显示3D效果 */
  border-radius: 50%; /* 将容器设置为圆形 */
  perspective: 500px; /* 设置3D视角距离 */
  transform-style: preserve-3d; /* 保留3D空间 */
  /* 添加加速动画 */
  animation: morph-container-accel 4s cubic-bezier(0.23, 1, 0.32, 1) forwards;
}

/* 彩虹加速动画 */
@keyframes morph-container-accel {
  0% { transform: scale(1) translateY(0); }
  20% { transform: scale(1.05) translateY(-2px); }
  40% { transform: scale(1.1) translateY(-4px); }
  70% { transform: scale(1.15) translateY(-6px); }
  100% { transform: scale(1.2) translateY(-8px); }
}

/* 变形液体效果的主要元素 */
.morph-with-liquid {
  width: 100%; /* 填满父容器 */
  height: 100%; /* 填满父容器 */
  background: linear-gradient(135deg, 
    #ff0000, #ff6600, #ffcc00, 
    #00ff00, #00aaff,
    #0000ff, #6600ff, 
    #ff00ff, #ff0066, #ff0000); /* 简化的彩虹渐变 */
  background-size: 1000% 1000%; /* 扩大背景尺寸以便动画移动 */
  animation: 
     morph 6s ease-in-out infinite, /* 变形动画 */
     rainbow-bg 6s linear infinite, /* 彩虹背景移动 */
     rotate 12s linear infinite, /* 旋转效果 */
     accel-spin 4s cubic-bezier(0.23, 1, 0.32, 1) forwards; /* 加速动画 */
  border-radius: 50%; /* 初始状态为圆形 */
  position: relative; /* 为光泽效果的伪元素提供定位基准 */
  /* 添加边缘模糊效果 - 增强模糊程度 */
  box-shadow: var(--shadow-xl); /* 使用主题阴影变量 */
  filter: blur(5px); /* 整体强模糊效果 */
  /* 立体效果 */
  transform-style: preserve-3d; /* 保留3D空间 */
  transform: translateZ(0); /* 初始Z轴位置 */
}

/* 加速旋转动画 */
@keyframes accel-spin {
  0% { animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
  20% { animation-duration: 10s; animation-timing-function: cubic-bezier(0.23, 0.9, 0.32, 0.9); }
  40% { animation-duration: 8s; animation-timing-function: cubic-bezier(0.23, 0.8, 0.32, 0.8); }
  60% { animation-duration: 6s; animation-timing-function: cubic-bezier(0.23, 0.7, 0.32, 0.7); }
  80% { animation-duration: 4s; animation-timing-function: cubic-bezier(0.23, 0.6, 0.32, 0.6); }
  100% { animation-duration: 2s; animation-timing-function: linear; }
}

/* 边缘模糊效果增强层 - 完全模糊效果 */
.morph-with-liquid::after {
  content: ''; /* 伪元素必需的内容属性 */
  position: absolute; /* 绝对定位 */
  top: -10px; /* 向外扩展更多 */
  left: -10px; /* 向外扩展更多 */
  right: -10px; /* 向外扩展更多 */
  bottom: -10px; /* 向外扩展更多 */
  background: inherit; /* 继承父元素的背景 */
  border-radius: inherit; /* 继承父元素的边框圆角 */
  filter: blur(15px); /* 极强模糊效果 */
  opacity: 0.8; /* 增加不透明度 */
  z-index: -1; /* 放置在父元素后面 */
  transform: translateZ(-10px) scale(1.1); /* 3D下移并更大放大 */
}

/* 添加光泽效果的伪元素 */
.morph-with-liquid::before {
  content: ''; /* 伪元素必需的内容属性 */
  position: absolute; /* 绝对定位 */
  top: 10%; /* 距顶部10% */
  left: 20%; /* 距左侧20% */
  width: 30%; /* 宽度为父元素的30% */
  height: 20%; /* 高度为父元素的20% */
  background: rgba(255,255,255,0.4); /* 半透明白色 */
  border-radius: 50%; /* 设置为圆形 */
  filter: blur(5px); /* 模糊效果 */
  transform: translateZ(5px) rotate(-45deg); /* Z轴上移并旋转 */
  animation: gloss-move 17s ease-in-out infinite; /* 时间延长到17秒 */
  z-index: 2; /* 确保在模糊边缘上方 */
}

/* 3D立体底部阴影 */
.rainbow-morph::after {
  content: ''; /* 伪元素必需的内容属性 */
  position: absolute; /* 绝对定位 */
  width: 85%; /* 宽度为父元素的85% */
  height: 20px; /* 高度固定 */
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 70%); /* 径向渐变阴影 */
  bottom: -30px; /* 位置在底部下方 */
  left: 7.5%; /* 左右居中 */
  border-radius: 50%; /* 椭圆形状 */
  filter: blur(10px); /* 模糊效果 */
  transform: rotateX(60deg) translateZ(-30px); /* 3D旋转和位移 */
  animation: shadow-animation 5s ease-in-out infinite; /* 与主动画同步 */
  z-index: -2; /* 置于最底层 */
}

/* 阴影动画 */
@keyframes shadow-animation {
  0%, 100% { transform: rotateX(60deg) translateZ(-30px) scale(1); opacity: 0.5; }
  50% { transform: rotateX(60deg) translateZ(-30px) scale(0.8); opacity: 0.3; }
}

/* 光泽移动动画 - 减少关键帧 */
@keyframes gloss-move {
  0% { top: 10%; left: 20%; opacity: 0.4; transform: translateZ(5px) rotate(-45deg); }
  20% { top: 15%; left: 30%; opacity: 0.5; transform: translateZ(8px) rotate(-30deg); }
  40% { top: 8%; left: 12%; opacity: 0.3; transform: translateZ(6px) rotate(-50deg); }
  60% { top: 25%; left: 15%; opacity: 0.6; transform: translateZ(9px) rotate(-20deg); }
  80% { top: 5%; left: 35%; opacity: 0.4; transform: translateZ(7px) rotate(-60deg); }
  100% { top: 10%; left: 20%; opacity: 0.4; transform: translateZ(5px) rotate(-45deg); }
}

/* 形状变形动画关键帧 - 极度平滑的过渡 */
@keyframes morph {
  0%, 5% { /* 开始时短暂圆形状态 */
    border-radius: 50%;
    transform: translateZ(20px) scale(1); 
  }
  /* 连续的过渡帧，确保变形平滑 */
  7% { border-radius: 48% 52% 50% 50% / 50% 54% 46% 50%; transform: translateZ(21px) scale(1.005); }
  9% { border-radius: 46% 54% 50% 50% / 50% 58% 42% 50%; transform: translateZ(21.5px) scale(1.01); }
  11% { border-radius: 44% 56% 51% 49% / 49% 62% 38% 51%; transform: translateZ(22px) scale(1.015); }
  13% { border-radius: 43% 57% 51.5% 48.5% / 48% 66% 34% 52%; transform: translateZ(22.5px) scale(1.018); }
  15% { border-radius: 42% 58% 52% 48% / 47% 70% 30% 53%; transform: translateZ(23px) scale(1.02); }
  17% { border-radius: 41% 59% 53% 47% / 46% 73% 27% 54%; transform: translateZ(23.5px) scale(1.022); }
  19% { border-radius: 40% 60% 54% 46% / 45% 76% 24% 55%; transform: translateZ(24px) scale(1.025); }
  21% { border-radius: 39% 61% 56% 44% / 48% 73% 27% 52%; transform: translateZ(24.5px) scale(1.027); }
  23% { border-radius: 38% 62% 59% 41% / 52% 70% 30% 48%; transform: translateZ(25px) scale(1.03); }
  25% { border-radius: 37% 63% 62% 38% / 56% 67% 33% 44%; transform: translateZ(24.5px) scale(1.032); }
  27% { border-radius: 38% 62% 65% 35% / 60% 64% 36% 40%; transform: translateZ(24px) scale(1.034); }
  29% { border-radius: 38% 62% 68% 32% / 65% 59% 41% 35%; transform: translateZ(23.5px) scale(1.036); }
  31% { border-radius: 38% 62% 71% 29% / 70% 52% 48% 30%; transform: translateZ(23px) scale(1.038); }
  33% { border-radius: 38% 62% 74% 26% / 75% 45% 55% 25%; transform: translateZ(22.5px) scale(1.039); }
  35% { border-radius: 38% 62% 73% 27% / 79% 38% 62% 21%; transform: translateZ(22px) scale(1.04); }
  37% { border-radius: 40% 60% 70% 30% / 76% 40% 60% 24%; transform: translateZ(21px) scale(1.035); }
  39% { border-radius: 43% 57% 67% 33% / 73% 42% 58% 27%; transform: translateZ(20px) scale(1.03); }
  41% { border-radius: 46% 54% 63% 37% / 70% 44% 56% 30%; transform: translateZ(19px) scale(1.025); }
  43% { border-radius: 49% 51% 60% 40% / 66% 46% 54% 34%; transform: translateZ(18px) scale(1.02); }
  45% { border-radius: 52% 48% 57% 43% / 62% 48% 52% 38%; transform: translateZ(17px) scale(1.015); }
  47% { border-radius: 55% 45% 54% 46% / 58% 50% 50% 42%; transform: translateZ(16px) scale(1.01); }
  49% { border-radius: 58% 42% 51% 49% / 54% 52% 48% 46%; transform: translateZ(15px) scale(1.005); }
  51% { border-radius: 61% 39% 47% 53% / 50% 54% 46% 50%; transform: translateZ(14px) scale(1); }
  53% { border-radius: 63% 37% 44% 56% / 48% 56% 44% 52%; transform: translateZ(13px) scale(0.995); }
  55% { border-radius: 65% 35% 40% 60% / 46% 58% 42% 54%; transform: translateZ(14px) scale(0.99); }
  57% { border-radius: 68% 32% 36% 64% / 45% 59% 41% 55%; transform: translateZ(15px) scale(0.985); }
  59% { border-radius: 71% 29% 32% 68% / 45% 60% 40% 55%; transform: translateZ(16px) scale(0.98); }
  61% { border-radius: 73% 27% 30% 70% / 46% 59% 41% 54%; transform: translateZ(17px) scale(0.975); }
  63% { border-radius: 71% 29% 33% 67% / 48% 58% 42% 52%; transform: translateZ(18px) scale(0.98); }
  65% { border-radius: 69% 31% 36% 64% / 50% 57% 43% 50%; transform: translateZ(19px) scale(0.985); }
  67% { border-radius: 67% 33% 39% 61% / 52% 56% 44% 48%; transform: translateZ(20px) scale(0.99); }
  69% { border-radius: 65% 35% 42% 58% / 54% 55% 45% 46%; transform: translateZ(21px) scale(0.995); }
  71% { border-radius: 63% 37% 45% 55% / 56% 54% 46% 44%; transform: translateZ(22px) scale(1); }
  73% { border-radius: 60% 40% 49% 51% / 58% 53% 47% 42%; transform: translateZ(22.5px) scale(1.003); }
  75% { border-radius: 57% 43% 53% 47% / 60% 52% 48% 40%; transform: translateZ(23px) scale(1.006); }
  77% { border-radius: 55% 45% 57% 43% / 59% 51.5% 48.5% 41%; transform: translateZ(22.5px) scale(1.005); }
  79% { border-radius: 53% 47% 61% 39% / 58% 51% 49% 42%; transform: translateZ(22px) scale(1.004); }
  81% { border-radius: 52% 48% 64% 36% / 57% 51% 49% 43%; transform: translateZ(21.5px) scale(1.003); }
  83% { border-radius: 51% 49% 67% 33% / 56% 51.5% 48.5% 44%; transform: translateZ(21px) scale(1.002); }
  85% { border-radius: 50.5% 49.5% 70% 30% / 55% 52% 48% 45%; transform: translateZ(20.5px) scale(1.001); }
  87% { border-radius: 50.3% 49.7% 65% 35% / 53% 51.5% 48.5% 47%; transform: translateZ(20.3px) scale(1.0005); }
  89% { border-radius: 50.2% 49.8% 60% 40% / 51.5% 51% 49% 48.5%; transform: translateZ(20.2px) scale(1.0003); }
  91% { border-radius: 50.1% 49.9% 55% 45% / 50.5% 50.5% 49.5% 49.5%; transform: translateZ(20.1px) scale(1.0001); }
  93%, 100% { /* 结束时恢复圆形状态 */
    border-radius: 50%; 
    transform: translateZ(20px) scale(1);
  }
}

/* 彩虹背景移动动画 */
@keyframes rainbow-bg {
  0% { background-position: 0% 0%; }
  25% { background-position: 25% 25%; }
  50% { background-position: 50% 50%; }
  75% { background-position: 75% 75%; }
  100% { background-position: 100% 100%; }
}

/* 旋转动画 - 更平滑的旋转 */
@keyframes rotate {
  0% { transform: translateZ(20px) rotate(0deg); }
  100% { transform: translateZ(20px) rotate(360deg); }
}
</style> 