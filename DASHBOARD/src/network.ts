/// <reference path="core.ts" />

/* ============================================================
   (ii) Schematic Track Network Map

   Topological, not geographic: one horizontal lane per running line plus a
   dedicated loop lane, stations at true chainage, live train markers
   interpolated to the division clock, and per-block-section occupancy.

   The loop lane matters operationally — it is where freight gets regulated
   while a block is in force, and a loop only counts if its clear standing
   room actually takes the rake.
   ============================================================ */

namespace RailSync.Network {

  const M = { l: 34, r: 30, t: 24, b: 46 };
  const SECTOR: Record<string, string> = {
    CORR_NORTH: 'North', CORR_EAST: 'East', CORR_SOUTH: 'South', CORR_WEST: 'West'
  };

  /** Where the track machines stable — a controller needs to see what plant
      is available, and where, before granting a block. */
  function depotsOn(corr: Corridor): Record<string, Machine[]> {
    const by: Record<string, Machine[]> = {};
    D.machines.forEach(function (m) {
      if (m.corridor !== corr.id) return;
      (by[m.station] = by[m.station] || []).push(m);
    });
    return by;
  }

  function kmOf(corr: Corridor, code: string): number {
    for (let i = 0; i < corr.stations.length; i++) {
      if (corr.stations[i].code === code) return corr.stations[i].km;
    }
    return 0;
  }

  /** Rakes being held in loops right now, by the station holding them. */
  function regulatedNow(t: number, corr: Corridor): Record<string, Regulation[]> {
    const by: Record<string, Regulation[]> = {};
    activeBlocks(t, corr.id).forEach(function (p) {
      p.regulation.forEach(function (rg) {
        if (!rg.loop) return;
        (by[rg.loop] = by[rg.loop] || []).push(rg);
      });
    });
    return by;
  }

  export function render(): void {
    // resolved every pass: the schematic moves between workspace tabs
    const host = byId('net-wrap');
    const root = document.getElementById('net-svg') as unknown as SVGSVGElement | null;
    if (!host || !root) return;

    const W = host.clientWidth, H = host.clientHeight;
    const iw = W - M.l - M.r;
    // guard the inner extent, not just the pane: a hidden or very narrow pane
    // would otherwise produce negative geometry
    if (iw < 20 || H - M.t - M.b < 16) return;

    clear(root);
    root.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    const corr = corridorById(S.corridor);
    const lines = corr.lines;
    const maxKm = corr.lengthKm;
    // main running lines plus one lane for loops and sidings
    const laneCount = lines.length + 1;
    const avail = H - M.t - M.b;
    const laneH = Math.min(42, Math.max(13, avail / laneCount));
    // centre the diagram: a schematic reads better balanced than top-anchored,
    // and the pane is much taller on the dedicated map tab
    const top = M.t + Math.max(0, (avail - laneCount * laneH) / 2);
    const t = S.clock;

    const X = (km: number) => M.l + (km / maxKm) * iw;
    const laneY = (i: number) => top + i * laneH + laneH / 2;
    const loopY = laneY(lines.length);

    const defs = svgEl('defs');
    const hatch = svgEl('pattern', {
      id: 'nw-hatch', width: 8, height: 8,
      patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'
    });
    hatch.appendChild(svgEl('rect', { width: 8, height: 8, fill: '#3a2f13' }));
    hatch.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: '#f5b942', 'stroke-width': 3 }));
    defs.appendChild(hatch);
    root.appendChild(defs);

    const blocks = activeBlocks(t, corr.id);
    const running = runningAt(t, corr.id);
    const held = regulatedNow(t, corr);

    // The block the cursor is on, wherever the cursor is — this is what ties
    // the string chart and the schematic together.
    const hotBlock = S.hotBlock
      ? S.proposals.filter(function (p) { return p.id === S.hotBlock; })[0]
      : null;

    /* ---------------- one lane per running line ---------------- */
    lines.forEach(function (ln, li) {
      const y = laneY(li);

      const lbl = svgEl('text', { x: 4, y: y + 3, class: 'nw-line-lbl' });
      lbl.textContent = ln.replace('_MAIN', '').replace('_LINE', '');
      root.appendChild(lbl);

      root.appendChild(svgEl('line', { x1: M.l, y1: y, x2: M.l + iw, y2: y, class: 'nw-bed' }));

      corr.sections.forEach(function (sec) {
        if (sec.lines.indexOf(ln) < 0) return;
        const a = kmOf(corr, sec.from), b = kmOf(corr, sec.to);
        const lo = Math.min(a, b), hi = Math.max(a, b);

        const blocked = blocks.some(function (p) {
          return p.lines.indexOf(ln) >= 0 && p.hiKm >= lo && p.loKm <= hi;
        });
        const occupied = !blocked && running.some(function (r) {
          return r.train.line === ln && r.pos.km >= lo - 0.4 && r.pos.km <= hi + 0.4;
        });

        // synchronised highlight: this segment is under the hovered block
        const lit = !!hotBlock && hotBlock.corridor === corr.id &&
          hotBlock.lines.indexOf(ln) >= 0 && hotBlock.hiKm >= lo && hotBlock.loKm <= hi;
        if (lit) {
          root.appendChild(svgEl('line', {
            x1: X(lo), y1: y, x2: X(hi), y2: y, class: 'nw-sync'
          }));
        }

        const seg = svgEl('line', {
          x1: X(lo), y1: y, x2: X(hi), y2: y,
          class: 'nw-track ' + (blocked ? 'blocked' : occupied ? 'occupied' : 'clear')
        });
        if (blocked) seg.setAttribute('stroke', 'url(#nw-hatch)');
        seg.addEventListener('mousemove', function (e) {
          tip(sectionTip(corr, sec, ln, blocked, occupied, running, blocks), e as MouseEvent);
        });
        seg.addEventListener('mouseleave', tipOff);
        root.appendChild(seg);
      });
    });

    /* ---------------- loop / siding lane ---------------- */
    const loopLbl = svgEl('text', { x: 4, y: loopY + 3, class: 'nw-line-lbl' });
    loopLbl.textContent = 'LOOP';
    root.appendChild(loopLbl);

    corr.stations.forEach(function (st) {
      if (!st.loop && !st.sidings.length) return;
      const x = X(st.km);
      const halfW = Math.max(9, Math.min(26, iw / (corr.stations.length * 2.4)));

      if (st.loop) {
        // loop drawn as a stub off the main line, the way a schematic shows it
        const occupiedLoop = (held[st.code] || []).length > 0;
        root.appendChild(svgEl('path', {
          d: 'M' + (x - halfW - 5) + ',' + laneY(lines.length - 1) +
             ' L' + (x - halfW) + ',' + loopY +
             ' L' + (x + halfW) + ',' + loopY +
             ' L' + (x + halfW + 5) + ',' + laneY(lines.length - 1),
          class: 'nw-loop' + (occupiedLoop ? ' held' : '')
        }));
        const csr = svgEl('text', { x: x, y: loopY - 5, class: 'nw-csr', 'text-anchor': 'middle' });
        csr.textContent = st.loopCsr + 'm';
        root.appendChild(csr);

        const hit = svgEl('rect', {
          x: x - halfW, y: loopY - 7, width: halfW * 2, height: 14,
          fill: 'transparent'
        });
        (hit as unknown as HTMLElement).style.cursor = 'pointer';
        hit.addEventListener('mousemove', function (e) {
          tip(loopTip(st, held[st.code] || []), e as MouseEvent);
        });
        hit.addEventListener('mouseleave', tipOff);
        root.appendChild(hit);

        // a rake standing in this loop while a block is in force
        (held[st.code] || []).forEach(function (_rg, i) {
          root.appendChild(svgEl('rect', {
            x: x - halfW + 2 + i * 5, y: loopY - 3.5, width: halfW * 2 - 4, height: 7,
            rx: 2, fill: CLS_COLOR.FREIGHT, stroke: '#0b1119', 'stroke-width': 0.8
          }));
        });
      }

      st.sidings.forEach(function (_sid, i) {
        root.appendChild(svgEl('line', {
          x1: x + halfW + 4 + i * 7, y1: loopY + 7,
          x2: x + halfW + 11 + i * 7, y2: loopY + 7, class: 'nw-siding'
        }));
      });
    });

    /* ---------------- stations + depots ---------------- */
    const depots = depotsOn(corr);
    const yTop = laneY(0) - laneH / 2 - 5;
    const yBot = loopY + laneH / 2 + 4;

    corr.stations.forEach(function (st) {
      const x = X(st.km);
      root.appendChild(svgEl('line', {
        x1: x, y1: yTop, x2: x, y2: yBot, stroke: '#2a3a4d', 'stroke-width': 1
      }));

      const c = svgEl('circle', {
        cx: x, cy: yTop - 6, r: 4.2, class: 'nw-stn' + (st.loop ? ' loop' : '')
      });
      c.addEventListener('mousemove', function (e) {
        tip(stationTip(st, depots[st.code]), e as MouseEvent);
      });
      c.addEventListener('mouseleave', tipOff);
      root.appendChild(c);

      const lb = svgEl('text', { x: x, y: yBot + 13, class: 'nw-stn-txt', 'text-anchor': 'middle' });
      lb.textContent = st.code;
      root.appendChild(lb);
      const km = svgEl('text', { x: x, y: yBot + 22, class: 'nw-km-txt', 'text-anchor': 'middle' });
      km.textContent = st.km.toFixed(0);
      root.appendChild(km);

      const dm = depots[st.code];
      if (dm && dm.length) {
        const fit = dm.filter(function (m) { return m.fitness === 'FIT'; }).length;
        const g = svgEl('g', { transform: 'translate(' + (x - 15) + ',' + (yBot + 26) + ')' });
        g.appendChild(svgEl('rect', { width: 30, height: 13, rx: 3, class: 'nw-depot' }));
        const dt = svgEl('text', { x: 15, y: 9.5, class: 'nw-depot-txt', 'text-anchor': 'middle' });
        dt.textContent = '⚙ ' + fit + '/' + dm.length;
        g.appendChild(dt);
        (g as unknown as HTMLElement).style.cursor = 'pointer';
        g.addEventListener('mousemove', function (e) { tip(depotTip(st, dm), e as MouseEvent); });
        g.addEventListener('mouseleave', tipOff);
        root.appendChild(g);
      }
    });

    /* ---------------- live train markers ---------------- */
    running.forEach(function (r) {
      let li = lines.indexOf(r.train.line);
      if (li < 0) li = 0;
      const y = laneY(li);
      const x = X(r.pos.km);
      const up = r.train.dir === 'UP';
      const g = svgEl('g', { class: 'nw-train' });

      // synchronised highlight: this is the path the cursor is on
      if (S.hotTrain === r.train.id) {
        g.appendChild(svgEl('circle', { cx: x, cy: y, r: 11, class: 'nw-sync-ring' }));
      }

      const pts = up
        ? [[x - 6, y - 5], [x + 7, y], [x - 6, y + 5]]
        : [[x + 6, y - 5], [x - 7, y], [x + 6, y + 5]];
      g.appendChild(svgEl('polygon', {
        points: pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' '),
        fill: CLS_COLOR[r.train.cls], class: 'nw-train-body',
        stroke: '#0b1119', 'stroke-width': 1
      }));
      if (!r.pos.moving) {
        g.appendChild(svgEl('circle', { cx: x, cy: y - 10, r: 2.4, fill: '#ff4d4f' }));
      }
      g.addEventListener('mousemove', function (e) {
        if (S.hotTrain !== r.train.id) { S.hotTrain = r.train.id; bus.emit('sync'); }
        tip(trainTip(r), e as MouseEvent);
      });
      g.addEventListener('mouseleave', function () {
        S.hotTrain = null; tipOff(); bus.emit('sync');
      });
      root.appendChild(g);
    });

    const hdr = svgEl('text', { x: M.l, y: 14, class: 'nw-km-txt' });
    hdr.textContent = corr.name + '  ·  ' + maxKm.toFixed(0) + ' km  ·  MPS ' + corr.maxSpeed +
      ' km/h  ·  ' + running.length + ' on section  ·  ' + blocks.length + ' block(s) in force';
    root.appendChild(hdr);
  }

  /* ------------------------------------------------------- tooltips */

  function sectionTip(
    corr: Corridor, sec: BlockSection, ln: string,
    blocked: boolean, occupied: boolean,
    running: RunningTrain[], blocks: LiveProposal[]
  ): string {
    const a = kmOf(corr, sec.from), b = kmOf(corr, sec.to);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const on = running.filter(function (r) {
      return r.train.line === ln && r.pos.km >= lo - 0.4 && r.pos.km <= hi + 0.4;
    });
    const blk = blocks.filter(function (p) {
      return p.lines.indexOf(ln) >= 0 && p.hiKm >= lo && p.loKm <= hi;
    });
    const state = blocked ? 'MAINTENANCE BLOCK' : occupied ? 'OCCUPIED' : 'CLEAR';
    const col = blocked ? '#f5b942' : occupied ? '#ff4d4f' : '#2ecc71';

    const rows: [string, string][] = [
      ['Block section', sec.id],
      ['Line', ln],
      ['Chainage', 'KM ' + lo.toFixed(1) + ' – ' + hi.toFixed(1) + '  (' + sec.km + ' km)']
    ];
    on.forEach(function (r) { rows.push(['On section', r.train.no + ' @ KM ' + r.pos.km.toFixed(1)]); });
    blk.forEach(function (p) {
      rows.push(['Block in force', p.id + '  ' + hhmm(p.start) + '–' + hhmm(p.end)]);
    });

    return '<div class="tt-h"><span class="swatch" style="background:' + col + '"></span>' +
      esc(sec.from) + ' – ' + esc(sec.to) + ' · ' + state + '</div>' + tipRows(rows);
  }

  function loopTip(st: Station, held: Regulation[]): string {
    const rows: [string, string][] = [
      ['Clear standing room', st.loopCsr + ' m'],
      ['Platforms', String(st.platforms)],
      ['Sidings', st.sidings.length ? st.sidings.join(', ') : '—']
    ];
    if (held.length) {
      held.forEach(function (h) {
        rows.push(['Holding', h.rake + '  (' + h.lengthM + ' m)']);
      });
    } else {
      rows.push(['Status', 'Empty']);
    }
    // What this loop can and cannot take, which is the regulation decision.
    const takes = D.trains.filter(function (t) {
      return t.kind === 'FREIGHT' && t.corridor === S.corridor &&
        (t.lengthM || 0) + 30 <= st.loopCsr;
    }).length;
    const total = D.trains.filter(function (t) {
      return t.kind === 'FREIGHT' && t.corridor === S.corridor;
    }).length;
    rows.push(['Takes', takes + ' of ' + total + ' rakes on this corridor']);

    return '<div class="tt-h"><span class="swatch" style="background:#29d3d9"></span>' +
      esc(st.code) + ' Loop Line</div>' + tipRows(rows);
  }

  function stationTip(st: Station, dm: Machine[] | undefined): string {
    const rows: [string, string][] = [
      ['Chainage', 'KM ' + st.km.toFixed(1)],
      ['Platforms', String(st.platforms)],
      ['Platform loop', st.loop ? 'Yes · CSR ' + st.loopCsr + ' m' : 'No'],
      ['Crossovers', st.crossovers.length ? st.crossovers.join(', ') : '—'],
      ['Sidings', st.sidings.length ? st.sidings.join(', ') : '—']
    ];
    if (dm && dm.length) rows.push(['Machines stabled', String(dm.length)]);
    return '<div class="tt-h">' + esc(st.code) + ' · ' + esc(st.name) + '</div>' + tipRows(rows);
  }

  function depotTip(st: Station, dm: Machine[]): string {
    const rows: [string, string][] = dm.map(function (m) {
      return [m.id + ' (' + m.type + ')',
        m.fitness + ' · crew ' + m.dutyHours.toFixed(1) + '/' + m.maxHours + ' h'] as [string, string];
    });
    rows.push(['HSD fuel', dm.map(function (m) { return Math.round(m.fuel) + ' L'; }).join(' · ')]);
    return '<div class="tt-h"><span class="swatch" style="background:#a78bfa"></span>' +
      esc(st.code) + ' Machine Depot</div>' + tipRows(rows);
  }

  function trainTip(r: RunningTrain): string {
    const tr = r.train;
    const rows: [string, string][] = [
      ['Type', tr.kind === 'FREIGHT' ? 'Freight · ' + tr.name : tr.name],
      ['Line / direction', tr.line + ' · ' + tr.dir],
      ['Position', 'KM ' + r.pos.km.toFixed(2)],
      ['Speed', r.pos.speed.toFixed(0) + ' km/h' + (r.pos.moving ? '' : '  (standing)')],
      ['MPS', tr.mps + ' km/h']
    ];
    if (tr.kind === 'PASSENGER') {
      rows.push(['Delay', tr.delay > 0 ? tr.delay + ' min late' : 'Right time']);
    } else {
      rows.push(['Load', tr.wagons + ' wagons · ' + tr.tonnage + ' t']);
      rows.push(['Rake length', tr.lengthM + ' m']);
      rows.push(['Loopable', tr.canLoop ? 'Yes' : 'No — through path needed']);
    }
    return '<div class="tt-h"><span class="swatch" style="background:' + CLS_COLOR[tr.cls] +
      '"></span>' + esc(tr.no) + '</div>' + tipRows(rows);
  }

  /* ------------------------------------------------------- corridor tabs */

  export function bindTabs(): void {
    const box = byId('corr-tabs');
    if (!box) return;
    clear(box);

    D.corridors.forEach(function (c) {
      const label = (SECTOR[c.id] || shortCorr(c.id)) + ' · ' +
        c.stations[0].code + '–' + c.stations[c.stations.length - 1].code;
      const b = el('button', c.id === S.corridor ? 'on' : '', label);
      b.dataset.c = c.id;
      b.addEventListener('click', function () {
        S.corridor = c.id;
        S.selDemand = null;
        Array.prototype.forEach.call(box.children, function (n: HTMLElement) {
          n.classList.toggle('on', n.dataset.c === c.id);
        });
        bus.emit('corridor');
      });
      box.appendChild(b);
    });
  }
}
