/* zapata-dxf.js — Planos de la zapata (planta y cortes) generados desde la geometría real del cálculo.
 * Salida: DXF ASCII R12 (AC1009), que AutoCAD abre y puede guardar como DWG. No genera DWG nativo.
 * Unidades de dibujo: mm en espacio modelo a escala 1:1; hoja, textos y rótulo dibujados a escala 1:S.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./zapata-calc.js'));
  else root.ZX = factory(root.ZC);
})(typeof self !== 'undefined' ? self : this, function (ZC) {
  'use strict';
  const fmt = ZC.fmt;
  const LAYERS = [
    ['HORMIGON', 7, 'CONTINUOUS'], ['ARM_INF', 1, 'CONTINUOUS'], ['ARM_SUP', 6, 'CONTINUOUS'], ['ARM_FUSTE', 5, 'CONTINUOUS'],
    ['ESTRIBOS', 3, 'CONTINUOUS'], ['COTAS', 4, 'CONTINUOUS'], ['EJES', 1, 'CENTER'], ['TEXTOS', 7, 'CONTINUOUS'],
    ['AUXILIAR', 8, 'DASHED'], ['TERRENO', 30, 'CONTINUOUS'], ['ROTULO', 7, 'CONTINUOUS']
  ];
  const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
  const SCALES = [10, 15, 20, 25, 30, 40, 50, 75, 100];
  const cm = m => { const v = Math.round(m * 1000) / 10; return Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : fmt(v, 1); };
  const mtxt = m => fmt(m, 2);

  /* ---------- Contenedor de entidades ---------- */
  class View {
    constructor(name) { this.name = name; this.e = []; this.bb = [Infinity, Infinity, -Infinity, -Infinity]; }
    grow(x, y) { const b = this.bb; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    line(l, x1, y1, x2, y2) { this.e.push({ t: 'line', l, p: [x1, y1, x2, y2] }); this.grow(x1, y1); this.grow(x2, y2); }
    poly(l, pts, closed) { this.e.push({ t: 'poly', l, pts, closed: !!closed }); pts.forEach(p => this.grow(p[0], p[1])); }
    circle(l, x, y, r) { this.e.push({ t: 'circle', l, x, y, r }); this.grow(x - r, y - r); this.grow(x + r, y + r); }
    donut(l, x, y, r) { this.e.push({ t: 'donut', l, x, y, r }); this.grow(x - r, y - r); this.grow(x + r, y + r); }
    text(l, x, y, h, s, al = 'L', rot = 0) {
      this.e.push({ t: 'text', l, x, y, h, s, al, rot });
      const w = textW(s, h), off = al === 'C' ? -w / 2 : al === 'R' ? -w : 0;
      if (rot === 90) { this.grow(x - h, y + off); this.grow(x + 0.3 * h, y + off + w); }
      else { this.grow(x + off, y - 0.3 * h); this.grow(x + off + w, y + h); }
    }
    move(dx, dy) {
      this.e.forEach(o => {
        if (o.t === 'line') { o.p[0] += dx; o.p[1] += dy; o.p[2] += dx; o.p[3] += dy; }
        else if (o.t === 'poly') o.pts = o.pts.map(p => [p[0] + dx, p[1] + dy]);
        else { o.x += dx; o.y += dy; }
      });
      this.bb = [this.bb[0] + dx, this.bb[1] + dy, this.bb[2] + dx, this.bb[3] + dy];
    }
    get w() { return this.bb[2] - this.bb[0]; }
    get h() { return this.bb[3] - this.bb[1]; }
  }
  const textW = (s, h) => String(s).replace(/%%[cpd]/g, 'x').length * h * 0.78;

  /* ---------- Cotas ---------- */
  function dimH(v, xs, y, yref, S) {
    const t = 1.2 * S, h = 2.5 * S, up = y >= yref ? 1 : -1;
    for (const x of xs) v.line('COTAS', x, yref + up * 1.5 * S, x, y + up * 1.5 * S);
    v.line('COTAS', xs[0] - 1.5 * S, y, xs[xs.length - 1] + 1.5 * S, y);
    xs.forEach(x => v.line('COTAS', x - t, y - t, x + t, y + t));
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i], b = xs[i + 1], s = cm((b - a) / 1000);
      if (b - a < 1e-6) continue;
      if (textW(s, h) + 1.5 * S < b - a) v.text('COTAS', (a + b) / 2, y + 0.8 * S, h, s, 'C');
      else v.text('COTAS', i === xs.length - 2 ? b + 1.8 * S : a - 1.8 * S, y + 0.8 * S, h, s, i === xs.length - 2 ? 'L' : 'R');
    }
  }
  function dimV(v, x, ys, xref, S, pre = '') {
    const t = 1.2 * S, h = 2.5 * S, side = x >= xref ? 1 : -1;
    for (const y of ys) v.line('COTAS', xref + side * 1.5 * S, y, x + side * 1.5 * S, y);
    v.line('COTAS', x, ys[0] - 1.5 * S, x, ys[ys.length - 1] + 1.5 * S);
    ys.forEach(y => v.line('COTAS', x - t, y - t, x + t, y + t));
    for (let i = 0; i < ys.length - 1; i++) {
      const a = ys[i], b = ys[i + 1], s = pre + cm((b - a) / 1000);
      if (b - a < 1e-6) continue;
      if (textW(s, h) + 1.5 * S < b - a) v.text('COTAS', x - 0.8 * S, (a + b) / 2, h, s, 'C', 90);
      else v.text('COTAS', x + 1.5 * S, i === ys.length - 2 ? b + 1.5 * S : a - 1.5 * S - h, h, s, 'L');
    }
  }
  const tickMark = (v, l, x, y, S) => v.line(l, x - S, y - S, x + S, y + S);
  function level(v, x, y, txt, S, below) {
    const a = 2.2 * S;
    if (!below) { v.poly('COTAS', [[x, y], [x - a, y + 1.6 * a], [x + a, y + 1.6 * a]], true); v.text('TEXTOS', x + a + S, y + 0.9 * a, 2.5 * S, txt, 'L'); }
    else { v.poly('COTAS', [[x, y], [x - a, y - 1.6 * a], [x + a, y - 1.6 * a]], true); v.text('TEXTOS', x + a + S, y - 1.6 * a, 2.5 * S, txt, 'L'); }
  }
  const barLabel = g => `${g.id}: ${g.n} φ${g.db}${g.s ? ` c/${fmt(g.s, g.s % 1 ? 1 : 0)}` : ''} L=${mtxt(g.len)}${g.hook ? ' (gancho)' : ''}`;

  /* ---------- Planta ---------- */
  function planView(I, LY, top, S) {
    const v = new View(top ? 'PLANTA - ARMADURA SUPERIOR' : 'PLANTA - ARMADURA INFERIOR');
    const k = 1000, B = I.B * k, L = I.L * k, cx = I.cx * k, cy = I.cy * k, ex = I.ex0 * k, ey = I.ey0 * k, r = I.rec * 1;
    v.poly('HORMIGON', [[-B / 2, -L / 2], [B / 2, -L / 2], [B / 2, L / 2], [-B / 2, L / 2]], true);
    v.poly('HORMIGON', [[ex - cx / 2, ey - cy / 2], [ex + cx / 2, ey - cy / 2], [ex + cx / 2, ey + cy / 2], [ex - cx / 2, ey + cy / 2]], true);
    v.line('AUXILIAR', ex - cx / 2, ey - cy / 2, ex + cx / 2, ey + cy / 2); v.line('AUXILIAR', ex - cx / 2, ey + cy / 2, ex + cx / 2, ey - cy / 2);
    const gX = LY.groups.find(g => g.id === (top ? 'P3' : 'P1')), gY = LY.groups.find(g => g.id === (top ? 'P4' : 'P2'));
    const lay = top ? 'ARM_SUP' : 'ARM_INF';
    if (gX) gX.bars.forEach(b => { const p0 = b.find(p => true), pa = b.filter((p, i) => i === 0 || i === b.length - 1); void p0; v.line(lay, pa[0][0] * k, pa[0][1] * k, pa[1][0] * k, pa[1][1] * k); });
    if (gY) gY.bars.forEach(b => { const pa = [b[0], b[b.length - 1]]; v.line(lay, pa[0][0] * k, pa[0][1] * k, pa[1][0] * k, pa[1][1] * k); });
    // Ejes
    const ax = 22 * S;
    v.line('EJES', -B / 2 - 6 * S, ey, B / 2 + ax - 4 * S, ey); v.line('EJES', ex, -L / 2 - 6 * S, ex, L / 2 + ax - 4 * S);
    v.circle('EJES', B / 2 + ax, ey, 4 * S); v.text('TEXTOS', B / 2 + ax, ey - 1.25 * S, 2.5 * S, 'Y', 'C');
    v.circle('EJES', ex, L / 2 + ax, 4 * S); v.text('TEXTOS', ex, L / 2 + ax - 1.25 * S, 2.5 * S, 'X', 'C');
    // Distribución y designación
    const h = 2.5 * S;
    if (gX) {
      const xl = B / 2 + 7 * S, y0 = gX.pos[0] * k, y1 = gX.pos[gX.pos.length - 1] * k;
      v.line('COTAS', xl, y0, xl, y1); tickMark(v, 'COTAS', xl, y0, S); tickMark(v, 'COTAS', xl, y1, S);
      v.line('COTAS', B / 2 - r, y1, xl, y1);
      v.text('TEXTOS', xl + 1.2 * S + h, (y0 + y1) / 2, h, barLabel(gX), 'C', 90);
    }
    if (gY) {
      const yl = -L / 2 - 7 * S, x0 = gY.pos[0] * k, x1 = gY.pos[gY.pos.length - 1] * k;
      v.line('COTAS', x0, yl, x1, yl); tickMark(v, 'COTAS', x0, yl, S); tickMark(v, 'COTAS', x1, yl, S);
      v.line('COTAS', x0, -L / 2 + r, x0, yl);
      v.text('TEXTOS', (x0 + x1) / 2, yl - 1.2 * S - h, h, barLabel(gY), 'C');
    }
    // Recubrimiento
    v.text('TEXTOS', -B / 2, L / 2 + 3 * S, 2 * S, `rec. ${top ? I.recSup : I.rec} mm`, 'L');
    // Cotas
    const xs = [-B / 2, ex - cx / 2, ex + cx / 2, B / 2].filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-6);
    dimH(v, xs, -L / 2 - 20 * S, -L / 2, S); dimH(v, [-B / 2, B / 2], -L / 2 - 28 * S, -L / 2, S);
    const ys = [-L / 2, ey - cy / 2, ey + cy / 2, L / 2].filter((y, i, a) => i === 0 || y - a[i - 1] > 1e-6);
    dimV(v, -B / 2 - 9 * S, ys, -B / 2, S); dimV(v, -B / 2 - 17 * S, [-L / 2, L / 2], -B / 2, S);
    // Indicación de cortes
    if (!top) { // trazas de los cortes A-A (por el eje y = ey₀) y B-B (por x = ex₀)
      const mk = (x1, y1, x2, y2, tx, ty, lab) => { v.line('HORMIGON', x1, y1, x2, y2); v.text('TEXTOS', tx, ty, 3 * S, lab, 'C'); };
      mk(-B / 2 - 32 * S, ey, -B / 2 - 25 * S, ey, -B / 2 - 28.5 * S, ey + 1.5 * S, 'A');
      mk(B / 2 + 30 * S, ey, B / 2 + 37 * S, ey, B / 2 + 33.5 * S, ey + 1.5 * S, 'A');
      mk(ex, -L / 2 - 36 * S, ex, -L / 2 - 29 * S, ex + 3 * S, -L / 2 - 34 * S, 'B');
      mk(ex, L / 2 + 30 * S, ex, L / 2 + 37 * S, ex + 3 * S, L / 2 + 32 * S, 'B');
    }
    // Título
    const yt = v.bb[1] - 8 * S;
    v.text('TEXTOS', 0, yt, 3.5 * S, v.name, 'C'); v.text('TEXTOS', 0, yt - 5 * S, 2.5 * S, `Esc. 1:${S}`, 'C');
    return v;
  }

  /* ---------- Cortes ---------- */
  function sectionView(I, R, LY, ax, S) {
    const v = new View(ax === 'x' ? 'CORTE A-A (dirección x)' : 'CORTE B-B (dirección y)');
    const k = 1000, Bd = (ax === 'x' ? I.B : I.L) * k, cd = (ax === 'x' ? I.cx : I.cy) * k, e0 = (ax === 'x' ? I.ex0 : I.ey0) * k;
    const oth = (ax === 'x' ? I.ey0 : I.ex0);
    const zb = -I.Df * k, zt = zb + I.H * k, U = p => (ax === 'x' ? p[0] : p[1]) * k, Z = p => p[2] * k;
    const ext = Math.max(500, 0.15 * Bd);
    // Terreno
    v.line('TERRENO', -Bd / 2 - ext, 0, Bd / 2 + ext, 0);
    for (let u = -Bd / 2 - ext + 3 * S; u < Bd / 2 + ext - 2 * S; u += 6 * S) if (u < e0 - cd / 2 - S || u > e0 + cd / 2 + S) v.line('TERRENO', u, 0, u - 2.5 * S, -2.5 * S);
    // Hormigón
    v.poly('HORMIGON', [[-Bd / 2, zb], [Bd / 2, zb], [Bd / 2, zt], [-Bd / 2, zt]], true);
    const zTop = LY.zTop * k;
    v.line('HORMIGON', e0 - cd / 2, zt, e0 - cd / 2, 0); v.line('HORMIGON', e0 + cd / 2, zt, e0 + cd / 2, 0);
    v.line('AUXILIAR', e0 - cd / 2, 0, e0 - cd / 2, zTop + 60); v.line('AUXILIAR', e0 + cd / 2, 0, e0 + cd / 2, zTop + 60);
    const zz = zTop + 60; // línea de corte de la columna
    v.poly('HORMIGON', [[e0 - cd / 2 - 3 * S, zz], [e0 - 2 * S, zz], [e0 - S, zz + 2 * S], [e0 + S, zz - 2 * S], [e0 + 2 * S, zz], [e0 + cd / 2 + 3 * S, zz]], false);
    // Armaduras
    const g = id => LY.groups.find(q => q.id === id);
    const along = ax === 'x' ? ['P1', 'P3'] : ['P2', 'P4'], across = ax === 'x' ? ['P2', 'P4'] : ['P1', 'P3'];
    const labels = [];
    along.forEach(id => {
      const G = g(id); if (!G) return;
      let bi = 0, bd = Infinity; G.pos.forEach((p, i) => { if (Math.abs(p - oth) < bd) { bd = Math.abs(p - oth); bi = i; } });
      const pts = G.bars[bi].map(p => [U(p), Z(p)]);
      v.poly(G.layer, pts, false);
      labels.push({ G, x: pts[pts.length - (G.hook ? 2 : 1)][0], y: pts[pts.length - (G.hook ? 2 : 1)][1] });
    });
    across.forEach(id => {
      const G = g(id); if (!G) return;
      G.pos.forEach(p => v.donut(G.layer, p * k, G.z * k, Math.max(G.db / 2, 0.6 * S)));
      labels.push({ G, x: G.pos[G.pos.length - 1] * k, y: G.z * k });
    });
    const C = g('P5'), seen = new Set();
    C.bars.forEach(b => { const u = Math.round(U(b[1])); if (seen.has(u)) return; seen.add(u); v.poly('ARM_FUSTE', b.map(p => [U(p), Z(p)]), false); });
    const T = g('P6'), hh = (ax === 'x' ? T.hx : T.hy) * k;
    T.zs.forEach(z => v.line('ESTRIBOS', e0 - hh, z * k, e0 + hh, z * k));
    // Designaciones con línea de referencia (a la derecha, escalonadas)
    const h = 2.5 * S, xl = Bd / 2 + 16 * S;
    labels.sort((a, b) => b.y - a.y);
    let yPrev = Infinity;
    labels.forEach(lb => {
      let y = Math.min(lb.y + 4 * S, yPrev - 4.5 * S); yPrev = y;
      v.line('TEXTOS', lb.x, lb.y, xl - S, y + 0.4 * h); v.text('TEXTOS', xl, y, h, barLabel(lb.G), 'L');
    });
    const zc = Math.max(zt + 0.35 * (0 - zt), zt + 3 * S);
    const cbar = [...seen].sort((a, b) => b - a)[0];
    v.line('TEXTOS', cbar, zc, e0 + cd / 2 + 10 * S, zc + 6 * S); v.text('TEXTOS', e0 + cd / 2 + 11 * S, zc + 6 * S, h, barLabel(C), 'L');
    v.line('TEXTOS', e0 + hh, T.zs[Math.min(2, T.zs.length - 1)] * k, e0 + cd / 2 + 10 * S, zc + 12 * S);
    v.text('TEXTOS', e0 + cd / 2 + 11 * S, zc + 12 * S, h, `${T.id}: φ${T.db} c/${fmt(T.s, T.s % 1 ? 1 : 0)} (${T.n} u.)${g('P7') ? ' + ganchos P7' : ''}`, 'L');
    // Cotas
    const dd = R.d, dax = (ax === 'x' ? dd.dx : dd.dy) * k;
    const us = [-Bd / 2, e0 - cd / 2, e0 + cd / 2, Bd / 2].filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-6);
    dimH(v, us, zb - 12 * S, zb, S); dimH(v, [-Bd / 2, Bd / 2], zb - 20 * S, zb, S);
    dimV(v, -Bd / 2 - 7 * S, [zb, zt], -Bd / 2, S);
    dimV(v, -Bd / 2 - 15 * S, [zb, 0], -Bd / 2, S);
    dimV(v, Bd / 2 + 7 * S, [zt - dax, zt], Bd / 2, S, 'd=');
    // Recubrimiento inferior
    const zr = zb + I.rec;
    v.line('COTAS', -Bd / 2 + 6 * S, zb, -Bd / 2 + 6 * S, zr); v.line('COTAS', -Bd / 2 + 6 * S, zr, -Bd / 2 + 9 * S, zr + 4 * S); v.text('TEXTOS', -Bd / 2 + 9.5 * S, zr + 4 * S, 2 * S, `rec. ${I.rec} mm`, 'L');
    // Niveles
    level(v, Bd / 2 + ext - 10 * S, 0, '±0,00', S, false);
    level(v, -Bd / 2 + 4 * S, zb, `${fmt(-I.Df, 2)} cota de fundación`, S, true);
    // Título y notas
    const yt = v.bb[1] - 8 * S;
    v.text('TEXTOS', 0, yt, 3.5 * S, v.name, 'C'); v.text('TEXTOS', 0, yt - 5 * S, 2.5 * S, `Esc. 1:${S}`, 'C');
    const A = R.colAnc;
    if (A) {
      v.text('TEXTOS', 0, yt - 10 * S, 2 * S, `Anclaje del fuste: disponible ${fmt(A.avail * 1000, 0)} mm; ldc = ${fmt(A.ldc * 1000, 0)} mm${A.tens ? `; ${R.colI.ancCol === 'gancho' ? 'ldh' : 'ld'} = ${fmt((R.colI.ancCol === 'gancho' ? A.ldhc : A.ldt) * 1000, 0)} mm` : ''}`, 'C');
      v.text('TEXTOS', 0, yt - 13.5 * S, 2 * S, `Espera sobre ±0,00: ${fmt(LY.lap, 2)} m (1,3·ld)`, 'C');
    }
    return v;
  }

  /* ---------- Planilla de armaduras ---------- */
  const SHAPE = g => g.kind === 'est' ? (g.id === 'P6' ? 'Estribo cerrado, ganchos 135°' : 'Gancho suplementario 135°') : g.kind === 'col' ? (g.hook ? 'L: gancho 90° en pie' : 'Recta') : g.hook ? 'Recta + ganchos 90° (12φ)' : 'Recta';
  function scheduleView(I, LY, S) {
    const v = new View('PLANILLA DE ARMADURAS'), h = 2.2 * S, rh = 6 * S;
    const cols = [['Pos.', 12], ['Cant.', 13], ['φ', 10], ['Sep. cm', 14], ['Long. m', 15], ['Forma', 50], ['kg', 14]].map(([t, w]) => [t, w * S]);
    const W = cols.reduce((a, c) => a + c[1], 0);
    const rows = LY.groups.map(g => [g.id, String(g.n), String(g.db), g.s ? fmt(g.s, g.s % 1 ? 1 : 0) : '—', mtxt(g.len), SHAPE(g), fmt(g.kg, 1)]);
    rows.push(['', '', '', '', '', 'Total acero', fmt(LY.kg, 1)]);
    rows.push(['', '', '', '', '', 'Hormigón (zapata + fuste) m³', fmt(LY.vol, 2)]);
    const n = rows.length + 1, Ht = n * rh;
    v.poly('ROTULO', [[0, 0], [W, 0], [W, -Ht], [0, -Ht]], true);
    for (let i = 1; i < n; i++) v.line('ROTULO', 0, -i * rh, W, -i * rh);
    let x = 0; cols.forEach((c, j) => { if (j) v.line('ROTULO', x, 0, x, -Ht); v.text('TEXTOS', x + 1.2 * S, -rh + 1.8 * S, h, c[0], 'L'); x += c[1]; });
    rows.forEach((r, i) => { let x = 0; r.forEach((t, j) => { v.text('TEXTOS', x + 1.2 * S, -(i + 2) * rh + 1.8 * S, h, t, 'L'); x += cols[j][1]; }); });
    v.text('TEXTOS', 0, 3 * S, 3.5 * S, v.name, 'L');
    return v;
  }

  /* ---------- Rótulo ---------- */
  function titleBlock(I, S, sheet, date) {
    const v = new View('RÓTULO'), W = 130 * S, rh = 6.5 * S, h = 2.3 * S;
    const rows = [
      ['Obra', I.obra || '—'], ['Elemento', `Zapata aislada ${I.nombre}`],
      ['Dimensiones', `B = ${mtxt(I.B)} m · L = ${mtxt(I.L)} m · H = ${mtxt(I.H)} m · fuste ${mtxt(I.cx)} × ${mtxt(I.cy)} m`],
      ['Fundación', `Df = ${mtxt(I.Df)} m · cota de apoyo ${fmt(-I.Df, 2)} · σadm = ${fmt(I.sadm, 0)} kPa`],
      ['Materiales', `Hormigón f'c = ${fmt(I.fc, 0)} MPa · Acero fy = ${fmt(I.fy, 0)} MPa`],
      ['Recubrimientos', `inferior ${I.rec} mm · superior ${I.recSup} mm · fuste ${I.recCol} mm`],
      ['Norma', 'CIRSOC 201-2005 · suelo según estudio geotécnico'],
      ['Escala · hoja', `1:${S} · ${sheet} · cotas en cm, niveles en m`],
      ['Fecha', date]
    ];
    const Ht = rows.length * rh;
    v.poly('ROTULO', [[0, 0], [W, 0], [W, Ht], [0, Ht]], true);
    v.line('ROTULO', 28 * S, 0, 28 * S, Ht);
    rows.forEach((r, i) => {
      const y = Ht - (i + 1) * rh; if (i) v.line('ROTULO', 0, y + rh, W, y + rh);
      v.text('TEXTOS', 1.5 * S, y + 2 * S, h, r[0], 'L'); v.text('TEXTOS', 29.5 * S, y + 2 * S, h, r[1], 'L');
    });
    v.text('TEXTOS', 0, -4 * S, 2 * S, 'Planos generados por la planilla «Zapata Aislada». Verificar antes de construir.', 'L');
    return v;
  }

  /* ---------- Armado de la hoja ---------- */
  function compose(I, R, S, sheet, date) {
    const LY = R.layout, gap = 12 * S;
    const pInf = planView(I, LY, false, S), pSup = (I.supX || I.supY) ? planView(I, LY, true, S) : null;
    const cA = sectionView(I, R, LY, 'x', S), cB = sectionView(I, R, LY, 'y', S);
    const sch = scheduleView(I, LY, S), tb = titleBlock(I, S, sheet, date);
    const [Wp, Hp] = SHEETS[sheet], m = 10 * S, iw = Wp * S - 2 * m, ih = Hp * S - 2 * m;
    // Acomodo en filas; se prueban varios órdenes y se adopta el primero que entra en la hoja
    const place = (vw, x, y) => vw.move(x - vw.bb[0], y - vw.bb[1]);
    const tbTop = m + tb.h + gap;
    const avail = (top, h, rc) => rc ? iw - Math.max(tb.w, sch.w) - gap : (top - h < tbTop ? iw - tb.w - gap : iw);
    const tryOrder = (items, rightCol) => {
      const rows = []; let cur = [], curW = 0, curH = 0, yTop = m + ih;
      for (const it of items) {
        const nh = Math.max(curH, it.h), nw = curW + (cur.length ? gap : 0) + it.w;
        if (cur.length && nw > avail(yTop, nh, rightCol)) { rows.push({ cur, curW, curH, yTop }); yTop -= curH + gap; cur = [it]; curW = it.w; curH = it.h; }
        else { cur.push(it); curW = nw; curH = nh; }
      }
      rows.push({ cur, curW, curH, yTop });
      let ok = rows.every(r => r.curW <= avail(r.yTop, r.curH, rightCol) + 1e-6 && r.yTop - r.curH >= m - 1e-6);
      if (rightCol && sch.h + gap + tb.h > ih) ok = false;
      const last = rows[rows.length - 1];
      return { rows, ok, rightCol, needH: m + ih - (last.yTop - last.curH), needW: Math.max(...rows.map(r => r.curW)) + (rightCol ? gap + Math.max(tb.w, sch.w) : 0) };
    };
    const V = [pInf, pSup].filter(Boolean);
    const orders = [[[...V, cA, cB, sch], false], [[pInf, cA, pSup, cB, sch].filter(Boolean), false], [[...V, cA, cB], true], [[pInf, cA, pSup, cB].filter(Boolean), true], [[cA, cB, ...V, sch], false]];
    let best = null;
    for (const [o, rc] of orders) { const t = tryOrder(o, rc); if (t.ok) { best = t; break; } if (!best || t.needH * t.needW < best.needH * best.needW) best = t; }
    best.rows.forEach(r => { let x = m; r.cur.forEach(q => { place(q, x, r.yTop - q.h); x += q.w + gap; }); });
    place(tb, m + iw - tb.w, m);
    if (best.rightCol) place(sch, m + iw - sch.w, tbTop);
    const fits = best.ok, needW = best.needW, needH = best.needH, items = [pInf, pSup, cA, cB, sch].filter(Boolean);
    const frame = new View('HOJA');
    frame.poly('ROTULO', [[0, 0], [Wp * S, 0], [Wp * S, Hp * S], [0, Hp * S]], true);
    frame.poly('ROTULO', [[m / 2, m / 2], [Wp * S - m / 2, m / 2], [Wp * S - m / 2, Hp * S - m / 2], [m / 2, Hp * S - m / 2]], true);
    const views = [frame, ...items, tb];
    return { views, fits, needW: needW / S, needH: needH / S, S, sheet, Wp, Hp };
  }

  function buildDrawing(I, R, opts = {}) {
    if (!R || R.err || !R.layout) return { error: 'No hay un cálculo válido para dibujar (revisar datos o resultante fuera de la base).' };
    const sheet = SHEETS[opts.sheet] ? opts.sheet : 'A3';
    const date = opts.date || new Date().toLocaleDateString('es-AR');
    let D, warnings = [];
    if (opts.scale && opts.scale !== 'auto') {
      D = compose(I, R, +opts.scale, sheet, date);
      if (!D.fits) warnings.push(`El contenido (${fmt(D.needW, 0)} × ${fmt(D.needH, 0)} mm) no entra en la hoja ${sheet} a escala 1:${opts.scale}. Elegí una hoja mayor o una escala más chica.`);
    } else {
      for (const S of SCALES) { D = compose(I, R, S, sheet, date); if (D.fits) break; }
      if (!D.fits) warnings.push(`Ni a escala 1:${SCALES[SCALES.length - 1]} entra en la hoja ${sheet}. Elegí una hoja mayor.`);
    }
    D.warnings = warnings;
    D.ents = D.views.flatMap(v => v.e);
    return D;
  }

  /* ---------- Escritura DXF R12 ---------- */
  function enc(s) {
    return String(s).replace(/φ/g, '%%c').replace(/±/g, '%%p').replace(/°/g, '%%d').replace(/≥/g, '>=').replace(/≤/g, '<=')
      .replace(/[−–—]/g, '-').replace(/[«»]/g, '"').replace(/³/g, '3').replace(/[^\x00-\xff]/g, '?');
  }
  function toDXF(D) {
    const o = [], g = (c, v) => { o.push(String(c)); o.push(typeof v === 'number' ? (Number.isInteger(v) && Math.abs(c) >= 60 && c < 80 ? String(v) : v.toFixed(4)) : String(v)); };
    const W = D.Wp * D.S, H = D.Hp * D.S;
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252');
    g(9, '$INSBASE'); g(10, 0); g(20, 0); g(30, 0);
    g(9, '$EXTMIN'); g(10, 0); g(20, 0); g(30, 0);
    g(9, '$EXTMAX'); g(10, W); g(20, H); g(30, 0);
    g(9, '$LIMMIN'); g(10, 0); g(20, 0);
    g(9, '$LIMMAX'); g(10, W); g(20, H);
    g(9, '$LTSCALE'); g(40, D.S);
    g(9, '$TEXTSIZE'); g(40, 2.5 * D.S);
    g(9, '$DIMSCALE'); g(40, D.S);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
    g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
    g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __ __'); g(72, 65); g(73, 2); g(40, 9); g(49, 6); g(49, -3);
    g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, '____ _ ____ _'); g(72, 65); g(73, 4); g(40, 20); g(49, 12); g(49, -3); g(49, 2); g(49, -3);
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length + 1);
    g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
    LAYERS.forEach(([n, c, lt]) => { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c); g(6, lt); });
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
    g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 0.8); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, '');
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'BLOCKS'); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const e of D.ents) {
      if (e.t === 'line') { g(0, 'LINE'); g(8, e.l); g(10, e.p[0]); g(20, e.p[1]); g(30, 0); g(11, e.p[2]); g(21, e.p[3]); g(31, 0); }
      else if (e.t === 'circle') { g(0, 'CIRCLE'); g(8, e.l); g(10, e.x); g(20, e.y); g(30, 0); g(40, e.r); }
      else if (e.t === 'poly') {
        g(0, 'POLYLINE'); g(8, e.l); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, e.closed ? 1 : 0);
        e.pts.forEach(p => { g(0, 'VERTEX'); g(8, e.l); g(10, p[0]); g(20, p[1]); g(30, 0); });
        g(0, 'SEQEND'); g(8, e.l);
      } else if (e.t === 'donut') {
        g(0, 'POLYLINE'); g(8, e.l); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, 1); g(40, e.r); g(41, e.r);
        g(0, 'VERTEX'); g(8, e.l); g(10, e.x - e.r / 2); g(20, e.y); g(30, 0); g(42, 1);
        g(0, 'VERTEX'); g(8, e.l); g(10, e.x + e.r / 2); g(20, e.y); g(30, 0); g(42, 1);
        g(0, 'SEQEND'); g(8, e.l);
      } else if (e.t === 'text') {
        g(0, 'TEXT'); g(8, e.l); g(10, e.x); g(20, e.y); g(30, 0); g(40, e.h); g(1, enc(e.s));
        if (e.rot) g(50, e.rot);
        g(41, 0.8); g(7, 'STANDARD');
        if (e.al !== 'L') { g(72, e.al === 'C' ? 1 : 2); g(11, e.x); g(21, e.y); g(31, 0); }
      }
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }
  function toBytes(str) { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); b[i] = c < 256 ? c : 63; } return b; }

  /* ---------- Vista previa SVG ---------- */
  const SVGCOL = { HORMIGON: 'var(--ink)', ARM_INF: 'var(--steel)', ARM_SUP: '#b03aa8', ARM_FUSTE: '#2a5bd7', ESTRIBOS: '#2f8f3a', COTAS: 'var(--accent)', EJES: '#c0392b', TEXTOS: 'var(--ink)', AUXILIAR: 'var(--muted)', TERRENO: 'var(--soil)', ROTULO: 'var(--ink)' };
  const LITCOL = { HORMIGON: '#1a2023', ARM_INF: '#c2361f', ARM_SUP: '#b03aa8', ARM_FUSTE: '#2a5bd7', ESTRIBOS: '#2f8f3a', COTAS: '#1b6782', EJES: '#c0392b', TEXTOS: '#1a2023', AUXILIAR: '#7a8285', TERRENO: '#94703c', ROTULO: '#1a2023' };
  /** Entidades a SVG dentro de la ventana [x0, y0, W, H] (coordenadas de dibujo, y hacia arriba). */
  function svgOf(ents, x0, y0, W, H, S, cols, bg, label) {
    const sw = 0.25 * S, Y = y => y0 + H - y, n = v => Math.round(v * 10) / 10;
    let s = `<svg viewBox="${n(x0)} 0 ${n(W)} ${n(H)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}"><rect x="${n(x0)}" width="${n(W)}" height="${n(H)}" fill="${bg}"/>`;
    const dash = l => l === 'AUXILIAR' ? ` stroke-dasharray="${6 * S} ${3 * S}"` : l === 'EJES' ? ` stroke-dasharray="${12 * S} ${3 * S} ${2 * S} ${3 * S}"` : '';
    for (const e of ents) {
      const c = cols[e.l] || cols.TEXTOS, w = e.l === 'HORMIGON' ? sw * 2 : e.l.startsWith('ARM') || e.l === 'ESTRIBOS' ? sw * 1.6 : sw;
      if (e.t === 'line') s += `<line x1="${n(e.p[0])}" y1="${n(Y(e.p[1]))}" x2="${n(e.p[2])}" y2="${n(Y(e.p[3]))}" stroke="${c}" stroke-width="${w}"${dash(e.l)}/>`;
      else if (e.t === 'poly') s += `<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map(p => n(p[0]) + ',' + n(Y(p[1]))).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}"${dash(e.l)}/>`;
      else if (e.t === 'circle') s += `<circle cx="${n(e.x)}" cy="${n(Y(e.y))}" r="${n(e.r)}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
      else if (e.t === 'donut') s += `<circle cx="${n(e.x)}" cy="${n(Y(e.y))}" r="${n(e.r)}" fill="${c}"/>`;
      else if (e.t === 'text') {
        const anc = e.al === 'C' ? 'middle' : e.al === 'R' ? 'end' : 'start';
        const tr = e.rot ? ` transform="rotate(${-e.rot} ${n(e.x)} ${n(Y(e.y))})"` : '';
        s += `<text x="${n(e.x)}" y="${n(Y(e.y))}" font-size="${n(e.h * 1.15)}" text-anchor="${anc}" fill="${c}" font-family="Arial Narrow, Arial, sans-serif"${tr}>${String(e.s).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
      }
    }
    return s + '</svg>';
  }
  function toSVG(D) { return svgOf(D.ents, 0, 0, D.Wp * D.S, D.Hp * D.S, D.S, SVGCOL, 'var(--panel)', 'Vista previa del plano'); }
  /** Cada vista del plano como SVG independiente con colores fijos (para la memoria de cálculo). */
  function viewsSVG(I, R, S = 25) {
    const D = buildDrawing(I, R, { sheet: 'A0', scale: S });
    if (D.error) return [];
    return D.views.filter(v => /^(PLANTA|CORTE)/.test(v.name)).map(v => {
      const pad = 4 * S, x0 = v.bb[0] - pad, y0 = v.bb[1] - pad, W = v.w + 2 * pad, H = v.h + 2 * pad;
      return { name: v.name, svg: svgOf(v.e, x0, y0, W, H, S, LITCOL, '#ffffff', v.name), wmm: W / S, hmm: H / S };
    });
  }

  /* ---------- ZIP (almacenado, sin compresión) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const parts = [], central = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = toBytes(f.name), data = f.data, crc = crc32(data);
      const hdr = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(Uint8Array.from(hdr), name, data);
      central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += hdr.length + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
    const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }

  return { buildDrawing, toDXF, toBytes, toSVG, viewsSVG, zip, crc32, LAYERS, SHEETS, SCALES };
});
