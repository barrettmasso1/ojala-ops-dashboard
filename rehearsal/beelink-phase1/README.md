# Ensayo aislado de Ojala Phase 1 para Beelink

Este paquete prepara un ensayo reproducible de restauración y migración en **TiDB Unistore local por Docker**. Está diseñado para ejecutarse desde un checkout de la rama del PR #3 en el Beelink Ubuntu. **Está preparado, pero no se ejecutó en Manus**: el entorno actual no tiene Docker disponible.

## Límites de seguridad

- TiDB publica `4000` y `10080` exclusivamente en `127.0.0.1`; no hay puertos expuestos en la LAN ni en Internet.
- La restauración acepta únicamente `127.0.0.1:4000` y la base fija `ojala_phase1_rehearsal`.
- El script rechaza `CREATE DATABASE`, `DROP DATABASE`, `USE`, nombres de la base original y sentencias calificadas con otra base dentro del dump.
- El dump se recibe por ruta local absoluta. No se sube ni se conecta a la base activa.
- La opción `--reset` solo puede eliminar la base local `ojala_phase1_rehearsal` en el contenedor local. Nunca se conecta a producción.
- Las credenciales de aplicación, las de Frigate y los valores de producción no se incluyen en el paquete ni se imprimen.

## Requisitos locales

1. Ubuntu en el Beelink con Docker Engine y Docker Compose v2.
2. Git, Node.js 22 y pnpm 10.
3. Un checkout limpio del PR #3 / rama `feature/tenant-auth-frigate-boundaries`.
4. El directorio local del respaldo validado del 18 de septiembre. No se debe editar el dump.

## Ejecución

Desde la raíz del checkout del proyecto:

```bash
pnpm install --frozen-lockfile
chmod +x rehearsal/beelink-phase1/scripts/run-rehearsal.sh
./rehearsal/beelink-phase1/scripts/run-rehearsal.sh \
  --dump /ruta/absoluta/ojala_prod_backup_20260918T230107Z
```

El resultado queda bajo `rehearsal/beelink-phase1/results/<UTC>/`. El script conserva:

- `restore.json`: prueba del destino local, conteo de archivos y restauración.
- `before-audit.json`: auditoría original completa antes de migrar.
- `before-row-fingerprints.json`: hashes fila por fila de columnas originales, sin datos en claro.
- `migration.json`: conteos del ledger Drizzle antes y después.
- `after-audit.json`: auditoría original completa posterior.
- `row-preservation.json`: comparación exacta de hashes de filas y columnas anteriores.
- `evidence-verifier.json` y su código de salida: resultado intacto de `verify-phase1-evidence.mjs`.
- `tenant-fixtures.json`: comprobaciones reales en la copia local de Store 2, acceso cruzado y Frigate.

La auditoría **antes** puede terminar con código `2`, porque correctamente observa que 0012 aún no ha creado `stores` ni `storeId`. Ese JSON es evidencia, no un error oculto. El flujo solo continúa si sale `0` o `2`; otros códigos detienen el ensayo.

## Qué prueba realmente

1. Restaura los SQL de esquema y datos en la misma copia TiDB local.
2. Ejecuta la auditoría previa original y captura hashes de cada fila/columna original.
3. Ejecuta `pnpm drizzle-kit migrate` con `DATABASE_URL` fijo al contenedor local. No usa `db:push`, ni marca migraciones manualmente.
4. Ejecuta la auditoría posterior, compara hashes fila por fila y ejecuta el verificador de evidencia sin modificarlo para ocultar diferencias.
5. Crea Store 2 y credenciales de prueba exclusivamente en la copia local. Verifica resolución de credenciales, usuario OAuth preaprovisionado, denegación de lectura/escritura cruzada y eventos Frigate ordenados. Después elimina esos fixtures.

El verificador actual fue diseñado para que el reporte **antes** ya contenga una única Store 1. Frente a un dump anterior a 0012 puede reportar un fallo esperado por esa precondición. El paquete conserva ese resultado y no declara certificación por coincidencia de totales. `row-preservation.json` aporta la evidencia fila por fila separada.

## Frigate: actualización requerida del emisor

El contrato del PR #3 requiere, además de los campos existentes, los siguientes datos por cada snapshot absoluto:

```json
{
  "sourceEventId": "identificador-unico-del-snapshot",
  "sourceEventAt": "2026-09-22T19:01:00.000Z"
}
```

`sourceEventAt` debe ser UTC con sufijo `Z`. Un reintento conserva ambos valores. Una corrección legítima usa un ID nuevo y una hora de fuente posterior; puede disminuir `cupsDetected`. Un evento con hora anterior no reemplaza el valor ya aplicado.

## Limpieza

Al terminar, el contenedor y los datos locales siguen disponibles solo para inspección. Para eliminar el ensayo local:

```bash
docker compose -f rehearsal/beelink-phase1/docker-compose.yml down -v
rm -rf rehearsal/beelink-phase1/results/*
```

Esto actúa únicamente sobre el volumen Docker local `ojala_phase1_rehearsal_data` y los resultados locales.

## Ensayo ejecutado en Beelink: 24 de septiembre de 2026

TiDB v8.5.0 Unistore restauró el respaldo con SHA-256 764c2cef4654730b35562b0ace7e0bc159f6375c298a65ab7b8d7e0874ab6a96. Se aplicaron 0012 y 0013 (ledger 12 a 14); el audit posterior no tuvo bloqueadores. Se conservaron fila por fila las columnas originales de 2,439 registros en las 12 tablas operativas.

Ocho verificaciones de fixtures pasaron contra TiDB real, incluyendo login staff y verificación de sesión, aislamiento, revocación y orden Frigate. Son llamadas al router en proceso y consultas reales a TiDB; no prueban navegador, OAuth externo ni emisor de cámara.

El verificador agregado conserva un fallo por ausencia de Store 1 antes de migrar este respaldo. No se alteró el verificador ni se declara certificación de producción. La evidencia local está en results/20260924T213914Z.

El lanzador usa tsx. El script de fixtures separa diagnósticos del JSON, cierra el pool de aplicación y devuelve error si una comprobación falla. Las sesiones usan material aleatorio local, nunca secretos de producción.
