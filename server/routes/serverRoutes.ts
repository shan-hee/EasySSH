import { Router, type Request, type RequestHandler, type Response } from 'express';
// 复用现有 CommonJS 控制器（暂不重写）
// 使用命名空间导入以兼容 exports.xxx 的写法
import * as serverController from '../controllers/serverController';
import { authMiddleware } from '../middleware/auth';
import validate from '../middleware/validate';
import { CreateServerSchema, type CreateServerDto, UpdateServerSchema, type UpdateServerDto } from '../dto/server';

const router = Router();

// 身份验证中间件
router.use(authMiddleware as RequestHandler);

// 获取用户的所有服务器
router.get('/', serverController.getUserServers as RequestHandler);

// 创建新服务器（带 DTO 校验）
router.post(
  '/',
  validate(CreateServerSchema),
  (((req: Request<{}, any, CreateServerDto>, res: Response) => serverController.createServer(req as any, res)) as unknown) as RequestHandler
);

// 获取单个服务器信息
router.get('/:id', serverController.getServer as RequestHandler);

// 更新服务器（带 DTO 校验-部分）
router.put(
  '/:id',
  validate(UpdateServerSchema),
  (((req: Request<{ id: string }, any, UpdateServerDto>, res: Response) => serverController.updateServer(req as any, res)) as unknown) as RequestHandler
);

// 删除服务器
router.delete('/:id', serverController.deleteServer as RequestHandler);

// 连接服务器（更新连接计数）
router.post('/:id/connect', serverController.connectServer as RequestHandler);

export default router;
