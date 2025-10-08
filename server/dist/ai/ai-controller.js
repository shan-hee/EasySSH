"use strict";
// @ts-nocheck
/**
 * AI控制器
 * 处理AI WebSocket连接和消息路由
 */
const WebSocket = require('ws');
const logger = require('../utils/logger');
const { handleWebSocketError } = require('../utils/errorHandler');
const OpenAIAdapter = require('./openai-adapter');
const ContextBuilder = require('./context-builder');
const KeyVault = require('./key-vault');
const RateLimiter = require('./rate-limiter');
class AIController {
    constructor() {
        // 存储活跃的WebSocket连接
        this.connections = new Map();
        // 存储正在进行的AI请求
        this.activeRequests = new Map();
        // 初始化核心组件
        this.contextBuilder = new ContextBuilder();
        this.keyVault = new KeyVault();
        this.rateLimiter = new RateLimiter();
        logger.info('AI控制器已初始化');
    }
    /**
     * 处理新的WebSocket连接
     * @param {WebSocket} ws WebSocket连接
     * @param {Object} connectionInfo 连接信息
     */
    handleConnection(ws, connectionInfo) {
        const { sessionId, userId } = connectionInfo;
        const connectionId = `${userId}_${sessionId}`;
        // 存储连接信息
        const connection = {
            id: connectionId,
            ws,
            userId,
            sessionId,
            createdAt: new Date(),
            lastActivity: new Date(),
            requestCount: 0
        };
        this.connections.set(connectionId, connection);
        logger.info('AI连接已建立', { connectionId, userId, sessionId });
        // 设置消息处理器
        ws.on('message', (message) => {
            this.handleMessage(connectionId, message);
        });
        // 设置连接关闭处理器
        ws.on('close', (code, reason) => {
            this.handleDisconnection(connectionId, code, reason);
        });
        // 设置错误处理器
        ws.on('error', (error) => {
            handleWebSocketError(error, { connectionId, operation: 'AI WebSocket连接' });
        });
        // 发送连接成功消息
        this.sendMessage(connectionId, {
            type: 'ai_connected',
            timestamp: new Date().toISOString()
        });
    }
    /**
     * 处理WebSocket消息
     * @param {string} connectionId 连接ID
     * @param {Buffer} message 消息内容
     */
    async handleMessage(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            logger.warn('收到未知连接的消息', { connectionId });
            return;
        }
        try {
            // 更新活动时间
            connection.lastActivity = new Date();
            connection.requestCount++;
            // 解析消息
            const data = JSON.parse(message.toString());
            logger.debug('收到AI消息', { connectionId, type: data.type, requestId: data.requestId });
            // 验证消息格式
            if (!this.validateMessage(data)) {
                this.sendError(connectionId, 'INVALID_MESSAGE', '消息格式无效');
                return;
            }
            // 检查速率限制
            const rateLimitResult = await this.rateLimiter.checkLimit(connection.userId);
            if (!rateLimitResult.allowed) {
                this.sendError(connectionId, 'RATE_LIMIT', `请求过于频繁，请等待${rateLimitResult.resetTime}秒`);
                return;
            }
            // 路由消息到相应的处理器
            await this.routeMessage(connectionId, data);
        }
        catch (error) {
            logger.error('处理AI消息失败', { connectionId, error: error.message });
            this.sendError(connectionId, 'MESSAGE_PROCESSING_ERROR', '消息处理失败');
        }
    }
    /**
     * 路由消息到相应的处理器
     * @param {string} connectionId 连接ID
     * @param {Object} data 消息数据
     */
    async routeMessage(connectionId, data) {
        const { type, requestId } = data;
        switch (type) {
            case 'ai_request':
                await this.handleAIRequest(connectionId, data);
                break;
            case 'ai_cancel':
                await this.handleAICancel(connectionId, data);
                break;
            case 'ai_config_test':
                await this.handleConfigTest(connectionId, data);
                break;
            case 'ai_config_sync':
                await this.handleConfigSync(connectionId, data);
                break;
            default:
                logger.warn('未知的AI消息类型', { connectionId, type, requestId });
                this.sendError(connectionId, 'UNKNOWN_MESSAGE_TYPE', `未知的消息类型: ${type}`);
        }
    }
    /**
     * 处理AI请求
     * @param {string} connectionId 连接ID
     * @param {Object} data 请求数据
     */
    async handleAIRequest(connectionId, data) {
        const { requestId, mode, input, context, settings } = data;
        const connection = this.connections.get(connectionId);
        try {
            // 获取用户的API配置
            const apiConfig = await this.keyVault.getApiConfig(connection.userId);
            if (!apiConfig) {
                this.sendError(connectionId, 'NO_API_CONFIG', '请先配置AI API密钥');
                return;
            }
            // 构建上下文
            const processedContext = this.contextBuilder.buildContext(context.terminalOutput, input.currentLine || input.prompt, {
                mode,
                osHint: context.osHint,
                shellHint: context.shellHint
            });
            // 创建OpenAI适配器（后端作为唯一真源：模型/密钥/地址）
            const openaiAdapter = new OpenAIAdapter(apiConfig);
            // 创建取消控制器
            const abortController = new AbortController();
            this.activeRequests.set(requestId, {
                connectionId,
                abortController,
                startTime: Date.now()
            });
            // 发送AI请求
            // 仅允许白名单推理参数从前端透传（允许 model；不允许 baseUrl/apiKey）
            const safeSettings = this._sanitizeClientSettings(settings);
            await this.processAIRequest(connectionId, requestId, openaiAdapter, mode, processedContext, input, safeSettings, abortController.signal);
        }
        catch (error) {
            logger.error('处理AI请求失败', { connectionId, requestId, error: error.message });
            this.sendError(connectionId, 'AI_REQUEST_ERROR', error.message, requestId);
        }
        finally {
            // 清理请求记录
            this.activeRequests.delete(requestId);
        }
    }
    /**
     * 过滤客户端设置，仅保留允许的推理参数
     * - 允许前端提供模型 model
     * - 禁止覆盖后端 baseUrl/apiKey
     * - 对传入值做基本范围约束
     */
    _sanitizeClientSettings(settings) {
        const out = { stream: true };
        if (!settings || typeof settings !== 'object')
            return out;
        const clamp = (v, min, max) => {
            if (typeof v !== 'number' || Number.isNaN(v))
                return undefined;
            return Math.min(Math.max(v, min), max);
        };
        const t = clamp(settings.temperature, 0, 2);
        if (t !== undefined)
            out.temperature = t;
        const mt = clamp(settings.maxTokens, 1, 4096);
        if (mt !== undefined)
            out.maxTokens = mt;
        // 模型名称（基础校验）
        if (typeof settings.model === 'string') {
            const m = settings.model.trim();
            if (m.length >= 2 && m.length <= 120)
                out.model = m;
        }
        // 其余字段忽略（尤其是 baseUrl/apiKey）
        return out;
    }
    /**
     * 处理AI取消请求
     * @param {string} connectionId 连接ID
     * @param {Object} data 取消数据
     */
    async handleAICancel(connectionId, data) {
        const { requestId } = data;
        const activeRequest = this.activeRequests.get(requestId);
        if (activeRequest && activeRequest.connectionId === connectionId) {
            logger.info('取消AI请求', { connectionId, requestId });
            activeRequest.abortController.abort();
            this.activeRequests.delete(requestId);
            this.sendMessage(connectionId, {
                type: 'ai_cancelled',
                requestId,
                timestamp: new Date().toISOString()
            });
        }
        else {
            logger.warn('尝试取消不存在的AI请求', { connectionId, requestId });
        }
    }
    /**
     * 处理配置测试请求
     * @param {string} connectionId 连接ID
     * @param {Object} data 测试数据
     */
    async handleConfigTest(connectionId, data) {
        const { requestId, config } = data;
        try {
            const result = await this.keyVault.testApiConfig(config);
            this.sendMessage(connectionId, {
                type: 'ai_config_test_result',
                requestId,
                success: result.valid,
                message: result.valid ? '连接测试成功' : result.error,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            logger.error('API配置测试失败', { connectionId, requestId, error: error.message });
            this.sendMessage(connectionId, {
                type: 'ai_config_test_result',
                requestId,
                success: false,
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
    /**
     * 处理配置同步请求
     * @param {string} connectionId 连接ID
     * @param {Object} data 配置数据
     */
    async handleConfigSync(connectionId, data) {
        const { config, userId } = data;
        try {
            // 存储用户的API配置到后端
            await this.keyVault.storeApiConfig(userId, config, { sessionOnly: true });
            logger.info('AI配置已同步到后端', {
                connectionId,
                userId,
                provider: config.provider,
                model: config.model
            });
            // 发送同步成功确认
            this.sendMessage(connectionId, {
                type: 'ai_config_sync_result',
                success: true,
                message: '配置同步成功',
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            logger.error('AI配置同步失败', { connectionId, userId, error: error.message });
            this.sendMessage(connectionId, {
                type: 'ai_config_sync_result',
                success: false,
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
    /**
     * 验证消息格式
     * @param {Object} data 消息数据
     * @returns {boolean} 是否有效
     */
    validateMessage(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }
        const { type } = data;
        if (!type) {
            return false;
        }
        // 根据消息类型进行具体验证
        switch (type) {
            case 'ai_request':
                return !!(data.requestId && data.mode && data.input);
            case 'ai_cancel':
            case 'ai_config_test':
                return !!data.requestId;
            case 'ai_config_sync':
                return !!(data.config && data.userId);
            default:
                return false;
        }
    }
    /**
     * 发送消息到客户端
     * @param {string} connectionId 连接ID
     * @param {Object} message 消息对象
     */
    sendMessage(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.send(JSON.stringify(message));
        }
    }
    /**
     * 发送错误消息
     * @param {string} connectionId 连接ID
     * @param {string} code 错误代码
     * @param {string} message 错误消息
     * @param {string} requestId 请求ID（可选）
     */
    sendError(connectionId, code, message, requestId = null) {
        this.sendMessage(connectionId, {
            type: 'ai_error',
            requestId,
            error: {
                code,
                message
            },
            timestamp: new Date().toISOString()
        });
    }
    /**
     * 处理连接断开
     * @param {string} connectionId 连接ID
     * @param {number} code 关闭代码
     * @param {string} reason 关闭原因
     */
    handleDisconnection(connectionId, code, reason) {
        logger.info('AI连接已断开', {
            connectionId,
            code,
            reason: reason?.toString()
        });
        // 取消该连接的所有活跃请求
        for (const [requestId, request] of this.activeRequests.entries()) {
            if (request.connectionId === connectionId) {
                request.abortController.abort();
                this.activeRequests.delete(requestId);
            }
        }
        // 移除连接记录
        this.connections.delete(connectionId);
    }
    /**
     * 获取控制器状态
     * @returns {Object} 状态信息
     */
    getStatus() {
        return {
            connections: this.connections.size,
            activeRequests: this.activeRequests.size,
            uptime: Date.now() - (this.startTime || Date.now())
        };
    }
    /**
     * 处理AI请求的核心逻辑
     * @param {string} connectionId 连接ID
     * @param {string} requestId 请求ID
     * @param {OpenAIAdapter} openaiAdapter OpenAI适配器
     * @param {string} mode AI模式
     * @param {Object} context 处理后的上下文
     * @param {Object} input 用户输入
     * @param {Object} settings 请求设置
     * @param {AbortSignal} signal 取消信号
     */
    async processAIRequest(connectionId, requestId, openaiAdapter, mode, context, input, settings, signal) {
        try {
            // 构建聊天消息
            const messages = openaiAdapter.buildChatMessages(mode, context, input);
            logger.debug('开始处理AI请求', {
                connectionId,
                requestId,
                mode,
                messageCount: messages.length
            });
            // 发送流式请求
            const stream = openaiAdapter.streamChatCompletion(messages, settings, signal);
            let totalContent = '';
            let tokenUsage = { input: 0, output: 0 };
            for await (const chunk of stream) {
                // 检查是否已取消
                if (signal && signal.aborted) {
                    logger.info('AI请求已取消', { connectionId, requestId });
                    return;
                }
                if (chunk.type === 'delta' && chunk.content) {
                    totalContent += chunk.content;
                    // 发送流式响应
                    this.sendMessage(connectionId, {
                        type: 'ai_stream',
                        requestId,
                        delta: chunk.content,
                        final: false,
                        timestamp: new Date().toISOString()
                    });
                }
                else if (chunk.type === 'done') {
                    // 请求完成
                    tokenUsage = chunk.metadata?.tokens || tokenUsage;
                    const modelUsed = (settings && settings.model) ? settings.model : openaiAdapter.model;
                    this.sendMessage(connectionId, {
                        type: 'ai_done',
                        requestId,
                        metadata: {
                            tokens: tokenUsage,
                            cost: this._estimateCost(tokenUsage, modelUsed),
                            model: modelUsed || 'gpt-4o-mini',
                            duration: Date.now() - this.activeRequests.get(requestId)?.startTime || 0,
                            contentLength: totalContent.length
                        },
                        timestamp: new Date().toISOString()
                    });
                    // 更新用户使用统计
                    const connection = this.connections.get(connectionId);
                    if (connection) {
                        await this.keyVault.updateApiUsageStats(connection.userId, {
                            tokens: tokenUsage,
                            cost: this._estimateCost(tokenUsage, modelUsed)
                        });
                    }
                    logger.info('AI请求处理完成', {
                        connectionId,
                        requestId,
                        mode,
                        contentLength: totalContent.length,
                        tokens: tokenUsage
                    });
                    break;
                }
            }
        }
        catch (error) {
            if (error.name === 'AbortError' || (signal && signal.aborted)) {
                logger.info('AI请求已取消', { connectionId, requestId });
                return;
            }
            logger.error('AI请求处理失败', {
                connectionId,
                requestId,
                mode,
                error: error.message
            });
            // 发送错误响应
            this.sendError(connectionId, 'AI_PROCESSING_ERROR', error.message, requestId);
        }
    }
    /**
     * 估算API调用成本
     * @param {Object} tokenUsage Token使用量
     * @param {string} model 模型名称
     * @returns {number} 估算成本（美元）
     */
    _estimateCost(tokenUsage, model = 'gpt-4o-mini') {
        // 简化的成本估算，实际价格可能不同
        const pricing = {
            'gpt-4o-mini': { input: 0.00015, output: 0.0006 }, // 每1K tokens的价格
            'gpt-4o': { input: 0.005, output: 0.015 },
            'gpt-3.5-turbo': { input: 0.0015, output: 0.002 }
        };
        const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
        const inputCost = (tokenUsage.input / 1000) * modelPricing.input;
        const outputCost = (tokenUsage.output / 1000) * modelPricing.output;
        return inputCost + outputCost;
    }
    /**
     * 清理资源
     */
    cleanup() {
        // 取消所有活跃请求
        for (const [requestId, request] of this.activeRequests.entries()) {
            request.abortController.abort();
        }
        this.activeRequests.clear();
        // 关闭所有连接
        for (const [connectionId, connection] of this.connections.entries()) {
            if (connection.ws.readyState === WebSocket.OPEN) {
                connection.ws.close(1001, '服务器关闭');
            }
        }
        this.connections.clear();
        logger.info('AI控制器已清理');
    }
}
module.exports = AIController;
