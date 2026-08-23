# Tasa del dólar

BaratoPrimo toma la tasa oficial del BCV una vez al día y la aplica sola. Cada
precio se muestra con su equivalente en la otra moneda, y las facturas guardan la
tasa con la que se emitieron.

---

## Por qué no se consulta desde el navegador

El sitio del BCV no autoriza peticiones desde otros dominios. Si la aplicación
intentara leerlo directamente, el navegador bloquearía la respuesta antes de que
llegara. Por eso la consulta la hace una función en el servidor de Supabase, que
guarda el resultado en la tabla `tasas_cambio`. La aplicación solo lee esa tabla.

Eso trae dos ventajas: la tasa es la misma para todos los dispositivos, y queda
un histórico para explicar una factura vieja con la tasa de aquel día.

---

## Puesta en marcha

### 1. Desplegar la función

Panel → **Edge Functions** → *Deploy a new function* → *Via Editor*. Nombre:
`tasa-bcv`. Pega el contenido de `supabase/functions/tasa-bcv/index.ts` y
despliega.

### 2. Probarla

En la pestaña *Test*, envía una petición vacía. Debe responder algo así:

```json
{ "guardada": true, "fecha": "2026-08-22", "tasa": 236.7568, "fuente": "bcv" }
```

Si responde con `"fuente": "bdv"` o `"respaldo"`, también está bien: significa
que el BCV no contestó y la tasa se obtuvo de la segunda o tercera fuente.

Si responde error 502, mira el campo `intentos`: dice qué falló en cada una.

### 3. Programarla

En el editor SQL, con tu URL y tu llave anon, ejecuta el bloque comentado de la
sección 14 de `baratoprimo_schema.sql`. Programa dos consultas: **8:30 y 14:30**
de Caracas, de lunes a viernes. La segunda existe porque el BCV a veces corrige
la tasa después de publicarla.

Para comprobar que quedó programada:

```sql
select jobname, schedule, active from cron.job;
```

Y para ver si las corridas funcionaron:

```sql
select status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 10;
```

---

## La fecha valor

Esto explica una confusión frecuente. El BCV **publica por la tarde de cada día
hábil la tasa que regirá el siguiente día hábil**, y la etiqueta como *Fecha
Valor*. La del viernes aplica al lunes.

Por eso puedes ver dos números distintos el mismo día:

- **784,6633 · Fecha Valor lunes 24** — lo que muestra bcv.org.ve
- **779,9522** — la que rige hoy, que es la que publican las mesas de cambio de
  los bancos

BaratoPrimo guarda cada tasa **con su fecha valor**, no con la fecha en que se
consultó, y usa la última publicada — la misma que ves en el portal del BCV. El
cintillo lo dice: si la fecha valor todavía no llegó, muestra *"fecha valor
lunes, 24 agosto"* en vez de *"de hoy"*.

Eso además permite explicar una factura vieja con la tasa que regía aquel día,
que es justo lo que hace falta cuando alguien reclama.

## Las tres fuentes

Todas publican la tasa **oficial del BCV**. Se consultan en cascada y se para en
la primera que responda:

1. **bcv.org.ve** — la fuente. Se leen el dólar, el euro y la fecha valor.
2. **bcv.today** — espejo del BCV: mismas monedas y misma fecha valor, servido
   como archivo estático, así que sigue en pie cuando el portal no responde.
3. **ve.dolarapi.com** — republica la oficial. No trae euro.

**El Banco de Venezuela se quitó a propósito.** Su JSON trae la *mesa de
cambio*, que es la tasa vigente hoy, no la que el BCV acaba de publicar.
Mezclarlas hacía que la aplicación mostrara un número distinto al del portal del
BCV, que es el que la gente compara.

La respuesta siempre dice de cuál vino, y esa marca queda guardada junto a la
tasa.

## El euro

Si la fuente lo trae —el portal y su espejo lo traen—, se guarda también la tasa
oficial del euro y se usa al cobrar en efectivo EUR. Si no, manda la tasa manual
del comercio. El cintillo muestra las dos monedas.

**Si las tres fallan no se guarda nada.** La aplicación sigue usando la última
tasa conocida y avisa de que está vieja. Una tasa inventada es peor que una tasa
vieja, porque la vieja al menos se nota.

---

## Cómo la usa la aplicación

**Cada precio con su equivalente.** El catálogo se carga y se muestra en dólares,
con el equivalente en bolívares al lado, a la tasa del día. En el formulario de
producto el equivalente se actualiza mientras escribes, para no equivocarse de
orden de magnitud.

**Las facturas se emiten en bolívares.** Al vender, cada precio del catálogo se
convierte con la tasa vigente y el comprobante queda expresado en bolívares. El
renglón recuerda entre paréntesis el precio en dólares, y el ticket imprime la
tasa aplicada y el equivalente del total.

**En Mi comercio se elige el comportamiento:**

- *Tasa automática* activada: manda la del BCV. Es lo recomendado.
- *Tasa automática* desactivada: manda la que escribas a mano. Útil si tu
  comercio trabaja con una tasa distinta a la oficial.
- *Moneda de los precios*: en cuál está escrito tu catálogo, bolívares o
  dólares. **De fábrica viene en dólares.**

Cambiar esa opción **no convierte los precios existentes**: los números guardados
siguen siendo los mismos y solo cambia cómo se leen. Si tenías el catálogo en
bolívares y pasas a dólares, usa **Productos → Convertir precios**: divide costo
y precio entre la tasa vigente, con vista previa y pidiendo escribir CONVERTIR
para confirmar. Úsalo **una sola vez**; repetirlo volvería a dividir todo.

**Las facturas guardan la tasa del día.** El campo `tasa_referencia` de cada
venta conserva la que se aplicó. Una factura de hace un mes se explica con la
tasa de aquel día, no con la de hoy — que es justo lo que hace falta cuando
alguien reclama.

**Las cuotas de crédito van en dólares** y se cobran al cambio del día del abono.
Eso ya funcionaba así y ahora la tasa la pone el BCV sola.

---

## Si el BCV no publica

Pasa en feriados y a veces sin motivo. La aplicación sigue con la última tasa y
marca en naranja cuántos días tiene. Un administrador puede escribir la tasa a
mano desde **Mi comercio**; queda guardada con la marca `manual` para que se
sepa que no vino del BCV.

---

## Si deja de funcionar

Lo más probable es que el BCV haya cambiado su maquetado. Síntoma: la función
responde con `"fuente": "bdv"` de forma sistemática, o directamente con error.

El código busca la tasa de tres maneras dentro de la página, así que aguanta
cambios menores. Si cambiaran del todo, hay que ajustar la función `desdeBCV()`
en `supabase/functions/tasa-bcv/index.ts`. Mientras tanto, las otras dos fuentes
mantienen la aplicación andando.
