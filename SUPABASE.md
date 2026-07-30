# M.A.S.A. con Supabase

Esta versión ya está integrada con autenticación y almacenamiento online.

## Único archivo obligatorio para completar

Editá `js/config.js`:

```js
window.MASA_CONFIG = Object.freeze({
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  authRedirectUrl: "https://andresgonzalez.netlify.app/masa/",
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


## Configuración de autenticación, Google y correos

### 1. Corregir el retorno a `/masa/`

En Supabase abrí **Authentication → URL Configuration** y guardá exactamente:

- **Site URL:** `https://andresgonzalez.netlify.app/masa/`
- **Redirect URLs:**
  - `https://andresgonzalez.netlify.app/masa/`
  - `https://andresgonzalez.netlify.app/masa/**`
  - `masa://auth/callback`
  - `http://localhost:5173/**`

La URL exacta es importante. Si Supabase no encuentra el `redirectTo` en esta lista, ignora el valor enviado por la aplicación y usa el Site URL. La APK utiliza `masa://auth/callback` para volver automáticamente desde Google y desde los enlaces de correo.

### 2. Activar Google

En Google Cloud Console:

1. Seleccioná el proyecto **M.A.S.A.**.
2. Entrá en **Google Auth Platform → Clients → Create client**.
3. Elegí **Web application**.
4. En **Authorized JavaScript origins** agregá:
   - `https://andresgonzalez.netlify.app`
   - `http://localhost:5173`
5. En **Authorized redirect URIs** agregá:
   - `https://plkicsnxrjmnnwhjgobe.supabase.co/auth/v1/callback`
6. Copiá el **Client ID** y el **Client Secret**.

Después, en Supabase:

1. Abrí **Authentication → Sign In / Providers → Google**.
2. Activá **Enable Sign in with Google**.
3. Pegá el Client ID y el Client Secret.
4. Guardá.

El botón **Continuar con Google** sirve tanto para crear la cuenta como para iniciar sesión. En Android abre el navegador y vuelve a la APK mediante el enlace `masa://auth/callback`.

### 3. Dónde editar el correo

En un proyecto alojado por Supabase, abrí:

**Authentication → Email Templates**

La ruta directa dentro del Dashboard termina en:

`/project/plkicsnxrjmnnwhjgobe/auth/templates`

Seleccioná primero **Confirm sign up** o **Reset password**. Si la pantalla está en modo vista previa, presioná **Edit template**. Allí aparecen los campos **Subject** y **Message body**; después de pegar el contenido presioná **Save changes**.

No hace falta configurar SMTP propio para habilitar el editor. Si los campos siguen bloqueados, comprobá que estés dentro del proyecto correcto y que tu rol sea Owner o Administrator. Si guarda pero continúa llegando el correo predeterminado, revisá **Authentication → Logs**: Supabase usa una plantilla de respaldo cuando el HTML tiene sintaxis inválida.

Como alternativa, esta versión incluye `tools/configure-supabase-auth.mjs`, que configura la Site URL, las Redirect URLs y las dos plantillas mediante la Management API. Creá un token personal de Supabase y ejecutá:

```bash
SUPABASE_ACCESS_TOKEN="tu_token_personal" npm run supabase:auth-config
```

No guardes ese token en GitHub ni en `js/config.js`.

### 4. Plantilla de confirmación

En **Confirm sign up**:

**Subject**

```text
Confirmá tu cuenta de M.A.S.A.
```

**Message body**

```html
<div style="margin:0;padding:32px 16px;background:#f2efe7;font-family:Arial,sans-serif;color:#171a21">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #171a21;padding:32px;box-shadow:8px 8px 0 #8d7cff">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em">M.A.S.A.</p>
    <h1 style="margin:0 0 16px;font-size:30px">Confirmá tu cuenta</h1>
    <p style="margin:0 0 24px;line-height:1.6">Confirmá tu correo para empezar a registrar comidas, pesajes y progreso.</p>
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 22px;background:#171a21;color:#ffffff;text-decoration:none;font-weight:700;border-radius:4px">Confirmar correo</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#61646c">Si no creaste esta cuenta, podés ignorar este mensaje.</p>
  </div>
</div>
```

El botón debe usar exactamente `{{ .ConfirmationURL }}`. No uses `{{ .SiteURL }}` como enlace, porque eso manda siempre a la URL general y puede perder `/masa/` o el retorno a Android.

### 5. Plantilla para cambiar contraseña

En **Reset password**:

**Subject**

```text
Cambiá tu contraseña de M.A.S.A.
```

**Message body**

```html
<div style="margin:0;padding:32px 16px;background:#f2efe7;font-family:Arial,sans-serif;color:#171a21">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #171a21;padding:32px;box-shadow:8px 8px 0 #8d7cff">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em">M.A.S.A.</p>
    <h1 style="margin:0 0 16px;font-size:30px">Cambiar contraseña</h1>
    <p style="margin:0 0 24px;line-height:1.6">Usá el siguiente botón para elegir una contraseña nueva.</p>
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 22px;background:#171a21;color:#ffffff;text-decoration:none;font-weight:700;border-radius:4px">Cambiar contraseña</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#61646c">Si no solicitaste este cambio, ignorá el mensaje y tu contraseña seguirá igual.</p>
  </div>
</div>
```

La aplicación detecta el retorno de recuperación y abre el formulario para elegir la contraseña nueva.

### 6. Cambio de contraseña dentro de la aplicación

En **Ajustes → Cuenta** el usuario puede cambiarla directamente o enviarse un enlace por correo. En la seguridad de contraseñas de Supabase:

- activá **Require current password when changing password**;
- dejá desactivado **Require reauthentication when changing password**, salvo que más adelante se implemente también el código `nonce`.

### 7. Envío de correos en producción

El SMTP incluido por Supabase sirve para pruebas y tiene límites bajos. Para producción configurá un SMTP propio en **Project Settings → Authentication → SMTP Settings**. Esto cambia la entrega y el remitente, pero no es necesario para editar las plantillas.

