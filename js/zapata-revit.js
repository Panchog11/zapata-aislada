/* zapata-revit.js — Archivo de intercambio para modelar la zapata en Revit (complemento pyRevit «Zapata Aislada»).
 * Exporta la geometría real del cálculo (R.layout): hormigón y ejes de cada barra. Revit no recalcula nada.
 * Unidades: m. Origen: centro de la zapata en planta (el fuste está en ex0, ey0); z = 0 en la cara superior del fuste
 * (nivel ±0,00 de las cargas). El complemento inserta en el eje del fuste.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./zapata-calc.js'));
  else root.ZRV = factory(root.ZC);
})(typeof self !== 'undefined' ? self : this, function (ZC) {
  'use strict';
  const FORMATO = 'zapata-aislada/revit', VERSION = 1;
  const q = v => Math.round(v * 1e4) / 1e4; // 0,1 mm
  const box = b => ({ x0: q(b.x0), x1: q(b.x1), y0: q(b.y0), y1: q(b.y1), z0: q(b.z0), z1: q(b.z1) });

  function toRevit(I, R, opts = {}) {
    if (!R || R.err || !R.layout) return { error: 'No hay un cálculo válido para exportar (revisar datos o resultante fuera de la base).' };
    const Lo = R.layout, colI = Lo.colI || I, hf = Math.max(I.Df - I.H, 0);
    const grupos = Lo.groups.map(g => ({
      id: g.id, nombre: g.name, tipo: g.kind, capa: g.layer, eje: g.ax || null,
      db: g.db, s: g.s != null ? g.s / 100 : null, n: g.n, dobladoInt: q(ZC.bendR(I, g.db) * 2 - g.db / 1000), // Ø interior (m)
      gancho: !!g.hook, largoGancho: q(g.hookLen || 0), largo: q(g.len), kg: Math.round(g.kg * 10) / 10,
      largoTotal: q(g.kg / ZC.kgm(g.db)), // suma real del grupo (en P7 las ramas x e y pueden tener largos distintos)
      cerrado: g.kind === 'est' && g.id === 'P6',
      barras: g.bars.map(b => b.map(p => p.map(q)))
    }));
    return {
      formato: FORMATO, version: VERSION, unidades: 'm',
      origen: 'Centro de la zapata en planta (fuste en ex0, ey0); z = 0 en la cara superior del fuste (±0,00)',
      fecha: opts.date || new Date().toISOString().slice(0, 10),
      nombre: I.nombre || 'Z1', obra: I.obra || '',
      materiales: { hormigon: `H-${I.fc}`, fc: I.fc, acero: `ADN ${I.fy}`, fy: I.fy, fyt: I.fyt },
      recubrimientos: { inferior: I.rec / 1000, superior: I.recSup / 1000, fuste: colI.recCol / 1000 },
      zapata: { B: I.B, L: I.L, H: I.H, Df: I.Df, caja: box(Lo.footing) },
      fuste: hf > 0 ? { cx: I.cx, cy: I.cy, ex0: I.ex0, ey0: I.ey0, h: q(hf), caja: box(Lo.fuste) } : null,
      volumen: q(Lo.vol), kgTotal: Math.round(Lo.kg * 10) / 10,
      noVerifica: (R.checks || []).filter(c => c.st === 'bad').map(c => c.n),
      grupos
    };
  }

  return { toRevit, FORMATO, VERSION };
});
