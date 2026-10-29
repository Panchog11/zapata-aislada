/* zapata-calc.js — Cálculo y verificación de zapatas aisladas de H°A°.
 * Módulo puro (sin interfaz): se usa en el navegador como window.ZC y en Node con require().
 * Unidades: m, kN, kN·m, kPa (suelo), MPa (hormigón y acero), mm (diámetros y recubrimientos), cm (separaciones).
 * Numeración de artículos: CIRSOC 201-2005, que adopta la estructura del ACI 318-05.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIAM = [6, 8, 10, 12, 16, 20, 25, 32];
  const ES = 200000; // MPa, §8.5.2
  const abar = d => Math.PI * d * d / 4;          // mm²
  const kgm = d => 0.0061654 * d * d;             // kg/m (7850 kg/m³)
  const beta1 = fc => fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7); // §10.2.7.3

  /* ---------------- Formato ---------------- */
  const nfc = {};
  function fmt(v, d = 1) {
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '−∞';
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (!nfc[d]) nfc[d] = new Intl.NumberFormat('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
    return nfc[d].format(Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v);
  }

  /* ---------------- Datos por defecto y migración ---------------- */
  function defaults() {
    return {
      // 1. Datos generales, materiales y normativa
      nombre: 'Z1', obra: '', norma: 'CIRSOC201-2005',
      fc: 25, fy: 420, fyt: 420, gc: 25, dagg: 19,
      recMinZ: 50, recMinCol: 40,
      sMaxH: 2.5, sMaxDb: 25, sMaxAbs: 300,          // §7.6.5 (configurable)
      estMin: [[16, 6], [25, 8], [32, 10], [99, 12]],  // §7.10.5.1 (configurable): [φ long. máx, φ estribo mín]
      estSepDb: 12,                                   // §7.10.5.2 (configurable)
      critSup: 'cap22',                               // criterio para exigir armadura superior
      sism: false,
      // 2. Cargas y combinaciones
      combos: [
        { id: 'S1', tipo: 'serv', desc: 'D + L', N: 800, Vx: 40, Vy: 25, Mx: 60, My: 90, Mz: 10, gD: 1 },
        { id: 'U1', tipo: 'ult', desc: '1,2 D + 1,6 L', N: 1120, Vx: 56, Vy: 35, Mx: 84, My: 126, Mz: 14, gD: 1.2 }
      ],
      gf: 1.4,
      // 3. Suelo
      sadm: 200, kmax: 1.25, gs: 18, mu: 0.45, ca: 0, Amin: 50, FSv: 1.5, FSd: 1.5,
      // 4. Geometría
      B: 2.6, L: 2.6, H: 0.6, Df: 1.5, cx: 0.4, cy: 0.4, ex0: 0, ey0: 0, apl: 'sup',
      // 5. Armadura de la zapata
      rec: 50, recSup: 50, capa: 'x',
      dbx: 12, sx: 10, dby: 12, sy: 10,
      supX: false, dbxs: 10, sxs: 20, supY: false, dbys: 10, sys: 20,
      ancZ: 'auto',
      // 6. Armadura del fuste
      colModo: 'manual', dbL: 20, nbx: 3, nby: 4, recCol: 40, dbe: 8, se: 15, ancCol: 'gancho',
      // Dimensionamiento automático
      paso: 0.05, Hmin: 0.40, Hmax: 1.50, Lmax: 6.0, vmin: 0.15, forma: 'cuadrada', costoRel: 80,
      diamZ: [10, 12, 16, 20], sMin: 10
    };
  }

  const NUM_KEYS = Object.keys(defaults()).filter(k => typeof defaults()[k] === 'number');

  function normalize(raw) {
    const D = defaults(), I = JSON.parse(JSON.stringify(D));
    if (!raw || typeof raw !== 'object') return I;
    for (const k in D) {
      if (raw[k] === undefined || k === 'combos') continue;
      if (typeof D[k] === 'number') I[k] = parseFloat(raw[k]);
      else if (typeof D[k] === 'boolean') I[k] = raw[k] === true || raw[k] === 'true';
      else I[k] = raw[k];
    }
    if (Array.isArray(raw.combos) && raw.combos.length) {
      I.combos = raw.combos.map((c, i) => ({
        id: String(c.id || ((c.tipo === 'ult' ? 'U' : 'S') + (i + 1))), tipo: c.tipo === 'ult' ? 'ult' : 'serv', desc: String(c.desc || ''),
        N: +c.N || 0, Vx: +c.Vx || 0, Vy: +c.Vy || 0, Mx: +c.Mx || 0, My: +c.My || 0, Mz: +c.Mz || 0,
        gD: c.gD === undefined ? (c.tipo === 'ult' ? 1.2 : 1) : +c.gD
      }));
    } else if (raw.N !== undefined) {
      // Datos de la versión anterior (un estado de servicio y uno último)
      I.combos = [
        { id: 'S1', tipo: 'serv', desc: 'Servicio', N: +raw.N, Vx: +raw.Vx, Vy: +raw.Vy, Mx: +raw.Mx, My: +raw.My, Mz: +raw.Mz, gD: 1 },
        { id: 'U1', tipo: 'ult', desc: 'Último', N: +raw.Nu, Vx: +raw.Vxu, Vy: +raw.Vyu, Mx: +raw.Mxu, My: +raw.Myu, Mz: +raw.Mzu, gD: 1.2 }
      ];
    }
    return I;
  }

  /* ---------------- Validación ---------------- */
  function validate(I) {
    const e = [], w = [];
    const pos = { B: 'B', L: 'L', H: 'H', Df: 'Df', cx: 'cx', cy: 'cy', fc: "f'c", fy: 'fy', fyt: 'fyt', gc: 'γc', sadm: 'σadm', sx: 'separación inf. x', sy: 'separación inf. y', rec: 'recubrimiento inferior', recCol: 'recubrimiento del fuste', se: 'separación de estribos', kmax: 'k', FSv: 'FS vuelco', FSd: 'FS deslizamiento' };
    for (const k of NUM_KEYS) if (!isFinite(I[k])) e.push(`Falta un valor numérico válido en «${k}».`);
    for (const k in pos) if (isFinite(I[k]) && !(I[k] > 0)) e.push(`${pos[k]} debe ser mayor que cero.`);
    if (I.gs < 0 || I.mu < 0 || I.ca < 0) e.push('Los parámetros del suelo no pueden ser negativos.');
    if (!I.combos.some(c => c.tipo === 'serv')) e.push('Falta al menos una combinación de servicio (verificaciones de suelo).');
    if (!I.combos.some(c => c.tipo === 'ult')) e.push('Falta al menos una combinación última (dimensionamiento estructural).');
    I.combos.forEach(c => { ['N', 'Vx', 'Vy', 'Mx', 'My', 'Mz', 'gD'].forEach(k => { if (!isFinite(c[k])) e.push(`Combinación ${c.id}: valor inválido en ${k}.`); }); });
    if (!DIAM.includes(+I.dbx) || !DIAM.includes(+I.dby) || !DIAM.includes(+I.dbL) || !DIAM.includes(+I.dbe)) e.push('Los diámetros deben ser comerciales (6 a 32 mm).');
    if (I.supX && !(I.sxs > 0)) e.push('Separación de la armadura superior x inválida.');
    if (I.supY && !(I.sys > 0)) e.push('Separación de la armadura superior y inválida.');
    if (!(I.nbx >= 2) || !(I.nby >= 2)) e.push('El fuste necesita al menos 2 barras por cara (4 esquinas).');
    if (e.length) return { errors: e, warns: w };
    if (I.cx > I.B || I.cy > I.L) e.push('El fuste es más grande que la zapata.');
    if (Math.abs(I.ex0) + I.cx / 2 > I.B / 2 + 1e-9 || Math.abs(I.ey0) + I.cy / 2 > I.L / 2 + 1e-9) e.push('El fuste queda fuera de la planta de la zapata (revisar ex₀, ey₀).');
    const hb = I.rec + I.dbx + I.dby + (I.supX ? I.dbxs : 0) + (I.supY ? I.dbys : 0) + (I.supX || I.supY ? I.recSup : 0);
    if (hb >= I.H * 1000) e.push('Los recubrimientos y las capas de armadura no entran en la altura H.');
    if (2 * (I.recCol + I.dbe) + 2 * I.dbL >= Math.min(I.cx, I.cy) * 1000) e.push('Las barras del fuste no entran en la sección con el recubrimiento indicado.');
    if (I.H > I.Df + 1e-9) w.push('La altura H supera la profundidad Df: la zapata sobresale del terreno.');
    if (I.fc < 20) w.push("f'c menor que 20 MPa: CIRSOC 201-2005 exige resistencias mínimas según exposición (Cap. 2).");
    if (I.fy > 420) w.push('fy > 420 MPa: verificar disponibilidad y limitaciones del acero.');
    if (I.fyt > 420) w.push('fyt se limita a 420 MPa para el corte (§11.5.2).');
    return { errors: e, warns: w };
  }

  /* ---------------- Presiones bajo la base ---------------- */
  function coords(B, L, n) {
    const N = n * n, X = new Float64Array(N), Y = new Float64Array(N), dx = B / n, dy = L / n;
    let k = 0;
    for (let i = 0; i < n; i++) { const x = -B / 2 + (i + .5) * dx; for (let j = 0; j < n; j++) { X[k] = x; Y[k] = -L / 2 + (j + .5) * dy; k++; } }
    return { X, Y, N, dA: dx * dy, n };
  }
  function solve3(A, b) {
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A); if (!isFinite(D) || Math.abs(D) < 1e-300) return null;
    return [0, 1, 2].map(c => det(A.map((r, i) => r.map((v, j) => j === c ? b[i] : v))) / D);
  }
  /** Distribución lineal sin tracciones σ = a + b·x + c·y ≥ 0 que equilibra P, Mx (comprime +y) y My (comprime +x). */
  function solvePressure(P, Mx, My, B, L, n = 120) {
    const r = { P, Mx, My };
    if (!(P > 0)) { r.fail = 'La carga vertical resultante es nula o de tracción (despegue total).'; return r; }
    r.ex = My / P; r.ey = Mx / P;
    if (Math.abs(r.ex) >= B / 2 || Math.abs(r.ey) >= L / 2) { r.fail = 'La resultante cae fuera de la base (vuelco).'; return r; }
    let a = P / (B * L), b = 12 * My / (L * B ** 3), c = 12 * Mx / (B * L ** 3);
    r.sLin = [a + Math.abs(b) * B / 2 + Math.abs(c) * L / 2, a - Math.abs(b) * B / 2 - Math.abs(c) * L / 2];
    r.full = r.sLin[1] >= -1e-9 * a;
    const G = coords(B, L, n);
    if (!r.full) {
      const { X, Y, N, dA } = G;
      const phi = (a, b, c) => { let s = 0; for (let k = 0; k < N; k++) { const v = a + b * X[k] + c * Y[k]; if (v > 0) s += v * v; } return .5 * s * dA - (a * P + b * My + c * Mx); };
      for (let it = 0; it < 150; it++) {
        let F0 = 0, F1 = 0, F2 = 0, J00 = 0, J01 = 0, J02 = 0, J11 = 0, J12 = 0, J22 = 0;
        for (let k = 0; k < N; k++) { const x = X[k], y = Y[k], v = a + b * x + c * y; if (v > 0) { F0 += v; F1 += v * x; F2 += v * y; J00++; J01 += x; J02 += y; J11 += x * x; J12 += x * y; J22 += y * y; } }
        F0 = F0 * dA - P; F1 = F1 * dA - My; F2 = F2 * dA - Mx;
        if (Math.abs(F0) < 1e-9 * P && Math.abs(F1) < 1e-9 * P * B && Math.abs(F2) < 1e-9 * P * L) break;
        const d = solve3([[J00, J01, J02], [J01, J11, J12], [J02, J12, J22]].map(r => r.map(v => v * dA)), [-F0, -F1, -F2]);
        if (!d) break;
        const p0 = phi(a, b, c), sl = F0 * d[0] + F1 * d[1] + F2 * d[2]; let t = 1;
        while (t > 1e-7 && phi(a + t * d[0], b + t * d[1], c + t * d[2]) > p0 + 1e-4 * t * sl) t *= .5;
        a += t * d[0]; b += t * d[1]; c += t * d[2];
      }
    }
    r.a = a; r.b = b; r.c = c;
    r.sig = (x, y) => Math.max(0, a + b * x + c * y);
    let cnt = 0; for (let k = 0; k < G.N; k++) if (a + b * G.X[k] + c * G.Y[k] > 0) cnt++;
    r.contact = r.full ? 1 : cnt / G.N;
    r.corners = [[-B / 2, -L / 2], [B / 2, -L / 2], [B / 2, L / 2], [-B / 2, L / 2]].map(([x, y]) => ({ x, y, v: r.sig(x, y) }));
    r.sMax = Math.max(...r.corners.map(q => q.v));
    r.sMin = Math.min(...r.corners.map(q => q.v));
    return r;
  }

  /* ---------------- Pesos y brazos ---------------- */
  function weights(I) {
    const { B, L, H, Df, cx, cy } = I, hf = Math.max(Df - H, 0), terr = I.apl === 'terr';
    const Wf = B * L * H * I.gc;
    const Wp = terr ? cx * cy * hf * I.gc : 0;   // fuste enterrado (si las cargas llegan a ±0,00)
    const Ws = (B * L - cx * cy) * hf * I.gs;    // relleno sobre la zapata
    const Wv = cx * cy * hf * I.gs;              // relleno desplazado por el fuste (genera momento si hay ex₀, ey₀)
    return { Wf, Wp, Ws, Wv, W: Wf + Wp + Ws, hf, hz: terr ? Df : H, htop: terr ? hf : 0 };
  }

  /* ---------------- Alturas útiles ---------------- */
  function depths(I) {
    const H = I.H, r = I.rec / 1000, rs = I.recSup / 1000;
    const bx = I.dbx / 1000, by = I.dby / 1000, tx = I.supX ? I.dbxs / 1000 : 0, ty = I.supY ? I.dbys / 1000 : 0;
    let dx, dy, zx, zy, dxs, dys, zxs, zys;
    // z medido desde la base de la zapata hasta el eje de cada capa
    if (I.capa === 'x') { zx = r + bx / 2; zy = r + bx + by / 2; zxs = H - rs - tx / 2; zys = H - rs - tx - ty / 2; }
    else { zy = r + by / 2; zx = r + by + bx / 2; zys = H - rs - ty / 2; zxs = H - rs - ty - tx / 2; }
    dx = H - zx; dy = H - zy; dxs = zxs; dys = zys;
    const gap = H - r - bx - by - rs - tx - ty; // luz libre entre mallas
    return { dx, dy, dm: (dx + dy) / 2, dxs, dys, zx, zy, zxs, zys, gap };
  }

  /* ---------------- Flexión (§10.2, §10.3, §9.3.2) ---------------- */
  function phiFlex(et, fy) { const ey = fy / ES; if (et >= 0.005) return 0.9; if (et <= ey) return 0.65; return 0.65 + 0.25 * (et - ey) / (0.005 - ey); }
  function flexAt(As, dmm, fc, fy) {
    const b = 1000, b1 = beta1(fc), a = As * fy / (0.85 * fc * b), c = a / b1;
    const et = c > 0 ? 0.003 * (dmm - c) / c : Infinity, phi = phiFlex(et, fy);
    const Mn = As * fy * (dmm - a / 2) / 1e6;
    return { a, c, et, phi, Mn, phiMn: phi * Mn };
  }
  /** Armadura necesaria por metro (mm²/m) para mu (kN·m/m) con altura útil d (m). */
  function asRequired(mu, d, fc, fy) {
    const dmm = d * 1000, b = 1000, b1 = beta1(fc);
    const AsMax = 0.85 * fc * b * b1 * (0.003 / 0.007) * dmm / fy; // εt = 0,004 (§10.3.5)
    if (!(mu > 0)) return { AsReq: 0, AsMax };
    const k = 1 - 2 * (mu * 1e6 / 0.9) / (0.85 * fc * b * dmm * dmm);
    let As = k < 0 ? AsMax : 0.85 * fc * b * dmm / fy * (1 - Math.sqrt(k));
    if (flexAt(As, dmm, fc, fy).phiMn >= mu * (1 - 1e-9) && As <= AsMax) return { AsReq: As, AsMax };
    if (flexAt(AsMax, dmm, fc, fy).phiMn < mu) return { AsReq: Infinity, AsMax };
    let lo = Math.min(As, AsMax), hi = AsMax;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (flexAt(m, dmm, fc, fy).phiMn >= mu) hi = m; else lo = m; }
    return { AsReq: hi, AsMax };
  }
  const rhoMin = fy => fy < 420 ? 0.0020 : Math.max(0.0014, 0.0018 * 420 / fy); // §7.12.2.1 vía §10.5.4

  /* ---------------- Anclajes (§12.2, §12.3, §12.5) ---------------- */
  function ldTension(db, fc, fy, psit, good) {
    const small = db <= 19;
    const den = small ? (good ? 2.1 : 1.4) : (good ? 1.7 : 1.1);
    return Math.max(300, fy * Math.min(psit, 1.7) / (den * Math.sqrt(fc)) * db) / 1000;
  }
  const ldHook = (db, fc, fy) => Math.max(8 * db, 150, 0.24 * fy / Math.sqrt(fc) * db) / 1000;
  const ldComp = (db, fc, fy) => Math.max(200, 0.24 * fy / Math.sqrt(fc) * db, 0.043 * fy * db) / 1000;

  /* ---------------- Solicitaciones en la zapata (estado último) ---------------- */
  function scanMoments(G, Q, ax, f1, f2, ext) {
    const U = ax === 'x' ? G.X : G.Y, ns = 24;
    let Mpos = 0, Mneg = 0, posAt = f2, negAt = f2; const Mface = [0, 0];
    [[f2, ext / 2, 1], [f1, -ext / 2, -1]].forEach(([f, e, sg], si) => {
      if (sg * (e - f) <= 1e-9) return;
      for (let i = 0; i < ns; i++) {
        const u = f + (e - f) * i / ns; let M = 0;
        for (let k = 0; k < G.N; k++) { const t = sg * (U[k] - u); if (t > 0) M += Q[k] * t; }
        M *= G.dA;
        if (i === 0) Mface[si] = M;
        if (M > Mpos) { Mpos = M; posAt = u; }
        if (-M > Mneg) { Mneg = -M; negAt = u; }
      }
    });
    return { Mpos, Mneg, posAt, negAt, Mface };
  }
  function shearAt(G, Q, ax, s1, s2) {
    const U = ax === 'x' ? G.X : G.Y; let Vp = 0, Vm = 0;
    for (let k = 0; k < G.N; k++) { if (U[k] > s2) Vp += Q[k]; if (U[k] < s1) Vm += Q[k]; }
    Vp *= G.dA; Vm *= G.dA;
    return { Vp, Vm, V: Math.max(Math.abs(Vp), Math.abs(Vm)), s1, s2 };
  }
  /** Punzonado con perímetro crítico a d/2 (§11.12.1.2), recortado por los bordes de la zapata. */
  function punching(I, G, Q, Pc, MyT, MxT, d) {
    const { B, L, cx, cy, ex0, ey0 } = I;
    let xa = ex0 - (cx + d) / 2, xb = ex0 + (cx + d) / 2, ya = ey0 - (cy + d) / 2, yb = ey0 + (cy + d) / 2;
    const sL = xa > -B / 2, sR = xb < B / 2, sB = ya > -L / 2, sT = yb < L / 2;
    xa = Math.max(xa, -B / 2); xb = Math.min(xb, B / 2); ya = Math.max(ya, -L / 2); yb = Math.min(yb, L / 2);
    const segs = [];
    if (sL) segs.push({ o: 'v', k: xa, a: ya, b: yb }); if (sR) segs.push({ o: 'v', k: xb, a: ya, b: yb });
    if (sB) segs.push({ o: 'h', k: ya, a: xa, b: xb }); if (sT) segs.push({ o: 'h', k: yb, a: xa, b: xb });
    const ns = segs.length, r = { ns, xa, xb, ya, yb, segs };
    if (ns < 2) { r.na = true; return r; }
    let bo = 0, sx = 0, sy = 0;
    segs.forEach(s => { const l = s.b - s.a; bo += l; if (s.o === 'v') { sx += l * s.k; sy += l * (s.a + s.b) / 2; } else { sy += l * s.k; sx += l * (s.a + s.b) / 2; } });
    const xcs = sx / bo, ycs = sy / bo;
    let Jy = 0, Jx = 0;
    segs.forEach(s => {
      const l = s.b - s.a;
      if (s.o === 'v') { Jy += d * l * (s.k - xcs) ** 2; Jx += d * ((s.b - ycs) ** 3 - (s.a - ycs) ** 3) / 3 + l * d ** 3 / 12; }
      else { Jx += d * l * (s.k - ycs) ** 2; Jy += d * ((s.b - xcs) ** 3 - (s.a - xcs) ** 3) / 3 + l * d ** 3 / 12; }
    });
    let R = 0, Rx = 0, Ry = 0;
    for (let k = 0; k < G.N; k++) { const x = G.X[k], y = G.Y[k]; if (x > xa && x < xb && y > ya && y < yb) { R += Q[k]; Rx += Q[k] * (x - xcs); Ry += Q[k] * (y - ycs); } }
    R *= G.dA; Rx *= G.dA; Ry *= G.dA;
    const b1 = xb - xa, b2 = yb - ya;
    const gvy = 1 - 1 / (1 + 2 / 3 * Math.sqrt(b1 / b2)), gvx = 1 - 1 / (1 + 2 / 3 * Math.sqrt(b2 / b1)); // §13.5.3.2
    const Vu = Pc - R;
    const Muy = MyT + Pc * (ex0 - xcs) - Rx, Mux = MxT + Pc * (ey0 - ycs) - Ry;
    const cxm = Math.max(xb - xcs, xcs - xa), cym = Math.max(yb - ycs, ycs - ya);
    const v1 = Vu / (bo * d), v2 = gvy * Math.abs(Muy) * cxm / Jy, v3 = gvx * Math.abs(Mux) * cym / Jx;
    Object.assign(r, { bo, xcs, ycs, Jx, Jy, b1, b2, gvx, gvy, R, Vu, Muy, Mux, cxm, cym, v1, v2, v3, vu: (v1 + v2 + v3) / 1000, alphaS: ns === 4 ? 40 : ns === 3 ? 30 : 20 });
    return r;
  }

  function ultCombo(I, W, c, dd) {
    const { B, L, H, ex0, ey0, cx, cy } = I, g = c.gD;
    const Pc = c.N + g * W.Wp;                 // carga en la cara superior de la zapata
    const Pg = Pc + g * (W.Wf + W.Ws);          // resultante vertical bruta
    const My = c.My + c.Vx * W.hz + Pc * ex0 - g * W.Wv * ex0;
    const Mx = c.Mx + c.Vy * W.hz + Pc * ey0 - g * W.Wv * ey0;
    const sol = solvePressure(Pg, Mx, My, B, L, 120);
    const r = { id: c.id, c, Pc, Pg, My, Mx, sol, MyT: c.My + c.Vx * W.htop, MxT: c.Mx + c.Vy * W.htop };
    if (sol.fail) return r;
    const G = coords(B, L, 140), Q = new Float64Array(G.N);
    const wOut = g * (H * I.gc + W.hf * I.gs), wIn = g * H * I.gc;
    for (let k = 0; k < G.N; k++) {
      const inCol = Math.abs(G.X[k] - ex0) < cx / 2 && Math.abs(G.Y[k] - ey0) < cy / 2;
      Q[k] = sol.sig(G.X[k], G.Y[k]) - (inCol ? wIn : wOut);
    }
    r.wOut = wOut;
    r.fx = scanMoments(G, Q, 'x', ex0 - cx / 2, ex0 + cx / 2, B);
    r.fy = scanMoments(G, Q, 'y', ey0 - cy / 2, ey0 + cy / 2, L);
    r.vx = shearAt(G, Q, 'x', ex0 - cx / 2 - dd.dx, ex0 + cx / 2 + dd.dx);
    r.vy = shearAt(G, Q, 'y', ey0 - cy / 2 - dd.dy, ey0 + cy / 2 + dd.dy);
    r.p = punching(I, G, Q, Pc, r.MyT, r.MxT, dd.dm);
    return r;
  }

  function serviceCombo(I, W, c, n = 120) {
    const { B, L } = I;
    const P = c.N + W.W;
    const My = c.My + c.Vx * W.hz + (c.N + W.Wp - W.Wv) * I.ex0;
    const Mx = c.Mx + c.Vy * W.hz + (c.N + W.Wp - W.Wv) * I.ey0;
    const s = solvePressure(P, Mx, My, B, L, n);
    s.id = c.id; s.c = c;
    if (!s.fail) {
      s.Hs = Math.hypot(c.Vx, c.Vy); s.Ac = s.contact * B * L; s.Hr = I.mu * P + I.ca * s.Ac;
      if (Math.abs(c.Mz) > 0) {
        const G = coords(B, L, 80); let Tr = 0;
        for (let k = 0; k < G.N; k++) { const v = s.sig(G.X[k], G.Y[k]); if (v > 0) Tr += (I.mu * v + I.ca) * Math.hypot(G.X[k], G.Y[k]) * G.dA; }
        s.Tr = Tr;
      }
    }
    return s;
  }

  /* ---------------- Fuste: sección y flexo-compresión ---------------- */
  function colSection(I, dbL = I.dbL, nbx = I.nbx, nby = I.nby, dbe = I.dbe) {
    const b = I.cx, h = I.cy, r = (I.recCol + dbe + dbL / 2) / 1000, A = abar(dbL) / 1e6, bars = [];
    for (let i = 0; i < nbx; i++) { const x = -(b / 2 - r) + (b - 2 * r) * i / (nbx - 1); bars.push({ x, y: -(h / 2 - r), A, f: 'x' }); bars.push({ x, y: h / 2 - r, A, f: 'x' }); }
    for (let j = 1; j < nby - 1; j++) { const y = -(h / 2 - r) + (h - 2 * r) * j / (nby - 1); bars.push({ x: -(b / 2 - r), y, A, f: 'y' }); bars.push({ x: b / 2 - r, y, A, f: 'y' }); }
    const nf = 18, fib = [], dA = b * h / (nf * nf);
    for (let i = 0; i < nf; i++) for (let j = 0; j < nf; j++) fib.push({ x: -b / 2 + (i + .5) * b / nf, y: -h / 2 + (j + .5) * h / nf, A: dA });
    const As = bars.length * A;
    return { b, h, r, dbL, nbx, nby, dbe, bars, fib, As, Ag: b * h, n: bars.length };
  }
  function colState(sec, fc, fy, th, c) {
    const n0 = Math.cos(th), n1 = Math.sin(th), b1 = beta1(fc);
    const zmax = Math.max(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => i * sec.b / 2 * n0 + j * sec.h / 2 * n1));
    const zb = zmax - b1 * c, z0 = zmax - c, fcb = 0.85 * fc * 1000;
    let P = 0, Mx = 0, My = 0, emin = Infinity;
    for (const f of sec.fib) { const z = f.x * n0 + f.y * n1; if (z >= zb) { const F = fcb * f.A; P += F; Mx += F * f.y; My += F * f.x; } }
    for (const s of sec.bars) {
      const z = s.x * n0 + s.y * n1, e = 0.003 * (z - z0) / c;
      let fs = Math.max(-fy, Math.min(fy, ES * e)); if (z >= zb) fs -= 0.85 * fc;
      const F = fs * 1000 * s.A; P += F; Mx += F * s.y; My += F * s.x; if (e < emin) emin = e;
    }
    const et = -emin, phi = phiFlex(et, fy);
    return { P, Mx, My, phi, et };
  }
  function colCapacity(sec, fc, fy, Pu, Mux, Muy) {
    const Po = (0.85 * fc * (sec.Ag - sec.As) + fy * sec.As) * 1000;
    const phiPnMax = 0.65 * 0.80 * Po, phiPnMin = -0.9 * fy * sec.As * 1000; // §10.3.6.2, §9.3.2
    const out = { Po, phiPnMax, phiPnMin, Pu, Mux, Muy };
    if (Pu > phiPnMax) { out.u = Pu / phiPnMax; out.rM = 0; return out; }
    if (Pu < phiPnMin) { out.u = Pu / phiPnMin; out.rM = 0; return out; }
    const pts = [], hmax = Math.max(sec.b, sec.h);
    const cs = []; for (let i = 0; i <= 40; i++) cs.push(1e-4 * hmax * Math.pow(3e5, i / 40));
    for (let t = 0; t < 72; t++) {
      const th = t * Math.PI / 36, f = c => { const s = colState(sec, fc, fy, th, c); return s.phi * s.P - Pu; };
      let lo = null, hi = null, flo = f(cs[0]);
      for (let i = 1; i < cs.length; i++) { const fi = f(cs[i]); if (flo < 0 && fi >= 0) { lo = cs[i - 1]; hi = cs[i]; break; } flo = fi; }
      if (lo === null) continue;
      for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; if (f(m) >= 0) hi = m; else lo = m; }
      const s = colState(sec, fc, fy, th, hi); pts.push([s.phi * s.Mx, s.phi * s.My]);
    }
    out.pts = pts;
    const Mm = Math.hypot(Mux, Muy);
    let uM = 0, rM = Infinity;
    if (Mm > 1e-9 && pts.length > 2) {
      const ux = Mux / Mm, uy = Muy / Mm;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length], ex = q[0] - p[0], ey = q[1] - p[1];
        const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-12) continue;
        const t = (p[0] * ey - p[1] * ex) / den, s = (p[0] * uy - p[1] * ux) / den;
        if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < rM) rM = t;
      }
      uM = rM === Infinity ? Infinity : Mm / rM;
    }
    out.rM = rM;
    out.u = Math.max(uM, Pu > 0 ? Pu / phiPnMax : Pu / phiPnMin);
    return out;
  }
  /** Barras con apoyo lateral de estribo (§7.10.5.3): esquinas, alternadas y luz libre ≤ 150 mm. */
  function supportedBars(n, span, db) {
    if (n <= 2) return n;
    const sp = span / (n - 1), sup = [0];
    let last = 0;
    for (let i = 1; i < n - 1; i++) {
      const clearLast = (i - last) * sp - db, clearNext = (n - 1 - i) * sp - db;
      if (i - last >= 2 || clearLast > 150) { sup.push(i); last = i; }
      else if (clearNext > 150 && (i + 1 - last) * sp - db > 150) { sup.push(i); last = i; }
    }
    sup.push(n - 1);
    return sup.length;
  }
  function tieMinDiam(I, dbL) { for (const [m, d] of I.estMin) if (dbL <= m) return d; return 12; }

  function colShear(I, sec, Nu, Vu, dir, se, legs) {
    const fc = I.fc, fyt = Math.min(I.fyt, 420), sq = Math.sqrt(fc);
    const h = dir === 'x' ? sec.b : sec.h, bw = dir === 'x' ? sec.h : sec.b;
    const d = h - sec.r, Ag = sec.Ag;
    const ax = Nu / (Ag * 1000); // MPa
    const Vc = Math.max(0, (Nu >= 0 ? (1 + ax / 14) : (1 + 0.29 * ax)) * sq / 6 * bw * d * 1000); // §11.3.1.2 / §11.3.2.3
    const Av = legs * abar(I.dbe); // mm²
    const Vs = Av * fyt * d * 1000 / (se * 10) / 1000; // kN
    const VsMax = 2 / 3 * sq * bw * d * 1000;           // §11.5.7.9
    const phiVn = 0.75 * (Vc + Math.min(Vs, VsMax));
    const needMin = Math.abs(Vu) > 0.5 * 0.75 * Vc;       // §11.5.6.1
    const AvMin = Math.max(0.062 * sq, 0.35) * bw * 1000 * se * 10 / fyt; // §11.5.6.3 (mm²)
    const Vsreq = Math.max(0, Math.abs(Vu) / 0.75 - Vc);
    const sMaxV = Vsreq > sq / 3 * bw * d * 1000 ? Math.min(d / 4, 0.3) : Math.min(d / 2, 0.6); // §11.5.5
    const sReq = Vsreq > 0 ? Av * fyt * d / (Vsreq / 1000) / 1e6 : Infinity; // m
    return { dir, d, bw, Vc, Vs, VsMax, phiVn, Vu: Math.abs(Vu), needMin, AvMin, Av, legs, sMaxV, sReq, Vsreq };
  }

  function columnDesign(I, ults) {
    const sec = colSection(I);
    const legsX = supportedBars(I.nby, (sec.h - 2 * sec.r) * 1000, I.dbL); // ramas paralelas a x
    const legsY = supportedBars(I.nbx, (sec.b - 2 * sec.r) * 1000, I.dbL); // ramas paralelas a y
    const list = ults.map(c => {
      const W = c.W; const Pu = c.c.N + c.c.gD * W.Wp;
      const Mux = c.c.Mx + c.c.Vy * W.htop, Muy = c.c.My + c.c.Vx * W.htop;
      const cap = colCapacity(sec, I.fc, I.fy, Pu, Mux, Muy);
      const shx = colShear(I, sec, Pu, c.c.Vx, 'x', I.se, legsX), shy = colShear(I, sec, Pu, c.c.Vy, 'y', I.se, legsY);
      // tracción en barras (sección bruta elástica, hipótesis indicativa)
      const Ix = sec.b * sec.h ** 3 / 12, Iy = sec.h * sec.b ** 3 / 12;
      let smin = Infinity; sec.bars.forEach(s => { const v = Pu / sec.Ag + Mux * s.y / Ix + Muy * s.x / Iy; if (v < smin) smin = v; });
      return { id: c.id, Pu, Mux, Muy, Vx: c.c.Vx, Vy: c.c.Vy, cap, shx, shy, tension: smin < 0, smin };
    });
    return { sec, legsX, legsY, list };
  }

  /** Busca la armadura longitudinal mínima que verifica (independiente del modo elegido). */
  function columnAuto(I, ults, maxEval = 60) {
    const cands = [];
    for (const db of [12, 16, 20, 25]) for (let nx = 2; nx <= 8; nx++) for (let ny = 2; ny <= 8; ny++) {
      const t = Object.assign({}, I, { dbL: db });
      const dbe = Math.max(I.dbe, tieMinDiam(I, db));
      const r = (I.recCol + dbe + db / 2);
      const clx = (I.cx * 1000 - 2 * r) / (nx - 1) - db, cly = (I.cy * 1000 - 2 * r) / (ny - 1) - db;
      const cmin = Math.max(1.5 * db, 40, 4 / 3 * I.dagg);
      if (clx < cmin || cly < cmin) continue;
      const As = (2 * nx + 2 * ny - 4) * abar(db), rho = As / (I.cx * I.cy * 1e6);
      if (rho < 0.01 || rho > 0.08) continue;
      cands.push({ db, nx, ny, As, n: 2 * nx + 2 * ny - 4, dbe, t });
    }
    cands.sort((a, b) => a.As - b.As || a.n - b.n);
    let ev = 0;
    for (const c of cands) {
      if (ev++ > maxEval) break;
      const sec = colSection(I, c.db, c.nx, c.ny, c.dbe);
      const ok = ults.every(u => { const W = u.W; const Pu = u.c.N + u.c.gD * W.Wp; return colCapacity(sec, I.fc, I.fy, Pu, u.c.Mx + u.c.Vy * W.htop, u.c.My + u.c.Vx * W.htop).u <= 1; });
      if (ok) return { dbL: c.db, nbx: c.nx, nby: c.ny, dbe: c.dbe, As: c.As, rho: c.As / (I.cx * I.cy * 1e6) };
    }
    return null;
  }

  /** Separación de estribos adoptable (redondeo a 2,5 cm hacia abajo). */
  function tieSpacingAuto(I, sec, ults, legsX, legsY, dbe) {
    const T = Object.assign({}, I, { dbe });
    let s = Math.min(I.estSepDb * I.dbL, 48 * dbe, Math.min(I.cx, I.cy) * 1000); // mm, §7.10.5.2
    ults.forEach(u => {
      const W = u.W, Pu = u.c.N + u.c.gD * W.Wp;
      [['x', u.c.Vx, legsX], ['y', u.c.Vy, legsY]].forEach(([dir, V, legs]) => {
        const sh = colShear(T, sec, Pu, V, dir, 10, legs);
        if (sh.Vsreq > 0) s = Math.min(s, sh.sReq * 1000, sh.sMaxV * 1000);
        if (sh.needMin) { const smaxMin = sh.Av * Math.min(I.fyt, 420) / (Math.max(0.062 * Math.sqrt(I.fc), 0.35) * sh.bw * 1000); s = Math.min(s, smaxMin, sh.sMaxV * 1000); }
      });
    });
    return Math.max(5, Math.floor(s / 25) * 2.5); // cm
  }

  /* ---------------- Verificaciones ---------------- */
  function mkCheck(o) {
    let u = o.u === undefined ? null : o.u, txt = o.txt;
    if (o.st !== 'nv' && o.st !== 'na') {
      if (o.kind === 'le') { u = o.d / o.c; txt = txt || `${fmt(o.d, o.dec)} ≤ ${fmt(o.c, o.dec)} ${o.unit || ''}`; }
      else if (o.kind === 'ge') { u = o.d > 0 ? o.c / o.d : (o.c > 0 ? Infinity : 0); txt = txt || `${fmt(o.d, o.dec)} ≥ ${fmt(o.c, o.dec)} ${o.unit || ''}`; }
      else if (o.kind === 'fs') { u = o.d === Infinity ? 0 : o.c / o.d; txt = txt || `FS = ${o.d > 99 ? '> 99' : fmt(o.d, 2)} ≥ ${fmt(o.c, 2)}`; }
    }
    const st = o.st || (u !== null && u <= 1 + 1e-9 ? 'ok' : 'bad');
    return Object.assign({}, o, { u, txt: txt || '', st });
  }

  function analyze(Iraw, opts = {}) {
    const I = normalize(Iraw);
    const R = { I, checks: [], warn: [], decis: [], err: null };
    const V = validate(I);
    R.warn = V.warns;
    if (V.errors.length) { R.err = V.errors; return R; }
    const { B, L, H, Df, cx, cy, ex0, ey0, fc, fy } = I;
    const W = weights(I); R.W = W;
    const dd = depths(I); R.d = dd;
    const C = R.checks, add = o => { const k = mkCheck(o); C.push(k); return k; };
    const servs = I.combos.filter(c => c.tipo === 'serv'), ults = I.combos.filter(c => c.tipo === 'ult');

    /* ===== Suelo y estabilidad (servicio) ===== */
    R.serv = servs.map(c => serviceCombo(I, W, c, opts.fast ? 60 : 120));
    const gS = 'Suelo y estabilidad · servicio';
    const govS = (fn) => { let best = null; R.serv.forEach(s => { const v = fn(s); if (v && (!best || v.u > best.u)) best = v; }); return best; };
    const failS = R.serv.find(s => s.fail);
    if (failS) add({ key: 'res', g: gS, n: 'Resultante dentro de la base', st: 'bad', txt: failS.fail, combo: failS.id, ref: 'Equilibrio estático', formula: '|ex| < B/2 y |ey| < L/2 con P > 0', subst: `P = ${fmt(failS.P, 1)} kN; ex = ${fmt(failS.ex, 3)} m; ey = ${fmt(failS.ey, 3)} m`, crit: 'Resultante dentro de la base', sug: 'Aumentar B y/o L, o reducir excentricidades.' });
    else {
      const ks = I.kmax * I.sadm;
      const cS = govS(s => ({ s, u: s.sMax / ks }));
      add({ key: 'smax', g: gS, n: 'Tensión máxima en borde', kind: 'le', d: cS.s.sMax, c: ks, unit: 'kPa', dec: 1, combo: cS.s.id,
        ref: 'Estudio geotécnico (σadm, CIRSOC 401)', formula: 'σmax = máx σ(esquinas); σ lineal sin tracciones', subst: cS.s.full ? `σ = ${fmt(cS.s.P, 1)}/${fmt(B * L, 3)} ± 6·${fmt(cS.s.My, 1)}/(${fmt(L, 2)}·${fmt(B, 2)}²) ± 6·${fmt(cS.s.Mx, 1)}/(${fmt(B, 2)}·${fmt(L, 2)}²)` : 'Contacto parcial: se resuelve σ = a + b·x + c·y ≥ 0 por equilibrio (Newton, integración numérica)',
        crit: `σmax ≤ k·σadm = ${fmt(I.kmax, 2)}·${fmt(I.sadm, 0)}`, nt: cS.s.full ? 'Contacto total' : 'Contacto parcial (despegue)', sug: 'Aumentar B y/o L.' });
      const cM = govS(s => ({ s, u: s.P / (B * L) / I.sadm }));
      add({ key: 'smed', g: gS, n: 'Tensión media P/(B·L)', kind: 'le', d: cM.s.P / (B * L), c: I.sadm, unit: 'kPa', dec: 1, combo: cM.s.id,
        ref: 'Estudio geotécnico (σadm, CIRSOC 401)', formula: 'σmed = (N + G)/(B·L)', subst: `${fmt(cM.s.P, 1)} / (${fmt(B, 2)}·${fmt(L, 2)})`, crit: 'σmed ≤ σadm', sug: 'Aumentar el área de la base.' });
      const cA = govS(s => ({ s, u: I.Amin / (s.contact * 100) }));
      add({ key: 'area', g: gS, n: 'Área comprimida', kind: 'ge', d: cA.s.contact * 100, c: I.Amin, unit: '%', dec: 0, combo: cA.s.id,
        ref: 'Criterio de proyecto (dato)', formula: 'Ac/(B·L) de la distribución sin tracciones', subst: `Ac = ${fmt(cA.s.contact * B * L, 3)} m²`, crit: `Ac ≥ ${fmt(I.Amin, 0)} % de B·L`, sug: 'Aumentar la dimensión en la dirección de la excentricidad.' });
      ['x', 'y'].forEach(ax => {
        const dim = ax === 'x' ? B : L;
        const c = govS(s => { const e = Math.abs(ax === 'x' ? s.ex : s.ey); return { s, e, FS: e > 0 ? dim / (2 * e) : Infinity, u: e > 0 ? I.FSv * 2 * e / dim : 0 }; });
        add({ key: 'vuelco' + ax, g: gS, n: `Vuelco alrededor del borde en ${ax}`, kind: 'fs', d: c.FS, c: I.FSv, combo: c.s.id,
          ref: 'Criterio de proyecto (FS dato)', formula: `FS = M estabilizante / M volcador = ${ax === 'x' ? 'B' : 'L'}/(2·|e${ax}|)`, subst: `${fmt(dim, 2)}/(2·${fmt(c.e, 3)})`, crit: `FS ≥ ${fmt(I.FSv, 2)}`, nt: `e${ax} = ${fmt(c.e, 3)} m · ${ax === 'x' ? 'B' : 'L'}/6 = ${fmt(dim / 6, 3)} m`, sug: `Aumentar ${ax === 'x' ? 'B' : 'L'} o el peso estabilizante.` });
      });
      const cD = govS(s => ({ s, FS: s.Hs > 0 ? s.Hr / s.Hs : Infinity, u: s.Hs > 0 ? I.FSd * s.Hs / s.Hr : 0 }));
      add({ key: 'desl', g: gS, n: 'Deslizamiento', kind: 'fs', d: cD.FS, c: I.FSd, combo: cD.s.id,
        ref: 'Criterio de proyecto (μ, ca y FS datos)', formula: 'FS = (μ·P + ca·Ac)/√(Vx² + Vy²)', subst: `(${fmt(I.mu, 2)}·${fmt(cD.s.P, 1)} + ${fmt(I.ca, 1)}·${fmt(cD.s.Ac, 2)}) / ${fmt(cD.s.Hs, 1)}`, crit: `FS ≥ ${fmt(I.FSd, 2)}`, nt: 'No se considera el empuje pasivo lateral', sug: 'Aumentar el peso o la profundidad; considerar llave de corte.' });
      if (R.serv.some(s => Math.abs(s.c.Mz) > 0)) {
        const cT = govS(s => { if (!(Math.abs(s.c.Mz) > 0)) return null; const u = s.Hs / s.Hr + Math.abs(s.c.Mz) / s.Tr; return { s, uu: u, FS: 1 / u, u: I.FSd * u }; });
        add({ key: 'tors', g: gS, n: 'Deslizamiento con torsión Mz', kind: 'fs', d: cT.FS, c: I.FSd, combo: cT.s.id,
          ref: 'Criterio de proyecto (interacción lineal)', formula: '1/FS = H/Hr + |Mz|/Tr,  Tr = ∫(μ·σ + ca)·r dA', subst: `${fmt(cT.s.Hs, 1)}/${fmt(cT.s.Hr, 1)} + ${fmt(Math.abs(cT.s.c.Mz), 1)}/${fmt(cT.s.Tr, 1)} = ${fmt(cT.uu, 3)}`, crit: `FS ≥ ${fmt(I.FSd, 2)}`, sug: 'Aumentar la base o el peso.' });
      }
    }
    if (opts.serviceOnly) return R;

    /* ===== Zapata de H°A° (estado último) ===== */
    const gZ = 'Zapata · hormigón armado (último)';
    R.ult = ults.map(c => { const u = ultCombo(I, W, c, dd); u.W = W; return u; });
    const failU = R.ult.find(u => u.sol.fail);
    const sq = Math.sqrt(fc);
    add({ key: 'dmin', g: gZ, n: 'Altura útil mínima', kind: 'ge', d: Math.min(dd.dx, dd.dy) * 1000, c: 150, unit: 'mm', dec: 0, ref: 'CIRSOC 201-2005 §15.7', formula: 'd = H − rec − capas', subst: `dx = ${fmt(dd.dx * 1000, 0)} mm, dy = ${fmt(dd.dy * 1000, 0)} mm`, crit: 'd ≥ 150 mm', sug: 'Aumentar H.' });
    add({ key: 'recZ', g: gZ, n: 'Recubrimiento de la zapata', kind: 'ge', d: Math.min(I.rec, (I.supX || I.supY) ? I.recSup : Infinity), c: I.recMinZ, unit: 'mm', dec: 0, ref: 'CIRSOC 201-2005 §7.7 (mínimo definido por el usuario según exposición)', formula: 'rec ≥ rec mín', subst: `inferior ${fmt(I.rec, 0)} mm${(I.supX || I.supY) ? `, superior ${fmt(I.recSup, 0)} mm` : ''}`, crit: `rec ≥ ${fmt(I.recMinZ, 0)} mm`, sug: 'Aumentar el recubrimiento.' });
    add({ key: 'gap', g: gZ, n: 'Compatibilidad de capas', kind: 'ge', d: dd.gap * 1000, c: 0.0001, unit: 'mm', dec: 0, ref: 'Geometría', formula: 'H − rec inf − capas inf − rec sup − capas sup', subst: `${fmt(H * 1000, 0)} − … = ${fmt(dd.gap * 1000, 0)} mm`, crit: 'Luz libre entre mallas > 0', sug: 'Aumentar H o reducir diámetros.' });
    if (failU) {
      add({ key: 'resU', g: gZ, n: 'Presión última de diseño', st: 'bad', txt: failU.sol.fail, combo: failU.id, ref: 'Equilibrio estático', formula: 'Resultante dentro de la base', subst: `Pg = ${fmt(failU.Pg, 1)} kN`, crit: '|e| < dimensión/2', sug: 'Aumentar la base.' });
      R.layout = null; return R;
    }
    const gov = (fn) => { let best = null; R.ult.forEach(u => { const v = fn(u); if (v !== null && (!best || v.v > best.v)) best = Object.assign({ u }, v); }); return best; };
    R.dem = {};
    const rho = rhoMin(fy);
    const secDist = (at, f1, f2) => at >= f2 ? at - f2 : f1 - at;
    const smaxF = db => Math.min(I.sMaxH * H * 1000, I.sMaxDb * db, I.sMaxAbs) / 10; // cm
    const plainM = 0.60 * 0.42 * sq * 1000 * Math.pow(Math.max(H * 1000 - 50, 0), 2) / 6 / 1e6; // kN·m/m, §22.5.1, §22.4.8, §9.3.5
    R.plainM = plainM;
    const r = I.rec / 1000;

    ['x', 'y'].forEach(ax => {
      const width = ax === 'x' ? L : B, db = ax === 'x' ? I.dbx : I.dby, s = ax === 'x' ? I.sx : I.sy, d = ax === 'x' ? dd.dx : dd.dy;
      const f1 = ax === 'x' ? ex0 - cx / 2 : ey0 - cy / 2, f2 = ax === 'x' ? ex0 + cx / 2 : ey0 + cy / 2, ext = ax === 'x' ? B : L;
      const gp = gov(u => ({ v: u['f' + ax].Mpos })), gn = gov(u => ({ v: u['f' + ax].Mneg })), gv = gov(u => ({ v: u['v' + ax].V }));
      const mu = gp.v / width, mun = gn.v / width;
      const AsP = abar(db) / (s / 100), fa = flexAt(AsP, d * 1000, fc, fy), req = asRequired(mu, d, fc, fy);
      const AsMin = rho * 1000 * H * 1000;
      const dem = { ax, mu, mun, gp, gn, gv, AsP, fa, req, AsMin, width, d, db, s };
      R.dem[ax] = dem;
      const nm = `dir. ${ax} · φ${db} c/${fmt(s, s % 1 ? 1 : 0)}`;
      if (req.AsReq === Infinity) add({ key: 'flex' + ax, g: gZ, n: `Flexión inferior ${nm}`, st: 'bad', txt: 'Mu supera la capacidad máxima con εt ≥ 0,004', combo: gp.u.id, ref: 'CIRSOC 201-2005 §10.3.5, §15.4', formula: 'φMn(As máx)', subst: `Mu = ${fmt(mu, 1)} kN·m/m`, crit: 'φMn ≥ Mu', sug: 'Aumentar H.' });
      else add({ key: 'flex' + ax, g: gZ, n: `Flexión inferior ${nm}`, kind: 'le', d: mu, c: fa.phiMn, unit: 'kN·m/m', dec: 1, combo: gp.u.id,
        ref: 'CIRSOC 201-2005 §15.4.2, §10.2, §9.3.2', formula: 'Mu = ∫(σu − wu)·(u − u_cara) dA / ancho;  φMn = φ·As·fy·(d − a/2),  a = As·fy/(0,85·f\'c·b)',
        subst: `Mu = ${fmt(gp.v, 1)}/${fmt(width, 2)} = ${fmt(mu, 1)}; a = ${fmt(AsP, 0)}·${fy}/(0,85·${fc}·1000) = ${fmt(fa.a, 1)} mm; φMn = ${fmt(fa.phi, 3)}·${fmt(AsP, 0)}·${fy}·(${fmt(d * 1000, 0)} − ${fmt(fa.a / 2, 1)})·10⁻⁶`,
        crit: 'φMn ≥ Mu', nt: `As nec = ${fmt(req.AsReq, 0)} mm²/m · As prov = ${fmt(AsP, 0)} mm²/m · sección crítica a ${fmt(secDist(gp.u['f' + ax].posAt, f1, f2) * 100, 0)} cm de la cara`, sug: 'Reducir la separación o aumentar el diámetro.' });
      add({ key: 'amin' + ax, g: gZ, n: `Cuantía mínima inferior ${ax}`, kind: 'ge', d: AsP, c: AsMin, unit: 'mm²/m', dec: 0, ref: 'CIRSOC 201-2005 §10.5.4 → §7.12.2.1', formula: 'As mín = ρmín·b·H', subst: `${fmt(rho, 4)}·1000·${fmt(H * 1000, 0)}`, crit: 'As prov ≥ As mín', nt: `s máx para φ${db}: ${fmt(Math.floor(abar(db) / Math.max(AsMin, req.AsReq) * 1000 / 2.5) * 0.25, 1)} cm`, sug: 'Reducir la separación.' });
      add({ key: 'amax' + ax, g: gZ, n: `Cuantía máxima inferior ${ax} (εt)`, kind: 'ge', d: fa.et, c: 0.004, unit: '', dec: 4, ref: 'CIRSOC 201-2005 §10.3.5', formula: 'εt = 0,003·(d − c)/c,  c = a/β1', subst: `c = ${fmt(fa.c, 1)} mm, d = ${fmt(d * 1000, 0)} mm`, crit: 'εt ≥ 0,004', sug: 'Reducir armadura o aumentar H.' });
      add({ key: 'smax' + ax, g: gZ, n: `Separación máxima inferior ${ax}`, kind: 'le', d: s, c: smaxF(db), unit: 'cm', dec: 1, ref: 'CIRSOC 201-2005 §7.6.5 (límites configurables)', formula: `s ≤ mín(${fmt(I.sMaxH, 1)}·H; ${fmt(I.sMaxDb, 0)}·φ; ${fmt(I.sMaxAbs, 0)} mm)`, subst: `mín(${fmt(I.sMaxH * H * 1000, 0)}; ${fmt(I.sMaxDb * db, 0)}; ${fmt(I.sMaxAbs, 0)}) mm`, crit: 's ≤ s máx', sug: 'Reducir la separación.' });
      const smin = Math.max(25, db, 4 / 3 * I.dagg);
      add({ key: 'slib' + ax, g: gZ, n: `Separación libre mínima inferior ${ax}`, kind: 'ge', d: s * 10 - db, c: smin, unit: 'mm', dec: 0, ref: 'CIRSOC 201-2005 §7.6.1, §3.3.2', formula: 'sl = s − φ ≥ máx(25 mm; φ; 4/3·dagg)', subst: `${fmt(s * 10, 0)} − ${db}`, crit: `sl ≥ ${fmt(smin, 0)} mm`, sug: 'Aumentar la separación o el diámetro.' });
      const phiVc = 0.75 * sq / 6 * width * d * 1000;
      add({ key: 'corte' + ax, g: gZ, n: `Corte unidireccional ${ax}`, kind: 'le', d: gv.v, c: phiVc, unit: 'kN', dec: 1, combo: gv.u.id, ref: 'CIRSOC 201-2005 §15.5.2, §11.1.3.1, §11.3.1.1', formula: "Vu a distancia d de la cara;  φVc = 0,75·(√f'c/6)·b·d", subst: `φVc = 0,75·(${fmt(sq, 2)}/6)·${fmt(width, 2)}·${fmt(d, 3)}·1000`, crit: 'Vu ≤ φVc', sug: 'Aumentar H.' });
      // Anclaje inferior
      const cant = Math.min(f1 + ext / 2, ext / 2 - f2) - r;
      const good = (s * 10 - db) >= 2 * db && I.rec >= db;
      const ld = ldTension(db, fc, fy, 1, good), ldh = ldHook(db, fc, fy);
      let mode = I.ancZ === 'auto' ? (cant >= ld ? 'recto' : 'gancho') : I.ancZ;
      dem.anc = { cant, ld, ldh, mode, good };
      if (I.ancZ === 'auto') R.decis.push(`Barras inferiores ${ax}: anclaje ${mode === 'recto' ? 'recto' : 'con gancho normal a 90° (§7.1.2)'} (disponible ${fmt(cant * 1000, 0)} mm; ld = ${fmt(ld * 1000, 0)} mm).`);
      const lreq = mode === 'recto' ? ld : ldh;
      add({ key: 'anc' + ax, g: gZ, n: `Anclaje inferior ${ax} (${mode})`, kind: 'ge', d: cant * 1000, c: lreq * 1000, unit: 'mm', dec: 0, ref: mode === 'recto' ? 'CIRSOC 201-2005 §12.2.2' : 'CIRSOC 201-2005 §12.5.2, §7.1.2',
        formula: mode === 'recto' ? `ld = fy·ψt·ψe·db/(${db <= 19 ? (good ? '2,1' : '1,4') : (good ? '1,7' : '1,1')}·√f'c) ≥ 300 mm` : "ldh = 0,24·fy·db/√f'c ≥ máx(8·db; 150 mm)",
        subst: `disponible = voladizo − rec = ${fmt((cant + r) * 1000, 0)} − ${fmt(I.rec, 0)}`, crit: 'disponible ≥ longitud requerida', nt: good ? 'Separación libre ≥ 2db y recubrimiento ≥ db' : 'No cumple separación libre ≥ 2db: factor de anclaje mayor', sug: mode === 'recto' ? 'Usar gancho o reducir el diámetro.' : 'Reducir el diámetro o ampliar la zapata.' });
      // Armadura superior
      const required = I.critSup === 'siempre' ? mun > 1e-6 : mun > plainM;
      const on = ax === 'x' ? I.supX : I.supY;
      dem.top = { required, mun, plainM, on };
      add({ key: 'supreq' + ax, g: gZ, n: `Tracción en cara superior ${ax}`, st: required ? (on ? 'ok' : 'bad') : 'ok',
        txt: required ? `Mu− = ${fmt(mun, 1)} kN·m/m > ${I.critSup === 'siempre' ? '0' : `φMn,h°s° = ${fmt(plainM, 1)}`} → requiere armadura superior` : `Mu− = ${fmt(mun, 1)} ≤ ${I.critSup === 'siempre' ? '0' : fmt(plainM, 1)} kN·m/m → no requiere`,
        u: required ? (on ? 0 : Infinity) : (plainM > 0 ? mun / plainM : 0), combo: gn.u.id,
        ref: I.critSup === 'siempre' ? 'Criterio de proyecto: armadura superior si Mu− > 0' : 'CIRSOC 201-2005 §22.5.1, §22.4.8, §9.3.5 (resistencia del hormigón simple)',
        formula: 'Mu− = máx[−∫(σu − wu)·(u − u_sec) dA]/ancho;  φMn,h°s° = 0,60·0,42·√f\'c·b·(H − 50 mm)²/6', subst: `φMn,h°s° = 0,60·0,42·${fmt(sq, 2)}·1000·${fmt(H * 1000 - 50, 0)}²/6·10⁻⁶ = ${fmt(plainM, 2)}`,
        crit: 'Si Mu− > φMn,h°s° se exige armadura superior', nt: 'wu = peso propio y relleno mayorados con γD de la combinación', sug: required && !on ? `Activar armadura superior en dirección ${ax}.` : '' });
      if (on) {
        const dbs = ax === 'x' ? I.dbxs : I.dbys, ss = ax === 'x' ? I.sxs : I.sys, ds = ax === 'x' ? dd.dxs : dd.dys;
        const AsPs = abar(dbs) / (ss / 100), fas = flexAt(AsPs, ds * 1000, fc, fy), reqs = asRequired(mun, ds, fc, fy);
        dem.top = Object.assign(dem.top, { dbs, ss, ds, AsPs, fas, reqs, AsMin });
        const nms = `dir. ${ax} · φ${dbs} c/${fmt(ss, ss % 1 ? 1 : 0)}`;
        if (required) {
          if (reqs.AsReq === Infinity) add({ key: 'flexs' + ax, g: gZ, n: `Flexión superior ${nms}`, st: 'bad', txt: 'Mu− supera la capacidad máxima', combo: gn.u.id, ref: 'CIRSOC 201-2005 §10.3.5', formula: '', subst: '', crit: '', sug: 'Aumentar H.' });
          else add({ key: 'flexs' + ax, g: gZ, n: `Flexión superior ${nms}`, kind: 'le', d: mun, c: fas.phiMn, unit: 'kN·m/m', dec: 1, combo: gn.u.id, ref: 'CIRSOC 201-2005 §10.2, §9.3.2', formula: 'φMn = φ·As·fy·(d − a/2)', subst: `As = ${fmt(AsPs, 0)} mm²/m, d = ${fmt(ds * 1000, 0)} mm, a = ${fmt(fas.a, 1)} mm, φ = ${fmt(fas.phi, 3)}`, crit: 'φMn ≥ Mu−', nt: `As nec = ${fmt(reqs.AsReq, 0)} mm²/m`, sug: 'Reducir la separación o aumentar el diámetro.' });
          add({ key: 'amins' + ax, g: gZ, n: `Cuantía mínima superior ${ax}`, kind: 'ge', d: AsPs, c: AsMin, unit: 'mm²/m', dec: 0, ref: 'CIRSOC 201-2005 §10.5.4 → §7.12.2.1 (aplicada a la cara traccionada)', formula: 'As mín = ρmín·b·H', subst: `${fmt(rho, 4)}·1000·${fmt(H * 1000, 0)}`, crit: 'As prov ≥ As mín', sug: 'Reducir la separación.' });
        } else add({ key: 'flexs' + ax, g: gZ, n: `Armadura superior ${nms}`, st: 'ok', txt: `Constructiva (no requerida por cálculo) · As = ${fmt(AsPs, 0)} mm²/m`, ref: 'Decisión del usuario', formula: '', subst: '', crit: '' });
        add({ key: 'amaxs' + ax, g: gZ, n: `Cuantía máxima superior ${ax} (εt)`, kind: 'ge', d: fas.et, c: 0.004, dec: 4, unit: '', ref: 'CIRSOC 201-2005 §10.3.5', formula: 'εt = 0,003·(d − c)/c', subst: `c = ${fmt(fas.c, 1)} mm`, crit: 'εt ≥ 0,004', sug: 'Reducir armadura.' });
        add({ key: 'smaxs' + ax, g: gZ, n: `Separación máxima superior ${ax}`, kind: 'le', d: ss, c: smaxF(dbs), unit: 'cm', dec: 1, ref: 'CIRSOC 201-2005 §7.6.5 (límites configurables)', formula: `s ≤ mín(${fmt(I.sMaxH, 1)}·H; ${fmt(I.sMaxDb, 0)}·φ; ${fmt(I.sMaxAbs, 0)} mm)`, subst: '', crit: 's ≤ s máx', sug: 'Reducir la separación.' });
        const smins = Math.max(25, dbs, 4 / 3 * I.dagg);
        add({ key: 'slibs' + ax, g: gZ, n: `Separación libre mínima superior ${ax}`, kind: 'ge', d: ss * 10 - dbs, c: smins, unit: 'mm', dec: 0, ref: 'CIRSOC 201-2005 §7.6.1, §3.3.2', formula: 'sl = s − φ', subst: '', crit: `sl ≥ ${fmt(smins, 0)} mm`, sug: 'Aumentar la separación.' });
        const psit = (I.H - I.recSup / 1000 - dbs / 1000) > 0.3 ? 1.3 : 1.0;
        const goods = (ss * 10 - dbs) >= 2 * dbs && I.recSup >= dbs;
        const lds = ldTension(dbs, fc, fy, psit, goods), ldhs = ldHook(dbs, fc, fy);
        const ms = I.ancZ === 'auto' ? (cant >= lds ? 'recto' : 'gancho') : I.ancZ;
        dem.top.anc = { ld: lds, ldh: ldhs, mode: ms, psit };
        add({ key: 'ancs' + ax, g: gZ, n: `Anclaje superior ${ax} (${ms})`, kind: 'ge', d: cant * 1000, c: (ms === 'recto' ? lds : ldhs) * 1000, unit: 'mm', dec: 0, ref: ms === 'recto' ? 'CIRSOC 201-2005 §12.2.2, §12.2.4 (ψt = 1,3 barras superiores)' : 'CIRSOC 201-2005 §12.5.2', formula: ms === 'recto' ? 'ld = fy·ψt·ψe·db/(k·√f\'c)' : "ldh = 0,24·fy·db/√f'c", subst: `ψt = ${fmt(psit, 1)}`, crit: 'disponible ≥ longitud requerida', sug: 'Usar gancho o reducir el diámetro.' });
      }
    });

    // Banda central en zapatas rectangulares (§15.4.4.2)
    if (Math.abs(B - L) > 1e-6) {
      const shortX = B < L, Ls = Math.min(B, L), Ll = Math.max(B, L), bt = Ll / Ls, gs = 2 / (bt + 1);
      const dm = R.dem[shortX ? 'x' : 'y'];
      const AsNeed = Math.max(dm.req.AsReq, dm.AsMin);
      const need = gs * AsNeed * Ll, prov = dm.AsP * Ls;
      R.band = { shortX, Ls, Ll, bt, gs, need, prov };
      add({ key: 'banda', g: gZ, n: `Banda central (barras dir. ${shortX ? 'x' : 'y'})`, kind: 'ge', d: prov, c: need, unit: 'mm²', dec: 0, ref: 'CIRSOC 201-2005 §15.4.4.2', formula: 'As banda ≥ 2/(β + 1)·As total, en un ancho igual al lado corto', subst: `β = ${fmt(bt, 3)}; γs = ${fmt(gs, 3)}; As total = ${fmt(AsNeed, 0)}·${fmt(Ll, 2)}`, crit: 'As en la banda ≥ γs·As total', sug: 'Reducir la separación en la dirección corta.' });
    }

    // Punzonado
    const gpz = gov(u => u.p.na ? null : ({ v: u.p.vu }));
    if (!gpz) add({ key: 'punz', g: gZ, n: 'Punzonado', st: 'na', txt: 'El perímetro crítico excede la zapata', ref: 'CIRSOC 201-2005 §11.12.1.2', formula: '', subst: '', crit: '', nt: 'Gobierna el corte unidireccional' });
    else {
      const p = gpz.u.p, beta = Math.max(cx, cy) / Math.min(cx, cy);
      const vc1 = (1 + 2 / beta) * sq / 6, vc2 = (p.alphaS * dd.dm / p.bo + 2) * sq / 12, vc3 = sq / 3, vc = Math.min(vc1, vc2, vc3);
      R.punch = Object.assign({}, p, { beta, vc1, vc2, vc3, vc, id: gpz.u.id });
      add({ key: 'punz', g: gZ, n: `Punzonado (${p.ns === 4 ? 'interior' : p.ns === 3 ? 'borde' : 'esquina'})`, kind: 'le', d: p.vu, c: 0.75 * vc, unit: 'MPa', dec: 3, combo: gpz.u.id,
        ref: 'CIRSOC 201-2005 §11.12.1.2, §11.12.2.1, §11.12.6, §13.5.3.2', formula: "vu = Vu/(bo·d) + γvy·Muy·cx/Jcy + γvx·Mux·cy/Jcx;  vc = mín[(1 + 2/β)·√f'c/6; (αs·d/bo + 2)·√f'c/12; √f'c/3]",
        subst: `Vu = ${fmt(p.Vu, 1)} kN; bo = ${fmt(p.bo, 3)} m; d = ${fmt(dd.dm, 3)} m; Muy = ${fmt(p.Muy, 1)}; Mux = ${fmt(p.Mux, 1)} kN·m; γv = ${fmt(p.gvy, 3)}/${fmt(p.gvx, 3)}; vc = mín(${fmt(vc1, 3)}; ${fmt(vc2, 3)}; ${fmt(vc3, 3)})`,
        crit: 'vu ≤ φ·vc (φ = 0,75)', nt: `αs = ${p.alphaS}; momentos referidos al baricentro del perímetro crítico`, sug: 'Aumentar H.' });
    }
    // Aplastamiento (§10.17, §15.8.1)
    const gPc = gov(u => ({ v: u.Pc }));
    const e2 = Math.max(0, Math.min(2 * H, B / 2 - Math.abs(ex0) - cx / 2, L / 2 - Math.abs(ey0) - cy / 2));
    const A1 = cx * cy, A2 = (cx + 2 * e2) * (cy + 2 * e2), kA = Math.min(2, Math.sqrt(A2 / A1));
    const phiBn = 0.65 * 0.85 * fc * A1 * kA * 1000;
    R.bear = { A1, A2, kA, phiBn };
    add({ key: 'apl', g: gZ, n: 'Aplastamiento en la zapata', kind: 'le', d: gPc.v, c: phiBn, unit: 'kN', dec: 0, combo: gPc.u.id, ref: 'CIRSOC 201-2005 §10.17.1, §15.8.1.1, §9.3.2.4', formula: "φBn = 0,65·0,85·f'c·A1·√(A2/A1),  √(A2/A1) ≤ 2", subst: `0,65·0,85·${fc}·${fmt(A1, 3)}·${fmt(kA, 2)}·1000`, crit: 'Pu ≤ φBn', sug: 'Aumentar la sección del fuste.' });

    /* ===== Fuste ===== */
    const gC = 'Fuste · hormigón armado (último)';
    const ultsW = R.ult.map(u => ({ id: u.id, c: u.c, W }));
    let colI = I;
    if (I.colModo === 'auto') {
      const a = columnAuto(I, ultsW);
      if (a) {
        colI = Object.assign({}, I, { dbL: a.dbL, nbx: a.nbx, nby: a.nby, dbe: a.dbe });
        const secA = colSection(colI);
        const lx = supportedBars(colI.nby, (secA.h - 2 * secA.r) * 1000, colI.dbL), ly = supportedBars(colI.nbx, (secA.b - 2 * secA.r) * 1000, colI.dbL);
        colI.se = tieSpacingAuto(colI, secA, ultsW, lx, ly, colI.dbe);
        R.decis.push(`Fuste (automático): ${2 * a.nbx + 2 * a.nby - 4} φ${a.dbL} (${a.nbx} por cara x, ${a.nby} por cara y), estribos φ${colI.dbe} c/${fmt(colI.se, 1)} cm.`);
        R.colAuto = { dbL: colI.dbL, nbx: colI.nbx, nby: colI.nby, dbe: colI.dbe, se: colI.se };
      } else R.decis.push('Fuste (automático): no se encontró armadura dentro de 1 % – 8 % que verifique. Se muestra la armadura manual.');
    }
    R.I = I; R.colI = colI;
    const CD = columnDesign(colI, ultsW); R.col = CD;
    const sec = CD.sec, rhoC = sec.As / sec.Ag;
    const gcap = CD.list.reduce((a, b) => (b.cap.u > a.cap.u ? b : a));
    add({ key: 'cflex', g: gC, n: `Flexo-compresión oblicua · ${sec.n} φ${colI.dbL}`, kind: 'le', d: gcap.cap.u, c: 1, unit: '', dec: 3, combo: gcap.id,
      ref: 'CIRSOC 201-2005 §10.2, §10.3.6.2, §9.3.2.2', formula: 'Compatibilidad de deformaciones (εcu = 0,003, bloque 0,85·f\'c·β1·c), barrido del eje neutro; u = |Mu|/|φMn| en la dirección de Mu a Pu dado',
      subst: `Pu = ${fmt(gcap.Pu, 1)} kN; Mux = ${fmt(gcap.Mux, 1)}; Muy = ${fmt(gcap.Muy, 1)} kN·m; φPn,máx = 0,65·0,80·Po = ${fmt(gcap.cap.phiPnMax, 0)} kN; |φMn| = ${fmt(gcap.cap.rM, 1)} kN·m`,
      crit: 'u ≤ 1', nt: 'Sección en la unión con la zapata', sug: 'Aumentar la armadura o la sección.' });
    add({ key: 'crho', g: gC, n: 'Cuantía longitudinal', st: rhoC >= 0.01 - 1e-9 && rhoC <= 0.08 + 1e-9 ? 'ok' : 'bad', u: rhoC < 0.01 ? 0.01 / rhoC : rhoC / 0.08, txt: `ρ = ${fmt(rhoC * 100, 2)} % (1 % ≤ ρ ≤ 8 %)`, ref: 'CIRSOC 201-2005 §10.9.1', formula: 'ρ = As/Ag', subst: `${fmt(sec.As * 1e6, 0)} mm² / ${fmt(sec.Ag * 1e6, 0)} mm²`, crit: '0,01 ≤ ρ ≤ 0,08', sug: rhoC < 0.01 ? 'Agregar barras o aumentar el diámetro.' : 'Aumentar la sección.' });
    add({ key: 'cnb', g: gC, n: 'Cantidad mínima de barras', kind: 'ge', d: sec.n, c: 4, unit: 'barras', dec: 0, ref: 'CIRSOC 201-2005 §10.9.2', formula: 'n ≥ 4 (estribos rectangulares)', subst: '', crit: 'n ≥ 4' });
    const clx = (sec.b - 2 * sec.r) * 1000 / (colI.nbx - 1) - colI.dbL, cly = (sec.h - 2 * sec.r) * 1000 / (colI.nby - 1) - colI.dbL;
    const cminC = Math.max(1.5 * colI.dbL, 40, 4 / 3 * I.dagg);
    add({ key: 'csl', g: gC, n: 'Separación libre entre barras', kind: 'ge', d: Math.min(clx, cly), c: cminC, unit: 'mm', dec: 0, ref: 'CIRSOC 201-2005 §7.6.3, §3.3.2', formula: 'sl ≥ máx(1,5·db; 40 mm; 4/3·dagg)', subst: `sl x = ${fmt(clx, 0)}, sl y = ${fmt(cly, 0)} mm`, crit: `sl ≥ ${fmt(cminC, 0)} mm`, sug: 'Reducir la cantidad de barras o el diámetro.' });
    add({ key: 'crec', g: gC, n: 'Recubrimiento del fuste', kind: 'ge', d: I.recCol, c: I.recMinCol, unit: 'mm', dec: 0, ref: 'CIRSOC 201-2005 §7.7 (mínimo definido por el usuario)', formula: 'rec ≥ rec mín', subst: '', crit: `rec ≥ ${fmt(I.recMinCol, 0)} mm` });
    add({ key: 'cint', g: gC, n: 'Armadura en la interfase fuste–zapata', kind: 'ge', d: rhoC, c: 0.005, unit: '', dec: 4, ref: 'CIRSOC 201-2005 §15.8.2.1', formula: 'As (barras continuas en la zapata) ≥ 0,005·Ag', subst: `ρ = ${fmt(rhoC, 4)}`, crit: 'ρ ≥ 0,005', sug: 'Agregar barras de espera.' });
    // Esbeltez
    if (I.apl === 'terr' && W.hf > 0) {
      const kl = 2 * W.hf / (0.3 * Math.min(cx, cy));
      add({ key: 'cesb', g: gC, n: 'Esbeltez del fuste', st: kl <= 22 ? 'ok' : 'nv', u: kl / 22, txt: `k·lu/r = 2·${fmt(W.hf, 2)}/(0,3·${fmt(Math.min(cx, cy), 2)}) = ${fmt(kl, 1)} ${kl <= 22 ? '≤' : '>'} 22`, ref: 'CIRSOC 201-2005 §10.13.2, §10.11.2', formula: 'k·lu/r ≤ 22 permite despreciar efectos de segundo orden (k = 2, voladizo conservador; r = 0,3·h)', subst: '', crit: 'k·lu/r ≤ 22', nt: kl > 22 ? 'No verificado: los efectos de segundo orden no están implementados.' : '' });
    } else add({ key: 'cesb', g: gC, n: 'Esbeltez del fuste', st: 'na', txt: 'Las cargas se aplican en la cara superior de la zapata: la esbeltez corresponde al diseño de la columna', ref: 'CIRSOC 201-2005 §10.10', formula: '', subst: '', crit: '' });
    // Estribos
    const dbeMin = tieMinDiam(I, colI.dbL);
    add({ key: 'cdbe', g: gC, n: 'Diámetro de estribos', kind: 'ge', d: colI.dbe, c: dbeMin, unit: 'mm', dec: 0, ref: 'CIRSOC 201-2005 §7.10.5.1 (tabla configurable)', formula: 'φe ≥ φe mín(φ longitudinal)', subst: `φ long. = ${colI.dbL} mm`, crit: `φe ≥ ${dbeMin} mm`, sug: 'Aumentar el diámetro del estribo.' });
    const sDet = Math.min(I.estSepDb * colI.dbL, 48 * colI.dbe, Math.min(cx, cy) * 1000) / 10;
    add({ key: 'csep', g: gC, n: 'Separación de estribos (detallado)', kind: 'le', d: colI.se, c: sDet, unit: 'cm', dec: 1, ref: 'CIRSOC 201-2005 §7.10.5.2 (factor configurable)', formula: `s ≤ mín(${I.estSepDb}·db; 48·φe; menor lado)`, subst: `mín(${fmt(I.estSepDb * colI.dbL, 0)}; ${fmt(48 * colI.dbe, 0)}; ${fmt(Math.min(cx, cy) * 1000, 0)}) mm`, crit: 's ≤ s máx', sug: 'Reducir la separación.' });
    add({ key: 'clat', g: gC, n: 'Apoyo lateral de barras', st: 'ok', txt: `Ramas: ${CD.legsX} paralelas a x, ${CD.legsY} paralelas a y`, ref: 'CIRSOC 201-2005 §7.10.5.3', formula: 'Esquinas y barras alternadas con apoyo; ninguna barra a más de 150 mm libres de una barra apoyada', subst: '', crit: 'Se agregan ganchos suplementarios según la regla', nt: 'Las ramas se calculan automáticamente' });
    R.decis.push(`Estribos del fuste: ${CD.legsX} ramas paralelas a x y ${CD.legsY} paralelas a y (§7.10.5.3); el primer estribo a ≤ s/2 sobre la zapata (§7.10.5.4).`);
    ['x', 'y'].forEach(dir => {
      const gsh = CD.list.reduce((a, b) => (b['sh' + dir].Vu / b['sh' + dir].phiVn > a['sh' + dir].Vu / a['sh' + dir].phiVn ? b : a));
      const sh = gsh['sh' + dir];
      add({ key: 'cv' + dir, g: gC, n: `Corte en el fuste ${dir}`, kind: 'le', d: sh.Vu, c: sh.phiVn, unit: 'kN', dec: 1, combo: gsh.id, ref: 'CIRSOC 201-2005 §11.1.1, §11.3.1.2, §11.5.7.2, §11.5.7.9',
        formula: "φVn = 0,75·(Vc + Vs);  Vc = (1 + Nu/(14·Ag))·√f'c/6·bw·d;  Vs = Av·fyt·d/s ≤ (2/3)·√f'c·bw·d",
        subst: `Vc = ${fmt(sh.Vc, 1)} kN; Av = ${sh.legs}·${fmt(abar(colI.dbe), 1)} = ${fmt(sh.Av, 0)} mm²; Vs = ${fmt(sh.Vs, 1)} kN`, crit: 'Vu ≤ φVn', sug: 'Reducir la separación de estribos.' });
      const smaxS = sh.sMaxV * 100;
      if (sh.needMin || sh.Vsreq > 0) add({ key: 'cvs' + dir, g: gC, n: `Separación máxima por corte ${dir}`, kind: 'le', d: colI.se, c: smaxS, unit: 'cm', dec: 1, ref: 'CIRSOC 201-2005 §11.5.5.1, §11.5.5.3', formula: 's ≤ d/2 ≤ 600 mm (d/4 ≤ 300 mm si Vs > √f\'c·bw·d/3)', subst: `d = ${fmt(sh.d * 1000, 0)} mm`, crit: 's ≤ s máx', sug: 'Reducir la separación.' });
      if (sh.needMin) add({ key: 'cavm' + dir, g: gC, n: `Armadura mínima de corte ${dir}`, kind: 'ge', d: sh.Av, c: sh.AvMin, unit: 'mm²', dec: 0, ref: 'CIRSOC 201-2005 §11.5.6.1, §11.5.6.3', formula: "Av mín = máx(0,062·√f'c; 0,35)·bw·s/fyt", subst: `bw = ${fmt(sh.bw * 1000, 0)} mm, s = ${fmt(colI.se * 10, 0)} mm`, crit: 'Av ≥ Av mín (Vu > 0,5·φVc)', sug: 'Reducir la separación.' });
    });
    add({ key: 'cconf', g: gC, n: 'Confinamiento especial (sísmico)', st: I.sism ? 'nv' : 'na', txt: I.sism ? 'No verificado: no se implementan los requisitos de INPRES-CIRSOC 103 Parte II (longitud de confinamiento, Ash, separaciones especiales).' : 'Proyecto sin requisitos sismorresistentes declarados: se aplica sólo el detallado del Cap. 7', ref: 'INPRES-CIRSOC 103 Parte II', formula: '', subst: '', crit: '', nt: I.sism ? 'Verificar por separado.' : '' });
    // Anclaje del fuste en la zapata
    const avail = H - r - (I.dbx + I.dby) / 1000;
    const ldc = ldComp(colI.dbL, fc, fy), ldhc = ldHook(colI.dbL, fc, fy), ldt = ldTension(colI.dbL, fc, fy, 1, true);
    const tens = CD.list.some(x => x.tension);
    R.colAnc = { avail, ldc, ldhc, ldt, tens };
    add({ key: 'cancc', g: gC, n: 'Anclaje del fuste: compresión', kind: 'ge', d: avail * 1000, c: ldc * 1000, unit: 'mm', dec: 0, ref: 'CIRSOC 201-2005 §12.3.2, §12.3.1, §12.5.5, §15.8.2.3', formula: "ldc = máx(0,24·fy·db/√f'c; 0,043·fy·db) ≥ 200 mm (el gancho no cuenta en compresión)", subst: `disponible = H − rec − φx − φy = ${fmt(H * 1000, 0)} − ${fmt(I.rec, 0)} − ${I.dbx} − ${I.dby}`, crit: 'disponible ≥ ldc', sug: 'Aumentar H o reducir el diámetro del fuste.' });
    if (tens) {
      const lreq = colI.ancCol === 'gancho' ? ldhc : ldt;
      add({ key: 'canct', g: gC, n: `Anclaje del fuste: tracción (${colI.ancCol})`, kind: 'ge', d: avail * 1000, c: lreq * 1000, unit: 'mm', dec: 0, ref: colI.ancCol === 'gancho' ? 'CIRSOC 201-2005 §12.5.2' : 'CIRSOC 201-2005 §12.2.2', formula: colI.ancCol === 'gancho' ? "ldh = 0,24·fy·db/√f'c ≥ máx(8·db; 150 mm)" : "ld = fy·db/(k·√f'c) ≥ 300 mm", subst: '', crit: 'disponible ≥ longitud requerida', nt: 'Hay tracción en barras del fuste (sección bruta elástica bajo cargas mayoradas)', sug: colI.ancCol === 'gancho' ? 'Aumentar H.' : 'Usar gancho a 90° apoyado sobre la malla inferior.' });
    } else add({ key: 'canct', g: gC, n: 'Anclaje del fuste: tracción', st: 'na', txt: 'Sin tracción en barras bajo las combinaciones últimas (sección bruta elástica)', ref: 'Hipótesis', formula: 'σ = Pu/Ag ± Mux·y/Ix ± Muy·x/Iy ≥ 0 en todas las barras', subst: '', crit: '' });

    R.layout = layout(I, R);
    return R;
  }

  /* ---------------- Geometría real de armaduras (para 3D y planos) ---------------- */
  function layout(I, R) {
    const { B, L, H, Df, cx, cy, ex0, ey0 } = I, colI = R.colI || I;
    const dd = R.d, r = I.rec / 1000, rs = I.recSup / 1000, zb = -Df, zt = -Df + H;
    const groups = [];
    const pos = (span, s) => { const n = Math.max(1, Math.floor((span + 1e-9) / s) + 1), tot = (n - 1) * s, a = []; for (let i = 0; i < n; i++) a.push(-tot / 2 + i * s); return a; };
    const footBars = (id, name, kind, ax, db, s, zc, top) => {
      const dir = ax === 'x', len = (dir ? B : L) - 2 * r, other = dir ? L : B;
      const ps = pos(other - 2 * r - db / 1000, s / 100);
      const dem = R.dem && R.dem[ax], anc = top ? (dem && dem.top && dem.top.anc) : (dem && dem.anc);
      const hook = anc && anc.mode === 'gancho';
      const hl = 12 * db / 1000, hz = top ? -1 : 1;
      const bars = ps.map(p => {
        const a = -len / 2, b = len / 2, pts = [];
        const P = (u, z) => dir ? [u, p, z] : [p, u, z];
        if (hook) pts.push(P(a, zc + hz * hl));
        pts.push(P(a, zc), P(b, zc));
        if (hook) pts.push(P(b, zc + hz * hl));
        return pts;
      });
      const lenDev = len + (hook ? 2 * hl : 0);
      groups.push({ id, name, kind, ax, db, s, n: ps.length, bars, hook, len: lenDev, straight: len, hookLen: hook ? hl : 0, kg: ps.length * lenDev * kgm(db), layer: top ? 'ARM_SUP' : 'ARM_INF', top, pos: ps, z: zc });
    };
    footBars('P1', 'Inferior dir. x', 'inf', 'x', I.dbx, I.sx, zb + dd.zx, false);
    footBars('P2', 'Inferior dir. y', 'inf', 'y', I.dby, I.sy, zb + dd.zy, false);
    if (I.supX) footBars('P3', 'Superior dir. x', 'sup', 'x', I.dbxs, I.sxs, zb + dd.zxs, true);
    if (I.supY) footBars('P4', 'Superior dir. y', 'sup', 'y', I.dbys, I.sys, zb + dd.zys, true);
    // Fuste
    const sec = R.col ? R.col.sec : colSection(colI);
    const hf = Math.max(Df - H, 0);
    const ldt = ldTension(colI.dbL, I.fc, I.fy, 1, true);
    const lap = 1.3 * ldt; // espera para empalme clase B (§12.15.1)
    const zBot = zb + r + (I.dbx + I.dby) / 1000 + colI.dbL / 2000, zTop = 0 + lap;
    const hookC = colI.ancCol === 'gancho', hlc = 12 * colI.dbL / 1000;
    const cbars = sec.bars.map(s => {
      const x = ex0 + s.x, y = ey0 + s.y, pts = [];
      if (hookC) { const dx = Math.abs(s.x) >= Math.abs(s.y) * sec.b / sec.h ? Math.sign(s.x) || 1 : 0, dy = dx ? 0 : (Math.sign(s.y) || 1); pts.push([x + dx * hlc, y + dy * hlc, zBot]); }
      pts.push([x, y, zBot], [x, y, zTop]);
      return pts;
    });
    const lenC = zTop - zBot + (hookC ? hlc : 0);
    groups.push({ id: 'P5', name: 'Longitudinal fuste', kind: 'col', db: colI.dbL, n: sec.n, bars: cbars, hook: hookC, len: lenC, hookLen: hookC ? hlc : 0, kg: sec.n * lenC * kgm(colI.dbL), layer: 'ARM_FUSTE', lap, zBot, zTop });
    // Estribos
    const se = colI.se / 100, off = (colI.dbL / 2 + colI.dbe / 2) / 1000;
    const hx = sec.b / 2 - sec.r + off, hy = sec.h / 2 - sec.r + off;
    const zs = []; for (let z = zt + se / 2; z <= zTop - 0.05 + 1e-9; z += se) zs.push(z);
    const per = 2 * (2 * hx + 2 * hy), hookE = 2 * Math.max(6 * colI.dbe, 75) / 1000; // gancho sísmico/135° (§7.1.3): extensión 6 db ≥ 75 mm
    const ties = zs.map(z => [[ex0 - hx, ey0 - hy, z], [ex0 + hx, ey0 - hy, z], [ex0 + hx, ey0 + hy, z], [ex0 - hx, ey0 + hy, z], [ex0 - hx, ey0 - hy, z]]);
    groups.push({ id: 'P6', name: 'Estribos fuste', kind: 'est', db: colI.dbe, s: colI.se, n: zs.length, bars: ties, len: per / 2 + hookE, kg: zs.length * (per / 2 + hookE) * kgm(colI.dbe), layer: 'ESTRIBOS', zs, hx, hy });
    // Ganchos suplementarios (ramas adicionales)
    const xs = sec.bars.filter(b => b.f === 'x' && b.y < 0).map(b => b.x).sort((a, b) => a - b);
    const ys = [-(sec.h / 2 - sec.r)].concat(sec.bars.filter(b => b.f === 'y' && b.x < 0).map(b => b.y).sort((a, b) => a - b), [sec.h / 2 - sec.r]);
    const pick = (arr, k) => { if (k <= 2) return []; const idx = []; const n = arr.length; for (let i = 1; i < k - 1; i++) idx.push(arr[Math.round(i * (n - 1) / (k - 1))]); return idx; };
    const R2 = R.col || { legsX: 2, legsY: 2 };
    const exY = pick(xs, R2.legsY), exX = pick(ys, R2.legsX);
    const cross = [];
    zs.forEach(z => {
      exY.forEach(x => cross.push([[ex0 + x, ey0 - hy, z], [ex0 + x, ey0 + hy, z]]));
      exX.forEach(y => cross.push([[ex0 - hx, ey0 + y, z], [ex0 + hx, ey0 + y, z]]));
    });
    if (cross.length) groups.push({ id: 'P7', name: 'Ganchos suplementarios', kind: 'est', db: colI.dbe, s: colI.se, n: cross.length, bars: cross, len: 2 * Math.max(hx, hy) + hookE, kg: cross.reduce((a, c) => a + (Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) + hookE) * kgm(colI.dbe), 0), layer: 'ESTRIBOS', perTie: exY.length + exX.length });
    const vol = B * L * H + cx * cy * hf;
    const kg = groups.reduce((a, g) => a + g.kg, 0);
    return { footing: { x0: -B / 2, x1: B / 2, y0: -L / 2, y1: L / 2, z0: zb, z1: zt }, fuste: { x0: ex0 - cx / 2, x1: ex0 + cx / 2, y0: ey0 - cy / 2, y1: ey0 + cy / 2, z0: zt, z1: 0 }, groups, vol, kg, sec, colI, zTop, lap };
  }

  return {
    DIAM, ES, abar, kgm, beta1, fmt, defaults, normalize, validate, solvePressure, coords, weights, depths,
    flexAt, asRequired, rhoMin, phiFlex, ldTension, ldHook, ldComp, punching, colSection, colState, colCapacity,
    columnAuto, supportedBars, tieMinDiam, colShear, analyze, layout, mkCheck
  };
});
