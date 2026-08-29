# =====================================================================
# BaratoPrimo — Servidor Túnel Nativo de Venezuela (PowerShell)
# ---------------------------------------------------------------------
# Este script se ejecuta en cualquier máquina con Windows en Venezuela.
# No requiere instalar Node.js ni ningún programa externo.
#
# Escucha en el puerto 3030 y realiza consultas directas a los servidores
# del CNE y SENIAT con la IP local de Venezuela, devolviendo JSON a
# BaratoPrimo y Supabase sin geobloqueo.
# =====================================================================

$port = 3030
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$port/")

try {
    $listener.Start()
} catch {
    # Si requiere permisos para http://+:3030, fallback a localhost
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  BaratoPrimo — Túnel de Consulta Fiscal Activo (IP Venezuela)   " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " Escuchando en: http://localhost:$port/consulta?rif=V19273163" -ForegroundColor Yellow
Write-Host " Presiona Ctrl + C para detener." -ForegroundColor Gray
Write-Host ""

function Parsear-Cne($html, $prefijo, $numero) {
    if (-not $html) { return $null }
    
    $mNombre = [regex]::Match($html, 'Nombre:</b></td>\s*<td[^>]*><b>([^<]+)</b>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $mNombre.Success) {
        $mNombre = [regex]::Match($html, '<b>Nombre:</b>[\s\S]*?<b>([^<]+)</b>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    if (-not $mNombre.Success) {
        $mNombre = [regex]::Match($html, 'Nombre[:\s]*([A-ZÁÉÍÓÚÑ\s]{3,})', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    if (-not $mNombre.Success) { return $null }

    $nombre = $mNombre.Groups[1].Value.Trim() -replace '\s+', ' '
    if ($nombre.Length -lt 3 -or $nombre.Contains('No se encuentra')) { return $null }

    $mEstado = [regex]::Match($html, 'Estado:</b></td>\s*<td[^>]*>([^<]+)</td>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $mMunicipio = [regex]::Match($html, 'Municipio:</b></td>\s*<td[^>]*>([^<]+)</td>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $mParroquia = [regex]::Match($html, 'Parroquia:</b></td>\s*<td[^>]*>([^<]+)</td>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

    $dirPartes = @()
    if ($mParroquia.Success) { $dirPartes += $mParroquia.Groups[1].Value.Trim() }
    if ($mMunicipio.Success) { $dirPartes += $mMunicipio.Groups[1].Value.Trim() }
    if ($mEstado.Success) { $dirPartes += $mEstado.Groups[1].Value.Trim() }
    $dir = $dirPartes -join ', '

    $nac = if ($prefijo.ToUpper() -eq 'E') { 'E' } else { 'V' }

    return @{
        encontrado = $true
        coinciden = $true
        rif = "$nac$numero".ToUpper()
        rif_formateado = "$nac-$numero"
        nombre = $nombre
        tipo_persona = 'natural'
        es_agente_retencion = $false
        retencion_iva_porcentaje = 0
        retencion_islr_porcentaje = 0
        contribuyente_iva = 'SI'
        direccion = $dir
        fuente = 'CNE-Tunel-Local'
    }
}

function Parsear-Seniat($xml, $rif) {
    if (-not $xml) { return $null }

    $mNombre = [regex]::Match($xml, '<seniat:Nombre>([\s\S]*?)</seniat:Nombre>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $mNombre.Success) {
        $mNombre = [regex]::Match($xml, 'Nombre[:\s]*([^\n\r<]+)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    if (-not $mNombre.Success) { return $null }

    $nombre = $mNombre.Groups[1].Value.Trim() -replace '\s+', ' '
    if ($nombre.Length -lt 2) { return $null }

    $mAgente = [regex]::Match($xml, '<seniat:AgenteRetencionIVA>([\s\S]*?)</seniat:AgenteRetencionIVA>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $esAgente = ($mAgente.Success -and $mAgente.Groups[1].Value.Trim().ToUpper() -eq 'SI') -or $xml.ToUpper().Contains('AGENTE DE RETENCION')

    $mTasa = [regex]::Match($xml, '<seniat:Tasa>([\s\S]*?)</seniat:Tasa>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $tasa = if ($mTasa.Success) { [int]$mTasa.Groups[1].Value.Trim() } else { if ($esAgente) { 75 } else { 0 } }

    $prefijo = $rif.Substring(0, 1).ToUpper()
    $numero = $rif.Substring(1)

    return @{
        encontrado = $true
        coinciden = $true
        rif = $rif.ToUpper()
        rif_formateado = "$prefijo-$numero"
        nombre = $nombre
        tipo_persona = if (@('J', 'G', 'C').Contains($prefijo)) { 'juridica' } else { 'natural' }
        es_agente_retencion = $esAgente
        retencion_iva_porcentaje = if ($esAgente) { $tasa } else { 0 }
        retencion_islr_porcentaje = if ($esAgente) { 2 } else { 0 }
        contribuyente_iva = 'SI'
        fuente = 'SENIAT-Tunel-Local'
    }
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # Encabezados CORS
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Headers", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS")
        $response.ContentType = "application/json; charset=utf-8"

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        $rawRif = $request.QueryString["rif"]
        if (-not $rawRif) { $rawRif = $request.QueryString["cedula"] }
        
        $limpio = ($rawRif -replace '[^a-zA-Z0-9]', '').ToUpper()

        if (-not $limpio -or $limpio.Length -lt 5) {
            $response.StatusCode = 400
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"encontrado":false,"error":"RIF o Cédula inválida"}')
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
            $response.Close()
            continue
        }

        $prefijo = $limpio.Substring(0, 1)
        $numero = $limpio.Substring(1)
        $esNatural = ($prefijo -eq 'V' -or $prefijo -eq 'E')

        $resultado = $null

        # 1. Si es natural, consultar CNE
        if ($esNatural) {
            try {
                $cneUrl = "http://www.cne.gob.ve/web/registro_electoral/ce.php?nac=$prefijo&ced=$numero"
                $cneHtml = (Invoke-WebRequest -Uri $cneUrl -TimeoutSec 5 -UserAgent "Mozilla/5.0").Content
                $resultado = Parsear-Cne $cneHtml $prefijo $numero
            } catch {
                # Fallback a SENIAT
            }
        }

        # 2. Si no es natural o CNE no respondió, consultar SENIAT
        if (-not $resultado) {
            try {
                $seniatUrl = "http://contribuyente.seniat.gob.ve/getContribuyente/getContribuyente?p_rif=$limpio"
                $seniatXml = (Invoke-WebRequest -Uri $seniatUrl -TimeoutSec 5 -UserAgent "Mozilla/5.0").Content
                $resultado = Parsear-Seniat $seniatXml $limpio
            } catch {
                # Error en ambos
            }
        }

        if ($resultado) {
            Write-Host "[OK] $limpio -> $($resultado.nombre)" -ForegroundColor Green
            $response.StatusCode = 200
            $json = $resultado | ConvertTo-Json -Depth 3
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            Write-Host "[NO ENCONTRADO] $limpio" -ForegroundColor Yellow
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"encontrado":false,"error":"No encontrado en servidores oficiales"}')
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }

        $response.Close()
    } catch {
        # Continuar con el siguiente request
    }
}
