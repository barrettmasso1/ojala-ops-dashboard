# PR13: ensayo de despliegue y correcciones — 7 octubre 2026

## Resultado comprobado
- Base ensayada: PR13 e37c9aec762bfba320918f95b348eecb2c7c47fb.
- TiDB v8.5.0 nuevo, aislado en loopback 127.0.0.1:4000; no se reutilizó ni borró el volumen del ensayo anterior.
- Respaldo histórico del18/09 restaurado después de verificar SHA256. NO es un backup fresco de producción.
- pnpm drizzle-kit migrate aplicó0012–0017. Ledger12→18; los seis hashes y su orden coinciden con el SQL de la rama.
- Segunda ejecución de migrate:18→18, cero nuevas migraciones. No se utilizó db:push ni se escribió el ledger manualmente.
- 2,439 filas de12 tablas originales preservadas mediante comparación fila por fila de las columnas originales, también después de limpiar fixtures.
- 8 pruebas tenant y14 comprobaciones Store1/visual sobre TiDB real pasaron; cero filas de fixtures restantes.
- Las pruebas Store1 configuraron la geometría de la Beelink con una credencial Frigate sintética, guardada como hash, ligada a Store1. Los fixtures se eliminaron.
- Una decisión visual de manager no alteró cámara, ventas ni conteos del cierre.
- El contenedor nuevo quedó detenido al terminar; se conserva su carpeta privada de ensayo.

## Problema encontrado y corregido: formato de geometría
El productor instalado /home/ojala/frigate/config/verified_capture.py genera schema_version3 con un objeto descriptivo de zona y hash del JSON compacto ordenado.
El emisor de PR13 esperaba un array de puntos x/y, por lo que rechazaba54 de59 pares reales examinados.
El adaptador ahora:
1. Verifica el hash ORIGINAL, nombre, sistema de coordenadas, regla y dimensiones.
2. Traduce exactamente el polígono al formato canónico del receptor y calcula su hash correspondiente.
3. Conserva el ID, tiempo e imagen; registra hash del sidecar y hash original de zona en sourceDetail.
4. No reescribe JPG ni JSON originales. Recomprueba el sidecar adaptado antes de enviar.
5. Rechaza geometrías alteradas, dimensiones incompatibles, booleanos, rangos inválidos y polígonos duplicados.

Resultado offline:59 pares aceptados en cola aislada; al repetir, cero duplicados. Se comprobó su contrato con el parser real del servidor y la geometría configurada en TiDB.
Estas59 imágenes NO significan59 vasos, ventas o entregas. No se enviaron por red ni se llamó a IA en vivo.

## Problema encontrado y corregido: precisión del orden
sourceEventAt usa TIMESTAMP(0). Sin normalización, un evento más antiguo con fracción de segundo podía compararse como nuevo frente al valor persistido truncado.
Se normaliza a segundos antes de guardar/comparar. IDs idénticos siguen siendo reintentos; diferentes IDs dentro del mismo segundo se tratan conservadoramente como stale.
No se modificó ninguna migración. La aprobación original y su precisión permanecen en la evidencia local del emisor.
Se probó en TiDB: aplicar, repetir y rechazar una revisión anterior del mismo segundo conserva el conteo correcto.

## Validación
- Vitest:34 archivos /206 pruebas PASS.
- Emisor visual:22 pruebas PASS.
- Emisor de conteos instalado:30 pruebas PASS; soporta sourceEventId/sourceEventAt cuando protocol=tenant_event_v1.
- TypeScript, frontend y servidor:PASS.
- La compilación aislada muestra avisos de analytics sin variables y bundle grande; no impidieron compilar.
- Las suites existentes del emisor muestran avisos de conexiones SQLite de fixtures sin cerrar; no indican un fallo en datos reales.
- No se ejecutó una sesión visual del dashboard publicado.

## Estado de producción y activación pendiente
El permiso para el despliegue ya fue dado. Falta acceso administrativo verificable al runtime publicado: Opera Browser Connector devuelve Browser not connected.
No se confirmó base de producción, no se creó backup fresco, no se fusionó PR13, no se aplicaron migraciones de producción y no se habilitó el emisor visual.
El emisor activo conserva legacy_v1. Se preparó un candidato tenant_event_v1 privado con permisos600, sin activar ni imprimir la clave y sin marcar productionContractVerified=true.
El candidato no acredita que la misma clave ya esté registrada en storeCredentials de producción.

## Archivos útiles
- notes/pr13-rehearsal-2026-10-07.json: evidencia saneada y hashes exactos.
- notes/handoff-zone-store1-2026-10-07.json: entrada lista para storeAdmin.saveHandoffZone bajo una sesión Store1; la tienda siempre procede de la sesión.
- notes/manus-pr13-production-prompt-2026-10-07.txt: siguiente ejecución administrativa.
- rehearsal/beelink-phase1/scripts/run-store1-visual-fixtures.mjs: prueba local de contrato, geometría y separación de datos.
Los dumps, imágenes, sidecars, colas SQLite y archivos privados no forman parte del PR.
