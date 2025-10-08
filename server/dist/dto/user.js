"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChangePasswordSchema = exports.UpdateUserSchema = exports.LoginSchema = exports.RegisterSchema = void 0;
const typebox_1 = require("@sinclair/typebox");
exports.RegisterSchema = typebox_1.Type.Object({
    username: typebox_1.Type.String({ minLength: 3 }),
    password: typebox_1.Type.String({ minLength: 6 }),
    email: typebox_1.Type.Optional(typebox_1.Type.String({ format: 'email' })),
    profile: typebox_1.Type.Optional(typebox_1.Type.Record(typebox_1.Type.String(), typebox_1.Type.Any())),
    settings: typebox_1.Type.Optional(typebox_1.Type.Record(typebox_1.Type.String(), typebox_1.Type.Any()))
});
exports.LoginSchema = typebox_1.Type.Object({
    username: typebox_1.Type.Optional(typebox_1.Type.String()),
    password: typebox_1.Type.Optional(typebox_1.Type.String()),
    mfaCode: typebox_1.Type.Optional(typebox_1.Type.String()),
    isMfaVerification: typebox_1.Type.Optional(typebox_1.Type.Boolean()),
    operation: typebox_1.Type.Optional(typebox_1.Type.String())
});
exports.UpdateUserSchema = typebox_1.Type.Partial(typebox_1.Type.Object({
    email: typebox_1.Type.String({ format: 'email' }),
    displayName: typebox_1.Type.String(),
    avatar: typebox_1.Type.String(),
    profile: typebox_1.Type.Record(typebox_1.Type.String(), typebox_1.Type.Any()),
    settings: typebox_1.Type.Record(typebox_1.Type.String(), typebox_1.Type.Any()),
    theme: typebox_1.Type.Union([typebox_1.Type.Literal('dark'), typebox_1.Type.Literal('light'), typebox_1.Type.Literal('system')]),
    fontSize: typebox_1.Type.Integer({ minimum: 10, maximum: 42 }),
    oldPassword: typebox_1.Type.String(),
    newPassword: typebox_1.Type.String()
}));
exports.ChangePasswordSchema = typebox_1.Type.Object({
    oldPassword: typebox_1.Type.String({ minLength: 6 }),
    newPassword: typebox_1.Type.String({ minLength: 6 })
});
