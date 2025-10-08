"use strict";
/**
 * 服务器控制器 (TypeScript 版)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectServer = exports.deleteServer = exports.updateServer = exports.createServer = exports.getServer = exports.getUserServers = void 0;
const serverService_1 = __importDefault(require("../services/serverService"));
const getUserServers = async (req, res) => {
    try {
        const userId = req.user?.id;
        const servers = await serverService_1.default.getServersByUser(userId);
        res.json({ success: true, servers });
    }
    catch (error) {
        console.error('获取服务器列表错误:', error);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.getUserServers = getUserServers;
const getServer = async (req, res) => {
    try {
        const serverId = req.params.id;
        const userId = req.user?.id;
        const includeCredentials = req.query.includeCredentials === 'true';
        const server = await serverService_1.default.getServerById(serverId, includeCredentials);
        if (!server)
            return res.status(404).json({ success: false, message: '服务器不存在' });
        // 权限检查（安全对象或完整对象均含 owner/shared）
        const s = server;
        if (s.owner?.toString() !== userId && !s.shared?.isShared) {
            return res.status(403).json({ success: false, message: '无权限访问此服务器' });
        }
        if (s.shared?.isShared && s.owner?.toString() !== userId && !s.shared?.sharedWith?.includes(userId)) {
            return res.status(403).json({ success: false, message: '无权限访问此服务器' });
        }
        res.json({ success: true, server });
    }
    catch (error) {
        console.error('获取服务器信息错误:', error);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.getServer = getServer;
const createServer = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { name, host, port, username } = req.body;
        if (!name || !host || !username) {
            return res.status(400).json({ success: false, message: '服务器名称、主机和用户名不能为空' });
        }
        if (!req.body.password && !req.body.privateKey) {
            return res.status(400).json({ success: false, message: '必须提供密码或私钥' });
        }
        const serverData = {
            name,
            host,
            port: port || 22,
            username,
            password: req.body.password,
            privateKey: req.body.privateKey,
            usePrivateKey: !!req.body.privateKey,
            description: req.body.description,
            tags: req.body.tags || [],
            timeout: req.body.timeout || 10000,
            owner: userId
        };
        const result = await serverService_1.default.createServer(serverData);
        if (!result.success)
            return res.status(400).json(result);
        return res.status(201).json(result);
    }
    catch (error) {
        console.error('创建服务器错误:', error);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.createServer = createServer;
const updateServer = async (req, res) => {
    try {
        const serverId = req.params.id;
        const userId = req.user?.id;
        const result = await serverService_1.default.updateServer(serverId, userId, req.body);
        if (!result.success) {
            return res.status(result.message.includes('不存在') ? 404 : 400).json(result);
        }
        res.json(result);
    }
    catch (error) {
        console.error('更新服务器错误:', error);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.updateServer = updateServer;
const deleteServer = async (req, res) => {
    try {
        const serverId = req.params.id;
        const userId = req.user?.id;
        const result = await serverService_1.default.deleteServer(serverId, userId);
        if (!result.success) {
            return res.status(result.message.includes('不存在') ? 404 : 400).json(result);
        }
        res.json(result);
    }
    catch (error) {
        console.error('删除服务器错误:', error);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.deleteServer = deleteServer;
const connectServer = async (req, res) => {
    try {
        const serverId = req.params.id;
        await serverService_1.default.incrementConnectionCount(serverId);
        res.json({ success: true, message: '连接计数已更新' });
    }
    catch (error) {
        console.error('更新连接次数错误:', error);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.connectServer = connectServer;
exports.default = {
    getUserServers: exports.getUserServers,
    getServer: exports.getServer,
    createServer: exports.createServer,
    updateServer: exports.updateServer,
    deleteServer: exports.deleteServer,
    connectServer: exports.connectServer
};
