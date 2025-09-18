<template>
  <div class="sftp-editor-container" :class="{ fullscreen: isFullscreen }">
    <div class="sftp-editor-header">
      <div class="sftp-editor-path">
        <span>{{ fileName }}</span>
        <span v-if="isDirty" class="sftp-editor-status">*</span>
      </div>
      <div class="sftp-editor-controls">
        <button class="sftp-editor-btn" :disabled="!isDirty || isSaving" @click="save">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z"
            />
          </svg>
          保存
        </button>
        <button class="sftp-editor-btn" @click="toggleFullscreen">
          <svg
            v-if="!isFullscreen"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
          >
            <path
              fill="currentColor"
              d="M5,5H10V7H7V10H5V5M19,5V10H17V7H14V5H19M5,19V14H7V17H10V19H5M19,19H14V17H17V14H19V19Z"
            />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M14,14H19V16H16V19H14V14M5,14H10V19H8V16H5V14M8,5H10V10H5V8H8V5M19,8V10H14V5H16V8H19Z"
            />
          </svg>
        </button>
        <button class="sftp-editor-btn close" @click="close">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"
            />
          </svg>
        </button>
      </div>
    </div>
    <div class="sftp-editor-body">
      <div ref="editorContainer" class="editor-container" />
    </div>
    <div class="sftp-editor-footer">
      <div class="sftp-editor-status-bar">
        <span>{{ getFileType() }}</span>
        <span class="tabular-nums">{{ cursor.line }}:{{ cursor.ch }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, onMounted, watch, nextTick, onBeforeUnmount } from 'vue';
import { ElMessageBox, ElMessage, ElLoading } from 'element-plus';
import { sftpService } from '@/services/ssh/index';
import settingsService from '@/services/settings';
import log from '@/services/log';

// CodeMirror 动态按需加载以减小首屏包体积
let EditorState,
  Compartment,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  searchKeymap,
  foldGutter,
  bracketMatching,
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  tags;

const ensureCodeMirror = async () => {
  if (EditorState) return; // 已加载
  const [stateMod, viewMod, cmdMod, searchMod, langCoreMod, lezerMod] = await Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/search'),
    import('@codemirror/language'),
    import('@lezer/highlight')
  ]);

  EditorState = stateMod.EditorState;
  Compartment = stateMod.Compartment;

  EditorView = viewMod.EditorView;
  keymap = viewMod.keymap;
  lineNumbers = viewMod.lineNumbers;
  highlightActiveLine = viewMod.highlightActiveLine;

  defaultKeymap = cmdMod.defaultKeymap;
  history = cmdMod.history;
  historyKeymap = cmdMod.historyKeymap;
  indentWithTab = cmdMod.indentWithTab;

  searchKeymap = searchMod.searchKeymap;

  foldGutter = langCoreMod.foldGutter;
  bracketMatching = langCoreMod.bracketMatching;
  syntaxHighlighting = langCoreMod.syntaxHighlighting;
  HighlightStyle = langCoreMod.HighlightStyle;
  indentOnInput = langCoreMod.indentOnInput;
  StreamLanguage = langCoreMod.StreamLanguage;

  tags = lezerMod.tags;
};

export default defineComponent({
  name: 'SftpEditor',
  props: {
    sessionId: {
      type: String,
      required: true
    },
    filePath: {
      type: String,
      required: true
    },
    content: {
      type: String,
      default: ''
    }
  },
  emits: ['close', 'save'],
  setup(props, { emit }) {
    const editorContainer = ref(null);
    const editorView = ref(null);
    const originalContent = ref(props.content);
    const isDirty = ref(false);
    const isSaving = ref(false);
    const isFullscreen = ref(true);
    const fileName = ref(props.filePath.split('/').pop());
    const cursor = ref({ line: 1, ch: 0 });
    const isComponentMounted = ref(false);

    // 从设置中获取编辑器主题相关配置
    const getThemeSettings = () => {
      const terminalOptions = settingsService.getTerminalOptions();
      // 从终端选项中获取主题配置
      const theme = terminalOptions.theme || {};

      // 获取UI主题名称
      const uiSettings = settingsService.getUISettings();
      const themeName = uiSettings.theme || 'dark';

      // 定义主题默认值，避免循环依赖CSS变量
      const defaultTheme =
        themeName === 'dark'
          ? {
              background: '#1e1e1e',
              foreground: '#ffffff',
              cursor: '#ffffff',
              selection: '#264f78',
              comment: 'rgba(255, 255, 255, 0.65)',
              keyword: '#c678dd',
              string: '#98c379',
              function: '#61afef',
              variable: '#e06c75',
              number: '#d19a66',
              operator: '#56b6c2',
              className: '#e5c07b'
            }
          : {
              background: '#ffffff',
              foreground: '#303133',
              cursor: '#303133',
              selection: '#e6f7ff',
              comment: '#909399',
              keyword: '#d73a49',
              string: '#22863a',
              function: '#6f42c1',
              variable: '#e36209',
              number: '#005cc5',
              operator: '#d73a49',
              className: '#6f42c1'
            };

      return {
        background: theme.background || defaultTheme.background,
        foreground: theme.foreground || defaultTheme.foreground,
        cursor: theme.cursor || defaultTheme.cursor,
        selection: theme.selectionBackground || defaultTheme.selection,
        comment: theme.brightBlack || defaultTheme.comment,
        keyword: theme.magenta || defaultTheme.keyword,
        string: theme.green || defaultTheme.string,
        function: theme.blue || defaultTheme.function,
        variable: theme.red || defaultTheme.variable,
        number: theme.yellow || defaultTheme.number,
        operator: theme.cyan || defaultTheme.operator,
        className: theme.brightYellow || defaultTheme.className,
        themeName
      };
    };

    // 获取字体设置
    const getFontSettings = () => {
      const termSettings = settingsService.getTerminalSettings();
      return {
        fontSize: termSettings.fontSize || 14,
        // 使用主题等宽字体变量作为默认
        fontFamily: termSettings.fontFamily || "var(--font-family-mono)"
      };
    };

    // 主题和字体设置
    const themeSettings = ref(getThemeSettings());
    const fontSettings = ref(getFontSettings());

    // 获取文件类型显示名称
    const getFileType = () => {
      const fileExt = fileName.value.split('.').pop().toLowerCase();
      const fileTypeMap = {
        js: 'JavaScript',
        jsx: 'JavaScript (React)',
        ts: 'TypeScript',
        tsx: 'TypeScript (React)',
        html: 'HTML',
        css: 'CSS',
        scss: 'SCSS',
        sass: 'SASS',
        less: 'LESS',
        py: 'Python',
        sh: 'Shell',
        bash: 'Bash',
        php: 'PHP',
        rb: 'Ruby',
        go: 'Go',
        java: 'Java',
        c: 'C',
        cpp: 'C++',
        h: 'C Header',
        hpp: 'C++ Header',
        json: 'JSON',
        yaml: 'YAML',
        yml: 'YAML',
        xml: 'XML',
        md: 'Markdown',
        conf: 'Config',
        ini: 'INI',
        dockerfile: 'Dockerfile',
        nginx: 'Nginx',
        txt: 'Plain Text'
      };

      return fileTypeMap[fileExt] || 'Plain Text';
    };

    // 获取文件对应的语言模式（动态加载）
    const getLanguageSupport = async () => {
      const ext = (fileName.value.split('.').pop() || '').toLowerCase();
      try {
        switch (ext) {
          case 'js': {
            const mod = await import('@codemirror/lang-javascript');
            return mod.javascript();
          }
          case 'jsx': {
            const mod = await import('@codemirror/lang-javascript');
            return mod.javascript({ jsx: true });
          }
          case 'ts': {
            const mod = await import('@codemirror/lang-javascript');
            return mod.javascript({ typescript: true });
          }
          case 'tsx': {
            const mod = await import('@codemirror/lang-javascript');
            return mod.javascript({ jsx: true, typescript: true });
          }
          case 'json': {
            const mod = await import('@codemirror/lang-json');
            return mod.json();
          }
          case 'yml':
          case 'yaml': {
            try {
              const mod = await import('@codemirror/lang-yaml');
              return mod.yaml();
            } catch (_) {
              const { yaml } = await import('@codemirror/legacy-modes/mode/yaml');
              return StreamLanguage.define(yaml);
            }
          }
          case 'xml': {
            const mod = await import('@codemirror/lang-xml');
            return mod.xml();
          }
          case 'md':
          case 'markdown': {
            const mod = await import('@codemirror/lang-markdown');
            return mod.markdown();
          }
          case 'html': {
            const mod = await import('@codemirror/lang-html');
            return mod.html();
          }
          case 'sh':
          case 'bash':
          case 'zsh':
          case 'shell': {
            const { shell } = await import('@codemirror/legacy-modes/mode/shell');
            return StreamLanguage.define(shell);
          }
          case 'css':
          case 'scss':
          case 'less': {
            const mod = await import('@codemirror/lang-css');
            return mod.css();
          }
          case 'toml': {
            try {
              const { toml } = await import('@codemirror/legacy-modes/mode/toml');
              return StreamLanguage.define(toml);
            } catch (_) {
              const { yaml } = await import('@codemirror/legacy-modes/mode/yaml');
              return StreamLanguage.define(yaml);
            }
          }
          case 'ini':
          case 'properties':
          case 'conf': {
            const { properties } = await import('@codemirror/legacy-modes/mode/properties');
            return StreamLanguage.define(properties);
          }
          case 'dockerfile': {
            try {
              const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile');
              return StreamLanguage.define(dockerFile);
            } catch (_) {
              const { properties } = await import('@codemirror/legacy-modes/mode/properties');
              return StreamLanguage.define(properties);
            }
          }
          case 'nginx': {
            try {
              const { nginx } = await import('@codemirror/legacy-modes/mode/nginx');
              return StreamLanguage.define(nginx);
            } catch (_) {
              const { properties } = await import('@codemirror/legacy-modes/mode/properties');
              return StreamLanguage.define(properties);
            }
          }
          case 'py':
          case 'python': {
            const mod = await import('@codemirror/lang-python');
            return mod.python();
          }
          case 'c':
          case 'h':
          case 'cpp':
          case 'hpp': {
            const mod = await import('@codemirror/lang-cpp');
            return mod.cpp();
          }
          default: {
            const mod = await import('@codemirror/lang-javascript');
            return mod.javascript();
          }
        }
      } catch (e) {
        const mod = await import('@codemirror/lang-javascript');
        return mod.javascript();
      }
    };

    // 自定义语法高亮样式
    const createHighlightStyle = () => {
      const theme = themeSettings.value;

      return HighlightStyle.define([
        { tag: tags.keyword, color: theme.keyword },
        { tag: tags.comment, color: theme.comment, fontStyle: 'italic' },
        { tag: tags.definition, color: theme.function },
        { tag: tags.variableName, color: theme.variable },
        { tag: tags.string, color: theme.string },
        { tag: tags.number, color: theme.number },
        { tag: tags.operator, color: theme.operator },
        { tag: tags.punctuation, color: theme.foreground },
        { tag: tags.propertyName, color: theme.variable },
        { tag: tags.function(tags.variableName), color: theme.function },
        { tag: tags.className, color: theme.className }
      ]);
    };

    // 创建自定义主题
    const createCustomTheme = () => {
      const theme = themeSettings.value;

      // 同步更新CSS变量，确保全屏模式和窗口模式主题一致
      updateCSSVariables(theme);

      // 获取 SFTP 面板的背景色，保持一致性
      const root = document.documentElement;
      const sftpBg =
        getComputedStyle(root).getPropertyValue('--sftp-panel-bg').trim() || theme.background;

      return EditorView.theme(
        {
          '&': {
            backgroundColor: sftpBg,
            color: theme.foreground,
            fontSize: `${fontSize}px`,
            fontFamily
          },
          '.cm-content': {
            padding: '4px 0',
            caretColor: theme.cursor,
            fontFamily,
            color: theme.foreground
          },
          '.cm-focused': {
            outline: 'none'
          },
          '.cm-editor': {
            fontSize: `${fontSize}px`,
            fontFamily
          },
          '.cm-scroller': {
            fontFamily,
            lineHeight: '1.5'
          },
          '.cm-gutters': {
            backgroundColor: sftpBg,
            color: theme.comment,
            border: 'none',
            fontFamily
          },
          '.cm-gutterElement': {
            padding: '0 8px'
          },
          '.cm-lineNumbers .cm-gutterElement': {
            color: theme.comment
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'rgba(255, 255, 255, 0.05)'
          },
          '.cm-activeLine': {
            backgroundColor: 'rgba(255, 255, 255, 0.02)'
          },
          '.cm-selectionBackground': {
            backgroundColor: theme.selection
          },
          '.cm-searchMatch': {
            backgroundColor: theme.selection,
            outline: `1px solid ${theme.cursor}`
          },
          '.cm-searchMatch.cm-searchMatch-selected': {
            backgroundColor: theme.cursor
          }
        },
        { dark: theme.themeName === 'dark' }
      );
    };

    // 独立的CSS变量更新函数，避免重复代码
    const updateCSSVariables = theme => {
      if (typeof document !== 'undefined') {
        const root = document.documentElement;

        // 使用 SFTP 面板背景作为编辑器背景，保持一致性
        const computedSftpBg = getComputedStyle(root).getPropertyValue('--sftp-panel-bg').trim();
        root.style.setProperty('--editor-bg', computedSftpBg || theme.background);
        root.style.setProperty('--editor-fg', theme.foreground);
        root.style.setProperty('--editor-cursor', theme.cursor);
        root.style.setProperty('--editor-selection', theme.selection);
        root.style.setProperty('--editor-comment', theme.comment);
        root.style.setProperty('--editor-keyword', theme.keyword);
        root.style.setProperty('--editor-string', theme.string);
        root.style.setProperty('--editor-function', theme.function);
        root.style.setProperty('--editor-variable', theme.variable);
        root.style.setProperty('--editor-number', theme.number);
        root.style.setProperty('--editor-operator', theme.operator);
        root.style.setProperty('--editor-classname', theme.className);

        log.debug('CSS变量已更新:', {
          sftpBg: computedSftpBg,
          themeBackground: theme.background
        });
      }
    };

    // 获取字体设置，确保与终端一致
    const fontFamily =
      fontSettings.value.fontFamily || "var(--font-family-mono)";
    const fontSize = 14; //不使用 fontSettings.value.fontSize

    // 运行时创建（在加载 CodeMirror 后赋值）
    let customTheme = null;
    let customHighlightStyle = null;
    let languageConf = null;
    let themeConf = null;
    let highlightConf = null;

    // 定义中文搜索面板词组
    const chinesePhrases = {
      // @codemirror/search 模块的搜索面板词组
      Find: '查找',
      Replace: '替换',
      next: '下一个',
      previous: '上一个',
      all: '全部',
      'match case': '区分大小写',
      regexp: '正则表达式',
      'by word': '全词匹配',
      replace: '替换',
      'replace all': '全部替换',
      close: '关闭',
      'Go to line': '跳转到行',
      go: '确定',

      // 折叠面板相关
      'Folded lines': '已折叠的行',
      unfold: '展开',
      'Fold code': '折叠代码',
      'Unfold code': '展开代码',

      // 自动完成面板
      'No completions found': '未找到补全项',
      Suggestions: '建议',

      // 代码提示
      Hint: '提示',
      Info: '信息',
      Warning: '警告',
      Error: '错误',

      // 语法检查
      'No diagnostics': '无诊断信息',
      diagnostics: '诊断信息',

      // 常用编辑操作
      'Select all': '全选',
      Undo: '撤销',
      Redo: '重做',
      Cut: '剪切',
      Copy: '复制',
      Paste: '粘贴',

      // 状态栏与工具提示
      more: '更多',
      to: '到',
      'Toggle comment': '切换注释',
      'Auto indent': '自动缩进',
      Line: '行',
      Column: '列'
    };

    // 获取UI语言设置
    const getLanguagePhrases = () => {
      // 获取设置中的语言
      const uiSettings = settingsService.getUISettings();
      const language = uiSettings.language || 'zh-CN';

      // 根据语言返回相应的词组
      if (language.startsWith('zh')) {
        return chinesePhrases;
      }

      // 默认返回空对象，使用CodeMirror内置的英文
      return {};
    };

    // 创建编辑器状态
    const createEditorState = async content => {
      const languageSupport = await getLanguageSupport();

      // 获取UI语言设置的词组
      const phrases = getLanguagePhrases();

      return EditorState.create({
        doc: content,
        extensions: [
          // 基础设置
          lineNumbers(),
          highlightActiveLine(),
          history(),
          bracketMatching(),
          foldGutter(),
          indentOnInput(),

          // 字体设置
          EditorView.theme({
            '&': {
              fontSize: `${fontSize}px`,
              fontFamily
            },
            '.cm-gutters': {
              fontFamily
            },
            '.cm-content': {
              fontFamily
            },
            '.cm-line': {
              fontFamily
            }
          }),

          // 主题 - 使用可重新配置的主题
          themeConf.of(customTheme),
          highlightConf.of(syntaxHighlighting(customHighlightStyle, { fallback: true })),

          // 国际化设置
          EditorState.phrases.of(phrases),

          // 键盘映射
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            {
              key: 'Mod-s',
              run: () => {
                save();
                return true;
              }
            },
            {
              key: 'F11',
              run: () => {
                toggleFullscreen();
                return true;
              }
            },
            {
              key: 'Escape',
              run: () => {
                if (isFullscreen.value) {
                  isFullscreen.value = false;
                  return true;
                }
                return false;
              }
            }
          ]),

          // 文档变更监听
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const content = update.state.doc.toString();
              isDirty.value = content !== originalContent.value;
            }

            if (update.selectionSet) {
              const pos = update.state.selection.main.head;
              const line = update.state.doc.lineAt(pos);
              cursor.value = {
                line: line.number,
                ch: pos - line.from
              };
            }
          }),

          // 动态语言支持
          languageConf.of(languageSupport)
        ]
      });
    };

    // 初始化编辑器
    const initEditor = async () => {
      if (!editorContainer.value || !isComponentMounted.value) return;

      try {
        if (!EditorState) return;
        if (!languageConf) {
          languageConf = new Compartment();
          themeConf = new Compartment();
          highlightConf = new Compartment();
        }
        if (!customTheme) customTheme = createCustomTheme();
        if (!customHighlightStyle) customHighlightStyle = createHighlightStyle();

        // 创建编辑器状态
        const state = await createEditorState(originalContent.value);

        // 创建编辑器视图
        editorView.value = new EditorView({
          state,
          parent: editorContainer.value
        });
      } catch (error) {
        console.error('初始化编辑器失败:', error);
        ElMessage.error('初始化编辑器失败，请刷新页面重试');
      }
    };

    // 获取编辑器内容
    const getEditorContent = () => {
      if (!editorView.value) return '';
      return editorView.value.state.doc.toString();
    };

    // 保存文件
    const save = async () => {
      if (!isDirty.value || isSaving.value) return;

      isSaving.value = true;
      let loading = null;

      try {
        console.log('[SftpEditor] 开始保存:', props.filePath);
        const content = getEditorContent();

        loading = ElLoading.service({
          lock: true,
          text: '保存文件中...',
          background: 'rgba(0, 0, 0, 0.7)'
        });

        // 上传文件：依赖SFTP服务自身的完成/超时机制
        const tempFile = new File([content], fileName.value, { type: 'text/plain' });
        await sftpService.uploadFile(props.sessionId, tempFile, props.filePath, progress => {
          if (progress === 100) {
            console.log('[SftpEditor] 上传完成(100%)');
          }
        });

        // 关闭加载指示器
        if (loading) {
          loading.close();
          loading = null;
        }

        ElMessage.success('文件保存成功');

        // 更新状态
        originalContent.value = content;
        isDirty.value = false;

        // 触发保存事件
        emit('save');
      } catch (error) {
        console.error('[SftpEditor] 保存失败:', error.message);

        if (loading) {
          loading.close();
          loading = null;
        }

        ElMessage.error(`保存文件失败: ${error.message}`);
      } finally {
        isSaving.value = false;
      }
    };

    // 强制应用编辑器样式
    const applyEditorStyles = () => {
      if (!editorContainer.value) return;

      const editorDom = editorContainer.value.querySelector('.cm-editor');
      if (!editorDom) return;

      try {
        // 获取当前主题设置
        const theme = themeSettings.value;
        const font = fontSettings.value;

        // 移除全局CSS变量设置，只应用到编辑器本身
        // document.documentElement.style.setProperty('--font-family', font.fontFamily);

        // 设置基本颜色
        // editorDom.style.backgroundColor = theme.background;
        editorDom.style.color = theme.foreground;
        editorDom.style.fontSize = '14px'; //编辑器字体大小固定14px`${font.fontSize}px`;
        editorDom.style.fontFamily = font.fontFamily;

        // 设置内容区域颜色
        const contentDom = editorDom.querySelector('.cm-content');
        if (contentDom) {
          contentDom.style.color = theme.foreground;
          contentDom.style.fontFamily = font.fontFamily;
        }

        // 设置行号区域
        const guttersDom = editorDom.querySelector('.cm-gutters');
        if (guttersDom) {
          guttersDom.style.fontFamily = font.fontFamily;
        }

        // 设置每一行的颜色
        const linesDom = editorDom.querySelectorAll('.cm-line');
        linesDom.forEach(line => {
          line.style.color = theme.foreground;
          line.style.fontFamily = font.fontFamily;
        });

        // 设置语法高亮元素的颜色
        const syntaxHighlightMap = {
          '.cm-keyword': theme.keyword,
          '.cm-comment': theme.comment,
          '.cm-def, .cm-definition': theme.function,
          '.cm-variable': theme.variable,
          '.cm-string': theme.string,
          '.cm-number': theme.number,
          '.cm-operator': theme.operator,
          '.cm-punctuation': theme.foreground,
          '.cm-property': theme.variable,
          '.cm-function': theme.function,
          '.cm-className': theme.className
        };

        // 应用所有语法高亮颜色
        Object.entries(syntaxHighlightMap).forEach(([selector, color]) => {
          editorDom.querySelectorAll(selector).forEach(el => {
            el.style.color = color;
            // 为注释添加斜体样式
            if (selector === '.cm-comment') {
              el.style.fontStyle = 'italic';
            }
          });
        });
      } catch (e) {
        console.warn('应用编辑器样式时出错:', e);
      }
    };

    // 强制重新应用主题和高亮 - 优化后的版本
    const reapplyThemeAndHighlight = () => {
      if (editorView.value) {
        try {
          // 重新获取最新的主题设置
          const currentThemeSettings = getThemeSettings();
          themeSettings.value = currentThemeSettings;

          // 立即更新CSS变量
          updateCSSVariables(currentThemeSettings);

          // 重新创建主题和高亮样式
          const newCustomTheme = createCustomTheme();
          const newCustomHighlightStyle = createHighlightStyle();

          // 同步重新配置主题和高亮
          editorView.value.dispatch({
            effects: [
              themeConf.reconfigure(newCustomTheme),
              highlightConf.reconfigure(
                syntaxHighlighting(newCustomHighlightStyle, { fallback: true })
              )
            ]
          });

          // 强制应用DOM样式
          applyEditorStyles();

          // 请求重新测量视图
          editorView.value.requestMeasure();
        } catch (error) {
          log.error('重新应用主题失败:', error);
        }
      }
    };

    // 窗口大小变化处理
    const handleWindowResize = () => {
      reapplyThemeAndHighlight();
    };

    // 切换全屏显示 - 优化版本确保主题一致性
    const toggleFullscreen = () => {
      isFullscreen.value = !isFullscreen.value;

      // 全屏切换后立即同步主题，避免视觉不一致
      nextTick(() => {
        if (editorView.value) {
          try {
            // 确保主题设置是最新的
            const currentThemeSettings = getThemeSettings();
            themeSettings.value = currentThemeSettings;

            // 立即应用主题更新
            updateCSSVariables(currentThemeSettings);
            reapplyThemeAndHighlight();

            log.debug('全屏切换主题同步完成', {
              isFullscreen: isFullscreen.value,
              themeName: currentThemeSettings.themeName
            });
          } catch (error) {
            log.error('全屏切换主题同步失败:', error);
          }
        }
      });
    };

    // 关闭编辑器
    const close = async () => {
      if (isDirty.value) {
        try {
          await ElMessageBox.confirm('当前文件有未保存的修改，确定要关闭吗？', '关闭确认', {
            confirmButtonText: '不保存',
            cancelButtonText: '取消',
            type: 'warning',
            distinguishCancelAndClose: true,
            closeOnClickModal: false
          });
          emit('close');
        } catch (action) {
          if (action === 'cancel') {
            return;
          }
          // 用户点击确认按钮，关闭编辑器
          emit('close');
        }
      } else {
        emit('close');
      }
    };

    // 全局键盘事件处理
    const handleGlobalKeyDown = event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        // 全局阻止浏览器默认保存行为
        event.preventDefault();

        // 如果编辑器处于活动状态，则触发保存
        if (isDirty.value && !isSaving.value) {
          save();
        }
      }
    };

    // 添加主题变化事件监听器
    const handleThemeChange = event => {
      log.debug('SFTP编辑器收到主题变化事件:', event.detail);

      if (editorView.value) {
        try {
          log.debug('SFTP编辑器立即应用主题', {
            actualTheme: event.detail.actualTheme
          });

          // 立即获取最新的主题设置
          const newThemeSettings = getThemeSettings();
          const newFontSettings = getFontSettings();

          // 更新响应式变量
          themeSettings.value = newThemeSettings;
          fontSettings.value = newFontSettings;

          // 立即更新，让CSS过渡自然发生
          nextTick(() => {
            // 第1步：更新CSS变量
            updateCSSVariables(newThemeSettings);

            // 第2步：重新创建主题
            const newCustomTheme = createCustomTheme();
            const newCustomHighlightStyle = createHighlightStyle();

            // 第3步：应用新主题到编辑器
            editorView.value.dispatch({
              effects: [
                themeConf.reconfigure(newCustomTheme),
                highlightConf.reconfigure(
                  syntaxHighlighting(newCustomHighlightStyle, { fallback: true })
                )
              ]
            });

            // 第4步：强制应用DOM样式
            applyEditorStyles();

            // 第5步：请求重新测量视图
            editorView.value.requestMeasure();

            log.debug('SFTP编辑器主题切换完成（通过事件监听）');
          });
        } catch (error) {
          log.error('SFTP编辑器主题切换失败:', error);
        }
      }
    };

    // 生命周期钩子
    onMounted(async () => {
      window.addEventListener('keydown', handleGlobalKeyDown);
      window.addEventListener('resize', handleWindowResize);
      // 添加主题变化事件监听
      window.addEventListener('theme-changed', handleThemeChange);
      isComponentMounted.value = true;
      await ensureCodeMirror();
      await nextTick();
      initEditor();
    });

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('resize', handleWindowResize);
      // 移除主题变化事件监听
      window.removeEventListener('theme-changed', handleThemeChange);

      // 销毁编辑器
      if (editorView.value) {
        editorView.value.destroy();
        editorView.value = null;
      }
    });

    // 监听文件内容变化
    watch(
      () => props.content,
      newContent => {
        if (editorView.value && newContent !== getEditorContent()) {
          // 更新编辑器内容
          const transaction = editorView.value.state.update({
            changes: {
              from: 0,
              to: editorView.value.state.doc.length,
              insert: newContent
            }
          });

          editorView.value.dispatch(transaction);
          originalContent.value = newContent;
          isDirty.value = false;
        }
      }
    );

    // 监听设置变化 - 只处理非主题相关的设置（如语言）
    settingsService.addChangeListener(_settings => {
      // 只处理语言设置变化，主题变化由 theme-changed 事件处理
      if (editorView.value) {
        // 获取最新的语言短语设置
        const phrases = getLanguagePhrases();

        // 同步应用新的语言设置到编辑器
        editorView.value.dispatch({
          effects: EditorState.phrases.reconfigure(phrases)
        });

        editorView.value.requestMeasure();
        log.debug('SFTP编辑器语言设置已更新');
      }
    });

    return {
      editorContainer,
      fileName,
      isDirty,
      isSaving,
      isFullscreen,
      cursor,
      save,
      close,
      toggleFullscreen,
      getFileType
    };
  }
});
</script>

<style lang="scss">
.sftp-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: var(--sftp-panel-bg);
  color: var(--color-text-primary);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  z-index: 10;
  box-shadow: var(--shadow-base);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);

  &.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-fixed);
    border-radius: 0;
    box-shadow: none;
    background-color: var(--sftp-panel-bg);
    color: var(--color-text-primary);

    // 确保编辑器颜色在全屏模式下正确
    // 使用更高特异性的选择器覆盖CodeMirror默认样式
    .cm-editor.cm-editor {
      background-color: var(--editor-bg);

      .cm-scroller.cm-scroller {
        color: var(--editor-fg);
      }
      .cm-content.cm-content {
        color: var(--editor-fg);
      }
      .cm-line.cm-line {
        color: var(--editor-fg);
      }

      // 语法高亮颜色 - 使用更高特异性
      .cm-keyword.cm-keyword {
        color: var(--editor-keyword);
      }
      .cm-comment.cm-comment {
        color: var(--editor-comment);
        font-style: italic;
      }
      .cm-def.cm-def,
      .cm-definition.cm-definition {
        color: var(--editor-function);
      }
      .cm-variable.cm-variable,
      .cm-variableName.cm-variableName {
        color: var(--editor-variable);
      }
      .cm-string.cm-string {
        color: var(--editor-string);
      }
      .cm-number.cm-number {
        color: var(--editor-number);
      }
      .cm-operator.cm-operator {
        color: var(--editor-operator);
      }
      .cm-punctuation.cm-punctuation {
        color: var(--editor-fg);
      }
      .cm-property.cm-property {
        color: var(--editor-variable);
      }
      .cm-function.cm-function {
        color: var(--editor-function);
      }
      .cm-className.cm-className {
        color: var(--editor-classname);
      }
    }
  }
}

.sftp-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background-color: var(--sftp-panel-header-bg);
  border-bottom: 1px solid var(--color-border-default);
}

.sftp-editor-path {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
}

.sftp-editor-status {
  margin-left: 6px;
  color: var(--editor-classname);
}

.sftp-editor-controls {
  display: flex;
  align-items: center;
}

.sftp-editor-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--color-border-default);
  color: var(--color-text-regular);
  border-radius: 4px;
  padding: 4px 8px;
  margin-left: 8px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.sftp-editor-btn:hover {
  background-color: var(--color-hover-bg);
  color: var(--color-text-primary);
}

.sftp-editor-btn:active {
  background-color: var(--color-selected-bg);
}

.sftp-editor-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sftp-editor-btn.close:hover {
  background-color: var(--color-error-bg);
  color: var(--editor-variable);
  border-color: var(--color-error);
}

.sftp-editor-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.editor-container {
  height: 100%;
  width: 100%;
}

.sftp-editor-footer {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  background-color: var(--sftp-panel-header-bg);
  border-top: 1px solid var(--color-border-default);
  font-size: 12px;
}

.sftp-editor-status-bar {
  display: flex;
  justify-content: space-between;
  width: 100%;
  color: var(--color-text-secondary);
}

/* CodeMirror 自定义样式 */
.cm-editor {
  height: 100%;
  /* 统一等宽字体变量 */
  font-family: var(--font-family-mono);
  /* 确保编辑器背景色有过渡效果 */
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

.cm-scroller {
  overflow: auto;
  /* 确保滚动区域背景色有过渡效果 */
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

.cm-gutters {
  background-color: var(--sftp-panel-header-bg);
  border-right: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  /* 统一等宽字体变量 */
  font-family: var(--font-family-mono);
  /* 确保行号区域背景色有过渡效果 */
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

.cm-activeLineGutter {
  background-color: rgba(255, 255, 255, 0.05);
}

.cm-content {
  /* 统一等宽字体变量 */
  font-family: var(--font-family-mono);
  padding: 4px 0;
}

.cm-lineNumbers .cm-gutterElement {
  padding: 0 8px;
}

/* 滚动条样式 */
.cm-scroller::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.cm-scroller::-webkit-scrollbar-track {
  background: var(--sftp-panel-header-bg);
  border-radius: 4px;
}

.cm-scroller::-webkit-scrollbar-thumb {
  background: var(--color-border-dark);
  border-radius: 4px;
  border: 2px solid var(--sftp-panel-header-bg);
}

.cm-scroller::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary);
}

/* 添加滚动条交界处（角落）的样式 */
.cm-scroller::-webkit-scrollbar-corner {
  background: var(--sftp-panel-header-bg);
}
</style>
