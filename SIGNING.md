# Firma definitiva de M.A.S.A.

- `applicationId`: `uy.com.andresgonzalez.masa`
- Alias: `masa-release`
- La clave definitiva debe restaurarse como `signing/masa-release.jks`.
- Copiar `keystore.properties.example` a `keystore.properties` y completar las credenciales.
- Compilar únicamente con `npm run android:apk`; genera `dist/MASA-v28.0.0-release.apk`.
- Para cada versión futura, conservar esta misma clave y el mismo `applicationId`; modificar solamente `VERSION_CODE` y `VERSION_NAME` en `tools/version.mjs`.

No subir `masa-release.jks` ni `keystore.properties` a un repositorio público.
