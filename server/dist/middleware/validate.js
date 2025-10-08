"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const validator_factory_1 = require("../utils/validator-factory");
const validate = (schema) => (req, res, next) => {
    try {
        const ajv = validator_factory_1.Validator.getInstance();
        const valid = ajv.validate(schema, req.body);
        if (!valid) {
            return res.status(400).json({ message: '请求参数错误', errors: ajv.errors });
        }
        return next();
    }
    catch (e) {
        return res.status(400).json({ message: '请求参数校验异常', error: e.message });
    }
};
exports.validate = validate;
exports.default = exports.validate;
