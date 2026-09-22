import { describe, expect, it } from 'vitest';
import {
  chatMessageSchema,
  documentSummarySchema,
  httpStatusForError,
  leadRequestSchema,
  sendMessageRequestSchema,
  visitorSessionRequestSchema,
} from './api.js';

describe('sendMessageRequestSchema', () => {
  it('acepta un mensaje normal', () => {
    expect(sendMessageRequestSchema.parse({ content: 'hola' }).content).toBe('hola');
  });

  it('rechaza el mensaje vacío y el que pasa de 4000', () => {
    expect(sendMessageRequestSchema.safeParse({ content: '' }).success).toBe(false);
    expect(sendMessageRequestSchema.safeParse({ content: 'a'.repeat(4001) }).success).toBe(false);
  });
});

describe('leadRequestSchema', () => {
  it('exige al menos email o fullName', () => {
    expect(leadRequestSchema.safeParse({}).success).toBe(false);
    expect(leadRequestSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(leadRequestSchema.safeParse({ fullName: 'Ana' }).success).toBe(true);
  });

  it('normaliza el correo a minúsculas y sin espacios', () => {
    expect(leadRequestSchema.parse({ email: '  A@B.CO ' }).email).toBe('a@b.co');
  });
});

describe('visitorSessionRequestSchema', () => {
  it('exige el prefijo pk_', () => {
    expect(visitorSessionRequestSchema.safeParse({ publicKey: 'nope' }).success).toBe(false);
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

describe('esquemas de documentos', () => {
  it('acepta un resumen de documento fallido con su razón', () => {
    const resultado = documentSummarySchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Roto.pdf',
      status: 'failed',
      failureReason: 'sin texto extraíble; ¿es un PDF escaneado?',
      createdAt: '2026-09-19T00:00:00.000Z',
    });

    expect(resultado.success).toBe(true);
  });

  it('failureReason puede ser null', () => {
    const resultado = documentSummarySchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Bien.pdf',
      status: 'ready',
      failureReason: null,
      createdAt: '2026-09-19T00:00:00.000Z',
    });

    expect(resultado.success).toBe(true);
  });

  it('rechaza un estado que no existe', () => {
    const resultado = documentSummarySchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      title: 'x',
      status: 'inventado',
      failureReason: null,
      createdAt: '2026-09-19T00:00:00.000Z',
    });

    expect(resultado.success).toBe(false);
  });
});

describe('citas en el historial', () => {
  it('chatMessageSchema acepta sources', () => {
    // Al recargar el historial, las citas tienen que volver.
    const resultado = chatMessageSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000002',
      role: 'assistant',
      content: 'Ofrecemos migración.',
      createdAt: '2026-09-19T00:00:00.000Z',
      sources: [
        {
          documentId: '00000000-0000-4000-8000-000000000003',
          sectionId: '00000000-0000-4000-8000-000000000004',
          title: 'Guía',
        },
      ],
    });

    expect(resultado.success).toBe(true);
  });

  it('sources es opcional: un mensaje de F2 sigue validando', () => {
    const resultado = chatMessageSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000002',
      role: 'user',
      content: 'hola',
      createdAt: '2026-09-19T00:00:00.000Z',
    });

    expect(resultado.success).toBe(true);
  });
});
