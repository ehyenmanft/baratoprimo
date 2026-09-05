-- =====================================================================
-- BARATOPRIMO — consulta automática de la tasa BCV (Horario Extendido)
-- ---------------------------------------------------------------------
-- Programa la función tasa-bcv para que se auto-ejecute sola en Supabase
-- mediante pg_cron + pg_net.
--
-- Cubre los retrasos habituales del BCV los viernes en la tarde/noche
-- (mesas de cambio con Fecha Valor del lunes) y revisiones de fin de semana.
--
-- Pega este script completo en el SQL Editor de tu panel de Supabase y ejecútalo.
-- =====================================================================

-- 1. Extensiones necesarias
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 2. Limpiar programaciones anteriores si existían
-- ---------------------------------------------------------------------
select cron.unschedule('tasa-bcv-manana')       where exists (select 1 from cron.job where jobname = 'tasa-bcv-manana');
select cron.unschedule('tasa-bcv-tarde')        where exists (select 1 from cron.job where jobname = 'tasa-bcv-tarde');
select cron.unschedule('tasa-bcv-cierre')       where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre');
select cron.unschedule('tasa-bcv-cierre-530')   where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-530');
select cron.unschedule('tasa-bcv-cierre-600')   where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-600');
select cron.unschedule('tasa-bcv-cierre-615')   where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-615');
select cron.unschedule('tasa-bcv-cierre-700')   where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-700');
select cron.unschedule('tasa-bcv-cierre-745')   where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-745');
select cron.unschedule('tasa-bcv-cierre-830')   where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-830');
select cron.unschedule('tasa-bcv-cierre-930')   where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre-930');
select cron.unschedule('tasa-bcv-finde-manana') where exists (select 1 from cron.job where jobname = 'tasa-bcv-finde-manana');
select cron.unschedule('tasa-bcv-finde-tarde')  where exists (select 1 from cron.job where jobname = 'tasa-bcv-finde-tarde');

-- ---------------------------------------------------------------------
-- 3. Programación extendida (UTC vs Hora Venezuela UTC-4)
--
-- JORNADA BANCARIA (Lunes a Viernes):
--   08:30 AM Caracas = 12:30 UTC
--   02:30 PM Caracas = 18:30 UTC
--
-- CIERRE Y FECHA VALOR DÍA SIGUIENTE / FIN DE SEMANA:
--   05:30 PM Caracas = 21:30 UTC
--   06:15 PM Caracas = 22:15 UTC
--   07:00 PM Caracas = 23:00 UTC
--   07:45 PM Caracas = 23:45 UTC
--   08:30 PM Caracas = 00:30 UTC (día siguiente en UTC)
--   09:30 PM Caracas = 01:30 UTC (día siguiente en UTC)
--
-- FINES DE SEMANA (Sábado y Domingo):
--   08:30 AM Caracas = 12:30 UTC
--   01:00 PM Caracas = 17:00 UTC
-- ---------------------------------------------------------------------

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

-- 05:30 PM Caracas (21:30 UTC) - Lunes a Viernes (Primera publicación habitual)
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

-- 06:15 PM Caracas (22:15 UTC) - Lunes a Viernes
select cron.schedule(
  'tasa-bcv-cierre-615',
  '15 22 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 07:00 PM Caracas (23:00 UTC) - Lunes a Viernes
select cron.schedule(
  'tasa-bcv-cierre-700',
  '00 23 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 07:45 PM Caracas (23:45 UTC) - Lunes a Viernes
select cron.schedule(
  'tasa-bcv-cierre-745',
  '45 23 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 08:30 PM Caracas (00:30 UTC del día siguiente) - Todos los días
select cron.schedule(
  'tasa-bcv-cierre-830',
  '30 00 * * *',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 09:30 PM Caracas (01:30 UTC del día siguiente) - Todos los días
select cron.schedule(
  'tasa-bcv-cierre-930',
  '30 01 * * *',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- FIN DE SEMANA: 08:30 AM Caracas (12:30 UTC) - Sábados y Domingos
select cron.schedule(
  'tasa-bcv-finde-manana',
  '30 12 * * 0,6',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- FIN DE SEMANA: 01:00 PM Caracas (17:00 UTC) - Sábados y Domingos
select cron.schedule(
  'tasa-bcv-finde-tarde',
  '00 17 * * 0,6',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- 4. Ejecutar una consulta inmediata de prueba
-- ---------------------------------------------------------------------
select net.http_post(
  url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
  headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI"}'::jsonb,
  body    := '{}'::jsonb
);

-- ---------------------------------------------------------------------
-- 5. Comprobar que quedaron programadas
-- ---------------------------------------------------------------------
select jobname, schedule, active from cron.job where jobname like 'tasa-bcv%' order by jobname;
