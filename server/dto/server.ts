import { Type, type Static } from '@sinclair/typebox';

export const CreateServerSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  host: Type.String(),
  port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  username: Type.String(),
  password: Type.Optional(Type.String()),
  privateKey: Type.Optional(Type.String()),
  usePrivateKey: Type.Optional(Type.Boolean()),
  description: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String()))
});

export type CreateServerDto = Static<typeof CreateServerSchema>;

export const UpdateServerSchema = Type.Partial(CreateServerSchema);
export type UpdateServerDto = Static<typeof UpdateServerSchema>;

