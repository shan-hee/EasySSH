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
// 复用现有 CommonJS 控制器（暂不重写）
// 使用命名空间导入以兼容 exports.xxx 的写法
const serverController = __importStar(require("../controllers/serverController"));
const auth_1 = require("../middleware/auth");
const validate_1 = __importDefault(require("../middleware/validate"));
const server_1 = require("../dto/server");
const router = (0, express_1.Router)();
// 身份验证中间件
router.use(auth_1.authMiddleware);
// 获取用户的所有服务器
router.get('/', serverController.getUserServers);
// 创建新服务器（带 DTO 校验）
router.post('/', (0, validate_1.default)(server_1.CreateServerSchema), ((req, res) => serverController.createServer(req, res)));
// 获取单个服务器信息
router.get('/:id', serverController.getServer);
// 更新服务器（带 DTO 校验-部分）
router.put('/:id', (0, validate_1.default)(server_1.UpdateServerSchema), ((req, res) => serverController.updateServer(req, res)));
// 删除服务器
router.delete('/:id', serverController.deleteServer);
// 连接服务器（更新连接计数）
router.post('/:id/connect', serverController.connectServer);
exports.default = router;
