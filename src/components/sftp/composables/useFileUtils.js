/**
 * 提供文件相关的工具函数
 */
export function useFileUtils() {
  /**
   * 格式化文件大小
   * @param {number|string} bytes 文件大小（字节）
   * @param {boolean} isDirectory 是否是目录
   * @returns {string} 格式化后的文件大小
   */
  const formatFileSize = (bytes, isDirectory) => {
    // 如果是目录，直接返回短横线
    if (isDirectory === true) return '-';

    // 检查是否为undefined或null或0
    if (bytes === undefined || bytes === null || bytes === 0) return '-';

    try {
      // 确保bytes是数字
      let size = bytes;
      if (typeof bytes === 'string') {
        size = parseFloat(bytes);
      }

      // 检查转换后是否为有效数字
      if (isNaN(size) || !isFinite(size)) return '-';

      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
      }

      return `${size.toFixed(1)} ${units[i]}`;
    } catch (error) {
      console.error('格式化文件大小出错:', error, 'bytes值:', bytes);
      return '-';
    }
  };

  /**
   * 格式化日期
   * @param {Date|string} date 日期对象或日期字符串
   * @returns {string} 格式化后的日期字符串
   */
  const formatDate = date => {
    if (!date) return '-';

    try {
      // 确保date是Date对象
      const dateObj = date instanceof Date ? date : new Date(date);

      // 检查日期是否有效
      if (isNaN(dateObj.getTime())) return '-';

      const year = dateObj.getFullYear();
      const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
      const day = dateObj.getDate().toString().padStart(2, '0');
      const hours = dateObj.getHours().toString().padStart(2, '0');
      const minutes = dateObj.getMinutes().toString().padStart(2, '0');

      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch (error) {
      console.error('格式化日期出错:', error, '日期值:', date);
      return '-';
    }
  };

  /**
   * 获取文件类型
   * @param {string} filename 文件名
   * @returns {string} 文件类型
   */
  const getFileType = filename => {
    if (!filename) return '未知';

    // 获取文件扩展名
    const extension = filename.split('.').pop().toLowerCase();

    const typeMap = {
      // 文档类型
      txt: '文本文件',
      pdf: 'PDF文档',
      doc: 'Word文档',
      docx: 'Word文档',
      xls: 'Excel表格',
      xlsx: 'Excel表格',
      ppt: 'PPT演示文稿',
      pptx: 'PPT演示文稿',

      // 图像类型
      jpg: '图片',
      jpeg: '图片',
      png: '图片',
      gif: '图片',
      svg: '矢量图',
      webp: '图片',

      // 音视频类型
      mp3: '音频',
      wav: '音频',
      mp4: '视频',
      avi: '视频',
      mov: '视频',
      mkv: '视频',

      // 压缩文件
      zip: '压缩文件',
      rar: '压缩文件',
      tar: '压缩文件',
      gz: '压缩文件',
      '7z': '压缩文件',

      // 代码和配置文件
      js: 'JavaScript文件',
      ts: 'TypeScript文件',
      html: 'HTML文件',
      css: 'CSS文件',
      scss: 'SCSS文件',
      less: 'LESS文件',
      json: 'JSON文件',
      xml: 'XML文件',
      yaml: 'YAML文件',
      yml: 'YAML文件',
      md: 'Markdown文件',

      // 可执行文件
      exe: '可执行文件',
      sh: '脚本文件',
      bat: '批处理文件',
      app: '应用程序',
      dmg: '磁盘镜像',
      iso: '光盘镜像'
    };

    return typeMap[extension] || extension;
  };

  return {
    formatFileSize,
    formatDate,
    getFileType
  };
}
