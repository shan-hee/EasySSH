/**
 * 表单验证和处理服务
 * 提供统一的表单验证、错误处理和交互增强
 */

import { EventEmitter } from './EventEmitter.js';
import notificationService from './notifications.js';

// 验证规则类型
export const ValidationType = {
  REQUIRED: 'required',
  EMAIL: 'email',
  NUMBER: 'number',
  INTEGER: 'integer',
  MIN_LENGTH: 'minLength',
  MAX_LENGTH: 'maxLength',
  PATTERN: 'pattern',
  MATCH: 'match',
  CUSTOM: 'custom',
  MIN: 'min',
  MAX: 'max',
  DATE: 'date',
  URL: 'url',
  CONFIRM: 'confirm'
};

// 内置验证规则
const validators = {
  // 必填验证
  [ValidationType.REQUIRED]: {
    validate: value => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      return true;
    },
    message: '该字段不能为空'
  },

  // 邮箱验证
  [ValidationType.EMAIL]: {
    validate: value => {
      if (!value) return true; // 空值由required验证
      const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      return pattern.test(value);
    },
    message: '请输入有效的电子邮箱地址'
  },

  // 数字验证
  [ValidationType.NUMBER]: {
    validate: value => {
      if (!value && value !== 0) return true;
      return !isNaN(Number(value));
    },
    message: '请输入有效的数字'
  },

  // 整数验证
  [ValidationType.INTEGER]: {
    validate: value => {
      if (!value && value !== 0) return true;
      return Number.isInteger(Number(value));
    },
    message: '请输入有效的整数'
  },

  // 最小长度验证
  [ValidationType.MIN_LENGTH]: {
    validate: (value, param) => {
      if (!value) return true;
      return String(value).length >= param;
    },
    message: (param) => `长度不能少于 ${param} 个字符`
  },

  // 最大长度验证
  [ValidationType.MAX_LENGTH]: {
    validate: (value, param) => {
      if (!value) return true;
      return String(value).length <= param;
    },
    message: (param) => `长度不能超过 ${param} 个字符`
  },

  // 模式验证(正则)
  [ValidationType.PATTERN]: {
    validate: (value, param) => {
      if (!value) return true;
      const pattern = typeof param === 'string' ? new RegExp(param) : param;
      return pattern.test(value);
    },
    message: '输入格式不正确'
  },

  // 匹配验证
  [ValidationType.MATCH]: {
    validate: (value, param, formData) => {
      if (!value) return true;
      return value === formData[param];
    },
    message: (param) => `输入必须与${param}字段匹配`
  },

  // 最小值验证
  [ValidationType.MIN]: {
    validate: (value, param) => {
      if (!value && value !== 0) return true;
      return Number(value) >= param;
    },
    message: (param) => `不能小于 ${param}`
  },

  // 最大值验证
  [ValidationType.MAX]: {
    validate: (value, param) => {
      if (!value && value !== 0) return true;
      return Number(value) <= param;
    },
    message: (param) => `不能大于 ${param}`
  },

  // 日期验证
  [ValidationType.DATE]: {
    validate: value => {
      if (!value) return true;
      const date = new Date(value);
      return !isNaN(date.getTime());
    },
    message: '请输入有效的日期'
  },

  // URL验证
  [ValidationType.URL]: {
    validate: value => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch (e) {
        return false;
      }
    },
    message: '请输入有效的URL'
  },

  // 确认验证
  [ValidationType.CONFIRM]: {
    validate: (value, param, formData) => {
      return value === formData[param];
    },
    message: (param) => `与${param}不匹配`
  }
};

/**
 * 字段验证规则
 */
class ValidationRule {
  /**
   * 构造函数
   * @param {string} type 验证类型
   * @param {Object} options 选项
   */
  constructor(type, options = {}) {
    this.type = type;
    this.param = options.param;
    this.message = options.message ||
      (validators[type] ?
        (typeof validators[type].message === 'function' ?
          validators[type].message(this.param) :
          validators[type].message) :
        '验证失败');
    this.when = options.when || (() => true);

    // 自定义验证函数
    if (type === ValidationType.CUSTOM) {
      if (!options.validate || typeof options.validate !== 'function') {
        throw new Error('自定义验证规则必须提供验证函数');
      }
      this.validate = options.validate;
    } else {
      this.validate = validators[type] ? validators[type].validate : () => true;
    }
  }

  /**
   * 执行验证
   * @param {any} value 字段值
   * @param {Object} formData 表单数据
   * @returns {boolean} 是否验证通过
   */
  isValid(value, formData = {}) {
    // 检查条件
    if (!this.when(value, formData)) {
      return true;
    }

    return this.validate(value, this.param, formData);
  }

  /**
   * 获取错误消息
   * @param {Object} fieldMeta 字段元数据
   * @returns {string} 错误消息
   */
  getErrorMessage(fieldMeta = {}) {
    if (typeof this.message === 'function') {
      return this.message(this.param, fieldMeta);
    }

    return this.message;
  }
}

/**
 * 表单字段
 */
class FormField {
  /**
   * 构造函数
   * @param {string} name 字段名称
   * @param {Object} options 选项
   */
  constructor(name, options = {}) {
    this.name = name;
    this.value = options.value !== undefined ? options.value : '';
    this.label = options.label || name;
    this.rules = [];
    this.errors = [];
    this.dirty = false;
    this.touched = false;
    this.focused = false;
    this.type = options.type || 'text';
    this.placeholder = options.placeholder || '';
    this.disabled = !!options.disabled;
    this.readonly = !!options.readonly;
    this.required = !!options.required;
    this.defaultValue = this.value;
    this.options = options.options || [];
    this.meta = options.meta || {};

    // 自动添加必填验证
    if (this.required) {
      this.addRule(ValidationType.REQUIRED);
    }

    // 添加其他规则
    if (options.rules && Array.isArray(options.rules)) {
      options.rules.forEach(rule => {
        if (typeof rule === 'string') {
          this.addRule(rule);
        } else if (typeof rule === 'object') {
          this.addRule(rule.type, rule);
        }
      });
    }
  }

  /**
   * 添加验证规则
   * @param {string} type 验证类型
   * @param {Object} options 规则选项
   * @returns {FormField} 当前字段实例
   */
  addRule(type, options = {}) {
    const rule = new ValidationRule(type, options);
    this.rules.push(rule);
    return this;
  }

  /**
   * 设置字段值
   * @param {any} value 字段值
   * @returns {FormField} 当前字段实例
   */
  setValue(value) {
    this.value = value;
    this.dirty = this.value !== this.defaultValue;
    return this;
  }

  /**
   * 设置触摸状态
   * @param {boolean} touched 是否已触摸
   * @returns {FormField} 当前字段实例
   */
  setTouched(touched = true) {
    this.touched = touched;
    return this;
  }

  /**
   * 设置焦点状态
   * @param {boolean} focused 是否已获取焦点
   * @returns {FormField} 当前字段实例
   */
  setFocused(focused = true) {
    this.focused = focused;
    return this;
  }

  /**
   * 重置字段
   * @returns {FormField} 当前字段实例
   */
  reset() {
    this.value = this.defaultValue;
    this.errors = [];
    this.dirty = false;
    this.touched = false;
    this.focused = false;
    return this;
  }

  /**
   * 验证字段
   * @param {Object} formData 表单数据
   * @returns {boolean} 是否验证通过
   */
  validate(formData = {}) {
    this.errors = [];

    // 如果字段禁用，不进行验证
    if (this.disabled) {
      return true;
    }

    // 遍历验证规则
    for (const rule of this.rules) {
      if (!rule.isValid(this.value, formData)) {
        this.errors.push(rule.getErrorMessage({
          label: this.label,
          name: this.name,
          ...this.meta
        }));
      }
    }

    return this.errors.length === 0;
  }

  /**
   * 获取字段状态
   * @returns {Object} 字段状态
   */
  getState() {
    return {
      value: this.value,
      errors: [...this.errors],
      dirty: this.dirty,
      touched: this.touched,
      focused: this.focused,
      valid: this.errors.length === 0,
      disabled: this.disabled,
      readonly: this.readonly,
      required: this.required
    };
  }
}

/**
 * 表单服务类
 */
export class FormService extends EventEmitter {
  /**
   * 构造函数
   */
  constructor() {
    super();

    // 表单注册表 { formId: { fields, options } }
    this.forms = new Map();

    // 添加自定义验证器
    this.customValidators = new Map();
  }

  /**
   * 注册自定义验证器
   * @param {string} name 验证器名称
   * @param {Function} validateFn 验证函数
   * @param {string|Function} message 错误消息
   * @returns {FormService} 表单服务实例
   */
  registerValidator(name, validateFn, message = '验证失败') {
    if (typeof validateFn !== 'function') {
      throw new Error('验证器必须是一个函数');
    }

    validators[name] = {
      validate: validateFn,
      message
    };

    return this;
  }

  /**
   * 创建表单
   * @param {string} formId 表单ID
   * @param {Object} config 表单配置
   * @returns {Object} 表单控制器
   */
  createForm(formId, config = {}) {
    if (this.forms.has(formId)) {
      throw new Error(`表单 ${formId} 已存在`);
    }

    const fields = {};
    const options = {
      validateOnChange: config.validateOnChange !== false,
      validateOnBlur: config.validateOnBlur !== false,
      validateOnSubmit: config.validateOnSubmit !== false,
      showErrorsOnSubmit: config.showErrorsOnSubmit !== false,
      focusOnError: config.focusOnError !== false,
      resetOnSubmit: config.resetOnSubmit || false,
      scrollToErrors: config.scrollToErrors !== false,
      onSubmit: config.onSubmit || null,
      onReset: config.onReset || null,
      onChange: config.onChange || null
    };

    // 创建字段
    if (config.fields) {
      Object.entries(config.fields).forEach(([name, fieldConfig]) => {
        fields[name] = new FormField(name, fieldConfig);
      });
    }

    // 保存表单状态
    this.forms.set(formId, { fields, options });

    // 创建表单控制器
    const formController = this._createFormController(formId);

    // 触发表单创建事件
    this.emit('form:created', formId, formController);

    return formController;
  }

  /**
   * 获取表单控制器
   * @param {string} formId 表单ID
   * @returns {Object} 表单控制器
   */
  getForm(formId) {
    if (!this.forms.has(formId)) {
      throw new Error(`表单 ${formId} 不存在`);
    }

    return this._createFormController(formId);
  }

  /**
   * 创建表单控制器
   * @param {string} formId 表单ID
   * @returns {Object} 表单控制器
   * @private
   */
  _createFormController(formId) {
    const { fields, options } = this.forms.get(formId);
    const self = this;

    return {
      /**
       * 获取表单ID
       */
      get id() {
        return formId;
      },

      /**
       * 获取表单数据
       */
      get values() {
        const values = {};
        Object.entries(fields).forEach(([name, field]) => {
          values[name] = field.value;
        });
        return values;
      },

      /**
       * 获取表单字段状态
       */
      get fields() {
        const result = {};
        Object.entries(fields).forEach(([name, field]) => {
          result[name] = field.getState();
        });
        return result;
      },

      /**
       * 获取表单整体验证状态
       */
      get isValid() {
        return Object.values(fields).every(field => field.errors.length === 0);
      },

      /**
       * 获取表单是否有修改
       */
      get isDirty() {
        return Object.values(fields).some(field => field.dirty);
      },

      /**
       * 获取所有字段错误
       */
      get errors() {
        const allErrors = {};
        Object.entries(fields).forEach(([name, field]) => {
          if (field.errors.length > 0) {
            allErrors[name] = [...field.errors];
          }
        });
        return allErrors;
      },

      /**
       * 设置字段值
       * @param {string} name 字段名
       * @param {any} value 字段值
       */
      setValue(name, value) {
        if (!fields[name]) {
          throw new Error(`字段 ${name} 不存在`);
        }

        fields[name].setValue(value);

        // 如果需要，进行验证
        if (options.validateOnChange) {
          this.validateField(name);
        }

        // 触发变更事件
        self.emit('field:change', formId, name, value, fields[name].getState());

        if (options.onChange && typeof options.onChange === 'function') {
          options.onChange(name, value, this.values);
        }
      },

      /**
       * 批量设置表单值
       * @param {Object} values 字段值对象
       */
      setValues(values) {
        if (!values || typeof values !== 'object') {
          return;
        }

        Object.entries(values).forEach(([name, value]) => {
          if (fields[name]) {
            fields[name].setValue(value);
          }
        });

        // 如果需要，进行整体验证
        if (options.validateOnChange) {
          this.validate();
        }

        // 触发表单变更事件
        self.emit('form:change', formId, this.values);

        if (options.onChange && typeof options.onChange === 'function') {
          options.onChange(null, null, this.values);
        }
      },

      /**
       * 设置字段触摸状态
       * @param {string} name 字段名
       * @param {boolean} touched 是否触摸
       */
      setTouched(name, touched = true) {
        if (!fields[name]) {
          throw new Error(`字段 ${name} 不存在`);
        }

        fields[name].setTouched(touched);

        // 如果需要，进行验证
        if (touched && options.validateOnBlur) {
          this.validateField(name);
        }

        // 触发触摸事件
        self.emit('field:blur', formId, name, fields[name].getState());
      },

      /**
       * 设置字段焦点状态
       * @param {string} name 字段名
       * @param {boolean} focused 是否获得焦点
       */
      setFocused(name, focused = true) {
        if (!fields[name]) {
          throw new Error(`字段 ${name} 不存在`);
        }

        fields[name].setFocused(focused);

        // 触发焦点事件
        self.emit('field:focus', formId, name, fields[name].getState());
      },

      /**
       * 验证单个字段
       * @param {string} name 字段名
       * @returns {boolean} 是否验证通过
       */
      validateField(name) {
        if (!fields[name]) {
          throw new Error(`字段 ${name} 不存在`);
        }

        const isValid = fields[name].validate(this.values);

        // 触发字段验证事件
        self.emit('field:validate', formId, name, isValid, fields[name].errors);

        return isValid;
      },

      /**
       * 验证整个表单
       * @returns {boolean} 是否验证通过
       */
      validate() {
        let isValid = true;

        // 验证所有字段
        Object.entries(fields).forEach(([name, field]) => {
          const fieldValid = field.validate(this.values);
          isValid = isValid && fieldValid;
        });

        // 触发表单验证事件
        self.emit('form:validate', formId, isValid, this.errors);

        return isValid;
      },

      /**
       * 获取字段状态
       * @param {string} name 字段名
       * @returns {Object} 字段状态
       */
      getFieldState(name) {
        if (!fields[name]) {
          throw new Error(`字段 ${name} 不存在`);
        }

        return fields[name].getState();
      },

      /**
       * 重置表单
       */
      reset() {
        Object.values(fields).forEach(field => field.reset());

        // 触发表单重置事件
        self.emit('form:reset', formId);

        if (options.onReset && typeof options.onReset === 'function') {
          options.onReset(this.values);
        }
      },

      /**
       * 添加字段
       * @param {string} name 字段名
       * @param {Object} config 字段配置
       */
      addField(name, config = {}) {
        if (fields[name]) {
          throw new Error(`字段 ${name} 已存在`);
        }

        fields[name] = new FormField(name, config);

        // 触发字段添加事件
        self.emit('field:add', formId, name, fields[name].getState());
      },

      /**
       * 移除字段
       * @param {string} name 字段名
       */
      removeField(name) {
        if (!fields[name]) {
          return;
        }

        delete fields[name];

        // 触发字段移除事件
        self.emit('field:remove', formId, name);
      },

      /**
       * 提交表单
       * @returns {boolean} 是否验证通过并提交
       */
      submit() {
        // 如果需要，进行整体验证
        let isValid = true;

        if (options.validateOnSubmit) {
          isValid = this.validate();

          // 处理验证失败
          if (!isValid && options.showErrorsOnSubmit) {
            // 获取第一个错误字段
            const firstErrorField = Object.entries(fields)
              .find(([_, field]) => field.errors.length > 0);

            if (firstErrorField) {
              const [fieldName, field] = firstErrorField;

              // 显示错误通知
              notificationService.error(`表单验证失败: ${field.errors[0]}`);

              // 焦点到第一个错误字段
              if (options.focusOnError) {
                // 发出聚焦错误字段事件，由视图层处理
                self.emit('form:focusError', formId, fieldName);
              }

              // 滚动到错误字段
              if (options.scrollToErrors) {
                // 发出滚动到错误字段事件，由视图层处理
                self.emit('form:scrollToError', formId, fieldName);
              }
            }
          }
        }

        // 触发表单提交事件
        self.emit('form:submit', formId, isValid, this.values);

        // 调用提交回调
        if (isValid && options.onSubmit && typeof options.onSubmit === 'function') {
          options.onSubmit(this.values);
        }

        // 如果成功且需要，重置表单
        if (isValid && options.resetOnSubmit) {
          this.reset();
        }

        return isValid;
      },

      /**
       * 设置表单选项
       * @param {Object} newOptions 新选项
       */
      setOptions(newOptions) {
        Object.assign(options, newOptions);
      }
    };
  }

  /**
   * 删除表单
   * @param {string} formId 表单ID
   * @returns {boolean} 是否成功删除
   */
  removeForm(formId) {
    if (!this.forms.has(formId)) {
      return false;
    }

    this.forms.delete(formId);

    // 触发表单删除事件
    this.emit('form:removed', formId);

    return true;
  }

  /**
   * 单例实例
   */
  static instance = null;

  /**
   * 获取服务实例
   * @returns {FormService} 表单服务实例
   */
  static getInstance() {
    if (!FormService.instance) {
      FormService.instance = new FormService();
    }
    return FormService.instance;
  }
}

// 导出默认实例
export default FormService.getInstance();
