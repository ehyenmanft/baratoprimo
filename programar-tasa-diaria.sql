-- =====================================================================
-- BARATOPRIMO — consulta automática de la tasa
-- ---------------------------------------------------------------------
-- Programa la función tasa-bcv para que corra sola, sin que nadie tenga
-- que acordarse.
--
-- ANTES DE EJECUTAR ESTO, en el panel de Supabase:
--   Database → Extensions → activar  pg_cron  y  pg_net
--
-- Y sustituye TU-LLAVE-ANON por tu llave anon, que está en
--   Project Settings → API → Project API keys → anon public
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Extensiones (por si no se activaron desde el panel)
-- ---------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ---------------------------------------------------------------------
-- 2. Las consultas programadas
--
-- Las horas van en UTC, que lleva CUATRO HORAS DE ADELANTO sobre
-- Venezuela. Así que:
--     12:30 UTC = 08:30 en Caracas
--     18:30 UTC = 14:30 en Caracas
--     21:30 UTC = 17:30 en Caracas
--
-- Tres consultas al día, de lunes a viernes:
--   · la de la mañana recoge lo que quedó publicado el día anterior
--   · la de la tarde, por si hubo corrección
--   · la de las 17:30 es la importante: el BCV publica alrededor de las
--     16:30 la tasa que regirá el siguiente día hábil
-- ---------------------------------------------------------------------

-- Si ya existían, se quitan para no duplicarlas
select cron.unschedule('tasa-bcv-manana')  where exists (select 1 from cron.job where jobname = 'tasa-bcv-manana');
select cron.unschedule('tasa-bcv-tarde')   where exists (select 1 from cron.job where jobname = 'tasa-bcv-tarde');
select cron.unschedule('tasa-bcv-cierre')  where exists (select 1 from cron.job where jobname = 'tasa-bcv-cierre');


select cron.schedule(
  'tasa-bcv-manana',
  '30 12 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json",
                 "Authorization": "Bearer TU-LLAVE-ANON"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'tasa-bcv-tarde',
  '30 18 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json",
                 "Authorization": "Bearer TU-LLAVE-ANON"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'tasa-bcv-cierre',
  '30 21 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json",
                 "Authorization": "Bearer TU-LLAVE-ANON"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);


-- ---------------------------------------------------------------------
-- 3. Comprobar que quedaron programadas
-- ---------------------------------------------------------------------

select jobname, schedule, active from cron.job where jobname like 'tasa-bcv%';
