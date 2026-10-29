/* zapata-3d.js — Modelo 3D interactivo (Three.js r128) construido desde ZC.layout().
 * Ejes del modelo: x, y en planta y z vertical (Three: X = x, Y = z, Z = −y).
 */
(function (root) {
  'use strict';
  const COLORS = { inf: 0xc2361f, sup: 0xb03aa8, col: 0x2a5bd7, est: 0x2f8f3a };

  function Viewer(container) {
    const T = window.THREE;
    this.T = T; this.el = container;
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(40, 1, 0.01, 200);
    this.scene.add(new T.HemisphereLight(0xffffff, 0x8a8f8c, 0.85));
    const dl = new T.DirectionalLight(0xffffff, 0.6); dl.position.set(4, 8, 5); this.scene.add(dl);
    this.root = new T.Group(); this.scene.add(this.root);
    this.target = new T.Vector3(0, -1, 0); this.sph = { r: 7, th: -0.8, ph: 1.05 };
    this.opts = { modo: 'armaduras', hormigon: true, inf: true, sup: true, col: true, est: true, cotas: true, etiquetas: true, terreno: true };
    this._controls();
    this._resize = () => this.resize(); window.addEventListener('resize', this._resize);
    if (window.ResizeObserver) { this._ro = new ResizeObserver(this._resize); this._ro.observe(container); }
    this.resize();
    const loop = () => { this._raf = requestAnimationFrame(loop); if (this._dirty) { this._dirty = false; this.renderer.render(this.scene, this.camera); } };
    loop();
  }
  Viewer.prototype.resize = function () {
    const w = this.el.clientWidth || 600, h = this.el.clientHeight || 420;
    this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this._cam();
  };
  Viewer.prototype._cam = function () {
    const s = this.sph, t = this.target;
    this.camera.position.set(t.x + s.r * Math.sin(s.ph) * Math.cos(s.th), t.y + s.r * Math.cos(s.ph), t.z + s.r * Math.sin(s.ph) * Math.sin(s.th));
    this.camera.lookAt(t); this._dirty = true;
  };
  Viewer.prototype._controls = function () {
    const c = this.renderer.domElement, ptrs = new Map(); let mode = null, last = null, pinch = 0;
    c.style.touchAction = 'none';
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); mode = (e.button === 2 || e.shiftKey || ptrs.size === 2) ? 'pan' : 'rot'; last = [e.clientX, e.clientY]; if (ptrs.size === 2) { const p = [...ptrs.values()]; pinch = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); } });
    c.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) { const p = [...ptrs.values()], d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); if (pinch) this.zoom(pinch / d); pinch = d; }
      const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY];
      if (mode === 'rot' && ptrs.size === 1) { this.sph.th += dx * 0.008; this.sph.ph = Math.max(0.05, Math.min(Math.PI - 0.05, this.sph.ph - dy * 0.008)); this._cam(); }
      else if (mode === 'pan') this.pan(dx, dy);
    });
    const up = e => { ptrs.delete(e.pointerId); if (!ptrs.size) mode = null; pinch = 0; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  };
  Viewer.prototype.zoom = function (f) { this.sph.r = Math.max(0.3, Math.min(60, this.sph.r * f)); this._cam(); };
  Viewer.prototype.pan = function (dx, dy) {
    const T = this.T, k = this.sph.r * 0.0016, cam = this.camera;
    const right = new T.Vector3().setFromMatrixColumn(cam.matrix, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrix, 1);
    this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k); this._cam();
  };
  Viewer.prototype.view = function (name) {
    const b = this.bounds; if (!b) return;
    this.target.set((b[0] + b[1]) / 2, (b[4] + b[5]) / 2, -(b[2] + b[3]) / 2);
    const R = Math.max(b[1] - b[0], b[3] - b[2], b[5] - b[4]) * 1.9;
    const V = { iso: [-0.8, 1.05], planta: [-Math.PI / 2, 0.06], x: [-Math.PI / 2, Math.PI / 2], y: [0, Math.PI / 2] }[name] || [-0.8, 1.05];
    this.sph = { r: R, th: V[0], ph: V[1] }; this._cam();
  };
  Viewer.prototype.set = function (k, v) { this.opts[k] = v; this._vis(); };

  /* ---------- Construcción ---------- */
  const P = (T, p) => new T.Vector3(p[0], p[2], -p[1]);
  function cyl(T, a, b, r, mat) {
    const d = new T.Vector3().subVectors(b, a), L = d.length(); if (L < 1e-6) return null;
    const m = new T.Mesh(new T.CylinderGeometry(r, r, L, 10, 1), mat);
    m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); return m;
  }
  function label(T, text, pos, size = 0.09, color = '#1a2023') {
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d'), fs = 44;
    ctx.font = `500 ${fs}px "IBM Plex Mono", Consolas, monospace`;
    const w = Math.ceil(ctx.measureText(text).width) + 24; cv.width = w; cv.height = fs + 22;
    ctx.font = `500 ${fs}px "IBM Plex Mono", Consolas, monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.fillRect(0, 0, w, cv.height);
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 12, cv.height / 2 + 2);
    const tex = new T.CanvasTexture(cv); tex.minFilter = T.LinearFilter;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(size * w / cv.height, size, 1); sp.position.copy(pos); sp.renderOrder = 10; return sp;
  }
  function lineSeg(T, pts, color, dashed) {
    const g = new T.BufferGeometry().setFromPoints(pts);
    const m = dashed ? new T.LineDashedMaterial({ color, dashSize: 0.05, gapSize: 0.03 }) : new T.LineBasicMaterial({ color });
    const l = new T.Line(g, m); if (dashed) l.computeLineDistances(); return l;
  }
  function dim(T, a, b, off, text, color) {
    const g = new T.Group(), A = a.clone().add(off), B = b.clone().add(off);
    g.add(lineSeg(T, [a, A], color)); g.add(lineSeg(T, [b, B], color)); g.add(lineSeg(T, [A, B], color));
    g.add(label(T, text, A.clone().add(B).multiplyScalar(0.5), 0.085, '#1b6782')); return g;
  }

  Viewer.prototype.build = function (I, R) {
    const T = this.T, LY = R && R.layout;
    while (this.root.children.length) { const o = this.root.children.pop(); o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) { if (x.material.map) x.material.map.dispose(); x.material.dispose(); } }); }
    this.layers = { hormigon: [], wire: [], inf: [], sup: [], col: [], est: [], cotas: [], etiquetas: [], terreno: [] };
    if (!LY) { this._dirty = true; return; }
    const add = (k, o) => { if (!o) return; this.layers[k].push(o); this.root.add(o); };
    const f = LY.footing, fu = LY.fuste;
    const concMat = new T.MeshStandardMaterial({ color: 0xb9bdb8, roughness: 0.9, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide });
    const box = (x0, x1, y0, y1, z0, z1) => { const m = new T.Mesh(new T.BoxGeometry(x1 - x0, z1 - z0, y1 - y0), concMat); m.position.set((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2); return m; };
    const edges = (mesh) => new T.LineSegments(new T.EdgesGeometry(mesh.geometry), new T.LineBasicMaterial({ color: 0x40484a }));
    const fm = box(f.x0, f.x1, f.y0, f.y1, f.z0, f.z1); add('hormigon', fm);
    const fe = edges(fm); fe.position.copy(fm.position); add('wire', fe);
    if (fu.z1 > fu.z0 + 1e-6) { const cm = box(fu.x0, fu.x1, fu.y0, fu.y1, fu.z0, fu.z1); add('hormigon', cm); const ce = edges(cm); ce.position.copy(cm.position); add('wire', ce); }
    // Arranque de columna sobre ±0,00 (traza)
    const ct = box(fu.x0, fu.x1, fu.y0, fu.y1, 0, LY.zTop + 0.06); const cte = edges(ct); cte.position.copy(ct.position); cte.material = new T.LineDashedMaterial({ color: 0x8a9290, dashSize: 0.05, gapSize: 0.04 }); cte.computeLineDistances(); ct.geometry.dispose(); add('wire', cte);
    // Terreno
    const gs = Math.max(f.x1 - f.x0, f.y1 - f.y0) * 1.8;
    const gp = new T.Mesh(new T.PlaneGeometry(gs, gs), new T.MeshBasicMaterial({ color: 0xc8a86a, transparent: true, opacity: 0.1, side: T.DoubleSide, depthWrite: false }));
    gp.rotation.x = -Math.PI / 2; add('terreno', gp);
    add('terreno', label(T, '±0,00', new T.Vector3(gs / 2 * 0.85, 0.05, gs / 2 * 0.85), 0.09, '#94703c'));
    // Barras
    const mats = {}; const mat = k => mats[k] || (mats[k] = new T.MeshStandardMaterial({ color: COLORS[k], roughness: 0.45, metalness: 0.3 }));
    LY.groups.forEach(g => {
      const key = g.kind === 'inf' ? 'inf' : g.kind === 'sup' ? 'sup' : g.kind === 'col' ? 'col' : 'est', r = g.db / 2000;
      const grp = new T.Group();
      g.bars.forEach(b => { for (let i = 0; i < b.length - 1; i++) { const m = cyl(T, P(T, b[i]), P(T, b[i + 1]), r, mat(key)); if (m) grp.add(m); } });
      add(key, grp);
      // Etiqueta del grupo
      const mid = g.bars[Math.floor(g.bars.length / 2)], pm = mid[Math.floor((mid.length - 1) / 2)], pn = mid[Math.min(mid.length - 1, Math.floor((mid.length - 1) / 2) + 1)];
      const pos = P(T, [(pm[0] + pn[0]) / 2, (pm[1] + pn[1]) / 2, (pm[2] + pn[2]) / 2]);
      const txt = `${g.id} ${g.n}φ${g.db}${g.s ? ' c/' + g.s : ''}${g.hook ? ' gancho' : ''}`;
      const lp = pos.clone(); if (key === 'inf') lp.y -= 0.12; if (key === 'sup') lp.y += 0.12; if (key === 'col') lp.y = (LY.zTop + 0.25); if (key === 'est') lp.x += 0.35;
      add('etiquetas', label(T, txt, lp, 0.085, '#' + COLORS[key].toString(16).padStart(6, '0')));
    });
    // Cotas
    const c = 0x1b6782, k = v => ZC.fmt(v, 2);
    add('cotas', dim(T, P(T, [f.x0, f.y0, f.z0]), P(T, [f.x1, f.y0, f.z0]), new T.Vector3(0, 0, 0.35), `B = ${k(f.x1 - f.x0)} m`, c));
    add('cotas', dim(T, P(T, [f.x1, f.y0, f.z0]), P(T, [f.x1, f.y1, f.z0]), new T.Vector3(0.35, 0, 0), `L = ${k(f.y1 - f.y0)} m`, c));
    add('cotas', dim(T, P(T, [f.x0, f.y0, f.z0]), P(T, [f.x0, f.y0, f.z1]), new T.Vector3(-0.3, 0, 0.3), `H = ${k(f.z1 - f.z0)} m`, c));
    add('cotas', dim(T, P(T, [f.x0, f.y1, 0]), P(T, [f.x0, f.y1, f.z0]), new T.Vector3(-0.55, 0, 0), `Df = ${k(-f.z0)} m`, c));
    add('cotas', dim(T, P(T, [fu.x0, fu.y1, LY.zTop]), P(T, [fu.x1, fu.y1, LY.zTop]), new T.Vector3(0, 0.15, 0), `cx = ${k(fu.x1 - fu.x0)}`, c));
    add('cotas', label(T, `rec. inf. ${I.rec} mm`, P(T, [f.x1, f.y1, f.z0 + 0.02]).add(new T.Vector3(0.25, 0, -0.1)), 0.075, '#1b6782'));
    const A = R.colAnc; if (A) add('cotas', label(T, `anclaje fuste: ${ZC.fmt(A.avail * 1000, 0)} mm disp. ≥ ldc ${ZC.fmt(A.ldc * 1000, 0)}`, P(T, [fu.x1, fu.y0, f.z0 + 0.15]).add(new T.Vector3(0.6, 0, 0.4)), 0.075, '#2a5bd7'));
    this.bounds = [f.x0, f.x1, f.y0, f.y1, f.z0, Math.max(0, LY.zTop)];
    if (!this._fitted) { this.view('iso'); this._fitted = true; }
    this._vis();
  };
  Viewer.prototype._vis = function () {
    if (!this.layers) return;
    const o = this.opts, m = o.modo;
    const show = (k, v) => this.layers[k].forEach(x => { x.visible = v; });
    const concOn = o.hormigon && m !== 'alambre';
    show('hormigon', concOn); show('wire', o.hormigon || m === 'alambre');
    this.layers.hormigon.forEach(x => { x.material.opacity = m === 'solido' ? 1 : 0.22; x.material.transparent = m !== 'solido'; x.material.depthWrite = m === 'solido'; x.material.needsUpdate = true; });
    show('inf', o.inf); show('sup', o.sup); show('col', o.col); show('est', o.est);
    show('cotas', o.cotas); show('etiquetas', o.etiquetas); show('terreno', o.terreno);
    this._dirty = true;
  };
  Viewer.prototype.dispose = function () { cancelAnimationFrame(this._raf); window.removeEventListener('resize', this._resize); if (this._ro) this._ro.disconnect(); this.renderer.dispose(); };

  root.Z3D = { Viewer };
})(typeof self !== 'undefined' ? self : this);
