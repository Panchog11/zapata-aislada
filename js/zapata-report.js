/* zapata-report.js — Memoria de cálculo: un único modelo de documento que se presenta en pantalla
 * y se exporta a Word (.docx, editable) y a PDF (jsPDF con fuente Unicode incrustada).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./zapata-calc.js'), require('./zapata-dxf.js'));
  else root.ZR = factory(root.ZC, root.ZX);
})(typeof self !== 'undefined' ? self : this, function (ZC, ZX) {
  'use strict';
  const f = ZC.fmt;
  const TAG = { ok: 'VERIFICA', bad: 'NO VERIFICA', warn: 'ATENCIÓN', na: 'NO APLICA', nv: 'NO VERIFICADO' };
  const FILL = { ok: 'D9EEE0', bad: 'F6D9D5', warn: 'F5E6C8', na: 'EEEEEE', nv: 'E6E3F5', head: 'E3E8E4' };
  const pct = u => (u === null || u === undefined || !isFinite(u)) ? '—' : f(u * 100, 0) + ' %';
  const SHAPE = g => g.kind === 'est' ? (g.id === 'P6' ? 'Estribo cerrado, ganchos 135°' : 'Gancho suplementario 135°') : g.kind === 'col' ? (g.hook ? 'Gancho 90° en el pie' : 'Recta') : g.hook ? 'Recta con ganchos 90° (12φ)' : 'Recta';

  /* ================= Modelo del documento ================= */
  function build(R, opts = {}) {
    const I = R.I, date = opts.date || new Date().toLocaleDateString('es-AR');
    const B = [], h1 = t => B.push({ t: 'h1', text: t }), h2 = t => B.push({ t: 'h2', text: t }), h3 = t => B.push({ t: 'h3', text: t });
    const p = (t, small) => B.push({ t: 'p', text: t, small }), kv = rows => B.push({ t: 'kv', rows }), list = items => B.push({ t: 'list', items });
    const table = (head, rows, w, small = true) => B.push({ t: 'table', head, rows, w, small });
    const nb = R.err ? 0 : R.checks.filter(c => c.st === 'bad').length, nv = R.err ? 0 : R.checks.filter(c => c.st === 'nv').length;
    const estado = R.err ? 'Datos incompletos' : (nb ? `NO VERIFICA (${nb} verificación${nb > 1 ? 'es' : ''})` : 'VERIFICA') + (nv ? ` · ${nv} ítem${nv > 1 ? 's' : ''} no verificado${nv > 1 ? 's' : ''}` : '');
    const doc = { title: 'Memoria de cálculo', subtitle: `Zapata aislada ${I.nombre}`, meta: { obra: I.obra || '—', fecha: date, norma: 'CIRSOC 201-2005 · estudio geotécnico (CIRSOC 401)', estado, nb, nv }, blocks: B };
    if (R.err) { h1('Datos incompletos'); list(R.err); return doc; }
    const W = R.W, d = R.d, LY = R.layout;

    h1('1. Objeto y alcance');
    p(`Verificación y dimensionamiento de la zapata aislada ${I.nombre} de hormigón armado${I.obra ? `, obra «${I.obra}»` : ''}, con su fuste. Se verifican las tensiones de contacto, la estabilidad (vuelco y deslizamiento), la zapata (flexión en ambas caras, corte, punzonado, aplastamiento, cuantías, separaciones y anclajes) y el fuste (flexo-compresión oblicua, corte, detallado de estribos y anclaje en la zapata).`);
    h1('2. Normativa y criterios');
    list([
      'CIRSOC 201-2005: Reglamento argentino de estructuras de hormigón (estructura y numeración equivalentes al ACI 318-05). Los artículos citados en cada verificación corresponden a ese reglamento.',
      'Parámetros del suelo (σadm, μ, ca) y coeficientes de seguridad al vuelco y deslizamiento: datos del estudio geotécnico del proyecto (CIRSOC 401). Esta memoria no calcula la capacidad portante ni asentamientos.',
      'Combinaciones de carga: definidas por el proyectista (CIRSOC 201-2005 §9.2). Las de servicio se usan para el suelo y la estabilidad; las últimas para el hormigón armado.',
      'Límites configurables por el usuario que deben confirmarse con el reglamento vigente: separación máxima de barras (§7.6.5), diámetro mínimo de estribos (§7.10.5.1), separación de estribos (§7.10.5.2) y recubrimientos mínimos según exposición (§7.7).',
      `Criterio de armadura superior: ${I.critSup === 'siempre' ? 'se exige siempre que exista momento negativo' : 'se exige cuando el momento negativo mayorado supera la resistencia a flexión del hormigón simple (Cap. 22: φMn = 0,60·0,42·√f\'c·b·(H − 50 mm)²/6)'}.`
    ]);

    h1('3. Datos de entrada');
    h2('3.1 Materiales');
    kv([["Hormigón f'c", `${f(I.fc, 0)} MPa`], ['Acero fy (barras) · fyt (estribos)', `${f(I.fy, 0)} MPa · ${f(I.fyt, 0)} MPa`], ['Módulo del acero Es', `${f(ZC.ES, 0)} MPa`], ['Peso unitario del hormigón γc', `${f(I.gc, 1)} kN/m³`], ['Tamaño máximo del agregado', `${f(I.dagg, 0)} mm`]]);
    h2('3.2 Geometría');
    kv([['Planta B × L (x × y)', `${f(I.B, 2)} × ${f(I.L, 2)} m`], ['Altura H', `${f(I.H, 2)} m`], ['Profundidad Df · cota de fundación', `${f(I.Df, 2)} m · ${f(-I.Df, 2)}`], ['Fuste cx × cy', `${f(I.cx, 2)} × ${f(I.cy, 2)} m`], ['Excentricidad del fuste ex₀ · ey₀', `${f(I.ex0, 2)} · ${f(I.ey0, 2)} m`], ['Esfuerzos aplicados en', I.apl === 'terr' ? 'nivel de terreno ±0,00' : 'cara superior de la zapata'], ['Recubrimientos inferior · superior · fuste', `${I.rec} · ${I.recSup} · ${I.recCol} mm`]]);
    h2('3.3 Suelo y criterios geotécnicos');
    kv([['Tensión admisible σadm', `${f(I.sadm, 0)} kPa (${f(I.sadm / 98.0665, 2)} kg/cm²)`], ['Tensión máxima en borde admitida', `${f(I.kmax, 2)} · σadm = ${f(I.kmax * I.sadm, 0)} kPa`], ['Peso unitario del relleno γs', `${f(I.gs, 1)} kN/m³`], ['Fricción μ · adhesión ca', `${f(I.mu, 2)} · ${f(I.ca, 0)} kPa`], ['Área comprimida mínima', `${f(I.Amin, 0)} %`], ['FS vuelco · FS deslizamiento', `${f(I.FSv, 2)} · ${f(I.FSd, 2)}`]]);
    h2('3.4 Cargas y combinaciones');
    p('Convención: My(+) y Vx(+) comprimen el borde +x; Mx(+) y Vy(+) comprimen el borde +y; N(+) es compresión; Mz es el torsor alrededor del eje vertical. γD mayora el peso propio y el relleno en las combinaciones últimas.', true);
    table(['Comb.', 'Tipo', 'Descripción', 'N [kN]', 'Vx [kN]', 'Vy [kN]', 'Mx [kN·m]', 'My [kN·m]', 'Mz [kN·m]', 'γD'],
      I.combos.map(c => [c.id, c.tipo === 'ult' ? 'Última' : 'Servicio', c.desc || '', f(c.N, 1), f(c.Vx, 1), f(c.Vy, 1), f(c.Mx, 1), f(c.My, 1), f(c.Mz, 1), c.tipo === 'ult' ? f(c.gD, 2) : '—']),
      [0.07, 0.09, 0.16, 0.09, 0.09, 0.09, 0.1, 0.1, 0.1, 0.11]);
    h2('3.5 Armaduras adoptadas');
    const ci = R.colI || I;
    kv([['Inferior dir. x · dir. y', `φ${I.dbx} c/${f(I.sx, 1)} cm · φ${I.dby} c/${f(I.sy, 1)} cm (capa inferior: dir. ${I.capa})`],
      ['Superior dir. x · dir. y', `${I.supX ? `φ${I.dbxs} c/${f(I.sxs, 1)} cm` : 'no dispuesta'} · ${I.supY ? `φ${I.dbys} c/${f(I.sys, 1)} cm` : 'no dispuesta'}`],
      ['Fuste: longitudinal', `${2 * ci.nbx + 2 * ci.nby - 4} φ${ci.dbL} (${ci.nbx} por cara x, ${ci.nby} por cara y)${I.colModo === 'auto' ? ' · diseño automático' : ''}`],
      ['Fuste: estribos', `φ${ci.dbe} c/${f(ci.se, 1)} cm · anclaje en zapata: ${ci.ancCol === 'gancho' ? 'gancho 90° sobre la malla inferior' : 'recto'}`]]);

    h1('4. Resumen de verificaciones');
    p(`Estado general: ${estado}.`);
    table(['Verificación', 'Comb.', 'Resultado', 'Utiliz.', 'Estado'],
      R.checks.map(c => [c.n, c.combo || '—', c.txt, pct(c.u), { text: TAG[c.st], st: c.st }]), [0.36, 0.07, 0.33, 0.09, 0.15]);

    h1('5. Desarrollo del cálculo');
    h2('5.1 Pesos, brazos y alturas útiles');
    kv([['Peso de la zapata Wf = B·L·H·γc', `${f(I.B, 2)}·${f(I.L, 2)}·${f(I.H, 2)}·${f(I.gc, 1)} = ${f(W.Wf, 1)} kN`],
      ['Peso del fuste enterrado Wp', `${f(W.Wp, 1)} kN${I.apl === 'terr' ? '' : ' (incluido en N: cargas en la cara superior)'}`],
      ['Peso del relleno Ws = (B·L − cx·cy)·(Df − H)·γs', `${f(W.Ws, 1)} kN`], ['Peso total G', `${f(W.W, 1)} kN`],
      ['Brazo de los cortes hasta la base h', `${f(W.hz, 2)} m`],
      ['Alturas útiles dx · dy · d medio', `${f(d.dx * 1000, 0)} · ${f(d.dy * 1000, 0)} · ${f(d.dm * 1000, 0)} mm`],
      ['Luz libre entre mallas', `${f(d.gap * 1000, 0)} mm`]]);
    h2('5.2 Presiones de contacto (servicio)');
    p('P = N + G;  My,base = My + Vx·h + (N + Wp − Wv)·ex₀;  Mx,base = Mx + Vy·h + (N + Wp − Wv)·ey₀. Distribución lineal sin tracciones σ = a + b·x + c·y ≥ 0; con despegue se resuelve el equilibrio de N, Mx y My por integración numérica.', true);
    table(['Comb.', 'P [kN]', 'Mx,b [kN·m]', 'My,b [kN·m]', 'ex [m]', 'ey [m]', 'σmax [kPa]', 'σmin [kPa]', 'Contacto'],
      R.serv.map(s => s.fail ? [s.id, f(s.P, 1), f(s.Mx, 1), f(s.My, 1), { text: s.fail, st: 'bad', span: 5 }] : [s.id, f(s.P, 1), f(s.Mx, 1), f(s.My, 1), f(s.ex, 3), f(s.ey, 3), f(s.sMax, 1), f(s.sMin, 1), f(s.contact * 100, 0) + ' %']),
      [0.08, 0.11, 0.12, 0.12, 0.1, 0.1, 0.13, 0.12, 0.12]);
    if (R.ult) {
      h2('5.3 Solicitaciones últimas en la zapata');
      p('Presión bruta σu bajo la combinación mayorada menos el peso propio y el relleno mayorados (wu = γD·(H·γc + (Df − H)·γs)). Momentos por metro de ancho; Mu+ tracciona la cara inferior y Mu− la superior. Se barren 24 secciones por voladizo.', true);
      table(['Comb.', 'Pc [kN]', 'σu máx [kPa]', 'Mu+ x', 'Mu+ y', 'Mu− x', 'Mu− y', 'Vu x [kN]', 'Vu y [kN]', 'Vu punz. [kN]'],
        R.ult.map(u => u.sol.fail ? [u.id, f(u.Pc, 1), { text: u.sol.fail, st: 'bad', span: 8 }] : [u.id, f(u.Pc, 1), f(u.sol.sMax, 1), f(u.fx.Mpos / I.L, 1), f(u.fy.Mpos / I.B, 1), f(u.fx.Mneg / I.L, 1), f(u.fy.Mneg / I.B, 1), f(u.vx.V, 1), f(u.vy.V, 1), u.p.na ? '—' : f(u.p.Vu, 1)]),
        [0.08, 0.09, 0.1, 0.09, 0.09, 0.09, 0.09, 0.12, 0.12, 0.13]);
      p('Momentos en kN·m/m.', true);
    }
    // Verificaciones detalladas
    let sec = 4;
    const groups = []; R.checks.forEach(c => { let g = groups.find(x => x.g === c.g); if (!g) groups.push(g = { g: c.g, items: [] }); g.items.push(c); });
    groups.forEach(g => {
      h2(`5.${sec++} ${g.g}`);
      g.items.forEach(c => {
        h3(`${c.n}${c.combo ? ` (${c.combo})` : ''}`);
        const rows = [];
        if (c.formula) rows.push(['Fórmula', c.formula]);
        if (c.subst) rows.push(['Sustitución', c.subst]);
        rows.push(['Resultado', c.txt]);
        if (c.crit) rows.push(['Criterio de aceptación', c.crit]);
        if (c.u !== null && isFinite(c.u)) rows.push(['Utilización', pct(c.u)]);
        rows.push(['Referencia', c.ref || '—']);
        if (c.nt) rows.push(['Observación', c.nt]);
        rows.push(['Estado', { text: TAG[c.st], st: c.st }]);
        if (c.st === 'bad' && c.sug) rows.push(['Sugerencia', c.sug]);
        kv(rows);
      });
    });

    h1('6. Armaduras y cómputo');
    if (LY) {
      table(['Pos.', 'Designación', 'Cant.', 'φ [mm]', 'Sep. [cm]', 'Long. [m]', 'Forma', 'Peso [kg]'],
        LY.groups.map(g => [g.id, g.name, String(g.n), String(g.db), g.s ? f(g.s, g.s % 1 ? 1 : 0) : '—', f(g.len, 2), SHAPE(g), f(g.kg, 1)]).concat([['', 'Total acero', '', '', '', '', '', f(LY.kg, 1)], ['', 'Hormigón zapata + fuste', '', '', '', '', '', f(LY.vol, 2) + ' m³']]),
        [0.06, 0.2, 0.07, 0.07, 0.08, 0.09, 0.3, 0.13]);
      p(`Espera de las barras del fuste sobre ±0,00: ${f(LY.lap, 2)} m (1,3·ld, empalme clase B, §12.15.1). Los ganchos normales a 90° tienen una extensión de 12φ (§7.1.2).`, true);
    }
    h1('7. Decisiones de diseño');
    list(R.decis.concat([`La capa exterior en ambas caras corresponde a las barras de la dirección ${I.capa}.`]));
    h1('8. Hipótesis y limitaciones');
    list([
      'Zapata rígida con distribución lineal de presiones sin tracciones.',
      'No se considera el empuje pasivo lateral del suelo ni se calculan asentamientos.',
      'Fuste: flexo-compresión oblicua por compatibilidad de deformaciones (εcu = 0,003, bloque rectangular, §10.2) en la sección de unión con la zapata; corte verificado por dirección.',
      'La tracción en barras del fuste (para elegir el anclaje) se detecta con la sección bruta elástica bajo cargas mayoradas.',
      'No se aplica la reducción de longitudes de anclaje por exceso de armadura (§12.2.5).',
      'No implementado: requisitos sismorresistentes de INPRES-CIRSOC 103 Parte II, efectos de segundo orden del fuste y fisuración. Cuando corresponden se informan como «no verificado».'
    ]);
    if (opts.figures !== false) {
      h1('9. Planos');
      p('Vistas generadas desde la geometría y las armaduras del cálculo (cotas en cm, niveles en m).', true);
      B.push({ t: 'fig', key: 'PLANTA - ARMADURA INFERIOR', caption: 'Planta — armadura inferior' });
      if (I.supX || I.supY) B.push({ t: 'fig', key: 'PLANTA - ARMADURA SUPERIOR', caption: 'Planta — armadura superior' });
      B.push({ t: 'fig', key: 'CORTE A-A (dirección x)', caption: 'Corte A-A (dirección x)' });
      B.push({ t: 'fig', key: 'CORTE B-B (dirección y)', caption: 'Corte B-B (dirección y)' });
    }
    B.push({ t: 'sign', text: 'Responsable del cálculo' });
    return doc;
  }

  /* ================= HTML (pantalla) ================= */
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cellT = c => typeof c === 'object' && c ? c.text : c;
  function toHTML(doc) {
    let h = `<div class="mcover"><div class="mt">${esc(doc.title)}</div><div class="ms">${esc(doc.subtitle)}</div><div class="mm">Obra: ${esc(doc.meta.obra)} · Fecha: ${esc(doc.meta.fecha)} · ${esc(doc.meta.norma)}</div><div class="mst ${doc.meta.nb ? 'bad' : 'ok'}">${esc(doc.meta.estado)}</div></div>`;
    for (const b of doc.blocks) {
      if (b.t === 'h1') h += `<h3 class="mh1">${esc(b.text)}</h3>`;
      else if (b.t === 'h2') h += `<h4>${esc(b.text)}</h4>`;
      else if (b.t === 'h3') h += `<h5>${esc(b.text)}</h5>`;
      else if (b.t === 'p') h += `<p${b.small ? ' class="small"' : ''}>${esc(b.text)}</p>`;
      else if (b.t === 'list') h += `<ul>${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
      else if (b.t === 'kv') h += `<table class="kv">${b.rows.map(r => `<tr><th>${esc(r[0])}</th><td${typeof r[1] === 'object' ? ` class="st-${r[1].st}"` : ''}>${esc(cellT(r[1]))}</td></tr>`).join('')}</table>`;
      else if (b.t === 'table') h += `<div class="tblwrap"><table class="vt"><thead><tr>${b.head.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td${typeof c === 'object' && c ? ` class="st-${c.st}"${c.span ? ` colspan="${c.span}"` : ''}` : ''}>${esc(cellT(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      else if (b.t === 'fig') h += `<p class="small">Figura: ${esc(b.caption)} (incluida en las exportaciones a Word y PDF; ver también la pestaña «Planos»).</p>`;
      else if (b.t === 'sign') h += `<p class="small">${esc(b.text)}: ____________________</p>`;
    }
    return h;
  }

  /* ================= Word (.docx) ================= */
  const xe = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const utf8 = s => new TextEncoder().encode(s);
  const TW = 9354; // ancho útil en twips (A4 con márgenes 2,5 / 2,0 cm)
  function run(t, o = {}) { return `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xe(t)}</w:t></w:r>`; }
  function para(t, style, o = {}) { return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}${o.keep ? '<w:keepNext/>' : ''}${o.pb ? '<w:pageBreakBefore/>' : ''}${o.ind ? `<w:ind w:left="${o.ind}" w:hanging="240"/>` : ''}${o.sp ? `<w:spacing w:before="${o.sp[0]}" w:after="${o.sp[1]}"/>` : ''}</w:pPr>${run(t, o)}</w:p>`; }
  function tbl(rows, widths, headRow, sz) {
    const tw = widths.map(w => Math.round(w * TW));
    let x = `<w:tbl><w:tblPr><w:tblStyle w:val="TablaZ"/><w:tblW w:w="${TW}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${tw.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    rows.forEach((r, i) => {
      const hd = headRow && i === 0;
      x += `<w:tr><w:trPr><w:cantSplit/>${hd ? '<w:tblHeader/>' : ''}</w:trPr>`;
      let col = 0;
      r.forEach(c => {
        const o = typeof c === 'object' && c ? c : { text: c }, span = o.span || 1;
        const w = tw.slice(col, col + span).reduce((a, b) => a + b, 0); col += span;
        const fill = hd ? FILL.head : (o.st ? FILL[o.st] : (o.fill || null));
        x += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>${para(o.text, 'Tabla', { b: hd || o.b || !!o.st, sz })}</w:tc>`;
      });
      x += '</w:tr>';
    });
    return x + '</w:tbl>' + para('', 'Tabla', { sz: 8 });
  }
  function imageXml(id, rid, wmm, hmm, name) {
    const cx = Math.round(wmm * 36000), cy = Math.round(hmm * 36000);
    return `<w:p><w:pPr><w:jc w:val="center"/><w:keepNext/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${xe(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="figura${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  /** Partes XML y binarias del .docx (expuesto para pruebas). images: { clave: {bytes, wmm, hmm} } */
  function docxParts(doc, images = {}) {
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    const media = [];
    let body = '';
    body += para(doc.title.toUpperCase(), 'Title', { sp: [2400, 120] });
    body += para(doc.subtitle, 'Subtitle');
    body += tbl([['Obra', doc.meta.obra], ['Elemento', doc.subtitle], ['Normativa', doc.meta.norma], ['Fecha', doc.meta.fecha], ['Estado general', { text: doc.meta.estado, st: doc.meta.nb ? 'bad' : 'ok' }]], [0.3, 0.7], false, 20);
    let first = true;
    for (const b of doc.blocks) {
      if (b.t === 'h1') { body += para(b.text, 'Heading1', { pb: first }); first = false; }
      else if (b.t === 'h2') body += para(b.text, 'Heading2');
      else if (b.t === 'h3') body += para(b.text, 'Heading3');
      else if (b.t === 'p') body += para(b.text, b.small ? 'Nota' : null);
      else if (b.t === 'list') body += b.items.map(i => para('• ' + i, 'Lista')).join('');
      else if (b.t === 'kv') body += tbl(b.rows, [0.3, 0.7], false, 17);
      else if (b.t === 'table') body += tbl([b.head].concat(b.rows), b.w, true, 15);
      else if (b.t === 'fig') {
        const im = images[b.key]; if (!im) continue;
        media.push(im); const n = media.length, wmm = Math.min(160, im.wmm), hmm = im.hmm * wmm / im.wmm;
        const hh = Math.min(hmm, 215), ww = wmm * hh / hmm;
        body += imageXml(n + 10, `rIdImg${n}`, ww, hh, b.caption) + para(`Figura ${n}: ${b.caption}`, 'Caption');
      } else if (b.t === 'sign') body += para('', null, { sp: [600, 0] }) + para('____________________________________', null) + para(b.text, 'Nota');
    }
    const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
    const st = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:lang w:val="es-AR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${st('Title', 'Title', '<w:jc w:val="center"/>', '<w:b/><w:color w:val="1A2023"/><w:sz w:val="44"/><w:szCs w:val="44"/>')}
${st('Subtitle', 'Subtitle', '<w:jc w:val="center"/><w:spacing w:after="480"/>', '<w:color w:val="1B6782"/><w:sz w:val="30"/><w:szCs w:val="30"/>')}
${st('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="320" w:after="120"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="1B6782"/></w:pBdr><w:outlineLvl w:val="0"/>', '<w:b/><w:color w:val="1B6782"/><w:sz w:val="28"/><w:szCs w:val="28"/>')}
${st('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="1"/>', '<w:b/><w:color w:val="1A2023"/><w:sz w:val="23"/><w:szCs w:val="23"/>')}
${st('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/>', '<w:b/><w:color w:val="3A4447"/><w:sz w:val="19"/><w:szCs w:val="19"/>')}
${st('Nota', 'Nota', '<w:spacing w:after="80"/>', '<w:color w:val="5A6569"/><w:sz w:val="17"/><w:szCs w:val="17"/>')}
${st('Lista', 'Lista', '<w:ind w:left="300" w:hanging="200"/><w:spacing w:after="60"/>', '')}
${st('Tabla', 'Tabla', '<w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="17"/><w:szCs w:val="17"/>')}
${st('Caption', 'caption', '<w:jc w:val="center"/><w:spacing w:after="200"/>', '<w:i/><w:color w:val="5A6569"/><w:sz w:val="17"/><w:szCs w:val="17"/>')}
<w:style w:type="table" w:styleId="TablaZ"><w:name w:val="Tabla Zapata"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B5BDB8"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B5BDB8"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B5BDB8"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B5BDB8"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B5BDB8"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B5BDB8"/></w:tblBorders><w:tblCellMar><w:top w:w="30" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
    const fld = code => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Nota"/><w:jc w:val="center"/></w:pPr>${run(`${doc.title} — ${doc.subtitle} · página `)}${fld('PAGE')}${run(' de ')}${fld('NUMPAGES')}</w:p></w:ftr>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${media.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/figura${i + 1}.png"/>`).join('')}</Relationships>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(doc.title + ' — ' + doc.subtitle)}</dc:title><dc:creator>Planilla Zapata Aislada</dc:creator><dc:language>es-AR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const ctypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    return {
      xml: { '[Content_Types].xml': ctypes, '_rels/.rels': pkgRels, 'word/document.xml': document, 'word/styles.xml': styles, 'word/footer1.xml': footer, 'word/_rels/document.xml.rels': rels, 'docProps/core.xml': core },
      media: media.map((m, i) => ({ name: `word/media/figura${i + 1}.png`, data: m.bytes }))
    };
  }
  function toDocx(doc, images) {
    const P = docxParts(doc, images);
    return ZX.zip(Object.keys(P.xml).map(name => ({ name, data: utf8(P.xml[name]) })).concat(P.media));
  }

  /* ================= PDF (jsPDF) ================= */
  const RGB = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  function toPDF(doc, images, jsPDF, fonts) {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.addFileToVFS('DejaVu.ttf', fonts.regular); pdf.addFont('DejaVu.ttf', 'DejaVu', 'normal');
    pdf.addFileToVFS('DejaVu-B.ttf', fonts.bold); pdf.addFont('DejaVu-B.ttf', 'DejaVu', 'bold');
    const ML = 25, MR = 20, MT = 20, MB = 20, PW = 210, PH = 297, CW = PW - ML - MR, BOT = PH - MB - 6;
    let y = MT;
    const lh = pt => pt * 0.3528 * 1.22;
    const font = (pt, b) => { pdf.setFont('DejaVu', b ? 'bold' : 'normal'); pdf.setFontSize(pt); };
    const color = h => pdf.setTextColor(...RGB(h));
    const newPage = () => { pdf.addPage(); y = MT; };
    const ensure = h => { if (y + h > BOT) newPage(); };
    const write = (text, pt, b, col, indent = 0, after = 1.4) => {
      font(pt, b); color(col || '1A2023');
      const lines = pdf.splitTextToSize(String(text), CW - indent);
      lines.forEach(l => { ensure(lh(pt)); pdf.text(l, ML + indent, y + lh(pt) * 0.8); y += lh(pt); });
      y += after;
    };
    const drawTable = (rows, widths, head, pt) => {
      const ws = widths.map(w => w * CW), pad = 1.3, L = lh(pt);
      const layoutRow = (r, hd) => {
        let col = 0;
        const cells = r.map(c => {
          const o = typeof c === 'object' && c ? c : { text: c }, span = o.span || 1;
          const w = ws.slice(col, col + span).reduce((a, b) => a + b, 0), x = ML + ws.slice(0, col).reduce((a, b) => a + b, 0); col += span;
          font(pt, hd || !!o.st); const lines = pdf.splitTextToSize(String(o.text == null ? '' : o.text), w - 2 * pad);
          return { o, w, x, lines, hd };
        });
        return { cells, h: Math.max(...cells.map(c => c.lines.length)) * L + 2 * pad };
      };
      const paint = (R) => {
        R.cells.forEach(c => {
          const fill = c.hd ? FILL.head : c.o.st ? FILL[c.o.st] : null;
          if (fill) { pdf.setFillColor(...RGB(fill)); pdf.rect(c.x, y, c.w, R.h, 'F'); }
          pdf.setDrawColor(181, 189, 184); pdf.setLineWidth(0.15); pdf.rect(c.x, y, c.w, R.h, 'S');
          font(pt, c.hd || !!c.o.st); color('1A2023');
          c.lines.forEach((l, i) => pdf.text(l, c.x + pad, y + pad + L * (i + 0.78)));
        });
        y += R.h;
      };
      const H = head ? layoutRow(rows[0], true) : null;
      (head ? rows.slice(1) : rows).forEach((r, i) => {
        const Rw = layoutRow(r, false);
        if (y + Rw.h > BOT || (H && i === 0 && y + H.h + Rw.h > BOT)) { newPage(); }
        if (H && (i === 0 || y === MT)) paint(H);
        paint(Rw);
      });
      y += 3;
    };
    // Portada
    y = 80; font(24, true); color('1A2023'); pdf.text(doc.title.toUpperCase(), PW / 2, y, { align: 'center' });
    y += 12; font(16, false); color('1B6782'); pdf.text(doc.subtitle, PW / 2, y, { align: 'center' });
    y += 20;
    drawTable([['Obra', doc.meta.obra], ['Elemento', doc.subtitle], ['Normativa', doc.meta.norma], ['Fecha', doc.meta.fecha], ['Estado general', { text: doc.meta.estado, st: doc.meta.nb ? 'bad' : 'ok' }]], [0.3, 0.7], false, 10);
    let figN = 0, first = true;
    for (const b of doc.blocks) {
      if (b.t === 'h1') { if (first) { newPage(); first = false; } else { ensure(30); y += 3; } write(b.text, 14, true, '1B6782', 0, 0.8); pdf.setDrawColor(27, 103, 130); pdf.setLineWidth(0.4); pdf.line(ML, y, ML + CW, y); y += 3; }
      else if (b.t === 'h2') { ensure(22); y += 1.5; write(b.text, 11.5, true, '1A2023', 0, 1); }
      else if (b.t === 'h3') { ensure(20); write(b.text, 9.5, true, '3A4447', 0, 0.8); }
      else if (b.t === 'p') write(b.text, b.small ? 8.5 : 9.5, false, b.small ? '5A6569' : '1A2023');
      else if (b.t === 'list') b.items.forEach(i => { font(9.5, false); ensure(lh(9.5)); color('1A2023'); pdf.text('•', ML + 1, y + lh(9.5) * 0.8); write(i, 9.5, false, '1A2023', 5, 0.8); });
      else if (b.t === 'kv') drawTable(b.rows, [0.3, 0.7], false, 8.5);
      else if (b.t === 'table') drawTable([b.head].concat(b.rows), b.w, true, 7.5);
      else if (b.t === 'fig') {
        const im = images[b.key]; if (!im) continue;
        let w = Math.min(CW, im.wmm), h = im.hmm * w / im.wmm;
        if (h > 200) { w *= 200 / h; h = 200; }
        ensure(h + 10);
        pdf.addImage(im.dataURL, 'PNG', ML + (CW - w) / 2, y, w, h); y += h + 2;
        figN++; font(8.5, false); color('5A6569'); pdf.text(`Figura ${figN}: ${b.caption}`, PW / 2, y + 3, { align: 'center' }); y += 9;
      } else if (b.t === 'sign') { ensure(30); y += 18; pdf.setDrawColor(26, 32, 35); pdf.setLineWidth(0.3); pdf.line(ML, y, ML + 80, y); y += 2; write(b.text, 9, false, '5A6569'); }
    }
    const n = pdf.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      pdf.setPage(i); font(7.5, false); color('5A6569');
      pdf.text(`${doc.title} — ${doc.subtitle}`, ML, PH - 10);
      pdf.text(`página ${i} de ${n}`, PW - MR, PH - 10, { align: 'right' });
      pdf.setDrawColor(201, 208, 203); pdf.setLineWidth(0.2); pdf.line(ML, PH - 13, PW - MR, PH - 13);
    }
    pdf.setProperties({ title: `${doc.title} — ${doc.subtitle}`, creator: 'Planilla Zapata Aislada', language: 'es-AR' });
    return pdf.output('arraybuffer');
  }

  return { build, toHTML, docxParts, toDocx, toPDF, TAG };
});
