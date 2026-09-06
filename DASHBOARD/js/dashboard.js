"use strict";
/* ============================================================
   Shape of the bundle emitted by build_data.py.
   Keep this in step with that script — it is the contract between
   the Python join layer and the browser rendering layer.
   ============================================================ */
/// <reference path="types.ts" />
/* ============================================================
   Shared state, division clock, and the geometry helpers every
   panel builds on. Panels read from S and redraw on bus events.
   ============================================================ */
var RailSync;
(function (RailSync) {
    RailSync.DAY = 1440;
    RailSync.D = window.RAILSYNC_DATA;
    RailSync.S = {
        clock: 0,
        playing: false,
        speed: 1,
        corridor: RailSync.D ? RailSync.D.corridors[0].id : '',
        zoom: 24,
        zoomAt: 0,
        filters: {
            dept: { TMS: true, TDMS: true, SMMS: true },
            band: { CRITICAL: true, URGENT: true, ROUTINE: true },
            corridorOnly: false
        },
        selDemand: null,
        selProposal: null,
        hotTrain: null,
        hotBlock: null,
        workspace: 'chart',
        panelTab: 'feed',
        overrunMin: 0,
        proposals: [],
        log: []
    };
    /** Working copies, so controller decisions never mutate the source bundle. */
    function initProposals() {
        RailSync.D.proposals.forEach(function (p) {
            const c = JSON.parse(JSON.stringify(p));
            c.origStart = c.start;
            c.added = [];
            RailSync.S.proposals.push(c);
        });
    }
    RailSync.initProposals = initProposals;
    const handlers = {};
    RailSync.bus = {
        on(key, fn) {
            (handlers[key] = handlers[key] || []).push(fn);
        },
        emit(key, arg) {
            (handlers[key] || []).forEach(function (f) { f(arg); });
        }
    };
    /* ------------------------------------------------------- formatting */
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    RailSync.pad2 = pad2;
    function hhmm(m) {
        m = ((Math.round(m) % RailSync.DAY) + RailSync.DAY) % RailSync.DAY;
        return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    }
    RailSync.hhmm = hhmm;
    function shortCorr(id) { return id.replace('CORR_', ''); }
    RailSync.shortCorr = shortCorr;
    function corridorById(id) {
        for (let i = 0; i < RailSync.D.corridors.length; i++) {
            if (RailSync.D.corridors[i].id === id)
                return RailSync.D.corridors[i];
        }
        return RailSync.D.corridors[0];
    }
    RailSync.corridorById = corridorById;
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    RailSync.esc = esc;
    function scoreColor(v) {
        if (v >= 75)
            return '#ff4d4f';
        if (v >= 55)
            return '#f5b942';
        return '#2ecc71';
    }
    RailSync.scoreColor = scoreColor;
    RailSync.CLS_COLOR = {
        PREMIUM: '#f5c542', EXPRESS: '#4a9eff', SUBURBAN: '#35c46a', FREIGHT: '#9c8468'
    };
    /* ------------------------------------------------------- geometry */
    /** Chainage of a train at division time t, or null when it is off-section. */
    function trainAt(t, train) {
        const p = train.path;
        if (t < p[0][0] || t > p[p.length - 1][0])
            return null;
        for (let i = 0; i < p.length - 1; i++) {
            const a = p[i], b = p[i + 1];
            if (t >= a[0] && t <= b[0]) {
                const f = (b[0] === a[0]) ? 0 : (t - a[0]) / (b[0] - a[0]);
                const km = a[1] + (b[1] - a[1]) * f;
                const dkm = b[1] - a[1], dt = b[0] - a[0];
                const spd = dt > 0 ? Math.abs(dkm / dt) * 60 : 0;
                return { km: km, speed: spd, moving: spd > 0.5 };
            }
        }
        return null;
    }
    RailSync.trainAt = trainAt;
    function runningAt(t, corridorId) {
        const out = [];
        RailSync.D.trains.forEach(function (tr) {
            if (corridorId && tr.corridor !== corridorId)
                return;
            const pos = trainAt(t, tr);
            if (pos)
                out.push({ train: tr, pos: pos });
        });
        return out;
    }
    RailSync.runningAt = runningAt;
    /** Blocks actually in force at time t. A pending proposal has not been
        granted, so it does not occupy track. */
    function activeBlocks(t, corridorId) {
        return RailSync.S.proposals.filter(function (p) {
            if (p.status !== 'APPROVED')
                return false;
            if (corridorId && p.corridor !== corridorId)
                return false;
            return t >= p.start && t <= p.end;
        });
    }
    RailSync.activeBlocks = activeBlocks;
    function railTemp(t, corridorId) {
        const wx = RailSync.D.weather[corridorId] || RailSync.D.weather[Object.keys(RailSync.D.weather)[0]];
        if (!wx)
            return null;
        const m = Math.max(0, Math.min(RailSync.DAY - 1, Math.round(t)));
        const hr = wx.hours[Math.min(23, Math.floor(m / 60))];
        if (!hr)
            return null;
        const rail = (wx.curve && wx.curve.length) ? wx.curve[Math.min(wx.curve.length - 1, m)] : hr.rail;
        return {
            rail: rail, amb: hr.amb, dest: hr.dest,
            min: hr.minMax ? hr.minMax[0] : 8,
            max: hr.minMax ? hr.minMax[1] : 48,
            buckle: !!hr.buckle, safeTamp: !!hr.safeTamp,
            wind: hr.wind, rain: hr.rain,
            probe: wx.probe, station: wx.station
        };
    }
    RailSync.railTemp = railTemp;
    /** Does a train path cross [lo,hi] km during [t0,t1]?
        Mirrors the Python conflict engine so on-screen re-scoring after a
        slot shift agrees with the pre-computed plan. */
    function pathEnters(train, lo, hi, t0, t1) {
        const p = train.path;
        for (let i = 0; i < p.length - 1; i++) {
            const ta = p[i][0], ka = p[i][1], tb = p[i + 1][0], kb = p[i + 1][1];
            if (tb === ta)
                continue;
            const klo = Math.min(ka, kb), khi = Math.max(ka, kb);
            if (khi < lo || klo > hi)
                continue;
            let s0 = Math.min(ta, tb), s1 = Math.max(ta, tb);
            if (!(klo >= lo && khi <= hi)) {
                const edges = [];
                [lo, hi].forEach(function (e) {
                    if (klo <= e && e <= khi && kb !== ka)
                        edges.push(ta + (tb - ta) * (e - ka) / (kb - ka));
                });
                if (edges.length) {
                    s0 = Math.max(s0, Math.min.apply(null, edges));
                    s1 = Math.min(s1, Math.max.apply(null, edges));
                }
            }
            if (s0 <= t1 && s1 >= t0)
                return true;
        }
        return false;
    }
    RailSync.pathEnters = pathEnters;
    /** Re-evaluate a proposal's traffic cost — used when the controller drags
        the slot or folds extra work into the possession. */
    function scoreWindow(p, start, duration) {
        const end = start + duration;
        const blocked = [], looped = [];
        RailSync.D.trains.forEach(function (t) {
            if (t.corridor !== p.corridor || p.lines.indexOf(t.line) < 0)
                return;
            if (!pathEnters(t, p.loKm, p.hiKm, start, end))
                return;
            if (t.kind === 'FREIGHT' && t.canLoop)
                looped.push(t);
            else
                blocked.push(t);
        });
        let delay = 0;
        blocked.forEach(function (t) {
            if (t.entry < end)
                delay += Math.max(0, Math.round(end - t.entry));
        });
        return {
            paxAffected: blocked.filter(function (t) { return t.kind === 'PASSENGER'; }).length,
            paxDelayMin: delay,
            freightLooped: looped.length,
            freightIds: looped.map(function (t) { return t.no; }),
            conflictTrains: blocked.slice(0, 6).map(function (t) {
                return { no: t.no, name: t.name, cls: t.cls };
            })
        };
    }
    RailSync.scoreWindow = scoreWindow;
    /** Project the knock-on delay if the gang overruns the block.
  
        Track machines break down and gangs take longer to pack up; a 120-minute
        block spilling to 140 is routine. Anything whose path would then be
        inside the possession takes the overrun as a hold. */
    function projectOverrun(p, start, duration, extra) {
        const cleanEnd = start + duration;
        const lateEnd = cleanEnd + extra;
        const hit = [];
        RailSync.D.trains.forEach(function (t) {
            if (t.corridor !== p.corridor || p.lines.indexOf(t.line) < 0)
                return;
            // already blocked by the booked window — not a knock-on
            if (pathEnters(t, p.loKm, p.hiKm, start, cleanEnd))
                return;
            if (!pathEnters(t, p.loKm, p.hiKm, cleanEnd, lateEnd))
                return;
            // held until the line is handed back
            const reach = firstReach(t, p.loKm, p.hiKm);
            const delay = reach === null ? extra : Math.max(0, Math.round(lateEnd - reach));
            hit.push({ no: t.no, name: t.name, cls: t.cls, delayMin: Math.min(delay, extra) });
        });
        hit.sort(function (a, b) { return b.delayMin - a.delayMin; });
        return {
            extraMin: extra,
            trains: hit,
            totalDelayMin: hit.reduce(function (a, t) { return a + t.delayMin; }, 0),
            worst: hit.length ? hit[0].delayMin : 0
        };
    }
    RailSync.projectOverrun = projectOverrun;
    /** Division time at which a train first reaches the blocked chainage. */
    function firstReach(t, lo, hi) {
        const p = t.path;
        for (let i = 0; i < p.length - 1; i++) {
            const ta = p[i][0], ka = p[i][1], tb = p[i + 1][0], kb = p[i + 1][1];
            const klo = Math.min(ka, kb), khi = Math.max(ka, kb);
            if (khi < lo || klo > hi)
                continue;
            if (ka >= lo && ka <= hi)
                return ta;
            if (kb !== ka) {
                const edge = (kb > ka) ? lo : hi;
                if (klo <= edge && edge <= khi)
                    return ta + (tb - ta) * (edge - ka) / (kb - ka);
            }
            return ta;
        }
        return null;
    }
    /* --------------------------------------------- private numbers + memo */
    // Private Numbers are issued in sequence through the shift and quoted back
    // over the control phone to authenticate the order.
    let pnSeq = 47;
    let pnTpcSeq = 16;
    function issueOrder(p, start, duration) {
        const pnSm = ++pnSeq;
        const needsTpc = p.window.earthingMin > 0 || !!p.isolation;
        const pnTpc = needsTpc ? ++pnTpcSeq : null;
        const end = start + duration;
        const w = p.window;
        const stations = p.section.split(' - ');
        const L = [];
        L.push('CONTROL ORDER — ENGINEERING BLOCK AUTHORISATION');
        L.push('');
        L.push('Division      : ' + RailSync.D.meta.division + ' (' + RailSync.D.meta.zone + ')');
        L.push('Date          : ' + RailSync.D.meta.date);
        L.push('Order no.     : ' + p.id);
        L.push('To            : SM/' + (stations[0] || '') +
            (stations[1] ? ', SM/' + stations[1] : ''));
        if (needsTpc)
            L.push('Copy          : TPC ' + (p.isolation || ''));
        L.push('');
        L.push('Block section : ' + p.section + '   (' + p.lines.join(' + ') + ')');
        L.push('Chainage      : KM ' + p.loKm.toFixed(2) + ' to KM ' + p.hiKm.toFixed(2));
        L.push('Block granted : ' + hhmm(start) + ' to ' + hhmm(end) +
            '   (' + duration + ' min total window)');
        L.push('Physical work : ' + w.workMin + ' min  (' +
            p.items.map(function (i) { return i.action.replace(/_/g, ' '); }).join(', ') + ')');
        L.push('Protection    : ' + (w.protectionMin / 2) + ' min set, ' +
            (w.protectionMin / 2) + ' min withdraw');
        if (w.earthingMin) {
            L.push('Earthing      : ' + (w.earthingMin / 2) + ' min earth, ' +
                (w.earthingMin / 2) + ' min de-earth');
        }
        if (p.isolation) {
            L.push('Isolation     : ' + p.isolation +
                (p.isolators.length ? '  — open ' + p.isolators.join(', ') : ''));
        }
        if (p.memo)
            L.push('Disconn. memo : ' + p.memo);
        if (p.routes.length)
            L.push('Routes barred : ' + p.routes.join(', '));
        if (p.machines.length) {
            p.machines.forEach(function (m) {
                L.push('Machine       : ' + m.id + ' (' + m.type + ') ex ' + m.from +
                    ', report by ' + m.reportBy + ', crew ' + m.crew);
            });
        }
        else {
            L.push('Machine       : NIL — manual gang possession');
        }
        if (p.regulation.length) {
            p.regulation.forEach(function (rg) {
                L.push('Regulation    : ' + rg.rake + ' to be stabled in ' +
                    (rg.loop ? rg.loop + ' loop (CSR ' + rg.loopCsr + ' m)' : 'NO SUITABLE LOOP'));
            });
        }
        if (p.postTsr) {
            L.push('After work    : impose ' + p.postTsr.speed + ' kmph TSR over ' +
                p.postTsr.lengthKm + ' km for ' + p.postTsr.hours + ' h');
        }
        L.push('');
        L.push('Private Number: SM ' + pnSm + (pnTpc !== null ? '   /   TPC ' + pnTpc : ''));
        L.push('Issued at     : ' + hhmm(RailSync.S.clock) + '  by Section Controller, ' +
            RailSync.D.meta.division + ' Division');
        L.push('');
        L.push('Line to be handed back clear of men and material by ' + hhmm(end) + '.');
        return { pnSm: pnSm, pnTpc: pnTpc, issuedAt: RailSync.S.clock, text: L.join('\n') };
    }
    RailSync.issueOrder = issueOrder;
    function totalDuration(p) {
        let extra = 0;
        (p.added || []).forEach(function (a) { extra += a.addMin; });
        return p.duration + extra;
    }
    RailSync.totalDuration = totalDuration;
    /* ------------------------------------------------------- clock */
    let tickHandle = null;
    function tick() {
        RailSync.S.clock = (RailSync.S.clock + RailSync.S.speed / 60) % RailSync.DAY; // per second of wall time
        RailSync.bus.emit('clock');
    }
    function setPlaying(on) {
        RailSync.S.playing = on;
        if (tickHandle !== null) {
            clearInterval(tickHandle);
            tickHandle = null;
        }
        if (on)
            tickHandle = setInterval(tick, 1000);
        RailSync.bus.emit('clockstate');
    }
    RailSync.setPlaying = setPlaying;
    /* ------------------------------------------------------- DOM helpers */
    function el(tag, cls, txt) {
        const n = document.createElement(tag);
        if (cls)
            n.className = cls;
        if (txt !== undefined && txt !== null)
            n.textContent = txt;
        return n;
    }
    RailSync.el = el;
    function svgEl(tag, attrs) {
        const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
        if (attrs) {
            for (const k in attrs) {
                const v = attrs[k];
                if (v !== undefined && v !== null)
                    n.setAttribute(k, String(v));
            }
        }
        return n;
    }
    RailSync.svgEl = svgEl;
    function clear(n) {
        while (n.firstChild)
            n.removeChild(n.firstChild);
    }
    RailSync.clear = clear;
    function byId(id) {
        return document.getElementById(id);
    }
    RailSync.byId = byId;
    /* ------------------------------------------------------- tooltip */
    let tipEl = null;
    function tip(html, ev) {
        tipEl = tipEl || document.getElementById('tip');
        if (!tipEl)
            return;
        tipEl.innerHTML = html;
        tipEl.classList.add('on');
        const r = tipEl.getBoundingClientRect();
        let x = ev.clientX + 15, y = ev.clientY + 15;
        if (x + r.width > window.innerWidth - 10)
            x = ev.clientX - r.width - 15;
        if (y + r.height > window.innerHeight - 10)
            y = ev.clientY - r.height - 15;
        tipEl.style.left = x + 'px';
        tipEl.style.top = y + 'px';
    }
    RailSync.tip = tip;
    function tipOff() {
        tipEl = tipEl || document.getElementById('tip');
        if (tipEl)
            tipEl.classList.remove('on');
    }
    RailSync.tipOff = tipOff;
    /** Build tooltip body rows from [label, value] pairs. */
    function tipRows(rows) {
        return rows.map(function (r) {
            return '<div class="tt-r"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
        }).join('');
    }
    RailSync.tipRows = tipRows;
    /* ------------------------------------------------------- feedback */
    function toast(msg, kind) {
        const wrap = document.getElementById('toast-wrap');
        if (!wrap)
            return;
        const t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
        wrap.appendChild(t);
        setTimeout(function () {
            t.style.transition = 'opacity .3s';
            t.style.opacity = '0';
            setTimeout(function () { if (t.parentNode)
                t.parentNode.removeChild(t); }, 320);
        }, 3200);
    }
    RailSync.toast = toast;
    function logEvent(kind, title, detail, ref) {
        RailSync.S.log.unshift({ kind: kind, title: title, detail: detail, ref: ref, at: RailSync.S.clock, wall: new Date() });
        RailSync.bus.emit('log');
    }
    RailSync.logEvent = logEvent;
})(RailSync || (RailSync = {}));
/// <reference path="core.ts" />
/* ============================================================
   (i) Master Time–Distance String Chart (Marey diagram)

   X = division time, Y = chainage along the corridor.
   Chainage increases UPWARD, so UP trains (km increasing) slope up and
   DN trains slope down — the way a controller reads a string chart.
   ============================================================ */
var RailSync;
(function (RailSync) {
    var Marey;
    (function (Marey) {
        const M = { l: 64, r: 16, t: 12, b: 26 };
        function corridorTrains(cid) {
            return RailSync.D.trains.filter(function (t) { return t.corridor === cid; });
        }
        function visibleWindow() {
            const span = RailSync.S.zoom * 60;
            if (span >= RailSync.DAY)
                return [0, RailSync.DAY];
            const a = Math.max(0, Math.min(RailSync.DAY - span, RailSync.S.zoomAt));
            return [a, a + span];
        }
        function render() {
            const host = RailSync.byId('marey-wrap');
            const root = document.getElementById('marey-svg');
            if (!host || !root)
                return;
            const W = host.clientWidth, H = host.clientHeight;
            const iw = W - M.l - M.r, ih = H - M.t - M.b;
            // the pane can be laid out narrower than the margins (or hidden entirely),
            // which would give the plot a negative extent
            if (iw < 20 || ih < 20)
                return;
            RailSync.clear(root);
            root.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
            const corr = RailSync.corridorById(RailSync.S.corridor);
            const win = visibleWindow(), t0 = win[0], t1 = win[1];
            const maxKm = corr.lengthKm;
            const X = (t) => M.l + (t - t0) / (t1 - t0) * iw;
            const Y = (km) => M.t + ih - (km / maxKm) * ih; // km 0 at the bottom
            /* ---- defs: clip + block hatching ---- */
            const defs = RailSync.svgEl('defs');
            const cp = RailSync.svgEl('clipPath', { id: 'mk-clip' });
            cp.appendChild(RailSync.svgEl('rect', { x: M.l, y: M.t, width: iw, height: ih }));
            defs.appendChild(cp);
            const hatch = RailSync.svgEl('pattern', {
                id: 'mk-hatch', width: 7, height: 7,
                patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'
            });
            hatch.appendChild(RailSync.svgEl('rect', { width: 7, height: 7, fill: 'rgba(245,185,66,.09)' }));
            hatch.appendChild(RailSync.svgEl('line', {
                x1: 0, y1: 0, x2: 0, y2: 7, stroke: 'rgba(245,185,66,.42)', 'stroke-width': 2.5
            }));
            defs.appendChild(hatch);
            root.appendChild(defs);
            const plot = RailSync.svgEl('g', { 'clip-path': 'url(#mk-clip)' });
            /* ---- night shading: the hours line blocks are normally granted in ---- */
            [[0, 300], [1380, 1440]].forEach(function (n) {
                const a = Math.max(n[0], t0), b = Math.min(n[1], t1);
                if (b <= a)
                    return;
                plot.appendChild(RailSync.svgEl('rect', {
                    x: X(a), y: M.t, width: X(b) - X(a), height: ih, class: 'mk-night'
                }));
            });
            /* ---- time grid ---- */
            const stepMin = RailSync.S.zoom >= 24 ? 60 : (RailSync.S.zoom >= 8 ? 30 : 15);
            const labelEvery = RailSync.S.zoom >= 24 ? 120 : (RailSync.S.zoom >= 8 ? 60 : 30);
            for (let t = Math.ceil(t0 / stepMin) * stepMin; t <= t1; t += stepMin) {
                const major = t % labelEvery === 0;
                plot.appendChild(RailSync.svgEl('line', {
                    x1: X(t), y1: M.t, x2: X(t), y2: M.t + ih, class: major ? 'mk-grid-hr' : 'mk-grid'
                }));
                if (major) {
                    const tx = RailSync.svgEl('text', { x: X(t), y: H - 9, class: 'mk-axis-txt', 'text-anchor': 'middle' });
                    tx.textContent = RailSync.hhmm(t);
                    root.appendChild(tx);
                }
            }
            /* ---- station lines + labels ---- */
            corr.stations.forEach(function (st) {
                plot.appendChild(RailSync.svgEl('line', {
                    x1: M.l, y1: Y(st.km), x2: M.l + iw, y2: Y(st.km), class: 'mk-stn-line'
                }));
                const lab = RailSync.svgEl('text', { x: M.l - 8, y: Y(st.km) + 3, class: 'mk-stn-txt', 'text-anchor': 'end' });
                lab.textContent = st.code;
                root.appendChild(lab);
                const km = RailSync.svgEl('text', { x: M.l - 8, y: Y(st.km) + 12, class: 'mk-stn-km', 'text-anchor': 'end' });
                km.textContent = st.km.toFixed(0);
                root.appendChild(km);
            });
            /* ---- permanent speed restrictions as horizontal bands ---- */
            RailSync.D.tsr.filter(function (r) { return r.corridor === corr.id; }).forEach(function (r) {
                const ya = Y(Math.max(r.fromKm, r.toKm)), yb = Y(Math.min(r.fromKm, r.toKm));
                plot.appendChild(RailSync.svgEl('rect', {
                    x: M.l, y: ya, width: iw, height: Math.max(2, yb - ya), class: 'mk-tsr'
                }));
            });
            /* ---- maintenance blocks ---- */
            RailSync.S.proposals.filter(function (p) {
                return p.corridor === corr.id && p.status !== 'REJECTED';
            }).forEach(function (p) {
                const dur = RailSync.totalDuration(p);
                const xa = X(p.start), xb = X(p.start + dur);
                const ya = Y(p.hiKm), yb = Y(p.loKm);
                if (xb < M.l || xa > M.l + iw)
                    return;
                const h = Math.max(9, yb - ya);
                const cls = 'mk-block' + (p.status === 'APPROVED' ? ' approved' : '') +
                    (RailSync.S.selProposal === p.id ? ' sel' : '') +
                    (RailSync.S.hotBlock === p.id ? ' hot' : '');
                const rect = RailSync.svgEl('rect', {
                    x: xa, y: ya, width: Math.max(3, xb - xa), height: h, class: cls, rx: 2
                });
                rect.setAttribute('fill', p.status === 'APPROVED' ? 'rgba(46,204,113,.16)' : 'url(#mk-hatch)');
                rect.addEventListener('mousemove', function (e) {
                    // cursor synchronisation: light up the track this block occupies
                    if (RailSync.S.hotBlock !== p.id) {
                        RailSync.S.hotBlock = p.id;
                        RailSync.bus.emit('sync');
                    }
                    RailSync.tip(blockTip(p), e);
                });
                rect.addEventListener('mouseleave', function () {
                    RailSync.S.hotBlock = null;
                    RailSync.tipOff();
                    RailSync.bus.emit('sync');
                });
                rect.addEventListener('click', function () {
                    RailSync.tipOff();
                    RailSync.bus.emit('openProposal', p.id);
                });
                plot.appendChild(rect);
                // the inner bar is the physical work; the outer box is the granted window
                if (xb - xa > 12 && h > 6) {
                    const wx0 = X(p.start + (dur - p.window.workMin) / 2);
                    const wx1 = X(p.start + (dur + p.window.workMin) / 2);
                    plot.appendChild(RailSync.svgEl('rect', {
                        x: wx0, y: ya + h * 0.32, width: Math.max(2, wx1 - wx0), height: Math.max(2, h * 0.36),
                        class: 'mk-work', rx: 1
                    }));
                }
                if (xb - xa > 46 && h > 11) {
                    const lbl = RailSync.svgEl('text', { x: xa + 4, y: ya + Math.min(11, h - 2), class: 'mk-block-txt' });
                    lbl.textContent = p.id;
                    if (p.status === 'APPROVED')
                        lbl.setAttribute('fill', '#2ecc71');
                    plot.appendChild(lbl);
                }
            });
            /* ---- train paths ---- */
            const trains = corridorTrains(corr.id);
            const hot = RailSync.S.hotTrain;
            // booked path, faint, so lost time reads against the actual
            trains.forEach(function (tr) {
                if (tr.kind !== 'PASSENGER' || tr.delay <= 0)
                    return;
                plot.appendChild(RailSync.svgEl('polyline', {
                    points: tr.sched.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' '),
                    class: 'mk-sched'
                }));
            });
            trains.forEach(function (tr) {
                const pts = tr.path.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ');
                let cls = 'mk-path ' + tr.cls;
                if (hot && hot !== tr.id)
                    cls += ' dim';
                if (hot === tr.id)
                    cls += ' hot';
                plot.appendChild(RailSync.svgEl('polyline', { points: pts, class: cls }));
                // fat transparent stroke so thin diagonals are easy to hit
                const hit = RailSync.svgEl('polyline', { points: pts, class: 'mk-hit' });
                hit.addEventListener('mousemove', function (e) {
                    // cursor synchronisation: the same train lights up on the schematic
                    if (RailSync.S.hotTrain !== tr.id) {
                        RailSync.S.hotTrain = tr.id;
                        RailSync.bus.emit('sync');
                    }
                    RailSync.tip(trainTip(tr), e);
                });
                hit.addEventListener('mouseleave', function () {
                    RailSync.S.hotTrain = null;
                    RailSync.tipOff();
                    RailSync.bus.emit('sync');
                });
                plot.appendChild(hit);
            });
            root.appendChild(plot);
            /* ---- 'now' marker ---- */
            if (RailSync.S.clock >= t0 && RailSync.S.clock <= t1) {
                const nx = X(RailSync.S.clock);
                root.appendChild(RailSync.svgEl('line', { x1: nx, y1: M.t, x2: nx, y2: M.t + ih, class: 'mk-now' }));
                root.appendChild(RailSync.svgEl('polygon', {
                    points: (nx - 5) + ',' + M.t + ' ' + (nx + 5) + ',' + M.t + ' ' + nx + ',' + (M.t + 7),
                    class: 'mk-now-head'
                }));
            }
            root.appendChild(RailSync.svgEl('rect', {
                x: M.l, y: M.t, width: iw, height: ih, fill: 'none', stroke: '#243244', 'stroke-width': 1
            }));
            const sub = RailSync.byId('mk-sub');
            if (sub) {
                sub.textContent = corr.name + '  ·  ' + trains.length + ' paths  ·  ' +
                    RailSync.hhmm(t0) + '–' + RailSync.hhmm(t1 === RailSync.DAY ? 1439 : t1);
            }
        }
        Marey.render = render;
        /* ------------------------------------------------------- tooltips */
        function trainTip(tr) {
            const pos = RailSync.trainAt(RailSync.S.clock, tr);
            const rows = [];
            rows.push(['Class', tr.kind === 'FREIGHT' ? 'Freight rake' : tr.name]);
            rows.push(['Corridor / line', RailSync.shortCorr(tr.corridor) + ' · ' + tr.line]);
            rows.push(['Direction', tr.dir + (tr.dir === 'UP' ? '  (km +)' : '  (km −)')]);
            rows.push(['Booked entry', RailSync.hhmm(tr.sched[0][0]) + ' → ' + RailSync.hhmm(tr.sched[tr.sched.length - 1][0])]);
            if (tr.kind === 'PASSENGER') {
                rows.push(['Running late', tr.delay > 0 ? tr.delay + ' min' : 'Right time']);
                rows.push(['MPS / avg', tr.mps + ' / ' + tr.avgSpeed + ' km/h']);
            }
            else {
                rows.push(['Load', tr.wagons + ' wagons · ' + tr.tonnage + ' t']);
                rows.push(['Rake length', tr.lengthM + ' m']);
                rows.push(['Loopable', tr.canLoop ? 'Yes' : 'No — through path needed']);
                rows.push(['O–D', tr.origin + ' → ' + tr.dest]);
            }
            if (pos) {
                rows.push(['Now at', 'KM ' + pos.km.toFixed(1) + (pos.moving ? '' : '  (standing)')]);
                rows.push(['Current speed', pos.speed.toFixed(0) + ' km/h']);
            }
            else {
                rows.push(['Now', 'Not on section']);
            }
            return '<div class="tt-h"><span class="swatch" style="background:' + RailSync.CLS_COLOR[tr.cls] +
                '"></span>' + RailSync.esc(tr.no) + ' · ' + RailSync.esc(tr.name) + '</div>' + RailSync.tipRows(rows);
        }
        function blockTip(p) {
            const dur = RailSync.totalDuration(p);
            const im = p.impact;
            const rows = [
                ['Section', p.section + ' · ' + p.line],
                ['Chainage', 'KM ' + p.loKm.toFixed(2) + ' – ' + p.hiKm.toFixed(2)],
                ['Granted window', RailSync.hhmm(p.start) + ' – ' + RailSync.hhmm(p.start + dur) + '  (' + dur + ' min)'],
                ['Physical work', p.window.workMin + ' min'],
                ['Overheads', (dur - p.window.workMin) + ' min protection / earthing / ramp'],
                ['Tasks bundled', String(p.items.length + p.added.length)],
                ['Machines', p.machines.length ? p.machines.map(function (m) { return m.id; }).join(', ') : 'Manual gang'],
                ['Train delay induced', im.paxDelayMin + ' min'],
                ['Freight into loops', String(im.freightLooped)]
            ];
            if (p.isolation)
                rows.push(['Isolation', p.isolation]);
            return '<div class="tt-h"><span class="swatch" style="background:' +
                (p.status === 'APPROVED' ? '#2ecc71' : '#f5b942') + '"></span>' +
                RailSync.esc(p.id) + ' · ' + RailSync.esc(p.status) + '</div>' + RailSync.tipRows(rows) +
                '<div class="tt-r" style="margin-top:6px;color:#7c8da0"><span>Click to open work permit</span></div>';
        }
        /* ------------------------------------------------------- zoom + pan */
        function bindZoom() {
            const seg = RailSync.byId('mk-zoom');
            if (seg) {
                seg.addEventListener('click', function (e) {
                    const b = e.target.closest('button');
                    if (!b || !b.dataset.z)
                        return;
                    RailSync.S.zoom = +b.dataset.z;
                    RailSync.S.zoomAt = Math.max(0, Math.min(RailSync.DAY - RailSync.S.zoom * 60, RailSync.S.clock - RailSync.S.zoom * 30));
                    Array.prototype.forEach.call(seg.children, function (c) {
                        c.classList.toggle('on', c === b);
                    });
                    render();
                });
            }
            // Drag horizontally to pan the time window when zoomed in.
            const wrap = RailSync.byId('marey-wrap');
            if (!wrap)
                return;
            let dragging = false, lastX = 0;
            wrap.addEventListener('mousedown', function (e) {
                if (RailSync.S.zoom >= 24)
                    return;
                const cl = e.target.classList;
                if (cl.contains('mk-hit') || cl.contains('mk-block'))
                    return;
                dragging = true;
                lastX = e.clientX;
                wrap.style.cursor = 'grabbing';
            });
            window.addEventListener('mousemove', function (e) {
                if (!dragging)
                    return;
                const iw = wrap.clientWidth - M.l - M.r;
                const perPx = (RailSync.S.zoom * 60) / iw;
                RailSync.S.zoomAt = Math.max(0, Math.min(RailSync.DAY - RailSync.S.zoom * 60, RailSync.S.zoomAt - (e.clientX - lastX) * perPx));
                lastX = e.clientX;
                render();
            });
            window.addEventListener('mouseup', function () {
                dragging = false;
                wrap.style.cursor = '';
            });
        }
        Marey.bindZoom = bindZoom;
    })(Marey = RailSync.Marey || (RailSync.Marey = {}));
})(RailSync || (RailSync = {}));
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
var RailSync;
(function (RailSync) {
    var Network;
    (function (Network) {
        const M = { l: 34, r: 30, t: 24, b: 46 };
        const SECTOR = {
            CORR_NORTH: 'North', CORR_EAST: 'East', CORR_SOUTH: 'South', CORR_WEST: 'West'
        };
        /** Where the track machines stable — a controller needs to see what plant
            is available, and where, before granting a block. */
        function depotsOn(corr) {
            const by = {};
            RailSync.D.machines.forEach(function (m) {
                if (m.corridor !== corr.id)
                    return;
                (by[m.station] = by[m.station] || []).push(m);
            });
            return by;
        }
        function kmOf(corr, code) {
            for (let i = 0; i < corr.stations.length; i++) {
                if (corr.stations[i].code === code)
                    return corr.stations[i].km;
            }
            return 0;
        }
        /** Rakes being held in loops right now, by the station holding them. */
        function regulatedNow(t, corr) {
            const by = {};
            RailSync.activeBlocks(t, corr.id).forEach(function (p) {
                p.regulation.forEach(function (rg) {
                    if (!rg.loop)
                        return;
                    (by[rg.loop] = by[rg.loop] || []).push(rg);
                });
            });
            return by;
        }
        function render() {
            // resolved every pass: the schematic moves between workspace tabs
            const host = RailSync.byId('net-wrap');
            const root = document.getElementById('net-svg');
            if (!host || !root)
                return;
            const W = host.clientWidth, H = host.clientHeight;
            const iw = W - M.l - M.r;
            // guard the inner extent, not just the pane: a hidden or very narrow pane
            // would otherwise produce negative geometry
            if (iw < 20 || H - M.t - M.b < 16)
                return;
            RailSync.clear(root);
            root.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
            const corr = RailSync.corridorById(RailSync.S.corridor);
            const lines = corr.lines;
            const maxKm = corr.lengthKm;
            // main running lines plus one lane for loops and sidings
            const laneCount = lines.length + 1;
            const avail = H - M.t - M.b;
            const laneH = Math.min(42, Math.max(13, avail / laneCount));
            // centre the diagram: a schematic reads better balanced than top-anchored,
            // and the pane is much taller on the dedicated map tab
            const top = M.t + Math.max(0, (avail - laneCount * laneH) / 2);
            const t = RailSync.S.clock;
            const X = (km) => M.l + (km / maxKm) * iw;
            const laneY = (i) => top + i * laneH + laneH / 2;
            const loopY = laneY(lines.length);
            const defs = RailSync.svgEl('defs');
            const hatch = RailSync.svgEl('pattern', {
                id: 'nw-hatch', width: 8, height: 8,
                patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'
            });
            hatch.appendChild(RailSync.svgEl('rect', { width: 8, height: 8, fill: '#3a2f13' }));
            hatch.appendChild(RailSync.svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: '#f5b942', 'stroke-width': 3 }));
            defs.appendChild(hatch);
            root.appendChild(defs);
            const blocks = RailSync.activeBlocks(t, corr.id);
            const running = RailSync.runningAt(t, corr.id);
            const held = regulatedNow(t, corr);
            // The block the cursor is on, wherever the cursor is — this is what ties
            // the string chart and the schematic together.
            const hotBlock = RailSync.S.hotBlock
                ? RailSync.S.proposals.filter(function (p) { return p.id === RailSync.S.hotBlock; })[0]
                : null;
            /* ---------------- one lane per running line ---------------- */
            lines.forEach(function (ln, li) {
                const y = laneY(li);
                const lbl = RailSync.svgEl('text', { x: 4, y: y + 3, class: 'nw-line-lbl' });
                lbl.textContent = ln.replace('_MAIN', '').replace('_LINE', '');
                root.appendChild(lbl);
                root.appendChild(RailSync.svgEl('line', { x1: M.l, y1: y, x2: M.l + iw, y2: y, class: 'nw-bed' }));
                corr.sections.forEach(function (sec) {
                    if (sec.lines.indexOf(ln) < 0)
                        return;
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
                        root.appendChild(RailSync.svgEl('line', {
                            x1: X(lo), y1: y, x2: X(hi), y2: y, class: 'nw-sync'
                        }));
                    }
                    const seg = RailSync.svgEl('line', {
                        x1: X(lo), y1: y, x2: X(hi), y2: y,
                        class: 'nw-track ' + (blocked ? 'blocked' : occupied ? 'occupied' : 'clear')
                    });
                    if (blocked)
                        seg.setAttribute('stroke', 'url(#nw-hatch)');
                    seg.addEventListener('mousemove', function (e) {
                        RailSync.tip(sectionTip(corr, sec, ln, blocked, occupied, running, blocks), e);
                    });
                    seg.addEventListener('mouseleave', RailSync.tipOff);
                    root.appendChild(seg);
                });
            });
            /* ---------------- loop / siding lane ---------------- */
            const loopLbl = RailSync.svgEl('text', { x: 4, y: loopY + 3, class: 'nw-line-lbl' });
            loopLbl.textContent = 'LOOP';
            root.appendChild(loopLbl);
            corr.stations.forEach(function (st) {
                if (!st.loop && !st.sidings.length)
                    return;
                const x = X(st.km);
                const halfW = Math.max(9, Math.min(26, iw / (corr.stations.length * 2.4)));
                if (st.loop) {
                    // loop drawn as a stub off the main line, the way a schematic shows it
                    const occupiedLoop = (held[st.code] || []).length > 0;
                    root.appendChild(RailSync.svgEl('path', {
                        d: 'M' + (x - halfW - 5) + ',' + laneY(lines.length - 1) +
                            ' L' + (x - halfW) + ',' + loopY +
                            ' L' + (x + halfW) + ',' + loopY +
                            ' L' + (x + halfW + 5) + ',' + laneY(lines.length - 1),
                        class: 'nw-loop' + (occupiedLoop ? ' held' : '')
                    }));
                    const csr = RailSync.svgEl('text', { x: x, y: loopY - 5, class: 'nw-csr', 'text-anchor': 'middle' });
                    csr.textContent = st.loopCsr + 'm';
                    root.appendChild(csr);
                    const hit = RailSync.svgEl('rect', {
                        x: x - halfW, y: loopY - 7, width: halfW * 2, height: 14,
                        fill: 'transparent'
                    });
                    hit.style.cursor = 'pointer';
                    hit.addEventListener('mousemove', function (e) {
                        RailSync.tip(loopTip(st, held[st.code] || []), e);
                    });
                    hit.addEventListener('mouseleave', RailSync.tipOff);
                    root.appendChild(hit);
                    // a rake standing in this loop while a block is in force
                    (held[st.code] || []).forEach(function (_rg, i) {
                        root.appendChild(RailSync.svgEl('rect', {
                            x: x - halfW + 2 + i * 5, y: loopY - 3.5, width: halfW * 2 - 4, height: 7,
                            rx: 2, fill: RailSync.CLS_COLOR.FREIGHT, stroke: '#0b1119', 'stroke-width': 0.8
                        }));
                    });
                }
                st.sidings.forEach(function (_sid, i) {
                    root.appendChild(RailSync.svgEl('line', {
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
                root.appendChild(RailSync.svgEl('line', {
                    x1: x, y1: yTop, x2: x, y2: yBot, stroke: '#2a3a4d', 'stroke-width': 1
                }));
                const c = RailSync.svgEl('circle', {
                    cx: x, cy: yTop - 6, r: 4.2, class: 'nw-stn' + (st.loop ? ' loop' : '')
                });
                c.addEventListener('mousemove', function (e) {
                    RailSync.tip(stationTip(st, depots[st.code]), e);
                });
                c.addEventListener('mouseleave', RailSync.tipOff);
                root.appendChild(c);
                const lb = RailSync.svgEl('text', { x: x, y: yBot + 13, class: 'nw-stn-txt', 'text-anchor': 'middle' });
                lb.textContent = st.code;
                root.appendChild(lb);
                const km = RailSync.svgEl('text', { x: x, y: yBot + 22, class: 'nw-km-txt', 'text-anchor': 'middle' });
                km.textContent = st.km.toFixed(0);
                root.appendChild(km);
                const dm = depots[st.code];
                if (dm && dm.length) {
                    const fit = dm.filter(function (m) { return m.fitness === 'FIT'; }).length;
                    const g = RailSync.svgEl('g', { transform: 'translate(' + (x - 15) + ',' + (yBot + 26) + ')' });
                    g.appendChild(RailSync.svgEl('rect', { width: 30, height: 13, rx: 3, class: 'nw-depot' }));
                    const dt = RailSync.svgEl('text', { x: 15, y: 9.5, class: 'nw-depot-txt', 'text-anchor': 'middle' });
                    dt.textContent = '⚙ ' + fit + '/' + dm.length;
                    g.appendChild(dt);
                    g.style.cursor = 'pointer';
                    g.addEventListener('mousemove', function (e) { RailSync.tip(depotTip(st, dm), e); });
                    g.addEventListener('mouseleave', RailSync.tipOff);
                    root.appendChild(g);
                }
            });
            /* ---------------- live train markers ---------------- */
            running.forEach(function (r) {
                let li = lines.indexOf(r.train.line);
                if (li < 0)
                    li = 0;
                const y = laneY(li);
                const x = X(r.pos.km);
                const up = r.train.dir === 'UP';
                const g = RailSync.svgEl('g', { class: 'nw-train' });
                // synchronised highlight: this is the path the cursor is on
                if (RailSync.S.hotTrain === r.train.id) {
                    g.appendChild(RailSync.svgEl('circle', { cx: x, cy: y, r: 11, class: 'nw-sync-ring' }));
                }
                const pts = up
                    ? [[x - 6, y - 5], [x + 7, y], [x - 6, y + 5]]
                    : [[x + 6, y - 5], [x - 7, y], [x + 6, y + 5]];
                g.appendChild(RailSync.svgEl('polygon', {
                    points: pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' '),
                    fill: RailSync.CLS_COLOR[r.train.cls], class: 'nw-train-body',
                    stroke: '#0b1119', 'stroke-width': 1
                }));
                if (!r.pos.moving) {
                    g.appendChild(RailSync.svgEl('circle', { cx: x, cy: y - 10, r: 2.4, fill: '#ff4d4f' }));
                }
                g.addEventListener('mousemove', function (e) {
                    if (RailSync.S.hotTrain !== r.train.id) {
                        RailSync.S.hotTrain = r.train.id;
                        RailSync.bus.emit('sync');
                    }
                    RailSync.tip(trainTip(r), e);
                });
                g.addEventListener('mouseleave', function () {
                    RailSync.S.hotTrain = null;
                    RailSync.tipOff();
                    RailSync.bus.emit('sync');
                });
                root.appendChild(g);
            });
            const hdr = RailSync.svgEl('text', { x: M.l, y: 14, class: 'nw-km-txt' });
            hdr.textContent = corr.name + '  ·  ' + maxKm.toFixed(0) + ' km  ·  MPS ' + corr.maxSpeed +
                ' km/h  ·  ' + running.length + ' on section  ·  ' + blocks.length + ' block(s) in force';
            root.appendChild(hdr);
        }
        Network.render = render;
        /* ------------------------------------------------------- tooltips */
        function sectionTip(corr, sec, ln, blocked, occupied, running, blocks) {
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
            const rows = [
                ['Block section', sec.id],
                ['Line', ln],
                ['Chainage', 'KM ' + lo.toFixed(1) + ' – ' + hi.toFixed(1) + '  (' + sec.km + ' km)']
            ];
            on.forEach(function (r) { rows.push(['On section', r.train.no + ' @ KM ' + r.pos.km.toFixed(1)]); });
            blk.forEach(function (p) {
                rows.push(['Block in force', p.id + '  ' + RailSync.hhmm(p.start) + '–' + RailSync.hhmm(p.end)]);
            });
            return '<div class="tt-h"><span class="swatch" style="background:' + col + '"></span>' +
                RailSync.esc(sec.from) + ' – ' + RailSync.esc(sec.to) + ' · ' + state + '</div>' + RailSync.tipRows(rows);
        }
        function loopTip(st, held) {
            const rows = [
                ['Clear standing room', st.loopCsr + ' m'],
                ['Platforms', String(st.platforms)],
                ['Sidings', st.sidings.length ? st.sidings.join(', ') : '—']
            ];
            if (held.length) {
                held.forEach(function (h) {
                    rows.push(['Holding', h.rake + '  (' + h.lengthM + ' m)']);
                });
            }
            else {
                rows.push(['Status', 'Empty']);
            }
            // What this loop can and cannot take, which is the regulation decision.
            const takes = RailSync.D.trains.filter(function (t) {
                return t.kind === 'FREIGHT' && t.corridor === RailSync.S.corridor &&
                    (t.lengthM || 0) + 30 <= st.loopCsr;
            }).length;
            const total = RailSync.D.trains.filter(function (t) {
                return t.kind === 'FREIGHT' && t.corridor === RailSync.S.corridor;
            }).length;
            rows.push(['Takes', takes + ' of ' + total + ' rakes on this corridor']);
            return '<div class="tt-h"><span class="swatch" style="background:#29d3d9"></span>' +
                RailSync.esc(st.code) + ' Loop Line</div>' + RailSync.tipRows(rows);
        }
        function stationTip(st, dm) {
            const rows = [
                ['Chainage', 'KM ' + st.km.toFixed(1)],
                ['Platforms', String(st.platforms)],
                ['Platform loop', st.loop ? 'Yes · CSR ' + st.loopCsr + ' m' : 'No'],
                ['Crossovers', st.crossovers.length ? st.crossovers.join(', ') : '—'],
                ['Sidings', st.sidings.length ? st.sidings.join(', ') : '—']
            ];
            if (dm && dm.length)
                rows.push(['Machines stabled', String(dm.length)]);
            return '<div class="tt-h">' + RailSync.esc(st.code) + ' · ' + RailSync.esc(st.name) + '</div>' + RailSync.tipRows(rows);
        }
        function depotTip(st, dm) {
            const rows = dm.map(function (m) {
                return [m.id + ' (' + m.type + ')',
                    m.fitness + ' · crew ' + m.dutyHours.toFixed(1) + '/' + m.maxHours + ' h'];
            });
            rows.push(['HSD fuel', dm.map(function (m) { return Math.round(m.fuel) + ' L'; }).join(' · ')]);
            return '<div class="tt-h"><span class="swatch" style="background:#a78bfa"></span>' +
                RailSync.esc(st.code) + ' Machine Depot</div>' + RailSync.tipRows(rows);
        }
        function trainTip(r) {
            const tr = r.train;
            const rows = [
                ['Type', tr.kind === 'FREIGHT' ? 'Freight · ' + tr.name : tr.name],
                ['Line / direction', tr.line + ' · ' + tr.dir],
                ['Position', 'KM ' + r.pos.km.toFixed(2)],
                ['Speed', r.pos.speed.toFixed(0) + ' km/h' + (r.pos.moving ? '' : '  (standing)')],
                ['MPS', tr.mps + ' km/h']
            ];
            if (tr.kind === 'PASSENGER') {
                rows.push(['Delay', tr.delay > 0 ? tr.delay + ' min late' : 'Right time']);
            }
            else {
                rows.push(['Load', tr.wagons + ' wagons · ' + tr.tonnage + ' t']);
                rows.push(['Rake length', tr.lengthM + ' m']);
                rows.push(['Loopable', tr.canLoop ? 'Yes' : 'No — through path needed']);
            }
            return '<div class="tt-h"><span class="swatch" style="background:' + RailSync.CLS_COLOR[tr.cls] +
                '"></span>' + RailSync.esc(tr.no) + '</div>' + RailSync.tipRows(rows);
        }
        /* ------------------------------------------------------- corridor tabs */
        function bindTabs() {
            const box = RailSync.byId('corr-tabs');
            if (!box)
                return;
            RailSync.clear(box);
            RailSync.D.corridors.forEach(function (c) {
                const label = (SECTOR[c.id] || RailSync.shortCorr(c.id)) + ' · ' +
                    c.stations[0].code + '–' + c.stations[c.stations.length - 1].code;
                const b = RailSync.el('button', c.id === RailSync.S.corridor ? 'on' : '', label);
                b.dataset.c = c.id;
                b.addEventListener('click', function () {
                    RailSync.S.corridor = c.id;
                    RailSync.S.selDemand = null;
                    Array.prototype.forEach.call(box.children, function (n) {
                        n.classList.toggle('on', n.dataset.c === c.id);
                    });
                    RailSync.bus.emit('corridor');
                });
                box.appendChild(b);
            });
        }
        Network.bindTabs = bindTabs;
    })(Network = RailSync.Network || (RailSync.Network = {}));
})(RailSync || (RailSync = {}));
/// <reference path="core.ts" />
/* ============================================================
   (iii) Multi-Departmental Ingestion Feed & Scorer Queue,
   plus the AI block-proposal shortlist that feeds the drawer.
   ============================================================ */
var RailSync;
(function (RailSync) {
    var Queue;
    (function (Queue) {
        /* ------------------------------------------------------- filters */
        function buildFilters() {
            const box = RailSync.byId('q-filters');
            if (!box)
                return;
            RailSync.clear(box);
            box.appendChild(RailSync.el('span', 'f-lbl', 'Dept'));
            [['TMS', 'P-Way'], ['TDMS', 'TRD'], ['SMMS', 'S&T']].forEach(function (d) {
                const b = RailSync.el('button', 'f-btn' + (RailSync.S.filters.dept[d[0]] ? ' on' : ''), d[1]);
                b.title = d[0];
                b.addEventListener('click', function () {
                    RailSync.S.filters.dept[d[0]] = !RailSync.S.filters.dept[d[0]];
                    b.classList.toggle('on', RailSync.S.filters.dept[d[0]]);
                    renderQueue();
                });
                box.appendChild(b);
            });
            box.appendChild(RailSync.el('span', 'f-sep'));
            box.appendChild(RailSync.el('span', 'f-lbl', 'Urgency'));
            [['CRITICAL', 'Critical'], ['URGENT', 'Urgent'], ['ROUTINE', 'Routine']]
                .forEach(function (d) {
                const b = RailSync.el('button', 'f-btn' + (RailSync.S.filters.band[d[0]] ? ' on' : '') +
                    (d[0] === 'CRITICAL' ? ' crit' : ''), d[1]);
                b.addEventListener('click', function () {
                    RailSync.S.filters.band[d[0]] = !RailSync.S.filters.band[d[0]];
                    b.classList.toggle('on', RailSync.S.filters.band[d[0]]);
                    renderQueue();
                });
                box.appendChild(b);
            });
            box.appendChild(RailSync.el('span', 'f-sep'));
            const cb = RailSync.el('button', 'f-btn' + (RailSync.S.filters.corridorOnly ? ' on' : ''), 'This corridor only');
            cb.addEventListener('click', function () {
                RailSync.S.filters.corridorOnly = !RailSync.S.filters.corridorOnly;
                cb.classList.toggle('on', RailSync.S.filters.corridorOnly);
                renderQueue();
            });
            box.appendChild(cb);
        }
        Queue.buildFilters = buildFilters;
        function filtered() {
            return RailSync.D.queue.filter(function (q) {
                if (!RailSync.S.filters.dept[q.dept])
                    return false;
                if (!RailSync.S.filters.band[q.band])
                    return false;
                if (RailSync.S.filters.corridorOnly && q.corridor !== RailSync.S.corridor)
                    return false;
                return true;
            });
        }
        /* ------------------------------------------------------- queue table */
        function renderQueue() {
            const body = RailSync.byId('q-body');
            if (!body)
                return;
            RailSync.clear(body);
            const rows = filtered();
            const count = RailSync.byId('q-count');
            if (count)
                count.textContent = rows.length + ' / ' + RailSync.D.queue.length + ' demands';
            if (!rows.length) {
                const tr0 = RailSync.el('tr');
                const td0 = RailSync.el('td', 'empty', 'No demands match the current filters.');
                td0.colSpan = 7;
                tr0.appendChild(td0);
                body.appendChild(tr0);
                return;
            }
            rows.forEach(function (q) {
                const tr = RailSync.el('tr');
                if (RailSync.S.selDemand === q.id)
                    tr.className = 'sel';
                const c1 = RailSync.el('td');
                c1.appendChild(RailSync.el('span', 'mono', q.id));
                c1.style.whiteSpace = 'nowrap';
                tr.appendChild(c1);
                const c2 = RailSync.el('td');
                c2.appendChild(RailSync.el('span', 'dept-tag dept-' + q.dept, q.dept));
                tr.appendChild(c2);
                const c3 = RailSync.el('td', null, RailSync.shortCorr(q.corridor));
                const ln = RailSync.el('div', 'mono', q.line);
                ln.style.cssText = 'font-size:9.5px;color:var(--text-mute)';
                c3.appendChild(ln);
                tr.appendChild(c3);
                const c4 = RailSync.el('td', 'mono', q.chainage);
                c4.style.cssText = 'font-size:10.5px;white-space:nowrap';
                tr.appendChild(c4);
                const c5 = RailSync.el('td', 'mono', q.telemetry);
                c5.style.cssText = 'font-size:10.5px;white-space:nowrap';
                tr.appendChild(c5);
                const c6 = RailSync.el('td');
                c6.style.textAlign = 'right';
                const odc = q.overdueDays >= 10 ? 'od-hi' : q.overdueDays >= 4 ? 'od-md' : 'od-lo';
                c6.appendChild(RailSync.el('span', 'od-pill ' + odc, q.overdueDays ? q.overdueDays + 'd' : '—'));
                tr.appendChild(c6);
                const c7 = RailSync.el('td');
                const sc = RailSync.el('div', 'score-cell');
                const bar = RailSync.el('div', 'score-bar');
                const fill = RailSync.el('div', 'score-fill');
                fill.style.width = q.score + '%';
                fill.style.background = RailSync.scoreColor(q.score);
                bar.appendChild(fill);
                const num = RailSync.el('div', 'score-num', q.score.toFixed(0));
                num.style.color = RailSync.scoreColor(q.score);
                sc.appendChild(bar);
                sc.appendChild(num);
                c7.appendChild(sc);
                tr.appendChild(c7);
                tr.addEventListener('mousemove', function (e) { RailSync.tip(demandTip(q), e); });
                tr.addEventListener('mouseleave', RailSync.tipOff);
                tr.addEventListener('click', function () {
                    RailSync.S.selDemand = (RailSync.S.selDemand === q.id) ? null : q.id;
                    RailSync.tipOff();
                    renderQueue();
                    // Jump to whichever proposal already carries this demand.
                    const owner = RailSync.S.proposals.filter(function (p) {
                        return p.items.some(function (i) { return i.id === q.id; }) ||
                            p.added.some(function (a) { return a.id === q.id; });
                    })[0];
                    if (RailSync.S.selDemand && owner)
                        RailSync.bus.emit('openProposal', owner.id);
                });
                body.appendChild(tr);
            });
        }
        Queue.renderQueue = renderQueue;
        /** "Why this score?" — controllers distrust a bare number, so the tooltip
            leads with the physical parameters that produced it, then the component
            totals, then the score. */
        function demandTip(q) {
            const head = '<div class="tt-h"><span class="dept-tag dept-' + q.dept + '">' + q.dept +
                '</span>' + RailSync.esc(q.id) + '</div>';
            const rows = [
                ['Department', q.deptFull],
                ['Required action', q.action.replace(/_/g, ' ')],
                ['Section', RailSync.shortCorr(q.corridor) + ' · ' + q.line],
                ['Est. work time', q.durationMin + ' min']
            ];
            const drivers = '<div class="tt-why">Why this score?</div>' +
                q.drivers.map(function (d) {
                    const sign = d.pts > 0 ? '+' + d.pts.toFixed(1) : '—';
                    return '<div class="tt-r tt-drv"><span>' + RailSync.esc(d.k) + '</span>' +
                        '<span><b>' + RailSync.esc(d.v) + '</b><i class="tt-pts pt-' + d.part + '">' +
                        sign + '</i></span></div>';
                }).join('');
            const p = q.parts;
            const totals = '<div class="tt-r tt-sub"><span>condition</span><span>' + p.condition + ' / 40</span></div>' +
                '<div class="tt-r tt-sub"><span>overdue</span><span>' + p.overdue + ' / 25</span></div>' +
                '<div class="tt-r tt-sub"><span>safety</span><span>' + p.safety + ' / 20</span></div>' +
                '<div class="tt-r tt-sub"><span>exposure</span><span>' + p.exposure + ' / 15</span></div>' +
                '<div class="tt-r tt-total"><span>Urgency score</span><span style="color:' +
                RailSync.scoreColor(q.score) + '">' + q.score.toFixed(1) + '  ' + q.band + '</span></div>';
            return head + RailSync.tipRows(rows) +
                '<div class="tt-sec">' + drivers + '</div>' +
                '<div class="tt-sec">' + totals + '</div>';
        }
        /* ------------------------------------------------------- proposals */
        /** (vii) Rejection audit — the register of refused blocks and why. */
        function renderAudit() {
            const box = RailSync.byId('audit-list');
            if (!box)
                return;
            RailSync.clear(box);
            const refused = RailSync.S.proposals.filter(function (p) { return p.status === 'REJECTED'; });
            const sub = RailSync.byId('audit-sub');
            if (sub)
                sub.textContent = refused.length + ' refused this shift';
            if (!refused.length) {
                box.appendChild(RailSync.el('div', 'empty', 'No blocks refused. A rejection must carry an operational reason code, ' +
                    'and it is recorded here with what it leaves outstanding.'));
                return;
            }
            refused.forEach(function (p) {
                const it = RailSync.el('div', 'log-item');
                const dot = RailSync.el('div', 'log-dot');
                dot.style.background = 'var(--red)';
                it.appendChild(dot);
                const b = RailSync.el('div', 'log-body');
                const t = RailSync.el('div', 'log-t');
                t.appendChild(RailSync.el('b', null, p.id));
                t.appendChild(document.createTextNode('  ' + p.section + ' · ' + p.line));
                b.appendChild(t);
                if (p.rejectedFor) {
                    const code = RailSync.el('div', 'log-m');
                    const chip = RailSync.el('span', 'chip crit', p.rejectedFor.code);
                    code.appendChild(chip);
                    code.appendChild(document.createTextNode('  ' + p.rejectedFor.label));
                    b.appendChild(code);
                    b.appendChild(RailSync.el('div', 'log-m', p.rejectedFor.detail));
                }
                b.appendChild(RailSync.el('div', 'log-m', (p.items.length + p.added.length) + ' demand(s) back to backlog · ' +
                    p.impact.overdueDaysCleared + ' overdue-days still outstanding'));
                it.appendChild(b);
                it.addEventListener('click', function () { RailSync.bus.emit('openProposal', p.id); });
                it.style.cursor = 'pointer';
                box.appendChild(it);
            });
        }
        Queue.renderAudit = renderAudit;
        function renderProposals() {
            const box = RailSync.byId('prop-list');
            if (!box)
                return;
            RailSync.clear(box);
            const rank = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
            const list = RailSync.S.proposals.slice().sort(function (a, b) {
                if (rank[a.status] !== rank[b.status])
                    return rank[a.status] - rank[b.status];
                return b.score - a.score;
            });
            const pending = RailSync.S.proposals.filter(function (p) { return p.status === 'PENDING'; }).length;
            const approved = RailSync.S.proposals.filter(function (p) { return p.status === 'APPROVED'; }).length;
            const pp = RailSync.byId('prop-pending');
            if (pp)
                pp.textContent = pending + ' pending';
            const ps = RailSync.byId('prop-sub');
            if (ps)
                ps.textContent = RailSync.S.proposals.length + ' generated · ' + approved + ' approved';
            list.forEach(function (p) {
                const dur = RailSync.totalDuration(p);
                const im = p.impact;
                const row = RailSync.el('div', 'log-item');
                row.style.cursor = 'pointer';
                if (RailSync.S.selProposal === p.id)
                    row.style.background = 'rgba(245,185,66,.10)';
                const dot = RailSync.el('div', 'log-dot');
                dot.style.background = p.status === 'APPROVED' ? 'var(--green)'
                    : p.status === 'REJECTED' ? 'var(--text-mute)' : RailSync.scoreColor(p.score);
                row.appendChild(dot);
                const b = RailSync.el('div', 'log-body');
                const t = RailSync.el('div', 'log-t');
                t.appendChild(RailSync.el('b', null, p.id));
                t.appendChild(document.createTextNode('  ' + p.section + ' · ' + p.line));
                b.appendChild(t);
                b.appendChild(RailSync.el('div', 'log-m', RailSync.hhmm(p.start) + '–' + RailSync.hhmm(p.start + dur) + ' · window ' + dur +
                    ' min / work ' + p.window.workMin + ' min · ' +
                    (p.items.length + p.added.length) + ' task(s) · ' +
                    (p.machines.length ? p.machines.map(function (x) { return x.id; }).join('+') : 'manual gang')));
                const m2 = RailSync.el('div', 'log-m');
                m2.style.marginTop = '4px';
                m2.appendChild(RailSync.el('span', 'chip ' + (im.paxDelayMin === 0 ? 'rout' : 'crit'), im.paxDelayMin === 0 ? '0 min delay' : im.paxDelayMin + ' min delay'));
                if (im.freightLooped) {
                    const d2 = RailSync.el('span', 'chip urg', im.freightLooped + ' freight looped');
                    d2.style.marginLeft = '4px';
                    m2.appendChild(d2);
                }
                if (p.savings.savedMin > 0) {
                    const d4 = RailSync.el('span', 'chip', '−' + p.savings.savedMin + ' min bundled');
                    d4.style.marginLeft = '4px';
                    m2.appendChild(d4);
                }
                if (p.status !== 'PENDING') {
                    const d3 = RailSync.el('span', 'chip' + (p.status === 'APPROVED' ? ' rout' : ''), p.status);
                    d3.style.marginLeft = '4px';
                    m2.appendChild(d3);
                }
                b.appendChild(m2);
                row.appendChild(b);
                const sc = RailSync.el('div', 'log-time', p.score.toFixed(0));
                sc.style.cssText += ';font-size:14px;font-weight:700;color:' + RailSync.scoreColor(p.score);
                row.appendChild(sc);
                row.addEventListener('click', function () { RailSync.bus.emit('openProposal', p.id); });
                box.appendChild(row);
            });
        }
        Queue.renderProposals = renderProposals;
    })(Queue = RailSync.Queue || (RailSync.Queue = {}));
})(RailSync || (RailSync = {}));
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
var RailSync;
(function (RailSync) {
    var Drawer;
    (function (Drawer) {
        let shiftDelta = 0; // minutes, while the controller drags the slider
        let rejectMode = false;
        function find(id) {
            return RailSync.S.proposals.filter(function (p) { return p.id === id; })[0];
        }
        function open(id) {
            RailSync.S.selProposal = id;
            shiftDelta = 0;
            rejectMode = false;
            RailSync.S.overrunMin = 0;
            const dw = RailSync.byId('drawer');
            if (dw)
                dw.classList.add('on');
            render();
            RailSync.bus.emit('render');
        }
        Drawer.open = open;
        function close() {
            RailSync.S.selProposal = null;
            const dw = RailSync.byId('drawer');
            if (dw)
                dw.classList.remove('on');
            RailSync.bus.emit('render');
        }
        Drawer.close = close;
        /* ------------------------------------------------------- building blocks */
        function sec(title, node) {
            const s = RailSync.el('div', 'dw-sec');
            s.appendChild(RailSync.el('h3', null, title));
            s.appendChild(node);
            return s;
        }
        function kv(pairs) {
            const d = RailSync.el('dl', 'kv');
            pairs.forEach(function (p) {
                if (p[1] === null || p[1] === undefined || p[1] === '')
                    return;
                d.appendChild(RailSync.el('dt', null, p[0]));
                d.appendChild(RailSync.el('dd', null, p[1]));
            });
            return d;
        }
        function impactTile(v, k, cls) {
            const d = RailSync.el('div', 'impact ' + (cls || ''));
            d.appendChild(RailSync.el('div', 'i-v', String(v)));
            d.appendChild(RailSync.el('div', 'i-k', k));
            return d;
        }
        function taskCard(i, isShadow) {
            const c = RailSync.el('div', 'card');
            const h = RailSync.el('div', 'card-h');
            h.appendChild(RailSync.el('span', 'dept-tag dept-' + i.dept, i.dept));
            h.appendChild(RailSync.el('b', null, i.id));
            const sp = RailSync.el('span', 'chip ' +
                (i.band === 'CRITICAL' ? 'crit' : i.band === 'URGENT' ? 'urg' : 'rout'), i.score !== undefined ? i.score.toFixed(0) : '—');
            sp.style.marginLeft = 'auto';
            h.appendChild(sp);
            c.appendChild(h);
            c.appendChild(RailSync.el('div', 'card-m', i.action.replace(/_/g, ' ') + '  ·  ' + i.chainage + '  ·  ' + i.telemetry +
                '  ·  ' + (i.overdueDays || 0) + 'd overdue'));
            // the physical drivers, inline — same "why this score" the queue shows
            if (i.drivers && i.drivers.length) {
                const dv = RailSync.el('div', 'drv-row');
                i.drivers.filter(function (d) { return d.pts > 0; }).forEach(function (d) {
                    const chip = RailSync.el('span', 'drv pt-' + d.part);
                    chip.appendChild(RailSync.el('span', 'drv-k', d.k));
                    chip.appendChild(RailSync.el('span', 'drv-v', d.v));
                    chip.appendChild(RailSync.el('span', 'drv-p', '+' + d.pts.toFixed(0)));
                    dv.appendChild(chip);
                });
                c.appendChild(dv);
            }
            if (isShadow) {
                const b = RailSync.el('div', 'card-m', 'Bundled by controller (shadow suggestion)');
                b.style.color = 'var(--violet)';
                c.appendChild(b);
            }
            return c;
        }
        function mergeImpact(p, fresh) {
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
        function render() {
            const p = find(RailSync.S.selProposal);
            const bd = RailSync.byId('dw-bd');
            const ft = RailSync.byId('dw-ft');
            if (!bd || !ft)
                return;
            if (!p) {
                RailSync.clear(bd);
                RailSync.clear(ft);
                return;
            }
            const dur = RailSync.totalDuration(p);
            const start = p.start + shiftDelta;
            const im = shiftDelta ? RailSync.scoreWindow(p, start, dur) : p.impact;
            const idEl = RailSync.byId('dw-id');
            if (idEl)
                idEl.textContent = p.id;
            const st = RailSync.byId('dw-status');
            if (st) {
                st.textContent = p.status;
                st.className = 'chip ' + (p.status === 'APPROVED' ? 'rout' : p.status === 'REJECTED' ? '' : 'urg');
            }
            const subEl = RailSync.byId('dw-sub');
            if (subEl)
                subEl.textContent = p.corridorName + '  ·  ' + p.section + '  ·  ' + p.line;
            RailSync.clear(bd);
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
            const tasks = RailSync.el('div');
            if (p.savings.savedMin > 0) {
                const cal = RailSync.el('div', 'callout');
                cal.appendChild(RailSync.el('div', 'callout-v', '−' + p.savings.savedMin + ' min'));
                cal.appendChild(RailSync.el('div', 'callout-t', 'Bundling ' + p.savings.depts.join(' + ') + ' into one possession saves ' +
                    p.savings.savedMin + ' minutes of independent line possession (' +
                    p.savings.independentMin + ' min as ' + p.savings.tasks +
                    ' separate blocks vs ' + p.savings.bundledMin + ' min bundled) — ' +
                    'protection, isolation and traffic cost are paid once.'));
                tasks.appendChild(cal);
            }
            p.items.forEach(function (i) { tasks.appendChild(taskCard(i, false)); });
            p.added.forEach(function (a) {
                const q = RailSync.D.queue.filter(function (x) { return x.id === a.id; })[0];
                if (q)
                    tasks.appendChild(taskCard(q, true));
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
            if (p.postTsr)
                bd.appendChild(sec('Post-Work Speed Restriction', postTsrBlock(p)));
            /* ---- 9. shift time slot ---- */
            bd.appendChild(sec('Shift Time Slot', shiftControl(p, dur, start, im)));
            /* ---- 10. shadow bundling ---- */
            if (p.shadow && p.shadow.length) {
                bd.appendChild(sec('Shadow Bundling Suggestions', shadowList(p)));
            }
            /* ---- 11. the issued control order ---- */
            if (p.order)
                bd.appendChild(sec('Control Order Issued', orderBlock(p)));
            /* ---- 12. why it was refused ---- */
            if (p.status === 'REJECTED' && p.rejectedFor) {
                const r = RailSync.el('div');
                const c = RailSync.el('div', 'card');
                const h = RailSync.el('div', 'card-h');
                h.appendChild(RailSync.el('span', 'chip crit', p.rejectedFor.code));
                h.appendChild(RailSync.el('b', null, p.rejectedFor.label));
                c.appendChild(h);
                c.appendChild(RailSync.el('div', 'card-m', p.rejectedFor.detail));
                r.appendChild(c);
                bd.appendChild(sec('Rejection Reason', r));
            }
            renderFooter(p, im, start, dur, ft);
        }
        Drawer.render = render;
        /* ---------------------------------------- work vs granted window */
        function windowBreakdown(p, dur, start) {
            const w = p.window;
            const wrap = RailSync.el('div');
            const head = RailSync.el('div', 'win-head');
            const a = RailSync.el('div');
            a.appendChild(RailSync.el('div', 'win-k', 'Total block window'));
            a.appendChild(RailSync.el('div', 'win-v', RailSync.hhmm(start) + ' – ' + RailSync.hhmm(start + dur)));
            a.appendChild(RailSync.el('div', 'win-s', dur + ' min granted'));
            head.appendChild(a);
            const b = RailSync.el('div');
            b.appendChild(RailSync.el('div', 'win-k', 'Physical work time'));
            const wv = RailSync.el('div', 'win-v', w.workMin + ' min');
            wv.style.color = 'var(--green)';
            b.appendChild(wv);
            b.appendChild(RailSync.el('div', 'win-s', (dur - w.workMin) + ' min overheads'));
            head.appendChild(b);
            wrap.appendChild(head);
            // stacked bar: protection / earthing / ramp / work / ramp / earthing / protection
            const bar = RailSync.el('div', 'win-bar');
            const segs = [];
            if (w.protectionMin)
                segs.push([w.protectionMin / 2, 'seg-prot', 'Protection set ' + (w.protectionMin / 2) + ' min']);
            if (w.earthingMin)
                segs.push([w.earthingMin / 2, 'seg-earth', 'OHE earthing ' + (w.earthingMin / 2) + ' min']);
            if (w.rampMin)
                segs.push([w.rampMin / 2, 'seg-ramp', 'Machine ramp in ' + (w.rampMin / 2) + ' min']);
            segs.push([w.workMin, 'seg-work', 'Physical work ' + w.workMin + ' min']);
            if (w.rampMin)
                segs.push([w.rampMin / 2, 'seg-ramp', 'Machine ramp out ' + (w.rampMin / 2) + ' min']);
            if (w.earthingMin)
                segs.push([w.earthingMin / 2, 'seg-earth', 'OHE de-earthing ' + (w.earthingMin / 2) + ' min']);
            if (w.protectionMin)
                segs.push([w.protectionMin / 2, 'seg-prot', 'Protection withdrawn ' + (w.protectionMin / 2) + ' min']);
            segs.forEach(function (sg) {
                const n = RailSync.el('i', sg[1]);
                n.style.width = (100 * sg[0] / dur) + '%';
                n.title = sg[2];
                bar.appendChild(n);
            });
            wrap.appendChild(bar);
            const key = RailSync.el('div', 'win-key');
            [['seg-prot', 'Protection'], ['seg-earth', 'Earthing'],
                ['seg-ramp', 'Ramp'], ['seg-work', 'Work']].forEach(function (k) {
                if (k[0] === 'seg-earth' && !w.earthingMin)
                    return;
                if (k[0] === 'seg-ramp' && !w.rampMin)
                    return;
                const i = RailSync.el('i');
                i.appendChild(RailSync.el('b', k[0]));
                i.appendChild(document.createTextNode(k[1]));
                key.appendChild(i);
            });
            wrap.appendChild(key);
            return wrap;
        }
        /* ---------------------------------------- plant + crew HOER */
        function machineList(p, dur) {
            const mc = RailSync.el('div');
            if (p.machines.length) {
                p.machines.forEach(function (m) {
                    const c = RailSync.el('div', 'card');
                    const h = RailSync.el('div', 'card-h');
                    h.appendChild(RailSync.el('b', null, m.id + '  ·  ' + m.model));
                    h.appendChild(RailSync.el('span', 'chip', m.type));
                    c.appendChild(h);
                    // HOER red line badge — the headline a controller scans for
                    const safe = !m.crewRelief;
                    const badge = RailSync.el('div', 'hoer' + (safe ? ' ok' : ' bad'));
                    badge.appendChild(RailSync.el('span', 'hoer-k', 'Crew duty remaining'));
                    badge.appendChild(RailSync.el('span', 'hoer-v', fmtHours(m.crewRemainingHours)));
                    badge.appendChild(RailSync.el('span', 'hoer-s', safe ? 'Safe for this ' + dur + ' min block'
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
            }
            else if (!p.plantShortfall || !p.plantShortfall.length) {
                mc.appendChild(RailSync.el('div', 'mini-note', 'No track machine required — manual gang / S&T staff possession.'));
            }
            if (p.plantShortfall && p.plantShortfall.length) {
                const counts = {};
                p.plantShortfall.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
                const list = Object.keys(counts).map(function (t) { return counts[t] + '× ' + t; }).join(', ');
                const n = RailSync.el('div', 'mini-note', 'Plant shortfall: ' + list + ' could not be sourced for this window — no fit machine of ' +
                    'that type is free. Shift the slot, split the work, or run the balance as a manual gang.');
                n.style.color = 'var(--amber)';
                mc.appendChild(n);
            }
            return mc;
        }
        function fmtHours(h) {
            const m = Math.round(h * 60);
            return Math.floor(m / 60) + 'h ' + RailSync.pad2(m % 60) + 'm';
        }
        /* ---------------------------------------- impact */
        function impactBlock(p, im, start, dur) {
            const grid = RailSync.el('div', 'impact-grid');
            grid.appendChild(impactTile(im.paxDelayMin, 'Train delay induced (min)', im.paxDelayMin === 0 ? 'ok' : 'warn'));
            grid.appendChild(impactTile(im.freightLooped, 'Freight regulated to loops', im.freightLooped ? 'warn' : 'ok'));
            grid.appendChild(impactTile(p.items.length + p.added.length, 'Backlog demands cleared', 'ok'));
            grid.appendChild(impactTile(p.impact.overdueDaysCleared, 'Overdue-days retired', 'ok'));
            const wrap = RailSync.el('div');
            wrap.appendChild(grid);
            if (im.paxDelayMin === 0) {
                wrap.appendChild(RailSync.el('div', 'mini-note', 'Window verified clear: no booked path on ' + p.lines.join('/') + ' crosses KM ' +
                    p.loKm.toFixed(1) + '–' + p.hiKm.toFixed(1) + ' between ' +
                    RailSync.hhmm(start) + ' and ' + RailSync.hhmm(start + dur) + '.'));
            }
            else {
                wrap.appendChild(RailSync.el('div', 'mini-note', 'Conflicting paths: ' +
                    im.conflictTrains.map(function (t) { return t.no; }).join(', ')));
            }
            return wrap;
        }
        /* ---------------------------------------- freight regulation */
        function regulationList(p) {
            const wrap = RailSync.el('div');
            p.regulation.forEach(function (rg) {
                const c = RailSync.el('div', 'card');
                const h = RailSync.el('div', 'card-h');
                h.appendChild(RailSync.el('b', null, rg.rake));
                h.appendChild(RailSync.el('span', 'chip ' + (rg.fits ? 'rout' : 'crit'), rg.fits ? rg.loop + ' loop' : 'NO LOOP'));
                c.appendChild(h);
                c.appendChild(RailSync.el('div', 'card-m', rg.fits
                    ? 'Rake ' + rg.lengthM + ' m stands in ' + rg.loop + ' loop (CSR ' +
                        rg.loopCsr + ' m) — ' + Math.round((rg.loopCsr || 0) - (rg.lengthM || 0)) +
                        ' m clearance including overlap.'
                    : 'Rake ' + rg.lengthM + ' m exceeds the clear standing room of every loop on ' +
                        'this corridor; it would have to stand on the running line.'));
                wrap.appendChild(c);
            });
            wrap.appendChild(RailSync.el('div', 'mini-note', 'A loop only counts if its clear standing room takes the rake plus signal overlap.'));
            return wrap;
        }
        /* ---------------------------------------- overrun burst buffer */
        function overrunControl(p, start, dur) {
            const wrap = RailSync.el('div');
            const row = RailSync.el('div', 'seg');
            row.style.marginBottom = '8px';
            [[0, 'On time'], [15, '+15 min'], [30, '+30 min']]
                .forEach(function (o) {
                const b = RailSync.el('button', RailSync.S.overrunMin === o[0] ? 'on' : '', o[1]);
                b.addEventListener('click', function () {
                    RailSync.S.overrunMin = o[0];
                    render();
                });
                row.appendChild(b);
            });
            wrap.appendChild(row);
            if (RailSync.S.overrunMin === 0) {
                wrap.appendChild(RailSync.el('div', 'mini-note', 'Machines fail and gangs take longer to pack up; a block routinely spills past ' +
                    'its booked hand-back. Simulate an overrun to see which paths take the knock-on.'));
                return wrap;
            }
            const proj = RailSync.projectOverrun(p, start, dur, RailSync.S.overrunMin);
            const grid = RailSync.el('div', 'impact-grid');
            grid.appendChild(impactTile(proj.trains.length, 'Trains taking knock-on', proj.trains.length ? 'warn' : 'ok'));
            grid.appendChild(impactTile(proj.totalDelayMin, 'Cascade delay (min)', proj.totalDelayMin ? 'warn' : 'ok'));
            wrap.appendChild(grid);
            if (!proj.trains.length) {
                const n = RailSync.el('div', 'mini-note', 'Hand-back at ' + RailSync.hhmm(start + dur + RailSync.S.overrunMin) + ' still clears every booked path — ' +
                    'this window carries a ' + RailSync.S.overrunMin + ' minute buffer.');
                n.style.color = 'var(--green)';
                wrap.appendChild(n);
            }
            else {
                proj.trains.slice(0, 5).forEach(function (t) {
                    const c = RailSync.el('div', 'card');
                    const h = RailSync.el('div', 'card-h');
                    h.appendChild(RailSync.el('span', 'swatch'));
                    h.firstChild.style.background = RailSync.CLS_COLOR[t.cls];
                    h.appendChild(RailSync.el('b', null, t.no + ' · ' + t.name));
                    const chip = RailSync.el('span', 'chip crit', '+' + t.delayMin + ' min');
                    chip.style.marginLeft = 'auto';
                    h.appendChild(chip);
                    c.appendChild(h);
                    wrap.appendChild(c);
                });
                const n = RailSync.el('div', 'mini-note', 'If the gang hands back ' + RailSync.S.overrunMin + ' min late (' +
                    RailSync.hhmm(start + dur + RailSync.S.overrunMin) + '), ' + proj.trains.length +
                    ' path(s) are held, worst case +' + proj.worst + ' min.');
                n.style.color = 'var(--red)';
                wrap.appendChild(n);
            }
            return wrap;
        }
        /* ---------------------------------------- post-work TSR */
        function postTsrBlock(p) {
            const t = p.postTsr;
            const wrap = RailSync.el('div');
            const cal = RailSync.el('div', 'callout warn');
            cal.appendChild(RailSync.el('div', 'callout-v', t.speed + ' km/h'));
            cal.appendChild(RailSync.el('div', 'callout-t', 'Post-work TSR: ' + t.speed + ' km/h over ' + t.lengthKm + ' km for ' + t.hours +
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
        function orderBlock(p) {
            const o = p.order;
            const wrap = RailSync.el('div');
            const pn = RailSync.el('div', 'pn-row');
            const a = RailSync.el('div', 'pn');
            a.appendChild(RailSync.el('span', 'pn-k', 'Private Number — SM'));
            a.appendChild(RailSync.el('span', 'pn-v', String(o.pnSm)));
            pn.appendChild(a);
            if (o.pnTpc !== null) {
                const b = RailSync.el('div', 'pn');
                b.appendChild(RailSync.el('span', 'pn-k', 'Private Number — TPC'));
                b.appendChild(RailSync.el('span', 'pn-v', String(o.pnTpc)));
                pn.appendChild(b);
            }
            wrap.appendChild(pn);
            const pre = RailSync.el('pre', 'memo');
            pre.textContent = o.text;
            wrap.appendChild(pre);
            const copy = RailSync.el('button', 'btn btn-sh', 'Copy control order');
            copy.addEventListener('click', function () {
                const ta = RailSync.el('textarea');
                ta.value = o.text;
                document.body.appendChild(ta);
                ta.select();
                try {
                    document.execCommand('copy');
                    RailSync.toast('Control order copied to clipboard');
                }
                catch (e) {
                    RailSync.toast('Select the memo text to copy', 'warn');
                }
                document.body.removeChild(ta);
            });
            copy.style.marginTop = '7px';
            wrap.appendChild(copy);
            return wrap;
        }
        /* ---------------------------------------- shift slot */
        function shiftControl(p, dur, start, im) {
            const sh = RailSync.el('div');
            const row = RailSync.el('div', 'shift-row');
            const minus = RailSync.el('button', 'f-btn', '−15');
            const rng = RailSync.el('input');
            rng.type = 'range';
            rng.min = '-240';
            rng.max = '240';
            rng.step = '5';
            rng.value = String(shiftDelta);
            const plus = RailSync.el('button', 'f-btn', '+15');
            const out = RailSync.el('span', 'mono', (shiftDelta >= 0 ? '+' : '') + shiftDelta + ' min');
            out.style.cssText = 'width:74px;text-align:right;font-size:11.5px';
            function apply(v) {
                shiftDelta = Math.max(-240, Math.min(240, v));
                if (p.start + shiftDelta < 0)
                    shiftDelta = -p.start;
                if (p.start + shiftDelta + dur > RailSync.DAY)
                    shiftDelta = RailSync.DAY - dur - p.start;
                render();
            }
            minus.addEventListener('click', function () { apply(shiftDelta - 15); });
            plus.addEventListener('click', function () { apply(shiftDelta + 15); });
            rng.addEventListener('input', function () { apply(+rng.value); });
            row.appendChild(minus);
            row.appendChild(rng);
            row.appendChild(plus);
            row.appendChild(out);
            sh.appendChild(row);
            const note = RailSync.el('div', 'recalc');
            if (shiftDelta === 0) {
                note.textContent = 'AI-optimised slot. Drag to test an alternative window — impact re-scores live.';
            }
            else {
                const base = p.impact.paxDelayMin;
                const verdict = im.paxDelayMin === base ? 'same traffic cost as the AI slot'
                    : im.paxDelayMin < base ? 'better than the AI slot'
                        : 'worse — ' + (im.paxDelayMin - base) + ' min more delay than the AI slot';
                note.textContent = 'Shifted to ' + RailSync.hhmm(start) + '–' + RailSync.hhmm(start + dur) + ': ' + verdict + '.';
                note.style.color = im.paxDelayMin > base ? 'var(--red)' : 'var(--green)';
            }
            sh.appendChild(note);
            return sh;
        }
        /* ---------------------------------------- shadow bundling */
        function shadowList(p) {
            const shd = RailSync.el('div');
            p.shadow.forEach(function (s) {
                const added = p.added.some(function (a) { return a.id === s.id; });
                const it = RailSync.el('div', 'shadow-item' + (added ? ' added' : ''));
                const g = RailSync.el('div', 'grow');
                const t1 = RailSync.el('div', 'log-t');
                t1.appendChild(RailSync.el('b', null, s.id));
                g.appendChild(t1);
                g.appendChild(RailSync.el('div', 'log-m', s.action.replace(/_/g, ' ') + ' · ' + s.chainage + ' · ' + s.gapKm + ' km away'));
                g.appendChild(RailSync.el('div', 'log-m', s.note));
                it.appendChild(g);
                const btn = RailSync.el('button', 'add', added ? 'Added' : '+ Bundle');
                btn.disabled = p.status !== 'PENDING';
                btn.addEventListener('click', function () {
                    if (added) {
                        p.added = p.added.filter(function (a) { return a.id !== s.id; });
                        RailSync.logEvent('bundle', p.id + ' — shadow task removed', s.id + ' dropped from the possession.', p.id);
                    }
                    else {
                        p.added.push(s);
                        RailSync.logEvent('bundle', p.id + ' — shadow task bundled', s.id + ' folded into the same possession (+' + s.addMin +
                            ' min, no extra protection).', p.id);
                    }
                    p.impact = mergeImpact(p, RailSync.scoreWindow(p, p.start, RailSync.totalDuration(p)));
                    render();
                    RailSync.bus.emit('render');
                });
                it.appendChild(btn);
                shd.appendChild(it);
            });
            shd.appendChild(RailSync.el('div', 'mini-note', 'Shadow bundling folds nearby pending work into a possession that is already being taken — ' +
                'the protection, isolation and traffic cost are paid once.'));
            return shd;
        }
        /* ---------------------------------------- footer / decisions */
        function renderFooter(p, im, start, dur, ft) {
            RailSync.clear(ft);
            if (p.status !== 'PENDING') {
                const reopen = RailSync.el('button', 'btn', 'Reopen as Pending');
                reopen.addEventListener('click', function () {
                    p.status = 'PENDING';
                    delete p.rejectedFor;
                    RailSync.logEvent('reopen', p.id + ' reopened', 'Returned to the pending queue for re-evaluation.', p.id);
                    render();
                    RailSync.bus.emit('render');
                });
                ft.appendChild(reopen);
                return;
            }
            if (rejectMode) {
                // A block cannot be refused without an operational justification.
                const box = RailSync.el('div', 'reason-box');
                box.appendChild(RailSync.el('div', 'reason-h', 'Select a reason code — required for the register'));
                p.reasons.forEach(function (rc) {
                    const b = RailSync.el('button', 'reason');
                    b.appendChild(RailSync.el('span', 'chip crit', rc.code));
                    const g = RailSync.el('div', 'grow');
                    g.appendChild(RailSync.el('div', 'reason-l', rc.label));
                    g.appendChild(RailSync.el('div', 'reason-d', rc.detail));
                    b.appendChild(g);
                    b.addEventListener('click', function () { doReject(p, rc); });
                    box.appendChild(b);
                });
                const cancel = RailSync.el('button', 'btn', 'Cancel');
                cancel.addEventListener('click', function () { rejectMode = false; render(); });
                box.appendChild(cancel);
                ft.appendChild(box);
                ft.classList.add('tall');
                return;
            }
            ft.classList.remove('tall');
            const ok = RailSync.el('button', 'btn btn-ok', shiftDelta ? 'Approve Shifted + Issue Order' : 'Approve + Issue Order');
            ok.addEventListener('click', function () { doApprove(p, im, start, dur); });
            const no = RailSync.el('button', 'btn btn-no', 'Reject / Defer');
            no.addEventListener('click', function () { rejectMode = true; render(); });
            ft.appendChild(ok);
            ft.appendChild(no);
            if (shiftDelta) {
                const rs = RailSync.el('button', 'btn btn-sh', 'Reset');
                rs.addEventListener('click', function () { shiftDelta = 0; render(); });
                ft.appendChild(rs);
            }
        }
        function doApprove(p, im, start, dur) {
            if (shiftDelta) {
                p.start = start;
                RailSync.logEvent('shift', p.id + ' slot shifted', 'Moved ' + (shiftDelta > 0 ? '+' : '') + shiftDelta + ' min to ' +
                    RailSync.hhmm(start) + '–' + RailSync.hhmm(start + dur) + '.', p.id);
            }
            p.end = p.start + dur;
            p.impact = mergeImpact(p, im);
            p.status = 'APPROVED';
            p.order = RailSync.issueOrder(p, p.start, dur);
            shiftDelta = 0;
            RailSync.logEvent('approve', p.id + ' approved — PN ' + p.order.pnSm +
                (p.order.pnTpc !== null ? '/' + p.order.pnTpc : ''), p.section + ' · ' + p.lines.join('+') + ' · ' + RailSync.hhmm(p.start) + '–' + RailSync.hhmm(p.end) +
                ' (' + dur + ' min window, ' + p.window.workMin + ' min work) · ' +
                (p.items.length + p.added.length) + ' task(s) cleared · ' +
                im.paxDelayMin + ' min train delay induced · ' +
                im.freightLooped + ' rake(s) regulated into loops' +
                (p.postTsr ? ' · post-work TSR ' + p.postTsr.speed + ' km/h for ' + p.postTsr.hours + ' h' : '') +
                '.', p.id);
            RailSync.toast('Block ' + p.id + ' approved — Private Number ' + p.order.pnSm);
            render();
            RailSync.bus.emit('render');
        }
        function doReject(p, rc) {
            p.status = 'REJECTED';
            p.rejectedFor = rc;
            rejectMode = false;
            const cleared = p.items.length + p.added.length;
            const worst = p.items.reduce(function (a, b) {
                return (a && a.score > b.score) ? a : b;
            }, null);
            RailSync.logEvent('reject', p.id + ' rejected — [' + rc.code + '] ' + rc.label, rc.detail + ' Deferred: ' + cleared + ' demand(s) returned to the backlog, ' +
                p.impact.overdueDaysCleared + ' overdue-days remain outstanding. ' +
                'Highest exposure left open: ' +
                (worst ? worst.id + ' (urgency ' + worst.score.toFixed(0) + ', ' +
                    worst.overdueDays + 'd overdue)' : '—') +
                '. Section ' + p.section + ' · ' + p.line + '.', p.id);
            RailSync.toast('Block ' + p.id + ' refused — ' + rc.code, 'bad');
            render();
            RailSync.bus.emit('render');
        }
        /* ------------------------------------------------------- wiring */
        function bind() {
            const c = RailSync.byId('dw-close');
            if (c)
                c.addEventListener('click', close);
            RailSync.bus.on('openProposal', function (id) { open(id); });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && RailSync.S.selProposal)
                    close();
            });
        }
        Drawer.bind = bind;
    })(Drawer = RailSync.Drawer || (RailSync.Drawer = {}));
})(RailSync || (RailSync = {}));
/// <reference path="core.ts" />
/* ============================================================
   (v)   Reports & Analytics — punctuality, TSR register, sectional temperature
   (vii) Logs & History — controller decisions with structured reason codes

   Mobile resources live in Fleet; fixed track assets live in the ingestion
   feed. This file does not duplicate either.
   ============================================================ */
var RailSync;
(function (RailSync) {
    var Analytics;
    (function (Analytics) {
        const CORR_LABEL = {
            CORR_NORTH: 'North · DLI–PNP', CORR_EAST: 'East · GZB–MTC',
            CORR_SOUTH: 'South · NZM–PWL', CORR_WEST: 'West · DLI–ROK'
        };
        const DEPT_LABEL = {
            TMS: 'TMS · P-Way', TDMS: 'TDMS · TRD', SMMS: 'SMMS · S&T'
        };
        const DEPT_COLOR = {
            TMS: '#f5b942', TDMS: '#4a9eff', SMMS: '#a78bfa'
        };
        function panel(title, sub) {
            const root = RailSync.el('div', 'panel');
            const h = RailSync.el('div', 'panel-hd');
            h.appendChild(RailSync.el('h2', null, title));
            if (sub)
                h.appendChild(RailSync.el('span', 'sub', sub));
            root.appendChild(h);
            const body = RailSync.el('div', 'panel-bd');
            root.appendChild(body);
            return { root: root, body: body };
        }
        function bar(label, pct, valTxt, color) {
            const r = RailSync.el('div', 'bar-row');
            r.appendChild(RailSync.el('div', 'lbl', label));
            const tr = RailSync.el('div', 'track');
            const f = RailSync.el('div', 'fill');
            f.style.width = Math.max(0, Math.min(100, pct)) + '%';
            f.style.background = color;
            tr.appendChild(f);
            r.appendChild(tr);
            r.appendChild(RailSync.el('div', 'val', valTxt));
            return r;
        }
        function punctColor(p) {
            return p >= 90 ? '#2ecc71' : p >= 75 ? '#f5b942' : '#ff4d4f';
        }
        /* ============================================================ REPORTS */
        function renderReports() {
            const g = RailSync.byId('rep-grid');
            if (!g)
                return;
            RailSync.clear(g);
            const m = RailSync.D.metrics;
            /* -- headline punctuality -- */
            const p1 = panel('Division Punctuality Index', 'on-time = within 15 min');
            p1.root.classList.add('span2');
            const box = RailSync.el('div');
            box.style.padding = '12px';
            const big = RailSync.el('div', 'mono', m.punctuality.toFixed(1) + '%');
            big.style.cssText = 'font-size:44px;font-weight:700;line-height:1;color:' + punctColor(m.punctuality);
            box.appendChild(big);
            const sub = RailSync.el('div', 'mini-note', m.trainsOnTime + ' of ' + m.trainsRun + ' passenger trains right time · avg delay ' +
                m.avgDelay + ' min · worst ' + m.maxDelay + ' min · ' + m.freightRakes + ' freight rakes handled');
            sub.style.padding = '6px 0 12px';
            box.appendChild(sub);
            Object.keys(m.byCorridor).forEach(function (c) {
                const v = m.byCorridor[c];
                box.appendChild(bar(CORR_LABEL[c] || c, v.pct, v.pct.toFixed(1) + '%', punctColor(v.pct)));
            });
            p1.body.appendChild(box);
            g.appendChild(p1.root);
            /* -- punctuality by train class -- */
            const p2 = panel('Punctuality by Train Class', 'COA / RTIS actuals');
            p2.root.classList.add('span2');
            const b2 = RailSync.el('div');
            b2.style.padding = '12px';
            Object.keys(m.byClass).forEach(function (k) {
                const v = m.byClass[k];
                b2.appendChild(bar(k.charAt(0) + k.slice(1).toLowerCase() + ' (' + v.n + ')', v.pct, v.pct.toFixed(1) + '%', RailSync.CLS_COLOR[k] || '#4a9eff'));
            });
            b2.appendChild(RailSync.el('div', 'mini-note', 'Average delay by class: ' +
                Object.keys(m.byClass).map(function (k) {
                    return k.toLowerCase() + ' ' + m.byClass[k].avgDelay + ' min';
                }).join(' · ') + '.'));
            p2.body.appendChild(b2);
            g.appendChild(p2.root);
            /* -- sectional rail temperature -- */
            const p3 = panel('Sectional Rail Temperature', 'CRT probes · rail temp vs de-stressing tₔ');
            p3.root.classList.add('span2');
            const b3 = RailSync.el('div');
            b3.style.padding = '8px 12px 12px';
            RailSync.D.corridors.forEach(function (c) {
                const t = RailSync.railTemp(RailSync.S.clock, c.id);
                if (!t)
                    return;
                const row = RailSync.el('div');
                row.style.cssText = 'padding:7px 0;border-bottom:1px solid var(--line-soft)';
                const top = RailSync.el('div');
                top.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline';
                top.appendChild(RailSync.el('span', null, CORR_LABEL[c.id] || c.id));
                const over = t.rail - t.dest;
                const v = RailSync.el('span', 'mono', t.rail.toFixed(1) + '°C');
                v.style.cssText = 'font-size:15px;font-weight:700;color:' +
                    (t.rail > t.max ? '#ff4d4f' : over > 0 ? '#f5b942' : '#2ecc71');
                top.appendChild(v);
                row.appendChild(top);
                const det = RailSync.el('div', 'mini-note', 'probe ' + t.probe + ' @ ' + t.station + ' · ambient ' + t.amb + '°C · tₔ ' + t.dest + '°C · ' +
                    (over > 0 ? '+' + over.toFixed(1) + '°C above de-stressing'
                        : over.toFixed(1) + '°C below de-stressing') +
                    ' · tamping envelope ' + t.min + '–' + t.max + '°C · ' +
                    (t.safeTamp ? 'safe to tamp' : 'OUTSIDE TAMPING ENVELOPE') +
                    (t.buckle ? ' · BUCKLING WATCH' : ''));
                det.style.padding = '3px 0 0';
                row.appendChild(det);
                b3.appendChild(row);
            });
            b3.appendChild(RailSync.el('div', 'mini-note', 'Readings follow the division clock — play or fast-forward to see the day’s thermal window.'));
            p3.body.appendChild(b3);
            g.appendChild(p3.root);
            /* -- departmental backlog -- */
            const p4 = panel('Departmental Backlog', 'demands awaiting a block');
            p4.root.classList.add('span2');
            const b4 = RailSync.el('div');
            b4.style.padding = '12px';
            const maxN = Math.max.apply(null, Object.keys(m.backlog).map(function (k) { return m.backlog[k].n; }));
            Object.keys(m.backlog).forEach(function (k) {
                const v = m.backlog[k];
                b4.appendChild(bar(DEPT_LABEL[k] || k, 100 * v.n / maxN, v.n + ' (' + v.critical + ' crit)', DEPT_COLOR[k]));
            });
            const approved = RailSync.S.proposals.filter(function (p) { return p.status === 'APPROVED'; });
            const cleared = approved.reduce(function (a, p) { return a + p.items.length + p.added.length; }, 0);
            const savedDays = approved.reduce(function (a, p) { return a + p.impact.overdueDaysCleared; }, 0);
            b4.appendChild(RailSync.el('div', 'mini-note', cleared + ' demand(s) cleared by approved blocks this shift, retiring ' + savedDays +
                ' overdue-days. ' + (RailSync.D.queue.length - cleared) + ' still outstanding.'));
            p4.body.appendChild(b4);
            g.appendChild(p4.root);
            /* -- TSR / caution orders -- */
            const p5 = panel('Active TSR / Caution Orders', RailSync.D.tsr.length + ' in force');
            p5.root.classList.add('span4');
            const tb = RailSync.el('table', 'grid');
            tb.innerHTML = '<thead><tr><th>Caution order</th><th>Corridor</th><th>Section</th>' +
                '<th>Chainage</th><th>Line</th><th>Restriction</th><th>Reason</th>' +
                '<th>Imposed</th><th>Est. removal</th><th style="text-align:right">Loss/train</th></tr></thead>';
            const tbody = RailSync.el('tbody');
            RailSync.D.tsr.forEach(function (t) {
                const tr = RailSync.el('tr');
                tr.appendChild(RailSync.el('td', 'mono', t.no));
                tr.appendChild(RailSync.el('td', null, RailSync.shortCorr(t.corridor)));
                tr.appendChild(RailSync.el('td', null, t.from + ' – ' + t.to));
                tr.appendChild(RailSync.el('td', 'mono', 'KM ' + t.fromKm.toFixed(2) + '–' + t.toKm.toFixed(2)));
                tr.appendChild(RailSync.el('td', 'mono', t.line));
                const sp = RailSync.el('td');
                sp.appendChild(RailSync.el('span', 'chip ' + (t.speed <= 30 ? 'crit' : t.speed <= 60 ? 'urg' : 'rout'), t.speed + ' / ' + t.normal + ' km/h'));
                tr.appendChild(sp);
                tr.appendChild(RailSync.el('td', null, t.reason));
                tr.appendChild(RailSync.el('td', 'mono', t.imposed));
                tr.appendChild(RailSync.el('td', 'mono', t.removal));
                const l = RailSync.el('td', 'mono', '+' + t.lossMin.toFixed(1) + ' min');
                l.style.textAlign = 'right';
                tr.appendChild(l);
                tbody.appendChild(tr);
            });
            tb.appendChild(tbody);
            p5.body.appendChild(tb);
            g.appendChild(p5.root);
        }
        Analytics.renderReports = renderReports;
        /* ============================================================ LOGS */
        const LOG_COLOR = {
            approve: '#2ecc71', reject: '#ff4d4f', shift: '#f5b942',
            bundle: '#a78bfa', reopen: '#4a9eff', system: '#5f7086'
        };
        function renderLogs() {
            const root = RailSync.byId('log-root');
            if (!root)
                return;
            RailSync.clear(root);
            const hd = RailSync.el('div', 'panel-hd');
            hd.appendChild(RailSync.el('h2', null, 'Decision Log & History'));
            hd.appendChild(RailSync.el('span', 'sub', RailSync.S.log.length + ' entries this shift'));
            root.appendChild(hd);
            if (!RailSync.S.log.length) {
                root.appendChild(RailSync.el('div', 'empty', 'No controller decisions yet. Approve, reject, shift or bundle a block and it is ' +
                    'recorded here with its impact summary.'));
                return;
            }
            RailSync.S.log.forEach(function (L) {
                const it = RailSync.el('div', 'log-item');
                const dot = RailSync.el('div', 'log-dot');
                dot.style.background = LOG_COLOR[L.kind] || LOG_COLOR.system;
                it.appendChild(dot);
                const b = RailSync.el('div', 'log-body');
                const t = RailSync.el('div', 'log-t');
                t.appendChild(RailSync.el('b', null, L.title));
                b.appendChild(t);
                b.appendChild(RailSync.el('div', 'log-m', L.detail));
                if (L.ref) {
                    const p = RailSync.S.proposals.filter(function (x) { return x.id === L.ref; })[0];
                    if (p && p.order && L.kind === 'approve') {
                        b.appendChild(RailSync.el('div', 'log-m', 'Private Number: SM ' + p.order.pnSm +
                            (p.order.pnTpc !== null ? ' / TPC ' + p.order.pnTpc : '') +
                            ' · issued ' + RailSync.hhmm(p.order.issuedAt)));
                    }
                }
                it.appendChild(b);
                it.appendChild(RailSync.el('div', 'log-time', RailSync.hhmm(L.at)));
                if (L.ref) {
                    it.style.cursor = 'pointer';
                    it.addEventListener('click', function () { RailSync.bus.emit('openProposal', L.ref); });
                }
                root.appendChild(it);
            });
        }
        Analytics.renderLogs = renderLogs;
    })(Analytics = RailSync.Analytics || (RailSync.Analytics = {}));
})(RailSync || (RailSync = {}));
/// <reference path="core.ts" />
/* ============================================================
   (vi) Fleet & Crew HOER Tracker — MOBILE resources only.

   Fixed track assets (geometry, catenary, point motors) live in the
   ingestion feed (iii). This view answers the other question: where is the
   plant, and how much legal duty does its crew have left?
   ============================================================ */
var RailSync;
(function (RailSync) {
    var Fleet;
    (function (Fleet) {
        let host = null;
        /** Blocks this machine is committed to today, in order. */
        function dutyFor(id) {
            const out = [];
            RailSync.S.proposals.forEach(function (p) {
                if (p.status === 'REJECTED')
                    return;
                p.machines.forEach(function (m) {
                    if (m.id === id)
                        out.push({ p: p, m: m });
                });
            });
            out.sort(function (a, b) { return a.p.start - b.p.start; });
            return out;
        }
        function render() {
            host = host || RailSync.byId('fleet-root');
            if (!host)
                return;
            RailSync.clear(host);
            const fit = RailSync.D.machines.filter(function (m) { return m.fitness === 'FIT'; }).length;
            const committed = RailSync.D.machines.filter(function (m) { return dutyFor(m.id).length > 0; }).length;
            const atRisk = RailSync.S.proposals.filter(function (p) {
                return p.status !== 'REJECTED' && p.machines.some(function (m) { return m.crewRelief; });
            }).length;
            const hd = RailSync.el('div', 'panel-hd');
            hd.appendChild(RailSync.el('h2', null, 'Fleet & Crew HOER Tracker'));
            hd.appendChild(RailSync.el('span', 'sub', fit + ' fit of ' + RailSync.D.machines.length +
                ' · ' + committed + ' committed today · ' + atRisk + ' block(s) need a crew change'));
            host.appendChild(hd);
            /* ---- depot roll-up: where the plant is stabled ---- */
            const byDepot = {};
            RailSync.D.machines.forEach(function (m) {
                (byDepot[m.depot] = byDepot[m.depot] || []).push(m);
            });
            const depotRow = RailSync.el('div', 'depot-row');
            Object.keys(byDepot).sort().forEach(function (dep) {
                const ms = byDepot[dep];
                const card = RailSync.el('div', 'depot-card');
                const h = RailSync.el('div', 'depot-h');
                h.appendChild(RailSync.el('b', null, dep));
                h.appendChild(RailSync.el('span', 'chip', ms.filter(function (m) { return m.fitness === 'FIT'; }).length + '/' + ms.length + ' fit'));
                card.appendChild(h);
                ms.forEach(function (m) {
                    const r = RailSync.el('div', 'depot-m');
                    const dot = RailSync.el('i');
                    dot.style.background = m.fitness === 'FIT' ? 'var(--green)' : 'var(--red)';
                    r.appendChild(dot);
                    r.appendChild(RailSync.el('span', null, m.id));
                    r.appendChild(RailSync.el('span', 'grow', ''));
                    r.appendChild(RailSync.el('span', 'mono', m.type));
                    card.appendChild(r);
                });
                depotRow.appendChild(card);
            });
            host.appendChild(depotRow);
            /* ---- machine cards with the HOER red line ---- */
            const grid = RailSync.el('div', 'asset-grid');
            RailSync.D.machines.forEach(function (m) {
                const duty = dutyFor(m.id);
                const engaged = duty.reduce(function (a, d) { return a + d.m.engagedHours; }, 0);
                const remaining = Math.max(0, m.maxHours - m.dutyHours - engaged);
                const relief = duty.some(function (d) { return d.m.crewRelief; });
                const c = RailSync.el('div', 'asset-card' + (relief ? ' at-risk' : ''));
                const hh = RailSync.el('div');
                hh.style.cssText = 'display:flex;align-items:center;gap:7px';
                hh.appendChild(RailSync.el('h4', null, m.id));
                const fitChip = RailSync.el('span', 'chip ' + (m.fitness === 'FIT' ? 'rout' : 'crit'), m.fitness);
                fitChip.style.marginLeft = 'auto';
                hh.appendChild(fitChip);
                c.appendChild(hh);
                c.appendChild(RailSync.el('div', 'meta', m.model + ' · ' + m.type + ' · base ' + m.depot));
                /* HOER red line */
                const pct = 100 * (m.dutyHours + engaged) / m.maxHours;
                const badge = RailSync.el('div', 'hoer' + (relief ? ' bad' : pct > 85 ? ' warn' : ' ok'));
                badge.appendChild(RailSync.el('span', 'hoer-k', 'Crew duty remaining'));
                badge.appendChild(RailSync.el('span', 'hoer-v', fmtHours(remaining)));
                badge.appendChild(RailSync.el('span', 'hoer-s', relief ? 'RED LINE — a booked block outruns this crew'
                    : duty.length ? 'Safe for ' + duty.length + ' booked block(s)'
                        : 'Uncommitted'));
                c.appendChild(badge);
                const g = RailSync.el('div', 'gauge');
                const i = RailSync.el('i');
                i.style.width = Math.min(100, pct) + '%';
                i.style.background = pct > 95 ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)';
                g.appendChild(i);
                c.appendChild(g);
                c.appendChild(row('Worked / booked', m.dutyHours.toFixed(1) + ' + ' +
                    engaged.toFixed(1) + ' of ' + m.maxHours + ' h'));
                c.appendChild(row('Crew', m.crewId + ' · ' + m.rest));
                /* location + condition */
                c.appendChild(row('Stabled', m.station + (m.siding ? ' · ' + m.siding : '')));
                c.appendChild(row('Free runout', m.freeRunout ? 'Yes' : 'No'));
                c.appendChild(row('Tine wear', m.tineWear.toFixed(1) + '%'));
                c.appendChild(gauge(m.tineWear, m.tineWear > 70 ? 'var(--red)'
                    : m.tineWear > 40 ? 'var(--amber)' : 'var(--green)'));
                c.appendChild(row('HSD fuel', Math.round(m.fuel) + ' L'));
                c.appendChild(row('IOH / POH due', m.iohDue + ' / ' + m.pohDue));
                c.appendChild(row('Transit / working', m.transitSpeed + ' / ' + m.workingSpeed + ' km/h'));
                /* today's diagram */
                if (duty.length) {
                    c.appendChild(RailSync.el('div', 'duty-h', 'Booked today'));
                    duty.forEach(function (d) {
                        const line = RailSync.el('div', 'duty' + (d.m.crewRelief ? ' bad' : ''));
                        line.appendChild(RailSync.el('span', 'mono', RailSync.hhmm(d.p.start) + '–' + RailSync.hhmm(d.p.end)));
                        line.appendChild(RailSync.el('span', 'grow', d.p.id + ' · ' + d.p.section));
                        line.appendChild(RailSync.el('span', 'mono', d.m.engagedHours + 'h'));
                        line.style.cursor = 'pointer';
                        line.addEventListener('click', function () { RailSync.bus.emit('openProposal', d.p.id); });
                        c.appendChild(line);
                    });
                }
                grid.appendChild(c);
            });
            host.appendChild(grid);
            host.appendChild(RailSync.el('div', 'mini-note', 'Under HOER a track machine crew cannot work beyond ' + RailSync.D.machines[0].maxHours +
                ' continuous hours. A machine shown at the red line is booked to a block that ' +
                'outruns its crew — arrange relief at site or shorten the possession, or the ' +
                'machine is stranded on the running line.'));
        }
        Fleet.render = render;
        function fmtHours(h) {
            const m = Math.round(h * 60);
            return Math.floor(m / 60) + 'h ' + RailSync.pad2(m % 60) + 'm';
        }
        function row(k, v) {
            const r = RailSync.el('div', 'asset-row');
            r.appendChild(RailSync.el('span', null, k));
            r.appendChild(RailSync.el('span', null, v));
            return r;
        }
        function gauge(pct, color) {
            const g = RailSync.el('div', 'gauge');
            const i = RailSync.el('i');
            i.style.width = Math.max(0, Math.min(100, pct)) + '%';
            i.style.background = color;
            g.appendChild(i);
            return g;
        }
    })(Fleet = RailSync.Fleet || (RailSync.Fleet = {}));
})(RailSync || (RailSync = {}));
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
var RailSync;
(function (RailSync) {
    var App;
    (function (App) {
        let view = 'ops';
        function setText(id, txt) {
            const n = RailSync.byId(id);
            if (n)
                n.textContent = txt;
        }
        /* ------------------------------------------------------- banner */
        function renderBanner() {
            const m = RailSync.D.metrics;
            setText('brand-div', RailSync.D.meta.division + ' Division · ' + RailSync.D.meta.zone);
            const pu = m.punctuality;
            setText('s-punct', pu.toFixed(1) + '%');
            const pn = RailSync.byId('s-punct');
            if (pn)
                pn.className = 'stat-v ' + (pu >= 90 ? 'v-good' : pu >= 75 ? 'v-warn' : 'v-bad');
            setText('s-punct-sub', m.trainsOnTime + '/' + m.trainsRun + ' RT · avg ' + m.avgDelay + ' min');
            setText('s-clock', RailSync.hhmm(RailSync.S.clock));
            const t = RailSync.railTemp(RailSync.S.clock, RailSync.S.corridor);
            if (t) {
                const over = t.rail - t.dest;
                setText('s-temp', t.rail.toFixed(1) + '° / ' + t.dest.toFixed(0) + '°');
                const tn = RailSync.byId('s-temp');
                if (tn)
                    tn.className = 'stat-v ' + (t.rail > t.max ? 'v-bad' : over > 0 ? 'v-warn' : 'v-good');
                setText('s-temp-sub', 'amb ' + t.amb + '° · ' + t.probe + ' · ' +
                    (t.safeTamp ? 'tamping OK' : 'OUTSIDE ENVELOPE') + (t.buckle ? ' · BUCKLE' : ''));
                const chip = RailSync.byId('tsr-chip');
                if (chip) {
                    chip.onmousemove = function (e) { RailSync.tip(tsrTip(), e); };
                    chip.onmouseleave = RailSync.tipOff;
                }
            }
            const run = RailSync.runningAt(RailSync.S.clock, null);
            const pax = run.filter(function (r) { return r.train.kind === 'PASSENGER'; }).length;
            setText('s-running', String(run.length));
            setText('s-running-sub', pax + ' pax · ' + (run.length - pax) + ' freight');
            const approved = RailSync.S.proposals.filter(function (p) { return p.status === 'APPROVED'; });
            const cleared = approved.reduce(function (a, p) { return a + p.items.length + p.added.length; }, 0);
            const crit = RailSync.D.queue.filter(function (q) { return q.band === 'CRITICAL'; }).length;
            setText('s-backlog', String(RailSync.D.queue.length - cleared));
            setText('s-backlog-sub', crit + ' critical · ' + cleared + ' cleared');
            const induced = approved.reduce(function (a, p) { return a + p.impact.paxDelayMin; }, 0);
            setText('s-approved', approved.length + '/' + RailSync.S.proposals.length);
            setText('s-approved-sub', induced + ' min delay induced');
            setText('s-tsr', String(RailSync.D.tsr.length));
        }
        /** The active caution orders, readable without leaving the board. */
        function tsrTip() {
            const rows = RailSync.D.tsr.slice(0, 8).map(function (t) {
                return [t.no + '  ' + RailSync.shortCorr(t.corridor),
                    t.from + '–' + t.to + ' · ' + t.speed + '/' + t.normal + ' km/h · ' +
                        t.reason];
            });
            return '<div class="tt-h"><span class="swatch" style="background:#ff4d4f"></span>' +
                RailSync.D.tsr.length + ' caution orders in force</div>' + RailSync.tipRows(rows) +
                '<div class="tt-r" style="margin-top:6px;color:#7c8da0"><span>Click for the full register</span></div>';
        }
        /* ------------------------------------------------------- workspace */
        function bindWorkspace() {
            const box = RailSync.byId('ws-tabs');
            if (box) {
                Array.prototype.forEach.call(box.children, function (b) {
                    b.addEventListener('click', function () {
                        RailSync.S.workspace = b.dataset.ws;
                        Array.prototype.forEach.call(box.children, function (x) {
                            x.classList.toggle('on', x === b);
                        });
                        ['chart', 'map', 'fleet'].forEach(function (w) {
                            const n = RailSync.byId('ws-' + w);
                            if (n)
                                n.classList.toggle('on', w === RailSync.S.workspace);
                        });
                        moveSchematic();
                        renderWorkspace();
                    });
                });
            }
            const pbox = RailSync.byId('panel-tabs');
            if (pbox) {
                Array.prototype.forEach.call(pbox.children, function (b) {
                    b.addEventListener('click', function () {
                        RailSync.S.panelTab = b.dataset.pt;
                        Array.prototype.forEach.call(pbox.children, function (x) {
                            x.classList.toggle('on', x === b);
                        });
                        ['feed', 'audit'].forEach(function (w) {
                            const n = RailSync.byId('pt-' + w);
                            if (n)
                                n.classList.toggle('on', w === RailSync.S.panelTab);
                        });
                        const qc = RailSync.byId('q-count'), as = RailSync.byId('audit-sub');
                        if (qc)
                            qc.style.display = RailSync.S.panelTab === 'feed' ? '' : 'none';
                        if (as)
                            as.style.display = RailSync.S.panelTab === 'audit' ? '' : 'none';
                        if (RailSync.S.panelTab === 'feed')
                            RailSync.Queue.renderQueue();
                        else
                            RailSync.Queue.renderAudit();
                    });
                });
            }
        }
        /** One schematic node, re-parented into whichever workspace tab wants it. */
        function moveSchematic() {
            const wrap = RailSync.byId('net-wrap');
            const target = RailSync.byId(RailSync.S.workspace === 'map' ? 'net-wrap-2' : 'net-host-chart');
            if (wrap && target && wrap.parentElement !== target)
                target.appendChild(wrap);
        }
        function renderWorkspace() {
            if (RailSync.S.workspace === 'fleet') {
                RailSync.Fleet.render();
                return;
            }
            RailSync.Marey.render();
            RailSync.Network.render();
        }
        /* ------------------------------------------------------- clock UI */
        function bindClock() {
            const play = RailSync.byId('c-play');
            if (play)
                play.addEventListener('click', function () { RailSync.setPlaying(!RailSync.S.playing); });
            [['c-x1', 1], ['c-x8', 8], ['c-x60', 60]].forEach(function (b) {
                const n = RailSync.byId(b[0]);
                if (!n)
                    return;
                n.addEventListener('click', function () {
                    RailSync.S.speed = b[1];
                    ['c-x1', 'c-x8', 'c-x60'].forEach(function (id) {
                        const x = RailSync.byId(id);
                        if (x)
                            x.classList.toggle('on', id === b[0]);
                    });
                    if (RailSync.S.playing)
                        RailSync.setPlaying(true); // restart the interval at the new rate
                });
            });
            const rst = RailSync.byId('c-rst');
            if (rst)
                rst.addEventListener('click', function () { RailSync.S.clock = 0; RailSync.bus.emit('clock'); });
            RailSync.bus.on('clockstate', function () {
                if (!play)
                    return;
                play.innerHTML = RailSync.S.playing ? '&#10073;&#10073;' : '&#9654;';
                play.classList.toggle('on', RailSync.S.playing);
            });
            RailSync.bus.on('clock', function () {
                // keep a zoomed string-chart window following the clock
                if (RailSync.S.zoom < 24) {
                    const span = RailSync.S.zoom * 60;
                    if (RailSync.S.clock < RailSync.S.zoomAt || RailSync.S.clock > RailSync.S.zoomAt + span) {
                        RailSync.S.zoomAt = Math.max(0, Math.min(RailSync.DAY - span, RailSync.S.clock - span / 2));
                    }
                }
                renderBanner();
                renderWorkspace();
                if (view === 'reports')
                    RailSync.Analytics.renderReports();
            });
        }
        /* ------------------------------------------------------- views */
        function renderView() {
            if (view === 'ops') {
                renderWorkspace();
                RailSync.Queue.renderProposals();
                if (RailSync.S.panelTab === 'feed')
                    RailSync.Queue.renderQueue();
                else
                    RailSync.Queue.renderAudit();
            }
            else if (view === 'reports') {
                RailSync.Analytics.renderReports();
            }
            else if (view === 'logs') {
                RailSync.Analytics.renderLogs();
            }
        }
        function bindViews() {
            const btns = document.querySelectorAll('.rail-btn');
            Array.prototype.forEach.call(btns, function (b) {
                b.addEventListener('click', function () {
                    view = b.dataset.view;
                    Array.prototype.forEach.call(btns, function (x) {
                        x.classList.toggle('on', x === b);
                    });
                    ['ops', 'reports', 'logs'].forEach(function (v) {
                        const n = RailSync.byId('view-' + v);
                        if (n)
                            n.classList.toggle('on', v === view);
                    });
                    renderView();
                });
            });
            const chip = RailSync.byId('tsr-chip');
            if (chip) {
                chip.addEventListener('click', function () {
                    const b = document.querySelector('.rail-btn[data-view="reports"]');
                    if (b)
                        b.click();
                });
            }
        }
        /* ------------------------------------------------------- boot */
        function boot() {
            if (!RailSync.D) {
                document.body.innerHTML =
                    '<div class="empty">railsync-data.js failed to load. Run <code>npm run data</code>.</div>';
                return;
            }
            RailSync.initProposals();
            // Open on a busy morning hour so the board reads as a live shift.
            RailSync.S.clock = 450;
            RailSync.Network.bindTabs();
            RailSync.Marey.bindZoom();
            bindWorkspace();
            RailSync.Queue.buildFilters();
            RailSync.Drawer.bind();
            bindClock();
            bindViews();
            RailSync.bus.on('render', function () {
                renderBanner();
                renderWorkspace();
                RailSync.Queue.renderProposals();
                if (RailSync.S.panelTab === 'feed')
                    RailSync.Queue.renderQueue();
                else
                    RailSync.Queue.renderAudit();
                if (view === 'logs')
                    RailSync.Analytics.renderLogs();
                if (view === 'reports')
                    RailSync.Analytics.renderReports();
            });
            // Cursor synchronisation — hovering either view redraws both, so the
            // highlighted train or block appears in the same instant on each.
            RailSync.bus.on('sync', function () {
                if (RailSync.S.workspace === 'fleet')
                    return;
                RailSync.Marey.render();
                RailSync.Network.render();
            });
            RailSync.bus.on('corridor', function () {
                renderBanner();
                renderWorkspace();
                if (RailSync.S.panelTab === 'feed')
                    RailSync.Queue.renderQueue();
            });
            RailSync.bus.on('log', function () {
                if (view === 'logs')
                    RailSync.Analytics.renderLogs();
            });
            let rt;
            window.addEventListener('resize', function () {
                clearTimeout(rt);
                rt = setTimeout(renderWorkspace, 120);
            });
            RailSync.logEvent('system', 'Shift opened — ' + RailSync.D.meta.division + ' Division', RailSync.D.queue.length + ' demands ingested from TMS / TDMS / SMMS · ' +
                RailSync.S.proposals.length + ' block proposals generated · ' +
                RailSync.D.trains.length + ' train paths loaded · ' + RailSync.D.tsr.length + ' TSR in force.', null);
            renderBanner();
            renderView();
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        }
        else {
            boot();
        }
    })(App = RailSync.App || (RailSync.App = {}));
})(RailSync || (RailSync = {}));
//# sourceMappingURL=dashboard.js.map