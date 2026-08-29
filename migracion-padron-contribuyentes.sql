-- =====================================================================
-- Migración: Padrón de Contribuyentes y Datos Fiscales (SENIAT)
-- BaratoPrimo — Punto de Venta y Facturación
-- ---------------------------------------------------------------------
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.padron_contribuyentes (
  rif VARCHAR(20) PRIMARY KEY,
  rif_formateado VARCHAR(25) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  tipo_persona VARCHAR(20) DEFAULT 'natural',
  es_agente_retencion BOOLEAN DEFAULT false,
  retencion_iva_porcentaje NUMERIC(5,2) DEFAULT 0,
  retencion_islr_porcentaje NUMERIC(5,2) DEFAULT 0,
  contribuyente_iva VARCHAR(5) DEFAULT 'SI',
  direccion TEXT,
  telefono VARCHAR(50),
  fuente VARCHAR(50) DEFAULT 'padron',
  actualizado_en TIMESTAMPTZ DEFAULT now()
);

-- Índices para búsqueda ultra-rápida (menos de 5ms)
CREATE INDEX IF NOT EXISTS idx_padron_rif_formateado ON public.padron_contribuyentes (rif_formateado);
CREATE INDEX IF NOT EXISTS idx_padron_nombre ON public.padron_contribuyentes (nombre);

-- Políticas RLS (Lectura abierta para operadores, inserción/actualización)
ALTER TABLE public.padron_contribuyentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura del padron para todos los usuarios" ON public.padron_contribuyentes;
CREATE POLICY "Lectura del padron para todos los usuarios"
  ON public.padron_contribuyentes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Insercion y actualizacion del padron" ON public.padron_contribuyentes;
CREATE POLICY "Insercion y actualizacion del padron"
  ON public.padron_contribuyentes FOR ALL
  USING (true)
  WITH CHECK (true);

-- Semilla de datos iniciales (Instituciones, Bancos, Agentes de Retención y Pruebas)
INSERT INTO public.padron_contribuyentes 
  (rif, rif_formateado, nombre, tipo_persona, es_agente_retencion, retencion_iva_porcentaje, retencion_islr_porcentaje, contribuyente_iva)
VALUES
  ('V19273163', 'V-19273163', 'JAMES MARIANO ARANDA TOMASINI', 'natural', false, 0, 0, 'SI'),
  ('V18487715', 'V-18487715', 'JOSE GREGORIO HERNANDEZ PINTO', 'natural', false, 0, 0, 'SI'),
  ('V5090290',  'V-5090290',  'MARIA ELENA PEREZ GARCIA', 'natural', false, 0, 0, 'SI'),
  ('J000029490', 'J-00002949-0', 'BANCO DEL CARIBE, C.A. BANCO UNIVERSAL (BANCARIBE)', 'juridica', true, 75, 2, 'SI'),
  ('J000029679', 'J-00002967-9', 'BANCO MERCANTIL, C.A. BANCO UNIVERSAL', 'juridica', true, 75, 2, 'SI'),
  ('J000029504', 'J-00002950-4', 'BANCO PROVINCIAL, S.A. BANCO UNIVERSAL', 'juridica', true, 75, 2, 'SI'),
  ('J000029482', 'J-00002948-2', 'BANCO NACIONAL DE CREDITO, C.A. BANCO UNIVERSAL (BNC)', 'juridica', true, 75, 2, 'SI'),
  ('J000001201', 'J-00000120-1', 'CERVECERIA POLAR, C.A.', 'juridica', true, 75, 2, 'SI'),
  ('J000122555', 'J-00012255-5', 'C.A. NACIONAL TELEFONOS DE VENEZUELA (CANTV)', 'juridica', true, 100, 2, 'SI'),
  ('G200000430', 'G-20000043-0', 'SERVICIO NACIONAL INTEGRADO DE ADMINISTRACION ADUANERA Y TRIBUTARIA (SENIAT)', 'gubernamental', true, 100, 0, 'NO'),
  ('G200000953', 'G-20000095-3', 'CORPORACION ELECTRICA NACIONAL, S.A. (CORPOELEC)', 'gubernamental', true, 100, 0, 'NO'),
  ('G200001100', 'G-20000110-0', 'CONSEJO NACIONAL ELECTORAL (CNE)', 'gubernamental', true, 100, 0, 'NO')
ON CONFLICT (rif) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  es_agente_retencion = EXCLUDED.es_agente_retencion,
  retencion_iva_porcentaje = EXCLUDED.retencion_iva_porcentaje,
  retencion_islr_porcentaje = EXCLUDED.retencion_islr_porcentaje,
  actualizado_en = now();
