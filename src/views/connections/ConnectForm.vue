<template>
  <div class="connect-form-container">
    <FormLayout :rows="formRows">
      <template #row-0>
        <FormItem>
          <BaseInput
            v-model="form.host"
            label="云服务器公网IP或域名"
            placeholder="请输入云服务器公网IP或域名"
          />
        </FormItem>
        <FormItem>
          <BaseInput
            v-model="form.port"
            label="云服务器端口"
            placeholder="22"
          />
        </FormItem>
      </template>
      
      <template #row-1>
        <FormItem>
          <BaseInput
            v-model="form.username"
            label="用户名"
            placeholder="请输入用户名"
          />
        </FormItem>
        <FormItem>
          <BaseInput
            v-model="form.description"
            label="备注 (选填)"
            placeholder="请输入备注"
          />
        </FormItem>
      </template>
      
      <template #row-2>
        <FormItem>
          <BaseRadioGroup
            v-model="form.authType"
            :options="authOptions"
            label="验证方式"
          />
        </FormItem>
      </template>
      
      <template #row-3>
        <FormItem v-if="form.authType === 'password'">
          <BaseInput
            v-model="form.password"
            type="password"
            label="密码 (选填)"
            placeholder="请输入密码"
          />
          <BaseCheckbox
            v-model="form.rememberPassword"
            label="记住密码"
            style="margin-top: 10px;"
          />
        </FormItem>
        <FormItem v-else>
          <FileInput
            v-model="form.keyFile"
            label="秘钥文件"
            placeholder="请选择秘钥文件"
            buttonText="选择密钥"
            accept=".pem,.ppk,.key"
          />
        </FormItem>
      </template>
    </FormLayout>
  </div>
</template>

<script>
import { defineComponent, reactive, watch } from 'vue'
import { BaseInput, BaseRadioGroup, BaseCheckbox, FileInput, FormLayout, FormItem } from '@/components/form'

export default defineComponent({
  name: 'ConnectForm',
  components: {
    BaseInput,
    BaseRadioGroup,
    BaseCheckbox,
    FileInput,
    FormLayout,
    FormItem
  },
  props: {
    initialData: {
      type: Object,
      default: () => ({})
    }
  },
  emits: ['update:form'],
  setup(props, { emit }) {
    const formRows = [
      { type: 'two-columns' }, // 云服务器IP和端口
      { type: 'two-columns' }, // 用户名和备注
      { type: 'single' },      // 验证方式
      { type: 'single' }       // 密码/秘钥
    ]

    const authOptions = [
      { label: '密码验证', value: 'password' },
      { label: '秘钥验证', value: 'key' }
    ]

    const form = reactive({
      host: props.initialData.host || '',
      port: props.initialData.port || 22,
      username: props.initialData.username || '',
      description: props.initialData.description || '',
      authType: props.initialData.authType || 'password',
      password: props.initialData.password || '',
      keyFile: props.initialData.keyFile || '',
      rememberPassword: props.initialData.rememberPassword || false
    })

    // 监听表单变化并通知父组件
    const emitFormChange = () => {
      emit('update:form', { ...form })
    }

    // 监听表单变化
    watch(() => ({ ...form }), emitFormChange, { deep: true })

    // 获取表单数据方法
    const getFormData = () => {
      return { ...form }
    }

    // 重置表单
    const resetForm = () => {
      form.host = ''
      form.port = 22
      form.username = ''
      form.description = ''
      form.authType = 'password'
      form.password = ''
      form.keyFile = ''
      form.rememberPassword = false
    }

    return {
      formRows,
      authOptions,
      form,
      getFormData,
      resetForm
    }
  }
})
</script>

<style scoped>
.connect-form-container {
  width: 100%;
}
</style> 