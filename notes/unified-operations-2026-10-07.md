# Ojala: una web de operación asistida
Fecha: 2026-10-07. Decisión de producto: ampliar el dashboard existente para computadora y celular. La Beelink conserva captura e inferencia; el operador trabaja en la web. No esperar a una precisión perfecta para mostrar evidencia y apoyar revisión.

## Qué permite ofrecer
Una herramienta para reunir el cierre de ventas, evidencia de cámara y discrepancias revisables. Reduce búsqueda de fotos y trabajo de conciliación; estos beneficios aún requieren medición de tiempo ahorrado. No prometer conteo exacto, ventas certificadas, detección de robo ni porcentaje de precisión sin validación independiente.

## Primera mejora implementada en esta rama
- Panel Sales & camera evidence dentro de /dashboard, usando la consulta autenticada existente dashboard.daily.
- Venta capturada en el cierre, conteo recibido, fuente/cobertura, fecha de recepción y diferencia revisable juntos.
- Distingue ausencia de registro de cero reportado; valida fecha, handoff y enteros no negativos.
- Muestra evidencia parcial expresamente como parcial; no la compara con el cierre diario.
- Los registros heredados sin método/cobertura siguen visibles como no clasificados.
- Solo calcula diferencia aritmética cuando la fuente declara unidades físicas únicas revisadas y cobertura completa, con metadatos de procedencia.
- El hash declarado identifica el registro de origen; la UI no verifica el archivo original ni demuestra exactitud del detector.
- Elimina el criterio arbitrario de +/-5 vasos “Aligned with POS”.
- Mantiene la etiqueta Camera cup count y hace visible su explicación.
- Accesos a cierre y reportes existentes. La referencia manual aún no está conectada.
- Sin nuevas escrituras, endpoints, migraciones, librerías ni cambios al emisor. No implica despliegue.

## Siguiente módulo: evidencia y revisión dentro de la misma web
Reutilizar el filtro visual/bandeja ya preparados en PR7 y su cadena de dependencias, después de verificar qué se integró realmente. No desarrollar una segunda cola incompatible.
- Beelink envía candidatos autenticados con imagen, cupEventId, cámara, fecha UTC y tienda derivada del servidor.
- Deduplicación por tienda/cámara/evento. Ese ID evita reenvíos, pero no evita que varios tracks representen el mismo vaso.
- Estados de evidencia: pendiente, aprobado por IA, descartado, revisión humana.
- Un aprobado por IA significa evidencia útil. La cantidad visible en una imagen no incrementa ventas ni constituye automáticamente una entrega.
- Revisión de unidades: vincular eventos del mismo vaso, cantidad confirmada, descartes, reapariciones y motivo de corrección. Guardar usuario, fecha y versión anterior.
- Una vista por día muestra candidatos, evidencia revisada y lo pendiente. El total diario puede permanecer desconocido mientras la evidencia parcial sea útil.
- Imágenes privadas por tienda mediante acceso autenticado; no exponer Frigate, RTSP ni credenciales en el navegador.
- Cola local persistente y reintentos tras cortes. Fallo de IA conserva pendiente, no aprueba.
- Salud: último heartbeat, última imagen y retraso de sincronización, distintos del último conteo recibido. La ausencia de eventos no prueba que la cámara esté caída.
- Elegir umbrales y automatización futura con evidencia de desempeño; no inventar una tolerancia fija para declarar exactitud.

## Ventas, manual y cierre
Usar ventas introducidas en el cierre como fuente comercial actual, marcadas como captura manual del cierre. No asumir sincronización POS.
Añadir después un formulario de conteo manual independiente, por tienda/fecha/intervalo/autor. Las correcciones deben conservar auditoría y no copiar el dato de cámara a la referencia humana.
Comparar fuentes con la misma definición de recipiente e intervalo. Mostrar onzas e inventario por separado; no convertir cámara a onzas por un tamaño supuesto.
Dejar causas revisables de diferencia: cobertura incompleta, identidad duplicada, omisión probable, muestra, recipiente no contemplado, error de captura o sin resolver. Una discrepancia por sí sola no prueba pérdida.
La Fase3 CSV/API Shopify sigue aplazada. Existe código CSV en el repo, pero este cambio no lo activa ni declara una integración POS completa.

## Secuencia de entrega
1. Revisar y publicar esta mejora de presentación por el flujo real de Manus.
2. Comprobar en la publicación estados sin datos, cero, parcial, heredado y completo; capturar evidencia del runtime desplegado.
3. Integrar bandeja visual y seguimiento de unidades con aislamiento de tienda y migración exacta revisada. PR3 fusionado en rama no demuestra aislamiento en producción.
4. Añadir conteo manual persistente y estado de equipo.
5. Validar con días reales. Medir tiempo de revisión, falsos positivos, omisiones y cobertura por separado.
La comparación de días completos sigue necesaria para afirmar desempeño, pero no bloquea el uso asistido de evidencia parcial.

## Estado y límites
Base local y remota comprobada el7/10: main f6b78b63fe65e08c5be6a6d9590dd1bf0a77e37f.
No se importaron datos reales ni imágenes a esta rama. Los fixtures de prueba son sintéticos.
El emisor actual bloquea parciales: no levantar ese bloqueo solo por existir esta rama. Primero verificar publicación, contrato y que todas las vistas que consuman el número preserven cobertura.
No se aplicaron migraciones ni se modificó la configuración de cámaras/producción.
La UI conserva el idioma inglés del dashboard existente.

## Referencia técnica
Frigate documenta IDs por objeto rastreado y actualizaciones de snapshots/eventos: https://docs.frigate.video/integrations/mqtt/ y https://docs.frigate.video/configuration/snapshots/ . Esa identidad técnica no acredita una entrega ni identidad física única a través de reapariciones.
