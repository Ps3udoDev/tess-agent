/**
 * Fusión de leads.
 *
 * Un upsert que no destruye: si el usuario reenvía solo el correo, el nombre
 * anterior se conserva. Nunca un update que escriba nulos encima de lo que ya
 * había.
 */
export interface LeadRow {
  email: string | null;
  full_name: string | null;
  consent_at?: string | null | undefined;
}

export interface LeadPayload {
  email?: string | undefined;
  fullName?: string | undefined;
  attribution?: Record<string, string> | undefined;
}

export interface LeadMerged {
  email: string | null;
  full_name: string | null;
  consent_at: string | null;
  metadata: Record<string, string>;
}

export function fusionarLead(
  anterior: LeadRow | null,
  entrante: LeadPayload,
  ahora: () => string = () => new Date().toISOString(),
): LeadMerged {
  return {
    email: entrante.email ?? anterior?.email ?? null,
    full_name: entrante.fullName ?? anterior?.full_name ?? null,
    // El consentimiento se sella una vez: es el momento en que la persona
    // aceptó, no el del último formulario que envió.
    consent_at: anterior?.consent_at ?? ahora(),
    metadata: entrante.attribution ?? {},
  };
}
