import { Type, type Static } from '@sinclair/typebox';

export const RegisterSchema = Type.Object({
  username: Type.String({ minLength: 3 }),
  password: Type.String({ minLength: 6 }),
  email: Type.Optional(Type.String({ format: 'email' })),
  profile: Type.Optional(Type.Record(Type.String(), Type.Any())),
  settings: Type.Optional(Type.Record(Type.String(), Type.Any()))
});
export type RegisterDto = Static<typeof RegisterSchema>;

export const LoginSchema = Type.Object({
  username: Type.Optional(Type.String()),
  password: Type.Optional(Type.String()),
  mfaCode: Type.Optional(Type.String()),
  isMfaVerification: Type.Optional(Type.Boolean()),
  operation: Type.Optional(Type.String())
});
export type LoginDto = Static<typeof LoginSchema>;

export const UpdateUserSchema = Type.Partial(
  Type.Object({
    email: Type.String({ format: 'email' }),
    displayName: Type.String(),
    avatar: Type.String(),
    profile: Type.Record(Type.String(), Type.Any()),
    settings: Type.Record(Type.String(), Type.Any()),
    theme: Type.Union([Type.Literal('dark'), Type.Literal('light'), Type.Literal('system')]),
    fontSize: Type.Integer({ minimum: 10, maximum: 42 }),
    oldPassword: Type.String(),
    newPassword: Type.String()
  })
);
export type UpdateUserDto = Static<typeof UpdateUserSchema>;

export const ChangePasswordSchema = Type.Object({
  oldPassword: Type.String({ minLength: 6 }),
  newPassword: Type.String({ minLength: 6 })
});
export type ChangePasswordDto = Static<typeof ChangePasswordSchema>;

