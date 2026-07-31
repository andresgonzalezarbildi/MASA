-- MASA_SECURITY_RLS_AND_CONSTRAINTS_V1
-- Ejecutar una vez en Supabase SQL Editor después de revisar una copia de seguridad.
-- Es idempotente. Las restricciones se crean NOT VALID: protegen escrituras nuevas
-- sin bloquear el despliegue por datos históricos; luego pueden validarse manualmente.

begin;

-- El frontend solamente necesita el rol authenticated. anon no accede a datos de negocio.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'weigh_ins', 'foods', 'recipes', 'recipe_ingredients', 'diary_entries'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('revoke all on table public.%I from anon', table_name);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
      execute format('alter table public.%I enable row level security', table_name);
      execute format('alter table public.%I force row level security', table_name);
    end if;
  end loop;
end $$;

-- Políticas privadas por usuario.
do $$
begin
  if to_regclass('public.profiles') is not null then
    drop policy if exists "profiles_select_own" on public.profiles;
    drop policy if exists "profiles_insert_own" on public.profiles;
    drop policy if exists "profiles_update_own" on public.profiles;
    drop policy if exists "profiles_delete_own" on public.profiles;
    create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
    create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
    create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
    create policy "profiles_delete_own" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['weigh_ins', 'recipes', 'recipe_ingredients', 'diary_entries'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_insert_own', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_update_own', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_delete_own', table_name);
      execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
      execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name || '_insert_own', table_name);
      execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_update_own', table_name);
      execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name || '_delete_own', table_name);
    end if;
  end loop;
end $$;

-- Catálogo global legible; filas personales únicamente para su dueño.
do $$
begin
  if to_regclass('public.foods') is not null then
    drop policy if exists "foods_select_available" on public.foods;
    drop policy if exists "foods_insert_own" on public.foods;
    drop policy if exists "foods_update_own" on public.foods;
    drop policy if exists "foods_delete_own" on public.foods;
    create policy "foods_select_available" on public.foods for select to authenticated
      using (owner_id is null or (select auth.uid()) = owner_id);
    create policy "foods_insert_own" on public.foods for insert to authenticated
      with check ((select auth.uid()) = owner_id);
    create policy "foods_update_own" on public.foods for update to authenticated
      using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
    create policy "foods_delete_own" on public.foods for delete to authenticated
      using ((select auth.uid()) = owner_id);
  end if;
end $$;

-- Índices que acompañan los filtros usados por la aplicación.
create index if not exists masa_profiles_user_id_idx on public.profiles (user_id);
create index if not exists masa_weigh_ins_user_date_idx on public.weigh_ins (user_id, logged_on);
create index if not exists masa_foods_owner_name_idx on public.foods (owner_id, name);
create index if not exists masa_recipes_user_name_idx on public.recipes (user_id, name);
create index if not exists masa_recipe_ingredients_user_recipe_idx on public.recipe_ingredients (user_id, recipe_id, position);
create index if not exists masa_diary_entries_user_date_idx on public.diary_entries (user_id, entry_date, created_at);

-- Restricciones de dominio. Se agregan solo cuando existen tabla y columna.
do $$
begin
  if to_regclass('public.weigh_ins') is not null and not exists (select 1 from pg_constraint where conname = 'masa_weigh_ins_weight_range') then
    alter table public.weigh_ins add constraint masa_weigh_ins_weight_range check (weight_kg between 20 and 400) not valid;
  end if;
  if to_regclass('public.foods') is not null and not exists (select 1 from pg_constraint where conname = 'masa_foods_values_valid') then
    alter table public.foods add constraint masa_foods_values_valid check (
      length(btrim(name)) between 1 and 120 and
      calories between 0 and 10000 and protein between 0 and 10000 and
      fat between 0 and 10000 and carbs between 0 and 10000 and
      (serving_amount is null or serving_amount between 0.01 and 100000)
    ) not valid;
  end if;
  if to_regclass('public.recipes') is not null and not exists (select 1 from pg_constraint where conname = 'masa_recipes_values_valid') then
    alter table public.recipes add constraint masa_recipes_values_valid check (
      length(btrim(name)) between 1 and 120 and
      yield_amount between 0.01 and 100000 and
      (serving_amount is null or serving_amount between 0.01 and 100000) and
      calories between 0 and 10000 and protein between 0 and 10000 and
      fat between 0 and 10000 and carbs between 0 and 10000
    ) not valid;
  end if;
  if to_regclass('public.recipe_ingredients') is not null and not exists (select 1 from pg_constraint where conname = 'masa_recipe_ingredients_values_valid') then
    alter table public.recipe_ingredients add constraint masa_recipe_ingredients_values_valid check (
      length(btrim(ingredient_name)) between 1 and 120 and
      quantity between 0.01 and 100000 and
      calories between 0 and 10000 and protein between 0 and 10000 and
      fat between 0 and 10000 and carbs between 0 and 10000
    ) not valid;
  end if;
  if to_regclass('public.diary_entries') is not null and not exists (select 1 from pg_constraint where conname = 'masa_diary_entries_values_valid') then
    alter table public.diary_entries add constraint masa_diary_entries_values_valid check (
      meal in ('breakfast', 'lunch', 'snack', 'dinner', 'extras') and
      kind in ('food', 'recipe', 'external') and
      length(btrim(name)) between 1 and 120 and
      calories between 0 and 10000 and protein between 0 and 10000 and
      fat between 0 and 10000 and carbs between 0 and 10000 and
      (quantity is null or quantity between 0.01 and 100000)
    ) not valid;
  end if;
end $$;

commit;

-- Después de limpiar datos históricos, validar de forma individual:
-- alter table public.weigh_ins validate constraint masa_weigh_ins_weight_range;
-- alter table public.foods validate constraint masa_foods_values_valid;
-- alter table public.recipes validate constraint masa_recipes_values_valid;
-- alter table public.recipe_ingredients validate constraint masa_recipe_ingredients_values_valid;
-- alter table public.diary_entries validate constraint masa_diary_entries_values_valid;
