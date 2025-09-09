<template>
  <div
    v-if="isVisible"
    class="rocket-loader-container"
    :class="{ 'fade-out': !isVisible }"
  >
    <div
      class="rocket-body"
      :class="animationPhase"
    >
      <span>
        <span />
        <span />
        <span />
        <span />
      </span>
      <div class="base">
        <span />
      </div>
      <div class="face" />
    </div>
    <div class="longfazers">
      <span />
      <span />
      <span />
      <span />
    </div>
    <h1>{{ getLoadingText() }}</h1>
  </div>
</template>

<script>
export default {
  name: 'RocketLoader',
  props: {
    phase: {
      type: String,
      default: 'connecting', // connecting, connected, completing
      validator: value => ['connecting', 'connected', 'completing'].includes(value)
    }
  },
  emits: ['animation-complete'],
  data() {
    return {
      currentPhase: 'connecting',
      isVisible: true
    };
  },
  computed: {
    animationPhase() {
      return `phase-${this.currentPhase}`;
    }
  },
  watch: {
    phase: {
      handler(newPhase, oldPhase) {
        // 如果从completing回到connecting，重置状态
        if (oldPhase === 'completing' && newPhase === 'connecting') {
          // 直接重置状态
          this.currentPhase = 'connecting';
          this.isVisible = true;
        }
        // 处理阶段变化
        this.handlePhaseChange(newPhase);
      },
      immediate: true
    }
  },
  beforeUnmount() {
    // 组件销毁前清理状态
    this.isVisible = false;
    this.currentPhase = 'connecting';
  },
  methods: {
    handlePhaseChange(newPhase) {
      if (newPhase === 'completing') {
        // 开始完成阶段动画
        this.currentPhase = 'completing';
        // 0.5秒后隐藏整个加载器
        setTimeout(() => {
          this.isVisible = false;
          this.$emit('animation-complete');
        }, 500);
      } else {
        this.currentPhase = newPhase;
      }
    },
    getLoadingText() {
      switch (this.currentPhase) {
      case 'connecting':
        return 'connecting...';
      case 'connected':
        return 'connected!';
      case 'completing':
        return 'connected!';
      default:
        return 'loading...';
      }
    }
  }
};
</script>

<style scoped>
.rocket-loader-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: var(--color-bg-page); /* 使用主题背景色 */
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  transition: opacity 0.5s ease-out;
}

.rocket-loader-container.fade-out {
  opacity: 0;
}

h1 {
  position: absolute;
  font-family: 'Open Sans', sans-serif;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  left: 50%;
  top: 58%;
  margin-left: -20px;
  color: var(--color-text-primary); /* 使用主题文字颜色 */
}

.rocket-body {
  position: absolute;
  top: 50%;
  margin-top: -25px;
  animation: speeder 0.4s linear infinite;
  transition:
    left 2s ease-in-out,
    transform 2s ease-in-out;
}

/* 三个阶段的位置 */
.rocket-body.phase-connecting {
  left: -200px; /* 从左侧开始 */
  animation:
    move-to-center 0.5s ease-out forwards,
    speeder 0.4s linear infinite;
}

.rocket-body.phase-connected {
  left: 50%;
  margin-left: -50px; /* 居中 */
  animation:
    speeder 0.4s linear infinite,
    hover-center 2s ease-in-out infinite;
}

.rocket-body.phase-completing {
  left: 50%;
  margin-left: -50px;
  animation:
    move-to-right 0.5s ease-in forwards,
    speeder 0.4s linear infinite;
}

/* 移动动画 */
@keyframes move-to-center {
  0% {
    left: -200px;
    transform: translateY(0) scale(1);
  }
  100% {
    left: 50%;
    margin-left: -50px;
    transform: translateY(0) scale(1);
  }
}

@keyframes move-to-right {
  0% {
    left: 50%;
    margin-left: -50px;
    transform: translateY(0) scale(1);
  }
  100% {
    left: calc(100% + 200px);
    transform: translateY(-20px) scale(1.2);
  }
}

/* 中间悬停效果 */
@keyframes hover-center {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
}

.rocket-body > span {
  height: 5px;
  width: 35px;
  background: var(--color-text-primary); /* 使用主题文字颜色作为火箭颜色 */
  position: absolute;
  top: -19px;
  left: 60px;
  border-radius: 2px 10px 1px 0;
}

.base span {
  position: absolute;
  width: 0;
  height: 0;
  border-top: 6px solid transparent;
  border-right: 100px solid var(--color-text-primary); /* 使用主题文字颜色 */
  border-bottom: 6px solid transparent;
}

.base span::before {
  content: '';
  height: 22px;
  width: 22px;
  border-radius: 50%;
  background: var(--color-text-primary); /* 使用主题文字颜色 */
  position: absolute;
  right: -110px;
  top: -16px;
}

.base span::after {
  content: '';
  position: absolute;
  width: 0;
  height: 0;
  border-top: 0 solid transparent;
  border-right: 55px solid var(--color-text-primary); /* 使用主题文字颜色 */
  border-bottom: 16px solid transparent;
  top: -16px;
  right: -98px;
}

.face {
  position: absolute;
  height: 12px;
  width: 20px;
  background: var(--color-text-primary); /* 使用主题文字颜色 */
  border-radius: 20px 20px 0 0;
  transform: rotate(-40deg);
  right: -125px;
  top: -15px;
}

.face::after {
  content: '';
  height: 12px;
  width: 12px;
  background: var(--color-text-primary); /* 使用主题文字颜色 */
  right: 4px;
  top: 7px;
  position: absolute;
  transform: rotate(40deg);
  transform-origin: 50% 50%;
  border-radius: 0 0 0 2px;
}

.rocket-body > span > span {
  width: 30px;
  height: 1px;
  background: var(--color-text-primary); /* 使用主题文字颜色 */
  position: absolute;
}

.rocket-body > span > span:nth-child(1) {
  animation: fazer1 0.2s linear infinite;
}

.rocket-body > span > span:nth-child(2) {
  top: 3px;
  animation: fazer2 0.4s linear infinite;
}

.rocket-body > span > span:nth-child(3) {
  top: 1px;
  animation: fazer3 0.4s linear infinite;
  animation-delay: -1s;
}

.rocket-body > span > span:nth-child(4) {
  top: 4px;
  animation: fazer4 1s linear infinite;
  animation-delay: -1s;
}

@keyframes fazer1 {
  0% {
    left: 0;
  }
  100% {
    left: -80px;
    opacity: 0;
  }
}

@keyframes fazer2 {
  0% {
    left: 0;
  }
  100% {
    left: -100px;
    opacity: 0;
  }
}

@keyframes fazer3 {
  0% {
    left: 0;
  }
  100% {
    left: -50px;
    opacity: 0;
  }
}

@keyframes fazer4 {
  0% {
    left: 0;
  }
  100% {
    left: -150px;
    opacity: 0;
  }
}

@keyframes speeder {
  0% {
    transform: translate(2px, 1px) rotate(0deg);
  }
  10% {
    transform: translate(-1px, -3px) rotate(-1deg);
  }
  20% {
    transform: translate(-2px, 0px) rotate(1deg);
  }
  30% {
    transform: translate(1px, 2px) rotate(0deg);
  }
  40% {
    transform: translate(1px, -1px) rotate(1deg);
  }
  50% {
    transform: translate(-1px, 3px) rotate(-1deg);
  }
  60% {
    transform: translate(-1px, 1px) rotate(0deg);
  }
  70% {
    transform: translate(3px, 1px) rotate(-1deg);
  }
  80% {
    transform: translate(-2px, -1px) rotate(1deg);
  }
  90% {
    transform: translate(2px, 1px) rotate(0deg);
  }
  100% {
    transform: translate(1px, -2px) rotate(-1deg);
  }
}

.longfazers {
  position: absolute;
  width: 100%;
  height: 100%;
}

.longfazers span {
  position: absolute;
  height: 2px;
  width: 20%;
  background: var(--color-text-primary); /* 使用主题文字颜色 */
}

.longfazers span:nth-child(1) {
  top: 20%;
  animation: lf 0.6s linear infinite;
  animation-delay: -5s;
}

.longfazers span:nth-child(2) {
  top: 40%;
  animation: lf2 0.8s linear infinite;
  animation-delay: -1s;
}

.longfazers span:nth-child(3) {
  top: 60%;
  animation: lf3 0.6s linear infinite;
}

.longfazers span:nth-child(4) {
  top: 80%;
  animation: lf4 0.5s linear infinite;
  animation-delay: -3s;
}

@keyframes lf {
  0% {
    left: 200%;
  }
  100% {
    left: -200%;
    opacity: 0;
  }
}

@keyframes lf2 {
  0% {
    left: 200%;
  }
  100% {
    left: -200%;
    opacity: 0;
  }
}

@keyframes lf3 {
  0% {
    left: 200%;
  }
  100% {
    left: -100%;
    opacity: 0;
  }
}

@keyframes lf4 {
  0% {
    left: 200%;
  }
  100% {
    left: -100%;
    opacity: 0;
  }
}
</style>
