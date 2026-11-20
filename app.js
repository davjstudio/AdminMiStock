
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  runTransaction,
  Timestamp
} from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import {
  firebaseConfig,
  ADMIN_EMAIL
} from "./firebase-config.js";

// ========================================
// CONFIGURACIÓN FIREBASE
// ========================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

let users = [];
let selectedUser = null;
let busy = false;
let adminVerified = false;

// ========================================
// FUNCIONES GENERALES
// ========================================

function formatDate(ms) {
  if (!ms) return "Sin vencimiento";

  return new Date(ms).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function isPro(data) {
  const expiresAt =
    data.proExpiresAt?.toMillis?.() || 0;

  return (
    data.plan === "PRO" &&
    data.planStatus === "active" &&
    expiresAt > Date.now()
  );
}

function createText(tag, value, className = "") {
  const element = document.createElement(tag);

  element.textContent = value;
  element.className = className;

  return element;
}

function showLogin() {
  $("login").classList.remove("hidden");
  $("dashboard").classList.add("hidden");
  $("modal").classList.add("hidden");
}

function showDashboard() {
  $("login").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
}

function showLoginError(message) {
  $("loginError").textContent = message;
}

function getErrorMessage(error) {
  console.error("ERROR FIREBASE:", error);

  const code = error?.code || "";

  switch (code) {
    case "auth/invalid-credential":
      return "Correo o contraseña incorrectos.";

    case "auth/wrong-password":
      return "La contraseña es incorrecta.";

    case "auth/user-not-found":
      return "No existe esta cuenta en Firebase.";

    case "auth/operation-not-allowed":
      return "Debes habilitar Correo/Contraseña en Firebase Authentication.";

    case "auth/unauthorized-domain":
      return "Este dominio no está autorizado en Firebase.";

    case "auth/too-many-requests":
      return "Demasiados intentos. Inténtalo más tarde.";

    case "auth/network-request-failed":
      return "Error de conexión. Revisa tu internet.";

    case "permission-denied":
    case "firestore/permission-denied":
      return "Firestore bloqueó el acceso. Revisa las reglas.";

    default:
      return "Error: " + (code || error?.message || "Desconocido");
  }
}

// ========================================
// ESTADÍSTICAS
// ========================================

function renderStats() {
  const total = users.length;

  const pro = users.filter(
    (user) => user.plan === "PRO"
  ).length;

  const basic = total - pro;

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  const expiring = users.filter((user) => {
    return (
      user.plan === "PRO" &&
      user.expiresAt !== null &&
      user.expiresAt > now &&
      user.expiresAt <= now + sevenDays
    );
  }).length;

  $("totalUsers").textContent = total;
  $("proUsers").textContent = pro;
  $("basicUsers").textContent = basic;
  $("expiringUsers").textContent = expiring;
}

// ========================================
// MOSTRAR USUARIOS
// ========================================

function renderUsers() {
  const search = $("search")
    .value
    .trim()
    .toLowerCase();

  const filter = $("planFilter").value;

  const filtered = users.filter((user) => {
    const matchesText =
      user.name.toLowerCase().includes(search) ||
      user.email.toLowerCase().includes(search);

    const matchesPlan =
      filter === "ALL" ||
      filter === user.plan;

    return matchesText && matchesPlan;
  });

  const tbody = $("usersTable");

  tbody.replaceChildren();

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 4;
    cell.textContent = "No se encontraron usuarios.";

    row.appendChild(cell);
    tbody.appendChild(row);

    return;
  }

  filtered.forEach((user) => {
    const row = document.createElement("tr");

    // Nombre y correo
    const identityCell = document.createElement("td");

    identityCell.appendChild(
      createText(
        "div",
        user.name || "Sin nombre",
        "user-name"
      )
    );

    identityCell.appendChild(
      createText(
        "div",
        user.email || "Sin correo",
        "user-email"
      )
    );

    // Plan
    const planCell = document.createElement("td");

    const planBadge = createText(
      "span",
      user.plan === "PRO" ? "PRO" : "BÁSICO",
      user.plan === "PRO"
        ? "badge pro"
        : "badge basic"
    );

    planCell.appendChild(planBadge);

    // Vencimiento
    const expiryCell = document.createElement("td");

    expiryCell.textContent =
      user.plan === "PRO"
        ? formatDate(user.expiresAt)
        : "—";

    // Botón administrar
    const actionCell = document.createElement("td");

    const button = createText(
      "button",
      "Administrar",
      "action"
    );

    button.addEventListener("click", () => {
      openModal(user.uid);
    });

    actionCell.appendChild(button);

    row.append(
      identityCell,
      planCell,
      expiryCell,
      actionCell
    );

    tbody.appendChild(row);
  });
}

function render() {
  renderStats();
  renderUsers();
}

// ========================================
// CARGAR USUARIOS DE FIRESTORE
// ========================================

async function loadUsers() {
  if (busy || !adminVerified) return;

  busy = true;

  $("refreshButton").disabled = true;
  $("listStatus").textContent =
    "Cargando usuarios desde Firebase...";

  try {
    const snapshot = await getDocs(
      collection(db, "users")
    );

    users = snapshot.docs.map((document) => {
      const data = document.data();

      return {
        uid: document.id,
        name: String(data.name || ""),
        email: String(data.email || ""),
        plan: isPro(data) ? "PRO" : "BASIC",
        expiresAt:
          data.proExpiresAt?.toMillis?.() || null
      };
    });

    users.sort((a, b) => {
      return a.name.localeCompare(
        b.name,
        "es"
      );
    });

    render();

    $("listStatus").textContent =
      `${users.length} perfiles encontrados en Firestore.`;

    console.log(
      "Usuarios cargados correctamente:",
      users.length
    );

  } catch (error) {
    console.error("ERROR AL CARGAR USUARIOS:", error);

    $("listStatus").textContent =
      getErrorMessage(error);

  } finally {
    busy = false;
    $("refreshButton").disabled = false;
  }
}

// ========================================
// VENTANA ADMINISTRAR
// ========================================

function openModal(uid) {
  selectedUser = users.find(
    (user) => user.uid === uid
  );

  if (!selectedUser) return;

  $("selectedName").textContent =
    selectedUser.name || "Sin nombre";

  $("selectedEmail").textContent =
    selectedUser.email || "";

  $("selectedPlan").textContent =
    selectedUser.plan === "PRO"
      ? `Pro hasta ${formatDate(selectedUser.expiresAt)}`
      : "Plan Básico";

  $("days").value = "30";
  $("modalStatus").textContent = "";

  $("modal").classList.remove("hidden");
}

function closeModal() {
  $("modal").classList.add("hidden");
  selectedUser = null;
}

function setModalBusy(value) {
  $("activateButton").disabled = value;
  $("basicButton").disabled = value;
  $("closeModal").disabled = value;
}

// ========================================
// ACTIVAR O RENOVAR PRO
// ========================================

async function activatePro() {
  if (!selectedUser || !adminVerified) return;

  const uid = selectedUser.uid;
  const days = Number($("days").value);

  if (![7, 15, 30, 60, 90].includes(days)) {
    $("modalStatus").textContent =
      "Selecciona una duración válida.";
    return;
  }

  const confirmed = confirm(
    `¿Activar o renovar MiStock Pro por ${days} días?`
  );

  if (!confirmed) return;

  setModalBusy(true);

  $("modalStatus").textContent =
    "Activando MiStock Pro...";

  try {
    const userRef = doc(db, "users", uid);

    await runTransaction(
      db,
      async (transaction) => {
        const snapshot = await transaction.get(
          userRef
        );

        if (!snapshot.exists()) {
          throw new Error(
            "El usuario ya no existe."
          );
        }

        const data = snapshot.data();

        const now = Date.now();

        const currentExpiry =
          data.proExpiresAt?.toMillis?.() || 0;

        const active = isPro(data);

        const start = active
          ? currentExpiry
          : now;

        const expiresAt =
          start + days * 24 * 60 * 60 * 1000;

        transaction.update(userRef, {
          plan: "PRO",
          planStatus: "active",
          proExpiresAt:
            Timestamp.fromMillis(expiresAt)
        });
      }
    );

    closeModal();

    await loadUsers();

    alert(
      "¡MiStock Pro activado correctamente!"
    );

  } catch (error) {
    $("modalStatus").textContent =
      getErrorMessage(error);

  } finally {
    setModalBusy(false);
  }
}

// ========================================
// CAMBIAR A BÁSICO
// ========================================

async function setBasic() {
  if (!selectedUser || !adminVerified) return;

  const confirmed = confirm(
    "¿Seguro que deseas cambiar esta cuenta a Básico?"
  );

  if (!confirmed) return;

  setModalBusy(true);

  $("modalStatus").textContent =
    "Cambiando a plan Básico...";

  try {
    await updateDoc(
      doc(db, "users", selectedUser.uid),
      {
        plan: "BASIC",
        planStatus: "inactive",
        proExpiresAt: null
      }
    );

    closeModal();

    await loadUsers();

    alert(
      "La cuenta ahora tiene plan Básico."
    );

  } catch (error) {
    $("modalStatus").textContent =
      getErrorMessage(error);

  } finally {
    setModalBusy(false);
  }
}

// ========================================
// INICIAR SESIÓN
// ========================================

$("loginForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    showLoginError("");

    $("loginButton").disabled = true;

    const password = $("password").value;

    try {
      console.log(
        "Intentando iniciar sesión en MiStock Admin..."
      );

      await signInWithEmailAndPassword(
        auth,
        ADMIN_EMAIL,
        password
      );

      $("password").value = "";

      console.log(
        "Autenticación correcta. Verificando administrador..."
      );

    } catch (error) {
      showLoginError(
        getErrorMessage(error)
      );

    } finally {
      $("loginButton").disabled = false;
    }
  }
);

// ========================================
// CERRAR SESIÓN
// ========================================

$("logoutButton").addEventListener(
  "click",
  async () => {
    try {
      await signOut(auth);
    } catch (error) {
      alert(getErrorMessage(error));
    }
  }
);

// ========================================
// EVENTOS
// ========================================

$("refreshButton").addEventListener(
  "click",
  loadUsers
);

$("search").addEventListener(
  "input",
  renderUsers
);

$("planFilter").addEventListener(
  "change",
  renderUsers
);

$("closeModal").addEventListener(
  "click",
  closeModal
);

$("activateButton").addEventListener(
  "click",
  activatePro
);

$("basicButton").addEventListener(
  "click",
  setBasic
);

$("modal").addEventListener(
  "click",
  (event) => {
    if (event.target === $("modal")) {
      closeModal();
    }
  }
);

// ========================================
// VERIFICAR ADMINISTRADOR
// ========================================

onAuthStateChanged(
  auth,
  async (user) => {
    users = [];
    selectedUser = null;
    adminVerified = false;

    if (!user) {
      console.log(
        "No hay sesión iniciada."
      );

      showLogin();
      return;
    }

    try {
      console.log(
        "Usuario autenticado:",
        user.email
      );

      console.log(
        "UID:",
        user.uid
      );

      // Busca el documento admins/UID
      const adminRef = doc(
        db,
        "admins",
        user.uid
      );

      const adminDoc = await getDoc(
        adminRef
      );

      if (
        !adminDoc.exists() ||
        adminDoc.data().enabled !== true
      ) {
        console.error(
          "El usuario no tiene permiso de administrador."
        );

        await signOut(auth);

        showLoginError(
          "Esta cuenta no está autorizada como administrador."
        );

        return;
      }

      adminVerified = true;

      console.log(
        "Administrador verificado correctamente."
      );

      $("adminEmail").textContent =
        user.email || ADMIN_EMAIL;

      showDashboard();

      await loadUsers();

    } catch (error) {
      console.error(
        "ERROR AL VERIFICAR ADMINISTRADOR:",
        error
      );

      await signOut(auth);

      showLoginError(
        "No se pudo verificar el administrador. " +
        getErrorMessage(error)
      );
    }
  }
);
