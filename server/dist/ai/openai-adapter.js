"use strict";
// @ts-nocheck
/**
 * OpenAI兼容适配器
 * 处理与OpenAI兼容API的通信
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const logger = require('../utils/logger');
class OpenAIAdapter {
    constructor(config) {
        this.baseUrl = config.baseUrl || 'https://api.openai.com';
        this.apiKey = config.apiKey;
        this.model = config.model; // 移除默认值，要求用户必须提供
        this.timeout = config.timeout || 30000;
        // 从后端配置提供的默认推理参数
        this.defaultTemperature =
            config.temperature === 0 || typeof config.temperature === 'number'
                ? config.temperature
                : 0.2;
        this.defaultMaxTokens =
            typeof config.maxTokens === 'number' && config.maxTokens > 0
                ? config.maxTokens
                : 512;
        // 验证必要参数
        if (!this.model) {
            throw new Error('模型名称是必需的参数');
        }
        // 确保baseUrl不以斜杠结尾
        this.baseUrl = this.baseUrl.replace(/\/$/, '');
        logger.debug('OpenAI适配器已初始化', {
            baseUrl: this.baseUrl,
            model: this.model,
            hasApiKey: !!this.apiKey
        });
    }
    /**
     * 发送流式聊天完成请求
     * @param {Array} messages 消息数组
     * @param {Object} options 请求选项
     * @param {AbortSignal} signal 取消信号
     * @returns {AsyncGenerator} 流式响应生成器
     */
    async *streamChatCompletion(messages, options = {}, signal = null) {
        const url = `${this.baseUrl}/v1/chat/completions`;
        // 不允许外部选项覆盖后端配置的模型，确保使用后端存储的模型
        const { model: _ignoreModel, ...safeOptions } = options || {};
        const requestBody = {
            model: this.model,
            messages,
            stream: true,
            // 使用后端默认值作为兜底，不用 ||，避免 0 被当作 falsy
            temperature: safeOptions.temperature ?? this.defaultTemperature,
            max_tokens: safeOptions.maxTokens ?? this.defaultMaxTokens,
            ...safeOptions
        };
        logger.debug('发送OpenAI请求', {
            url,
            model: this.model,
            messageCount: messages.length,
            temperature: requestBody.temperature,
            maxTokens: requestBody.max_tokens
        });
        try {
            const response = await this._makeRequest(url, requestBody, signal);
            if (!response.ok) {
                const errorText = await this._readStream(response);
                throw new Error(`OpenAI API错误: ${response.status} ${response.statusText} - ${errorText}`);
            }
            // 解析SSE流
            yield* this._parseSSEStream(response, signal);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                logger.info('OpenAI请求已取消');
                return;
            }
            logger.error('OpenAI请求失败', { error: error.message });
            throw error;
        }
    }
    /**
     * 测试API配置 - 完整验证API+Key+Model组合
     * @param {Object} testConfig 测试配置
     * @returns {Promise<Object>} 测试结果
     */
    async testConnection(testConfig = null) {
        const config = testConfig || {
            baseUrl: this.baseUrl,
            apiKey: this.apiKey,
            model: this.model
        };
        // 验证配置完整性
        if (!config.baseUrl || !config.apiKey || !config.model) {
            return {
                valid: false,
                success: false,
                message: '配置不完整：需要API地址、密钥和模型名称'
            };
        }
        const url = `${config.baseUrl}/v1/chat/completions`;
        const requestBody = {
            model: config.model,
            messages: [
                { role: 'user', content: 'Hi' }
            ],
            stream: false, // 使用非流式请求
            max_tokens: 10, // 少量token用于测试
            temperature: 0
        };
        logger.debug('开始测试API配置', {
            baseUrl: config.baseUrl,
            model: config.model,
            hasApiKey: !!config.apiKey
        });
        try {
            const response = await this._makeSimpleRequest(url, requestBody, config.apiKey);
            // 先检查HTTP状态码
            if (response.status === 200 || response.status === 201) {
                // 解析响应内容
                const data = JSON.parse(response.data);
                // 验证响应格式
                if (data.choices && data.choices.length > 0) {
                    const content = data.choices[0].message?.content || '';
                    const finishReason = data.choices[0].finish_reason;
                    logger.info('API配置测试成功', {
                        model: data.model,
                        usage: data.usage,
                        finishReason
                    });
                    return {
                        valid: true,
                        success: true,
                        message: `API+模型(${data.model})测试成功`,
                        data: {
                            model: data.model,
                            content: content.trim(),
                            finishReason,
                            usage: data.usage
                        }
                    };
                }
                else {
                    return {
                        valid: false,
                        success: false,
                        message: 'API响应格式异常：缺少choices字段'
                    };
                }
            }
            else if (response.status === 401) {
                return {
                    valid: false,
                    success: false,
                    message: 'API密钥无效或未授权，请检查密钥是否正确'
                };
            }
            else if (response.status === 404) {
                return {
                    valid: false,
                    success: false,
                    message: `模型 "${config.model}" 不存在或不可用，请检查模型名称`
                };
            }
            else if (response.status === 429) {
                return {
                    valid: false,
                    success: false,
                    message: 'API请求限流或配额耗尽，请稍后重试'
                };
            }
            else {
                // 其他4xx/5xx错误
                let errorMsg = `HTTP ${response.status}`;
                try {
                    const errorData = JSON.parse(response.data);
                    if (errorData.error?.message) {
                        errorMsg = errorData.error.message;
                    }
                    else if (errorData.message) {
                        errorMsg = errorData.message;
                    }
                }
                catch (e) {
                    // 解析失败，使用状态码
                }
                logger.warn('API测试失败', {
                    status: response.status,
                    error: errorMsg,
                    model: config.model
                });
                return {
                    valid: false,
                    success: false,
                    message: `API请求失败: ${errorMsg}`
                };
            }
        }
        catch (error) {
            logger.error('API连接测试异常', {
                error: error.message,
                baseUrl: config.baseUrl,
                model: config.model
            });
            // 提供更具体的错误信息
            let errorMessage = error.message;
            if (error.code === 'ENOTFOUND') {
                errorMessage = 'API地址无法访问，请检查网络连接或地址是否正确';
            }
            else if (error.code === 'ECONNREFUSED') {
                errorMessage = 'API服务器拒绝连接，请检查地址和端口';
            }
            else if (error.code === 'ETIMEDOUT') {
                errorMessage = '连接超时，请检查网络或稍后重试';
            }
            return {
                valid: false,
                success: false,
                message: `连接测试失败: ${errorMessage}`
            };
        }
    }
    /**
     * 发送简单HTTP请求（用于API测试）
     * @param {string} url 请求URL
     * @param {Object} body 请求体
     * @param {string} apiKey API密钥
     * @returns {Promise<Object>} 响应对象
     */
    _makeSimpleRequest(url, body, apiKey) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            const postData = JSON.stringify(body);
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'EasySSH-AI/1.0'
                },
                timeout: 10000 // 10秒超时，测试用
            };
            const req = httpModule.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        data
                    });
                });
            });
            req.on('error', (error) => {
                reject(new Error(`请求失败: ${error.message}`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });
            req.write(postData);
            req.end();
        });
    }
    /**
     * 发送HTTP请求
     * @param {string} url 请求URL
     * @param {Object} body 请求体
     * @param {AbortSignal} signal 取消信号
     * @returns {Promise<Response>} 响应对象
     */
    _makeRequest(url, body, signal) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            const postData = JSON.stringify(body);
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'EasySSH-AI/1.0'
                },
                timeout: this.timeout
            };
            const req = httpModule.request(options, (res) => {
                // 创建响应对象，模拟fetch API
                const response = {
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    headers: res.headers,
                    body: res
                };
                resolve(response);
            });
            req.on('error', (error) => {
                reject(new Error(`请求失败: ${error.message}`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });
            // 处理取消信号
            if (signal) {
                signal.addEventListener('abort', () => {
                    req.destroy();
                    reject(new Error('请求已取消'));
                });
            }
            req.write(postData);
            req.end();
        });
    }
    /**
     * 解析SSE流
     * @param {Object} response 响应对象
     * @param {AbortSignal} signal 取消信号
     * @returns {AsyncGenerator} 解析结果生成器
     */
    async *_parseSSEStream(response, signal) {
        let buffer = '';
        const totalTokens = { input: 0, output: 0 };
        try {
            for await (const chunk of response.body) {
                // 检查是否已取消
                if (signal && signal.aborted) {
                    return;
                }
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // 保留不完整的行
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            yield {
                                type: 'done',
                                metadata: {
                                    tokens: totalTokens,
                                    model: this.model
                                }
                            };
                            return;
                        }
                        try {
                            const json = JSON.parse(data);
                            const delta = json.choices?.[0]?.delta?.content;
                            if (delta) {
                                totalTokens.output += this._estimateTokens(delta);
                                yield {
                                    type: 'delta',
                                    content: delta,
                                    usage: json.usage
                                };
                            }
                            // 处理使用统计信息
                            if (json.usage) {
                                totalTokens.input = json.usage.prompt_tokens || 0;
                                totalTokens.output = json.usage.completion_tokens || 0;
                            }
                        }
                        catch (parseError) {
                            logger.warn('解析SSE数据失败', {
                                data: data.substring(0, 100),
                                error: parseError.message
                            });
                        }
                    }
                }
            }
        }
        catch (error) {
            if (error.name === 'AbortError' || (signal && signal.aborted)) {
                logger.info('SSE流解析已取消');
                return;
            }
            throw error;
        }
    }
    /**
     * 读取完整的流内容
     * @param {Object} response 响应对象
     * @returns {Promise<string>} 流内容
     */
    async _readStream(response) {
        let content = '';
        for await (const chunk of response.body) {
            content += chunk.toString();
        }
        return content;
    }
    /**
     * 估算token数量（简单实现）
     * @param {string} text 文本内容
     * @returns {number} 估算的token数量
     */
    _estimateTokens(text) {
        // 简单的token估算：大约4个字符 = 1个token
        return Math.ceil(text.length / 4);
    }
    /**
     * 构建聊天消息
     * @param {string} mode AI模式
     * @param {Object} context 上下文
     * @param {Object} input 用户输入
     * @returns {Array} 消息数组
     */
    buildChatMessages(mode, context, input) {
        const messages = [];
        // 系统提示词
        const systemPrompt = this._getSystemPrompt(mode, context);
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        // 用户消息
        const userMessage = this._buildUserMessage(mode, context, input);
        messages.push({ role: 'user', content: userMessage });
        return messages;
    }
    /**
     * 获取系统提示词
     * @param {string} mode AI模式
     * @param {Object} context 上下文
     * @returns {string} 系统提示词
     */
    _getSystemPrompt(mode, context) {
        const basePrompt = 'You are an expert shell assistant embedded in a web terminal. Be concise and helpful. Never execute commands yourself; only suggest.';
        const modePrompts = {
            // 两种核心模式
            chat: `${basePrompt} You are in Chat mode - engage in natural conversation with the user about technical topics, shell commands, system administration, and programming. Be conversational, informative, and helpful. Answer questions thoroughly and provide examples when appropriate.`,
            agent: `${basePrompt} You are in Agent mode - act as an intelligent assistant that analyzes the terminal state and provides specific, actionable recommendations. Based on the terminal output and context, automatically determine what the user needs: explanation of output, error fixing, or script generation. Be precise and focused on practical solutions.`
        };
        return modePrompts[mode] || basePrompt;
    }
    /**
     * 构建用户消息
     * @param {string} mode AI模式
     * @param {Object} context 上下文
     * @param {Object} input 用户输入
     * @returns {string} 用户消息
     */
    _buildUserMessage(mode, context, input) {
        const parts = [];
        // 添加系统信息
        if (context.metadata) {
            const { osHint, shellHint } = context.metadata;
            parts.push(`System: ${osHint || 'unknown'} | Shell: ${shellHint || 'unknown'}`);
        }
        // 添加终端输出
        if (context.terminalOutput) {
            parts.push(`Recent terminal output:\n${context.terminalOutput}`);
        }
        // 添加当前输入
        if (input.currentLine || input.prompt) {
            parts.push(`Current input: ${input.currentLine || input.prompt}`);
        }
        // 添加特定模式的指令
        const modeInstructions = {
            // 两种核心模式
            chat: `User question: ${input.question || input.prompt || input.currentLine}`,
            agent: this._buildAgentInstruction(input, context)
        };
        if (modeInstructions[mode]) {
            parts.push(modeInstructions[mode]);
        }
        return parts.join('\n\n');
    }
    /**
     * 构建Agent模式的指令
     * @param {Object} input 用户输入
     * @param {Object} context 上下文
     * @returns {string} Agent指令
     */
    _buildAgentInstruction(input, context) {
        const operationType = input.operationType || 'auto';
        if (operationType === 'auto') {
            // 自动模式：让AI根据上下文判断需要什么操作
            let instruction = 'Analyze the terminal state and provide appropriate assistance. ';
            if (context.metadata && context.metadata.errorDetected) {
                instruction += 'There appears to be an error - provide specific fix commands. ';
            }
            if (input.prompt) {
                instruction += `User request: ${input.prompt}`;
            }
            else {
                instruction += 'Explain the recent output and suggest next steps if needed.';
            }
            return instruction;
        }
        else {
            // 指定操作类型
            const typeInstructions = {
                explanation: 'Explain the terminal output and identify any issues.',
                fix: 'Analyze the error and provide specific commands to fix the problem.',
                generation: `Generate a shell script for: ${input.prompt || 'the requested task'}`
            };
            return typeInstructions[operationType] || 'Provide assistance based on the terminal context.';
        }
    }
    /**
     * 对API密钥进行打码处理（安全性）
     * @param {string} apiKey API密钥
     * @returns {string} 打码后的API密钥
     */
    _maskApiKey(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            return '[无效密钥]';
        }
        if (apiKey.length <= 8) {
            return '***';
        }
        // 显示前4位和后4位，中间用*代替
        const start = apiKey.substring(0, 4);
        const end = apiKey.substring(apiKey.length - 4);
        const middle = '*'.repeat(Math.max(4, apiKey.length - 8));
        return `${start}${middle}${end}`;
    }
}
module.exports = OpenAIAdapter;
