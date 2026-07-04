# Norenty — Runbook de backup / restore

Estado actual: **`DATABASE_URL` no está puesta en `.env`** (`[DECISIÓN D2]`, pendiente). Sin ella,
`backend/db/migrate.py` y los comandos `pg_dump`/`psql` de este documento no son ejecutables desde
esta máquina. Lo de abajo es el procedimiento MANUAL a seguir hoy vía el panel de Supabase, y el
comando exacto a correr en cuanto D2 esté resuelta.

## Qué cubre un backup y qué no

- **Base de datos (Postgres)**: todas las tablas, RLS, funciones, `schema_migrations`. Esto es
  `pg_dump`/el backup automático de Supabase.
- **Storage (buckets `pods` y `documentos`)**: fotos de POD y documentos subidos. **NO está
  incluido en un `pg_dump` de la base de datos** — son objetos en Supabase Storage, un sistema
  aparte. Hay que respaldarlos por separado (ver más abajo).
- **Secretos** (`.env`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`...): nunca van en un
  backup de datos — se gestionan aparte (gestor de contraseñas / Vercel-Railway env vars una vez
  desplegado). Ver `SPECS-7A.md` §0.2 sobre por qué nunca deben verse en texto plano en el chat.

## Backup de la base de datos

### Hoy (sin `DATABASE_URL`): backup automático de Supabase

Supabase hace backups automáticos diarios de los proyectos (retención según el plan). Para
comprobar/descargar uno:

1. Panel de Supabase → tu proyecto (`hloqddmdwinvjksqkhey`) → **Database → Backups**.
2. Ahí se ve la lista de backups automáticos y se puede restaurar a un punto concreto (point-in-time
   restore, según el plan) o descargar un dump.
3. **Esto ya está pasando sin que nadie tenga que hacer nada** — pero nadie lo ha probado (ver
   "Prueba de restore" más abajo). Un backup que nunca se ha restaurado no es un backup de fiar.

### Cuando D2 esté resuelta (`DATABASE_URL` puesta): backup manual desde local

```powershell
# Backup completo (schema + datos) a un archivo con fecha en el nombre
pg_dump "$env:DATABASE_URL" -F c -f "backup_norenty_$(Get-Date -Format yyyyMMdd_HHmmss).dump"
```

`-F c` = formato "custom" de pg_dump (comprimido, permite restore selectivo con `pg_restore
--table=...` si algún día hace falta recuperar solo una tabla).

Requiere tener `pg_dump`/`pg_restore` instalados localmente (vienen con PostgreSQL — no están
instalados en este entorno hoy; si se necesitan, instalar el cliente de PostgreSQL, no todo el
servidor).

## Restore

**Restore completo** (borra y recrea todo — usar con cuidado, típicamente solo para verificar el
proceso contra un proyecto de prueba, NUNCA contra producción sin confirmación explícita del
usuario — esto es una acción irreversible/destructiva, mismo criterio que cualquier `rm -rf` o
`git push --force` de las normas de seguridad de este proyecto):

```powershell
pg_restore -d "$env:DATABASE_URL" --clean --if-exists backup_norenty_XXXXXXXX.dump
```

**Restore selectivo de una tabla** (recuperar sin tocar el resto):

```powershell
pg_restore -d "$env:DATABASE_URL" --table=viaje --clean --if-exists backup_norenty_XXXXXXXX.dump
```

## Backup de Storage (fotos de POD y documentos)

Los buckets `pods` y `documentos` son privados (URLs firmadas, ver migraciones 0011/4.2). Para
respaldarlos hoy, sin script todavía:

1. Panel de Supabase → **Storage** → seleccionar el bucket → descargar carpeta por carpeta (la
   estructura es `{empresa_id}/{viaje_id}/{hito_id}/...` para pods, `{empresa_id}/{ambito}/{entidad_id}/...`
   para documentos).
2. Pendiente (backlog, no bloqueante): un script que use el Storage API de Supabase (con la
   service role key) para descargar todo el bucket a un `.zip` con fecha — pequeño, se puede
   construir cuando D1 (service role key) esté resuelta, ya que el script necesitaría esa clave
   para leer todos los objetos de todas las empresas de una vez.

## Frecuencia recomendada

- **Base de datos**: los backups automáticos diarios de Supabase son suficientes para el volumen
  de hoy (dev/demo). Antes de un piloto con cliente real, subir a un plan con retención mayor y
  activar point-in-time recovery si el plan lo permite.
- **Storage**: sin backup automático propio hoy — es el hueco real. Antes de producción, el script
  de la sección anterior debería correr semanalmente como mínimo.

## Prueba de restore (hacer esto, no asumir que "ya funciona")

Un backup nunca probado es un backup que no existe. Antes de confiar en el proceso:

1. Crear un proyecto Supabase nuevo de prueba (o una rama, si el plan lo soporta — ver
   `list_branches`/`create_branch` del MCP de Supabase, que sí es usable sin `DATABASE_URL`).
2. Restaurar ahí el backup más reciente.
3. Correr `dashboard/lib/smoke.test.js` (ítem 8.1) apuntando a ese proyecto de prueba (cambiando
   `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` temporalmente) — si los smoke tests
   pasan contra la BD restaurada, el restore es de fiar.
4. Repetir esta prueba cada vez que cambie el esquema de forma importante, no solo una vez.

**Estado de esta prueba: NO ejecutada todavía** (requiere D2 y tiempo dedicado — anotado aquí para
que quede pendiente de forma explícita, no silenciosa).
