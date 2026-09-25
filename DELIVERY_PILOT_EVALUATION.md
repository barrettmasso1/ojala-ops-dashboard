# Piloto de conteo de entregas

La precisión y el recall del modelo v4 describen **cajas detectadas en imágenes**, no entregas contadas durante un turno. Este evaluador compara, una por una, las entregas observadas por una persona con los **eventos candidatos de entrega** de un emisor. No consulta la base activa ni envía conteos al dashboard.

## Registrar la referencia y los candidatos

Antes del piloto, fijar la tolerancia temporal y los turnos que se medirán. Registrar **una fila por vaso entregado**, incluso cuando se entregan dos vasos al mismo tiempo. La persona que registra la referencia debe hacerlo de forma independiente del conteo automático. Usar el mismo `shiftId` en todos los archivos; los horarios deben ser ISO 8601 con `Z` o un desfase explícito.

`truth.csv`:

```csv
shiftId,eventAt
2026-09-25-tarde,2026-09-25T17:00:00-07:00
2026-09-25-tarde,2026-09-25T17:00:15-07:00
```

`candidates.csv`:

```csv
shiftId,eventAt,sourceEventId
2026-09-25-tarde,2026-09-26T00:00:02Z,handoff-20260925-001
2026-09-25-tarde,2026-09-26T00:00:16Z,handoff-20260925-002
```

Cada `sourceEventId` identifica **un candidato por vaso**, estable al reintentar una entrega. Un fotograma con una caja de detección no constituye por sí solo un evento de entrega. El receptor `frigate.submitCounts` acepta actualizaciones agregadas con su propio `sourceEventId/sourceEventAt`; ese identificador de actualización tampoco sustituye la lista de eventos candidatos por vaso. El emisor de eventos aún debe construirse y validarse. Estos CSV son **ejemplos sintéticos**, no resultados de Ojala.

Para medir qué ocurre hoy con las detecciones existentes, se puede exportar una lista JSON completa del endpoint de lectura `GET /api/events` de Frigate para el periodo y ejecutar el convertidor local. Selecciona eventos **terminados** de la cámara `handoff` con etiqueta `cup`, toma la hora de fin del objeto como aproximación y usa el ID estable del track. Una zona se puede exigir con `--zone` si está configurada. Revisar la paginación y confirmar que el archivo contiene todo el turno; un export incompleto aumenta artificialmente las omisiones.

```bash
node scripts/export-frigate-track-proxies.mjs \
  --events frigate-events.json \
  --shift-id 2026-09-25-tarde \
  --from 2026-09-25T17:00:00-07:00 \
  --to 2026-09-25T19:00:00-07:00 \
  --out candidates.csv
```

**Un track terminado tampoco equivale a una entrega**: la hora de salida de cuadro puede diferir de la entrega o corresponder a un vaso inmóvil, retirado o mal detectado. La comparación con la referencia humana cuantifica las limitaciones de este proxy; no debe enviarse su total a producción. La estructura de eventos y `end_time` está descrita en la [documentación oficial de Frigate](https://docs.frigate.video/integrations/api/schemas/eventresponse/).

Opcionalmente, registrar `availability.csv` con minutos programados y minutos realmente en línea, medidos por turno:

```csv
shiftId,scheduledMinutes,onlineMinutes
2026-09-25-tarde,120,112
```

## Ejecutar sin acceso a producción

```bash
node scripts/evaluate-delivery-pilot.mjs \
  --truth truth.csv \
  --predictions candidates.csv \
  --availability availability.csv \
  --tolerance-seconds 5 \
  --out delivery-pilot-report.json
```

`--availability` y `--out` son opcionales. Sin `--out`, el JSON se escribe en stdout. El archivo de salida se crea solo si no existía. El programa rechaza marcas de tiempo sin zona, IDs reutilizados de forma contradictoria, minutos imposibles y filas mal formadas. Reintentos idénticos del mismo ID se deduplican; eventos con **IDs diferentes** se conservan para que los duplicados aparentes cuenten como falsos avisos. La tolerancia debe acordarse **antes** de ver los resultados, no ajustarse para mejorar la cifra.

El informe incluye aciertos, omisiones, falsos avisos, precisión, recall, diferencia de conteos y disponibilidad por turno y total. Empareja como máximo un candidato por entrega dentro de la ventana temporal. Puede haber diferencia total de cero y, al mismo tiempo, omisiones compensadas por falsos avisos: revisar siempre ambos. Si el denominador es cero o no se registró disponibilidad, la métrica correspondiente es `null`, sin inventar un 100%.

Para decidir si se puede ofrecer comercialmente, se necesitan turnos representativos, una referencia humana independiente, registro de horas sin cámara y de minutos de revisión, límites de aceptación acordados previamente, y una prueba final que no se use para ajustar el emisor. Este script permite evaluar esos datos cuando existan; **no certifica** por sí solo el modelo, el conteo ni una segunda tienda.
