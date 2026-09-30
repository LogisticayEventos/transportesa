// Configuración pública del proyecto Firebase de RutaNova.
// Las contraseñas se gestionan exclusivamente en Firebase Authentication.
// El correo del administrador también está fijado en firestore.rules.

export const APP_NAME = "RutaNova";
export const ADMIN_EMAIL = "franboy1221@gmail.com";

export const firebaseConfig = {
  apiKey: "AIzaSyCb2s54q_nMBxRHmGEqW7OJ6MFdnick1Rw",
  authDomain: "trasnportadora.firebaseapp.com",
  projectId: "trasnportadora",
  storageBucket: "trasnportadora.firebasestorage.app",
  messagingSenderId: "732726014384",
  // Auth y Firestore no requieren appId. No se incluye un identificador inventado.
};
