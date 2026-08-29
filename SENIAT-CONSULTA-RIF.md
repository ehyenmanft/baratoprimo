# Consulta RIF y Agentes de Retención SENIAT

Esta función permite a **BaratoPrimo** autocompletar la Razón Social / Nombre y la condición tributaria de Agente de Retención (75% / 100%) consultando directamente los servidores oficiales del **SENIAT**.

---

## 1. Despliegue en Supabase

Ejecuta el siguiente comando desde la raíz del proyecto para desplegar la Edge Function:

```bash
npx supabase functions deploy consulta-rif --no-verify-jwt
```

> **Nota:** La bandera `--no-verify-jwt` permite que la consulta funcione de forma ágil desde el frontend sin requerir tokens de sesión de usuario, permitiendo consultas rápidas en el punto de venta.

---

## 2. Probar la Función

Puedes probarla con cURL o en el navegador:

```bash
curl "https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/consulta-rif?rif=J403118225"
```

Respuesta esperada:

```json
{
  "encontrado": true,
  "rif": "J403118225",
  "rif_formateado": "J-403118225",
  "nombre": "DISTRIBUIDORA ANDINA C.A.",
  "es_agente_retencion": true,
  "retencion_iva_porcentaje": 75,
  "contribuyente_iva": "SI",
  "fuente": "seniat-directo"
}
```

---

## 3. Configuración en BaratoPrimo

La URL de la función ya viene configurada por defecto en `js/config.js`:

```javascript
FUNCION_SENIAT: 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/consulta-rif'
```
