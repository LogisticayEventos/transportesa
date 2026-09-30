# RutaNova · Plataforma de transporte

Sitio web estático preparado para publicarse en **GitHub Pages**. Usa Firebase para autenticación, base de datos en tiempo real y seguridad por perfiles.

## Funciones incluidas

- Panel de administrador: rutas, usuarios, estudiantes, flota, comprobantes de mensualidad, viajes privados y estadísticas.
- Panel de conductor: rutas del día, vehículo, lista de pasajeros, inicio/final del recorrido, recogidas, entregas, duración, kilómetros y GPS.
- Panel de representante: ubicación del vehículo, historial, pagos, envío de comprobantes con foto y días restantes de mensualidad.
- Inicio de sesión con tres perfiles: administrador, conductor y representante.
- Registro público de conductores y representantes, pendiente de aprobación.
- Administrador general protegido: `franboy1221@gmail.com`, con facultad exclusiva para otorgar o retirar el rango **Administrador**.
- Administradores delegados para apoyar la operación, sin permiso para crear otros administradores ni modificar al administrador general.
- Control documental de vehículos con vencimiento de revisión técnica, seguro y FUEC.
- Datos en tiempo real y reglas de acceso independientes por perfil.
- Diseño responsive para computador, tableta y teléfono.

## 1. Habilitar los servicios de Firebase

La web ya está configurada para el proyecto **`trasnportadora`**, conservando esa escritura exacta y los datos de conexión suministrados. Este ZIP actualiza los archivos; los siguientes ajustes deben realizarse en la consola del proyecto.

1. Entra a [Firebase Console](https://console.firebase.google.com/) y abre `trasnportadora`.
2. En **Authentication → Sign-in method**, activa **Correo electrónico/contraseña**.
3. En **Firestore Database**, crea la base de datos predeterminada `(default)` si aún no existe. Usa modo producción y publica las reglas incluidas antes de permitir registros.

## 2. Configurar los archivos

`firebase-config.js` ya contiene la configuración del proyecto y el correo del único administrador general:

```js
export const APP_NAME = "RutaNova";
export const ADMIN_EMAIL = "franboy1221@gmail.com";

export const firebaseConfig = {
  apiKey: "AIzaSyCb2s54q_nMBxRHmGEqW7OJ6MFdnick1Rw",
  authDomain: "trasnportadora.firebaseapp.com",
  projectId: "trasnportadora",
  messagingSenderId: "732726014384",
};
```

La configuración web de Firebase es pública. Las contraseñas solo se envían a Firebase Authentication al registrarse o iniciar sesión; no se guardan en archivos, perfiles de Firestore ni almacenamiento local. No hay contraseña de administrador predefinida. Firebase conserva la sesión mediante sus credenciales de autenticación.

Auth y Firestore funcionan con estos datos. No se incluye un `appId` de ejemplo ni se activa Analytics. Las reglas fijan el correo del administrador general y permiten administradores delegados únicamente cuando él los asigna desde la plataforma.

## 3. Publicar las reglas de seguridad

1. En Firebase abre **Firestore Database → Reglas**.
2. Copia todo el contenido de `firestore.rules`.
3. Pégalo en el editor y pulsa **Publicar**.

Las reglas permiten que cada familia aprobada vea únicamente sus niños, pagos y rutas; cada conductor aprobado ve únicamente sus asignaciones; y el administrador controla la operación. Una cuenta pendiente o inactiva solo puede leer su propio perfil y no puede aprobarse, cambiar su rol ni acceder a datos operativos.

No es necesario habilitar Firebase Storage. Las fotos se comprimen en el navegador y se guardan en un documento protegido de Firestore separado de la solicitud. El comprobante optimizado ocupa como máximo unos 450 KB, por debajo del límite de 1 MiB por documento, y solo se descarga cuando alguien pulsa **Ver foto**. Esto reduce el consumo de la cuota gratuita y mantiene fluida la lista de pagos.

## 4. Habilitar el administrador general

1. En Firebase abre **Authentication → Users**.
2. Si `franboy1221@gmail.com` aún no existe, pulsa **Add user / Agregar usuario**.
3. Usa exactamente `franboy1221@gmail.com` y establece una contraseña directamente en Firebase. Si ya existe, conserva la cuenta y su contraseña.
4. Abre el sitio publicado e inicia sesión. Si el correo no está verificado, pulsa **Enviar verificación**, abre el enlace recibido y pulsa **Ya verifiqué mi correo**. Si ya está verificado, ingresarás directamente.

En el primer ingreso con el correo verificado, la plataforma creará automáticamente el perfil del administrador general. No existe registro público para ese correo.

### Asignar administradores adicionales

1. La persona crea su cuenta como **Conductor** o **Representante**, o el administrador la registra desde **Personas**.
2. Aprueba la cuenta si está pendiente.
3. Inicia sesión con `franboy1221@gmail.com`, entra en **Personas** y pulsa **Editar** sobre esa persona.
4. En **Perfil**, selecciona **Administrador** y deja el estado **Activo**.

El nuevo administrador puede gestionar rutas, personas, estudiantes, flota, pagos y viajes. No puede otorgar o retirar rangos administrativos ni modificar al administrador general. Esa protección también está en `firestore.rules`, no solo en la interfaz.

### Registro público y aprobación

1. La persona pulsa **Crear mi cuenta** en el inicio.
2. Completa nombre, teléfono, perfil **Conductor** o **Representante**, correo y contraseña elegida por ella.
3. Firebase Authentication crea la cuenta y Firestore guarda un perfil con estado **Pendiente de aprobación**.
4. El administrador entra a **Personas**. Las cuentas pendientes aparecen primero y muestra cuántas hay.
5. Pulsa **Aprobar** junto a la persona. También puede abrir **Editar** y elegir **Activo (aprobado)**.
6. La cuenta puede acceder a su panel después de la aprobación. Si ya inició sesión y está en la pantalla de espera, recibirá el acceso automáticamente.

Para retirar el acceso, el administrador elige **Inactivo** en **Editar**. Una sesión abierta pasa a la pantalla de cuenta inactiva y deja de recibir datos operativos. Los usuarios pendientes no aparecen como conductores o representantes disponibles para nuevas asignaciones.

Se conserva **Registrar persona** en el panel del administrador. La nueva cuenta queda pendiente por defecto; seleccionar **Activo (aprobado)** constituye la aprobación explícita del administrador. Se guarda quién aprobó y cuándo, sin guardar contraseñas.

### Pago de mensualidad por el representante

1. El representante entra en **Mensualidades → Reportar pago**.
2. Selecciona el estudiante y completa nombre, documento y teléfono de quien pagó, valor, fecha, período, método y referencia.
3. Adjunta una foto JPG, PNG o WebP del comprobante. La plataforma la reduce y comprime antes de guardarla en Firestore.
4. La solicitud queda **Pendiente** y aparece en el panel de los administradores.
5. El administrador abre la foto y pulsa **Aprobar** o **Rechazar**. Si la rechaza, debe escribir un motivo visible para el representante.
6. Al aprobar, se crea automáticamente el pago, se marca **Pagado** y la mensualidad queda vigente durante 30 días desde la fecha informada.

## 5. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `rutanova`.
2. Sube **todos los archivos de esta carpeta a la raíz del repositorio**.
3. En el repositorio entra a **Settings → Pages**.
4. En **Build and deployment**, selecciona **Deploy from a branch**.
5. Selecciona la rama `main`, carpeta `/ (root)`, y guarda.
6. GitHub mostrará una dirección similar a:

```text
https://TU_USUARIO.github.io/rutanova/
```

7. En Firebase abre **Authentication → Settings → Authorized domains** y agrega:

```text
TU_USUARIO.github.io
```

GitHub Pages puede tardar uno o dos minutos en publicar la primera versión.

## 6. Orden recomendado de configuración

1. Inicia sesión como administrador.
2. Aprueba los registros públicos de conductores y representantes en **Personas**, o crea sus cuentas desde ese panel.
3. Registra los vehículos en **Flota**.
4. Crea las rutas y asigna conductor y vehículo.
5. Inscribe los estudiantes, elige su representante y su ruta.
6. Revisa los comprobantes recibidos o registra manualmente las mensualidades.
7. Si creaste una cuenta desde el panel, entrega sus credenciales a esa persona. Quienes se registran públicamente usan su propia contraseña.

## GPS del teléfono del conductor

- El conductor debe abrir el sitio desde **HTTPS** (GitHub Pages ya usa HTTPS).
- Al iniciar la ruta, debe aceptar el permiso de ubicación precisa.
- Debe mantener la página abierta durante el recorrido. La plataforma intenta mantener activa la pantalla mientras transmite.
- Algunos teléfonos suspenden la ubicación cuando el navegador pasa mucho tiempo en segundo plano o la pantalla se apaga. Para rastreo garantizado con la aplicación totalmente cerrada se necesita una app móvil nativa o híbrida con permiso de ubicación en segundo plano.
- La distancia es calculada a partir de las posiciones GPS recibidas y es una estimación operativa.

## Archivos

| Archivo | Función |
|---|---|
| `index.html` | Estructura principal de la aplicación |
| `style.css` | Diseño profesional y responsive |
| `script.js` | Autenticación, paneles, operaciones y GPS |
| `firebase-config.js` | Datos de conexión y correo administrador |
| `firestore.rules` | Seguridad por perfiles y propietario de datos |
| `favicon.svg` | Ícono provisional de la plataforma |
| `.nojekyll` | Evita transformaciones de Jekyll en GitHub Pages |

## Actualizaciones

Para publicar cambios, modifica los archivos, súbelos nuevamente al repositorio y haz un commit en `main`. GitHub Pages actualizará el sitio automáticamente.

## Recomendaciones antes de operar comercialmente

- Cambia el nombre provisional, textos legales y datos de contacto.
- Prueba los tres perfiles con cuentas de ensayo.
- Define un protocolo para contraseñas, autorización de representantes y tratamiento de datos de menores.
- Activa alertas de facturación y copias de seguridad en Google Cloud/Firebase.
- Valida las obligaciones de privacidad y transporte escolar aplicables en tu país o ciudad.
