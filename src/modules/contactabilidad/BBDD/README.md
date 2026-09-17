# Base de datos de Contactabilidad

Ejecuta `schema.sql` en el SQL Editor de Supabase despues de los esquemas de `usuarios` y `lista-pendientes`.

El modulo usa tres tablas:

- `contactabilidad_clientes`: copia sincronizada de la lista del Google Sheet, consolidada por RUC.
- `contactabilidad_contactos`: historial de fechas, canales y notas de contacto.
- `contactabilidad_semanas`: confirmacion semanal del reporte y de la reunion de presentacion.

La aplicacion lee el Sheet mediante Google Visualization. El archivo debe permitir lectura mediante enlace. Los roles `owner`, `admin` y `editor` pueden sincronizar y editar; `viewer` tiene acceso de solo lectura.
