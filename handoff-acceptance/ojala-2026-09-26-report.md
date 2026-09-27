# Ojala — Caso de escena de handoff del 26 de septiembre de 2026

**Ventana:** 16:56:52–17:06:52, `America/Mazatlan`
**Estado de esta revisión:** propuesta de recuperación preparada; **reproducción con evidencia original bloqueada**.

> Este informe separa observaciones del operador, eventos Frigate, capturas automáticas, cuadros extraídos posteriormente y resultados de IA. No crea ni infiere ventas, entregas, conteos de cámara, inventario o ingresos.

## Hechos proporcionados

| Medida | Valor | Clasificación correcta |
|---|---:|---|
| Referencia del operador | 2 vasos medianos vendidos | Referencia humana; el tamaño *mediano* no está validado por Frigate ni por IA. |
| Tracks / `cup_event` Frigate | 1 | Evento `1790467493.946143-9rdbpk`; no equivale a una venta. |
| JPEG/JSON automático | 1 | Captura automática a las 17:04:57.764 local. |
| Registro en cola del sender | 1, 0 envíos | Estado local reportado; no es un resultado de IA. |
| Escena adicional de grabación | aprox. 17:02:38 | Se reporta un vaso, pero no hubo `cup_event` ni captura automática independiente. |

La escena de las 17:02:38 debe tratarse como **posible falso negativo por escena**. No puede presentarse como éxito automático ni como una segunda entrega/venta. Un cuadro extraído de la grabación después del hecho debe llamarse `recording_extracted_frame`.

## Estado de evidencia y reproducción

Se buscó localmente el ZIP, la grabación, JPEG/JSON automáticos y archivos Frigate asociados al identificador/ventana reportados. En este entorno no había ZIP, grabación, capturas ni logs de detector disponibles para leer. Por eso:

| Pregunta | Resultado |
|---|---|
| ¿Se reprodujo la secuencia original? | **No.** Falta el ZIP/archivo de evidencia original. |
| ¿Se validaron vasos visibles en imagen/video original? | **No; desconocido.** |
| ¿Se ejecutó IA sobre evidencia original? | **No.** |
| ¿Hay cajas o confianzas reales del detector/IA? | **No.** |
| ¿Se conoce la causa del descarte/omisión? | **No atribuida.** La ausencia de un evento/captura es el síntoma observado, no una causa probada. |

## Propuesta medible preparada

El paquete `beelink/handoff-scene-recovery/` funciona localmente y fuera de red:

1. Comprueba y extrae de forma segura un ZIP entregado localmente que contenga una sola grabación fuente.
2. Extrae el cuadro de la escena documentada y genera SHA-256 del ZIP, grabación y cuadro.
3. Produce un manifiesto que conserva dos orígenes distintos:
   - `automatic_frigate_capture` para la captura a las 17:04:57.764;
   - `recording_extracted_frame` para la escena extraída aproximadamente a las 17:02:38.
4. No solicita red, credenciales, IA ni base de datos; registra explícitamente cero mutaciones operativas.
5. Cualquier importación posterior de un cuadro recuperado queda limitada al administrador, se almacena como `recording_extracted_frame`, guarda la sugerencia de IA por separado y permanece `pending_review` aunque la IA vea persona + vaso de gelato + zona.

Las métricas que deberán calcularse **solamente después de tener la secuencia original** son:

- **candidate recall:** escenas confirmadas por revisión humana con persona + vaso de gelato + zona ofrecidas a revisión / todas las escenas confirmadas en la grabación;
- **review precision:** candidatos de recuperación aprobados por manager / candidatos presentados;
- **false candidate rate:** candidatos descartados por manager / minutos de video revisados;
- **efectos operativos:** deben ser cero para ventas, entregas, conteos Frigate, inventario e ingresos.

No se establece un umbral de aceptación ni se declara que el cambio recuperará el caso hasta ejecutar esas mediciones con el ZIP original.

## Salvaguardas implementadas

- Dedupe por `storeId + cameraName + cupEventId` preservado.
- La procedencia es inmutable dentro de esa llave: un reintento con la misma imagen/fecha pero con otro origen se rechaza; un cuadro recuperado no puede convertirse en `approved_by_ai` como si fuera una captura automática.
- Los reintentos siguen usando el mismo ID y no pueden duplicar evidencia.
- La geometría de zona sigue siendo la configuración del servidor; un polígono del lado cliente nunca autoriza por sí mismo.
- Una respuesta tardía de IA no puede sobrescribir revisión humana ni una cola más nueva.
- La migración nueva `0016_handoff_scene_recovery_evidence.sql` añade solo procedencia (`evidenceOrigin`), sugerencia de IA (`aiSuggestedStatus`) e índice; no toca `frigateCupCounts`, ventas ni migraciones previas.
- La evidencia privada se ignora en Git; no se publican imágenes de clientes en GitHub.

## Validación ejecutada (aislada, no evidencia del caso real)

- `pnpm test`: **185 pruebas aprobadas**.
- TypeScript: **PASS**.
- Build de producción: **PASS**.
- `drizzle-kit generate`: **No schema changes, nothing to migrate** después de registrar la migración `0016`.
- 14 pruebas del sender de capturas verificadas: **PASS**.
- 2 pruebas del replay offline: **PASS**; usan un video sintético local y prueban separación de procedencia y rechazo de ZIP con path traversal.

Estas pruebas no son una evaluación del modelo contra la grabación de Ojala ni sustituyen el ZIP original.
