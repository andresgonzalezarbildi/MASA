const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "plkicsnxrjmnnwhjgobe").trim();

if (!accessToken) {
  console.error("Falta SUPABASE_ACCESS_TOKEN. Creá un token personal en Supabase y ejecutá el comando con esa variable de entorno.");
  process.exit(1);
}

const siteUrl = "https://andresgonzalez.netlify.app/masa/";
const redirectUrls = [
  siteUrl,
  "https://andresgonzalez.netlify.app/masa/**",
  "masa://auth/callback",
  "http://localhost:5173/**"
];

const confirmationTemplate = `<div style="margin:0;padding:32px 16px;background:#f2efe7;font-family:Arial,sans-serif;color:#171a21">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #171a21;padding:32px;box-shadow:8px 8px 0 #8d7cff">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em">M.A.S.A.</p>
    <h1 style="margin:0 0 16px;font-size:30px">Confirmá tu cuenta</h1>
    <p style="margin:0 0 24px;line-height:1.6">Confirmá tu correo para empezar a registrar comidas, pesajes y progreso.</p>
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 22px;background:#171a21;color:#ffffff;text-decoration:none;font-weight:700;border-radius:4px">Confirmar correo</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#61646c">Si no creaste esta cuenta, podés ignorar este mensaje.</p>
  </div>
</div>`;

const recoveryTemplate = `<div style="margin:0;padding:32px 16px;background:#f2efe7;font-family:Arial,sans-serif;color:#171a21">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #171a21;padding:32px;box-shadow:8px 8px 0 #8d7cff">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em">M.A.S.A.</p>
    <h1 style="margin:0 0 16px;font-size:30px">Cambiar contraseña</h1>
    <p style="margin:0 0 24px;line-height:1.6">Usá el siguiente botón para elegir una contraseña nueva.</p>
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 22px;background:#171a21;color:#ffffff;text-decoration:none;font-weight:700;border-radius:4px">Cambiar contraseña</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#61646c">Si no solicitaste este cambio, ignorá el mensaje y tu contraseña seguirá igual.</p>
  </div>
</div>`;

const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    site_url: siteUrl,
    uri_allow_list: redirectUrls.join(","),
    mailer_subjects_confirmation: "Confirmá tu cuenta de M.A.S.A.",
    mailer_templates_confirmation_content: confirmationTemplate,
    mailer_subjects_recovery: "Cambiá tu contraseña de M.A.S.A.",
    mailer_templates_recovery_content: recoveryTemplate
  })
});

const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(`Supabase respondió ${response.status}:`, payload);
  process.exit(1);
}

console.log("Configuración de autenticación actualizada correctamente.");
console.log(`Site URL: ${siteUrl}`);
console.log("Redirect URLs:");
redirectUrls.forEach(url => console.log(`- ${url}`));
console.log("Plantillas actualizadas: Confirm sign up y Reset password.");
