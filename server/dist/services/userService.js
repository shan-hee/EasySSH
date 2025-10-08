"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const otplib_1 = require("otplib");
const User = require('../models/User');
const { getCache, connectDatabase } = require('../config/database');
const logger = require('../utils/logger');
const cache = getCache();
class UserService {
    async getUserById(userId) {
        const userKey = `user:${userId}`;
        const cached = cache.get(userKey);
        if (cached)
            return cached;
        const user = await User.findById(userId);
        if (!user)
            return null;
        const safe = user.toSafeObject();
        cache.set(userKey, safe, 86400);
        return safe;
    }
    async registerUser(userData) {
        try {
            const existingUsername = await User.findOne({ username: userData.username });
            if (existingUsername)
                return { success: false, message: '用户名已被使用' };
            if (userData.email) {
                const existingEmail = await User.findOne({ email: userData.email });
                if (existingEmail)
                    return { success: false, message: '邮箱已被注册' };
            }
            const user = new User(userData);
            user.setPassword(userData.password);
            await user.save();
            const token = await this.generateToken(user.id);
            await this.createUserSession(String(user.id), token);
            return { success: true, message: '注册成功', user: user.toSafeObject(), token };
        }
        catch (e) {
            logger.error('用户注册失败', e);
            return { success: false, message: `注册失败: ${e.message}` };
        }
    }
    async registerUserFirstAdminAtomic(userData) {
        const db = connectDatabase();
        try {
            db.exec('BEGIN IMMEDIATE');
            const existingUsername = await User.findOne({ username: userData.username });
            if (existingUsername) {
                db.exec('ROLLBACK');
                return { success: false, message: '用户名已被使用' };
            }
            if (userData.email) {
                const existingEmail = await User.findOne({ email: userData.email });
                if (existingEmail) {
                    db.exec('ROLLBACK');
                    return { success: false, message: '邮箱已被注册' };
                }
            }
            const adminCountRow = db.prepare('SELECT COUNT(*) AS count FROM users WHERE isAdmin = 1').get();
            const isFirstAdmin = adminCountRow && adminCountRow.count === 0;
            const user = new User({
                username: userData.username,
                email: userData.email || null,
                password: userData.password,
                profileData: userData.profile || {},
                settingsData: userData.settings || {},
                isAdmin: isFirstAdmin ? true : false,
                status: 'active'
            });
            user.setPassword(userData.password);
            await user.save();
            db.exec('COMMIT');
            const token = await this.generateToken(user.id);
            await this.createUserSession(String(user.id), token);
            return { success: true, message: '注册成功', user: user.toSafeObject(), token };
        }
        catch (e) {
            try {
                db.exec('ROLLBACK');
            }
            catch { }
            logger.error('原子化用户注册失败', e);
            return { success: false, message: `注册失败: ${e.message}` };
        }
    }
    async loginUser(username, password) {
        try {
            const user = await User.findOne({ username });
            if (!user)
                return { success: false, message: '用户不存在' };
            const isMatch = await user.comparePassword(password);
            if (!isMatch)
                return { success: false, message: '密码错误' };
            if (user.status !== 'active')
                return { success: false, message: '账户已禁用，请联系管理员' };
            user.lastLogin = new Date().toISOString();
            await user.save();
            const token = this.generateToken(user.id);
            cache.set(`test:${Date.now()}`, { test: true, timestamp: Date.now() }, 60);
            await this.createUserSession(String(user.id), token);
            const needMfa = !!user.mfaEnabled;
            logger.info('用户登录信息', { userId: user.id, username: user.username, needMfa });
            return { success: true, message: '登录成功', user: user.toSafeObject(), token };
        }
        catch (e) {
            logger.error('用户登录失败', e);
            return { success: false, message: `登录失败: ${e.message}` };
        }
    }
    async createUserSession(userId, token) {
        try {
            const tokenKey = `token:${token}`;
            const sessionData = { userId, valid: true };
            let cacheTimeSeconds = process.env.TOKEN_EXPIRES_IN;
            if (typeof cacheTimeSeconds === 'string') {
                try {
                    cacheTimeSeconds = eval(cacheTimeSeconds);
                }
                catch {
                    cacheTimeSeconds = parseInt(cacheTimeSeconds, 10);
                }
            }
            if (!cacheTimeSeconds || isNaN(cacheTimeSeconds))
                cacheTimeSeconds = 48 * 60 * 60;
            cache.set(tokenKey, sessionData, cacheTimeSeconds);
            const userSessionsKey = `user:sessions:${userId}`;
            const list = cache.get(userSessionsKey) || [];
            list.push(token);
            cache.set(userSessionsKey, list, 30 * 24 * 60 * 60);
            return true;
        }
        catch (e) {
            logger.error('创建用户会话失败', e);
            return false;
        }
    }
    async verifyToken(token) {
        try {
            const secretKey = process.env.JWT_SECRET || 'your-secret-key';
            const decoded = jsonwebtoken_1.default.verify(token, secretKey);
            const tokenKey = `token:${token}`;
            const session = cache.get(tokenKey);
            if (!session || !session.valid || String(session.userId) !== String(decoded.userId)) {
                if (session && session.remoteLogout)
                    return { valid: false, error: 'remote-logout' };
                return { valid: false };
            }
            const user = await this.getUserById(decoded.userId);
            if (!user)
                return { valid: false };
            return { valid: true, user };
        }
        catch (e) {
            logger.debug('令牌验证失败', { error: e.message, tokenLength: token.length });
            return { valid: false, error: e.message };
        }
    }
    async logoutUser(userId, token) {
        try {
            const tokenKey = `token:${token}`;
            cache.set(tokenKey, { userId, valid: false }, 60);
            const userSessionsKey = `user:sessions:${userId}`;
            const sessions = cache.get(userSessionsKey) || [];
            const filtered = sessions.filter(t => t !== token);
            cache.set(userSessionsKey, filtered, 30 * 24 * 60 * 60);
            return { success: true, message: '注销成功' };
        }
        catch (e) {
            logger.error('用户登出失败', e);
            return { success: false, message: `注销失败: ${e.message}` };
        }
    }
    async verifyMfa(username, code) {
        try {
            const user = await User.findOne({ username });
            if (!user)
                return { success: false, message: '用户不存在' };
            if (!user.mfaEnabled || !user.mfaSecret)
                return { success: false, message: '未启用MFA' };
            const isValid = otplib_1.authenticator.verify({ token: code, secret: user.mfaSecret });
            if (!isValid)
                return { success: false, message: '验证码无效或已过期' };
            const token = this.generateToken(user.id);
            await this.createUserSession(String(user.id), token);
            return { success: true, message: 'MFA验证成功', user: user.toSafeObject(), token };
        }
        catch (e) {
            logger.error('MFA验证失败', e);
            return { success: false, message: `MFA验证失败: ${e.message}` };
        }
    }
    generateToken(userId) {
        let expiresIn = process.env.TOKEN_EXPIRES_IN;
        if (typeof expiresIn === 'string') {
            try {
                expiresIn = eval(expiresIn);
            }
            catch {
                expiresIn = parseInt(expiresIn, 10);
            }
        }
        if (!expiresIn || isNaN(expiresIn))
            expiresIn = 48 * 60 * 60;
        const now = Date.now() / 1000;
        const payload = { userId, iat: now, exp: now + expiresIn };
        return jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET || 'your-secret-key');
    }
    async changePassword(userId, currentPassword, newPassword) {
        try {
            const user = await User.findById(userId);
            if (!user)
                return { success: false, message: '用户不存在' };
            const isMatch = await user.comparePassword(currentPassword);
            if (!isMatch)
                return { success: false, message: '当前密码不正确' };
            user.setPassword(newPassword);
            await user.save();
            cache.del(`user:${userId}`);
            return { success: true, message: '密码更改成功' };
        }
        catch (e) {
            logger.error('密码更改处理失败', e);
            return { success: false, message: `密码更改失败: ${e.message}` };
        }
    }
    async logoutAllDevices(userId) {
        try {
            const userSessionsKey = `user:sessions:${userId}`;
            const sessions = cache.get(userSessionsKey) || [];
            for (const token of sessions) {
                const tokenKey = `token:${token}`;
                cache.set(tokenKey, { userId, valid: false, remoteLogout: true }, 60);
            }
            cache.del(userSessionsKey);
            return { success: true, message: '已成功注销所有设备' };
        }
        catch (e) {
            logger.error('注销所有设备失败', e);
            return { success: false, message: `注销失败: ${e.message}` };
        }
    }
    async updateUser(userId, userData) {
        try {
            const user = await User.findById(userId);
            if (!user)
                return { success: false, message: '用户不存在' };
            const updatable = [
                'email', 'displayName', 'avatar', 'theme', 'fontSize', 'status', 'profileData', 'settingsData', 'mfaEnabled', 'mfaSecret'
            ];
            for (const k of Object.keys(userData)) {
                if (updatable.includes(k))
                    user[k] = userData[k];
            }
            await user.save();
            cache.del(`user:${userId}`);
            return { success: true, message: '更新成功', user: user.toSafeObject() };
        }
        catch (e) {
            logger.error('更新用户失败', e);
            return { success: false, message: `更新失败: ${e.message}` };
        }
    }
}
exports.default = new UserService();
