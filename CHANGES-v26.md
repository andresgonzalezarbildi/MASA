# M.A.S.A. v26.0.0

## Interfaz y navegación
- La cabecera dejó de ser fija y respeta las áreas seguras del teléfono.
- Android oculta la barra de estado y vuelve a ocultarla al regresar del escáner.
- El menú y Ajustes tienen margen superior/lateral seguro; el botón ya no queda recortado.
- Registros se presenta como vista principal y Progreso como análisis secundario.
- Se quitó “M.A.S.A. Online”.

## Cuenta y autenticación
- Se agregó el botón de ojo en acceso, alta y recuperación de contraseña.
- Las sesiones JWT inválidas se limpian localmente y se vuelve al acceso sin mostrar mensajes técnicos.
- Los errores de tablas o Supabase se convierten en mensajes entendibles.
- Se quitó la importación/exportación del perfil completo; se mantienen pesajes, ingestas y biblioteca.

## Pesajes y alimentos
- Gestionar pesajes usa un selector de fecha y muestra un único registro editable.
- El botón para minimizar el gestor queda visible durante el desplazamiento.
- El editor abierto desde un escaneo no muestra una cruz redundante arriba; conserva Cancelar abajo.
- El código de barras dejó de mostrarse como campo al crear alimentos.
- Un producto escaneado comienza con la cantidad original del envase cuando Open Food Facts la informa; de lo contrario usa 1 unidad.

## Web y Android
- `/masa` redirige a `/masa/` y la base de recursos evita perder CSS o JavaScript.
- Android usa el escáner nativo de Capacitor; ZXing del navegador queda solo para la web.
- El catálogo local se redujo de 7,2 MB a 2,9 MB sin quitar los campos usados por la aplicación.
- La compilación Android configurada es `release`, minificada, con recursos reducidos y firma definitiva.
- `applicationId`: `uy.com.andresgonzalez.masa`.
- Versión: `versionCode 26`, `versionName 26.0.0`.
