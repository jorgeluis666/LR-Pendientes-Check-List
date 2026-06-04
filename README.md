# LR Pendientes

Version publica de LR Suite enfocada en dos modulos:

- Pendientes colaborativos por workspace.
- Usuarios, invitaciones y roles por workspace.

## Configuracion

1. Instala dependencias con `npm install`.
2. Crea `.env.local` con:

```bash
NEXT_PUBLIC_SUPABASE_URL=tu_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
```

3. En Supabase ejecuta primero `src/modules/usuarios/BBDD/schema.sql` y luego `src/modules/lista-pendientes/BBDD/schema.sql`.
4. Levanta la app con `npm run dev`.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`

## Despliegue en GitHub Pages

El repositorio incluye un workflow en `.github/workflows/deploy-pages.yml` que publica la exportacion estatica de Next en GitHub Pages cuando se hace push a `main`.

Para que la app publicada se conecte a Supabase, configura estos secrets en GitHub:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

En GitHub, revisa tambien que Pages use `GitHub Actions` como fuente de despliegue.
