import { APP_NAME, ADMIN_EMAIL, firebaseConfig } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (selector, root = document) => root.querySelector(selector);
const els = {
  boot: $("#bootScreen"),
  config: $("#configScreen"),
  login: $("#loginScreen"),
  loginForm: $("#loginForm"),
  loginEmail: $("#loginEmail"),
  loginPassword: $("#loginPassword"),
  loginError: $("#loginError"),
  togglePassword: $("#togglePassword"),
  registerForm: $("#registerForm"),
  registerError: $("#registerError"),
  showRegister: $("#showRegister"),
  showLogin: $("#showLogin"),
  account: $("#accountScreen"),
  accountStatusTitle: $("#accountStatusTitle"),
  accountStatusMessage: $("#accountStatusMessage"),
  accountStatusEmail: $("#accountStatusEmail"),
  accountVerificationActions: $("#accountVerificationActions"),
  sendVerification: $("#sendVerification"),
  refreshVerification: $("#refreshVerification"),
  accountLogout: $("#accountLogout"),
  app: $("#appShell"),
  sidebar: $("#sidebar"),
  sidebarNav: $("#sidebarNav"),
  openMenu: $("#openMenu"),
  closeMenu: $("#closeMenu"),
  sidebarBackdrop: $("#sidebarBackdrop"),
  sectionTitle: $("#sectionTitle"),
  today: $("#todayLabel"),
  gpsBadge: $("#gpsBadge"),
  accountAvatar: $("#accountAvatar"),
  accountName: $("#accountName"),
  accountRole: $("#accountRole"),
  logout: $("#logoutButton"),
  main: $("#mainContent"),
  dialog: $("#entityDialog"),
  entityForm: $("#entityForm"),
  modalTitle: $("#modalTitle"),
  modalDescription: $("#modalDescription"),
  modalFields: $("#modalFields"),
  modalError: $("#modalError"),
  closeDialog: $("#closeDialog"),
  cancelDialog: $("#cancelDialog"),
  saveDialog: $("#saveDialog"),
  toastRegion: $("#toastRegion"),
  sidebarBrand: $("#sidebarBrand"),
};

const emptyData = () => ({
  users: [],
  routes: [],
  vehicles: [],
  students: [],
  payments: [],
  paymentRequests: [],
  runs: [],
  events: [],
  trips: [],
});

const state = {
  user: null,
  profile: null,
  section: "",
  data: emptyData(),
  subscriptions: [],
  scopedSubscriptions: [],
  scopedKey: "",
  modal: null,
  selectedStudentId: null,
  gpsWatchId: null,
  gpsRunId: null,
  lastGpsSent: 0,
  gpsErrorShown: false,
  wakeLock: null,
};

let firebaseApp;
let auth;
let db;
let profileUnsubscribe = null;
let authRevision = 0;

const menus = {
  admin: [
    ["overview", "Centro de control", "layout-dashboard"],
    ["routes", "Rutas", "route"],
    ["users", "Personas", "users"],
    ["students", "Estudiantes", "graduation-cap"],
    ["vehicles", "Flota", "bus-front"],
    ["payments", "Mensualidades", "credit-card"],
    ["trips", "Viajes privados", "briefcase-business"],
  ],
  driver: [
    ["today", "Rutas de hoy", "navigation"],
    ["passengers", "Pasajeros", "users-round"],
    ["history", "Mi historial", "history"],
  ],
  parent: [
    ["live", "Ruta en vivo", "map-pinned"],
    ["children", "Mis niños", "contact-round"],
    ["payments", "Mensualidades", "wallet-cards"],
    ["history", "Recorridos", "history"],
  ],
};

const sectionNames = Object.fromEntries(
  Object.values(menus).flat().map(([key, label]) => [key, label]),
);

function configured() {
  return Boolean(
    firebaseConfig?.apiKey &&
      !firebaseConfig.apiKey.includes("PEGA_AQUI") &&
      firebaseConfig?.projectId &&
      !firebaseConfig.projectId.includes("TU_PROYECTO") &&
      ADMIN_EMAIL &&
      !ADMIN_EMAIL.includes("TU_CORREO"),
  );
}

function showScreen(name) {
  [els.boot, els.config, els.login, els.account, els.app].forEach((node) => node.classList.add("hidden"));
  els[name].classList.remove("hidden");
  icons();
}

function icons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name = "RN") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "RN";
}

function isGeneralAdmin() {
  return state.profile?.role === "admin"
    && state.user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function roleLabel(role, email = "") {
  if (role === "admin") return email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "Administrador general" : "Administrador";
  return { driver: "Conductor", parent: "Representante" }[role] || "Usuario";
}

function valueMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`).getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(value, withYear = true) {
  const ms = valueMs(value);
  if (!ms) return "—";
  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(ms);
}

function formatDateTime(value) {
  const ms = valueMs(value);
  if (!ms) return "—";
  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

function formatPeriod(value) {
  if (!/^\d{4}-\d{2}$/.test(value || "")) return value || "Mensualidad";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 15));
}

function formatTime(value) {
  const ms = valueMs(value);
  if (!ms) return "—";
  return new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(ms);
}

function formatMoney(value = 0) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : NaN;
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (!digits) return NaN;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? amount : NaN;
}

function paymentMethodLabel(method) {
  return {
    transfer: "Transferencia",
    cash: "Efectivo",
    card: "Tarjeta",
    other: "Otro",
  }[method] || "No indicado";
}

function formatDuration(ms = 0) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return `${hours} h ${rest} min`;
}

function daysUntil(dateText) {
  if (!dateText) return null;
  const target = new Date(`${dateText}T23:59:59`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

function todayStart(offset = 0) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day.getTime();
}

function toast(title, message = "", type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.innerHTML = `<i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}"></i><span><strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}</span>`;
  els.toastRegion.append(item);
  icons();
  window.setTimeout(() => item.remove(), 4200);
}

function friendlyError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-credential": "El correo o la contraseña no son correctos.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "La contraseña no es correcta.",
    "auth/email-already-in-use": "Ese correo ya está registrado.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-email": "Escribe un correo electrónico válido.",
    "auth/operation-not-allowed": "Activa Correo electrónico/contraseña en Firebase Authentication.",
    "auth/network-request-failed": "No fue posible conectar. Revisa tu conexión e intenta nuevamente.",
    "auth/too-many-requests": "Hubo demasiados intentos. Espera unos minutos y vuelve a intentar.",
    "permission-denied": "Tu perfil no tiene permiso para realizar esta acción.",
    "firestore/permission-denied": "Tu perfil no tiene permiso para realizar esta acción.",
  };
  return messages[code] || error?.message || "Ocurrió un error. Intenta nuevamente.";
}

function docArray(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function clearSubscriptions() {
  [...state.subscriptions, ...state.scopedSubscriptions].forEach((unsubscribe) => unsubscribe?.());
  state.subscriptions = [];
  state.scopedSubscriptions = [];
  state.scopedKey = "";
  stopGps();
}

function watch(name, reference, bucket = state.subscriptions) {
  const unsubscribe = onSnapshot(
    reference,
    (snapshot) => {
      state.data[name] = docArray(snapshot);
      if (state.profile?.role === "driver" && name === "routes") subscribeDriverStudents();
      render();
      syncGps();
    },
    (error) => {
      console.error(error);
      toast("No se pudo cargar información", friendlyError(error), "error");
    },
  );
  bucket.push(unsubscribe);
}

function subscribeDriverStudents() {
  const routeIds = state.data.routes.map((route) => route.id).sort();
  const key = routeIds.join("|");
  if (key === state.scopedKey) return;
  state.scopedSubscriptions.forEach((unsubscribe) => unsubscribe?.());
  state.scopedSubscriptions = [];
  state.scopedKey = key;
  state.data.students = [];
  if (!routeIds.length) {
    render();
    return;
  }

  const byRoute = new Map();
  routeIds.forEach((routeId) => {
    const reference = query(collection(db, "students"), where("routeId", "==", routeId));
    const unsubscribe = onSnapshot(
      reference,
      (snapshot) => {
        byRoute.set(routeId, docArray(snapshot));
        state.data.students = [...byRoute.values()].flat();
        render();
      },
      (error) => console.error("No se pudieron cargar los estudiantes de la ruta", error),
    );
    state.scopedSubscriptions.push(unsubscribe);
  });
}

function subscribeForRole() {
  clearSubscriptions();
  state.data = emptyData();
  const uid = state.user.uid;
  const role = state.profile.role;

  if (role === "admin") {
    watch("users", collection(db, "users"));
    watch("routes", collection(db, "routes"));
    watch("vehicles", collection(db, "vehicles"));
    watch("students", collection(db, "students"));
    watch("payments", collection(db, "payments"));
    watch("paymentRequests", collection(db, "paymentRequests"));
    watch("runs", collection(db, "routeRuns"));
    watch("events", collection(db, "studentEvents"));
    watch("trips", collection(db, "privateTrips"));
  } else if (role === "driver") {
    watch("routes", query(collection(db, "routes"), where("driverUid", "==", uid)));
    watch("vehicles", query(collection(db, "vehicles"), where("driverUid", "==", uid)));
    watch("runs", query(collection(db, "routeRuns"), where("driverUid", "==", uid)));
    watch("events", query(collection(db, "studentEvents"), where("recordedByUid", "==", uid)));
    watch("trips", query(collection(db, "privateTrips"), where("driverUid", "==", uid)));
  } else {
    watch("students", query(collection(db, "students"), where("guardianUid", "==", uid)));
    watch("payments", query(collection(db, "payments"), where("guardianUid", "==", uid)));
    watch("paymentRequests", query(collection(db, "paymentRequests"), where("guardianUid", "==", uid)));
    watch("routes", query(collection(db, "routes"), where("guardianUids", "array-contains", uid)));
    watch("runs", query(collection(db, "routeRuns"), where("guardianUids", "array-contains", uid)));
    watch("events", query(collection(db, "studentEvents"), where("guardianUid", "==", uid)));
  }
}

async function loadProfile(user) {
  const reference = doc(db, "users", user.uid);
  let snapshot = await getDoc(reference);
  if (!snapshot.exists() && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() && user.emailVerified) {
    await setDoc(reference, {
      fullName: "Administrador general",
      email: user.email.toLowerCase(),
      phone: "",
      role: "admin",
      status: "active",
      createdAt: serverTimestamp(),
    });
    snapshot = await getDoc(reference);
  }
  if (!snapshot.exists()) throw new Error("Tu cuenta no tiene un perfil autorizado. Solicita acceso al administrador.");
  const profile = { id: snapshot.id, ...snapshot.data() };
  return profile;
}

function showAccountStatus(title, message, verification = false) {
  clearSubscriptions();
  state.data = emptyData();
  els.main.replaceChildren();
  if (els.dialog.open) els.dialog.close();
  els.accountStatusTitle.textContent = title;
  els.accountStatusMessage.textContent = message;
  els.accountStatusEmail.textContent = state.user?.email || "";
  els.accountVerificationActions.classList.toggle("hidden", !verification);
  showScreen("account");
}

function applyProfile(user, profile) {
  if (!menus[profile.role] || !["active", "pending", "inactive"].includes(profile.status)) {
    throw new Error("Tu cuenta no tiene un perfil autorizado. Contacta al administrador.");
  }
  const authEmail = user.email?.toLowerCase() || "";
  const profileEmail = profile.email?.toLowerCase() || "";
  const generalAdmin = authEmail === ADMIN_EMAIL.toLowerCase();
  if ((profile.role === "admin" && profileEmail !== authEmail)
    || (generalAdmin && (profile.role !== "admin" || !user.emailVerified))) {
    throw new Error("El perfil administrativo no coincide con la cuenta autorizada.");
  }
  const previousRole = state.profile?.role;
  const hadAccess = state.profile?.status === "active" && !els.app.classList.contains("hidden");
  state.profile = profile;
  if (profile.status !== "active") {
    showAccountStatus(
      profile.status === "pending" ? "Cuenta pendiente de aprobación" : "Cuenta inactiva",
      profile.status === "pending"
        ? "Tu registro fue recibido. El administrador general debe aprobarlo para que puedas acceder. Esta pantalla se actualizará al recibir la aprobación."
        : "Tu acceso está desactivado. Contacta al administrador general para habilitarlo.",
    );
    return;
  }
  if (!hadAccess || previousRole !== profile.role) state.section = menus[profile.role][0][0];
  els.sidebarBrand.textContent = APP_NAME;
  els.accountName.textContent = profile.fullName || user.email;
  els.accountRole.textContent = roleLabel(profile.role, profile.email);
  els.accountAvatar.textContent = initials(profile.fullName || user.email);
  els.today.textContent = new Intl.DateTimeFormat("es", {
    weekday: "long", day: "numeric", month: "long",
  }).format(new Date());
  showScreen("app");
  if (!hadAccess || previousRole !== profile.role) subscribeForRole();
  render();
}

async function failAuthSession(error, revision) {
  if (revision !== authRevision) return;
  await signOut(auth);
  if (auth.currentUser) return;
  showScreen("login");
  els.loginError.textContent = friendlyError(error);
  els.loginError.classList.remove("hidden");
}

async function handleAuth(user) {
  const revision = ++authRevision;
  profileUnsubscribe?.();
  profileUnsubscribe = null;
  clearSubscriptions();
  state.user = user;
  state.profile = null;
  state.data = emptyData();
  els.main.replaceChildren();
  if (els.dialog.open) els.dialog.close();
  if (!user) {
    showScreen("login");
    return;
  }

  showScreen("boot");
  try {
    if (user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() && !user.emailVerified) {
      showAccountStatus("Verifica el correo del administrador", "Confirma que este correo te pertenece antes de acceder como administrador general. Envía el enlace, ábrelo en tu correo y pulsa «Ya verifiqué mi correo».", true);
      return;
    }
    const profile = await loadProfile(user);
    if (revision !== authRevision || auth.currentUser?.uid !== user.uid) return;
    applyProfile(user, profile);
    profileUnsubscribe = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
      if (revision !== authRevision) return;
      try {
        if (!snapshot.exists()) throw new Error("Tu perfil ya no está disponible. Contacta al administrador.");
        applyProfile(user, { id: snapshot.id, ...snapshot.data() });
      } catch (error) {
        void failAuthSession(error, revision);
      }
    }, (error) => { void failAuthSession(error, revision); });
  } catch (error) {
    await failAuthSession(error, revision);
  }
}

function buildNav() {
  const items = menus[state.profile.role] || [];
  els.sidebarNav.innerHTML = items
    .map(([key, label, icon]) => {
      const count = key === "passengers"
        ? state.data.students.length
        : key === "payments"
          ? state.data.paymentRequests.filter((request) => request.status === "pending").length
          : "";
      return `<button class="nav-button ${key === state.section ? "active" : ""}" data-nav="${key}"><i data-lucide="${icon}"></i><span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ""}</button>`;
    })
    .join("");
  icons();
}

function render() {
  if (!state.profile || els.app.classList.contains("hidden")) return;
  const validSections = menus[state.profile.role].map(([key]) => key);
  if (!validSections.includes(state.section)) state.section = validSections[0];
  els.sectionTitle.textContent = sectionNames[state.section] || "Centro de control";
  buildNav();

  const role = state.profile.role;
  if (role === "admin") renderAdmin();
  else if (role === "driver") renderDriver();
  else renderParent();
  icons();
}

function statusBadge(status) {
  const map = {
    active: ["Activo", "success"],
    inactive: ["Inactivo", "muted"],
    available: ["Disponible", "success"],
    maintenance: ["Mantenimiento", "warning"],
    assigned: ["Asignado", "info"],
    pending: ["Pendiente", "warning"],
    approved: ["Aprobado", "success"],
    rejected: ["Rechazado", "danger"],
    paid: ["Pagado", "success"],
    expired: ["Vencido", "danger"],
    scheduled: ["Programado", "info"],
    confirmed: ["Confirmado", "violet"],
    completed: ["Finalizado", "success"],
    cancelled: ["Cancelado", "danger"],
    in_progress: ["En recorrido", "success"],
  };
  const [label, color] = map[status] || [status || "Sin estado", "muted"];
  return `<span class="badge badge-${color}">${escapeHtml(label)}</span>`;
}

function metric(label, value, icon, tone = "", note = "Actualizado en tiempo real") {
  return `<article class="metric-card ${tone}"><div class="metric-top"><span class="metric-icon"><i data-lucide="${icon}"></i></span><span class="metric-trend">En vivo</span></div><strong>${escapeHtml(value)}</strong><p>${escapeHtml(label)} · ${escapeHtml(note)}</p></article>`;
}

function emptyState(icon, title, copy, action = "") {
  return `<div class="empty-state"><span class="empty-icon"><i data-lucide="${icon}"></i></span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p>${action}</div>`;
}

function panel(title, subtitle, body, actions = "", flush = false) {
  return `<article class="panel"><header class="panel-header"><span class="panel-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></span><span class="panel-actions">${actions}</span></header><div class="panel-body ${flush ? "flush" : ""}">${body}</div></article>`;
}

function getById(list, id) {
  return list.find((item) => item.id === id);
}

function latestRun(routeId, status) {
  return state.data.runs
    .filter((run) => run.routeId === routeId && (!status || run.status === status))
    .sort((a, b) => (b.startedAtMs || valueMs(b.startedAt)) - (a.startedAtMs || valueMs(a.startedAt)))[0];
}

function latestPayment(studentId) {
  return state.data.payments
    .filter((payment) => payment.studentId === studentId)
    .sort((a, b) => String(b.validUntilDate || "").localeCompare(String(a.validUntilDate || "")))[0];
}

function latestEvent(studentId, runId) {
  return state.data.events
    .filter((event) => event.studentId === studentId && (!runId || event.runId === runId))
    .sort((a, b) => (b.recordedAtMs || valueMs(b.recordedAt)) - (a.recordedAtMs || valueMs(a.recordedAt)))[0];
}

function renderAdmin() {
  const pages = {
    overview: adminOverview,
    routes: adminRoutes,
    users: adminUsers,
    students: adminStudents,
    vehicles: adminVehicles,
    payments: adminPayments,
    trips: adminTrips,
  };
  els.main.innerHTML = (pages[state.section] || adminOverview)();
}

function adminOverview() {
  const activeRuns = state.data.runs.filter((run) => run.status === "active");
  const completedToday = state.data.runs.filter(
    (run) => run.status === "completed" && valueMs(run.endedAt || run.endedAtMs) >= todayStart(),
  );
  const weekRuns = state.data.runs.filter(
    (run) => run.status === "completed" && valueMs(run.endedAt || run.endedAtMs) >= todayStart(-6),
  );
  const expiring = state.data.payments.filter((payment) => {
    const left = daysUntil(payment.validUntilDate);
    return left !== null && left <= 5;
  });
  const pendingRequests = state.data.paymentRequests.filter((request) => request.status === "pending");
  const weekKm = weekRuns.reduce((sum, run) => sum + Number(run.distanceM || 0), 0) / 1000;
  return `<div class="page-stack">
    <div class="hero-row"><div class="hero-copy"><h1>Operación bajo control</h1><p>Supervisa rutas, pasajeros, pagos y flota desde una vista unificada con información actualizada en tiempo real.</p></div><div class="hero-actions"><button class="button button-outline" data-open="payment"><i data-lucide="circle-dollar-sign"></i>Registrar pago</button><button class="button button-primary" data-open="route"><i data-lucide="plus"></i>Nueva ruta</button></div></div>
    <div class="metrics-grid">
      ${metric("Rutas activas", String(activeRuns.length), "navigation", "", `${completedToday.length} finalizadas hoy`)}
      ${metric("Estudiantes activos", String(state.data.students.filter((item) => item.status !== "inactive").length), "graduation-cap", "metric-blue", `${state.data.routes.length} rutas registradas`)}
      ${metric("Kilómetros esta semana", weekKm.toFixed(1), "gauge", "metric-violet", `${weekRuns.length} recorridos`)}
      ${metric("Mensualidades por atender", String(expiring.length + pendingRequests.length), "calendar-clock", "metric-amber", `${pendingRequests.length} comprobantes pendientes`)}
    </div>
    <div class="dashboard-grid">
      ${panel("Rutas en operación", "Seguimiento del servicio actual", adminLiveRoutes(activeRuns), `<button class="button button-outline button-sm" data-nav="routes">Ver todas</button>`, true)}
      ${panel("Actividad semanal", "Recorridos finalizados por día", weeklyChart())}
    </div>
    <div class="dashboard-grid equal">
      ${panel("Mensualidades próximas", "Vencidas o con 5 días o menos", paymentAlerts(expiring), `<button class="button button-outline button-sm" data-nav="payments">Gestionar</button>`)}
      ${panel("Próximos viajes privados", "Servicios confirmados o programados", upcomingTrips())}
    </div>
  </div>`;
}

function adminLiveRoutes(activeRuns) {
  const rows = state.data.routes
    .map((route) => ({ route, run: activeRuns.find((item) => item.routeId === route.id) }))
    .sort((a, b) => Number(Boolean(b.run)) - Number(Boolean(a.run)))
    .slice(0, 7);
  if (!rows.length) return emptyState("route", "Aún no hay rutas", "Crea la primera ruta escolar para empezar.", `<button class="button button-primary button-sm" data-open="route">Crear ruta</button>`);
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Ruta</th><th>Conductor</th><th>Vehículo</th><th>Estado</th><th>Distancia</th></tr></thead><tbody>${rows
    .map(({ route, run }) => {
      const driver = getById(state.data.users, route.driverUid);
      const vehicle = getById(state.data.vehicles, route.vehicleId);
      return `<tr><td><div class="table-main"><span class="row-icon"><i data-lucide="route"></i></span><span><strong>${escapeHtml(route.name)}</strong><small>${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}</small></span></div></td><td>${escapeHtml(driver?.fullName || "Sin asignar")}</td><td>${escapeHtml(vehicle?.plate || "—")}</td><td>${run ? statusBadge("in_progress") : statusBadge(route.status || "active")}</td><td>${run ? `${(Number(run.distanceM || 0) / 1000).toFixed(1)} km` : "—"}</td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function weeklyChart() {
  const days = Array.from({ length: 7 }, (_, index) => {
    const offset = index - 6;
    const start = todayStart(offset);
    const end = todayStart(offset + 1);
    const runs = state.data.runs.filter((run) => {
      const ended = valueMs(run.endedAt || run.endedAtMs);
      return run.status === "completed" && ended >= start && ended < end;
    });
    return {
      label: new Intl.DateTimeFormat("es", { weekday: "short" }).format(start).replace(".", ""),
      count: runs.length,
      km: runs.reduce((sum, run) => sum + Number(run.distanceM || 0), 0) / 1000,
    };
  });
  const max = Math.max(1, ...days.map((day) => day.count));
  return `<div class="chart-summary"><span><strong>${days.reduce((sum, day) => sum + day.count, 0)}</strong><small>recorridos</small></span><span><strong>${days.reduce((sum, day) => sum + day.km, 0).toFixed(1)} km</strong><small>distancia total</small></span></div><div class="mini-bars">${days
    .map((day) => `<div class="bar-column" title="${day.count} recorridos"><span class="bar-value">${day.count}</span><div class="bar-track"><i style="height:${Math.max(8, (day.count / max) * 100)}%"></i></div><small>${escapeHtml(day.label)}</small></div>`)
    .join("")}</div>`;
}

function paymentAlerts(payments) {
  const sorted = [...payments].sort((a, b) => (daysUntil(a.validUntilDate) ?? 9999) - (daysUntil(b.validUntilDate) ?? 9999)).slice(0, 6);
  if (!sorted.length) return emptyState("badge-check", "Todo está al día", "No hay mensualidades próximas a vencer.");
  return `<div class="list">${sorted.map((payment) => {
    const parent = getById(state.data.users, payment.guardianUid);
    const student = getById(state.data.students, payment.studentId);
    const days = daysUntil(payment.validUntilDate);
    return `<div class="list-item"><div class="list-main"><span class="row-icon">${initials(student?.fullName || parent?.fullName)}</span><span class="list-copy"><strong>${escapeHtml(student?.fullName || "Estudiante")}</strong><small>${escapeHtml(parent?.fullName || "Representante")}</small></span></div><span class="list-meta">${days < 0 ? statusBadge("expired") : `<strong>${days} días</strong><br><small>${formatDate(payment.validUntilDate)}</small>`}</span></div>`;
  }).join("")}</div>`;
}

function upcomingTrips() {
  const today = new Date().toISOString().slice(0, 10);
  const trips = state.data.trips
    .filter((trip) => trip.date >= today && !["completed", "cancelled"].includes(trip.status))
    .sort((a, b) => `${a.date}${a.departureTime}`.localeCompare(`${b.date}${b.departureTime}`))
    .slice(0, 5);
  if (!trips.length) return emptyState("calendar-days", "Sin viajes próximos", "Los nuevos viajes privados aparecerán aquí.", `<button class="button button-outline button-sm" data-open="trip">Programar viaje</button>`);
  return `<div class="list">${trips.map((trip) => `<div class="list-item"><div class="list-main"><span class="row-icon"><i data-lucide="briefcase-business"></i></span><span class="list-copy"><strong>${escapeHtml(trip.clientName)}</strong><small>${escapeHtml(trip.origin)} → ${escapeHtml(trip.destination)}</small></span></div><span class="list-meta"><strong>${formatDate(trip.date, false)}</strong><br><small>${escapeHtml(trip.departureTime || "")}</small></span></div>`).join("")}</div>`;
}

function adminRoutes() {
  const body = state.data.routes.length
    ? `<div class="route-cards">${state.data.routes
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((route) => {
          const driver = getById(state.data.users, route.driverUid);
          const vehicle = getById(state.data.vehicles, route.vehicleId);
          const students = state.data.students.filter((student) => student.routeId === route.id).length;
          const activeRun = latestRun(route.id, "active");
          return `<article class="route-card" style="--route-color:${escapeHtml(route.color || "#0c8e87")}"><div class="route-accent"></div><div class="route-card-body"><div class="route-card-head"><span><h3>${escapeHtml(route.name)}</h3><p class="route-subtitle">${escapeHtml(route.schoolName || "Ruta escolar")}</p></span>${activeRun ? statusBadge("in_progress") : statusBadge(route.status || "active")}</div><div class="route-path"><span class="route-point"><i></i>${escapeHtml(route.origin)}</span><span class="route-point"><i></i>${escapeHtml(route.destination)}</span></div><div class="route-stats"><span class="route-stat"><span>Horario</span><strong>${escapeHtml(route.startTime || "—")}</strong></span><span class="route-stat"><span>Pasajeros</span><strong>${students}</strong></span><span class="route-stat"><span>Vehículo</span><strong>${escapeHtml(vehicle?.plate || "—")}</strong></span></div><div class="route-card-actions"><button class="button button-outline button-sm" data-edit="route" data-id="${route.id}"><i data-lucide="pencil"></i>Editar</button><button class="button button-outline button-sm" data-edit="user" data-id="${route.driverUid || ""}" ${driver ? "" : "disabled"}><i data-lucide="user-round"></i>${escapeHtml(driver?.fullName?.split(" ")[0] || "Sin conductor")}</button><button class="icon-button" data-delete="route" data-id="${route.id}" aria-label="Eliminar ruta"><i data-lucide="trash-2"></i></button></div></div></article>`;
        })
        .join("")}</div>`
    : emptyState("route", "Crea tu primera ruta", "Asigna un conductor, un vehículo, horarios y puntos del recorrido.", `<button class="button button-primary" data-open="route">Nueva ruta</button>`);
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Rutas escolares</h1><p>Configura recorridos, asigna responsables y consulta el estado de cada servicio.</p></div><div class="hero-actions"><button class="button button-primary" data-open="route"><i data-lucide="plus"></i>Nueva ruta</button></div></div>${body}</div>`;
}

function adminUsers() {
  const order = { admin: 0, driver: 1, parent: 2 };
  const pending = state.data.users.filter((user) => user.status === "pending").length;
  const users = [...state.data.users].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || (order[a.role] ?? 9) - (order[b.role] ?? 9) || String(a.fullName).localeCompare(String(b.fullName)));
  const body = users.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Persona</th><th>Perfil</th><th>Teléfono</th><th>Estado</th><th></th></tr></thead><tbody>${users.map((user) => {
      const canEdit = isGeneralAdmin() || user.role !== "admin";
      return `<tr><td><div class="table-main"><span class="row-icon">${initials(user.fullName)}</span><span><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.email)}</small></span></div></td><td>${escapeHtml(roleLabel(user.role, user.email))}</td><td>${escapeHtml(user.phone || "—")}</td><td>${statusBadge(user.status || "active")}</td><td><div class="row-actions">${user.status === "pending" && ["driver", "parent"].includes(user.role) ? `<button class="button button-success button-sm" data-approve-user="${user.id}"><i data-lucide="check"></i>Aprobar</button>` : ""}${canEdit ? `<button class="icon-button" data-edit="user" data-id="${user.id}" aria-label="Editar"><i data-lucide="pencil"></i></button>` : ""}</div></td></tr>`;
    }).join("")}</tbody></table></div>`
    : emptyState("users", "No hay personas registradas", "Registra conductores y representantes para asignarles rutas.");
  const permissionNote = isGeneralAdmin()
    ? "Solo tú puedes conceder o retirar el rango Administrador desde Editar persona."
    : "Puedes gestionar conductores y representantes; el administrador general controla los rangos administrativos.";
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Personas y accesos</h1><p>Administra cuentas, perfiles y permisos de la plataforma. ${pending} pendientes de aprobación.</p></div><div class="hero-actions"><button class="button button-primary" data-open="user"><i data-lucide="user-plus"></i>Registrar persona</button></div></div><div class="note-box"><i data-lucide="shield-check"></i><span><strong>Permisos administrativos</strong><span>${escapeHtml(permissionNote)}</span></span></div>${panel("Directorio", `${users.length} perfiles registrados`, body, "", true)}</div>`;
}

function adminStudents() {
  const students = [...state.data.students].sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
  const body = students.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Estudiante</th><th>Representante</th><th>Ruta</th><th>Mensualidad</th><th></th></tr></thead><tbody>${students.map((student) => {
      const parent = getById(state.data.users, student.guardianUid);
      const route = getById(state.data.routes, student.routeId);
      const payment = latestPayment(student.id);
      const left = daysUntil(payment?.validUntilDate);
      const paymentStatus = left === null ? "pending" : left < 0 ? "expired" : "paid";
      return `<tr><td><div class="table-main"><span class="row-icon">${initials(student.fullName)}</span><span><strong>${escapeHtml(student.fullName)}</strong><small>${escapeHtml(student.schoolGrade || "Grado sin registrar")}</small></span></div></td><td>${escapeHtml(parent?.fullName || "—")}</td><td>${escapeHtml(route?.name || "Sin ruta")}</td><td>${statusBadge(paymentStatus)}${left !== null && left >= 0 ? ` <small>${left} días</small>` : ""}</td><td><div class="row-actions"><button class="icon-button" data-edit="student" data-id="${student.id}" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="icon-button" data-delete="student" data-id="${student.id}" aria-label="Eliminar"><i data-lucide="trash-2"></i></button></div></td></tr>`;
    }).join("")}</tbody></table></div>`
    : emptyState("graduation-cap", "Aún no hay estudiantes", "Inscribe a los niños y vincúlalos con su representante y ruta escolar.");
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Estudiantes</h1><p>Centraliza datos escolares, contactos, paradas y observaciones importantes.</p></div><div class="hero-actions"><button class="button button-primary" data-open="student"><i data-lucide="plus"></i>Inscribir estudiante</button></div></div>${panel("Registro escolar", `${students.length} estudiantes`, body, "", true)}</div>`;
}

function adminVehicles() {
  const vehicles = [...state.data.vehicles].sort((a, b) => String(a.plate).localeCompare(String(b.plate)));
  const body = vehicles.length
    ? `<div class="route-cards">${vehicles.map((vehicle) => {
      const driver = getById(state.data.users, vehicle.driverUid);
      const reviewDays = daysUntil(vehicle.technicalReviewDate);
      const insuranceDays = daysUntil(vehicle.insuranceDate);
      const fuecDays = daysUntil(vehicle.fuecExpirationDate);
      const documentLine = (date, days) => `${formatDate(date)}${days !== null ? ` · ${days < 0 ? `${Math.abs(days)} días vencido` : `${days} días`}` : ""}`;
      return `<article class="route-card"><div class="route-accent" style="background:#2c78c7"></div><div class="route-card-body"><div class="route-card-head"><span><h3>${escapeHtml(vehicle.plate)}</h3><p class="route-subtitle">${escapeHtml(`${vehicle.brand || ""} ${vehicle.model || ""} ${vehicle.year || ""}`.trim())}</p></span>${statusBadge(vehicle.status || "available")}</div><div class="list"><div class="list-item"><span class="list-copy"><strong>Conductor</strong><small>${escapeHtml(driver?.fullName || "Sin asignar")}</small></span><i data-lucide="user-round"></i></div><div class="list-item"><span class="list-copy"><strong>Capacidad</strong><small>${escapeHtml(String(vehicle.capacity || 0))} pasajeros</small></span><i data-lucide="users-round"></i></div><div class="list-item"><span class="list-copy"><strong>Revisión técnica</strong><small>${escapeHtml(documentLine(vehicle.technicalReviewDate, reviewDays))}</small></span>${reviewDays !== null && reviewDays < 0 ? statusBadge("expired") : '<i data-lucide="clipboard-check"></i>'}</div><div class="list-item"><span class="list-copy"><strong>Seguro</strong><small>${escapeHtml(documentLine(vehicle.insuranceDate, insuranceDays))}</small></span>${insuranceDays !== null && insuranceDays < 0 ? statusBadge("expired") : '<i data-lucide="shield-check"></i>'}</div><div class="list-item"><span class="list-copy"><strong>FUEC</strong><small>${escapeHtml(documentLine(vehicle.fuecExpirationDate, fuecDays))}</small></span>${fuecDays !== null && fuecDays < 0 ? statusBadge("expired") : '<i data-lucide="file-check-2"></i>'}</div></div><div class="route-card-actions"><button class="button button-outline button-sm" data-edit="vehicle" data-id="${vehicle.id}"><i data-lucide="pencil"></i>Editar</button><button class="icon-button" data-delete="vehicle" data-id="${vehicle.id}" aria-label="Eliminar"><i data-lucide="trash-2"></i></button></div></div></article>`;
    }).join("")}</div>`
    : emptyState("bus-front", "Registra la flota", "Añade los buses y vehículos que operarán las rutas.", `<button class="button button-primary" data-open="vehicle">Nuevo vehículo</button>`);
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Flota vehicular</h1><p>Controla asignaciones, capacidad y fechas de documentación de cada vehículo.</p></div><div class="hero-actions"><button class="button button-primary" data-open="vehicle"><i data-lucide="plus"></i>Nuevo vehículo</button></div></div>${body}</div>`;
}

function adminPayments() {
  const requests = [...state.data.paymentRequests].sort((a, b) => valueMs(b.createdAt) - valueMs(a.createdAt));
  const pendingCount = requests.filter((request) => request.status === "pending").length;
  const requestsBody = requests.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Representante / estudiante</th><th>Datos del pago</th><th>Comprobante</th><th>Estado</th><th></th></tr></thead><tbody>${requests.map((request) => `<tr><td><div class="table-main"><span class="row-icon">${initials(request.studentName || request.guardianName)}</span><span><strong>${escapeHtml(request.studentName || "Estudiante")}</strong><small>${escapeHtml(request.guardianName || request.payerName || "Representante")} · ${escapeHtml(request.payerDocument || "Sin documento")}</small></span></div></td><td><strong>${formatMoney(request.amount)}</strong><br><small>${formatDate(request.paidAtDate)} · ${escapeHtml(paymentMethodLabel(request.method))}${request.period ? ` · ${escapeHtml(formatPeriod(request.period))}` : ""}</small></td><td><button class="button button-outline button-sm" data-proof="${request.id}"><i data-lucide="image"></i>Ver foto</button></td><td>${statusBadge(request.status || "pending")}${request.reviewNote ? `<br><small>${escapeHtml(request.reviewNote)}</small>` : ""}</td><td><div class="row-actions">${request.status === "pending" ? `<button class="button button-success button-sm" data-review-payment="approve" data-id="${request.id}"><i data-lucide="check"></i>Aprobar</button><button class="button button-danger button-sm" data-review-payment="reject" data-id="${request.id}"><i data-lucide="x"></i>Rechazar</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>`
    : emptyState("image", "Sin comprobantes recibidos", "Las solicitudes enviadas por los representantes aparecerán aquí.");
  const payments = [...state.data.payments].sort((a, b) => String(b.validUntilDate).localeCompare(String(a.validUntilDate)));
  const body = payments.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Representante / estudiante</th><th>Pago</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead><tbody>${payments.map((payment) => {
      const parent = getById(state.data.users, payment.guardianUid);
      const student = getById(state.data.students, payment.studentId);
      const left = daysUntil(payment.validUntilDate);
      const status = left !== null && left < 0 ? "expired" : payment.status || "paid";
      return `<tr><td><div class="table-main"><span class="row-icon">${initials(student?.fullName || parent?.fullName)}</span><span><strong>${escapeHtml(student?.fullName || "Estudiante")}</strong><small>${escapeHtml(parent?.fullName || "Representante")}</small></span></div></td><td><strong>${formatMoney(payment.amount)}</strong><br><small>${formatDate(payment.paidAtDate)}</small></td><td>${formatDate(payment.validUntilDate)}${left !== null ? `<br><small>${left < 0 ? `${Math.abs(left)} días vencida` : `${left} días restantes`}</small>` : ""}</td><td>${statusBadge(status)}</td><td><div class="row-actions"><button class="icon-button" data-edit="payment" data-id="${payment.id}" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="icon-button" data-delete="payment" data-id="${payment.id}" aria-label="Eliminar"><i data-lucide="trash-2"></i></button></div></td></tr>`;
    }).join("")}</tbody></table></div>`
    : emptyState("credit-card", "Sin pagos registrados", "Registra una mensualidad para comenzar el control de vigencias.");
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Mensualidades</h1><p>Verifica comprobantes enviados por las familias y controla la vigencia de cada servicio.</p></div><div class="hero-actions"><button class="button button-primary" data-open="payment"><i data-lucide="plus"></i>Registrar pago manual</button></div></div>${panel("Comprobantes por verificar", `${pendingCount} pendientes · ${requests.length} solicitudes`, requestsBody, "", true)}${panel("Pagos confirmados", `${payments.length} transacciones`, body, "", true)}</div>`;
}

function adminTrips() {
  const trips = [...state.data.trips].sort((a, b) => `${b.date}${b.departureTime}`.localeCompare(`${a.date}${a.departureTime}`));
  const body = trips.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Cliente</th><th>Recorrido</th><th>Fecha</th><th>Asignación</th><th>Estado</th><th></th></tr></thead><tbody>${trips.map((trip) => {
      const driver = getById(state.data.users, trip.driverUid);
      const vehicle = getById(state.data.vehicles, trip.vehicleId);
      return `<tr><td><div class="table-main"><span class="row-icon"><i data-lucide="briefcase-business"></i></span><span><strong>${escapeHtml(trip.clientName)}</strong><small>${escapeHtml(trip.phone || "")}</small></span></div></td><td>${escapeHtml(trip.origin)} → ${escapeHtml(trip.destination)}<br><small>${escapeHtml(String(trip.passengers || 0))} pasajeros</small></td><td>${formatDate(trip.date)}<br><small>${escapeHtml(trip.departureTime || "")}</small></td><td>${escapeHtml(driver?.fullName || "Sin conductor")}<br><small>${escapeHtml(vehicle?.plate || "Sin vehículo")}</small></td><td>${statusBadge(trip.status || "scheduled")}</td><td><div class="row-actions"><button class="icon-button" data-edit="trip" data-id="${trip.id}" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="icon-button" data-delete="trip" data-id="${trip.id}" aria-label="Eliminar"><i data-lucide="trash-2"></i></button></div></td></tr>`;
    }).join("")}</tbody></table></div>`
    : emptyState("briefcase-business", "Sin viajes privados", "Cotiza y programa servicios especiales para empresas, familias y grupos.");
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Viajes privados</h1><p>Organiza reservas, clientes, vehículos, conductores y valor del servicio.</p></div><div class="hero-actions"><button class="button button-primary" data-open="trip"><i data-lucide="plus"></i>Programar viaje</button></div></div>${panel("Agenda de servicios", `${trips.length} viajes`, body, "", true)}</div>`;
}

function renderDriver() {
  const pages = { today: driverToday, passengers: driverPassengers, history: driverHistory };
  els.main.innerHTML = (pages[state.section] || driverToday)();
}

function driverActiveRun() {
  return state.data.runs
    .filter((run) => run.status === "active")
    .sort((a, b) => (b.startedAtMs || valueMs(b.startedAt)) - (a.startedAtMs || valueMs(a.startedAt)))[0];
}

function routesForToday() {
  const day = new Date().getDay();
  return state.data.routes.filter((route) => {
    if (route.status === "inactive") return false;
    if (!Array.isArray(route.days) || !route.days.length) return true;
    return route.days.map(Number).includes(day);
  });
}

function driverToday() {
  const activeRun = driverActiveRun();
  const activeRoute = activeRun && getById(state.data.routes, activeRun.routeId);
  const todayRoutes = routesForToday();
  const todayText = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const privateToday = state.data.trips.filter((trip) => trip.date === new Date().toISOString().slice(0, 10) && !["cancelled", "completed"].includes(trip.status));

  let routeArea;
  if (activeRun && activeRoute) {
    routeArea = runHero(activeRun, activeRoute);
  } else if (todayRoutes.length) {
    routeArea = `<div class="route-cards">${todayRoutes.map(driverRouteCard).join("")}</div>`;
  } else {
    routeArea = emptyState("calendar-check", "No tienes rutas escolares hoy", "Tu agenda se actualizará cuando el administrador asigne un recorrido.");
  }

  const lastCompleted = state.data.runs
    .filter((run) => run.status === "completed")
    .sort((a, b) => (b.endedAtMs || valueMs(b.endedAt)) - (a.endedAtMs || valueMs(a.endedAt)))[0];

  return `<div class="page-stack">
    <div class="hero-row"><div class="hero-copy"><h1>Hola, ${escapeHtml((state.profile.fullName || "Conductor").split(" ")[0])}</h1><p>Esta es tu operación para ${escapeHtml(todayText)}. Activa el GPS antes de iniciar el recorrido.</p></div></div>
    ${routeArea}
    <div class="dashboard-grid equal">
      ${panel("Viajes privados de hoy", "Servicios especiales asignados", privateToday.length ? `<div class="list">${privateToday.map((trip) => `<div class="list-item"><div class="list-main"><span class="row-icon"><i data-lucide="briefcase-business"></i></span><span class="list-copy"><strong>${escapeHtml(trip.clientName)}</strong><small>${escapeHtml(trip.origin)} → ${escapeHtml(trip.destination)}</small></span></div><span class="list-meta"><strong>${escapeHtml(trip.departureTime || "")}</strong><br>${statusBadge(trip.status || "scheduled")}</span></div>`).join("")}</div>` : emptyState("briefcase-business", "Sin servicios privados", "No tienes viajes especiales para hoy."))}
      ${panel("Último resumen", "Tu recorrido finalizado más reciente", lastCompleted ? runSummary(lastCompleted) : emptyState("chart-no-axes-combined", "Sin recorridos finalizados", "Aquí aparecerá el tiempo, la distancia y los pasajeros del último recorrido."))}
    </div>
  </div>`;
}

function driverRouteCard(route) {
  const vehicle = getById(state.data.vehicles, route.vehicleId);
  const students = state.data.students.filter((student) => student.routeId === route.id && student.status !== "inactive");
  return `<article class="route-card" style="--route-color:${escapeHtml(route.color || "#0c8e87")}"><div class="route-accent"></div><div class="route-card-body"><div class="route-card-head"><span><h3>${escapeHtml(route.name)}</h3><p class="route-subtitle">${escapeHtml(route.schoolName || "Ruta escolar")}</p></span>${statusBadge("scheduled")}</div><div class="route-path"><span class="route-point"><i></i>${escapeHtml(route.origin)}</span><span class="route-point"><i></i>${escapeHtml(route.destination)}</span></div><div class="route-stats"><span class="route-stat"><span>Salida</span><strong>${escapeHtml(route.startTime || "—")}</strong></span><span class="route-stat"><span>Niños</span><strong>${students.length}</strong></span><span class="route-stat"><span>Vehículo</span><strong>${escapeHtml(vehicle?.plate || "—")}</strong></span></div><div class="route-card-actions"><button class="button button-primary" data-start-route="${route.id}"><i data-lucide="play"></i>Iniciar ruta</button></div></div></article>`;
}

function runHero(run, route) {
  const vehicle = getById(state.data.vehicles, run.vehicleId || route.vehicleId);
  const students = state.data.students.filter((student) => student.routeId === route.id && student.status !== "inactive");
  const picked = state.data.events.filter((event) => event.runId === run.id && event.eventType === "picked_up").length;
  const delivered = state.data.events.filter((event) => event.runId === run.id && event.eventType === "delivered").length;
  const elapsed = Date.now() - (run.startedAtMs || valueMs(run.startedAt) || Date.now());
  return `<section class="run-hero"><p class="eyebrow"><i data-lucide="radio"></i> Ruta activa · GPS en vivo</p><h2>${escapeHtml(route.name)}</h2><p>${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}</p><div class="run-grid"><div class="run-stat"><span>Tiempo</span><strong>${formatDuration(elapsed)}</strong></div><div class="run-stat"><span>Distancia</span><strong>${(Number(run.distanceM || 0) / 1000).toFixed(1)} km</strong></div><div class="run-stat"><span>Recogidos</span><strong>${picked}/${students.length}</strong></div><div class="run-stat"><span>Vehículo</span><strong>${escapeHtml(vehicle?.plate || "—")}</strong></div></div><div class="run-actions"><button class="button button-primary" data-nav="passengers"><i data-lucide="users-round"></i>Gestionar pasajeros</button><button class="button button-outline" data-end-route="${run.id}"><i data-lucide="square"></i>Finalizar ruta</button>${delivered ? `<span class="badge badge-success">${delivered} entregados</span>` : ""}</div></section>`;
}

function runSummary(run) {
  const route = getById(state.data.routes, run.routeId);
  const events = state.data.events.filter((event) => event.runId === run.id);
  const duration = (run.endedAtMs || valueMs(run.endedAt)) - (run.startedAtMs || valueMs(run.startedAt));
  return `<div class="summary-grid"><div class="summary-main"><span class="row-icon"><i data-lucide="route"></i></span><span><strong>${escapeHtml(route?.name || run.routeName || "Recorrido")}</strong><small>${formatDateTime(run.endedAt || run.endedAtMs)}</small></span></div><div class="route-stats"><span class="route-stat"><span>Tiempo</span><strong>${formatDuration(duration)}</strong></span><span class="route-stat"><span>Distancia</span><strong>${(Number(run.distanceM || 0) / 1000).toFixed(1)} km</strong></span><span class="route-stat"><span>Registros</span><strong>${events.length}</strong></span></div></div>`;
}

function eventStatus(event) {
  if (!event) return { label: "Pendiente", status: "muted" };
  const map = {
    picked_up: { label: `Recogido · ${formatTime(event.recordedAt || event.recordedAtMs)}`, status: "info" },
    delivered: { label: `Entregado · ${formatTime(event.recordedAt || event.recordedAtMs)}`, status: "success" },
    absent: { label: "No abordó", status: "warning" },
  };
  return map[event.eventType] || { label: "Registrado", status: "muted" };
}

function driverPassengers() {
  const run = driverActiveRun();
  if (!run) {
    return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Pasajeros</h1><p>Inicia una ruta para registrar recogidas y llegadas.</p></div></div>${emptyState("navigation", "No hay una ruta activa", "Cuando inicies un recorrido aparecerá aquí la lista de niños asignados.", `<button class="button button-primary" data-nav="today">Ver rutas de hoy</button>`)}</div>`;
  }
  const route = getById(state.data.routes, run.routeId);
  const students = state.data.students.filter((student) => student.routeId === run.routeId && student.status !== "inactive");
  const picked = students.filter((student) => state.data.events.some((event) => event.runId === run.id && event.studentId === student.id && event.eventType === "picked_up")).length;
  const delivered = students.filter((student) => state.data.events.some((event) => event.runId === run.id && event.studentId === student.id && event.eventType === "delivered")).length;
  const cards = students.length
    ? `<div class="passenger-grid">${students.map((student) => {
      const allEvents = state.data.events
        .filter((event) => event.runId === run.id && event.studentId === student.id)
        .sort((a, b) => (b.recordedAtMs || valueMs(b.recordedAt)) - (a.recordedAtMs || valueMs(a.recordedAt)));
      const last = allEvents[0];
      const status = eventStatus(last);
      const wasPicked = allEvents.some((event) => event.eventType === "picked_up");
      const wasDelivered = allEvents.some((event) => event.eventType === "delivered");
      return `<article class="passenger-card"><div class="passenger-head"><span class="avatar">${initials(student.fullName)}</span><span><strong>${escapeHtml(student.fullName)}</strong><small>${escapeHtml(student.pickupAddress || "Parada sin especificar")}</small></span></div><div class="passenger-status"><span class="badge badge-${status.status}">${escapeHtml(status.label)}</span></div><div class="passenger-actions"><button class="button button-outline button-sm" data-event="picked_up" data-student="${student.id}" ${wasPicked ? "disabled" : ""}><i data-lucide="log-in"></i>Recoger</button><button class="button button-success button-sm" data-event="delivered" data-student="${student.id}" ${!wasPicked || wasDelivered ? "disabled" : ""}><i data-lucide="check"></i>Entregar</button></div></article>`;
    }).join("")}</div>`
    : emptyState("users-round", "La ruta no tiene pasajeros", "Solicita al administrador que asigne estudiantes a esta ruta.");

  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>${escapeHtml(route?.name || "Pasajeros")}</h1><p>Marca cada recogida y entrega. El representante verá la hora al instante.</p></div><div class="hero-actions"><button class="button button-outline" data-nav="today"><i data-lucide="navigation"></i>Ver recorrido</button></div></div><div class="metrics-grid">${metric("Pasajeros asignados", String(students.length), "users-round")}${metric("Recogidos", String(picked), "log-in", "metric-blue")}${metric("Entregados", String(delivered), "check-check", "metric-violet")}${metric("Pendientes", String(Math.max(0, students.length - delivered)), "clock-3", "metric-amber")}</div>${cards}</div>`;
}

function driverHistory() {
  const runs = state.data.runs
    .filter((run) => run.status === "completed")
    .sort((a, b) => (b.endedAtMs || valueMs(b.endedAt)) - (a.endedAtMs || valueMs(a.endedAt)));
  const body = runs.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Ruta</th><th>Fecha</th><th>Duración</th><th>Distancia</th><th>Pasajeros</th></tr></thead><tbody>${runs.map((run) => {
      const route = getById(state.data.routes, run.routeId);
      const duration = (run.endedAtMs || valueMs(run.endedAt)) - (run.startedAtMs || valueMs(run.startedAt));
      const passengers = new Set(state.data.events.filter((event) => event.runId === run.id && event.eventType === "picked_up").map((event) => event.studentId)).size;
      return `<tr><td><div class="table-main"><span class="row-icon"><i data-lucide="route"></i></span><span><strong>${escapeHtml(route?.name || run.routeName || "Recorrido")}</strong><small>${escapeHtml(route ? `${route.origin} → ${route.destination}` : "")}</small></span></div></td><td>${formatDateTime(run.startedAt || run.startedAtMs)}</td><td>${formatDuration(duration)}</td><td>${(Number(run.distanceM || 0) / 1000).toFixed(1)} km</td><td>${passengers}</td></tr>`;
    }).join("")}</tbody></table></div>`
    : emptyState("history", "Sin historial todavía", "Tus recorridos finalizados se guardarán automáticamente aquí.");
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Historial de recorridos</h1><p>Consulta tiempo, distancia y pasajeros transportados en cada ruta.</p></div></div>${panel("Recorridos finalizados", `${runs.length} registros`, body, "", true)}</div>`;
}

function renderParent() {
  const pages = { live: parentLive, children: parentChildren, payments: parentPayments, history: parentHistory };
  els.main.innerHTML = (pages[state.section] || parentLive)();
}

function selectedStudent() {
  if (!state.data.students.length) return null;
  const selected = getById(state.data.students, state.selectedStudentId);
  if (selected) return selected;
  state.selectedStudentId = state.data.students[0].id;
  return state.data.students[0];
}

function childSelector() {
  if (state.data.students.length <= 1) return "";
  return `<div class="child-tabs">${state.data.students.map((student) => `<button class="child-tab ${student.id === state.selectedStudentId ? "active" : ""}" data-select-child="${student.id}"><span class="avatar">${initials(student.fullName)}</span>${escapeHtml(student.fullName.split(" ")[0])}</button>`).join("")}</div>`;
}

function parentLive() {
  const student = selectedStudent();
  if (!student) {
    return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Ruta en vivo</h1><p>Seguimiento seguro para las familias.</p></div></div>${emptyState("contact-round", "Tu cuenta aún no tiene niños vinculados", "El administrador debe registrar al estudiante y seleccionar tu perfil como representante.")}</div>`;
  }
  const route = getById(state.data.routes, student.routeId);
  const activeRun = state.data.runs
    .filter((run) => run.routeId === student.routeId && run.status === "active")
    .sort((a, b) => (b.startedAtMs || valueMs(b.startedAt)) - (a.startedAtMs || valueMs(a.startedAt)))[0];
  const pickedEvent = state.data.events
    .filter((event) => event.studentId === student.id && event.eventType === "picked_up" && (!activeRun || event.runId === activeRun.id))
    .sort((a, b) => (b.recordedAtMs || valueMs(b.recordedAt)) - (a.recordedAtMs || valueMs(a.recordedAt)))[0];
  const deliveredEvent = state.data.events
    .filter((event) => event.studentId === student.id && event.eventType === "delivered" && (!activeRun || event.runId === activeRun.id))
    .sort((a, b) => (b.recordedAtMs || valueMs(b.recordedAt)) - (a.recordedAtMs || valueMs(a.recordedAt)))[0];
  const payment = latestPayment(student.id);
  const days = daysUntil(payment?.validUntilDate);
  const paymentPercent = days === null ? 0 : Math.max(0, Math.min(100, (days / 30) * 100));
  const runStatus = activeRun ? "in_progress" : deliveredEvent && valueMs(deliveredEvent.recordedAt || deliveredEvent.recordedAtMs) >= todayStart() ? "completed" : "scheduled";

  return `<div class="page-stack">
    <div class="hero-row"><div class="hero-copy"><h1>Hola, ${escapeHtml((state.profile.fullName || "Familia").split(" ")[0])}</h1><p>Consulta el recorrido, las horas de recogida y llegada, y el estado de la mensualidad.</p></div><div class="hero-actions">${statusBadge(runStatus)}</div></div>
    ${childSelector()}
    <div class="dashboard-grid">
      ${parentMap(activeRun, route)}
      <div class="page-stack">
        ${panel("Estado de hoy", escapeHtml(student.fullName), parentTimeline(route, activeRun, pickedEvent, deliveredEvent))}
        ${panel("Mensualidad", payment ? `Vigente hasta ${formatDate(payment.validUntilDate)}` : "Sin pago registrado", payment ? `<div class="payment-total"><strong>${days !== null && days >= 0 ? `${days} días` : "Vencida"}</strong><span>${formatMoney(payment.amount)}</span></div><div class="progress-block"><div class="progress-label"><span>Vigencia restante</span><strong>${Math.max(0, days || 0)} de 30 días</strong></div><div class="progress-track"><div class="progress-fill ${days < 6 ? "warning" : ""} ${days < 0 ? "danger" : ""}" style="width:${paymentPercent}%"></div></div></div>` : emptyState("wallet-cards", "Sin mensualidad", "Comunícate con la empresa para registrar tu pago."))}
      </div>
    </div>
    ${panel("Información de la ruta", route?.name || "Ruta sin asignar", route ? `<div class="route-info-grid"><div><span>Recogida</span><strong>${escapeHtml(route.startTime || "—")}</strong><small>${escapeHtml(student.pickupAddress || route.origin)}</small></div><div><span>Destino</span><strong>${escapeHtml(route.endTime || "—")}</strong><small>${escapeHtml(student.dropoffAddress || route.destination)}</small></div><div><span>Conductor</span><strong>${escapeHtml(getById(state.data.users, route.driverUid)?.fullName || "Asignado por la empresa")}</strong><small>${escapeHtml(getById(state.data.vehicles, route.vehicleId)?.plate || "Vehículo asignado")}</small></div></div>` : emptyState("route", "Sin ruta asignada", "El administrador aún no ha asociado una ruta al estudiante."))}
  </div>`;
}

function parentMap(run, route) {
  const location = run?.lastLocation;
  if (location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
    const lat = Number(location.lat);
    const lng = Number(location.lng);
    const delta = 0.012;
    const source = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - delta}%2C${lat - delta}%2C${lng + delta}%2C${lat + delta}&layer=mapnik&marker=${lat}%2C${lng}`;
    return `<article class="map-panel"><iframe title="Ubicación actual del vehículo" src="${source}" loading="lazy" referrerpolicy="no-referrer"></iframe><div class="map-caption"><span><strong>Vehículo en movimiento</strong><small>Última señal: ${formatTime(location.updatedAtMs)}</small></span><span class="live-pill">Ubicación en vivo</span></div></article>`;
  }
  return `<article class="map-panel"><div class="map-placeholder"><i data-lucide="map-pinned"></i><strong>${run ? "Esperando la primera señal GPS" : "El recorrido aún no ha iniciado"}</strong><span>${run ? "La posición aparecerá cuando el celular del conductor comparta su ubicación." : `Te avisaremos cuando comience ${escapeHtml(route?.name || "la ruta")}.`}</span></div><div class="map-caption"><span><strong>${escapeHtml(route?.name || "Ruta escolar")}</strong><small>${escapeHtml(route ? `${route.origin} → ${route.destination}` : "Sin recorrido asignado")}</small></span>${statusBadge(run ? "in_progress" : "scheduled")}</div></article>`;
}

function parentTimeline(route, run, picked, delivered) {
  return `<div class="timeline"><div class="timeline-item"><span><strong>Inicio de la ruta</strong><small>${escapeHtml(route?.origin || "Punto de salida")}</small></span><span class="timeline-time">${run ? formatTime(run.startedAt || run.startedAtMs) : "Pendiente"}</span></div><div class="timeline-item"><span><strong>Niño recogido</strong><small>Confirmación registrada por el conductor</small></span><span class="timeline-time">${picked ? formatTime(picked.recordedAt || picked.recordedAtMs) : "Pendiente"}</span></div><div class="timeline-item"><span><strong>Llegada al destino</strong><small>${escapeHtml(route?.destination || "Destino")}</small></span><span class="timeline-time">${delivered ? formatTime(delivered.recordedAt || delivered.recordedAtMs) : "Pendiente"}</span></div></div>`;
}

function parentChildren() {
  const cards = state.data.students.length
    ? `<div class="route-cards">${state.data.students.map((student) => {
      const route = getById(state.data.routes, student.routeId);
      const payment = latestPayment(student.id);
      const days = daysUntil(payment?.validUntilDate);
      return `<article class="route-card"><div class="route-accent" style="background:${escapeHtml(route?.color || "#0c8e87")}"></div><div class="route-card-body"><div class="passenger-head"><span class="avatar">${initials(student.fullName)}</span><span><strong>${escapeHtml(student.fullName)}</strong><small>${escapeHtml(student.schoolGrade || "Información escolar")}</small></span></div><div class="list" style="margin-top:.8rem"><div class="list-item"><span class="list-copy"><strong>Ruta</strong><small>${escapeHtml(route?.name || "Sin asignar")}</small></span><i data-lucide="route"></i></div><div class="list-item"><span class="list-copy"><strong>Punto de recogida</strong><small>${escapeHtml(student.pickupAddress || "Sin registrar")}</small></span><i data-lucide="map-pin"></i></div><div class="list-item"><span class="list-copy"><strong>Mensualidad</strong><small>${days === null ? "Sin pago" : days < 0 ? "Vencida" : `${days} días restantes`}</small></span>${statusBadge(days === null ? "pending" : days < 0 ? "expired" : "paid")}</div></div><div class="route-card-actions"><button class="button button-primary button-sm" data-select-child="${student.id}" data-nav="live"><i data-lucide="map-pinned"></i>Ver ruta en vivo</button></div></div></article>`;
    }).join("")}</div>`
    : emptyState("contact-round", "Sin estudiantes vinculados", "Solicita al administrador que asocie a tus niños con esta cuenta.");
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Mis niños</h1><p>Información del servicio escolar vinculada con tu cuenta.</p></div></div>${cards}</div>`;
}

function parentPayments() {
  const requests = [...state.data.paymentRequests].sort((a, b) => valueMs(b.createdAt) - valueMs(a.createdAt));
  const requestsBody = requests.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Estudiante</th><th>Valor</th><th>Fecha / período</th><th>Comprobante</th><th>Estado</th></tr></thead><tbody>${requests.map((request) => `<tr><td><div class="table-main"><span class="row-icon">${initials(request.studentName)}</span><span><strong>${escapeHtml(request.studentName || "Estudiante")}</strong><small>${escapeHtml(request.payerName || state.profile.fullName)}</small></span></div></td><td>${formatMoney(request.amount)}<br><small>${escapeHtml(paymentMethodLabel(request.method))}</small></td><td>${formatDate(request.paidAtDate)}<br><small>${escapeHtml(formatPeriod(request.period))}</small></td><td><button class="button button-outline button-sm" data-proof="${request.id}"><i data-lucide="image"></i>Ver foto</button></td><td>${statusBadge(request.status || "pending")}${request.reviewNote ? `<br><small>${escapeHtml(request.reviewNote)}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>`
    : emptyState("upload-cloud", "Aún no has enviado comprobantes", "Reporta tu pago y quedará pendiente hasta que un administrador lo verifique.", state.data.students.length ? '<button class="button button-primary" data-open="paymentRequest">Reportar pago</button>' : "");
  const payments = [...state.data.payments].sort((a, b) => String(b.validUntilDate).localeCompare(String(a.validUntilDate)));
  const body = payments.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Estudiante</th><th>Valor</th><th>Fecha de pago</th><th>Vigencia</th><th>Estado</th></tr></thead><tbody>${payments.map((payment) => {
      const student = getById(state.data.students, payment.studentId);
      const days = daysUntil(payment.validUntilDate);
      return `<tr><td><div class="table-main"><span class="row-icon">${initials(student?.fullName)}</span><span><strong>${escapeHtml(student?.fullName || "Estudiante")}</strong><small>${escapeHtml(payment.reference || "Mensualidad")}</small></span></div></td><td>${formatMoney(payment.amount)}</td><td>${formatDate(payment.paidAtDate)}</td><td>${formatDate(payment.validUntilDate)}<br><small>${days !== null && days >= 0 ? `${days} días restantes` : "Vencida"}</small></td><td>${statusBadge(days !== null && days < 0 ? "expired" : payment.status || "paid")}</td></tr>`;
    }).join("")}</tbody></table></div>`
    : emptyState("wallet-cards", "No hay pagos registrados", "Tus mensualidades aparecerán aquí cuando la empresa confirme el pago.");
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Mensualidades</h1><p>Envía el comprobante de pago y consulta su verificación y vigencia.</p></div><div class="hero-actions"><button class="button button-primary" data-open="paymentRequest" ${state.data.students.length ? "" : "disabled"}><i data-lucide="upload-cloud"></i>Reportar pago</button></div></div>${panel("Comprobantes enviados", `${requests.length} solicitudes`, requestsBody, "", true)}${panel("Pagos confirmados", `${payments.length} registros`, body, "", true)}</div>`;
}

function parentHistory() {
  const studentIds = new Set(state.data.students.map((student) => student.id));
  const events = state.data.events
    .filter((event) => studentIds.has(event.studentId))
    .sort((a, b) => (b.recordedAtMs || valueMs(b.recordedAt)) - (a.recordedAtMs || valueMs(a.recordedAt)));
  const rows = events.length
    ? `<div class="timeline">${events.slice(0, 60).map((event) => {
      const student = getById(state.data.students, event.studentId);
      const route = getById(state.data.routes, event.routeId);
      const label = event.eventType === "picked_up" ? "Fue recogido" : event.eventType === "delivered" ? "Llegó al destino" : "No abordó";
      return `<div class="timeline-item"><span><strong>${escapeHtml(student?.fullName || "Estudiante")} · ${label}</strong><small>${escapeHtml(route?.name || "Ruta escolar")} · ${formatDate(event.recordedAt || event.recordedAtMs)}</small></span><span class="timeline-time">${formatTime(event.recordedAt || event.recordedAtMs)}</span></div>`;
    }).join("")}</div>`
    : emptyState("history", "Sin actividad registrada", "Las recogidas y llegadas confirmadas por el conductor aparecerán aquí.");
  return `<div class="page-stack"><div class="hero-row"><div class="hero-copy"><h1>Historial de recorridos</h1><p>Registro cronológico de recogidas y llegadas de tus niños.</p></div></div>${panel("Actividad", `${events.length} eventos`, rows)}</div>`;
}

function options(list, selected, labeler) {
  return list.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(labeler(item))}</option>`).join("");
}

function field(name, label, value = "", type = "text", extra = "", full = false) {
  return `<label class="field ${full ? "field-full" : ""}"><span>${escapeHtml(label)}</span><input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}" ${extra}></label>`;
}

function selectField(name, label, content, selected = "", full = false, required = true) {
  return `<label class="field ${full ? "field-full" : ""}"><span>${escapeHtml(label)}</span><select name="${name}" ${required ? "required" : ""}><option value="">Selecciona una opción</option>${content.replace(`value="${selected}"`, `value="${selected}" selected`)}</select></label>`;
}

function textareaField(name, label, value = "", full = true) {
  return `<label class="field ${full ? "field-full" : ""}"><span>${escapeHtml(label)}</span><textarea name="${name}">${escapeHtml(value || "")}</textarea></label>`;
}

function fileField(name, label, accept = "image/jpeg,image/png,image/webp", extra = "", full = true) {
  return `<label class="field ${full ? "field-full" : ""}"><span>${escapeHtml(label)}</span><input name="${name}" type="file" accept="${escapeHtml(accept)}" ${extra}></label>`;
}

function findRecord(kind, id) {
  const key = { user: "users", route: "routes", student: "students", vehicle: "vehicles", payment: "payments", trip: "trips" }[kind];
  return key ? getById(state.data[key], id) : null;
}

function openModal(kind, id = "") {
  const record = id ? findRecord(kind, id) : null;
  if (kind === "user" && record?.role === "admin" && !isGeneralAdmin()) {
    toast("Acceso protegido", "Solo el administrador general puede editar cuentas administrativas.", "error");
    return;
  }
  if (kind === "paymentRequest" && state.profile?.role !== "parent") return;
  state.modal = { kind, id: record?.id || "" };
  els.modalError.classList.add("hidden");
  els.modalError.textContent = "";
  els.saveDialog.disabled = false;
  els.saveDialog.textContent = kind === "paymentRequest" ? "Enviar comprobante" : record ? "Guardar cambios" : "Crear registro";

  const definitions = {
    user: [record ? "Editar persona" : "Registrar persona", record ? "Actualiza los datos y el estado de acceso." : "Se creará una cuenta para ingresar a la plataforma."],
    route: [record ? "Editar ruta" : "Nueva ruta escolar", "Define el recorrido, horario y equipo responsable."],
    student: [record ? "Editar estudiante" : "Inscribir estudiante", "Vincula al niño con su representante y ruta."],
    vehicle: [record ? "Editar vehículo" : "Nuevo vehículo", "Registra la información operativa y documental."],
    payment: [record ? "Editar mensualidad" : "Registrar mensualidad", "La vigencia se mostrará automáticamente a la familia."],
    paymentRequest: ["Reportar pago de mensualidad", "Completa los datos y adjunta una foto clara del comprobante."],
    trip: [record ? "Editar viaje privado" : "Programar viaje privado", "Organiza el servicio, la asignación y la cotización."],
  };
  [els.modalTitle.textContent, els.modalDescription.textContent] = definitions[kind];

  if (kind === "user") {
    const adminRecord = record?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const roleOptions = `<option value="driver">Conductor</option><option value="parent">Representante</option>${record && isGeneralAdmin() ? '<option value="admin">Administrador</option>' : ""}`;
    els.modalFields.innerHTML = `
      ${field("fullName", "Nombre completo", record?.fullName, "text", "required autocomplete=\"name\"")}
      ${field("phone", "Teléfono", record?.phone, "tel", "autocomplete=\"tel\"")}
      ${field("email", "Correo electrónico", record?.email, "email", `required autocomplete="email" ${record ? "disabled" : ""}`, true)}
      ${record ? "" : field("password", "Contraseña temporal", "", "password", "required minlength=\"6\" autocomplete=\"new-password\"")}
      ${adminRecord ? '<input type="hidden" name="role" value="admin" /><input type="hidden" name="status" value="active" /><p class="field-hint field-full">Administrador general. Su perfil y acceso están protegidos.</p>' : `${selectField("role", "Perfil", roleOptions, record?.role)}${selectField("status", "Estado", '<option value="pending">Pendiente de aprobación</option><option value="active">Activo (aprobado)</option><option value="inactive">Inactivo</option>', record?.status || "pending")}`}
      <p class="field-hint field-full">${record && isGeneralAdmin() ? "Puedes asignar el rango Administrador. Solo el administrador general puede concederlo o retirarlo." : record ? "Seleccionar Activo aprueba el acceso de esta cuenta." : "La nueva cuenta puede crearse como Conductor o Representante; el administrador general puede ascenderla después."}</p>`;
  }

  if (kind === "route") {
    const drivers = state.data.users.filter((user) => user.role === "driver" && user.status === "active");
    const vehicles = state.data.vehicles.filter((vehicle) => vehicle.status !== "maintenance" || vehicle.id === record?.vehicleId);
    const dayNames = [[1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"], [5, "Viernes"], [6, "Sábado"]];
    els.modalFields.innerHTML = `
      ${field("name", "Nombre de la ruta", record?.name, "text", "required")}
      ${field("schoolName", "Colegio / institución", record?.schoolName, "text", "required")}
      ${field("origin", "Punto de inicio", record?.origin, "text", "required", true)}
      ${field("destination", "Destino", record?.destination, "text", "required", true)}
      ${field("startTime", "Hora de salida", record?.startTime || "06:00", "time", "required")}
      ${field("endTime", "Hora estimada de llegada", record?.endTime || "07:00", "time", "required")}
      ${selectField("driverUid", "Conductor", options(drivers, record?.driverUid, (item) => item.fullName), record?.driverUid, false, false)}
      ${selectField("vehicleId", "Vehículo", options(vehicles, record?.vehicleId, (item) => `${item.plate} · ${item.brand || "Vehículo"}`), record?.vehicleId, false, false)}
      ${selectField("status", "Estado", `<option value="active" ${record?.status !== "inactive" ? "selected" : ""}>Activa</option><option value="inactive" ${record?.status === "inactive" ? "selected" : ""}>Inactiva</option>`, record?.status || "active")}
      ${field("color", "Color identificador", record?.color || "#0c8e87", "color")}
      <div class="field field-full"><span>Días de operación</span><div class="check-grid">${dayNames.map(([value, label]) => `<label class="check-chip"><input name="days" type="checkbox" value="${value}" ${(record?.days || [1,2,3,4,5]).map(Number).includes(value) ? "checked" : ""}>${label}</label>`).join("")}</div></div>`;
  }

  if (kind === "student") {
    const parents = state.data.users.filter((user) => user.role === "parent" && user.status === "active");
    els.modalFields.innerHTML = `
      ${field("fullName", "Nombre completo", record?.fullName, "text", "required")}
      ${field("schoolGrade", "Grado / curso", record?.schoolGrade, "text", "required")}
      ${selectField("guardianUid", "Representante", options(parents, record?.guardianUid, (item) => `${item.fullName} · ${item.email}`), record?.guardianUid, true)}
      ${selectField("routeId", "Ruta asignada", options(state.data.routes, record?.routeId, (item) => item.name), record?.routeId, true)}
      ${field("pickupAddress", "Dirección de recogida", record?.pickupAddress, "text", "required", true)}
      ${field("dropoffAddress", "Dirección de entrega", record?.dropoffAddress, "text", "required", true)}
      ${selectField("status", "Estado", `<option value="active" ${record?.status !== "inactive" ? "selected" : ""}>Activo</option><option value="inactive" ${record?.status === "inactive" ? "selected" : ""}>Inactivo</option>`, record?.status || "active")}
      ${textareaField("medicalNotes", "Observaciones importantes", record?.medicalNotes)}`;
  }

  if (kind === "vehicle") {
    const drivers = state.data.users.filter((user) => user.role === "driver" && user.status === "active");
    els.modalFields.innerHTML = `
      ${field("plate", "Placa", record?.plate, "text", "required maxlength=\"10\"")}
      ${field("brand", "Marca", record?.brand, "text", "required")}
      ${field("model", "Modelo", record?.model, "text", "required")}
      ${field("year", "Año", record?.year || new Date().getFullYear(), "number", "required min=\"1990\" max=\"2100\"")}
      ${field("capacity", "Capacidad de pasajeros", record?.capacity || 20, "number", "required min=\"1\"")}
      ${selectField("driverUid", "Conductor habitual", options(drivers, record?.driverUid, (item) => item.fullName), record?.driverUid, false, false)}
      ${selectField("status", "Estado", `<option value="available" ${record?.status === "available" || !record ? "selected" : ""}>Disponible</option><option value="assigned" ${record?.status === "assigned" ? "selected" : ""}>Asignado</option><option value="maintenance" ${record?.status === "maintenance" ? "selected" : ""}>Mantenimiento</option><option value="inactive" ${record?.status === "inactive" ? "selected" : ""}>Inactivo</option>`, record?.status || "available")}
      ${field("technicalReviewDate", "Vence revisión técnica", record?.technicalReviewDate, "date", "required")}
      ${field("insuranceDate", "Vence seguro", record?.insuranceDate, "date", "required")}
      ${field("fuecExpirationDate", "Vence FUEC", record?.fuecExpirationDate, "date", "required", true)}`;
  }

  if (kind === "payment") {
    const defaultDate = new Date().toISOString().slice(0, 10);
    const monthLater = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    els.modalFields.innerHTML = `
      ${selectField("studentId", "Estudiante", options(state.data.students, record?.studentId, (item) => `${item.fullName} · ${getById(state.data.users, item.guardianUid)?.fullName || "Representante"}`), record?.studentId, true)}
      ${field("amount", "Valor pagado", record?.amount || "", "text", "required inputmode=\"numeric\" placeholder=\"Ej. 200000 o 200.000\" autocomplete=\"off\"")}
      ${field("paidAtDate", "Fecha del pago", record?.paidAtDate || defaultDate, "date", "required")}
      ${field("validUntilDate", "Válido hasta", record?.validUntilDate || monthLater, "date", "required")}
      ${selectField("method", "Método", `<option value="transfer" ${record?.method === "transfer" ? "selected" : ""}>Transferencia</option><option value="cash" ${record?.method === "cash" ? "selected" : ""}>Efectivo</option><option value="card" ${record?.method === "card" ? "selected" : ""}>Tarjeta</option><option value="other" ${record?.method === "other" ? "selected" : ""}>Otro</option>`, record?.method || "transfer")}
      ${field("reference", "Referencia / comprobante", record?.reference, "text")}
      ${selectField("status", "Estado", `<option value="paid" ${record?.status !== "pending" ? "selected" : ""}>Pagado</option><option value="pending" ${record?.status === "pending" ? "selected" : ""}>Pendiente</option>`, record?.status || "paid")}`;
  }

  if (kind === "paymentRequest") {
    if (!state.data.students.length) {
      toast("Sin estudiantes vinculados", "Un administrador debe vincular primero un estudiante a tu cuenta.", "error");
      state.modal = null;
      return;
    }
    const defaultDate = new Date().toISOString().slice(0, 10);
    const defaultPeriod = defaultDate.slice(0, 7);
    els.modalFields.innerHTML = `
      ${selectField("studentId", "Estudiante", options(state.data.students, state.selectedStudentId, (item) => item.fullName), state.selectedStudentId, true)}
      ${field("payerName", "Nombre de quien realizó el pago", state.profile.fullName, "text", "required maxlength=\"120\"")}
      ${field("payerDocument", "Documento de identidad", "", "text", "required maxlength=\"30\"")}
      ${field("payerPhone", "Teléfono de contacto", state.profile.phone || "", "tel", "required maxlength=\"32\"")}
      ${field("amount", "Valor pagado", "", "text", "required inputmode=\"numeric\" placeholder=\"Ej. 200000 o 200.000\" autocomplete=\"off\"")}
      ${field("paidAtDate", "Fecha del pago", defaultDate, "date", "required")}
      ${field("period", "Mensualidad correspondiente", defaultPeriod, "month", "required")}
      ${selectField("method", "Método", '<option value="transfer">Transferencia</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="other">Otro</option>', "transfer")}
      ${field("reference", "Número de referencia", "", "text", "maxlength=\"80\"")}
      ${fileField("proof", "Foto del comprobante", "image/jpeg,image/png,image/webp", "required")}
      <p class="field-hint field-full">Formatos admitidos: JPG, PNG o WebP, máximo 8 MB. La imagen se comprime automáticamente y se guarda en Firestore para no depender de Firebase Storage.</p>`;
  }

  if (kind === "trip") {
    const drivers = state.data.users.filter((user) => user.role === "driver" && user.status === "active");
    els.modalFields.innerHTML = `
      ${field("clientName", "Cliente / empresa", record?.clientName, "text", "required")}
      ${field("phone", "Teléfono", record?.phone, "tel", "required")}
      ${field("origin", "Origen", record?.origin, "text", "required", true)}
      ${field("destination", "Destino", record?.destination, "text", "required", true)}
      ${field("date", "Fecha", record?.date || new Date().toISOString().slice(0, 10), "date", "required")}
      ${field("departureTime", "Hora de salida", record?.departureTime || "08:00", "time", "required")}
      ${field("passengers", "Pasajeros", record?.passengers || 1, "number", "required min=\"1\"")}
      ${field("quotedAmount", "Valor cotizado", record?.quotedAmount || "", "number", "min=\"0\" step=\"100\"")}
      ${selectField("driverUid", "Conductor", options(drivers, record?.driverUid, (item) => item.fullName), record?.driverUid, false, false)}
      ${selectField("vehicleId", "Vehículo", options(state.data.vehicles, record?.vehicleId, (item) => `${item.plate} · ${item.brand || "Vehículo"}`), record?.vehicleId, false, false)}
      ${selectField("status", "Estado", `<option value="scheduled" ${record?.status === "scheduled" || !record ? "selected" : ""}>Programado</option><option value="confirmed" ${record?.status === "confirmed" ? "selected" : ""}>Confirmado</option><option value="in_progress" ${record?.status === "in_progress" ? "selected" : ""}>En recorrido</option><option value="completed" ${record?.status === "completed" ? "selected" : ""}>Finalizado</option><option value="cancelled" ${record?.status === "cancelled" ? "selected" : ""}>Cancelado</option>`, record?.status || "scheduled")}
      ${textareaField("notes", "Notas del servicio", record?.notes)}`;
  }

  els.dialog.showModal();
  icons();
}

function formObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === "string" && !["password", "confirmPassword"].includes(key) ? value.trim() : value]));
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen del comprobante."));
    };
    image.src = url;
  });
}

async function prepareProofImage(file) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!(file instanceof File) || !file.size) throw new Error("Adjunta una foto del comprobante.");
  if (!allowed.has(file.type)) throw new Error("La foto debe estar en formato JPG, PNG o WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("La foto supera el límite de 8 MB.");

  const image = await decodeImage(file);
  const width = image.width;
  const height = image.height;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("El navegador no pudo preparar la imagen.");
  let selectedBlob = null;
  const maxBytes = 450 * 1024;
  for (const maxDimension of [1400, 1200, 1000, 800]) {
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58, 0.46]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) continue;
      selectedBlob = blob;
      if (blob.size <= maxBytes) break;
    }
    if (selectedBlob?.size <= maxBytes) break;
  }
  image.close?.();
  if (!selectedBlob || selectedBlob.size > maxBytes) {
    throw new Error("La foto tiene demasiado detalle para guardarse. Recórtala al comprobante e intenta nuevamente.");
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo preparar la foto del comprobante."));
    reader.readAsDataURL(selectedBlob);
  });
  if (typeof dataUrl !== "string" || dataUrl.length > 650000) {
    throw new Error("La foto optimizada aún supera el tamaño permitido.");
  }
  return { dataUrl, size: selectedBlob.size, type: "image/jpeg", name: "comprobante.jpg" };
}

async function submitPaymentRequest(data) {
  const student = getById(state.data.students, data.studentId);
  if (!student || student.guardianUid !== state.user.uid) throw new Error("Selecciona un estudiante vinculado a tu cuenta.");
  if (!data.payerName || !data.payerDocument || !data.payerPhone) throw new Error("Completa los datos de quien realizó el pago.");
  const amount = parseMoney(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Escribe el valor pagado en pesos, por ejemplo 200000 o 200.000.");
  const today = new Date().toISOString().slice(0, 10);
  if (!data.paidAtDate || data.paidAtDate > today) throw new Error("La fecha del pago no puede estar en el futuro.");
  if (!/^\d{4}-\d{2}$/.test(data.period || "")) throw new Error("Selecciona la mensualidad correspondiente.");

  const proof = await prepareProofImage(data.proof);
  const requestReference = doc(collection(db, "paymentRequests"));
  const batch = writeBatch(db);
  batch.set(requestReference, {
    guardianUid: state.user.uid,
    guardianName: state.profile.fullName || "",
    guardianEmail: state.user.email || "",
    studentId: student.id,
    studentName: student.fullName,
    payerName: data.payerName,
    payerDocument: data.payerDocument,
    payerPhone: data.payerPhone,
    amount,
    paidAtDate: data.paidAtDate,
    paidAtMs: new Date(`${data.paidAtDate}T12:00:00`).getTime(),
    period: data.period,
    method: data.method,
    reference: data.reference || "",
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "paymentProofs", requestReference.id), {
    requestId: requestReference.id,
    guardianUid: state.user.uid,
    proofDataUrl: proof.dataUrl,
    proofName: proof.name,
    proofContentType: proof.type,
    proofSize: proof.size,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

async function createPlatformUser(data) {
  if (state.profile?.role !== "admin") {
    throw new Error("Solo un administrador puede registrar personas desde el panel.");
  }
  if (!["driver", "parent"].includes(data.role) || !["pending", "active", "inactive"].includes(data.status)) {
    throw new Error("Selecciona un perfil y estado válidos.");
  }
  return createAccount(data, false);
}

async function createAccount(data, publicRegistration) {
  const email = data.email.trim().toLowerCase();
  if (email === ADMIN_EMAIL.toLowerCase()) throw new Error("Este correo está reservado al administrador general. Crea esa cuenta en Firebase Authentication.");
  if (!["driver", "parent"].includes(data.role)) throw new Error("Selecciona Conductor o Representante.");
  const secondaryApp = initializeApp(firebaseConfig, `user-creator-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  let credential;
  let profileSaved = false;
  try {
    await setPersistence(secondaryAuth, inMemoryPersistence);
    credential = await createUserWithEmailAndPassword(secondaryAuth, email, data.password);
    // El registro público escribe con la identidad recién creada, nunca con la sesión del administrador.
    const profileDb = publicRegistration ? getFirestore(secondaryApp) : db;
    const status = publicRegistration ? "pending" : data.status;
    await setDoc(doc(profileDb, "users", credential.user.uid), {
      fullName: data.fullName,
      email,
      phone: data.phone || "",
      role: data.role,
      status,
      createdAt: serverTimestamp(),
      ...(!publicRegistration ? { createdBy: state.user.uid } : {}),
      ...(!publicRegistration && status === "active" ? { approvedAt: serverTimestamp(), approvedBy: state.user.uid } : {}),
    });
    profileSaved = true;
  } catch (error) {
    if (credential && !profileSaved) {
      try {
        await deleteUser(credential.user);
      } catch {
        throw new Error(`${friendlyError(error)} La cuenta se creó pero su perfil no pudo guardarse ni retirarse. Solicita al administrador que revise esa cuenta en Firebase Authentication antes de repetir el registro.`);
      }
    }
    throw error;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
}

async function approveUser(id) {
  if (state.profile?.role !== "admin") return;
  try {
    await runTransaction(db, async (transaction) => {
      const reference = doc(db, "users", id);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists() || snapshot.data().status !== "pending" || !["driver", "parent"].includes(snapshot.data().role)) {
        throw new Error("Esta cuenta ya no está pendiente de aprobación.");
      }
      transaction.update(reference, { status: "active", approvedAt: serverTimestamp(), approvedBy: state.user.uid, updatedAt: serverTimestamp() });
    });
    toast("Cuenta aprobada", "La persona ya puede ingresar con su correo y contraseña.");
  } catch (error) {
    toast("No se pudo aprobar la cuenta", friendlyError(error), "error");
  }
}

async function saveModal(event) {
  event.preventDefault();
  if (!state.modal) return;
  const { kind, id } = state.modal;
  const data = formObject(els.entityForm);
  els.modalError.classList.add("hidden");
  els.saveDialog.disabled = true;
  els.saveDialog.textContent = "Guardando…";

  try {
    if (kind === "user") {
      if (id) {
        const previous = findRecord("user", id);
        const generalAdminRecord = previous?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
        if (!previous) throw new Error("La persona ya no está disponible.");
        if (generalAdminRecord && (id !== state.user.uid || data.role !== "admin" || data.status !== "active")) {
          throw new Error("No puedes modificar el rango ni el estado del administrador general.");
        }
        if ((previous.role === "admin" || data.role === "admin") && !isGeneralAdmin()) {
          throw new Error("Solo el administrador general puede conceder o retirar el rango Administrador.");
        }
        if (!["driver", "parent", "admin"].includes(data.role) || !["pending", "active", "inactive"].includes(data.status)) {
          throw new Error("Selecciona un perfil y estado válidos.");
        }
        if (data.role === "admin" && data.status === "pending") {
          throw new Error("Un administrador debe quedar Activo o Inactivo, no Pendiente.");
        }
        await updateDoc(doc(db, "users", id), {
          fullName: data.fullName,
          phone: data.phone || "",
          role: data.role,
          status: data.status,
          updatedAt: serverTimestamp(),
          ...(!generalAdminRecord && data.status === "active" && (previous.status !== "active" || previous.role !== data.role) ? { approvedAt: serverTimestamp(), approvedBy: state.user.uid } : {}),
        });
      } else {
        await createPlatformUser(data);
      }
    }

    if (kind === "route") {
      const reference = id ? doc(db, "routes", id) : doc(collection(db, "routes"));
      const previous = id ? findRecord("route", id) : null;
      await setDoc(reference, {
        name: data.name,
        schoolName: data.schoolName,
        origin: data.origin,
        destination: data.destination,
        startTime: data.startTime,
        endTime: data.endTime,
        driverUid: data.driverUid || "",
        vehicleId: data.vehicleId || "",
        status: data.status,
        color: data.color || "#0c8e87",
        days: new FormData(els.entityForm).getAll("days").map(Number),
        guardianUids: previous?.guardianUids || [],
        studentIds: previous?.studentIds || [],
        activeRunId: previous?.activeRunId || "",
        createdAt: previous?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    if (kind === "vehicle") {
      const reference = id ? doc(db, "vehicles", id) : doc(collection(db, "vehicles"));
      await setDoc(reference, {
        plate: data.plate.toUpperCase(),
        brand: data.brand,
        model: data.model,
        year: Number(data.year),
        capacity: Number(data.capacity),
        driverUid: data.driverUid || "",
        status: data.status,
        technicalReviewDate: data.technicalReviewDate,
        insuranceDate: data.insuranceDate,
        fuecExpirationDate: data.fuecExpirationDate,
        updatedAt: serverTimestamp(),
        ...(!id ? { createdAt: serverTimestamp() } : {}),
      }, { merge: true });
    }

    if (kind === "student") {
      const previous = id ? findRecord("student", id) : null;
      const reference = id ? doc(db, "students", id) : doc(collection(db, "students"));
      const parent = getById(state.data.users, data.guardianUid);
      const batch = writeBatch(db);
      batch.set(reference, {
        fullName: data.fullName,
        schoolGrade: data.schoolGrade,
        guardianUid: data.guardianUid,
        guardianName: parent?.fullName || "",
        routeId: data.routeId,
        pickupAddress: data.pickupAddress,
        dropoffAddress: data.dropoffAddress,
        medicalNotes: data.medicalNotes || "",
        status: data.status,
        updatedAt: serverTimestamp(),
        ...(!id ? { createdAt: serverTimestamp() } : {}),
      }, { merge: true });
      batch.update(doc(db, "routes", data.routeId), {
        studentIds: arrayUnion(reference.id),
        guardianUids: arrayUnion(data.guardianUid),
        updatedAt: serverTimestamp(),
      });
      let removePreviousGuardianAfterCommit = false;
      if (previous?.routeId && previous.routeId !== data.routeId) {
        const siblings = state.data.students.filter((item) => item.id !== previous.id && item.routeId === previous.routeId && item.guardianUid === previous.guardianUid);
        batch.update(doc(db, "routes", previous.routeId), {
          studentIds: arrayRemove(previous.id),
          ...(siblings.length ? {} : { guardianUids: arrayRemove(previous.guardianUid) }),
          updatedAt: serverTimestamp(),
        });
      } else if (previous && previous.guardianUid !== data.guardianUid) {
        const siblings = state.data.students.filter((item) => item.id !== previous.id && item.routeId === data.routeId && item.guardianUid === previous.guardianUid);
        removePreviousGuardianAfterCommit = !siblings.length;
      }
      await batch.commit();
      if (removePreviousGuardianAfterCommit) {
        await updateDoc(doc(db, "routes", data.routeId), {
          guardianUids: arrayRemove(previous.guardianUid),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (kind === "payment") {
      const student = getById(state.data.students, data.studentId);
      if (!student) throw new Error("Selecciona un estudiante válido.");
      const amount = parseMoney(data.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Escribe el valor pagado en pesos, por ejemplo 200000 o 200.000.");
      const reference = id ? doc(db, "payments", id) : doc(collection(db, "payments"));
      await setDoc(reference, {
        studentId: student.id,
        studentName: student.fullName,
        guardianUid: student.guardianUid,
        amount,
        paidAtDate: data.paidAtDate,
        paidAtMs: new Date(`${data.paidAtDate}T12:00:00`).getTime(),
        validUntilDate: data.validUntilDate,
        method: data.method,
        reference: data.reference || "",
        status: data.status,
        updatedAt: serverTimestamp(),
        ...(!id ? { createdAt: serverTimestamp(), createdBy: state.user.uid } : {}),
      }, { merge: true });
    }

    if (kind === "paymentRequest") {
      await submitPaymentRequest(data);
    }

    if (kind === "trip") {
      const reference = id ? doc(db, "privateTrips", id) : doc(collection(db, "privateTrips"));
      await setDoc(reference, {
        clientName: data.clientName,
        phone: data.phone,
        origin: data.origin,
        destination: data.destination,
        date: data.date,
        departureTime: data.departureTime,
        passengers: Number(data.passengers),
        quotedAmount: Number(data.quotedAmount || 0),
        driverUid: data.driverUid || "",
        vehicleId: data.vehicleId || "",
        status: data.status,
        notes: data.notes || "",
        updatedAt: serverTimestamp(),
        ...(!id ? { createdAt: serverTimestamp() } : {}),
      }, { merge: true });
    }

    els.dialog.close();
    state.modal = null;
    if (kind === "paymentRequest") toast("Comprobante enviado", "Quedó pendiente de verificación por un administrador.");
    else toast(id ? "Cambios guardados" : "Registro creado", "La información ya está disponible para los perfiles autorizados.");
  } catch (error) {
    console.error(error);
    els.modalError.textContent = friendlyError(error);
    els.modalError.classList.remove("hidden");
  } finally {
    els.saveDialog.disabled = false;
    els.saveDialog.textContent = kind === "paymentRequest" ? "Enviar comprobante" : id ? "Guardar cambios" : "Crear registro";
  }
}

function datePlusDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function openPaymentProof(id) {
  const request = getById(state.data.paymentRequests, id);
  if (!request) return;
  const preview = window.open("about:blank", "_blank");
  if (!preview) {
    toast("Ventana bloqueada", "Permite ventanas emergentes para ver el comprobante.", "error");
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, "paymentProofs", id));
    const proof = snapshot.data();
    if (!snapshot.exists() || !proof?.proofDataUrl?.startsWith("data:image/")) throw new Error("No se encontró la imagen guardada.");
    preview.opener = null;
    preview.document.title = "Comprobante de pago";
    preview.document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;padding:20px;box-sizing:border-box";
    const image = preview.document.createElement("img");
    image.src = proof.proofDataUrl;
    image.alt = "Comprobante de pago";
    image.style.cssText = "max-width:100%;max-height:calc(100vh - 40px);object-fit:contain;border-radius:12px;background:white";
    preview.document.body.append(image);
  } catch (error) {
    preview.close();
    toast("No se pudo abrir la foto", friendlyError(error), "error");
  }
}

async function reviewPaymentRequest(id, action) {
  if (state.profile?.role !== "admin" || !["approve", "reject"].includes(action)) return;
  const request = getById(state.data.paymentRequests, id);
  if (!request || request.status !== "pending") {
    toast("Solicitud actualizada", "Este comprobante ya fue revisado.", "error");
    return;
  }
  let reviewNote = "";
  if (action === "approve") {
    if (!window.confirm(`¿Confirmas el pago de ${formatMoney(request.amount)} para ${request.studentName}?`)) return;
  } else {
    const reason = window.prompt("Motivo del rechazo (se mostrará al representante):", "Comprobante no válido");
    if (reason === null) return;
    reviewNote = reason.trim();
    if (reviewNote.length < 3) {
      toast("Escribe un motivo", "El representante necesita saber por qué debe corregir el comprobante.", "error");
      return;
    }
  }

  try {
    await runTransaction(db, async (transaction) => {
      const requestReference = doc(db, "paymentRequests", id);
      const snapshot = await transaction.get(requestReference);
      if (!snapshot.exists() || snapshot.data().status !== "pending") throw new Error("Este comprobante ya fue revisado.");
      const current = snapshot.data();
      const approved = action === "approve";
      const studentSnapshot = approved ? await transaction.get(doc(db, "students", current.studentId)) : null;
      if (approved && (!studentSnapshot?.exists() || studentSnapshot.data().guardianUid !== current.guardianUid)) {
        throw new Error("El estudiante ya no está vinculado con este representante.");
      }
      transaction.update(requestReference, {
        status: approved ? "approved" : "rejected",
        reviewNote,
        reviewedAt: serverTimestamp(),
        reviewedBy: state.user.uid,
        updatedAt: serverTimestamp(),
      });
      if (approved) {
        const validUntilDate = datePlusDays(current.paidAtDate, 30);
        transaction.set(doc(db, "payments", id), {
          studentId: current.studentId,
          studentName: studentSnapshot.data().fullName,
          guardianUid: current.guardianUid,
          amount: Number(current.amount),
          paidAtDate: current.paidAtDate,
          paidAtMs: new Date(`${current.paidAtDate}T12:00:00`).getTime(),
          validUntilDate,
          method: current.method,
          reference: current.reference || current.period || "",
          period: current.period || "",
          status: "paid",
          sourceRequestId: id,
          createdAt: serverTimestamp(),
          createdBy: state.user.uid,
          updatedAt: serverTimestamp(),
        });
      }
    });
    toast(action === "approve" ? "Pago aprobado" : "Comprobante rechazado", action === "approve" ? "La mensualidad ya aparece como pagada y vigente por 30 días." : "El representante verá el motivo y podrá enviar un nuevo comprobante.");
  } catch (error) {
    toast("No se pudo revisar", friendlyError(error), "error");
  }
}

async function removeRecord(kind, id) {
  const record = findRecord(kind, id);
  if (!record) return;
  if (kind === "route" && state.data.students.some((student) => student.routeId === id)) {
    toast("No se puede eliminar", "Primero cambia de ruta a los estudiantes asociados.", "error");
    return;
  }
  if (kind === "vehicle" && state.data.routes.some((route) => route.vehicleId === id)) {
    toast("No se puede eliminar", "Primero desasigna este vehículo de sus rutas.", "error");
    return;
  }
  if (!window.confirm("¿Deseas eliminar este registro? Esta acción no se puede deshacer.")) return;
  const collectionName = { route: "routes", student: "students", vehicle: "vehicles", payment: "payments", trip: "privateTrips" }[kind];
  if (!collectionName) return;
  try {
    if (kind === "student" && record.routeId) {
      const batch = writeBatch(db);
      batch.delete(doc(db, collectionName, id));
      const siblings = state.data.students.filter((item) => item.id !== id && item.routeId === record.routeId && item.guardianUid === record.guardianUid);
      batch.update(doc(db, "routes", record.routeId), {
        studentIds: arrayRemove(id),
        ...(siblings.length ? {} : { guardianUids: arrayRemove(record.guardianUid) }),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } else {
      await deleteDoc(doc(db, collectionName, id));
    }
    toast("Registro eliminado", "La información fue retirada correctamente.");
  } catch (error) {
    toast("No se pudo eliminar", friendlyError(error), "error");
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Este dispositivo no permite obtener la ubicación GPS."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 5000,
    });
  });
}

function locationFromPosition(position) {
  return {
    lat: Number(position.coords.latitude),
    lng: Number(position.coords.longitude),
    accuracy: Math.round(position.coords.accuracy || 0),
    heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
    speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
    updatedAtMs: Date.now(),
  };
}

async function requestWakeLock() {
  if (!navigator.wakeLock || document.visibilityState !== "visible") return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch (error) {
    console.info("No se pudo mantener la pantalla activa", error);
  }
}

async function startRoute(routeId) {
  if (driverActiveRun()) {
    toast("Ya existe una ruta activa", "Finaliza el recorrido actual antes de iniciar otro.", "error");
    return;
  }
  const route = getById(state.data.routes, routeId);
  if (!route || route.driverUid !== state.user.uid) return;
  const button = els.main.querySelector(`[data-start-route="${CSS.escape(routeId)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Obteniendo GPS…";
  }
  try {
    const position = await getCurrentPosition();
    const initialLocation = locationFromPosition(position);
    const students = state.data.students.filter((student) => student.routeId === routeId && student.status !== "inactive");
    const guardianUids = [...new Set([...(route.guardianUids || []), ...students.map((student) => student.guardianUid)].filter(Boolean))];
    const runReference = doc(collection(db, "routeRuns"));
    const batch = writeBatch(db);
    batch.set(runReference, {
      routeId,
      routeName: route.name,
      driverUid: state.user.uid,
      vehicleId: route.vehicleId || "",
      guardianUids,
      status: "active",
      startedAt: serverTimestamp(),
      startedAtMs: Date.now(),
      distanceM: 0,
      lastLocation: initialLocation,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "routes", routeId), { activeRunId: runReference.id, updatedAt: serverTimestamp() });
    await batch.commit();
    await requestWakeLock();
    state.section = "today";
    toast("Ruta iniciada", "El GPS del teléfono está compartiendo la ubicación con las familias.");
  } catch (error) {
    console.error(error);
    const locationMessage = error?.code === 1
      ? "Debes permitir el acceso a la ubicación para iniciar la ruta."
      : error?.code === 3
        ? "No fue posible obtener el GPS a tiempo. Revisa la señal e intenta de nuevo."
        : friendlyError(error);
    toast("No se pudo iniciar la ruta", locationMessage, "error");
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="play"></i>Iniciar ruta';
      icons();
    }
  }
}

async function endRoute(runId) {
  const run = getById(state.data.runs, runId);
  if (!run || run.driverUid !== state.user.uid) return;
  if (!window.confirm("¿Confirmas que el recorrido llegó a su fin?")) return;
  try {
    const now = Date.now();
    const batch = writeBatch(db);
    batch.update(doc(db, "routeRuns", runId), {
      status: "completed",
      endedAt: serverTimestamp(),
      endedAtMs: now,
      durationMs: Math.max(0, now - (run.startedAtMs || valueMs(run.startedAt))),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "routes", run.routeId), { activeRunId: "", updatedAt: serverTimestamp() });
    await batch.commit();
    stopGps();
    await state.wakeLock?.release?.();
    state.wakeLock = null;
    toast("Ruta finalizada", `${formatDuration(now - (run.startedAtMs || valueMs(run.startedAt)))} · ${(Number(run.distanceM || 0) / 1000).toFixed(1)} km recorridos.`);
  } catch (error) {
    toast("No se pudo finalizar", friendlyError(error), "error");
  }
}

async function markStudent(studentId, eventType) {
  const run = driverActiveRun();
  const student = getById(state.data.students, studentId);
  if (!run || !student || student.routeId !== run.routeId) return;
  const duplicate = state.data.events.some((event) => event.runId === run.id && event.studentId === studentId && event.eventType === eventType);
  if (duplicate) return;
  if (eventType === "delivered" && !state.data.events.some((event) => event.runId === run.id && event.studentId === studentId && event.eventType === "picked_up")) {
    toast("Primero registra la recogida", "La entrega solo puede marcarse después de que el niño aborde.", "error");
    return;
  }
  try {
    await addDoc(collection(db, "studentEvents"), {
      runId: run.id,
      routeId: run.routeId,
      studentId: student.id,
      studentName: student.fullName,
      guardianUid: student.guardianUid,
      eventType,
      recordedByUid: state.user.uid,
      recordedAt: serverTimestamp(),
      recordedAtMs: Date.now(),
    });
    toast(eventType === "picked_up" ? "Recogida registrada" : "Llegada registrada", `${student.fullName} · ${new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(new Date())}`);
  } catch (error) {
    toast("No se pudo guardar", friendlyError(error), "error");
  }
}

function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const radius = 6371000;
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function publishPosition(runId, position) {
  const now = Date.now();
  if (now - state.lastGpsSent < 8000) return;
  state.lastGpsSent = now;
  const nextLocation = locationFromPosition(position);
  try {
    await runTransaction(db, async (transaction) => {
      const reference = doc(db, "routeRuns", runId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists() || snapshot.data().status !== "active") return;
      const current = snapshot.data();
      const segment = haversineMeters(current.lastLocation, nextLocation);
      const accepted = segment > 3 && segment < 2500 ? segment : 0;
      transaction.update(reference, {
        lastLocation: nextLocation,
        distanceM: Number(current.distanceM || 0) + accepted,
        updatedAt: serverTimestamp(),
      });
    });
    els.gpsBadge.classList.remove("hidden");
    state.gpsErrorShown = false;
  } catch (error) {
    console.error("No se pudo actualizar el GPS", error);
  }
}

function syncGps() {
  if (state.profile?.role !== "driver") return;
  const run = driverActiveRun();
  if (!run) {
    stopGps();
    return;
  }
  if (state.gpsWatchId !== null && state.gpsRunId === run.id) return;
  stopGps();
  if (!navigator.geolocation) return;
  state.gpsRunId = run.id;
  state.gpsWatchId = navigator.geolocation.watchPosition(
    (position) => publishPosition(run.id, position),
    (error) => {
      els.gpsBadge.classList.add("hidden");
      if (!state.gpsErrorShown) {
        toast("Se perdió la señal GPS", error.code === 1 ? "Activa el permiso de ubicación para continuar transmitiendo." : "Revisa la señal del teléfono.", "error");
        state.gpsErrorShown = true;
      }
    },
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 },
  );
  els.gpsBadge.classList.remove("hidden");
  requestWakeLock();
}

function stopGps() {
  if (state.gpsWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.gpsWatchId);
  state.gpsWatchId = null;
  state.gpsRunId = null;
  state.lastGpsSent = 0;
  els.gpsBadge.classList.add("hidden");
}

function navigate(section) {
  if (!(menus[state.profile?.role] || []).some(([key]) => key === section)) return;
  state.section = section;
  els.sidebar.classList.remove("open");
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.classList.add("hidden");
  const submit = els.loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Ingresando…";
  try {
    await signInWithEmailAndPassword(auth, els.loginEmail.value.trim(), els.loginPassword.value);
  } catch (error) {
    els.loginError.textContent = friendlyError(error);
    els.loginError.classList.remove("hidden");
  } finally {
    els.loginPassword.value = "";
    submit.disabled = false;
    submit.innerHTML = '<i data-lucide="log-in"></i> Iniciar sesión';
    icons();
  }
});

function showAccessForm(register) {
  els.loginForm.classList.toggle("hidden", register);
  els.registerForm.classList.toggle("hidden", !register);
  els.loginError.classList.add("hidden");
  els.registerError.classList.add("hidden");
  els.loginPassword.value = "";
  els.registerForm.elements.password.value = "";
  els.registerForm.elements.confirmPassword.value = "";
  (register ? els.registerForm.elements.fullName : els.loginEmail).focus();
  icons();
}

els.showRegister.addEventListener("click", () => showAccessForm(true));
els.showLogin.addEventListener("click", () => showAccessForm(false));
els.registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = els.registerForm.querySelector('button[type="submit"]');
  const data = formObject(els.registerForm);
  els.registerError.classList.add("hidden");
  submit.disabled = true;
  els.showLogin.disabled = true;
  submit.textContent = "Registrando…";
  try {
    if (data.password !== data.confirmPassword) throw new Error("Las contraseñas no coinciden.");
    if (data.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
    if (data.fullName.length < 2 || data.fullName.length > 120 || !data.phone || data.phone.length > 32) throw new Error("Completa un nombre y teléfono válidos.");
    await createAccount(data, true);
    els.loginEmail.value = data.email.trim().toLowerCase();
    els.registerForm.reset();
    showAccessForm(false);
    toast("Registro recibido", "Tu cuenta está pendiente de aprobación por el administrador general.");
  } catch (error) {
    els.registerError.textContent = friendlyError(error);
    els.registerError.classList.remove("hidden");
  } finally {
    els.registerForm.elements.password.value = "";
    els.registerForm.elements.confirmPassword.value = "";
    submit.disabled = false;
    els.showLogin.disabled = false;
    submit.innerHTML = '<i data-lucide="user-plus"></i> Registrarme';
    icons();
  }
});

els.sendVerification.addEventListener("click", async () => {
  if (!auth.currentUser || auth.currentUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return;
  els.sendVerification.disabled = true;
  try {
    auth.languageCode = "es";
    await sendEmailVerification(auth.currentUser);
    toast("Verificación enviada", "Revisa tu correo y la carpeta de spam.");
  } catch (error) {
    toast("No se pudo enviar la verificación", friendlyError(error), "error");
  } finally {
    els.sendVerification.disabled = false;
  }
});

els.refreshVerification.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  els.refreshVerification.disabled = true;
  try {
    await user.reload();
    await user.getIdToken(true);
    if (auth.currentUser?.uid !== user.uid) return;
    if (!user.emailVerified) throw new Error("El correo aún no está verificado. Abre el enlace recibido y vuelve a comprobar.");
    await handleAuth(user);
  } catch (error) {
    toast("Verificación pendiente", friendlyError(error), "error");
  } finally {
    els.refreshVerification.disabled = false;
  }
});

els.togglePassword.addEventListener("click", () => {
  const visible = els.loginPassword.type === "text";
  els.loginPassword.type = visible ? "password" : "text";
  els.togglePassword.innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}"></i>`;
  icons();
});

async function logout() {
  profileUnsubscribe?.();
  profileUnsubscribe = null;
  clearSubscriptions();
  await signOut(auth);
}
els.logout.addEventListener("click", logout);
els.accountLogout.addEventListener("click", logout);

els.sidebarNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-nav]");
  if (button) navigate(button.dataset.nav);
});

els.main.addEventListener("click", async (event) => {
  const target = event.target.closest("button, [data-select-child]");
  if (!target || target.disabled) return;
  if (target.dataset.approveUser) {
    target.disabled = true;
    try { await approveUser(target.dataset.approveUser); } finally { target.disabled = false; }
    return;
  }
  if (target.dataset.proof) {
    await openPaymentProof(target.dataset.proof);
    return;
  }
  if (target.dataset.reviewPayment) {
    target.disabled = true;
    try { await reviewPaymentRequest(target.dataset.id, target.dataset.reviewPayment); } finally { target.disabled = false; }
    return;
  }
  if (target.dataset.selectChild) state.selectedStudentId = target.dataset.selectChild;
  if (target.dataset.nav) navigate(target.dataset.nav);
  else if (target.dataset.open) openModal(target.dataset.open);
  else if (target.dataset.edit) openModal(target.dataset.edit, target.dataset.id);
  else if (target.dataset.delete) await removeRecord(target.dataset.delete, target.dataset.id);
  else if (target.dataset.startRoute) await startRoute(target.dataset.startRoute);
  else if (target.dataset.endRoute) await endRoute(target.dataset.endRoute);
  else if (target.dataset.event) await markStudent(target.dataset.student, target.dataset.event);
  else if (target.dataset.selectChild) render();
});

els.openMenu.addEventListener("click", () => els.sidebar.classList.add("open"));
els.closeMenu.addEventListener("click", () => els.sidebar.classList.remove("open"));
els.sidebarBackdrop.addEventListener("click", () => els.sidebar.classList.remove("open"));
els.closeDialog.addEventListener("click", () => els.dialog.close());
els.cancelDialog.addEventListener("click", () => els.dialog.close());
els.entityForm.addEventListener("submit", saveModal);
els.dialog.addEventListener("close", () => { state.modal = null; });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && driverActiveRun()) requestWakeLock();
});

async function initialize() {
  document.title = `${APP_NAME} · Transporte inteligente`;
  if (!configured()) {
    showScreen("config");
    return;
  }
  try {
    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    await setPersistence(auth, browserLocalPersistence);
    onAuthStateChanged(auth, handleAuth);
  } catch (error) {
    console.error(error);
    showScreen("config");
    $("#configScreen .message-card p:last-child").textContent = `No fue posible conectar Firebase: ${friendlyError(error)}`;
  }
}

initialize();
