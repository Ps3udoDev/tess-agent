import type { FastifyInstance } from 'fastify';
import { leadRequestSchema } from '@teams4soft/tess-types/api';
import { resolveProject } from '../domain/conversations/resolve-project.js';
import { fusionarLead, type LeadRow } from '../domain/leads/upsert-lead.js';

interface ProjectParams {
  projectId: string;
}

export async function leadsRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: ProjectParams }>(
    '/v1/projects/:projectId/me',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const client = app.userClient(request.auth.token);
      const proyecto = await resolveProject(client, request.params.projectId);

      if (!proyecto) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Proyecto no disponible.',
          retryable: false,
        });
      }

      // is_project_member es la función de 0006. Se invoca con el JWT del
      // usuario, así que responde sobre él y no sobre otro.
      const { data: esMiembro } = await client.rpc('is_project_member', {
        p_project_id: proyecto.projectId,
      });

      const { data: lead } = await client
        .from('leads')
        .select('email, full_name')
        .eq('project_id', proyecto.projectId)
        .eq('auth_user_id', request.auth.userId)
        .maybeSingle();

      const settings = await app.readWidgetSettingsByProject(proyecto.projectId);

      return reply.send({
        userId: request.auth.userId,
        isAnonymous: request.auth.isAnonymous,
        isProjectMember: esMiembro === true,
        lead: lead ? { email: lead.email, fullName: lead.full_name } : null,
        collectLeadsFromMembers: settings?.collect_leads_from_members ?? false,
      });
    },
  );

  app.post<{ Params: ProjectParams }>(
    '/v1/projects/:projectId/leads',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = leadRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          code: 'invalid_request',
          message: 'Se requiere correo o nombre.',
          retryable: false,
        });
      }

      const client = app.userClient(request.auth.token);
      const proyecto = await resolveProject(client, request.params.projectId);

      if (!proyecto) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Proyecto no disponible.',
          retryable: false,
        });
      }

      const { data: anterior } = await client
        .from('leads')
        .select('email, full_name, consent_at')
        .eq('project_id', proyecto.projectId)
        .eq('auth_user_id', request.auth.userId)
        .maybeSingle();

      const fusionado = fusionarLead(anterior as LeadRow | null, parsed.data);

      // organization_id lo deriva el trigger leads_set_organization. Se manda
      // el del proyecto resuelto solo para satisfacer el NOT NULL.
      const { data, error } = await client
        .from('leads')
        .upsert(
          {
            organization_id: proyecto.organizationId,
            project_id: proyecto.projectId,
            auth_user_id: request.auth.userId,
            ...fusionado,
          },
          { onConflict: 'project_id,auth_user_id' },
        )
        .select('id')
        .single();

      if (error || !data) {
        return reply.code(404).send({
          code: 'project_not_found',
          message: 'Proyecto no disponible.',
          retryable: false,
        });
      }

      return reply.code(anterior ? 200 : 201).send({ leadId: data.id });
    },
  );
}
