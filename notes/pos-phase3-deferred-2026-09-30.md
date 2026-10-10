# Fase 3 POS — referencia aplazada, 30/09/2026

## Decisión de Barrett

La prioridad sigue siendo cerrar el recorrido de conteo real hasta producción.
No iniciar ahora upload nuevo, parsers adicionales, OAuth, sincronización API ni
migraciones POS. Primero: push automático demostrado con un día real, 5–7 días
comparables de cámara/manual/POS e aislamiento por tienda comprobado en producción.
El 12–19 de octubre es una ventana tentativa, condicionada a esos resultados.

Orden posterior: CSV Shopify de Ojala; después otros formatos. APIs: Shopify,
Square, Toast, Clover y finalmente SumUp/Loyverse. Este orden expresa la prioridad
del proyecto, no una validación de porcentajes de mercado o plazos de desarrollo.

## Base existente revisada

- `client/src/lib/shopifySalesCsv.ts` ya está en main (blob
  `68c396b61e3da1f84e31a8cc05b4c446d0a44a1a`, lectura remota del 30/09).
  Lee columnas de un reporte por producto, transforma unidades netas a onzas y
  clasifica el modo de servicio a partir del título; admite `unknown`.
- `ManagerDashboard.tsx`, en el checkout revisado, carga ese resultado en estado
  del navegador para conciliación. No persiste una importación ni reemplaza los
  conteos del cierre. Los tiles for-here/to-go siguen leyendo el reporte diario.
  La presencia de este código no prueba qué versión está publicada.
- PR #5 sigue abierto, sin merge, con cabeza
  `f6e93e71e403fe1d403dafd1effcdb7c42df2053`. Su `stores.posType` ya ofrece
  `none`, `square`, `toast`, `shopify`, `other` como metadato. Clover no tiene valor
  propio aún. Ajustar ese catálogo será parte de una futura migración revisada;
  no alterar hoy 0014 ni crear otra tabla equivalente.

## Límites que debe respetar la integración futura

1. Reutilizar la entrada Shopify y separar el parser del proveedor de la
   representación normalizada. Adaptadores CSV y API deben producir la misma
   representación de ventas, validada en el servidor y asociada a la tienda
   autenticada. El POS no debe escribir conteos de cámara ni ground truth.
2. Mantener por separado unidades físicas, tamaño, modo de servicio y volumen.
   El mapeo SKU/variante a for-here/to-go será configurable por tienda. Un dato
   desconocido o ausente debe requerir revisión; no convertirse en cero ni
   asignarse silenciosamente a to-go.
3. Conservar procedencia: proveedor, tienda, rango del reporte y zona horaria,
   archivo/hash, versión del parser y del mapeo, filas aceptadas/excluidas,
   ajustes y quién confirmó la importación. Vista previa antes de modificar el
   cierre; no reemplazar silenciosamente un cierre ya revisado.
4. Reimportar el mismo archivo no debe duplicar ventas. Con IDs de orden/línea,
   usarlos dentro de la tienda. Con CSV agregados, validar rango y superposición
   y versionar el reemplazo aprobado: el hash solo detecta archivos idénticos,
   no dos exportaciones parcialmente superpuestas.
5. Separar ventas, devoluciones y cancelaciones. Un reembolso posterior no prueba
   que no se entregó físicamente el vaso. Definir la comparación por intervalo
   y base de unidades antes de enfrentar POS neto con cámara o conteo manual.
6. Validar encabezados, números, fechas y exclusiones. Un CSV de cualquier POS
   necesita un formato/adaptador compatible y suficiente detalle; la extensión
   CSV por sí sola no garantiza que pueda distinguir consumo local y para llevar.
7. En la etapa API, credenciales y OAuth pertenecerán a una conexión por tienda,
   separada de Frigate. Cifrado, revocación, permisos mínimos, cursores y reintentos
   se diseñarán entonces. No se guardarán tokens en `posType` ni en el navegador.

## Prioridad actual — comprobación de las 12:30 America/Mazatlan

Beelink accesible. Cron de conteos instalado; `push_config.json` activo ausente;
sin nuevos registros aprobados ni recibos de aceptación. Los últimos resultados
del transporte son `no_pending_records`. Frigate detenido, coincidente con el
horario configurado de miércoles. No se inició como parte de esta revisión.

El mensaje recibido menciona un deployment de hoy. No se recuperó evidencia
administrativa de su versión/base ni una confirmación de credencial activa.
Main todavía contiene el receptor Frigate heredado; eso no identifica por sí
solo al runtime publicado. Hace falta la confirmación del despliegue y del
contrato efectivo para terminar la configuración local, seguido de una prueba
real y lectura del dashboard de la misma fecha/tienda. No enviar ceros de prueba.

Esta nota es documentación local para revisión. No se modificaron código de
producto, esquema, producción ni la integración POS durante este trabajo.
