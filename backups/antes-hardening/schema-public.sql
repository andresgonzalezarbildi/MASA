--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.5 (Ubuntu 17.5-1.pgdg20.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: diary_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diary_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    legacy_id text,
    entry_date date NOT NULL,
    meal text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'food'::text NOT NULL,
    serving_text text,
    serving_amount numeric(12,4),
    serving_unit text,
    serving_unit_custom text,
    quantity numeric(12,4) DEFAULT 1 NOT NULL,
    quantity_unit text,
    calories numeric(12,4) DEFAULT 0 NOT NULL,
    protein numeric(12,4) DEFAULT 0 NOT NULL,
    fat numeric(12,4) DEFAULT 0 NOT NULL,
    carbs numeric(12,4) DEFAULT 0 NOT NULL,
    source_food_id uuid,
    source_recipe_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diary_entries_calories_check CHECK ((calories >= (0)::numeric)),
    CONSTRAINT diary_entries_carbs_check CHECK ((carbs >= (0)::numeric)),
    CONSTRAINT diary_entries_fat_check CHECK ((fat >= (0)::numeric)),
    CONSTRAINT diary_entries_protein_check CHECK ((protein >= (0)::numeric)),
    CONSTRAINT diary_entries_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: foods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.foods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    legacy_id text,
    external_id text,
    source text DEFAULT 'user'::text NOT NULL,
    name text NOT NULL,
    brand text,
    serving_text text,
    serving_amount numeric(12,4),
    serving_unit text,
    serving_unit_custom text,
    calories numeric(12,4) DEFAULT 0 NOT NULL,
    protein numeric(12,4) DEFAULT 0 NOT NULL,
    fat numeric(12,4) DEFAULT 0 NOT NULL,
    carbs numeric(12,4) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT foods_calories_check CHECK ((calories >= (0)::numeric)),
    CONSTRAINT foods_carbs_check CHECK ((carbs >= (0)::numeric)),
    CONSTRAINT foods_fat_check CHECK ((fat >= (0)::numeric)),
    CONSTRAINT foods_protein_check CHECK ((protein >= (0)::numeric))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    display_name text,
    configured boolean DEFAULT false NOT NULL,
    schema_version integer DEFAULT 17 NOT NULL,
    profile_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    migration_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: recipe_ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipe_ingredients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    recipe_id uuid NOT NULL,
    food_id uuid,
    "position" integer DEFAULT 0 NOT NULL,
    ingredient_name text NOT NULL,
    quantity numeric(12,4) DEFAULT 1 NOT NULL,
    quantity_unit text,
    calories numeric(12,4) DEFAULT 0 NOT NULL,
    protein numeric(12,4) DEFAULT 0 NOT NULL,
    fat numeric(12,4) DEFAULT 0 NOT NULL,
    carbs numeric(12,4) DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recipe_ingredients_calories_check CHECK ((calories >= (0)::numeric)),
    CONSTRAINT recipe_ingredients_carbs_check CHECK ((carbs >= (0)::numeric)),
    CONSTRAINT recipe_ingredients_fat_check CHECK ((fat >= (0)::numeric)),
    CONSTRAINT recipe_ingredients_protein_check CHECK ((protein >= (0)::numeric)),
    CONSTRAINT recipe_ingredients_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    legacy_id text,
    name text NOT NULL,
    yield_amount numeric(12,4) DEFAULT 1 NOT NULL,
    yield_unit text,
    yield_unit_custom text,
    serving_amount numeric(12,4),
    calories numeric(12,4) DEFAULT 0 NOT NULL,
    protein numeric(12,4) DEFAULT 0 NOT NULL,
    fat numeric(12,4) DEFAULT 0 NOT NULL,
    carbs numeric(12,4) DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recipes_calories_check CHECK ((calories >= (0)::numeric)),
    CONSTRAINT recipes_carbs_check CHECK ((carbs >= (0)::numeric)),
    CONSTRAINT recipes_fat_check CHECK ((fat >= (0)::numeric)),
    CONSTRAINT recipes_protein_check CHECK ((protein >= (0)::numeric)),
    CONSTRAINT recipes_yield_amount_check CHECK ((yield_amount > (0)::numeric))
);


--
-- Name: weigh_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weigh_ins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    legacy_id text,
    logged_on date NOT NULL,
    weight_kg numeric(6,2) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT weigh_ins_weight_kg_check CHECK (((weight_kg > (0)::numeric) AND (weight_kg <= (500)::numeric)))
);


--
-- Name: diary_entries diary_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diary_entries
    ADD CONSTRAINT diary_entries_pkey PRIMARY KEY (id);


--
-- Name: diary_entries diary_entries_user_id_legacy_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diary_entries
    ADD CONSTRAINT diary_entries_user_id_legacy_id_key UNIQUE (user_id, legacy_id);


--
-- Name: foods foods_owner_id_legacy_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foods
    ADD CONSTRAINT foods_owner_id_legacy_id_key UNIQUE (owner_id, legacy_id);


--
-- Name: foods foods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foods
    ADD CONSTRAINT foods_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: recipe_ingredients recipe_ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_pkey PRIMARY KEY (id);


--
-- Name: recipes recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);


--
-- Name: recipes recipes_user_id_legacy_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_user_id_legacy_id_key UNIQUE (user_id, legacy_id);


--
-- Name: weigh_ins weigh_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weigh_ins
    ADD CONSTRAINT weigh_ins_pkey PRIMARY KEY (id);


--
-- Name: weigh_ins weigh_ins_user_id_legacy_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weigh_ins
    ADD CONSTRAINT weigh_ins_user_id_legacy_id_key UNIQUE (user_id, legacy_id);


--
-- Name: weigh_ins weigh_ins_user_id_logged_on_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weigh_ins
    ADD CONSTRAINT weigh_ins_user_id_logged_on_key UNIQUE (user_id, logged_on);


--
-- Name: diary_entries_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX diary_entries_user_date_idx ON public.diary_entries USING btree (user_id, entry_date DESC);


--
-- Name: foods_global_external_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX foods_global_external_unique ON public.foods USING btree (source, external_id) WHERE ((owner_id IS NULL) AND (external_id IS NOT NULL));


--
-- Name: foods_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX foods_name_trgm_idx ON public.foods USING gin (name public.gin_trgm_ops);


--
-- Name: foods_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX foods_owner_idx ON public.foods USING btree (owner_id);


--
-- Name: recipe_ingredients_recipe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recipe_ingredients_recipe_idx ON public.recipe_ingredients USING btree (recipe_id, "position");


--
-- Name: recipes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recipes_user_idx ON public.recipes USING btree (user_id);


--
-- Name: weigh_ins_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX weigh_ins_user_date_idx ON public.weigh_ins USING btree (user_id, logged_on DESC);


--
-- Name: diary_entries diary_entries_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER diary_entries_set_updated_at BEFORE UPDATE ON public.diary_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: foods foods_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER foods_set_updated_at BEFORE UPDATE ON public.foods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recipe_ingredients recipe_ingredients_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER recipe_ingredients_set_updated_at BEFORE UPDATE ON public.recipe_ingredients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recipes recipes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER recipes_set_updated_at BEFORE UPDATE ON public.recipes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: weigh_ins weigh_ins_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER weigh_ins_set_updated_at BEFORE UPDATE ON public.weigh_ins FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: diary_entries diary_entries_source_food_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diary_entries
    ADD CONSTRAINT diary_entries_source_food_id_fkey FOREIGN KEY (source_food_id) REFERENCES public.foods(id) ON DELETE SET NULL;


--
-- Name: diary_entries diary_entries_source_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diary_entries
    ADD CONSTRAINT diary_entries_source_recipe_id_fkey FOREIGN KEY (source_recipe_id) REFERENCES public.recipes(id) ON DELETE SET NULL;


--
-- Name: diary_entries diary_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diary_entries
    ADD CONSTRAINT diary_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: foods foods_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foods
    ADD CONSTRAINT foods_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: recipe_ingredients recipe_ingredients_food_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_food_id_fkey FOREIGN KEY (food_id) REFERENCES public.foods(id) ON DELETE SET NULL;


--
-- Name: recipe_ingredients recipe_ingredients_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: recipe_ingredients recipe_ingredients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: recipes recipes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: weigh_ins weigh_ins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weigh_ins
    ADD CONSTRAINT weigh_ins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: diary_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.diary_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: diary_entries diary_entries_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY diary_entries_delete_own ON public.diary_entries FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: diary_entries diary_entries_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY diary_entries_insert_own ON public.diary_entries FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: diary_entries diary_entries_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY diary_entries_select_own ON public.diary_entries FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: diary_entries diary_entries_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY diary_entries_update_own ON public.diary_entries FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: foods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.foods ENABLE ROW LEVEL SECURITY;

--
-- Name: foods foods_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY foods_delete_own ON public.foods FOR DELETE TO authenticated USING ((owner_id = auth.uid()));


--
-- Name: foods foods_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY foods_insert_own ON public.foods FOR INSERT TO authenticated WITH CHECK ((owner_id = auth.uid()));


--
-- Name: foods foods_select_global_or_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY foods_select_global_or_own ON public.foods FOR SELECT TO authenticated USING (((owner_id IS NULL) OR (owner_id = auth.uid())));


--
-- Name: foods foods_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY foods_update_own ON public.foods FOR UPDATE TO authenticated USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_delete_own ON public.profiles FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: profiles profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: recipe_ingredients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

--
-- Name: recipe_ingredients recipe_ingredients_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipe_ingredients_delete_own ON public.recipe_ingredients FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: recipe_ingredients recipe_ingredients_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipe_ingredients_insert_own ON public.recipe_ingredients FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.recipes r
  WHERE ((r.id = recipe_ingredients.recipe_id) AND (r.user_id = auth.uid())))) AND ((food_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.foods f
  WHERE ((f.id = recipe_ingredients.food_id) AND ((f.owner_id IS NULL) OR (f.owner_id = auth.uid()))))))));


--
-- Name: recipe_ingredients recipe_ingredients_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipe_ingredients_select_own ON public.recipe_ingredients FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: recipe_ingredients recipe_ingredients_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipe_ingredients_update_own ON public.recipe_ingredients FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: recipes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

--
-- Name: recipes recipes_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipes_delete_own ON public.recipes FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: recipes recipes_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipes_insert_own ON public.recipes FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: recipes recipes_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipes_select_own ON public.recipes FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: recipes recipes_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recipes_update_own ON public.recipes FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: weigh_ins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weigh_ins ENABLE ROW LEVEL SECURITY;

--
-- Name: weigh_ins weigh_ins_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weigh_ins_delete_own ON public.weigh_ins FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: weigh_ins weigh_ins_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weigh_ins_insert_own ON public.weigh_ins FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: weigh_ins weigh_ins_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weigh_ins_select_own ON public.weigh_ins FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: weigh_ins weigh_ins_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY weigh_ins_update_own ON public.weigh_ins FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: TABLE diary_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.diary_entries TO authenticated;
GRANT ALL ON TABLE public.diary_entries TO service_role;


--
-- Name: TABLE foods; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.foods TO authenticated;
GRANT ALL ON TABLE public.foods TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE recipe_ingredients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.recipe_ingredients TO authenticated;
GRANT ALL ON TABLE public.recipe_ingredients TO service_role;


--
-- Name: TABLE recipes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.recipes TO authenticated;
GRANT ALL ON TABLE public.recipes TO service_role;


--
-- Name: TABLE weigh_ins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.weigh_ins TO authenticated;
GRANT ALL ON TABLE public.weigh_ins TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

