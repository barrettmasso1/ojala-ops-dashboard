# Ojala: verificacion del 21 de octubre de 2026

Responsable: Anhec/Uriel. Este cambio no pide nuevas claves y no modifica camara, modelo v4, umbrales, ventas, inventario ni conteos aprobados.

## Cambios instalados en la Beelink

- El lote visual se selecciona antes de cargar videos y se limita a cinco eventos nuevos. No depende de validar ni adjuntar un conteo diario.
- Los eventos ya pertenecientes a un paquete conservan esa identidad. Un ZIP faltante, alterado o con una ruta no permitida bloquea la operacion; no se convierte silenciosamente en una lista vacia que permita reenviarlo.
- Emisor, lector de recibos y revision fisica aceptan los paquetes del archivo externo verificado, con ruta exacta, SHA-256, identidad UUID y reserva de 8 GiB.
- El archivador comparte el bloqueo del bridge y guarda informes fechados sin sobrescribir el primer comprobante de limpieza.
- Una tarea Manus ocupada posterga el intento cinco minutos. El ciclo concilia acuses antes de preparar otro lote.
- Una sesion manual con Frigate ya encendido puede utilizar el relevo. El supervisor no enciende Frigate ni cambia sus horarios; fuera de actividad termina sin red.
- Los recibos previamente aceptados pero no refrescados no se muestran como nuevos pendientes. audit_delivery_receipts.py cruza identificadores y hashes sin modificar la cola directa.
- La recuperacion offline se bloquea antes de empezar si Frigate esta activo, falta el disco/UUID esperado, quedan menos de 8 GiB o la temperatura llega a 85 C. Conserva un snapshot SQLite atomico y no reutiliza uno corrupto.
- Finalizar una muestra de recuperacion NO se informa como revision completa del turno. No se crean conteos desde fotos o tracks.

## Evidencia de aceptacion

107 pruebas de regresion Python pasaron. Se verifico la lectura real de un paquete archivado del 18/oct con 12 eventos y 63 archivos originales.

Se revalidaron seis acuses administrativos locales: 55 imagenes distintas de 16-18/oct, con identidades y hashes coincidentes. No fueron 55 envios nuevos. La cola directa queda intacta y separada.

Prueba tecnica de camara del 21/oct 10:53:59-10:55:27 America/Mazatlan: diez muestras; cuatro de arranque y seis a 5.0-5.1 FPS de proceso, sin FPS omitidos en esas seis. Temperatura observada 61-78 C. El contenedor volvio a su estado previo apagado. No se produjo una venta, un conteo ni un evento de vaso para simular una entrega.

## Alcance honesto de una demo

Puede demostrarse la captura real, la evidencia historica persistida, los recibos, el refresco del dashboard y los estados pendientes/parciales. Los datos reales pueden alimentar una demo sin convertirlos en ventas ficticias.

No esta acreditado un total automatico completo del turno ni una latencia nueva captura-a-dashboard con este ciclo: durante la prueba tecnica no hubo un candidato nuevo. El intervalo de cinco minutos del programador no es una garantia de latencia final de Manus.

La via Frigate HTTP directa permanece pausada por el rechazo de Cloudflare documentado. La via operativa es la API oficial privada de Manus; no se ha evadido el borde.

Los parciales historicos no deben mostrarse como ventas ni como totales completos. La coincidencia aproximada del 90% es un resultado reportado por el usuario, no precision/recall validado ni multiplicador de conteos.

## Auditoria y reversibilidad

Backups y hashes previos: /home/ojala/frigate/pilot-reports/2026-10-21/hardening-v1/before/.

Pruebas: hardening-v1/full-regression-final.log. Prueba fisica: bounded-camera-check.json. Conciliacion: manus-bridge/state/effective-delivery-status.json.

No publicar datos personales, claves, URLs privadas, RTSP, fotos o paquetes de video en este repositorio. Los cambios son codigo y documentacion; no son una migracion ni un nuevo despliegue de la interfaz.


## Follow-up completion after manual camera sessions

The installed supervisor now reconciles already staged batches even after a
manual session ends outside the normal Fri-Sun window. It does not restart
Frigate and does not collect new snapshots in this follow-up-only state.
Uncertain dispatches continue to use reconciliation, not blind resend.
Corrupt pending-queue state fails closed. Existing explicit transport holds
remain in effect. The current Python regression suite passes 113 tests.

An incremental acceptance check uses one immutable original snapshot from
2026-10-09, not a fresh live capture or a simulated sale. Its local immutable
attempt record is under pilot-reports/2026-10-21/incremental-acceptance/.
Task acceptance alone is not final dashboard receipt. Private receipts, images,
credentials and active databases are intentionally excluded from this commit.
