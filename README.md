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
