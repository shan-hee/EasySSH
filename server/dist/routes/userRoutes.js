"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const userController = __importStar(require("../controllers/userController"));
const { rateLimit } = require('../middleware/rateLimit');
const { authMiddleware } = require('../middleware/auth');
const validate_1 = __importDefault(require("../middleware/validate"));
const user_1 = require("../dto/user");
const router = (0, express_1.Router)();
// 公开路由（带基础防滥用速率限制）
router.get('/admin-exists', rateLimit({ windowMs: 60 * 1000, max: 60 }), userController.adminExists);
router.post('/register', rateLimit({ windowMs: 60 * 1000, max: 10 }), (0, validate_1.default)(user_1.RegisterSchema), ((req, res) => userController.register(req, res)));
router.post('/login', (0, validate_1.default)(user_1.LoginSchema), ((req, res) => userController.login(req, res)));
// MFA 验证
router.post('/verify-mfa', (0, validate_1.default)(user_1.LoginSchema), ((req, res) => userController.login(req, res)));
// 需要身份验证的路由
router.get('/me', authMiddleware, userController.getCurrentUser);
router.use(authMiddleware);
router.post('/logout', userController.logout);
router.post('/logout-all-devices', userController.logoutAllDevices);
router.put('/me', (0, validate_1.default)(user_1.UpdateUserSchema), ((req, res) => userController.updateUser(req, res)));
router.post('/change-password', (0, validate_1.default)(user_1.ChangePasswordSchema), ((req, res) => userController.changePassword(req, res)));
exports.default = router;
