/**
 * EasySSH AI服务模块入口（TypeScript）
 * 处理AI相关的WebSocket连接和HTTP API
 */

import WebSocket from 'ws';
import logger from '../utils/logger';
import { handleWebSocketError } from '../utils/errorHandler';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AIController = require('./ai-controller');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authMiddleware } = require('../middleware/auth');

// AI WebSocket服务器实例
let aiWss: WebSocket.Server | null = null;
// AI控制器实例
let aiController: any | null = null;

/**
 * 初始化AI WebSocket服务器
 * @param {http.Server} server HTTP服务器实例
 * @returns {WebSocket.Server} AI WebSocket服务器实例
 */
function initAIWebSocketServer(server: any) {
  // 创建AI WebSocket服务器
  aiWss = new WebSocket.Server({
    noServer: true,
    path: '/ai'
  });

  // 创建AI控制器
  aiController = new AIController();

  logger.info('AI WebSocket服务器已初始化，等待连接到 /ai 路径');

  // 监听连接事件
  aiWss.on('connection', (ws: WebSocket, req: any) => {
    logger.debug('收到AI WebSocket连接请求', { url: req.url });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    const userId = url.searchParams.get('userId');

    if (!sessionId || !userId) {
      logger.warn('AI WebSocket连接缺少必要参数', { sessionId, userId });
      ws.close(1008, '缺少必要参数');
      return;
    }

    logger.info('AI WebSocket连接已建立', { sessionId, userId });
    aiController.handleConnection(ws, { sessionId, userId, request: req });
  });

  // 监听错误事件
  aiWss.on('error', (error: any) => {
    handleWebSocketError(error, { operation: 'AI WebSocket服务器' });
  });

  return aiWss;
}

/**
 * 处理HTTP服务器的upgrade事件，路由AI WebSocket连接
 * @param {http.IncomingMessage} request
 * @param {net.Socket} socket
 * @param {Buffer} head
 */
function handleUpgrade(request: any, socket: any, head: any) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  // 只处理AI路径的WebSocket请求
  if (pathname === '/ai') {
    // TODO: 在这里可以添加身份验证逻辑
    // 目前先允许所有连接，后续会添加JWT验证
    if (!aiWss) return;
    aiWss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      aiWss!.emit('connection', ws, request);
    });
  }
}

/**
 * 获取AI服务状态
 * @returns {Object} AI服务状态信息
 */
function getAIServiceStatus() {
  return {
    enabled: aiWss !== null,
    connections: aiWss ? aiWss.clients.size : 0,
    controller: aiController ? aiController.getStatus() : null
  };
}

/**
 * 关闭AI WebSocket服务器
 */
function closeAIWebSocketServer() {
  if (aiWss) {
    logger.info('正在关闭AI WebSocket服务器...');
    aiWss.close(() => {
      logger.info('AI WebSocket服务器已关闭');
    });
    aiWss = null;
  }

  if (aiController) {
    aiController.cleanup();
    aiController = null;
  }
}

module.exports = {
  initAIWebSocketServer,
  handleUpgrade,
  getAIServiceStatus,
  closeAIWebSocketServer
};
