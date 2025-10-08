"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Validator = void 0;
const ajv_1 = __importDefault(require("ajv"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
class Validator {
    static getInstance() {
        if (!this.ajv) {
            const ajv = new ajv_1.default({
                allErrors: true,
                coerceTypes: true,
                allowUnionTypes: true,
                removeAdditional: 'failing'
            });
            (0, ajv_formats_1.default)(ajv);
            this.ajv = ajv;
        }
        return this.ajv;
    }
}
exports.Validator = Validator;
Validator.ajv = null;
