/* zapata-design.js — Dimensionamiento automático de la zapata, sus armaduras y el fuste.
 * Usa exclusivamente ZC.analyze() para aceptar o rechazar una solución: ninguna alternativa
 * se informa como válida si alguna verificación implementada resulta «no verifica».
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./zapata-calc.js'));
  else root.ZD = factory(root.ZC);
})(typeof self !== 'undefined' ? self : this, function (ZC) {
  'use strict';
  const clone = o => JSON.parse(JSON.stringify(o));
  const rnd = v => Math.round(v * 1e6) / 1e6;
  const up = (v, st) => rnd(Math.ceil(v / st - 1e-9) * st);
  const tick = () => new Promise(r => setTimeout(r, 0));
  const bad = R => R.err ? R.err.map(e => ({ n: e, st: 'bad' })) : R.checks.filter(c => c.st === 'bad');

  function serviceOK(I) { const R = ZC.analyze(I, { serviceOnly: true, fast: true }); return !R.err && bad(R).length === 0; }

  /** Menor planta (B, L) que verifica suelo y estabilidad para una altura H dada. */
  function minPlan(I0, H, forma) {
    const I = clone(I0); I.H = H;
    const st = I.paso, Lmax = I.Lmax;
    const Bmin = up(Math.max(2 * (Math.abs(I.ex0) + I.cx / 2 + I.vmin), I.cx + 2 * I.vmin), st);
    const Lmin = up(Math.max(2 * (Math.abs(I.ey0) + I.cy / 2 + I.vmin), I.cy + 2 * I.vmin), st);
    const grid = (a) => { const g = []; for (let v = a; v <= Lmax + 1e-9; v = rnd(v + st)) g.push(v); return g; };
    const firstOK = (vals, test) => { // búsqueda binaria (la verificación es monótona en la dimensión)
      if (!vals.length || !test(vals[vals.length - 1])) return null;
      let lo = 0, hi = vals.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (test(vals[m])) hi = m; else lo = m + 1; }
      return vals[lo];
    };
    if (forma === 'cuadrada') {
      const s = firstOK(grid(Math.max(Bmin, Lmin)), v => serviceOK(Object.assign(I, { B: v, L: v })));
      return s === null ? null : { B: s, L: s };
    }
    let best = null;
    for (const B of grid(Bmin)) {
      if (best && B * Lmin >= best.B * best.L - 1e-9) break;
      const L = firstOK(grid(Lmin), v => serviceOK(Object.assign(I, { B, L: v })));
      if (L === null) continue;
      if (!best || B * L < best.B * best.L - 1e-9 || (Math.abs(B * L - best.B * best.L) < 1e-9 && Math.abs(B - L) < Math.abs(best.B - best.L))) best = { B, L };
    }
    return best;
  }

  /** Elige φ y separación para una capa (mínimo peso por metro, separación múltiplo de 2,5 cm). */
  function pickBars(I, mu, dOf, cant, top, fac = 1) {
    let best = null;
    for (const db of I.diamZ) {
      const d = dOf(db), req = ZC.asRequired(mu, d, I.fc, I.fy);
      const AsMin = ZC.rhoMin(I.fy) * 1000 * I.H * 1000;
      const need = Math.max(req.AsReq, AsMin) * fac;
      if (!isFinite(need)) continue;
      const sMax = Math.min(I.sMaxH * I.H * 1000, I.sMaxDb * db, I.sMaxAbs) / 10;
      let s = Math.floor(Math.min(ZC.abar(db) / Math.max(need, 1e-9) * 100, sMax) / 2.5 + 1e-9) * 2.5;
      if (s < I.sMin) continue;
      if (s * 10 - db < Math.max(25, db, 4 / 3 * I.dagg)) continue;
      const fa = ZC.flexAt(ZC.abar(db) / (s / 100), d * 1000, I.fc, I.fy);
      if (fa.et < 0.004 || fa.phiMn < mu) continue;
      const psit = top && (I.H - I.recSup / 1000) > 0.3 ? 1.3 : 1;
      const good = (s * 10 - db) >= 2 * db && (top ? I.recSup : I.rec) >= db;
      const ld = ZC.ldTension(db, I.fc, I.fy, psit, good), ldh = ZC.ldHook(db, I.fc, I.fy);
      const ancOK = I.ancZ === 'recto' ? cant >= ld : I.ancZ === 'gancho' ? cant >= ldh : (cant >= ld || cant >= ldh);
      if (!ancOK) continue;
      const w = ZC.kgm(db) / (s / 100);
      if (!best || w < best.w - 1e-9 || (Math.abs(w - best.w) < 1e-9 && s > best.s)) best = { db, s, w };
    }
    return best;
  }

  /** Dimensiona armaduras de zapata y fuste para la geometría de I; devuelve {I, R}. */
  function designBars(I0) {
    const I = clone(I0);
    I.colModo = 'auto';
    for (let it = 0; it < 8; it++) {
      const R = ZC.analyze(I);
      if (R.err || !R.dem || !R.dem.x) return { I, R, why: 'sin solicitaciones' };
      const r = I.rec / 1000, rs = I.recSup / 1000;
      let changed = false;
      for (const ax of ['x', 'y']) {
        const dem = R.dem[ax], other = ax === 'x' ? I.dby : I.dbx;
        const lowFirst = I.capa === ax;
        const dOf = db => I.H - r - (lowFirst ? db / 2000 : (other + db / 2) / 1000);
        // en zapatas rectangulares, la dirección corta concentra 2/(β+1) del total en la banda central (§15.4.4.2)
        const shortAx = I.B < I.L ? 'x' : 'y', Ls = Math.min(I.B, I.L), Ll = Math.max(I.B, I.L);
        const fac = Math.abs(I.B - I.L) > 1e-6 && ax === shortAx ? Math.max(1, 2 / (Ll / Ls + 1) * Ll / Ls) : 1;
        const b = pickBars(I, dem.mu, dOf, dem.anc.cant, false, fac);
        if (!b) return { I, R, why: `sin armadura inferior ${ax} posible` };
        if (I['db' + ax] !== b.db || I['s' + ax] !== b.s) { I['db' + ax] = b.db; I['s' + ax] = b.s; changed = true; }
        const k = ax === 'x' ? 'X' : 'Y';
        if (dem.top.required) {
          const otherT = ax === 'x' ? (I.supY ? I.dbys : 0) : (I.supX ? I.dbxs : 0);
          const dOfT = db => I.H - rs - (lowFirst ? db / 2000 : (otherT + db / 2) / 1000);
          const t = pickBars(I, dem.top.mun, dOfT, dem.anc.cant, true);
          if (!t) return { I, R, why: `sin armadura superior ${ax} posible` };
          if (!I['sup' + k] || I['db' + ax + 's'] !== t.db || I['s' + ax + 's'] !== t.s) { I['sup' + k] = true; I['db' + ax + 's'] = t.db; I['s' + ax + 's'] = t.s; changed = true; }
        } else if (I['sup' + k]) { I['sup' + k] = false; changed = true; }
      }
      if (!changed) break;
    }
    const R = ZC.analyze(I);
    if (R.colAuto) Object.assign(I, R.colAuto);
    return { I, R };
  }

  function summarize(I, R) {
    const L = R.layout;
    const us = R.checks.filter(c => c.u !== null && isFinite(c.u) && !['recZ', 'crec', 'cnb', 'gap', 'cdbe'].includes(c.key));
    const gov = us.reduce((a, c) => (!a || c.u > a.u ? c : a), null);
    return {
      B: I.B, L: I.L, H: I.H, d: R.d ? R.d.dm : null, vol: L ? L.vol : null, kg: L ? L.kg : null,
      cost: L ? L.vol + L.kg / I.costoRel : Infinity, umax: gov ? gov.u : null, gov: gov ? gov.n : '',
      nbad: bad(R).length, nnv: R.checks.filter(c => c.st === 'nv').length,
      bars: `inf x φ${I.dbx} c/${I.sx} · inf y φ${I.dby} c/${I.sy}` + (I.supX ? ` · sup x φ${I.dbxs} c/${I.sxs}` : '') + (I.supY ? ` · sup y φ${I.dbys} c/${I.sys}` : ''),
      col: `${2 * I.nbx + 2 * I.nby - 4} φ${I.dbL} · est. φ${I.dbe} c/${I.se}`
    };
  }

  async function autoDesign(Iraw, onProgress) {
    const base = ZC.normalize(Iraw);
    const V = ZC.validate(Object.assign(clone(base), { B: Math.max(base.B, base.cx), L: Math.max(base.L, base.cy) }));
    if (V.errors.length) return { alts: [], best: null, diag: V.errors, error: 'Datos de entrada incompletos o incompatibles.' };
    const forms = base.forma === 'ambas' ? ['cuadrada', 'rectangular'] : [base.forma];
    const hReq = (150 + base.rec + 2 * 12) / 1000;
    const Hs = up(Math.max(base.Hmin, hReq), base.paso);
    const alts = [], diag = [];
    const total = forms.length * Math.max(1, Math.round((base.Hmax - Hs) / base.paso) + 1);
    let step = 0;
    for (const forma of forms) {
      let found = 0;
      for (let H = Hs; H <= base.Hmax + 1e-9; H = rnd(H + (found ? 0.10 : base.paso))) {
        step++; if (onProgress) onProgress(Math.min(1, step / total), `${forma} · H = ${H.toFixed(2)} m`);
        await tick();
        const plan = minPlan(base, H, forma);
        if (!plan) { diag.push(`${forma}, H = ${ZC.fmt(H, 2)} m: ninguna planta hasta ${ZC.fmt(base.Lmax, 2)} m verifica suelo y estabilidad.`); continue; }
        const trial = Object.assign(clone(base), plan, { H });
        const { I, R, why } = designBars(trial);
        const b = bad(R);
        if (!why && !b.length) {
          alts.push(Object.assign({ I, forma }, summarize(I, R)));
          if (++found >= 3) break;
        } else diag.push(`${forma}, H = ${ZC.fmt(H, 2)} m, ${ZC.fmt(plan.B, 2)} × ${ZC.fmt(plan.L, 2)} m: ${why ? why + '; ' : ''}${b.map(c => c.n).join(', ')}`);
      }
    }
    alts.sort((a, b) => a.cost - b.cost);
    alts.forEach((a, i) => { a.rank = i + 1; });
    if (onProgress) onProgress(1, 'Terminado');
    return { alts, best: alts[0] || null, diag, base };
  }

  return { autoDesign, minPlan, designBars, summarize, serviceOK };
});
