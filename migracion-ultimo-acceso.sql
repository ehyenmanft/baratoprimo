-- =====================================================================
-- MIGRACIÓN: Agregar campo ultimo_acceso a la tabla operadores
-- ---------------------------------------------------------------------
-- Ejecutar este script en el SQL Editor de Supabase para agregar el
-- campo que registra la última vez que cada operador inició sesión.
-- Es seguro ejecutarlo más de una vez: no falla si la columna ya existe.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operadores' AND column_name = 'ultimo_acceso'
  ) THEN
    ALTER TABLE operadores ADD COLUMN ultimo_acceso timestamptz;
    COMMENT ON COLUMN operadores.ultimo_acceso IS
      'Marca de tiempo de la última vez que el operador inició sesión.';
  END IF;
END $$;
