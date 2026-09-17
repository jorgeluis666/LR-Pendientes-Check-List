# LR Pendientes

Version publica de LR Suite enfocada en tres modulos:

- Pendientes colaborativos por workspace.
- Usuarios, invitaciones y roles por workspace.
- Contactabilidad con clientes sincronizados desde Google Sheets.

## Configuracion

1. Instala dependencias con `npm install`.
2. Crea `.env.local` con:

```bash
NEXT_PUBLIC_SUPABASE_URL=tu_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
```

3. En Supabase ejecuta, en orden, `src/modules/usuarios/BBDD/schema.sql`, `src/modules/lista-pendientes/BBDD/schema.sql` y `src/modules/contactabilidad/BBDD/schema.sql`.
4. Levanta la app con `npm run dev`.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`

## Modo de bajo consumo de Supabase

La aplicacion agrupa ediciones consecutivas antes de escribir, consolida el orden del tablero
en una sola llamada, retrasa las recargas de Realtime y limita cada lectura del historial a
los 250 registros mas recientes. Esto reduce escrituras, mensajes y transferencia para
mantener el proyecto dentro de las cuotas del plan Free.

La sincronizacion de Contactabilidad compara primero el Google Sheet con los clientes
existentes y solo escribe filas nuevas o modificadas.

## Despliegue en GitHub Pages

El repositorio incluye un workflow en `.github/workflows/deploy-pages.yml` que publica la exportacion estatica de Next en GitHub Pages cuando se hace push a `main`.

Para que la app publicada se conecte a Supabase, configura estos secrets en GitHub:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

En GitHub, revisa tambien que Pages use `GitHub Actions` como fuente de despliegue.
