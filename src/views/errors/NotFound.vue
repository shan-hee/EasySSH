<template>
  <div class="not-found-container">
    <div class="not-found-content">
      <el-result
        icon="error"
        title="404"
        sub-title="抱歉，您访问的页面不存在"
      >
        <template #extra>
          <el-button
            type="primary"
            @click="goHome"
          >
            返回首页
          </el-button>
          <el-button @click="goBack">
            返回上一页
          </el-button>
        </template>
      </el-result>
    </div>
  </div>
</template>

<script>
import { useRouter } from 'vue-router';

export default {
  name: 'NotFound',
  setup() {
    const router = useRouter();

    // 返回首页
    const goHome = () => {
      router.push('/');
    };

    // 返回上一页
    const goBack = () => {
      router.back();
    };

    return {
      goHome,
      goBack
    };
  }
};
</script>

<style scoped>
.not-found-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: #f5f7fa;
}

.not-found-content {
  background-color: #fff;
  border-radius: 4px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 600px;
  padding: 40px;
}
</style>
