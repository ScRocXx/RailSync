/// <reference path="core.ts" />
/// <reference path="marey.ts" />
/// <reference path="network.ts" />
/// <reference path="queue.ts" />
/// <reference path="drawer.ts" />
/// <reference path="analytics.ts" />
/// <reference path="fleet.ts" />

/* ============================================================
   Bootstrap — the division health ribbon, clock controls,
   view switching, and the render fan-out.
   ============================================================ */

namespace RailSync.App {

  type ViewName = 'ops' | 'reports' | 'logs';
  let view: ViewName = 'ops';

  function setText(id: string, txt: string): void {
    const n = byId(id);
    if (n) n.textContent = txt;
  }

  /* ------------------------------------------------------- banner */

  function renderBanner(): void {
    const m = D.metrics;

    setText('brand-div', D.meta.division + ' Division · ' + D.meta.zone);

    const pu = m.punctuality;
    setText('s-punct', pu.toFixed(1) + '%');
    const pn = byId('s-punct');
    if (pn) pn.className = 'stat-v ' + (pu >= 90 ? 'v-good' : pu >= 75 ? 'v-warn' : 'v-bad');
    setText('s-punct-sub', m.trainsOnTime + '/' + m.trainsRun + ' RT · avg ' + m.avgDelay + ' min');

    setText('s-clock', hhmm(S.clock));

    const t = railTemp(S.clock, S.corridor);
    if (t) {
      const over = t.rail - t.dest;
      setText('s-temp', t.rail.toFixed(1) + '° / ' + t.dest.toFixed(0) + '°');
      const tn = byId('s-temp');
      if (tn) tn.className = 'stat-v ' + (t.rail > t.max ? 'v-bad' : over > 0 ? 'v-warn' : 'v-good');
      setText('s-temp-sub', 'amb ' + t.amb + '° · ' + t.probe + ' · ' +
        (t.safeTamp ? 'tamping OK' : 'OUTSIDE ENVELOPE') + (t.buckle ? ' · BUCKLE' : ''));
      const chip = byId('tsr-chip');
      if (chip) {
        chip.onmousemove = function (e) { tip(tsrTip(), e as MouseEvent); };
        chip.onmouseleave = tipOff;
      }
    }

    const run = runningAt(S.clock, null);
    const pax = run.filter(function (r) { return r.train.kind === 'PASSENGER'; }).length;
    setText('s-running', String(run.length));
    setText('s-running-sub', pax + ' pax · ' + (run.length - pax) + ' freight');

    const approved = S.proposals.filter(function (p) { return p.status === 'APPROVED'; });
    const cleared = approved.reduce(function (a, p) { return a + p.items.length + p.added.length; }, 0);
    const crit = D.queue.filter(function (q) { return q.band === 'CRITICAL'; }).length;
    setText('s-backlog', String(D.queue.length - cleared));
    setText('s-backlog-sub', crit + ' critical · ' + cleared + ' cleared');

    const induced = approved.reduce(function (a, p) { return a + p.impact.paxDelayMin; }, 0);
    setText('s-approved', approved.length + '/' + S.proposals.length);
    setText('s-approved-sub', induced + ' min delay induced');

    setText('s-tsr', String(D.tsr.length));
  }

  /** The active caution orders, readable without leaving the board. */
  function tsrTip(): string {
    const rows: [string, string][] = D.tsr.slice(0, 8).map(function (t) {
      return [t.no + '  ' + shortCorr(t.corridor),
        t.from + '–' + t.to + ' · ' + t.speed + '/' + t.normal + ' km/h · ' +
        t.reason] as [string, string];
    });
    return '<div class="tt-h"><span class="swatch" style="background:#ff4d4f"></span>' +
      D.tsr.length + ' caution orders in force</div>' + tipRows(rows) +
      '<div class="tt-r" style="margin-top:6px;color:#7c8da0"><span>Click for the full register</span></div>';
  }

  /* ------------------------------------------------------- workspace */

  function bindWorkspace(): void {
    const box = byId('ws-tabs');
    if (box) {
      Array.prototype.forEach.call(box.children, function (b: HTMLElement) {
        b.addEventListener('click', function () {
          S.workspace = b.dataset.ws as AppState['workspace'];
          Array.prototype.forEach.call(box.children, function (x: HTMLElement) {
            x.classList.toggle('on', x === b);
          });
          (['chart', 'map', 'fleet'] as AppState['workspace'][]).forEach(function (w) {
            const n = byId('ws-' + w);
            if (n) n.classList.toggle('on', w === S.workspace);
          });
          moveSchematic();
          renderWorkspace();
        });
      });
    }

    const pbox = byId('panel-tabs');
    if (pbox) {
      Array.prototype.forEach.call(pbox.children, function (b: HTMLElement) {
        b.addEventListener('click', function () {
          S.panelTab = b.dataset.pt as AppState['panelTab'];
          Array.prototype.forEach.call(pbox.children, function (x: HTMLElement) {
            x.classList.toggle('on', x === b);
          });
          (['feed', 'audit'] as AppState['panelTab'][]).forEach(function (w) {
            const n = byId('pt-' + w);
            if (n) n.classList.toggle('on', w === S.panelTab);
          });
          const qc = byId('q-count'), as = byId('audit-sub');
          if (qc) qc.style.display = S.panelTab === 'feed' ? '' : 'none';
          if (as) as.style.display = S.panelTab === 'audit' ? '' : 'none';
          if (S.panelTab === 'feed') Queue.renderQueue(); else Queue.renderAudit();
        });
      });
    }
  }

  /** One schematic node, re-parented into whichever workspace tab wants it. */
  function moveSchematic(): void {
    const wrap = byId('net-wrap');
    const target = byId(S.workspace === 'map' ? 'net-wrap-2' : 'net-host-chart');
    if (wrap && target && wrap.parentElement !== target) target.appendChild(wrap);
  }

  function renderWorkspace(): void {
    if (S.workspace === 'fleet') { Fleet.render(); return; }
    Marey.render();
    Network.render();
  }

  /* ------------------------------------------------------- clock UI */

  function bindClock(): void {
    const play = byId<HTMLButtonElement>('c-play');
    if (play) play.addEventListener('click', function () { setPlaying(!S.playing); });

    ([['c-x1', 1], ['c-x8', 8], ['c-x60', 60]] as [string, number][]).forEach(function (b) {
      const n = byId(b[0]);
      if (!n) return;
      n.addEventListener('click', function () {
        S.speed = b[1];
        ['c-x1', 'c-x8', 'c-x60'].forEach(function (id) {
          const x = byId(id);
          if (x) x.classList.toggle('on', id === b[0]);
        });
        if (S.playing) setPlaying(true);   // restart the interval at the new rate
      });
    });

    const rst = byId('c-rst');
    if (rst) rst.addEventListener('click', function () { S.clock = 0; bus.emit('clock'); });

    bus.on('clockstate', function () {
      if (!play) return;
      play.innerHTML = S.playing ? '&#10073;&#10073;' : '&#9654;';
      play.classList.toggle('on', S.playing);
    });

    bus.on('clock', function () {
      // keep a zoomed string-chart window following the clock
      if (S.zoom < 24) {
        const span = S.zoom * 60;
        if (S.clock < S.zoomAt || S.clock > S.zoomAt + span) {
          S.zoomAt = Math.max(0, Math.min(DAY - span, S.clock - span / 2));
        }
      }
      renderBanner();
      renderWorkspace();
      if (view === 'reports') Analytics.renderReports();
    });
  }

  /* ------------------------------------------------------- views */

  function renderView(): void {
    if (view === 'ops') {
      renderWorkspace();
      Queue.renderProposals();
      if (S.panelTab === 'feed') Queue.renderQueue(); else Queue.renderAudit();
    } else if (view === 'reports') {
      Analytics.renderReports();
    } else if (view === 'logs') {
      Analytics.renderLogs();
    }
  }

  function bindViews(): void {
    const btns = document.querySelectorAll<HTMLElement>('.rail-btn');
    Array.prototype.forEach.call(btns, function (b: HTMLElement) {
      b.addEventListener('click', function () {
        view = b.dataset.view as ViewName;
        Array.prototype.forEach.call(btns, function (x: HTMLElement) {
          x.classList.toggle('on', x === b);
        });
        (['ops', 'reports', 'logs'] as ViewName[]).forEach(function (v) {
          const n = byId('view-' + v);
          if (n) n.classList.toggle('on', v === view);
        });
        renderView();
      });
    });

    const chip = byId('tsr-chip');
    if (chip) {
      chip.addEventListener('click', function () {
        const b = document.querySelector<HTMLElement>('.rail-btn[data-view="reports"]');
        if (b) b.click();
      });
    }
  }

  /* ------------------------------------------------------- boot */

  function boot(): void {
    if (!D) {
      document.body.innerHTML =
        '<div class="empty">railsync-data.js failed to load. Run <code>npm run data</code>.</div>';
      return;
    }

    initProposals();

    // Open on a busy morning hour so the board reads as a live shift.
    S.clock = 450;

    Network.bindTabs();
    Marey.bindZoom();
    bindWorkspace();
    Queue.buildFilters();
    Drawer.bind();
    bindClock();
    bindViews();

    bus.on('render', function () {
      renderBanner();
      renderWorkspace();
      Queue.renderProposals();
      if (S.panelTab === 'feed') Queue.renderQueue(); else Queue.renderAudit();
      if (view === 'logs') Analytics.renderLogs();
      if (view === 'reports') Analytics.renderReports();
    });

    // Cursor synchronisation — hovering either view redraws both, so the
    // highlighted train or block appears in the same instant on each.
    bus.on('sync', function () {
      if (S.workspace === 'fleet') return;
      Marey.render();
      Network.render();
    });

    bus.on('corridor', function () {
      renderBanner();
      renderWorkspace();
      if (S.panelTab === 'feed') Queue.renderQueue();
    });

    bus.on('log', function () {
      if (view === 'logs') Analytics.renderLogs();
    });

    let rt: number | undefined;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(renderWorkspace, 120) as unknown as number;
    });

    logEvent('system', 'Shift opened — ' + D.meta.division + ' Division',
      D.queue.length + ' demands ingested from TMS / TDMS / SMMS · ' +
      S.proposals.length + ' block proposals generated · ' +
      D.trains.length + ' train paths loaded · ' + D.tsr.length + ' TSR in force.', null);

    renderBanner();
    renderView();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
