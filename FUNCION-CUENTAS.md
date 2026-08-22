# Contraseñas de los operadores

Cuando un administrador da de alta un operador, puede asignarle ahí mismo su
contraseña: hay dos campos, escribirla y repetirla, y se comprueban mientras se
escribe.

Lo que ocurre por debajo depende de si desplegaste la función de administración.

---

## Sin la función: alta directa

Es lo que funciona **sin configurar nada**. Al guardar el operador con una
contraseña, la aplicación da de alta la cuenta usando la llave pública.

Qué se puede y qué no:

| | Sin la función | Con la función |
|---|---|---|
| Crear la cuenta al dar de alta el operador | Sí | Sí |
| Crearla después, editando su ficha | Sí | Sí |
| **Cambiar** una contraseña que ya existe | No | Sí |
| Entrar sin confirmar el correo | Depende del proyecto | Sí, siempre |

Los campos de contraseña **nunca están bloqueados**. Si el operador todavía no
tiene cuenta, escribir ahí se la crea, aunque estés editando su ficha. Solo
falla cuando la cuenta ya existe y no hay función desplegada, y entonces el
mensaje lo dice con esas palabras.

Dos cosas que conviene revisar en el panel de Supabase, en
**Authentication → Providers → Email**:

- **Confirm email**: si está activado, el operador recibirá un correo y no podrá
  entrar hasta abrirlo. Para un comercio suele estorbar más que ayudar; si lo
  desactivas, la cuenta sirve de inmediato.
- **Enable signup**: tiene que estar activado, porque es la vía que usa este
  camino. Si prefieres tenerlo desactivado —razonable, evita que cualquiera con
  la llave pública se registre—, entonces necesitas la función.

Aunque alguien se registre por su cuenta, **no podrá hacer nada**: sin una fila
en `operadores` con su correo, las políticas de la base le niegan todo.

### Si alguien olvida su contraseña y no tienes la función

**El panel de Supabase no permite escribir una contraseña nueva.** Puede parecer
que sí, pero esa opción no existe: cambiar la clave de otro usuario solo se hace
desde el servidor. Lo que sí tienes:

1. **Enviar correo de recuperación.** Authentication → Users → el menú de los
   tres puntos junto al usuario → *Send password recovery*. Le llega un enlace
   para elegir contraseña nueva.

   El problema: el servicio de correo que Supabase trae de fábrica está limitado
   a **2 mensajes por hora** y no garantiza la entrega. Para un comercio eso no
   sirve. Si vas por este camino, configura un SMTP propio en Project Settings →
   Authentication → SMTP Settings: sirve Gmail, Zoho, Brevo o cualquiera.

2. **Borrar el usuario y volver a crearlo** con la contraseña nueva, desde la
   misma pantalla. Es brusco pero funciona. **El operador no se pierde**: la
   tabla `operadores` conserva su rol, su comercio y su historial; solo queda
   sin cuenta hasta que la vuelvas a crear con el mismo correo.

3. **Desplegar la función**, que es lo que convierte esto en un trámite de diez
   segundos desde la propia aplicación.

---

## Con la función: administración completa

Es el camino recomendado si vas a manejar varios operadores. Permite crear
cuentas **y cambiar contraseñas** desde la propia aplicación, y no depende de
que el alta pública esté abierta.

### Por qué hace falta un servidor

Crear un usuario con contraseña exige la llave `service_role`, que salta todas
las políticas de seguridad. Esa llave **no puede estar en el navegador**: quien
abriera el código fuente tendría acceso total a la base. La función corre en
Supabase, guarda la llave como variable de entorno y comprueba en el servidor
que quien pide es realmente administrador.

### Desplegarla

Necesitas la CLI de Supabase:

```bash
npm install -g supabase
supabase login
supabase link --project-ref goqqmcibcdaeuienjmuy

# El código ya está en supabase/functions/cuentas/index.ts
supabase functions deploy cuentas
```

Al terminar te dará la URL, con esta forma:

```
https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/cuentas
```

Pégala en `js/config.js`:

```js
FUNCION_CUENTAS: 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/cuentas',
```

Las variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`
las inyecta Supabase sola: no hay que configurarlas.

### Qué comprueba antes de tocar nada

1. Que el token de la sesión sea válido.
2. Que quien llama esté registrado como operador **activo**.
3. Que su rol sea administrador o super administrador.
4. Que el operador destino exista y **pertenezca a su mismo comercio** —salvo
   que quien pide sea super administrador.
5. Que el destino **no sea un super administrador**, a menos que quien pide
   también lo sea.

Es la misma jerarquía que aplican las políticas de la base, repetida aquí porque
la función corre con permisos totales y no puede confiar en ellas.

---

## Si dejas la contraseña vacía

El operador queda registrado con su rol y su comercio, pero sin poder entrar. Es
útil cuando la cuenta la va a crear otra persona, o cuando quieres preparar los
permisos antes de repartir accesos. En la lista aparecerá sin la marca *con
acceso*.

---

## Sobre la contraseña

El mínimo que exige la aplicación son 8 caracteres, y los dos campos deben
coincidir. Supabase puede exigir más: se configura en Authentication →
Providers → Email → *Minimum password length*.

La aplicación **nunca guarda la contraseña**: la manda una vez para crear la
cuenta y no la conserva en ningún sitio. En modo demo directamente no existe, se
simula la asignación para poder probar el flujo.
