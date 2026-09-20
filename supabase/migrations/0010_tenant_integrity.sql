-- =============================================================================
-- 0010 · Integridad de tenant
--
-- Las columnas `organization_id` y `project_id` están denormalizadas para que
-- RLS pueda filtrar sin joins, pero eso solo es seguro si son ciertas. Aquí se
-- derivan de la fila padre en vez de aceptarse del cliente, que es la misma
-- disciplina que 0008 aplica a `leads`.
--
-- Las funciones son `security invoker` a propósito: si el llamante no puede
-- ver el proyecto o la conversación, la derivación falla y el insert se
-- rechaza. Fallar cerrado es el comportamiento correcto.
-- =============================================================================

create or replace function public.project_widget_settings_set_organization()
returns trigger language plpgsql set search_path = '' as $$
begin
  select p.organization_id into new.organization_id
  from public.projects p where p.id = new.project_id;

  if new.organization_id is null then
    raise exception 'proyecto % inexistente o inaccesible', new.project_id;
  end if;

  return new;
end;
$$;

create trigger project_widget_settings_set_organization_trigger
  before insert or update of project_id on public.project_widget_settings
  for each row execute function public.project_widget_settings_set_organization();

-- -----------------------------------------------------------------------------
-- Un lead pertenece al proyecto donde se capturó. Moverlo no es una operación
-- legítima, y era la vía del hallazgo 2.
create or replace function public.leads_forbid_project_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'un lead no puede cambiar de proyecto';
  end if;

  return new;
end;
$$;

create trigger leads_forbid_project_change_trigger
  before update on public.leads
  for each row execute function public.leads_forbid_project_change();

-- -----------------------------------------------------------------------------
create or replace function public.conversations_set_organization()
returns trigger language plpgsql set search_path = '' as $$
begin
  select p.organization_id into new.organization_id
  from public.projects p where p.id = new.project_id;

  if new.organization_id is null then
    raise exception 'proyecto % inexistente o inaccesible', new.project_id;
  end if;

  return new;
end;
$$;

create trigger conversations_set_organization_trigger
  before insert or update of project_id on public.conversations
  for each row execute function public.conversations_set_organization();

-- -----------------------------------------------------------------------------
-- Un mensaje hereda el tenant de su conversación. El cliente no opina.
create or replace function public.messages_set_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  select c.project_id, c.organization_id
    into new.project_id, new.organization_id
  from public.conversations c where c.id = new.conversation_id;

  if new.project_id is null then
    raise exception 'conversación % inexistente o inaccesible', new.conversation_id;
  end if;

  return new;
end;
$$;

create trigger messages_set_tenant_trigger
  before insert or update of conversation_id on public.messages
  for each row execute function public.messages_set_tenant();
