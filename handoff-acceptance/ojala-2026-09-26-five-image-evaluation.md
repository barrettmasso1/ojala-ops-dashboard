# Ojala — evaluación aislada de cinco imágenes del 26-09-2026

> **Privacidad:** este informe no contiene fotos, fotogramas, vídeo, URLs de almacenamiento ni datos biométricos. El ZIP original se verificó y se procesó sólo en una carpeta privada local; no se añadió ningún medio al repositorio ni a GitHub.

## Alcance y límites

| Elemento | Resultado |
|---|---|
| Ventana revisada | 16:56:52–17:06:52, `America/Mazatlan` |
| Hash SHA-256 del ZIP privado | `ecd1783b153c514813a706f88b2b7866f301032b2b1426f2793f5d3fedaee239` — coincidente |
| Referencia humana | 2 vasos **medianos** vendidos; el tamaño es referencia humana, no clasificación automática validada |
| Tracks Frigate | 1 |
| Capturas automáticas | 1 par JPEG/JSON, evento `1790467493.946143-9rdbpk`, 17:04:57.764 |
| Escenas extraídas de grabación | 1, aproximadamente 17:02:38; **no** es un evento ni captura automática |
| Producción | No consultada, migrada ni desplegada |

La comparación se mantiene deliberadamente separada:

| Medida | Valor | Interpretación correcta |
|---|---:|---|
| Vasos informados por operador | 2 | Referencia humana; no valida tamaño mediante IA o Frigate. |
| Tracks | 1 | Señal del detector de primera etapa; no es venta ni entrega. |
| Capturas automáticas | 1 | Evidencia automática recibida por el primer detector. |
| Fotogramas recuperados | 1 | Evidencia de revisión; no debe presentarse como éxito automático. |
| Resultados de IA | 5 evaluaciones aisladas | Señales visuales, no ventas ni entregas. |

## Evaluación visual aislada

Cada llamada recibió **una imagen**, un identificador neutral y el polígono normalizado suministrado para el ensayo. No recibió nombres descriptivos de archivo ni etiquetas de revisión. Se usó `gemini-3.1-pro-preview`; se registraron cajas normalizadas y confianza en la evidencia privada, pero este informe publica sólo los conteos para no revelar imágenes ni geometría operativa.

| Caso | Origen | Vasos detectados por modelo | Cajas dentro del polígono suministrado | Persona | Confianza | Estado del modelo | Estado operativo |
|---|---|---:|---:|---|---|---|---|
| `case-001` | Captura automática | 2 | 2 | Sí | Alta | `approved_by_ai` | `pending_review` |
| `case-002` | Fotograma extraído de grabación | 4 | 1 | Sí | Alta | `approved_by_ai` | `pending_review` |
| `case-003` | Fixture histórico | 0 | 0 | Sí | Alta | `discarded` | `pending_review` |
| `case-004` | Fixture histórico | 0 | 0 | No | Alta | `pending_review` | `pending_review` |
| `case-005` | Fixture histórico | 0 | 0 | Sí | Baja | `pending_review` | `pending_review` |

### Por qué ningún resultado se convirtió en éxito histórico automático

No se suministraron los JSON originales de las dos capturas ni una configuración histórica verificable de la zona por tienda/cámara. Por tanto, aunque el modelo evalúe la condición **persona + vaso de gelato + polígono suministrado**, no hay evidencia suficiente para afirmar que el polígono corresponde a la zona real de esa captura histórica. Todos los resultados permanecen como evidencia de revisión.

El caso `case-002` tiene además una restricción independiente: es un fotograma extraído después de la grabación. Incluso con una señal visual positiva, debe mantenerse como `recording_extracted_frame` y requiere revisión humana; nunca puede convertirse retroactivamente en una captura Frigate automática.

## Causa de la omisión inicial

> **No atribuida.** La evidencia demuestra que existe una escena con vaso alrededor de 17:02:38 sin evento/captura automática independiente, pero no contiene la traza del detector de primera etapa, sus cajas/confianzas, el motivo de descarte ni el JSON de origen. Atribuirla a oclusión, umbral, zona o configuración sin esos artefactos sería especulación.

Las entradas que siguen faltando para atribuir la causa son:

- logs de candidatos, cajas y confianza del detector de primera etapa;
- motivo de descarte por candidato;
- JSON originales de captura y configuración de zona vigente;
- etiquetas humanas de revisión para los cinco casos.

## Ensayo completo de transporte aislado

Se ejecutó un recorrido separado en una **base MariaDB local nueva**, con migraciones Drizzle normales, TLS local, almacenamiento y proxy de visión simulados, credencial Frigate gestionada por hash, Store 1 y una Store 2 de prueba. No hubo conexión a producción ni uso de fotos de clientes.

| Comprobación | Resultado |
|---|---|
| Interrupción de red simulada | La primera entrega devolvió `503`; se guardó un único reintento persistente y aún no existía una fila visual. |
| Recuperación | El reintento entregó exactamente un evento y persistió el resultado de IA simulado. |
| Dedupe | Reenvío del mismo evento conservó una sola fila y devolvió `already_processed`. |
| Revisión humana | El manager de Store 1 cambió el evento a `discarded_by_manager`. Un replay posterior no sobrescribió esa decisión. |
| Falsificación de `storeId` | El payload no eligió tienda: la credencial resolvió Store 1 en servidor. |
| Acceso cruzado | El manager de Store 2 recibió `NOT_FOUND` para el ID de Store 1. |
| Credencial inválida | Devolvió `UNAUTHORIZED` / HTTP 401 y no creó fila. |
| Efectos operativos | **0** ventas, entregas, inventario, `frigateCupCounts` y EOD creados/modificados. |

La corrección `UNAUTHORIZED` se añadió con regresión de router, para que una credencial visual inválida no se manifieste como error interno.

## Propuesta medible para recuperar falsos negativos de escena

La rama incluye un selector local de candidatos de grabación. Es una propuesta de **revisión**, no un contador y no sustituye el detector inicial:

1. Leer sólo candidatos/fragments generados por el sistema de visión local.
2. Mantener una ventana temporal deduplicada por escena, no por cada fotograma.
3. Exigir señal de persona, vaso y polígono antes de elevar un candidato.
4. Emitir un paquete de evidencia con cajas/confianzas/motivo de selección para la cola de revisión.
5. Etiquetar cada entrada como `recording_extracted_frame`; no crear `cup_event_id`, venta, entrega ni inventario.
6. Medir con revisión humana: recall de escenas perdidas, falsos positivos por hora, precisión de zona y latencia. No activar en producción sin líneas base y límites aprobados.

## Requisito de aceptación pendiente en Beelink

El worker de captura debe producir, para **cada** captura automatizada, JPEG + sidecar JSON schema v3 con `camera`, `cup_zone`, `cup_event_id`, `captured_at_utc`, `image_sha256`, geometría y hash de configuración de zona. El sender espera esa pareja y deja el JPEG en cola hasta que aparezca el JSON; con el directorio actualmente montado no había imágenes ni sidecars para demostrar este paso real.

Hasta que esa evidencia exista, el caso queda en **revisión pendiente**: no es certificación de detección de primera etapa, no es reconciliación de las 2 ventas humanas y no autoriza un despliegue de producción.
