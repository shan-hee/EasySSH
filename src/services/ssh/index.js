import SSHService from './ssh-service';
import SFTPService from './sftp-service';
import TerminalManager from './terminal-manager';
import SessionManager from './session-manager';
import * as utils from './utils';
import log from '../log';

// 为SSHService添加创建终端的功能
const terminalManager = new TerminalManager(SSHService);

// 集成终端管理功能到SSH服务
SSHService.createTerminal = async (sessionId, container, options = {}) => {
  return await terminalManager.createTerminal(sessionId, container, options);
};

// 创建SFTP服务实例
const sftpService = new SFTPService(SSHService);

// 说明：SFTP JSON 通道已迁移到统一二进制协议，
// 不再需要 JSON 消息分发器。保留此处为空以避免误用。

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
