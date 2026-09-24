# Etapa 2: alta en borrador y configuración por tienda

Esta rama agrega `/dashboard/store` para administradores. Un administrador gestiona el nombre, correo, horario y tipo de POS de su propia tienda. El administrador del proyecto configurado por `OWNER_OPEN_ID` en Store 1 puede crear borradores para otras tiendas con zona horaria IANA, tamaños de vaso y Open ID del propietario. El servidor crea la tienda, el usuario propietario y dos credenciales en una transacción; las claves se muestran una sola vez y solo se guardan sus verificadores.

Las tiendas nuevas quedan **inactivas**. La autenticación OAuth, el acceso staff y la ingestión Frigate rechazan una tienda inactiva. Se puede configurar y ensayar el alta sin prometer que la operación multitienda ya esté lista. La página no ofrece un botón para activarlas.

La migración `0014_glossy_silvermane.sql` añade `stores.posType` y `stores.cupSizesJson`; conserva todos los registros y valores existentes. Aplíquela mediante Drizzle solo después de 0012 y 0013, contra la base confirmada y respaldada. No use `db:push` en producción.

## Alcance pendiente antes de activar Store 2

- Los formularios y el dashboard aún usan fechas y tamaños de vaso fijos de Ojala, basados en `America/Los_Angeles`, mientras el registro de Store 1 indica `America/Mazatlan`. Las preferencias de otra tienda son metadatos hasta adaptar y probar todo el flujo por zona horaria y tamaño. Por esa razón `updateProfile` no permite cambiar estos campos en una tienda activa.
- El POS configurado es descriptivo; no existe integración con Square, Toast o Shopify.
- La rotación gestiona credenciales de la tabla `storeCredentials`. Las claves heredadas de Store 1 en variables de entorno siguen activas hasta retirarlas por separado.
- El login staff actual examina hasta 32 credenciales scrypt activas; antes de escalar a más tiendas necesita un selector de tienda verificado o un índice de autenticación distinto.
- No se han hecho merge, migración ni despliegue en la base publicada.

## Ensayo local

Con TiDB aislado en Beelink, restauración y migraciones 0012 y 0013 previas, aplicar 0014 y ejecutar:

```bash
DATABASE_URL=mysql://root@127.0.0.1:4000/ojala_phase1_rehearsal pnpm drizzle-kit migrate
DATABASE_URL=mysql://root@127.0.0.1:4000/ojala_phase1_rehearsal node --import tsx rehearsal/beelink-phase1/scripts/run-store-draft-fixtures.mjs
```

El segundo script comprueba el guard de plataforma, transacción y rollback de propietario duplicado, secretos no guardados, bloqueo de tienda inactiva, cambios limitados a la tienda autenticada, metadatos sin hashes y rotación. Elimina sus fixtures. Solo puede conectarse al destino local fijo.
