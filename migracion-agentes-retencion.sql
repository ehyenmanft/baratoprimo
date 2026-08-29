-- =====================================================================
-- MIGRACIÓN: Soporte para Agentes de Retención (SENIAT - IVA / ISLR)
-- ---------------------------------------------------------------------
-- Ejecutar este script en el SQL Editor de Supabase.
-- Es seguro ejecutarlo varias veces: comprueba la existencia de columnas
-- y tipos antes de crearlos o alterarlos.
-- =====================================================================

DO $$
BEGIN
  -- 1. Campos en la tabla clientes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clientes' AND column_name = 'es_agente_retencion'
  ) THEN
    ALTER TABLE clientes ADD COLUMN es_agente_retencion boolean NOT NULL DEFAULT false;
    COMMENT ON COLUMN clientes.es_agente_retencion IS
      'Indica si el cliente es Sujeto Pasivo Especial / Agente de Retención designado por el SENIAT.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clientes' AND column_name = 'retencion_iva_porcentaje'
  ) THEN
    ALTER TABLE clientes ADD COLUMN retencion_iva_porcentaje numeric(5,2) NOT NULL DEFAULT 75;
    COMMENT ON COLUMN clientes.retencion_iva_porcentaje IS
      'Porcentaje de retención de IVA aplicable (habitualmente 75% o 100%).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clientes' AND column_name = 'retencion_islr_porcentaje'
  ) THEN
    ALTER TABLE clientes ADD COLUMN retencion_islr_porcentaje numeric(5,2) NOT NULL DEFAULT 0;
    COMMENT ON COLUMN clientes.retencion_islr_porcentaje IS
      'Porcentaje de retención de ISLR si aplica (ej. 1%, 2% para bienes o 2%-5% para servicios).';
  END IF;

  -- 2. Campos en la tabla ventas
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ventas' AND column_name = 'retencion_iva_porcentaje'
  ) THEN
    ALTER TABLE ventas ADD COLUMN retencion_iva_porcentaje numeric(5,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ventas' AND column_name = 'retencion_iva_monto'
  ) THEN
    ALTER TABLE ventas ADD COLUMN retencion_iva_monto numeric(14,2) NOT NULL DEFAULT 0;
    COMMENT ON COLUMN ventas.retencion_iva_monto IS
      'Monto del IVA retenido por el cliente en esta factura.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ventas' AND column_name = 'retencion_islr_porcentaje'
  ) THEN
    ALTER TABLE ventas ADD COLUMN retencion_islr_porcentaje numeric(5,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ventas' AND column_name = 'retencion_islr_monto'
  ) THEN
    ALTER TABLE ventas ADD COLUMN retencion_islr_monto numeric(14,2) NOT NULL DEFAULT 0;
    COMMENT ON COLUMN ventas.retencion_islr_monto IS
      'Monto del ISLR retenido por el cliente en esta factura.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ventas' AND column_name = 'monto_neto_cobrar'
  ) THEN
    ALTER TABLE ventas ADD COLUMN monto_neto_cobrar numeric(14,2) NOT NULL DEFAULT 0;
    COMMENT ON COLUMN ventas.monto_neto_cobrar IS
      'Total de la factura menos las retenciones aplicadas.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ventas' AND column_name = 'comprobante_retencion_iva'
  ) THEN
    ALTER TABLE ventas ADD COLUMN comprobante_retencion_iva text;
    COMMENT ON COLUMN ventas.comprobante_retencion_iva IS
      'Número de comprobante de retención de IVA entregado por el cliente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ventas' AND column_name = 'comprobante_retencion_islr'
  ) THEN
    ALTER TABLE ventas ADD COLUMN comprobante_retencion_islr text;
  END IF;

  -- 3. Valores en el tipo enum metodo_pago
  BEGIN
    ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'retencion_iva';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'retencion_islr';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;

END $$;
