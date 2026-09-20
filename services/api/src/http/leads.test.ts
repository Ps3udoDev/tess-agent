import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { fusionarLead } from '../domain/leads/upsert-lead.js';

describe('fusionarLead', () => {
  it('conserva el campo que no se reenvía', () => {
    const anterior = { email: 'ana@example.com', full_name: 'Ana' };
    const fusionado = fusionarLead(anterior, { email: 'ana2@example.com' });

    expect(fusionado.email).toBe('ana2@example.com');
    expect(fusionado.full_name).toBe('Ana');
  });

  it('acepta el primer lead sin anterior', () => {
    const fusionado = fusionarLead(null, { fullName: 'Beto' });

    expect(fusionado.full_name).toBe('Beto');
    expect(fusionado.email).toBeNull();
  });

  it('sella consent_at solo la primera vez', () => {
    const primero = fusionarLead(null, { email: 'a@b.co' });
    expect(primero.consent_at).not.toBeNull();

    const segundo = fusionarLead(
      {
        email: 'a@b.co',
        full_name: null,
        consent_at: '2026-01-01T00:00:00.000Z',
      },
      { fullName: 'Ana' },
    );
    expect(segundo.consent_at).toBe('2026-01-01T00:00:00.000Z');
  });
});

const PROYECTO = '11111111-1111-1111-1111-111111111111';

function mockUserClient(proyecto: unknown, lead: unknown = null, esMiembro = false) {
  return {
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: '33333333-3333-3333-3333-333333333333',
            is_anonymous: true,
          },
        },
        error: null,
      }),
    },
    from(tabla: string) {
      if (tabla === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: proyecto, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: lead, error: null }),
            }),
          }),
        }),
        upsert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: '77777777-7777-7777-7777-777777777777' },
              error: null,
            }),
          }),
        }),
      };
    },
    rpc: async () => ({ data: esMiembro, error: null }),
  };
}

describe('GET /v1/projects/:projectId/me', () => {
  it('devuelve 404 si el proyecto no existe', async () => {
    const app = await buildApp();
    vi.spyOn(app, 'userClient').mockReturnValue(mockUserClient(null) as never);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${PROYECTO}/me`,
      headers: { authorization: 'Bearer t' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('project_not_found');

    await app.close();
  });

  it('devuelve estado del usuario, membresía y lead existente', async () => {
    const app = await buildApp();
    vi.spyOn(app, 'userClient').mockReturnValue(
      mockUserClient(
        { id: PROYECTO, organization_id: '22222222-2222-2222-2222-222222222222' },
        { email: 'lead@example.com', full_name: 'Lead Name' },
        false,
      ) as never,
    );

    vi.spyOn(app, 'readWidgetSettingsByProject').mockResolvedValue({
      project_id: PROYECTO,
      organization_id: '22222222-2222-2222-2222-222222222222',
      allowed_origins: ['https://example.com'],
      visitor_access: true,
      collect_leads_from_members: true,
      greeting: 'Hola!',
    });

    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${PROYECTO}/me`,
      headers: { authorization: 'Bearer t' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userId).toBe('33333333-3333-3333-3333-333333333333');
    expect(body.isAnonymous).toBe(true);
    expect(body.isProjectMember).toBe(false);
    expect(body.lead).toEqual({ email: 'lead@example.com', fullName: 'Lead Name' });
    expect(body.collectLeadsFromMembers).toBe(true);

    await app.close();
  });
});

describe('POST /v1/projects/:projectId/leads', () => {
  it('valida que venga al menos email o fullName', async () => {
    const app = await buildApp();
    vi.spyOn(app, 'userClient').mockReturnValue(mockUserClient(null) as never);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROYECTO}/leads`,
      headers: { authorization: 'Bearer t' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_request');

    await app.close();
  });

  it('crea el lead cuando los datos son válidos', async () => {
    const app = await buildApp();
    vi.spyOn(app, 'userClient').mockReturnValue(
      mockUserClient(
        { id: PROYECTO, organization_id: '22222222-2222-2222-2222-222222222222' },
        null,
      ) as never,
    );
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROYECTO}/leads`,
      headers: { authorization: 'Bearer t' },
      payload: { email: 'nuevo@example.com' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().leadId).toBe('77777777-7777-7777-7777-777777777777');

    await app.close();
  });
});
