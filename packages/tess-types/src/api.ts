/**
 * Esquemas de request y response de la API de Tess.
 *
 * Vive en un entry point propio (`@teams4soft/tess-types/api`) y NO se
 * reexporta desde `index.ts`: el web component importa valores en runtime de
 * la raíz, y arrastrar zod a su bundle lo engordaría sin necesidad.
 */
import { z } from 'zod';
import { ASSISTANT_STATES } from './assistant.js';

export const TESS_ERROR_CODES = [
  'unauthorized',
  'forbidden_origin',
  'project_not_found',
  'invalid_request',
  'rate_limited',
  'model_unavailable',
  'internal',
] as const;

export type TessErrorCode = (typeof TESS_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<TessErrorCode, number> = {
  unauthorized: 401,
  forbidden_origin: 403,
  project_not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  model_unavailable: 502,
  internal: 500,
};

export function httpStatusForError(code: TessErrorCode): number {
  return STATUS_BY_CODE[code];
}

/** `message` es texto para humanos: nunca lleva detalle interno. */
export const tessErrorSchema = z.object({
  code: z.enum(TESS_ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
});

export const visitorSessionRequestSchema = z.object({
  publicKey: z.string().regex(/^pk_[a-zA-Z0-9_]{16,}$/),
});

export const visitorSessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number().int(),
  userId: z.uuid(),
  projectId: z.uuid(),
  greeting: z.string().nullable(),
});

export const createConversationRequestSchema = z.object({
  locale: z.string().max(35).optional(),
});

export const sendMessageRequestSchema = z.object({
  content: z.string().min(1).max(4000),
  locale: z.string().max(35).optional(),
});

/** Atribución de la landing: landing_url, referrer, utm_*. */
const attributionSchema = z.record(z.string(), z.string().max(2048)).optional();

export const leadRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    fullName: z.string().trim().min(1).max(200).optional(),
    attribution: attributionSchema,
  })
  .refine((v) => v.email !== undefined || v.fullName !== undefined, {
    message: 'se requiere email o fullName',
  });

export const viewerResponseSchema = z.object({
  userId: z.uuid(),
  isAnonymous: z.boolean(),
  isProjectMember: z.boolean(),
  lead: z
    .object({ email: z.string().nullable(), fullName: z.string().nullable() })
    .nullable(),
  collectLeadsFromMembers: z.boolean(),
});

export const chatMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.iso.datetime(),
  incomplete: z.boolean().optional(),
});

export const assistantStateSchema = z.enum(ASSISTANT_STATES);
