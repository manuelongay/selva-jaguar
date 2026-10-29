const VERSION = "v5";
import * as Cloud from "./cloud.js?v=5";

/* ===================== CONSTANTES ===================== */
const W = 800, H = 400;
const GROUND = 300;      // y del suelo (pies del jugador)
const GRAV = 1100;       // gravedad del salto (más baja = salto más flotado)
const JUMP_V = -600;     // impulso de salto
const SWING_G = 1800;    // "gravedad" del péndulo de la liana
const HAND = 50;         // distancia de los pies a las manos
const PX_M = 50;         // píxeles por metro
const GRAB = 56;         // radio para agarrar una liana (px)
const JUMP_VX = 40;      // impulso extra hacia adelante al saltar (más alcance, ventana de despegue más amplia)
const COYOTE = 0.1;      // segundos después de salir del suelo en que todavía puedes saltar
const JUMP_BUF = 0.12;   // segundos que se recuerda un toque hecho un instante antes de poder saltar
const GUIDE = true;       // muestra un aro verde en la liana cuando un salto ahora la alcanzaría
const SPEEDS = [{ k: 0.75, n: "🐢 Lento" }, { k: 1, n: "Normal" }, { k: 1.25, n: "🐇 Rápido" }];
const RELEASE_VX = 250;  // impulso hacia adelante al soltarse de la liana
const RELEASE_VY = -420; // impulso hacia arriba al soltarse de la liana
const EDGE_GRACE = 3;    // segundos que puedes estar pegado al borde izquierdo antes de perder

/* ===================== MAPAS ===================== */
// Para agregar un mapa nuevo basta con añadir otro objeto aquí.
const MAPS = [
  { id: "selva", name: "Selva Esmeralda", desc: "Jabalíes y serpientes. Ideal para empezar.",
    lengthM: 300, speed: 125, seed: 1101, density: 0.55, lake: [240, 290], small: [80, 108], lakes: { small: 0.45, mid: 0.55, chain: 0 }, groups: [0.62, 0.32, 0.06],
    enemies: { boar: 0.5, snake: 0.5, jaguar: 0 },
    sky: ["#7fd6a0", "#e8f7c8"], far: "#3f8f5a", near: "#2c6e45", ground: "#3a8a2c", dirt: "#5b3a1e", water: "#2aa3c9", vine: "#2f5d1f", leaf: "#2e8b3d", night: false },
  { id: "pantano", name: "Pantano Nocturno", desc: "Entra el jaguar. Lagos más anchos.",
    lengthM: 400, speed: 135, seed: 2202, density: 0.65, lake: [250, 295], small: [88, 118], lakes: { small: 0.35, mid: 0.45, chain: 0.2 }, groups: [0.5, 0.35, 0.15],
    enemies: { boar: 0.3, snake: 0.3, jaguar: 0.4 },
    sky: ["#0d1f38", "#2c4a5e"], far: "#1c3b4a", near: "#16303a", ground: "#2d6a3f", dirt: "#2a1d12", water: "#1f6f7a", vine: "#6b8a3a", leaf: "#1f5a3a", night: true },
  { id: "canon", name: "Cañón del Atardecer", desc: "Rápido, con jaguares y lagos dobles.",
    lengthM: 500, speed: 145, seed: 3303, density: 0.75, lake: [255, 300], small: [95, 128], lakes: { small: 0.3, mid: 0.4, chain: 0.3 }, groups: [0.4, 0.4, 0.2],
    enemies: { boar: 0.3, snake: 0.2, jaguar: 0.5 },
    sky: ["#f2924a", "#ffd98a"], far: "#b5563a", near: "#8a3f2c", ground: "#8a7a2e", dirt: "#4a2f18", water: "#3ba0b8", vine: "#6a5a1a", leaf: "#a88a2a", night: false },
];

const ENEMY = {
  jaguar: { w: 62, h: 28, v: 130, label: "Te atrapó un jaguar 🐆" },
  boar:   { w: 46, h: 26, v: 100, label: "Te embistió un puerco de monte 🐗" },
  snake:  { w: 40, h: 14, v: 28,  label: "Te mordió una serpiente 🐍" },
};

/* ===================== NIVEL (con semilla) ===================== */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };

function pickWeighted(w, r) {
  const keys = Object.keys(w); const tot = keys.reduce((a, k) => a + w[k], 0);
  let x = r() * tot;
  for (const k of keys) { x -= w[k]; if (x <= 0) return k; }
  return keys[0];
}

function makeVine(ax, r) {
  return { ax, ay: 50, L: 180, phase: r() * 6.28, amp: 0.12 + r() * 0.06, w: 1.6 + r() * 0.4, used: false };
}

// Los animales se activan al acercarse al borde derecho de la pantalla y caminan hacia ti.
// Calculamos dónde se cruzarán contigo para que siempre haya suelo antes del siguiente lago.
const ACT = W + 60;               // distancia (desde la cámara) a la que un animal se activa
const MEET = ACT - 200;           // el jugador va ~200 px dentro de la pantalla
function travelOf(type, map) {    // cuánto camina un animal antes de cruzarse contigo
  const v = ENEMY[type].v, b = map.speed * 1.15;
  return (MEET * v) / (b + v);
}

function buildLevel(map) {
  const r = rng(map.seed);
  const rr = (a, b) => a + r() * (b - a);
  const lvl = { lakes: [], vines: [], enemies: [], goalX: 0 };
  const endTarget = map.lengthM * PX_M;
  let x = 300, first = true;
  // bolsa balanceada de tipos de lago (respeta las proporciones del mapa sin depender de la suerte)
  let bag = [];
  const nextKind = () => {
    if (!bag.length) {
      for (const k of Object.keys(map.lakes)) for (let i = 0; i < Math.round(map.lakes[k] * 10); i++) bag.push(k);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    return bag.pop();
  };
  while (x < endTarget - 600) {
    // ---- tramo de suelo (con o sin animales) ----
    let gl;
    if (first || r() >= map.density) {
      gl = first ? 650 : rr(380, 560);
    } else {
      const type = pickWeighted(map.enemies, r), d = ENEMY[type];
      const k = pickWeighted({ 1: map.groups[0], 2: map.groups[1], 3: map.groups[2] }, r) | 0;
      // separaciones: "juntos" (se saltan los dos de una vez) o "separados" (cabe aterrizar en medio)
      const reach = (map.speed * 1.15 + d.v) * 0.72;      // tramo máximo que se salta de un solo brinco
      const offs = [0]; let run = d.w + 2;
      for (let i = 1; i < k; i++) {
        let gap = r() < 0.5 ? rr(40, 75) : rr(170, 260);
        if (gap < 100) { if (run + gap + d.w + 2 > reach) gap = rr(170, 260); else run += gap + d.w + 2; }
        if (gap >= 100) run = d.w + 2;
        offs.push(offs[i - 1] + d.w + gap);
      }
      const span = offs[k - 1], travel = travelOf(type, map);
      const lead = rr(280, 330), tail = rr(180, 240);
      const xe = x + lead + travel;
      for (let i = 0; i < k; i++)
        lvl.enemies.push({ x: xe + offs[i], type, active: false, anim: r() * 6, dead: false });
      gl = lead + travel + span + tail;
    }
    first = false;
    x += gl;

    // ---- lago: chico (se salta directo), mediano (liana) o doble (dos lianas) ----
    const kind = nextKind();
    let w;
    if (kind === "small") w = rr(map.small[0], map.small[1]);
    else if (kind === "chain") w = rr(470, 510);
    else w = rr(map.lake[0], map.lake[1]);
    lvl.lakes.push({ x, w, kind });
    if (kind === "chain") lvl.vines.push(makeVine(x + w * 0.27, r), makeVine(x + w * 0.72, r));
    else if (kind === "mid") lvl.vines.push(makeVine(x + w / 2, r));
    x += w;
  }
  lvl.goalX = x + 500;
  return lvl;
}

/* ===================== ESTADO ===================== */
const $ = (id) => document.getElementById(id);
const cv = $("c"), ctx = cv.getContext("2d");
let G = null;                 // partida actual
let pressed = false;
let user = null, prog = { unlocked: 1, best: {} }, mode = "adv", curMap = 0;
let speedIdx = 1;
try { const v = parseInt(localStorage.getItem("sj_speed")); if (v >= 0 && v < SPEEDS.length) speedIdx = v; } catch {}

function lakeAt(x, margin = 4) {
  if (!G) return null;
  for (const l of G.lvl.lakes) if (x > l.x + margin && x < l.x + l.w - margin) return l;
  return null;
}
const onGround = (x) => !lakeAt(x, 4);
const idleTheta = (v, t) => v.amp * Math.sin(v.w * t + v.phase);

function startGame(mapIdx, m) {
  curMap = mapIdx; mode = m;
  const map = MAPS[mapIdx];
  const lvl = buildLevel(map);
  G = { map, lvl, t: 0, time: 0, cam: 0, edgeT: 0, buf: 0, go: false, hint: null, mul: m === "adv" ? SPEEDS[speedIdx].k : 1, over: false, won: false, cause: "",
        p: { x: 150, y: GROUND, vx: map.speed, vy: 0, state: "run", vine: null, th: 0, om: 0, Le: 0, anim: 0, coy: 0 } };
  G.cam = G.p.x - 200;
  pressed = false;
  showScreen(null);
  $("hud").style.display = "flex"; $("pauseBtn").style.display = "block"; $("goBtn").style.display = "block";
  setGoUI();
  $("hMap").textContent = map.name + (G.mul !== 1 ? " · " + G.mul + "×" : "");
}

/* ===================== FÍSICA / REGLAS ===================== */
function update(dt) {
  const g = G, p = g.p, lvl = g.lvl;
  g.time += dt; g.t += dt;
  const base = g.map.speed * (1 + Math.min(0.2, g.time / 300));
  const target = g.go ? base : 0;   // velocidad a la que se quiere avanzar (0 = detenido)
  g.cam = Math.max(g.cam + target * dt, p.x - 200);

  const press = pressed; pressed = false;
  if (press) g.buf = JUMP_BUF; else g.buf = Math.max(0, g.buf - dt);

  if (p.state === "run") {
    p.vx = target; p.x += p.vx * dt; if (g.go) p.anim += dt * 9; p.coy = COYOTE;
    if (!onGround(p.x)) { p.state = "air"; p.vy = 0; }
    else if (g.buf > 0) { g.go = true; setGoUI(); p.vy = JUMP_V; p.vx = base + JUMP_VX; p.state = "air"; p.coy = 0; g.buf = 0; beep(520, .08); }
  } else if (p.state === "air") {
    // coyote: si acabas de salir del borde, todavía puedes saltar
    if (p.coy > 0) {
      p.coy -= dt;
      if (g.buf > 0 && p.vy >= 0 && p.y <= GROUND + 12) {
        g.go = true; setGoUI(); p.y = GROUND; p.vy = JUMP_V; p.vx = base + JUMP_VX; p.coy = 0; g.buf = 0; beep(520, .08);
      }
    }
    const prevY = p.y;
    p.vy += GRAV * dt; p.y += p.vy * dt;
    p.vx += (target - p.vx) * Math.min(1, dt * 1.5);
    p.x += p.vx * dt;
    if (p.vy > 0 && prevY <= GROUND + 4 && p.y >= GROUND && onGround(p.x)) {
      p.y = GROUND; p.vy = 0; p.state = "run";
    } else if (p.y > GROUND + 45) {
      return die(lakeAt(p.x) ? "💦 ¡Caíste al lago!" : "💦 ¡Chocaste con la orilla!");
    } else {
      tryGrab(g);
    }
  } else if (p.state === "swing") {
    p.om += (-SWING_G / p.Le) * Math.sin(p.th) * dt;
    p.om *= 1 - 0.04 * dt;
    p.th += p.om * dt;
    const v = p.vine;
    p.x = v.ax + p.Le * Math.sin(p.th);
    p.y = v.ay + p.Le * Math.cos(p.th) + HAND;
    if (press) {
      p.vx = Math.max(0, p.Le * p.om * Math.cos(p.th) * 1.05) + RELEASE_VX;
      p.vy = -p.Le * p.om * Math.sin(p.th) + RELEASE_VY;
      p.state = "air"; p.vine = null; v.used = true; g.buf = 0; p.coy = 0; beep(380, .08);
    }
  }

  g.hint = (p.state === "run" && GUIDE) ? predictGrab(g) : null;

  // borde izquierdo: 3 segundos de gracia antes de perder
  if (p.state !== "swing" && p.x < g.cam + 8) p.x = g.cam + 8;
  if (p.x < g.cam + 40) {
    g.edgeT += dt;
    if (g.edgeT >= EDGE_GRACE || p.x < g.cam - 60) return die("Te quedaste atrás ⏱️");
  } else g.edgeT = 0;

  // enemigos
  for (const e of lvl.enemies) {
    if (e.dead) continue;
    if (!e.active && e.x - g.cam < ACT) e.active = true;
    if (!e.active) continue;
    const d = ENEMY[e.type];
    e.x -= d.v * dt; e.anim += dt * (e.type === "snake" ? 5 : 11);
    if (lakeAt(e.x, 10) || e.x < g.cam - 150) { e.dead = true; continue; }
    if (p.state !== "swing") {
      const hit = p.x + 8 > e.x - d.w / 2 + 7 && p.x - 8 < e.x + d.w / 2 - 7 &&
                  p.y - 2 > GROUND - d.h + 4 && p.y - 38 < GROUND;
      if (hit) return die(d.label);
    }
  }

  if (p.x >= lvl.goalX) { g.won = true; g.over = true; setTimeout(() => finish(true), 300); beep(880, .25); }

  // HUD
  const m = Math.floor(Math.min(p.x, lvl.goalX) / PX_M);
  $("hDist").textContent = m + " m / " + Math.floor(lvl.goalX / PX_M) + " m";
  $("hScore").textContent = "⭐ " + (m * 10);
}

// ¿Si saltaras justo ahora, tu mano alcanzaría una liana? (misma física que update; devuelve la liana o null)
function predictGrab(g) {
  const p = g.p;
  const base = g.map.speed * (1 + Math.min(0.2, g.time / 300));
  const dt = 1 / 60;
  let x = p.x, y = GROUND, vx = base + JUMP_VX, vy = JUMP_V, t = g.t + dt;
  for (let i = 0; i < 110; i++) {
    t += dt;
    const prevY = y;
    vy += GRAV * dt; y += vy * dt; vx += (base - vx) * Math.min(1, dt * 1.5); x += vx * dt;
    if (vy > 0 && prevY <= GROUND + 4 && y >= GROUND && onGround(x)) return null;
    if (y > GROUND + 45) return null;
    for (const v of g.lvl.vines) {
      if (v.used || Math.abs(v.ax - x) > 260) continue;
      const th = idleTheta(v, t);
      for (let k = 0.6; k <= 1.001; k += 0.1) {
        const px = v.ax + v.L * k * Math.sin(th), py = v.ay + v.L * k * Math.cos(th);
        if (Math.hypot(px - x, py - (y - HAND)) < GRAB) return v;
      }
    }
  }
  return null;
}

function tryGrab(g) {
  const p = g.p;
  const hx = p.x, hy = p.y - HAND;
  for (const v of g.lvl.vines) {
    if (v.used || Math.abs(v.ax - p.x) > 260) continue;
    const th = idleTheta(v, g.t);
    for (let t = 0.6; t <= 1.001; t += 0.1) {
      const px = v.ax + v.L * t * Math.sin(th), py = v.ay + v.L * t * Math.cos(th);
      if (Math.hypot(px - hx, py - hy) < GRAB) {
        const ang = Math.atan2(hx - v.ax, hy - v.ay);
        const Le = Math.hypot(hx - v.ax, hy - v.ay);
        p.state = "swing"; p.vine = v; p.Le = Le; p.th = ang;
        p.om = (p.vx * Math.cos(ang) - p.vy * Math.sin(ang)) / Le;
        beep(660, .1);
        return;
      }
    }
  }
}

function die(cause) {
  if (G.over) return;
  G.over = true; G.cause = cause; beep(140, .35);
  setTimeout(() => finish(false), 700);
}

async function finish(won) {
  const g = G; if (!g) return;
  const lvl = g.lvl;
  const meters = Math.floor(Math.min(g.p.x, lvl.goalX) / PX_M);
  const par = lvl.goalX / g.map.speed;
  const score = meters * 10 + (won ? 500 + Math.max(0, Math.round((par - g.time) * 20)) : 0);
  $("hud").style.display = "none"; $("pauseBtn").style.display = "none"; $("goBtn").style.display = "none";
  $("oTitle").textContent = won ? "🏆 ¡Llegaste al templo!" : g.cause;
  $("oInfo").textContent = `${g.map.name} · ${meters} m · ${g.time.toFixed(1)} s · ${score} puntos`;
  $("oSave").textContent = "";
  const next = curMap + 1;
  let canNext = false;

  if (mode === "adv") {
    const prev = prog.best[g.map.id] || 0;
    if (score > prev) prog.best[g.map.id] = score;
    if (won && next < MAPS.length && prog.unlocked < next + 1) {
      prog.unlocked = next + 1;
      $("oSave").textContent = "🔓 ¡Desbloqueaste " + MAPS[next].name + "!";
    }
    canNext = won && next < MAPS.length;
  } else {
    canNext = won && next < MAPS.length;
  }
  $("bNext").style.display = canNext ? "block" : "none";
  showScreen("s-over");

  if (user && !user.guest) {
    try {
      if (mode === "adv") await Cloud.saveProgress(user, prog);
      else {
        await Cloud.submitScore(g.map.id, user, score, meters, g.time);
        $("oSave").textContent = "📊 Puntuación enviada al ranking.";
      }
    } catch (e) { $("oSave").textContent = "No se pudo guardar (¿sin conexión?)"; }
  } else if (user && user.guest) {
    $("oSave").textContent += " (Invitado: nada se guarda)";
  }
}

/* ===================== SONIDO ===================== */
let actx = null;
function beep(freq, dur) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), gn = actx.createGain();
    o.type = "square"; o.frequency.value = freq; gn.gain.value = 0.05;
    o.connect(gn); gn.connect(actx.destination);
    o.start(); gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur); o.stop(actx.currentTime + dur);
  } catch {}
}

/* ===================== DIBUJO ===================== */
function circle(x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function ell(x, y, rx, ry, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); }
function line(x1, y1, x2, y2, col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function draw() {
  const g = G, map = g.map, cam = g.cam, lvl = g.lvl;
  ctx.clearRect(0, 0, W, H);
  // cielo
  const gr = ctx.createLinearGradient(0, 0, 0, GROUND);
  gr.addColorStop(0, map.sky[0]); gr.addColorStop(1, map.sky[1]);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  circle(630, 70, 28, map.night ? "#e8f0ff" : "#fff6c0");
  // árboles con parallax
  for (const L of [{ f: 0.15, col: map.far, h: 170, sp: 90, k: 1 }, { f: 0.4, col: map.near, h: 130, sp: 72, k: 2 }]) {
    const i0 = Math.floor((cam * L.f) / L.sp) - 1, i1 = Math.floor((cam * L.f + W) / L.sp) + 1;
    for (let i = i0; i <= i1; i++) {
      const x = i * L.sp - cam * L.f, hh = L.h * (0.6 + 0.6 * hash(i + L.k * 100));
      ctx.fillStyle = L.col; ctx.fillRect(x - 5, GROUND - hh, 10, hh);
      ell(x, GROUND - hh, 34 + hash(i * 3) * 14, 22 + hash(i * 5) * 10, L.col);
    }
  }
  // dosel superior
  for (let wx = Math.floor(cam / 60) * 60 - 60; wx < cam + W + 60; wx += 60) {
    const k = wx / 60;
    ell(wx - cam, 14 + hash(k) * 12, 44, 26, map.leaf);
  }
  // suelo
  ctx.fillStyle = map.dirt; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = map.ground; ctx.fillRect(0, GROUND, W, 10);
  // lagos
  for (const l of lvl.lakes) {
    const x0 = l.x - cam; if (x0 > W || x0 + l.w < 0) continue;
    ctx.fillStyle = map.water; ctx.fillRect(x0, GROUND, l.w, H - GROUND);
    ctx.fillStyle = "rgba(0,20,40,.25)"; ctx.fillRect(x0, GROUND + 40, l.w, H - GROUND - 40);
    ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = 2; ctx.beginPath();
    for (let xx = 0; xx <= l.w; xx += 10) {
      const y = GROUND + 3 + Math.sin((xx + g.t * 60) / 11) * 2;
      xx === 0 ? ctx.moveTo(x0 + xx, y) : ctx.lineTo(x0 + xx, y);
    }
    ctx.stroke();
  }
  // meta
  const gx = lvl.goalX - cam;
  if (gx < W + 100) {
    ctx.fillStyle = "#c9b784"; ctx.fillRect(gx, GROUND - 120, 110, 120);
    ctx.fillStyle = "#a89560"; ctx.fillRect(gx - 10, GROUND - 130, 130, 16);
    ctx.fillStyle = "#2a1c0c"; ctx.fillRect(gx + 38, GROUND - 60, 34, 60);
    ctx.fillStyle = "#fff"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.fillText("META", gx + 55, GROUND - 80);
  }
  // lianas
  for (const v of lvl.vines) {
    const x = v.ax - cam; if (x < -250 || x > W + 250) continue;
    const th = (g.p.state === "swing" && g.p.vine === v) ? g.p.th : idleTheta(v, g.t);
    const ex = x + v.L * Math.sin(th), ey = v.ay + v.L * Math.cos(th);
    ell(x, v.ay - 6, 22, 12, map.leaf);
    line(x, v.ay, ex, ey, map.vine, 4);
    circle(ex, ey, 4, v.used ? "#555" : "#c8e86a");
    if (g.hint === v) {
      ctx.strokeStyle = "#7dff9b"; ctx.lineWidth = 3; ctx.beginPath();
      ctx.arc(ex, ey, 11 + 2 * Math.sin(g.t * 9), 0, 7); ctx.stroke();
      ctx.fillStyle = "#7dff9b"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("¡Salta ya!", ex, ey - 18);
    }
  }
  // enemigos
  for (const e of lvl.enemies) {
    if (e.dead) continue;
    const x = e.x - g.cam; if (x < -80 || x > W + 80) continue;
    ctx.save(); ctx.translate(x, GROUND);
    if (e.type === "jaguar") drawJaguar(e); else if (e.type === "boar") drawBoar(e); else drawSnake(e);
    ctx.restore();
  }
  drawPlayer(g.p, cam);
  if (!g.go && g.p.state === "run" && g.time < 12) {
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(W / 2 - 190, 20, 380, 30);
    ctx.fillStyle = "#fff"; ctx.font = "bold 15px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("▶ Avanzar para caminar · toca la pantalla para saltar", W / 2, 41);
  }
  // aviso de borde izquierdo
  if (g.edgeT > 0.05 && !g.over) {
    const a = 0.25 + 0.35 * (g.edgeT / EDGE_GRACE);
    const eg = ctx.createLinearGradient(0, 0, 160, 0);
    eg.addColorStop(0, `rgba(255,40,40,${a})`); eg.addColorStop(1, "rgba(255,40,40,0)");
    ctx.fillStyle = eg; ctx.fillRect(0, 0, 160, H);
    ctx.fillStyle = "#fff"; ctx.font = "bold 40px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(Math.ceil(EDGE_GRACE - g.edgeT), 40, 200);
  }
}

function drawJaguar(e) {
  const s = Math.sin(e.anim);
  ctx.lineCap = "round";
  line(-14, -6, -14 + s * 8, 0, "#c9822a", 5); line(14, -6, 14 - s * 8, 0, "#c9822a", 5);
  ell(0, -16, 26, 11, "#e9a13b");
  line(-18, -6, -18 - s * 8, 0, "#e9a13b", 5); line(18, -6, 18 + s * 8, 0, "#e9a13b", 5);
  ctx.strokeStyle = "#e9a13b"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(26, -18); ctx.quadraticCurveTo(44, -22, 42, -34 + s * 3); ctx.stroke();
  for (const [sx, sy] of [[-10, -20], [0, -13], [10, -21], [16, -14], [-4, -24]]) circle(sx, sy, 3, "#4a2a08");
  circle(-26, -22, 10, "#e9a13b");
  circle(-31, -32, 3.5, "#e9a13b"); circle(-21, -32, 3.5, "#e9a13b");
  circle(-30, -24, 2, "#111"); circle(-35, -19, 2, "#4a2a08");
}
function drawBoar(e) {
  const s = Math.sin(e.anim);
  ctx.lineCap = "round";
  line(-10, -6, -10 + s * 6, 0, "#4a2f22", 4); line(10, -6, 10 - s * 6, 0, "#4a2f22", 4);
  ell(0, -15, 21, 12, "#6b4a3a");
  line(-14, -6, -14 - s * 6, 0, "#6b4a3a", 4); line(14, -6, 14 + s * 6, 0, "#6b4a3a", 4);
  for (let i = -10; i <= 10; i += 5) line(i, -26, i + 1, -31, "#3a2418", 2);
  circle(-21, -14, 9, "#6b4a3a");
  ctx.fillStyle = "#8a6a58"; ctx.fillRect(-34, -14, 10, 8);
  line(-27, -7, -25, -14, "#f4f0e0", 2.5);
  circle(-22, -17, 1.8, "#111");
}
function drawSnake(e) {
  ctx.lineCap = "round"; ctx.strokeStyle = "#2f9a3a"; ctx.lineWidth = 6; ctx.beginPath();
  for (let xx = -18; xx <= 18; xx += 3) {
    const y = -7 + Math.sin(xx * 0.3 + e.anim) * 4;
    xx === -18 ? ctx.moveTo(xx, y) : ctx.lineTo(xx, y);
  }
  ctx.stroke();
  const hy = -7 + Math.sin(-18 * 0.3 + e.anim) * 4;
  circle(-20, hy - 1, 5, "#2f9a3a"); circle(-22, hy - 2, 1.4, "#111");
  line(-25, hy - 1, -30, hy - 2, "#d03030", 1.5);
}

function drawPlayer(p, cam) {
  const x = p.x - cam, y = p.y;
  ctx.save(); ctx.translate(x, y); ctx.lineCap = "round";
  const skin = "#f2c08a", shirt = "#3b6fb5", pants = "#6b4a2a";
  let l1, l2, a1x, a1y, a2x, a2y;
  if (p.state === "run" && !G.go) {
    l1 = 0.08; l2 = -0.08; a1x = -4; a1y = -14; a2x = 4; a2y = -14;
  } else if (p.state === "run") {
    const s = Math.sin(p.anim);
    l1 = s * 0.9; l2 = -s * 0.9;
    a1x = -s * 10; a1y = -17; a2x = s * 10; a2y = -17;
  } else if (p.state === "air") {
    l1 = 0.7; l2 = -0.4; a1x = -9; a1y = -44; a2x = 9; a2y = -42;
  } else {
    l1 = 0.25; l2 = -0.1; a1x = -2; a1y = -HAND; a2x = 3; a2y = -HAND;
  }
  line(0, -16, Math.sin(l1) * 17, -16 + Math.cos(l1) * 17, pants, 6);
  line(0, -16, Math.sin(l2) * 17, -16 + Math.cos(l2) * 17, pants, 6);
  line(0, -16, 0, -32, shirt, 10);
  line(0, -28, a1x, a1y, skin, 4); line(0, -28, a2x, a2y, skin, 4);
  circle(0, -39, 7, skin);
  ctx.fillStyle = "#8a5a2a"; ctx.fillRect(-9, -43, 18, 3); ctx.fillRect(-5, -50, 10, 8);
  circle(3, -39, 1.4, "#111");
  ctx.restore();
}

/* ===================== INTERFAZ ===================== */
const SCREENS = ["s-auth", "s-menu", "s-maps", "s-rank", "s-over"];
function showScreen(id) { for (const s of SCREENS) $(s).classList.toggle("hidden", s !== id); }

function setGoUI() {
  const b = $("goBtn"); const on = !!(G && G.go);
  b.textContent = on ? "⏸ Detener" : "▶ Avanzar";
  b.className = on ? "sec" : "";
}
function toggleGo() { if (G && !G.over) { G.go = !G.go; setGoUI(); } }

function toMenu() {
  G = null; ctx.clearRect(0, 0, W, H);
  $("hud").style.display = "none"; $("pauseBtn").style.display = "none"; $("goBtn").style.display = "none";
  $("mHello").textContent = "Hola, " + user.name + " · " + VERSION;
  $("bComp").disabled = !!user.guest;
  $("bComp").textContent = user.guest ? "🏆 Competencia (requiere cuenta)" : "🏆 Competencia";
  showScreen("s-menu");
}

function openMaps(m) {
  mode = m;
  $("pTitle").textContent = m === "adv" ? "Aventura" : "Competencia";
  $("pSub").textContent = m === "adv" ? "Completa un mapa para desbloquear el siguiente." : "Todos juegan la misma selva. Gana la mayor puntuación.";
  renderSpeed(m);
  const box = $("mapList"); box.innerHTML = "";
  MAPS.forEach((mp, i) => {
    const locked = m === "adv" && i >= prog.unlocked;
    const b = document.createElement("button");
    b.className = "map " + (locked ? "sec" : "");
    b.disabled = locked;
    const rec = prog.best[mp.id] ? ` · Récord ${prog.best[mp.id]}` : "";
    b.innerHTML = `<span>${locked ? "🔒 " : ""}${mp.name}<small>${mp.desc}${rec}</small></span><span>▶</span>`;
    b.onclick = () => startGame(i, m);
    box.appendChild(b);
  });
  showScreen("s-maps");
}

function renderSpeed(m) {
  const row = $("speedRow"); row.innerHTML = "";
  $("speedNote").textContent = m === "adv" ? "Cambia el ritmo del juego (lagos y animales se ajustan igual)." : "En competencia la velocidad es la misma para todos (Normal).";
  SPEEDS.forEach((sp, i) => {
    const b = document.createElement("button");
    b.textContent = sp.n; b.disabled = m !== "adv";
    b.className = (m === "adv" ? i === speedIdx : i === 1) ? "" : "sec";
    b.onclick = () => { speedIdx = i; try { localStorage.setItem("sj_speed", String(i)); } catch {} renderSpeed(m); };
    row.appendChild(b);
  });
}

async function openRank(idx = 0) {
  const tabs = $("rankTabs"); tabs.innerHTML = "";
  MAPS.forEach((mp, i) => {
    const b = document.createElement("button");
    b.textContent = mp.name.split(" ")[0]; b.className = i === idx ? "" : "sec";
    b.onclick = () => openRank(i); tabs.appendChild(b);
  });
  $("rankBody").innerHTML = "<p>Cargando…</p>"; showScreen("s-rank");
  try {
    const rows = await Cloud.leaderboard(MAPS[idx].id);
    $("rankBody").innerHTML = rows.length
      ? "<table><tr><th>#</th><th>Jugador</th><th>Puntos</th></tr>" +
        rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.score}</td></tr>`).join("") + "</table>"
      : "<p>Aún no hay puntuaciones. ¡Sé el primero!</p>";
  } catch { $("rankBody").innerHTML = "<p>No se pudo cargar el ranking.</p>"; }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function enter(u) {
  user = u; prog = await Cloud.loadProgress(u.uid); toMenu();
}
async function authAction(fn) {
  $("aMsg").textContent = "";
  try { await enter(await fn()); }
  catch (e) { $("aMsg").textContent = e.message || "Error"; }
}

$("bLogin").onclick = () => authAction(() => Cloud.login($("aEmail").value, $("aPass").value));
$("bReg").onclick = () => authAction(() => Cloud.register($("aName").value, $("aEmail").value, $("aPass").value));
$("bGuest").onclick = () => { user = { uid: "guest", name: "Invitado", guest: true }; prog = { unlocked: 1, best: {} }; toMenu(); };
$("bAdv").onclick = () => openMaps("adv");
$("bComp").onclick = () => openMaps("comp");
$("bRank").onclick = () => openRank(0);
$("bOut").onclick = async () => { if (!user.guest) await Cloud.logout(); user = null; showScreen("s-auth"); };
$("bMapsBack").onclick = toMenu;
$("bRankBack").onclick = toMenu;
$("bRetry").onclick = () => startGame(curMap, mode);
$("bNext").onclick = () => startGame(curMap + 1, mode);
$("bOverMenu").onclick = toMenu;
$("pauseBtn").onclick = toMenu;

// control de un solo botón: toque en pantalla / espacio / flecha arriba
cv.addEventListener("pointerdown", (e) => { e.preventDefault(); if (G && !G.over) pressed = true; });
$("goBtn").addEventListener("pointerdown", (e) => { e.preventDefault(); toggleGo(); });
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); if (G && !G.over) pressed = true; }
  if (e.code === "ArrowRight" || e.code === "KeyD") { e.preventDefault(); toggleGo(); }
});

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = W * s + "px"; cv.style.height = H * s + "px";
}
addEventListener("resize", fit); fit();

let last = 0;
function frame(ts) {
  const dt = Math.min(0.033, (ts - last) / 1000 || 0); last = ts;
  if (G) { if (!G.over) update(dt * G.mul); if (G) draw(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ===================== ARRANQUE ===================== */
(async function boot() {
  $("aMode").textContent = Cloud.isCloud
    ? "Conectado a Firebase."
    : "Modo local de prueba: Firebase aún no está configurado (ver README). Tu progreso se guarda solo en este dispositivo.";
  try {
    const u = await Cloud.init();
    if (u) await enter(u); else showScreen("s-auth");
  } catch (e) {
    $("aMsg").textContent = "No se pudo conectar con Firebase. Puedes jugar como invitado.";
    showScreen("s-auth");
  }
})();
