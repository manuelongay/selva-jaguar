// cloud.js — cuentas, progreso y ranking.
// Si pones tu configuración de Firebase abajo, usa Firebase Auth + Firestore.
// Si no, funciona en "modo local" (localStorage) para que puedas probar todo sin backend.

const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  appId: "TU_APP_ID",
};

export const isCloud = !firebaseConfig.apiKey.startsWith("TU_");
const V = "10.14.1";
let fb = null; // { auth, db, ...funciones }

const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const errEs = (e) => {
  const c = e && e.code ? e.code : "";
  if (c.includes("email-already-in-use")) return "Ese correo ya está registrado.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Correo o contraseña incorrectos.";
  if (c.includes("weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (c.includes("invalid-email")) return "Correo no válido.";
  if (c.includes("network")) return "Sin conexión a internet.";
  return e && e.message ? e.message : "Ocurrió un error.";
};

const defaultProgress = () => ({ unlocked: 1, best: {} });

// Devuelve el usuario ya iniciado (o null)
export async function init() {
  if (!isCloud) {
    const id = ls.get("sj_session", null);
    const users = ls.get("sj_users", {});
    return id && users[id] ? { uid: id, name: users[id].name } : null;
  }
  const [app, auth, fs] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(firebaseConfig);
  fb = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
  const u = await new Promise((res) => { const off = fb.A.onAuthStateChanged(fb.auth, (x) => { off(); res(x); }); });
  return u ? { uid: u.uid, name: u.displayName || u.email.split("@")[0] } : null;
}

export async function register(name, email, pass) {
  name = (name || "").trim().slice(0, 16) || "Jugador";
  email = (email || "").trim().toLowerCase();
  if (!isCloud) {
    if (!email) throw new Error("Escribe un correo.");
    const users = ls.get("sj_users", {});
    if (users[email]) throw new Error("Ese perfil ya existe en este dispositivo.");
    users[email] = { name };
    ls.set("sj_users", users); ls.set("sj_session", email);
    return { uid: email, name };
  }
  try {
    const cr = await fb.A.createUserWithEmailAndPassword(fb.auth, email, pass);
    await fb.A.updateProfile(cr.user, { displayName: name });
    await fb.F.setDoc(fb.F.doc(fb.db, "users", cr.user.uid), { name, ...defaultProgress() });
    return { uid: cr.user.uid, name };
  } catch (e) { throw new Error(errEs(e)); }
}

export async function login(email, pass) {
  email = (email || "").trim().toLowerCase();
  if (!isCloud) {
    const users = ls.get("sj_users", {});
    if (!users[email]) throw new Error("No hay un perfil con ese correo en este dispositivo.");
    ls.set("sj_session", email);
    return { uid: email, name: users[email].name };
  }
  try {
    const cr = await fb.A.signInWithEmailAndPassword(fb.auth, email, pass);
    return { uid: cr.user.uid, name: cr.user.displayName || email.split("@")[0] };
  } catch (e) { throw new Error(errEs(e)); }
}

export async function logout() {
  if (!isCloud) { ls.set("sj_session", null); return; }
  await fb.A.signOut(fb.auth);
}

export async function loadProgress(uid) {
  if (!isCloud) return { ...defaultProgress(), ...ls.get("sj_prog_" + uid, {}) };
  try {
    const s = await fb.F.getDoc(fb.F.doc(fb.db, "users", uid));
    return s.exists() ? { ...defaultProgress(), ...s.data() } : defaultProgress();
  } catch { return defaultProgress(); }
}

export async function saveProgress(user, prog) {
  if (!isCloud) { ls.set("sj_prog_" + user.uid, prog); return; }
  await fb.F.setDoc(fb.F.doc(fb.db, "users", user.uid), { name: user.name, unlocked: prog.unlocked, best: prog.best }, { merge: true });
}

// Guarda solo si supera el récord anterior del jugador en ese mapa
export async function submitScore(mapId, user, score, meters, time) {
  const row = { name: user.name, score, meters, time: Math.round(time * 10) / 10 };
  if (!isCloud) {
    const k = "sj_lb_" + mapId;
    const lb = ls.get(k, {});
    if (!lb[user.uid] || lb[user.uid].score < score) lb[user.uid] = row;
    ls.set(k, lb);
    return;
  }
  const ref = fb.F.doc(fb.db, "lb_" + mapId, user.uid);
  const prev = await fb.F.getDoc(ref);
  if (!prev.exists() || prev.data().score < score) {
    await fb.F.setDoc(ref, { ...row, at: fb.F.serverTimestamp() });
  }
}

export async function leaderboard(mapId) {
  if (!isCloud) {
    return Object.values(ls.get("sj_lb_" + mapId, {})).sort((a, b) => b.score - a.score).slice(0, 10);
  }
  const q = fb.F.query(fb.F.collection(fb.db, "lb_" + mapId), fb.F.orderBy("score", "desc"), fb.F.limit(10));
  const s = await fb.F.getDocs(q);
  return s.docs.map((d) => d.data());
}
