-- =====================================================================
-- Cómo va la consulta automática de la tasa
-- Ejecuta esto cuando quieras revisar que sigue funcionando.
-- =====================================================================

-- Qué hay programado
select jobname, schedule, active from cron.job where jobname like 'tasa-bcv%';

-- Cómo fueron las últimas corridas
select j.jobname,
       d.status,
       d.start_time at time zone 'America/Caracas' as hora_caracas,
       d.return_message
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
 where j.jobname like 'tasa-bcv%'
 order by d.start_time desc
 limit 10;

-- Qué tasas hay guardadas
select moneda, fecha, tasa, fuente,
       obtenida_en at time zone 'America/Caracas' as obtenida_caracas
  from tasas_cambio
 order by fecha desc, moneda
 limit 10;

-- Para quitar la programación, si hiciera falta:
--   select cron.unschedule('tasa-bcv-manana');
--   select cron.unschedule('tasa-bcv-tarde');
--   select cron.unschedule('tasa-bcv-cierre');
