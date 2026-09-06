/// <reference path="core.ts" />

/* ============================================================
   (i) Master Time–Distance String Chart (Marey diagram)

   X = division time, Y = chainage along the corridor.
   Chainage increases UPWARD, so UP trains (km increasing) slope up and
   DN trains slope down — the way a controller reads a string chart.
   ============================================================ */

namespace RailSync.Marey {

  const M = { l: 64, r: 16, t: 12, b: 26 };
  function corridorTrains(cid: string): Train[] {
    return D.trains.filter(function (t) { return t.corridor === cid; });
  }

  function visibleWindow(): [number, number] {
    const span = S.zoom * 60;
    if (span >= DAY) return [0, DAY];
    const a = Math.max(0, Math.min(DAY - span, S.zoomAt));
    return [a, a + span];
  }

  export function render(): void {
    const host = byId('marey-wrap');
    const root = document.getElementById('marey-svg') as unknown as SVGSVGElement | null;
    if (!host || !root) return;

    const W = host.clientWidth, H = host.clientHeight;
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    // the pane can be laid out narrower than the margins (or hidden entirely),
    // which would give the plot a negative extent
    if (iw < 20 || ih < 20) return;

    clear(root);
    root.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    const corr = corridorById(S.corridor);
    const win = visibleWindow(), t0 = win[0], t1 = win[1];
    const maxKm = corr.lengthKm;

    const X = (t: number) => M.l + (t - t0) / (t1 - t0) * iw;
    const Y = (km: number) => M.t + ih - (km / maxKm) * ih;   // km 0 at the bottom

    /* ---- defs: clip + block hatching ---- */
    const defs = svgEl('defs');
    const cp = svgEl('clipPath', { id: 'mk-clip' });
    cp.appendChild(svgEl('rect', { x: M.l, y: M.t, width: iw, height: ih }));
    defs.appendChild(cp);
    const hatch = svgEl('pattern', {
      id: 'mk-hatch', width: 7, height: 7,
      patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'
    });
    hatch.appendChild(svgEl('rect', { width: 7, height: 7, fill: 'rgba(245,185,66,.09)' }));
    hatch.appendChild(svgEl('line', {
      x1: 0, y1: 0, x2: 0, y2: 7, stroke: 'rgba(245,185,66,.42)', 'stroke-width': 2.5
    }));
    defs.appendChild(hatch);
    root.appendChild(defs);

    const plot = svgEl('g', { 'clip-path': 'url(#mk-clip)' });

    /* ---- night shading: the hours line blocks are normally granted in ---- */
    ([[0, 300], [1380, 1440]] as [number, number][]).forEach(function (n) {
      const a = Math.max(n[0], t0), b = Math.min(n[1], t1);
      if (b <= a) return;
      plot.appendChild(svgEl('rect', {
        x: X(a), y: M.t, width: X(b) - X(a), height: ih, class: 'mk-night'
      }));
    });

    /* ---- time grid ---- */
    const stepMin = S.zoom >= 24 ? 60 : (S.zoom >= 8 ? 30 : 15);
    const labelEvery = S.zoom >= 24 ? 120 : (S.zoom >= 8 ? 60 : 30);
    for (let t = Math.ceil(t0 / stepMin) * stepMin; t <= t1; t += stepMin) {
      const major = t % labelEvery === 0;
      plot.appendChild(svgEl('line', {
        x1: X(t), y1: M.t, x2: X(t), y2: M.t + ih, class: major ? 'mk-grid-hr' : 'mk-grid'
      }));
      if (major) {
        const tx = svgEl('text', { x: X(t), y: H - 9, class: 'mk-axis-txt', 'text-anchor': 'middle' });
        tx.textContent = hhmm(t);
        root.appendChild(tx);
      }
    }

    /* ---- station lines + labels ---- */
    corr.stations.forEach(function (st) {
      plot.appendChild(svgEl('line', {
        x1: M.l, y1: Y(st.km), x2: M.l + iw, y2: Y(st.km), class: 'mk-stn-line'
      }));
      const lab = svgEl('text', { x: M.l - 8, y: Y(st.km) + 3, class: 'mk-stn-txt', 'text-anchor': 'end' });
      lab.textContent = st.code;
      root.appendChild(lab);
      const km = svgEl('text', { x: M.l - 8, y: Y(st.km) + 12, class: 'mk-stn-km', 'text-anchor': 'end' });
      km.textContent = st.km.toFixed(0);
      root.appendChild(km);
    });

    /* ---- permanent speed restrictions as horizontal bands ---- */
    D.tsr.filter(function (r) { return r.corridor === corr.id; }).forEach(function (r) {
      const ya = Y(Math.max(r.fromKm, r.toKm)), yb = Y(Math.min(r.fromKm, r.toKm));
      plot.appendChild(svgEl('rect', {
        x: M.l, y: ya, width: iw, height: Math.max(2, yb - ya), class: 'mk-tsr'
      }));
    });

    /* ---- maintenance blocks ---- */
    S.proposals.filter(function (p) {
      return p.corridor === corr.id && p.status !== 'REJECTED';
    }).forEach(function (p) {
      const dur = totalDuration(p);
      const xa = X(p.start), xb = X(p.start + dur);
      const ya = Y(p.hiKm), yb = Y(p.loKm);
      if (xb < M.l || xa > M.l + iw) return;
      const h = Math.max(9, yb - ya);
      const cls = 'mk-block' + (p.status === 'APPROVED' ? ' approved' : '') +
        (S.selProposal === p.id ? ' sel' : '') +
        (S.hotBlock === p.id ? ' hot' : '');
      const rect = svgEl('rect', {
        x: xa, y: ya, width: Math.max(3, xb - xa), height: h, class: cls, rx: 2
      });
      rect.setAttribute('fill', p.status === 'APPROVED' ? 'rgba(46,204,113,.16)' : 'url(#mk-hatch)');
      rect.addEventListener('mousemove', function (e) {
        // cursor synchronisation: light up the track this block occupies
        if (S.hotBlock !== p.id) { S.hotBlock = p.id; bus.emit('sync'); }
        tip(blockTip(p), e as MouseEvent);
      });
      rect.addEventListener('mouseleave', function () {
        S.hotBlock = null; tipOff(); bus.emit('sync');
      });
      rect.addEventListener('click', function () {
        tipOff();
        bus.emit('openProposal', p.id);
      });
      plot.appendChild(rect);

      // the inner bar is the physical work; the outer box is the granted window
      if (xb - xa > 12 && h > 6) {
        const wx0 = X(p.start + (dur - p.window.workMin) / 2);
        const wx1 = X(p.start + (dur + p.window.workMin) / 2);
        plot.appendChild(svgEl('rect', {
          x: wx0, y: ya + h * 0.32, width: Math.max(2, wx1 - wx0), height: Math.max(2, h * 0.36),
          class: 'mk-work', rx: 1
        }));
      }

      if (xb - xa > 46 && h > 11) {
        const lbl = svgEl('text', { x: xa + 4, y: ya + Math.min(11, h - 2), class: 'mk-block-txt' });
        lbl.textContent = p.id;
        if (p.status === 'APPROVED') lbl.setAttribute('fill', '#2ecc71');
        plot.appendChild(lbl);
      }
    });

    /* ---- train paths ---- */
    const trains = corridorTrains(corr.id);
    const hot = S.hotTrain;

    // booked path, faint, so lost time reads against the actual
    trains.forEach(function (tr) {
      if (tr.kind !== 'PASSENGER' || tr.delay <= 0) return;
      plot.appendChild(svgEl('polyline', {
        points: tr.sched.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' '),
        class: 'mk-sched'
      }));
    });

    trains.forEach(function (tr) {
      const pts = tr.path.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ');
      let cls = 'mk-path ' + tr.cls;
      if (hot && hot !== tr.id) cls += ' dim';
      if (hot === tr.id) cls += ' hot';
      plot.appendChild(svgEl('polyline', { points: pts, class: cls }));

      // fat transparent stroke so thin diagonals are easy to hit
      const hit = svgEl('polyline', { points: pts, class: 'mk-hit' });
      hit.addEventListener('mousemove', function (e) {
        // cursor synchronisation: the same train lights up on the schematic
        if (S.hotTrain !== tr.id) { S.hotTrain = tr.id; bus.emit('sync'); }
        tip(trainTip(tr), e as MouseEvent);
      });
      hit.addEventListener('mouseleave', function () {
        S.hotTrain = null; tipOff(); bus.emit('sync');
      });
      plot.appendChild(hit);
    });

    root.appendChild(plot);

    /* ---- 'now' marker ---- */
    if (S.clock >= t0 && S.clock <= t1) {
      const nx = X(S.clock);
      root.appendChild(svgEl('line', { x1: nx, y1: M.t, x2: nx, y2: M.t + ih, class: 'mk-now' }));
      root.appendChild(svgEl('polygon', {
        points: (nx - 5) + ',' + M.t + ' ' + (nx + 5) + ',' + M.t + ' ' + nx + ',' + (M.t + 7),
        class: 'mk-now-head'
      }));
    }

    root.appendChild(svgEl('rect', {
      x: M.l, y: M.t, width: iw, height: ih, fill: 'none', stroke: '#243244', 'stroke-width': 1
    }));

    const sub = byId('mk-sub');
    if (sub) {
      sub.textContent = corr.name + '  ·  ' + trains.length + ' paths  ·  ' +
        hhmm(t0) + '–' + hhmm(t1 === DAY ? 1439 : t1);
    }
  }

  /* ------------------------------------------------------- tooltips */

  function trainTip(tr: Train): string {
    const pos = trainAt(S.clock, tr);
    const rows: [string, string][] = [];
    rows.push(['Class', tr.kind === 'FREIGHT' ? 'Freight rake' : tr.name]);
    rows.push(['Corridor / line', shortCorr(tr.corridor) + ' · ' + tr.line]);
    rows.push(['Direction', tr.dir + (tr.dir === 'UP' ? '  (km +)' : '  (km −)')]);
    rows.push(['Booked entry', hhmm(tr.sched[0][0]) + ' → ' + hhmm(tr.sched[tr.sched.length - 1][0])]);
    if (tr.kind === 'PASSENGER') {
      rows.push(['Running late', tr.delay > 0 ? tr.delay + ' min' : 'Right time']);
      rows.push(['MPS / avg', tr.mps + ' / ' + tr.avgSpeed + ' km/h']);
    } else {
      rows.push(['Load', tr.wagons + ' wagons · ' + tr.tonnage + ' t']);
      rows.push(['Rake length', tr.lengthM + ' m']);
      rows.push(['Loopable', tr.canLoop ? 'Yes' : 'No — through path needed']);
      rows.push(['O–D', tr.origin + ' → ' + tr.dest]);
    }
    if (pos) {
      rows.push(['Now at', 'KM ' + pos.km.toFixed(1) + (pos.moving ? '' : '  (standing)')]);
      rows.push(['Current speed', pos.speed.toFixed(0) + ' km/h']);
    } else {
      rows.push(['Now', 'Not on section']);
    }
    return '<div class="tt-h"><span class="swatch" style="background:' + CLS_COLOR[tr.cls] +
      '"></span>' + esc(tr.no) + ' · ' + esc(tr.name) + '</div>' + tipRows(rows);
  }

  function blockTip(p: LiveProposal): string {
    const dur = totalDuration(p);
    const im = p.impact;
    const rows: [string, string][] = [
      ['Section', p.section + ' · ' + p.line],
      ['Chainage', 'KM ' + p.loKm.toFixed(2) + ' – ' + p.hiKm.toFixed(2)],
      ['Granted window', hhmm(p.start) + ' – ' + hhmm(p.start + dur) + '  (' + dur + ' min)'],
      ['Physical work', p.window.workMin + ' min'],
      ['Overheads', (dur - p.window.workMin) + ' min protection / earthing / ramp'],
      ['Tasks bundled', String(p.items.length + p.added.length)],
      ['Machines', p.machines.length ? p.machines.map(function (m) { return m.id; }).join(', ') : 'Manual gang'],
      ['Train delay induced', im.paxDelayMin + ' min'],
      ['Freight into loops', String(im.freightLooped)]
    ];
    if (p.isolation) rows.push(['Isolation', p.isolation]);
    return '<div class="tt-h"><span class="swatch" style="background:' +
      (p.status === 'APPROVED' ? '#2ecc71' : '#f5b942') + '"></span>' +
      esc(p.id) + ' · ' + esc(p.status) + '</div>' + tipRows(rows) +
      '<div class="tt-r" style="margin-top:6px;color:#7c8da0"><span>Click to open work permit</span></div>';
  }

  /* ------------------------------------------------------- zoom + pan */

  export function bindZoom(): void {
    const seg = byId('mk-zoom');
    if (seg) {
      seg.addEventListener('click', function (e) {
        const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!b || !b.dataset.z) return;
        S.zoom = +b.dataset.z;
        S.zoomAt = Math.max(0, Math.min(DAY - S.zoom * 60, S.clock - S.zoom * 30));
        Array.prototype.forEach.call(seg.children, function (c: Element) {
          c.classList.toggle('on', c === b);
        });
        render();
      });
    }

    // Drag horizontally to pan the time window when zoomed in.
    const wrap = byId('marey-wrap');
    if (!wrap) return;
    let dragging = false, lastX = 0;

    wrap.addEventListener('mousedown', function (e) {
      if (S.zoom >= 24) return;
      const cl = (e.target as Element).classList;
      if (cl.contains('mk-hit') || cl.contains('mk-block')) return;
      dragging = true; lastX = e.clientX; wrap.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const iw = wrap.clientWidth - M.l - M.r;
      const perPx = (S.zoom * 60) / iw;
      S.zoomAt = Math.max(0, Math.min(DAY - S.zoom * 60, S.zoomAt - (e.clientX - lastX) * perPx));
      lastX = e.clientX;
      render();
    });
    window.addEventListener('mouseup', function () {
      dragging = false; wrap.style.cursor = '';
    });
  }
}
