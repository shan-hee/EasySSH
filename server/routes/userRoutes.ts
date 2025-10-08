import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as userController from '../controllers/userController';
const { rateLimit } = require('../middleware/rateLimit');
const { authMiddleware } = require('../middleware/auth');
import validate from '../middleware/validate';
import { RegisterSchema, type RegisterDto, LoginSchema, type LoginDto, UpdateUserSchema, type UpdateUserDto, ChangePasswordSchema, type ChangePasswordDto } from '../dto/user';

const router = Router();

// 公开路由（带基础防滥用速率限制）
router.get('/admin-exists', rateLimit({ windowMs: 60 * 1000, max: 60 }) as RequestHandler, userController.adminExists as RequestHandler);
router.post(
  '/register',
  rateLimit({ windowMs: 60 * 1000, max: 10 }) as RequestHandler,
  validate(RegisterSchema),
  ((req: Request<{}, any, RegisterDto>, res: Response) => userController.register(req as any, res)) as unknown as RequestHandler
);

router.post(
  '/login',
  validate(LoginSchema),
  ((req: Request<{}, any, LoginDto>, res: Response) => userController.login(req as any, res)) as unknown as RequestHandler
);
// MFA 验证
router.post(
  '/verify-mfa',
  validate(LoginSchema),
  ((req: Request<{}, any, LoginDto>, res: Response) => userController.login(req as any, res)) as unknown as RequestHandler
);

// 需要身份验证的路由
router.get('/me', authMiddleware as RequestHandler, userController.getCurrentUser as RequestHandler);

router.use(authMiddleware as RequestHandler);

router.post('/logout', userController.logout as RequestHandler);
router.post('/logout-all-devices', userController.logoutAllDevices as RequestHandler);

router.put(
  '/me',
  validate(UpdateUserSchema),
  ((req: Request<{}, any, UpdateUserDto>, res: Response) => userController.updateUser(req as any, res)) as unknown as RequestHandler
);

router.post(
  '/change-password',
  validate(ChangePasswordSchema),
  ((req: Request<{}, any, ChangePasswordDto>, res: Response) => userController.changePassword(req as any, res)) as unknown as RequestHandler
);

export default router;
