# Endurecimiento de seguridad de M.A.S.A.

## Qué queda cubierto por código

- Validación de longitud, tipo y rango en formularios y nuevamente antes de sincronizar.
- Valores nutricionales no negativos y límites superiores razonables.
- Entradas de “solo calorías” editables directamente en kcal.
- Lista permitida de tablas en los helpers dinámicos de Supabase.
- Límite de tamaño y cantidad de registros por sincronización.
- Encabezados web contra framing, downgrade HTTP y aislamiento entre orígenes.
- SQL idempotente para RLS, privilegios mínimos, índices y restricciones de dominio.

No se eliminan apóstrofos, comillas ni símbolos válidos de los nombres. M.A.S.A. no concatena SQL: usa Supabase/PostgREST con parámetros estructurados. La protección decisiva está en RLS, permisos y restricciones de PostgreSQL; la validación del navegador mejora integridad y experiencia, pero no sustituye esos controles.

## Pasos manuales en Supabase

1. Hacer una copia de seguridad y ejecutar `supabase/03_security_hardening.sql` en SQL Editor.
2. Verificar en **Database → Tables → RLS** que todas las tablas de usuario tienen RLS activo y solamente las políticas esperadas.
3. En **Authentication → Providers / Password security**, definir una contraseña mínima fuerte, activar protección contra contraseñas filtradas si el plan lo permite y revisar los rate limits.
4. Habilitar MFA como opción de cuenta antes de volverlo obligatorio. Hacer obligatorio AAL2 requiere además adaptar el flujo de inicio de sesión y las políticas.
5. Revisar **Authentication → Audit Logs** y **Logs Explorer** periódicamente. No registrar contraseñas, tokens, cuerpos completos del estado ni datos sensibles.
6. En **Database Settings → SSL Configuration**, habilitar SSL enforcement para conexiones directas a PostgreSQL.
7. Confirmar que `js/config.js` contiene únicamente la publishable/anon key. Nunca poner `service_role`, secret key ni contraseña de base en el cliente o Git.
8. Mantener actualizadas las dependencias y ejecutar `npm audit` antes de cada release.

## Alcance y límites

- HTTPS cifra datos en tránsito y Supabase cifra su infraestructura administrada, pero el modo offline guarda datos de M.A.S.A. en almacenamiento local del dispositivo. Ese almacenamiento no debe considerarse cifrado frente a alguien con acceso al dispositivo o a una sesión del navegador.
- El proxy de Open Food Facts es de solo lectura, pero sigue siendo conveniente limitar formato y longitud del código recibido en Netlify/Edge si más adelante se transforma en una función propia.
- El logging de consola actual sirve para diagnóstico local. Para monitoreo centralizado se debe agregar un servicio con filtrado y redacción de datos; no conviene enviar el estado completo del usuario.
