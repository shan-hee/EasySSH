import SSHService from './ssh-service';
import SFTPService from './sftp-service';
import TerminalManager from './terminal-manager';
import SessionManager from './session-manager';
import * as utils from './utils';
import log from '../log';
import { MESSAGE_TYPES } from '../constants';

// 为SSHService添加创建终端的功能
const terminalManager = new TerminalManager(SSHService);

// 集成终端管理功能到SSH服务
SSHService.createTerminal = async (sessionId, container, options = {}) => {
  return await terminalManager.createTerminal(sessionId, container, options);
};

// 创建SFTP服务实例
const sftpService = new SFTPService(SSHService);

// 扩展SSH服务，添加SFTP处理器
SSHService.handleSftpMessages = function (message) {
  // 处理来自服务器的SFTP相关消息
  if (message && message.type && message.type.startsWith('sftp_')) {
    // 特殊处理sftp_ready类型消息
    if (message.type === MESSAGE_TYPES.SFTP_READY) {
      log.debug('SSH服务捕获到SFTP就绪消息');
      return true; // 消息已处理
    }
    sftpService.handleSftpMessage(message);
    return true; // 消息已处理
  }
  return false; // 不是SFTP消息
};

// 添加SFTP服务到SSH服务
SSHService.sftp = sftpService;

// 添加会话管理器
SSHService.sessionManager = SessionManager;

// 添加常用工具函数
SSHService.utils = utils;

// 导出SSH服务主实例
export default SSHService;

// 同时导出子模块
export { sftpService, terminalManager, SessionManager, utils };
