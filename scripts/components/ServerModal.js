/**
 * 服务器模态框组件
 * 用于创建和编辑服务器连接配置
 */

export default {
  name: 'ServerModal',
  
  props: {
    // 是否显示模态框
    visible: {
      type: Boolean,
      default: false
    },
    // 编辑模式：新建或编辑
    mode: {
      type: String,
      default: 'create',
      validator: (value) => ['create', 'edit'].includes(value)
    },
    // 被编辑的连接（编辑模式）
    connection: {
      type: Object,
      default: null
    }
  },
  
  data() {
    return {
      // 表单数据
      form: {
        name: '',
        host: '',
        port: 22,
        username: '',
        password: '',
        privateKey: '',
        usePrivateKey: false,
        favorite: false,
        description: '',
        group: ''
      },
      // 连接组列表
      groups: ['默认组', '测试服务器', '生产环境', '开发环境'],
      // 表单验证状态
      validation: {
        name: true,
        host: true,
        username: true
      }
    };
  },
  
  template: `
    <div :class="['modal', {'modal--active': visible}]" id="createServerModal" @click.self="closeModal">
      <div class="modal__content">
        <div class="modal__header">
          <h3 class="modal__title">{{ isEditMode ? '编辑服务器连接' : '新建服务器连接' }}</h3>
          <button class="modal__close" id="closeServerModal" @click="closeModal">&times;</button>
        </div>
        
        <div class="modal__body">
          <form id="serverForm" @submit.prevent="handleSubmit">
            <div class="form__group">
              <label class="form__label" for="serverName">服务器名称</label>
              <input 
                class="form__control" 
                id="serverName" 
                type="text" 
                v-model="form.name" 
                :class="{'form__control--error': !validation.name}"
                required
              >
              <div v-if="!validation.name" class="form__error">请输入服务器名称</div>
            </div>
            
            <div class="form__row">
              <div class="form__group form__group--flex-1">
                <label class="form__label" for="serverHost">主机地址</label>
                <input 
                  class="form__control" 
                  id="serverHost" 
                  type="text" 
                  v-model="form.host" 
                  :class="{'form__control--error': !validation.host}"
                  required
                >
                <div v-if="!validation.host" class="form__error">请输入有效的主机地址</div>
              </div>
              
              <div class="form__group form__group--small">
                <label class="form__label" for="serverPort">端口</label>
                <input 
                  class="form__control" 
                  id="serverPort" 
                  type="number" 
                  v-model.number="form.port" 
                  min="1" 
                  max="65535"
                >
              </div>
            </div>
            
            <div class="form__group">
              <label class="form__label" for="serverUser">用户名</label>
              <input 
                class="form__control" 
                id="serverUser" 
                type="text" 
                v-model="form.username"
                :class="{'form__control--error': !validation.username}"
                required
              >
              <div v-if="!validation.username" class="form__error">请输入用户名</div>
            </div>
            
            <div class="form__tabs">
              <div 
                :class="['form__tab', {'form__tab--active': !form.usePrivateKey}]" 
                @click="form.usePrivateKey = false"
              >
                密码认证
              </div>
              <div 
                :class="['form__tab', {'form__tab--active': form.usePrivateKey}]" 
                @click="form.usePrivateKey = true"
              >
                密钥认证
              </div>
            </div>
            
            <div v-if="!form.usePrivateKey" class="form__group">
              <label class="form__label" for="serverPassword">密码</label>
              <input 
                class="form__control" 
                id="serverPassword" 
                type="password" 
                v-model="form.password"
              >
            </div>
            
            <div v-if="form.usePrivateKey" class="form__group">
              <label class="form__label" for="serverPrivateKey">私钥文件</label>
              <div class="form__file-select">
                <input 
                  class="form__control form__control--file" 
                  id="serverPrivateKey" 
                  type="file"
                  @change="handlePrivateKeyFileSelect"
                >
                <button class="form__file-button" type="button">选择文件</button>
                <span class="form__file-name">{{ privateKeyFileName }}</span>
              </div>
            </div>
            
            <div class="form__group">
              <label class="form__label" for="serverGroup">分组</label>
              <select class="form__control" id="serverGroup" v-model="form.group">
                <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
                <option value="__new">创建新分组...</option>
              </select>
            </div>
            
            <div v-if="form.group === '__new'" class="form__group">
              <label class="form__label" for="newGroupName">新分组名称</label>
              <input class="form__control" id="newGroupName" type="text" v-model="newGroupName">
            </div>
            
            <div class="form__group">
              <label class="form__label" for="serverDescription">描述</label>
              <textarea 
                class="form__control form__control--textarea" 
                id="serverDescription" 
                v-model="form.description"
              ></textarea>
            </div>
            
            <div class="form__group form__group--checkbox">
              <input 
                class="form__checkbox" 
                id="serverFavorite" 
                type="checkbox" 
                v-model="form.favorite"
              >
              <label class="form__checkbox-label" for="serverFavorite">
                <i class="fas fa-star"></i> 添加到收藏夹
              </label>
            </div>
          </form>
        </div>
        
        <div class="modal__footer">
          <button class="btn btn--secondary" id="cancelServerBtn" @click="closeModal">取消</button>
          <button class="btn btn--primary" id="submitServerBtn" @click="handleSubmit">
            {{ isEditMode ? '保存修改' : '创建连接' }}
          </button>
        </div>
      </div>
    </div>
  `,
  
  computed: {
    /**
     * 是否为编辑模式
     */
    isEditMode() {
      return this.mode === 'edit';
    },
    
    /**
     * 显示的私钥文件名
     */
    privateKeyFileName() {
      if (!this.form.privateKey) return '未选择文件';
      
      const parts = this.form.privateKey.split('\\');
      return parts[parts.length - 1];
    },
    
    /**
     * 新分组名称
     */
    newGroupName: {
      get() {
        return this._newGroupName || '';
      },
      set(value) {
        this._newGroupName = value;
      }
    }
  },
  
  watch: {
    /**
     * 监听visible属性变化，当显示模态框时初始化表单
     */
    visible(value) {
      if (value && this.isEditMode && this.connection) {
        this.initFormForEdit();
      } else if (value) {
        this.resetForm();
      }
    }
  },
  
  methods: {
    /**
     * 初始化编辑表单
     */
    initFormForEdit() {
      // 填充表单
      this.form.name = this.connection.name || '';
      this.form.host = this.connection.host || '';
      this.form.port = this.connection.port || 22;
      this.form.username = this.connection.username || '';
      this.form.password = this.connection.password || '';
      this.form.usePrivateKey = !!this.connection.privateKey;
      this.form.privateKey = this.connection.privateKey || '';
      this.form.favorite = this.connection.favorite || false;
      this.form.description = this.connection.description || '';
      this.form.group = this.connection.group || '默认组';
    },
    
    /**
     * 重置表单
     */
    resetForm() {
      this.form.name = '';
      this.form.host = '';
      this.form.port = 22;
      this.form.username = '';
      this.form.password = '';
      this.form.privateKey = '';
      this.form.usePrivateKey = false;
      this.form.favorite = false;
      this.form.description = '';
      this.form.group = '默认组';
      
      this.validation = {
        name: true,
        host: true,
        username: true
      };
      
      this._newGroupName = '';
    },
    
    /**
     * 处理私钥文件选择
     * @param {Event} event 文件选择事件
     */
    handlePrivateKeyFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        // 在实际应用中，这里需要读取文件内容并保存
        this.form.privateKey = file.name;
      }
    },
    
    /**
     * 验证表单
     * @returns {boolean} 表单是否有效
     */
    validateForm() {
      this.validation.name = !!this.form.name.trim();
      this.validation.host = !!this.form.host.trim();
      this.validation.username = !!this.form.username.trim();
      
      return this.validation.name && this.validation.host && this.validation.username;
    },
    
    /**
     * 处理表单提交
     */
    handleSubmit() {
      if (!this.validateForm()) {
        return;
      }
      
      // 处理新分组
      if (this.form.group === '__new' && this.newGroupName) {
        this.form.group = this.newGroupName;
        this.groups.push(this.newGroupName);
      }
      
      // 创建连接对象
      const connectionData = {
        id: this.isEditMode && this.connection ? this.connection.id : Date.now().toString(),
        name: this.form.name,
        host: this.form.host,
        port: this.form.port,
        username: this.form.username,
        password: this.form.usePrivateKey ? '' : this.form.password,
        privateKey: this.form.usePrivateKey ? this.form.privateKey : '',
        favorite: this.form.favorite,
        description: this.form.description,
        group: this.form.group,
        lastConnect: this.isEditMode && this.connection ? this.connection.lastConnect : '从未连接'
      };
      
      // 发送事件
      if (this.isEditMode) {
        this.$emit('update', connectionData);
      } else {
        this.$emit('create', connectionData);
      }
      
      // 关闭模态框
      this.closeModal();
    },
    
    /**
     * 关闭模态框
     */
    closeModal() {
      this.$emit('update:visible', false);
    }
  }
};