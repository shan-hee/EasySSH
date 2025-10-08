"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logoutAllDevices = exports.changePassword = exports.updateUser = exports.getCurrentUser = exports.logout = exports.login = exports.adminExists = exports.register = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const userService_1 = __importDefault(require("../services/userService"));
const User = require('../models/User');
const register = async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
        const result = await userService_1.default.registerUserFirstAdminAtomic({
            username,
            email: req.body.email || null,
            password,
            profile: req.body.profile || {},
            settings: req.body.settings || {}
        });
        if (!result.success)
            return res.status(400).json(result);
        res.status(201).json(result);
    }
    catch (e) {
        console.error('注册处理错误:', e);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.register = register;
const adminExists = async (_req, res) => {
    try {
        const count = User.countAdmins();
        return res.json({ success: true, adminExists: count > 0 });
    }
    catch (e) {
        console.error('检查管理员存在性错误:', e);
        return res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.adminExists = adminExists;
const login = async (req, res) => {
    try {
        const { username, password, mfaCode, isMfaVerification } = req.body;
        if (isMfaVerification) {
            let userToVerify = username;
            if (!userToVerify && req.headers.authorization) {
                try {
                    const token = req.headers.authorization.split(' ')[1];
                    if (token) {
                        const secretKey = process.env.JWT_SECRET || 'your-secret-key';
                        const decoded = jsonwebtoken_1.default.verify(token, secretKey);
                        if (decoded?.userId) {
                            const user = await userService_1.default.getUserById(decoded.userId);
                            if (user && user.username)
                                userToVerify = user.username;
                        }
                    }
                }
                catch (e) {
                    console.error('从令牌获取用户信息失败:', e);
                }
            }
            if (!userToVerify || !mfaCode)
                return res.status(400).json({ success: false, message: 'MFA验证需要用户名和验证码' });
            const result = await userService_1.default.verifyMfa(userToVerify, mfaCode);
            if (!result.success)
                return res.status(401).json(result);
            const operation = req.body.operation;
            if (operation === 'disable') {
                result.operation = 'disable';
                result.operationAllowed = true;
            }
            res.json(result);
            return;
        }
        if (!username || !password)
            return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
        const result = await userService_1.default.loginUser(username, password);
        if (!result.success)
            return res.status(401).json(result);
        res.json(result);
    }
    catch (e) {
        console.error('登录处理错误:', e);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.login = login;
const logout = async (req, res) => {
    try {
        const userId = req.user.id;
        const token = req.token;
        const result = await userService_1.default.logoutUser(userId, token);
        res.json(result);
    }
    catch (e) {
        console.error('登出处理错误:', e);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.logout = logout;
const getCurrentUser = async (req, res) => {
    try {
        res.json({ success: true, user: req.user });
    }
    catch (e) {
        console.error('获取用户信息错误:', e);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.getCurrentUser = getCurrentUser;
const updateUser = async (req, res) => {
    try {
        const userId = req.user.id;
        const userData = { ...req.body };
        const passwordUpdate = {};
        if (userData.oldPassword && userData.newPassword) {
            passwordUpdate.oldPassword = userData.oldPassword;
            passwordUpdate.newPassword = userData.newPassword;
            delete userData.oldPassword;
            delete userData.newPassword;
        }
        delete userData.password;
        delete userData._id;
        delete userData.isAdmin;
        if (passwordUpdate.oldPassword && passwordUpdate.newPassword) {
            const passwordResult = await userService_1.default.changePassword(userId, passwordUpdate.oldPassword, passwordUpdate.newPassword);
            if (!passwordResult.success)
                return res.status(400).json(passwordResult);
        }
        const result = await userService_1.default.updateUser(userId, userData);
        if (!result.success)
            return res.status(400).json(result);
        res.json(result);
    }
    catch (e) {
        console.error('更新用户信息错误:', e);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.updateUser = updateUser;
const changePassword = async (req, res) => {
    try {
        const userId = req.user.id;
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword)
            return res.status(400).json({ success: false, message: '当前密码和新密码不能为空' });
        const result = await userService_1.default.changePassword(userId, oldPassword, newPassword);
        if (!result.success)
            return res.status(400).json(result);
        res.json(result);
    }
    catch (e) {
        console.error('密码更改错误:', e);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.changePassword = changePassword;
const logoutAllDevices = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await userService_1.default.logoutAllDevices(userId);
        res.json(result);
    }
    catch (e) {
        console.error('注销所有设备错误:', e);
        res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
    }
};
exports.logoutAllDevices = logoutAllDevices;
exports.default = {
    register: exports.register,
    adminExists: exports.adminExists,
    login: exports.login,
    logout: exports.logout,
    getCurrentUser: exports.getCurrentUser,
    updateUser: exports.updateUser,
    changePassword: exports.changePassword,
    logoutAllDevices: exports.logoutAllDevices
};
