import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import userService from '../services/userService';
const User = require('../models/User');

export const register = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as any;
    if (!username || !password) return res.status(400).json({ success: false, message: '用户名和密码不能为空' });

    const result = await userService.registerUserFirstAdminAtomic({
      username,
      email: (req.body as any).email || null,
      password,
      profile: (req.body as any).profile || {},
      settings: (req.body as any).settings || {}
    });
    if (!result.success) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (e) {
    console.error('注册处理错误:', e);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const adminExists = async (_req: Request, res: Response) => {
  try {
    const count = (User as any).countAdmins();
    return res.json({ success: true, adminExists: count > 0 });
  } catch (e) {
    console.error('检查管理员存在性错误:', e);
    return res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password, mfaCode, isMfaVerification } = req.body as any;
    if (isMfaVerification) {
      let userToVerify = username;
      if (!userToVerify && req.headers.authorization) {
        try {
          const token = (req.headers.authorization as string).split(' ')[1];
          if (token) {
            const secretKey = process.env.JWT_SECRET || 'your-secret-key';
            const decoded: any = jwt.verify(token, secretKey);
            if (decoded?.userId) {
              const user = await userService.getUserById(decoded.userId);
              if (user && (user as any).username) userToVerify = (user as any).username;
            }
          }
        } catch (e) {
          console.error('从令牌获取用户信息失败:', e);
        }
      }
      if (!userToVerify || !mfaCode) return res.status(400).json({ success: false, message: 'MFA验证需要用户名和验证码' });
      const result = await userService.verifyMfa(userToVerify, mfaCode);
      if (!result.success) return res.status(401).json(result);
      const operation = (req.body as any).operation;
      if (operation === 'disable') {
        (result as any).operation = 'disable';
        (result as any).operationAllowed = true;
      }
      res.json(result);
      return;
    }

    if (!username || !password) return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    const result = await userService.loginUser(username, password);
    if (!result.success) return res.status(401).json(result);
    res.json(result);
  } catch (e) {
    console.error('登录处理错误:', e);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id as string;
    const token = (req as any).token as string;
    const result = await userService.logoutUser(userId, token);
    res.json(result);
  } catch (e) {
    console.error('登出处理错误:', e);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, user: (req as any).user });
  } catch (e) {
    console.error('获取用户信息错误:', e);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id as string;
    const userData = { ...(req.body as any) };
    const passwordUpdate: any = {};
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
      const passwordResult = await userService.changePassword(userId, passwordUpdate.oldPassword, passwordUpdate.newPassword);
      if (!passwordResult.success) return res.status(400).json(passwordResult);
    }

    const result = await userService.updateUser(userId, userData);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    console.error('更新用户信息错误:', e);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id as string;
    const { oldPassword, newPassword } = (req.body as any);
    if (!oldPassword || !newPassword) return res.status(400).json({ success: false, message: '当前密码和新密码不能为空' });
    const result = await userService.changePassword(userId, oldPassword, newPassword);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    console.error('密码更改错误:', e);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const logoutAllDevices = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id as string;
    const result = await userService.logoutAllDevices(userId);
    res.json(result);
  } catch (e) {
    console.error('注销所有设备错误:', e);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export default {
  register,
  adminExists,
  login,
  logout,
  getCurrentUser,
  updateUser,
  changePassword,
  logoutAllDevices
};
