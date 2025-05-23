# 图标资源目录

此目录用于存放项目中使用的图标资源。

## 图标格式

所有图标应优先使用SVG格式，具有以下优势：

- 可缩放，不失真
- 文件体积小
- 可直接嵌入HTML
- 可通过CSS控制颜色和其他样式

## 命名规范

图标文件应遵循以下命名规范：

- 使用`icon-`前缀
- 使用描述性名称
- 单词之间使用连字符(-)分隔
- 全部小写字母

例如：
- `icon-add.svg`
- `icon-delete.svg`
- `icon-settings.svg`
- `icon-user-profile.svg`

## 图标分类

如果图标数量较多，可按照以下类别进行子目录组织：

- actions/ - 表示动作的图标（添加、删除、保存等）
- navigation/ - 导航相关图标（菜单、箭头、返回等）
- status/ - 状态相关图标（成功、错误、警告等）
- objects/ - 对象相关图标（文件、文档、设备等）
- social/ - 社交媒体图标
- ui/ - 界面元素图标（控件、按钮等）

## 使用建议

1. 保持图标风格一致性
2. 使用统一的尺寸（通常24x24像素是基准尺寸）
3. 优先使用SVG图标而非图标字体
4. 考虑创建SVG图标集（sprite）提高性能
5. 确保图标的可访问性，添加适当的aria属性 