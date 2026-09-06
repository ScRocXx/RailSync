/// <reference path="core.ts" />

/* ============================================================
   (iv) Block Approval & Recommendation Drawer

   The action centre. Beyond the work permit it answers the four questions a
   Section Controller actually asks before granting a possession:

     how much of this window is real work?      (work vs granted window)
     what does bundling buy me?                 (joint savings callout)
     what happens if the gang overruns?         (burst-buffer projection)
     what does the line cost me afterwards?     (post-work TSR)

   Approving issues a formal control order with Private Numbers; refusing
   demands a structured reason code.
   ============================================================ */

namespace RailSync.Drawer {

  let shiftDelta = 0;        // minutes, while the controller drags the slider
  let rejectMode = false;

  function find(id: string | null): LiveProposal | undefined {
    return S.proposals.filter(function (p) { return p.id === id; })[0];
  }

  export function open(id: string): void {
    S.selProposal = id;
    shiftDelta = 0;
    rejectMode = false;
    S.overrunMin = 0;
    const dw = byId('drawer');
    if (dw) dw.classList.add('on');
    render();
    bus.emit('render');
  }

  export function close(): void {
    S.selProposal = null;
    const dw = byId('drawer');
    if (dw) dw.classList.remove('on');
    bus.emit('render');
  }

  /* ------------------------------------------------------- building blocks */

  function sec(title: string, node: HTMLElement): HTMLElement {
    const s = el('div', 'dw-sec');
    s.appendChild(el('h3', null, title));
    s.appendChild(node);
    return s;
  }

  function kv(pairs: [string, string | null | undefined][]): HTMLElement {
    const d = el('dl', 'kv');
    pairs.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || p[1] === '') return;
      d.appendChild(el('dt', null, p[0]));
      d.appendChild(el('dd', null, p[1]));
    });
    return d;
  }

  function impactTile(v: string | number, k: string, cls?: string): HTMLElement {
    const d = el('div', 'impact ' + (cls || ''));
    d.appendChild(el('div', 'i-v', String(v)));
    d.appendChild(el('div', 'i-k', k));
    return d;
  }

  function taskCard(i: ProposalItem | Demand, isShadow: boolean): HTMLElement {
    const c = el('div', 'card');
    const h = el('div', 'card-h');
    h.appendChild(el('span', 'dept-tag dept-' + i.dept, i.dept));
    h.appendChild(el('b', null, i.id));
    const sp = el('span', 'chip ' +
      (i.band === 'CRITICAL' ? 'crit' : i.band === 'URGENT' ? 'urg' : 'rout'),
      i.score !== undefined ? i.score.toFixed(0) : '—');
    sp.style.marginLeft = 'auto';
    h.appendChild(sp);
    c.appendChild(h);

    c.appendChild(el('div', 'card-m',
      i.action.replace(/_/g, ' ') + '  ·  ' + i.chainage + '  ·  ' + i.telemetry +
      '  ·  ' + (i.overdueDays || 0) + 'd overdue'));

    // the physical drivers, inline — same "why this score" the queue shows
    if (i.drivers && i.drivers.length) {
      const dv = el('div', 'drv-row');
      i.drivers.filter(function (d) { return d.pts > 0; }).forEach(function (d) {
        const chip = el('span', 'drv pt-' + d.part);
        chip.appendChild(el('span', 'drv-k', d.k));
        chip.appendChild(el('span', 'drv-v', d.v));
        chip.appendChild(el('span', 'drv-p', '+' + d.pts.toFixed(0)));
        dv.appendChild(chip);
      });
      c.appendChild(dv);
    }

    if (isShadow) {
      const b = el('div', 'card-m', 'Bundled by controller (shadow suggestion)');
      b.style.color = 'var(--violet)';
      c.appendChild(b);
    }
    return c;
  }

  function mergeImpact(p: LiveProposal, fresh: WindowScore): Impact {
    return {
      paxDelayMin: fresh.paxDelayMin,
      paxAffected: fresh.paxAffected,
      freightLooped: fresh.freightLooped,
      freightIds: fresh.freightIds,
      conflictTrains: fresh.conflictTrains,
      backlogCleared: p.items.length + p.added.length,
      scoreReleased: p.impact.scoreReleased,
      overdueDaysCleared: p.impact.overdueDaysCleared
    };
  }

  /* ------------------------------------------------------- render */

  export function render(): void {
    const p = find(S.selProposal);
    const bd = byId('dw-bd');
    const ft = byId('dw-ft');
    if (!bd || !ft) return;
    if (!p) { clear(bd); clear(ft); return; }

    const dur = totalDuration(p);
    const start = p.start + shiftDelta;
    const im: Impact | WindowScore = shiftDelta ? scoreWindow(p, start, dur) : p.impact;

    const idEl = byId('dw-id');
    if (idEl) idEl.textContent = p.id;
    const st = byId('dw-status');
    if (st) {
      st.textContent = p.status;
      st.className = 'chip ' + (p.status === 'APPROVED' ? 'rout' : p.status === 'REJECTED' ? '' : 'urg');
    }
    const subEl = byId('dw-sub');
    if (subEl) subEl.textContent = p.corridorName + '  ·  ' + p.section + '  ·  ' + p.line;

    clear(bd);

    /* ---- 1. work time vs granted window ---- */
    bd.appendChild(sec('Block Window', windowBreakdown(p, dur, start)));

    /* ---- 2. block summary ---- */
    bd.appendChild(sec('Block Summary', kv([
      ['Chainage', 'KM ' + p.loKm.toFixed(2) + ' – ' + p.hiKm.toFixed(2)],
      ['Lines occupied', p.lines.join(' + ')],
      ['Traffic block type', p.machines.length ? 'Corridor block with plant' : 'Manual gang possession'],
      ['Required isolation', p.isolation || '—'],
      ['Isolators to open', p.isolators && p.isolators.length ? p.isolators.join(', ') : '—'],
      ['Disconnection memo', p.memo || '—'],
      ['Interlocked routes', p.routes && p.routes.length ? p.routes.join(', ') : '—']
    ])));

    /* ---- 3. bundled tasks + joint savings ---- */
    const tasks = el('div');
    if (p.savings.savedMin > 0) {
      const cal = el('div', 'callout');
      cal.appendChild(el('div', 'callout-v', '−' + p.savings.savedMin + ' min'));
      cal.appendChild(el('div', 'callout-t',
        'Bundling ' + p.savings.depts.join(' + ') + ' into one possession saves ' +
        p.savings.savedMin + ' minutes of independent line possession (' +
        p.savings.independentMin + ' min as ' + p.savings.tasks +
        ' separate blocks vs ' + p.savings.bundledMin + ' min bundled) — ' +
        'protection, isolation and traffic cost are paid once.'));
      tasks.appendChild(cal);
    }
    p.items.forEach(function (i) { tasks.appendChild(taskCard(i, false)); });
    p.added.forEach(function (a) {
      const q = D.queue.filter(function (x) { return x.id === a.id; })[0];
      if (q) tasks.appendChild(taskCard(q, true));
    });
    bd.appendChild(sec('Bundled Tasks (' + (p.items.length + p.added.length) + ')', tasks));

    /* ---- 4. plant + crew HOER red line ---- */
    bd.appendChild(sec('Allocated Machines', machineList(p, dur)));

    /* ---- 5. impact metrics ---- */
    bd.appendChild(sec('Impact Metrics', impactBlock(p, im, start, dur)));

    /* ---- 6. freight regulation into loops ---- */
    if (p.regulation.length) {
      bd.appendChild(sec('Freight Regulation', regulationList(p)));
    }

    /* ---- 7. overrun burst buffer ---- */
    bd.appendChild(sec('Overrun Risk (Burst Buffer)', overrunControl(p, start, dur)));

    /* ---- 8. post-work speed restriction ---- */
    if (p.postTsr) bd.appendChild(sec('Post-Work Speed Restriction', postTsrBlock(p)));

    /* ---- 9. shift time slot ---- */
    bd.appendChild(sec('Shift Time Slot', shiftControl(p, dur, start, im)));

    /* ---- 10. shadow bundling ---- */
    if (p.shadow && p.shadow.length) {
      bd.appendChild(sec('Shadow Bundling Suggestions', shadowList(p)));
    }

    /* ---- 11. the issued control order ---- */
    if (p.order) bd.appendChild(sec('Control Order Issued', orderBlock(p)));

    /* ---- 12. why it was refused ---- */
    if (p.status === 'REJECTED' && p.rejectedFor) {
      const r = el('div');
      const c = el('div', 'card');
      const h = el('div', 'card-h');
      h.appendChild(el('span', 'chip crit', p.rejectedFor.code));
      h.appendChild(el('b', null, p.rejectedFor.label));
      c.appendChild(h);
      c.appendChild(el('div', 'card-m', p.rejectedFor.detail));
      r.appendChild(c);
      bd.appendChild(sec('Rejection Reason', r));
    }

    renderFooter(p, im, start, dur, ft);
  }

  /* ---------------------------------------- work vs granted window */

  function windowBreakdown(p: LiveProposal, dur: number, start: number): HTMLElement {
    const w = p.window;
    const wrap = el('div');

    const head = el('div', 'win-head');
    const a = el('div');
    a.appendChild(el('div', 'win-k', 'Total block window'));
    a.appendChild(el('div', 'win-v', hhmm(start) + ' – ' + hhmm(start + dur)));
    a.appendChild(el('div', 'win-s', dur + ' min granted'));
    head.appendChild(a);
    const b = el('div');
    b.appendChild(el('div', 'win-k', 'Physical work time'));
    const wv = el('div', 'win-v', w.workMin + ' min');
    wv.style.color = 'var(--green)';
    b.appendChild(wv);
    b.appendChild(el('div', 'win-s', (dur - w.workMin) + ' min overheads'));
    head.appendChild(b);
    wrap.appendChild(head);

    // stacked bar: protection / earthing / ramp / work / ramp / earthing / protection
    const bar = el('div', 'win-bar');
    const segs: [number, string, string][] = [];
    if (w.protectionMin) segs.push([w.protectionMin / 2, 'seg-prot', 'Protection set ' + (w.protectionMin / 2) + ' min']);
    if (w.earthingMin) segs.push([w.earthingMin / 2, 'seg-earth', 'OHE earthing ' + (w.earthingMin / 2) + ' min']);
    if (w.rampMin) segs.push([w.rampMin / 2, 'seg-ramp', 'Machine ramp in ' + (w.rampMin / 2) + ' min']);
    segs.push([w.workMin, 'seg-work', 'Physical work ' + w.workMin + ' min']);
    if (w.rampMin) segs.push([w.rampMin / 2, 'seg-ramp', 'Machine ramp out ' + (w.rampMin / 2) + ' min']);
    if (w.earthingMin) segs.push([w.earthingMin / 2, 'seg-earth', 'OHE de-earthing ' + (w.earthingMin / 2) + ' min']);
    if (w.protectionMin) segs.push([w.protectionMin / 2, 'seg-prot', 'Protection withdrawn ' + (w.protectionMin / 2) + ' min']);

    segs.forEach(function (sg) {
      const n = el('i', sg[1]);
      n.style.width = (100 * sg[0] / dur) + '%';
      n.title = sg[2];
      bar.appendChild(n);
    });
    wrap.appendChild(bar);

    const key = el('div', 'win-key');
    [['seg-prot', 'Protection'], ['seg-earth', 'Earthing'],
     ['seg-ramp', 'Ramp'], ['seg-work', 'Work']].forEach(function (k) {
      if (k[0] === 'seg-earth' && !w.earthingMin) return;
      if (k[0] === 'seg-ramp' && !w.rampMin) return;
      const i = el('i');
      i.appendChild(el('b', k[0]));
      i.appendChild(document.createTextNode(k[1]));
      key.appendChild(i);
    });
    wrap.appendChild(key);
    return wrap;
  }

  /* ---------------------------------------- plant + crew HOER */

  function machineList(p: LiveProposal, dur: number): HTMLElement {
    const mc = el('div');

    if (p.machines.length) {
      p.machines.forEach(function (m) {
        const c = el('div', 'card');
        const h = el('div', 'card-h');
        h.appendChild(el('b', null, m.id + '  ·  ' + m.model));
        h.appendChild(el('span', 'chip', m.type));
        c.appendChild(h);

        // HOER red line badge — the headline a controller scans for
        const safe = !m.crewRelief;
        const badge = el('div', 'hoer' + (safe ? ' ok' : ' bad'));
        badge.appendChild(el('span', 'hoer-k', 'Crew duty remaining'));
        badge.appendChild(el('span', 'hoer-v', fmtHours(m.crewRemainingHours)));
        badge.appendChild(el('span', 'hoer-s',
          safe ? 'Safe for this ' + dur + ' min block'
               : 'SHORT for this ' + dur + ' min block — crew change required'));
        c.appendChild(badge);

        c.appendChild(kv([
          ['Stabled at', m.from + (m.siding ? ' · ' + m.siding : '')],
          ['Base depot', m.depot],
          ['Transit to site', m.transitMin + ' min'],
          ['Ramp in / out', m.rampIn + ' / ' + m.rampOut + ' min'],
          ['Report by', m.reportBy],
          ['Engaged', m.engagedHours + ' h siding to siding'],
          ['Crew', m.crew + '  (' + m.dutyHours.toFixed(1) + '/' + m.maxHours + ' h worked)'],
          ['HSD fuel', Math.round(m.fuel) + ' L'],
          ['Task', m.task.replace(/_/g, ' ')]
        ]));
        mc.appendChild(c);
      });
    } else if (!p.plantShortfall || !p.plantShortfall.length) {
      mc.appendChild(el('div', 'mini-note',
        'No track machine required — manual gang / S&T staff possession.'));
    }

    if (p.plantShortfall && p.plantShortfall.length) {
      const counts: Record<string, number> = {};
      p.plantShortfall.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      const list = Object.keys(counts).map(function (t) { return counts[t] + '× ' + t; }).join(', ');
      const n = el('div', 'mini-note',
        'Plant shortfall: ' + list + ' could not be sourced for this window — no fit machine of ' +
        'that type is free. Shift the slot, split the work, or run the balance as a manual gang.');
      n.style.color = 'var(--amber)';
      mc.appendChild(n);
    }
    return mc;
  }

  function fmtHours(h: number): string {
    const m = Math.round(h * 60);
    return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
  }

  /* ---------------------------------------- impact */

  function impactBlock(p: LiveProposal, im: Impact | WindowScore,
                       start: number, dur: number): HTMLElement {
    const grid = el('div', 'impact-grid');
    grid.appendChild(impactTile(im.paxDelayMin, 'Train delay induced (min)',
      im.paxDelayMin === 0 ? 'ok' : 'warn'));
    grid.appendChild(impactTile(im.freightLooped, 'Freight regulated to loops',
      im.freightLooped ? 'warn' : 'ok'));
    grid.appendChild(impactTile(p.items.length + p.added.length, 'Backlog demands cleared', 'ok'));
    grid.appendChild(impactTile(p.impact.overdueDaysCleared, 'Overdue-days retired', 'ok'));

    const wrap = el('div');
    wrap.appendChild(grid);
    if (im.paxDelayMin === 0) {
      wrap.appendChild(el('div', 'mini-note',
        'Window verified clear: no booked path on ' + p.lines.join('/') + ' crosses KM ' +
        p.loKm.toFixed(1) + '–' + p.hiKm.toFixed(1) + ' between ' +
        hhmm(start) + ' and ' + hhmm(start + dur) + '.'));
    } else {
      wrap.appendChild(el('div', 'mini-note', 'Conflicting paths: ' +
        im.conflictTrains.map(function (t) { return t.no; }).join(', ')));
    }
    return wrap;
  }

  /* ---------------------------------------- freight regulation */

  function regulationList(p: LiveProposal): HTMLElement {
    const wrap = el('div');
    p.regulation.forEach(function (rg) {
      const c = el('div', 'card');
      const h = el('div', 'card-h');
      h.appendChild(el('b', null, rg.rake));
      h.appendChild(el('span', 'chip ' + (rg.fits ? 'rout' : 'crit'),
        rg.fits ? rg.loop + ' loop' : 'NO LOOP'));
      c.appendChild(h);
      c.appendChild(el('div', 'card-m', rg.fits
        ? 'Rake ' + rg.lengthM + ' m stands in ' + rg.loop + ' loop (CSR ' +
          rg.loopCsr + ' m) — ' + Math.round((rg.loopCsr || 0) - (rg.lengthM || 0)) +
          ' m clearance including overlap.'
        : 'Rake ' + rg.lengthM + ' m exceeds the clear standing room of every loop on ' +
          'this corridor; it would have to stand on the running line.'));
      wrap.appendChild(c);
    });
    wrap.appendChild(el('div', 'mini-note',
      'A loop only counts if its clear standing room takes the rake plus signal overlap.'));
    return wrap;
  }

  /* ---------------------------------------- overrun burst buffer */

  function overrunControl(p: LiveProposal, start: number, dur: number): HTMLElement {
    const wrap = el('div');
    const row = el('div', 'seg');
    row.style.marginBottom = '8px';
    ([[0, 'On time'], [15, '+15 min'], [30, '+30 min']] as [number, string][])
      .forEach(function (o) {
        const b = el('button', S.overrunMin === o[0] ? 'on' : '', o[1]);
        b.addEventListener('click', function () {
          S.overrunMin = o[0];
          render();
        });
        row.appendChild(b);
      });
    wrap.appendChild(row);

    if (S.overrunMin === 0) {
      wrap.appendChild(el('div', 'mini-note',
        'Machines fail and gangs take longer to pack up; a block routinely spills past ' +
        'its booked hand-back. Simulate an overrun to see which paths take the knock-on.'));
      return wrap;
    }

    const proj = projectOverrun(p, start, dur, S.overrunMin);
    const grid = el('div', 'impact-grid');
    grid.appendChild(impactTile(proj.trains.length, 'Trains taking knock-on',
      proj.trains.length ? 'warn' : 'ok'));
    grid.appendChild(impactTile(proj.totalDelayMin, 'Cascade delay (min)',
      proj.totalDelayMin ? 'warn' : 'ok'));
    wrap.appendChild(grid);

    if (!proj.trains.length) {
      const n = el('div', 'mini-note',
        'Hand-back at ' + hhmm(start + dur + S.overrunMin) + ' still clears every booked path — ' +
        'this window carries a ' + S.overrunMin + ' minute buffer.');
      n.style.color = 'var(--green)';
      wrap.appendChild(n);
    } else {
      proj.trains.slice(0, 5).forEach(function (t) {
        const c = el('div', 'card');
        const h = el('div', 'card-h');
        h.appendChild(el('span', 'swatch'));
        (h.firstChild as HTMLElement).style.background = CLS_COLOR[t.cls];
        h.appendChild(el('b', null, t.no + ' · ' + t.name));
        const chip = el('span', 'chip crit', '+' + t.delayMin + ' min');
        chip.style.marginLeft = 'auto';
        h.appendChild(chip);
        c.appendChild(h);
        wrap.appendChild(c);
      });
      const n = el('div', 'mini-note',
        'If the gang hands back ' + S.overrunMin + ' min late (' +
        hhmm(start + dur + S.overrunMin) + '), ' + proj.trains.length +
        ' path(s) are held, worst case +' + proj.worst + ' min.');
      n.style.color = 'var(--red)';
      wrap.appendChild(n);
    }
    return wrap;
  }

  /* ---------------------------------------- post-work TSR */

  function postTsrBlock(p: LiveProposal): HTMLElement {
    const t = p.postTsr!;
    const wrap = el('div');
    const cal = el('div', 'callout warn');
    cal.appendChild(el('div', 'callout-v', t.speed + ' km/h'));
    cal.appendChild(el('div', 'callout-t',
      'Post-work TSR: ' + t.speed + ' km/h over ' + t.lengthKm + ' km for ' + t.hours +
      ' h while the bed consolidates (normal ' + t.normalSpeed + ' km/h) ⟹ adds +' +
      t.addedMinPerTrain + ' min runtime per train' +
      (t.peakTrains
        ? ', ' + t.peakTrains + ' morning-peak paths affected, +' +
          t.totalAddedMin + ' min total on tomorrow’s peak.'
        : '. No morning-peak path runs this chainage on these lines.')));
    wrap.appendChild(cal);
    return wrap;
  }

  /* ---------------------------------------- control order */

  function orderBlock(p: LiveProposal): HTMLElement {
    const o = p.order!;
    const wrap = el('div');

    const pn = el('div', 'pn-row');
    const a = el('div', 'pn');
    a.appendChild(el('span', 'pn-k', 'Private Number — SM'));
    a.appendChild(el('span', 'pn-v', String(o.pnSm)));
    pn.appendChild(a);
    if (o.pnTpc !== null) {
      const b = el('div', 'pn');
      b.appendChild(el('span', 'pn-k', 'Private Number — TPC'));
      b.appendChild(el('span', 'pn-v', String(o.pnTpc)));
      pn.appendChild(b);
    }
    wrap.appendChild(pn);

    const pre = el('pre', 'memo');
    pre.textContent = o.text;
    wrap.appendChild(pre);

    const copy = el('button', 'btn btn-sh', 'Copy control order');
    copy.addEventListener('click', function () {
      const ta = el('textarea');
      ta.value = o.text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Control order copied to clipboard'); }
      catch (e) { toast('Select the memo text to copy', 'warn'); }
      document.body.removeChild(ta);
    });
    copy.style.marginTop = '7px';
    wrap.appendChild(copy);
    return wrap;
  }

  /* ---------------------------------------- shift slot */

  function shiftControl(p: LiveProposal, dur: number, start: number,
                        im: Impact | WindowScore): HTMLElement {
    const sh = el('div');
    const row = el('div', 'shift-row');
    const minus = el('button', 'f-btn', '−15');
    const rng = el('input');
    rng.type = 'range';
    rng.min = '-240'; rng.max = '240'; rng.step = '5';
    rng.value = String(shiftDelta);
    const plus = el('button', 'f-btn', '+15');
    const out = el('span', 'mono', (shiftDelta >= 0 ? '+' : '') + shiftDelta + ' min');
    out.style.cssText = 'width:74px;text-align:right;font-size:11.5px';

    function apply(v: number): void {
      shiftDelta = Math.max(-240, Math.min(240, v));
      if (p.start + shiftDelta < 0) shiftDelta = -p.start;
      if (p.start + shiftDelta + dur > DAY) shiftDelta = DAY - dur - p.start;
      render();
    }
    minus.addEventListener('click', function () { apply(shiftDelta - 15); });
    plus.addEventListener('click', function () { apply(shiftDelta + 15); });
    rng.addEventListener('input', function () { apply(+rng.value); });

    row.appendChild(minus); row.appendChild(rng); row.appendChild(plus); row.appendChild(out);
    sh.appendChild(row);

    const note = el('div', 'recalc');
    if (shiftDelta === 0) {
      note.textContent = 'AI-optimised slot. Drag to test an alternative window — impact re-scores live.';
    } else {
      const base = p.impact.paxDelayMin;
      const verdict = im.paxDelayMin === base ? 'same traffic cost as the AI slot'
        : im.paxDelayMin < base ? 'better than the AI slot'
        : 'worse — ' + (im.paxDelayMin - base) + ' min more delay than the AI slot';
      note.textContent = 'Shifted to ' + hhmm(start) + '–' + hhmm(start + dur) + ': ' + verdict + '.';
      note.style.color = im.paxDelayMin > base ? 'var(--red)' : 'var(--green)';
    }
    sh.appendChild(note);
    return sh;
  }

  /* ---------------------------------------- shadow bundling */

  function shadowList(p: LiveProposal): HTMLElement {
    const shd = el('div');
    p.shadow.forEach(function (s) {
      const added = p.added.some(function (a) { return a.id === s.id; });
      const it = el('div', 'shadow-item' + (added ? ' added' : ''));

      const g = el('div', 'grow');
      const t1 = el('div', 'log-t');
      t1.appendChild(el('b', null, s.id));
      g.appendChild(t1);
      g.appendChild(el('div', 'log-m',
        s.action.replace(/_/g, ' ') + ' · ' + s.chainage + ' · ' + s.gapKm + ' km away'));
      g.appendChild(el('div', 'log-m', s.note));
      it.appendChild(g);

      const btn = el('button', 'add', added ? 'Added' : '+ Bundle');
      btn.disabled = p.status !== 'PENDING';
      btn.addEventListener('click', function () {
        if (added) {
          p.added = p.added.filter(function (a) { return a.id !== s.id; });
          logEvent('bundle', p.id + ' — shadow task removed',
            s.id + ' dropped from the possession.', p.id);
        } else {
          p.added.push(s);
          logEvent('bundle', p.id + ' — shadow task bundled',
            s.id + ' folded into the same possession (+' + s.addMin +
            ' min, no extra protection).', p.id);
        }
        p.impact = mergeImpact(p, scoreWindow(p, p.start, totalDuration(p)));
        render();
        bus.emit('render');
      });
      it.appendChild(btn);
      shd.appendChild(it);
    });

    shd.appendChild(el('div', 'mini-note',
      'Shadow bundling folds nearby pending work into a possession that is already being taken — ' +
      'the protection, isolation and traffic cost are paid once.'));
    return shd;
  }

  /* ---------------------------------------- footer / decisions */

  function renderFooter(p: LiveProposal, im: Impact | WindowScore,
                        start: number, dur: number, ft: HTMLElement): void {
    clear(ft);

    if (p.status !== 'PENDING') {
      const reopen = el('button', 'btn', 'Reopen as Pending');
      reopen.addEventListener('click', function () {
        p.status = 'PENDING';
        delete p.rejectedFor;
        logEvent('reopen', p.id + ' reopened',
          'Returned to the pending queue for re-evaluation.', p.id);
        render();
        bus.emit('render');
      });
      ft.appendChild(reopen);
      return;
    }

    if (rejectMode) {
      // A block cannot be refused without an operational justification.
      const box = el('div', 'reason-box');
      box.appendChild(el('div', 'reason-h', 'Select a reason code — required for the register'));
      p.reasons.forEach(function (rc) {
        const b = el('button', 'reason');
        b.appendChild(el('span', 'chip crit', rc.code));
        const g = el('div', 'grow');
        g.appendChild(el('div', 'reason-l', rc.label));
        g.appendChild(el('div', 'reason-d', rc.detail));
        b.appendChild(g);
        b.addEventListener('click', function () { doReject(p, rc); });
        box.appendChild(b);
      });
      const cancel = el('button', 'btn', 'Cancel');
      cancel.addEventListener('click', function () { rejectMode = false; render(); });
      box.appendChild(cancel);
      ft.appendChild(box);
      ft.classList.add('tall');
      return;
    }

    ft.classList.remove('tall');
    const ok = el('button', 'btn btn-ok',
      shiftDelta ? 'Approve Shifted + Issue Order' : 'Approve + Issue Order');
    ok.addEventListener('click', function () { doApprove(p, im, start, dur); });
    const no = el('button', 'btn btn-no', 'Reject / Defer');
    no.addEventListener('click', function () { rejectMode = true; render(); });
    ft.appendChild(ok);
    ft.appendChild(no);
    if (shiftDelta) {
      const rs = el('button', 'btn btn-sh', 'Reset');
      rs.addEventListener('click', function () { shiftDelta = 0; render(); });
      ft.appendChild(rs);
    }
  }

  function doApprove(p: LiveProposal, im: Impact | WindowScore,
                     start: number, dur: number): void {
    if (shiftDelta) {
      p.start = start;
      logEvent('shift', p.id + ' slot shifted',
        'Moved ' + (shiftDelta > 0 ? '+' : '') + shiftDelta + ' min to ' +
        hhmm(start) + '–' + hhmm(start + dur) + '.', p.id);
    }
    p.end = p.start + dur;
    p.impact = mergeImpact(p, im as WindowScore);
    p.status = 'APPROVED';
    p.order = issueOrder(p, p.start, dur);
    shiftDelta = 0;

    logEvent('approve', p.id + ' approved — PN ' + p.order.pnSm +
      (p.order.pnTpc !== null ? '/' + p.order.pnTpc : ''),
      p.section + ' · ' + p.lines.join('+') + ' · ' + hhmm(p.start) + '–' + hhmm(p.end) +
      ' (' + dur + ' min window, ' + p.window.workMin + ' min work) · ' +
      (p.items.length + p.added.length) + ' task(s) cleared · ' +
      im.paxDelayMin + ' min train delay induced · ' +
      im.freightLooped + ' rake(s) regulated into loops' +
      (p.postTsr ? ' · post-work TSR ' + p.postTsr.speed + ' km/h for ' + p.postTsr.hours + ' h' : '') +
      '.', p.id);
    toast('Block ' + p.id + ' approved — Private Number ' + p.order.pnSm);

    render();
    bus.emit('render');
  }

  function doReject(p: LiveProposal, rc: ReasonCode): void {
    p.status = 'REJECTED';
    p.rejectedFor = rc;
    rejectMode = false;
    const cleared = p.items.length + p.added.length;
    const worst = p.items.reduce(function (a: ProposalItem | null, b) {
      return (a && a.score > b.score) ? a : b;
    }, null);

    logEvent('reject', p.id + ' rejected — [' + rc.code + '] ' + rc.label,
      rc.detail + ' Deferred: ' + cleared + ' demand(s) returned to the backlog, ' +
      p.impact.overdueDaysCleared + ' overdue-days remain outstanding. ' +
      'Highest exposure left open: ' +
      (worst ? worst.id + ' (urgency ' + worst.score.toFixed(0) + ', ' +
        worst.overdueDays + 'd overdue)' : '—') +
      '. Section ' + p.section + ' · ' + p.line + '.', p.id);
    toast('Block ' + p.id + ' refused — ' + rc.code, 'bad');

    render();
    bus.emit('render');
  }

  /* ------------------------------------------------------- wiring */

  export function bind(): void {
    const c = byId('dw-close');
    if (c) c.addEventListener('click', close);
    bus.on('openProposal', function (id: string) { open(id); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.selProposal) close();
    });
  }
}
