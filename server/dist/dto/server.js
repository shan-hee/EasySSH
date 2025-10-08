"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateServerSchema = exports.CreateServerSchema = void 0;
const typebox_1 = require("@sinclair/typebox");
exports.CreateServerSchema = typebox_1.Type.Object({
    name: typebox_1.Type.String({ minLength: 1 }),
    host: typebox_1.Type.String(),
    port: typebox_1.Type.Optional(typebox_1.Type.Integer({ minimum: 1, maximum: 65535 })),
    username: typebox_1.Type.String(),
    password: typebox_1.Type.Optional(typebox_1.Type.String()),
    privateKey: typebox_1.Type.Optional(typebox_1.Type.String()),
    usePrivateKey: typebox_1.Type.Optional(typebox_1.Type.Boolean()),
    description: typebox_1.Type.Optional(typebox_1.Type.String()),
    tags: typebox_1.Type.Optional(typebox_1.Type.Array(typebox_1.Type.String()))
});
exports.UpdateServerSchema = typebox_1.Type.Partial(exports.CreateServerSchema);
