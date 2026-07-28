# M.A.S.A. con Supabase

Esta versión ya está integrada con autenticación y almacenamiento online.

## Único archivo obligatorio para completar

Editá `js/config.js`:

```js
window.MASA_CONFIG = Object.freeze({
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseKey: "TU_PUBLISHABLE_O_ANON_KEY"
});
```

La Publishable/anon key puede estar en el frontend. No uses la `service_role`.

## Qué queda online

- Perfil y configuración general: `profiles`.
- Pesajes: `weigh_ins`.
- Alimentos propios: `foods` con `owner_id` igual al usuario.
- Alimentos generales: `foods` con `owner_id` en `NULL`.
- Recetas e ingredientes: `recipes` y `recipe_ingredients`.
- Ingestas diarias: `diary_entries`.

Cada cambio se guarda primero como caché local y después se sincroniza automáticamente.

## Primera apertura

1. El usuario crea una cuenta o inicia sesión.
2. Si el navegador todavía contiene el perfil de la versión local, M.A.S.A. ofrece importarlo a la cuenta.
3. Después de una migración correcta se conserva una copia local de respaldo y se elimina el estado local antiguo.

## Base global

La aplicación intenta cargar los alimentos generales desde Supabase. Si la tabla todavía no contiene alimentos globales, utiliza temporalmente `data/opennutrition-es-general.json` como respaldo.

Para reconstruir el CSV de importación:

```bash
node tools/convert-global-foods.mjs data/opennutrition-es-general.json global-foods.csv
```

En las filas globales, `owner_id` debe quedar vacío.

## SQL de referencia

Los archivos `supabase/01_schema.sql` y `supabase/02_rls.sql` contienen el esquema y las políticas RLS utilizados por el código. No hace falta volver a ejecutarlos si esas tablas y políticas ya existen.

## Publicación

Subí todos los archivos del ZIP al branch. Netlify no necesita proceso de build. El `netlify.toml` ya permite las conexiones a Supabase y la descarga del cliente desde jsDelivr.
