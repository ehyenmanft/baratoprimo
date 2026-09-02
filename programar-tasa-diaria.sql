-- =====================================================================
-- BARATOPRIMO — consulta automática de la tasa BCV
-- ---------------------------------------------------------------------
-- Programa la función tasa-bcv para que se auto-ejecute sola en Supabase
-- mediante pg_cron + pg_net.
--
-- Pega este script completo en el SQL Editor de tu panel de Supabase y ejecútalo.
-- =====================================================================

-- 1. Extensiones necesarias
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 2. Horarios programados (UTC vs Hora Venezuela UTC-4)
--
--    12:30 UTC = 08:30 AM Caracas (Apertura de la jornada)
--    18:30 UTC = 02:30 PM Caracas (Actualización intermedia)
--    21:30 UTC = 05:30 PM Caracas (Publicación oficial valor del día siguiente)
--    22:00 UTC = 06:00 PM Caracas (Respaldo por si el portal del BCV retrasa la publicación)
-- ---------------------------------------------------------------------

-- Limpiar programaciones anteriores si existían
select cron.unschedule('tasa-bcv-manana')      where exists (select 1 from cron.job where jobname = 'tasa-bcv-manana');
select cron.unschedule('tasa-bcv-tarde')       where exists (select 1 from cron.job where jobname = 'tasa-bcv-tarde');
select cron.unschedule('tasa-bcv-cierre')      where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre');
select cron.unschedule('tasa-bcv-cierre-530')  where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-530');
select cron.unschedule('tasa-bcv-cierre-600')  where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-600');

-- 08:30 AM Caracas (12:30 UTC) - Lunes a Viernes
select cron.schedule(
  'tasa-bcv-manana',
  '30 12 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 02:30 PM Caracas (18:30 UTC) - Lunes a Viernes
select cron.schedule(
  'tasa-bcv-tarde',
  '30 18 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 05:30 PM Caracas (21:30 UTC) - Lunes a Viernes: Tasa con Fecha Valor del día siguiente
select cron.schedule(
  'tasa-bcv-cierre-530',
  '30 21 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 06:00 PM Caracas (22:00 UTC) - Lunes a Viernes: Respaldo por retrasos del BCV
select cron.schedule(
  'tasa-bcv-cierre-600',
  '00 22 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- 3. Comprobar que quedaron programadas
-- ---------------------------------------------------------------------
select jobname, schedule, active from cron.job where jobname like 'tasa-bcv%';
