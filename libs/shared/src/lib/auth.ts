import { z } from 'zod';

/** Trimmed and lower-cased before the format check, so ' Alice@X.com ' is accepted. */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email').max(254));

export const LoginSchema = z.object({
  email,
  password: z.string().min(1, 'Required').max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RegisterSchema = z.object({
  email,
  displayName: z.string().trim().min(1, 'Required').max(100),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export interface User {
  id: number;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}
