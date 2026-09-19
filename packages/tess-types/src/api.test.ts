import { describe, expect, it } from 'vitest';
import {
  httpStatusForError,
  leadRequestSchema,
  sendMessageRequestSchema,
  visitorSessionRequestSchema,
} from './api.js';

describe('sendMessageRequestSchema', () => {
  it('acepta un mensaje normal', () => {
    expect(sendMessageRequestSchema.parse({ content: 'hola' }).content).toBe(
      'hola',
    );
  });

  it('rechaza el mensaje vacío y el que pasa de 4000', () => {
    expect(sendMessageRequestSchema.safeParse({ content: '' }).success).toBe(
      false,
    );
    expect(
      sendMessageRequestSchema.safeParse({ content: 'a'.repeat(4001) }).success,
    ).toBe(false);
  });
});

describe('leadRequestSchema', () => {
  it('exige al menos email o fullName', () => {
    expect(leadRequestSchema.safeParse({}).success).toBe(false);
    expect(leadRequestSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(leadRequestSchema.safeParse({ fullName: 'Ana' }).success).toBe(true);
  });

  it('normaliza el correo a minúsculas y sin espacios', () => {
    expect(leadRequestSchema.parse({ email: '  A@B.CO ' }).email).toBe(
      'a@b.co',
    );
  });
});

describe('visitorSessionRequestSchema', () => {
  it('exige el prefijo pk_', () => {
    expect(
      visitorSessionRequestSchema.safeParse({ publicKey: 'nope' }).success,
    ).toBe(false);
    expect(
      visitorSessionRequestSchema.safeParse({
        publicKey: 'pk_dev_tess_local_0001',
      }).success,
    ).toBe(true);
  });
});

describe('httpStatusForError', () => {
  it('mapea cada código a su estado', () => {
    expect(httpStatusForError('unauthorized')).toBe(401);
    expect(httpStatusForError('forbidden_origin')).toBe(403);
    expect(httpStatusForError('project_not_found')).toBe(404);
    expect(httpStatusForError('invalid_request')).toBe(400);
    expect(httpStatusForError('rate_limited')).toBe(429);
    expect(httpStatusForError('model_unavailable')).toBe(502);
    expect(httpStatusForError('internal')).toBe(500);
  });
});
