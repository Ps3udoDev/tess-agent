-- =============================================================================
-- 0011 · Integridad de tenant en conversaciones
--
-- 0010 cerró esta clase de inyección para `leads` con
-- `leads_forbid_project_change`, pero no hizo el gemelo para conversaciones, y
-- la vía seguía abierta.
--
-- `conversations_update_visitor` de 0009 existe para que el visitante pueda
-- rellenar `title` con su primer mensaje. Lo que no comprueba es `project_id`:
-- su `using` y su `with check` solo exigen que el proyecto acepte visitantes y
-- que la conversación sea suya. Un visitante podía por tanto reubicar SU
-- conversación —cuyo título son los primeros 80 caracteres de lo que él
-- escribió— en cualquier otro proyecto con `visitor_access`, donde los
-- miembros de la víctima la verían por `conversations_select` de 0006. No es
-- una fuga de lectura: es una inyección, exactamente la misma que 0010
-- describe para `messages` y `leads`.
--
-- Una conversación pertenece al proyecto donde se abrió. Moverla no es una
-- operación legítima de nadie, así que el trigger la rechaza sin excepciones
-- en vez de intentar distinguir quién la pide.
--
-- El trigger es defensa en profundidad y no sustituye a RLS: corre para
-- cualquier llamante, incluido `service_role`, que bypasea las políticas.
-- =============================================================================

create or replace function public.conversations_forbid_project_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'una conversación no puede cambiar de proyecto';
  end if;

  return new;
end;
$$;

-- Se dispara ANTES que `conversations_set_organization_trigger` de 0010 —el
-- orden entre triggers de la misma fase es alfabético—, así que el cambio se
-- rechaza antes de que la derivación de `organization_id` lo consolide.
create trigger conversations_forbid_project_change_trigger
  before update on public.conversations
  for each row execute function public.conversations_forbid_project_change();
