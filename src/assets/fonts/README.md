# 字体资源目录

此目录用于存放项目中使用的字体文件。

## 字体格式

包含以下格式的字体文件：

- WOFF2 (.woff2) - 首选格式，现代浏览器支持
- WOFF (.woff) - 备用格式，广泛兼容
- TTF (.ttf) - 用于较老的浏览器兼容
- EOT (.eot) - 用于IE9及以下版本兼容

## 命名规范

字体文件应遵循以下命名规范：

- 使用原始字体名称，保持一致性
- 字体名称中的空格替换为连字符(-)
- 包含字体粗细和样式信息，例如：
  - `roboto-regular.woff2`
  - `roboto-bold.woff2`
  - `roboto-italic.woff2`
  - `open-sans-light.woff2`

## 子目录组织

如果使用多个字体系列，应按照字体系列名称创建子目录，例如：

- roboto/
- open-sans/
- montserrat/

## 使用建议

1. 限制使用的字体数量，通常不超过2-3种字体系列
2. 确保包含所有必要的字体变体（粗细、斜体等）
3. 优先使用woff2格式，同时提供其他格式作为备选
4. 考虑使用字体子集（font subsetting）减小文件大小
5. 适当使用字体加载策略（font-display属性） 