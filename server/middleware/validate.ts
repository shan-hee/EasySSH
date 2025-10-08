import type { RequestHandler } from 'express';
import type { TSchema } from '@sinclair/typebox';
import { Validator } from '../utils/validator-factory';

export const validate = (schema: TSchema): RequestHandler => (req, res, next) => {
  try {
    const ajv = Validator.getInstance();
    const valid = ajv.validate(schema as any, req.body);
    if (!valid) {
      return res.status(400).json({ message: '请求参数错误', errors: ajv.errors });
    }
    return next();
  } catch (e) {
    return res.status(400).json({ message: '请求参数校验异常', error: (e as Error).message });
  }
};

export default validate;

