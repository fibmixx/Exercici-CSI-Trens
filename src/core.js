// =====================================================================
//  FERROCARRIL 1912 — NUCLI DE LA SIMULACIÓ
//  Dues parts separades:
//    1. EL MÓN (class World): posició real dels trens, agulles, rellotges,
//       telegrames, missatgers i detecció d'accidents.
//    2. ELS ACTORS (PROTOCOLS): central, caps d'estació i maquinistes.
//       Cada actor només rep un objecte "obs" amb el que pot saber
//       (la seva llibreta, el que li arriba i el que veu). Mai no reben
//       cap referència al món.
// =====================================================================
const SIM = (() => {
'use strict';

// ---------------------------------------------------------------------
//  Utilitats i coneixement públic (mapa i horari: tothom el té en paper)
// ---------------------------------------------------------------------
const hm = m => { m = Math.round(m); const h = Math.floor(m / 60), mm = ((m % 60) + 60) % 60; return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
const parseHM = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const clone = o => JSON.parse(JSON.stringify(o));

const ORDER = ['A', 'B', 'C', 'D', 'E'];
const STATIONS = {
  A: { id: 'A', km: 0,  idx: 0, through: 3, dead: null,                 sides: ['E'] },
  B: { id: 'B', km: 6,  idx: 1, through: 2, dead: { via: 3, side: 'E' }, sides: ['W', 'E'] },
  C: { id: 'C', km: 16, idx: 2, through: 2, dead: null,                 sides: ['W', 'E'] },
  D: { id: 'D', km: 24, idx: 3, through: 2, dead: { via: 3, side: 'W' }, sides: ['W', 'E'] },
  E: { id: 'E', km: 36, idx: 4, through: 3, dead: null,                 sides: ['W'] },
};
const SECTIONS = [
  { id: 'A-B', w: 'A', e: 'B', km: 6,  double: true,  P: 8,  M: 12 },
  { id: 'B-C', w: 'B', e: 'C', km: 10, double: false, P: 13, M: 20 },
  { id: 'C-D', w: 'C', e: 'D', km: 8,  double: true,  P: 10, M: 16 },
  { id: 'D-E', w: 'D', e: 'E', km: 12, double: false, P: 15, M: 24 },
];
const sectionBetween = (x, y) => SECTIONS.find(s => (s.w === x && s.e === y) || (s.w === y && s.e === x));
const dirOf = (x, y) => STATIONS[y].idx > STATIONS[x].idx ? 'E' : 'W';
const trackOf = (sec, dir) => sec.double ? (dir === 'E' ? 1 : 2) : 1;
const trackName = (sec, dir) => sec.double ? `${sec.id} ${trackOf(sec, dir)}` : sec.id;
const opp = s => s === 'E' ? 'W' : 'E';
const sideName = s => s === 'E' ? 'est' : 'oest';
const viasOf = st => { const s = STATIONS[st], v = []; for (let i = 1; i <= s.through; i++) v.push(i); if (s.dead) v.push(s.dead.via); return v; };
const viaAccessible = (st, via, side) => {
  const s = STATIONS[st];
  if (!s.sides.includes(side)) return false;
  if (s.dead && via === s.dead.via) return s.dead.side === side;
  return via >= 1 && via <= s.through;
};

const TT_RAW = {
  T101: 'A 07:00 · B 07:08/07:10 · C 07:23/07:25 · D 07:35/07:37 · E 07:52',
  T102: 'E 07:55 · D 08:10/08:12 · C 08:22/08:24 · B 08:37/08:39 · A 08:47',
  T103: 'A 08:15 · B 08:23/08:40 · C 08:53',
  T104: 'C 09:10 · B 09:23/09:25 · A 09:33',
  T105: 'A 09:30 · B 09:38/09:40 · C 09:53/09:55 · D 10:05/10:07 · E 10:22',
  T106: 'E 09:30 · D 09:45/09:47 · C 09:57/09:59 · B 10:12/10:14 · A 10:22',
  T107: 'A 11:00 · B 11:08/11:10 · C 11:23/11:25 · D 11:35/11:37 · E 11:52',
  T108: 'E 11:00 · D 11:15/11:17 · C 11:27/11:29 · B 11:42/11:44 · A 11:52',
};
const TIMETABLE = {};
for (const [id, s] of Object.entries(TT_RAW)) {
  const parts = s.split('·').map(x => x.trim());
  const route = [], times = {};
  parts.forEach((p, i) => {
    const [st, tm] = p.split(' ');
    route.push(st);
    const ts = tm.split('/').map(parseHM);
    if (i === 0) times[st] = { dep: ts[0] };
    else if (i === parts.length - 1) times[st] = { arr: ts[0] };
    else times[st] = { arr: ts[0], dep: ts[1] };
  });
  TIMETABLE[id] = { id, type: 'P', route, times };
}
// Dels mercaderies, els actors només saben d'on surten i on van (no quan).
const FREIGHT_ROUTES = { M201: ['B', 'C', 'D', 'E'], M202: ['E', 'D', 'C', 'B', 'A'] };
// Això només ho sap el món:
const FREIGHT_WORLD = { M201: { appear: parseHM('07:30'), via: 3 }, M202: { appear: parseHM('10:00'), via: null } };

const routeOf = id => TIMETABLE[id] ? TIMETABLE[id].route : FREIGHT_ROUTES[id];
const nextOf = (id, st) => { const r = routeOf(id); const i = r.indexOf(st); return i >= 0 && i < r.length - 1 ? r[i + 1] : null; };

function fmt(kind, d, from, to, time) {
  const head = `${d.train || '---'} - ${from} - ${to} - ${hm(time)}`;
  let body;
  switch (kind) {
    case 'Petició': case 'Autorització': case 'Ocupat': case 'Espera': case 'Negació':
      body = `${kind} - Tren ${d.train} sortir ${d.x} cap a ${d.y} per la via ${d.track}`; break;
    case 'Sortida':
      body = `Sortida - Tren ${d.train} sortir ${d.x} cap a ${d.y} per la via ${d.track} - ${hm(d.hora)}`; break;
    case 'Arribada': case 'Rebut':
      body = `${kind} - Tren ${d.train} arribada ${d.x} cap a ${d.y} per la via ${d.track}`; break;
    case 'Retard':
      body = `Retard - Tren ${d.train} ${d.x} cap a ${d.y} encara no ha arribat (previst ${hm(d.exp)})`; break;
    case 'Avaria':
      body = `Avaria - Tren ${d.train} aturat al tram ${d.sec}, km ${Number(d.km).toFixed(1)} des de ${d.x}`; break;
    case 'Hora':
      body = `Hora - ${hm(d.hora)}`; break;
    default: body = `${kind}`;
  }
  return head + ' | ' + body;
}

// El "coneixement" que reben els actors: mapa, horari, reglament. Res del món.
const KNOWLEDGE = Object.freeze({
  STATIONS, SECTIONS, ORDER, TIMETABLE, FREIGHT_ROUTES,
  hm, sectionBetween, dirOf, trackOf, trackName, opp, sideName, viasOf, viaAccessible, routeOf, nextOf, fmt,
  TELEGRAM_MIN: 2, WALK_KMH: 5,
});

const SCENARIOS = [
  { id: 1, name: 'Normal' },
  { id: 2, name: 'Retard', delay: true },
  { id: 3, name: 'Avaria', breakdown: true },
  { id: 4, name: 'Telègraf caigut', telegraph: true },
  { id: 5, name: 'Rellotge', clock: true },
  { id: 6, name: 'Tot alhora', delay: true, breakdown: true, telegraph: true, clock: true },
];

// =====================================================================
//  1. EL MÓN
// =====================================================================
class World {
  constructor(scenarioId, protocolId) {
    this.scn = SCENARIOS.find(s => s.id === scenarioId);
    this.protocolId = protocolId;
    const P = PROTOCOLS[protocolId];
    this.t = parseHM('06:30');
    this.tEnd = parseHM('12:30');
    this.done = false;
    this.trains = {};
    this.vias = {};
    for (const st of ORDER) { this.vias[st] = {}; for (const v of viasOf(st)) this.vias[st][v] = null; }
    this.switches = { A: { E: 1 }, B: { W: 1, E: 2 }, C: { W: 1, E: 2 }, D: { W: 1, E: 2 }, E: { W: 1 } };
    this.clockOff = { A: 0, B: 0, C: 0, D: 0, E: this.scn.clock ? 10 : 0 };
    this.telegrams = [];
    this.messengers = [];
    this.accidents = [];
    this.events = [];
    this.arrivedSide = {};
    this.toChief = { A: [], B: [], C: [], D: [], E: [] };
    this.toDriver = {};
    this.breakdownClaimed = false;
    this.nextMsgId = 1;

    this.toAppear = [];
    for (const tr of Object.values(TIMETABLE)) {
      const dep = tr.times[tr.route[0]].dep;
      const delay = (this.scn.delay && tr.id === 'T102') ? 25 : 0;
      this.toAppear.push({ id: tr.id, type: 'P', route: tr.route, at: dep - 10 + delay, readyAt: dep + delay, mustWaitReady: delay > 0, via: null });
    }
    for (const [id, f] of Object.entries(FREIGHT_WORLD))
      this.toAppear.push({ id, type: 'M', route: FREIGHT_ROUTES[id], at: f.appear, readyAt: f.appear, via: f.via });

    this.central = P.central(KNOWLEDGE);
    this.chiefs = {};
    for (const st of ORDER) this.chiefs[st] = P.chief(st, KNOWLEDGE);
    this.drivers = {};
    this.P = P;
  }

  lineUp(st, t) { return !(this.scn.telegraph && st === 'C' && t >= parseHM('08:00') && t < parseHM('09:30')); }
  localTime(st) { return this.t + this.clockOff[st]; }
  ev(s) { this.events.push(`[${hm(this.t)}] ${s}`); }

  accident(type, trains, where, km) {
    for (const id of trains) this.trains[id].state = 'crashed';
    this.accidents.push({ type, trains: trains.slice(), where, km, t: this.t });
    this.ev(`⚠ ACCIDENT: ${type} — ${trains.join(' i ')} — ${where}`);
  }

  // ---- un minut de simulació ----
  step() {
    if (this.done) return;
    const t = this.t;
    this.arrivedSide = {};
    this.doAppearances(t);
    this.doRetire(t);
    this.moveTrains(t);
    this.detectSectionCollisions(t);

    // lliurament de telegrames i missatgers
    const inbox = { Central: [], A: [], B: [], C: [], D: [], E: [] };
    for (const g of this.telegrams) {
      if (g.status !== 'en camí' || g.arriveT > t) continue;
      if (g.to !== 'Central' && !this.lineUp(g.to, t)) { g.status = 'perdut'; g.lostAt = t; continue; }
      g.status = 'lliurat'; g.deliveredAt = t;
      inbox[g.to].push({ from: g.from, kind: g.kind, data: clone(g.data), text: g.text });
    }
    const msgr = { A: [], B: [], C: [], D: [], E: [] };
    for (const m of this.messengers) {
      if (m.status !== 'en camí' || m.arriveT > t) continue;
      m.status = 'lliurat'; m.deliveredAt = t;
      msgr[m.to].push({ from: m.from, data: clone(m.data), text: m.text });
    }

    // ACTORS: central, caps d'estació, maquinistes (en aquest ordre)
    this.applyCentral(this.central.decide({ clock: t, inbox: inbox.Central }));
    for (const st of ORDER) {
      const obs = {
        station: st,
        clock: this.localTime(st),
        vias: viasOf(st).map(v => {
          const id = this.vias[st][v];
          if (!id) return { via: v, train: null };
          const tr = this.trains[id];
          return { via: v, train: { id, type: tr.type, stoppedMin: t - tr.stoppedSince, crashed: tr.state === 'crashed' } };
        }),
        switches: clone(this.switches[st]),
        inbox: inbox[st],
        messengers: msgr[st],
        papers: this.toChief[st].splice(0),
      };
      this.applyChief(st, this.chiefs[st].decide(clone(obs)));
    }
    for (const id of Object.keys(this.drivers)) {
      const tr = this.trains[id];
      if (tr.loc === 'gone') continue;
      const obs = { train: id, type: tr.type, crashed: tr.state === 'crashed', ready: t >= tr.readyAt, papers: (this.toDriver[id] || []).splice(0) };
      if (tr.loc === 'station') obs.at = { station: tr.st, via: tr.via, stationClock: this.localTime(tr.st), stoppedMin: t - tr.stoppedSince };
      else { const sec = SECTIONS.find(s => s.id === tr.sec); obs.at = { section: tr.sec, from: tr.from, to: tr.to, kmFromOrigin: tr.pos, kmToDest: sec.km - tr.pos, broken: tr.state === 'broken' }; }
      this.applyDriver(id, this.drivers[id].decide(clone(obs)));
    }

    this.t++;
    if (this.t > this.tEnd) this.done = true;
  }

  doAppearances(t) {
    for (const a of this.toAppear) {
      if (a.done || a.at > t) continue;
      let via = null;
      if (a.via && !this.vias[a.route[0]][a.via]) via = a.via;
      else for (let v = 1; v <= STATIONS[a.route[0]].through; v++) if (!this.vias[a.route[0]][v]) { via = v; break; }
      if (via === null) { if (!a.warned) { this.ev(`${a.id} no troba via lliure a ${a.route[0]} per aparèixer; espera`); a.warned = true; } continue; }
      a.done = true;
      const st = a.route[0];
      this.trains[a.id] = { id: a.id, type: a.type, route: a.route, loc: 'station', st, via, state: 'ok', stoppedSince: t, readyAt: a.mustWaitReady ? a.readyAt : t, pos: 0 };
      this.vias[st][via] = a.id;
      this.drivers[a.id] = this.P.driver(a.id, KNOWLEDGE);
      this.toDriver[a.id] = [];
      this.ev(`${a.id} apareix a ${st}, via ${via}`);
    }
  }

  doRetire(t) {
    for (const tr of Object.values(this.trains)) {
      if (tr.loc === 'station' && tr.retireAt != null && tr.retireAt <= t && tr.state === 'ok') {
        if (this.vias[tr.st][tr.via] === tr.id) this.vias[tr.st][tr.via] = null;
        this.ev(`${tr.id} se'n va a cotxeres des de ${tr.st}`);
        tr.loc = 'gone';
      }
    }
  }

  moveTrains(t) {
    for (const tr of Object.values(this.trains)) {
      if (tr.loc !== 'section') continue;
      if (tr.state === 'broken' && t >= tr.brokenUntil) { tr.state = 'ok'; this.ev(`${tr.id} reparat, continua cap a ${tr.to}`); }
      if (tr.state !== 'ok') continue;
      const sec = SECTIONS.find(s => s.id === tr.sec);
      tr.moved += 1;
      tr.pos = Math.min(sec.km, sec.km * tr.moved / tr.run);
      if (tr.willBreak && !tr.brokeDone && tr.pos >= sec.km / 2) {
        tr.pos = sec.km / 2; tr.moved = tr.run / 2; tr.state = 'broken'; tr.brokenUntil = t + 60; tr.brokeDone = true;
        this.ev(`${tr.id} s'avaria a mig tram ${sec.id} (km ${(STATIONS[sec.w].km + this.xOf(tr, sec)).toFixed(1)}); aturat 60 min`);
        continue;
      }
      if (tr.moved >= tr.run) this.arrive(tr, t);
    }
  }

  xOf(tr, sec) { return tr.dir === 'E' ? tr.pos : sec.km - tr.pos; }

  arrive(tr, t) {
    const st = tr.to, side = opp(tr.dir);
    const via = this.switches[st][side];
    const occ = this.vias[st][via];
    Object.assign(tr, { loc: 'station', st, via, stoppedSince: t, sec: null });
    this.arrivedSide[st + side] = t;
    if (occ) {
      this.accident("Xoc a l'estació", [tr.id, occ], `${st} via ${via}`, STATIONS[st].km);
      return;
    }
    this.vias[st][via] = tr.id;
    this.ev(`${tr.id} arriba a ${st}, via ${via}`);
    if (tr.route[tr.route.length - 1] === st) { tr.arrivedFinal = t; tr.retireAt = t + 5; }
  }

  detectSectionCollisions() {
    const groups = {};
    for (const tr of Object.values(this.trains)) {
      if (tr.loc !== 'section') continue;
      (groups[tr.sec + '|' + tr.track] = groups[tr.sec + '|' + tr.track] || []).push(tr);
    }
    for (const [k, list] of Object.entries(groups)) {
      const sec = SECTIONS.find(s => s.id === k.split('|')[0]);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.state === 'crashed' && b.state === 'crashed') continue;
        const xa = this.xOf(a, sec), xb = this.xOf(b, sec);
        let hit = null;
        if (a.dir !== b.dir) {
          const e = a.dir === 'E' ? a : b, w = a.dir === 'E' ? b : a;
          if (this.xOf(e, sec) >= this.xOf(w, sec)) hit = 'Xoc frontal';
        } else {
          const [lead, foll] = a.enteredAt <= b.enteredAt ? [a, b] : [b, a];
          const xl = this.xOf(lead, sec), xf = this.xOf(foll, sec);
          if (foll.moved > 0 && (a.dir === 'E' ? xf >= xl : xf <= xl)) hit = 'Abast';
        }
        if (hit) {
          const km = STATIONS[sec.w].km + (xa + xb) / 2;
          this.accident(hit, [a.id, b.id], `tram ${trackName(sec, a.dir)}, km ${km.toFixed(1)}`, km);
          a.state = 'crashed'; b.state = 'crashed';
        }
      }
    }
  }

  sendTelegram(from, to, a) {
    const t = this.t;
    const g = { id: this.nextMsgId++, from, to, sentT: t, arriveT: t + 2, kind: a.kind, data: clone(a.data), text: a.text, status: 'en camí' };
    const st = from === 'Central' ? to : from;
    if (!this.lineUp(st, t)) { g.status = 'perdut'; g.lostAt = t; }
    this.telegrams.push(g);
  }

  sendMessenger(fromLabel, fromKm, to, data, text) {
    const dist = Math.abs(STATIONS[to].km - fromKm);
    const mins = Math.ceil(dist / 5 * 60);
    this.messengers.push({ id: this.nextMsgId++, kind: 'missatger', from: fromLabel, fromKm, to, sentT: this.t, arriveT: this.t + mins, data: clone(data), text, status: 'en camí' });
  }

  applyCentral(acts) {
    for (const a of acts || []) {
      if (a.type === 'telegram' && ORDER.includes(a.to)) this.sendTelegram('Central', a.to, a);
    }
  }

  applyChief(st, acts) {
    for (const a of acts || []) {
      if (a.type === 'telegram') { this.sendTelegram(st, 'Central', a); }
      else if (a.type === 'switch') {
        if (viaAccessible(st, a.via, a.side)) this.switches[st][a.side] = a.via;
      } else if (a.type === 'paper') {
        const tr = this.trains[a.train];
        if (tr && tr.loc === 'station' && tr.st === st) this.toDriver[a.train].push(clone(a.paper));
      } else if (a.type === 'setClock') {
        this.clockOff[st] = a.value - this.t;
      } else if (a.type === 'messenger') {
        if (Math.abs(STATIONS[a.to].idx - STATIONS[st].idx) === 1) this.sendMessenger(`Estació ${st}`, STATIONS[st].km, a.to, a.data, a.text);
      }
    }
  }

  applyDriver(id, acts) {
    const tr = this.trains[id];
    for (const a of acts || []) {
      if (a.type === 'depart') this.depart(tr);
      else if (a.type === 'handPaper') { if (tr.loc === 'station') this.toChief[tr.st].push(clone(a.paper)); }
      else if (a.type === 'messenger') {
        if (tr.loc === 'section' && (a.to === tr.from || a.to === tr.to)) {
          const sec = SECTIONS.find(s => s.id === tr.sec);
          this.sendMessenger(`Maquinista ${id}`, STATIONS[sec.w].km + this.xOf(tr, sec), a.to, a.data, a.text);
        }
      }
    }
  }

  depart(tr) {
    const t = this.t;
    if (tr.loc !== 'station' || tr.state !== 'ok') return;
    if (t - tr.stoppedSince < 1 || t < tr.readyAt) return;
    const nx = nextOf(tr.id, tr.st);
    if (!nx) return;
    const sec = sectionBetween(tr.st, nx), dir = dirOf(tr.st, nx), side = dir;
    const sw = this.switches[tr.st][side];
    if (sw !== tr.via) {
      this.accident('Descarrilament', [tr.id], `${tr.st}, sortida costat ${sideName(side)} (agulla a via ${sw}, tren a via ${tr.via})`, STATIONS[tr.st].km);
      return;
    }
    if (this.arrivedSide[tr.st + side] === t) {
      this.accident('Descarrilament', [tr.id], `${tr.st}, agulla ${sideName(side)} moguda mentre hi entrava un altre tren`, STATIONS[tr.st].km);
      return;
    }
    this.vias[tr.st][tr.via] = null;
    this.ev(`${tr.id} surt de ${tr.st} (via ${tr.via}) cap a ${nx} per la via ${trackName(sec, dir)}`);
    Object.assign(tr, { loc: 'section', sec: sec.id, dir, track: trackOf(sec, dir), from: tr.st, to: nx, moved: 0, pos: 0, run: tr.type === 'P' ? sec.P : sec.M, enteredAt: t, st: null, via: null });
    if (tr.firstDep == null) tr.firstDep = t;
    if (this.scn.breakdown && sec.id === 'D-E' && t >= parseHM('09:00') && !this.breakdownClaimed) { this.breakdownClaimed = true; tr.willBreak = true; }
  }

  runToEnd() { while (!this.done) this.step(); return this; }

  results() {
    const pax = Object.values(TIMETABLE);
    let arrived = 0, delaySum = 0;
    for (const p of pax) {
      const tr = this.trains[p.id];
      if (tr && tr.arrivedFinal != null) { arrived++; delaySum += Math.max(0, tr.arrivedFinal - p.times[p.route[p.route.length - 1]].arr); }
    }
    const freight = ['M201', 'M202'].filter(id => this.trains[id] && this.trains[id].arrivedFinal != null).length;
    return { accidents: this.accidents.slice(), paxArrived: arrived, avgDelay: arrived ? delaySum / arrived : null, freightArrived: freight };
  }
}

// =====================================================================
//  2. ELS ACTORS
// =====================================================================
const PROTOCOLS = {};

// ---------- Eines comunes dels caps d'estació (només fan servir el que veuen) ----------
function freeThroughVias(K, st, obsVias, reserved) {
  return obsVias.filter(v => !v.train && v.via <= K.STATIONS[st].through && !reserved.includes(v.via)).map(v => v.via);
}
function defaultVia(side, free) { if (!free.length) return null; return side === 'W' ? Math.min(...free) : Math.max(...free); }

// ---------- Maquinista (comú): surt quan té un paper per a aquesta estació i l'hora ha arribat ----------
function makeDriver(id, K, opts = {}) {
  const me = { kind: 'driver', id, llibreta: [] };
  let permit = null, sentMessenger = false, brokenFor = 0, clock = null;
  const log = s => me.llibreta.push(`[${clock != null ? K.hm(clock) : '--:--'}] ${s}`);
  me.decide = o => {
    const acts = [];
    if (o.at.station) clock = o.at.stationClock;
    for (const p of o.papers) { permit = p; log(`Paper rebut: ${p.text}`); }
    if (o.crashed) return acts;
    if (o.at.station) {
      if (permit && permit.x !== o.at.station) {
        if (opts.handOver) { acts.push({ type: 'handPaper', paper: permit }); log(`Arribo a ${o.at.station}; lliuro el paper al cap d'estació`); }
        else log(`Arribo a ${o.at.station}`);
        permit = null;
      }
      if (permit && permit.x === o.at.station && o.at.stationClock >= permit.hora && o.ready && o.at.stoppedMin >= 1) {
        if (!permit.departLogged) { log(`Surto de ${o.at.station} cap a ${permit.y} (rellotge de l'estació ${K.hm(o.at.stationClock)})`); permit.departLogged = true; }
        acts.push({ type: 'depart' });
      }
    } else if (o.at.broken) {
      brokenFor++;
      if (brokenFor === 1) log(`El tren s'ha avariat al tram ${o.at.section}. Els tripulants intenten arreglar-lo`);
      if (opts.messenger && brokenFor >= 10 && !sentMessenger) {
        sentMessenger = true;
        const to = o.at.kmToDest <= o.at.kmFromOrigin ? o.at.to : o.at.from;
        const data = { kind: 'avaria', train: id, sec: o.at.section, x: o.at.from, km: o.at.kmFromOrigin };
        acts.push({ type: 'messenger', to, data, text: `Avaria del ${id} al tram ${o.at.section}, a ${o.at.kmFromOrigin.toFixed(1)} km de ${o.at.from}` });
        log(`No es pot arreglar: envio un tripulant a peu cap a ${to}`);
      }
    } else if (brokenFor > 0) { log(`Reparat: continuem`); brokenFor = 0; }
    return acts;
  };
  me.view = () => ({ title: `Maquinista ${id}`, pissarra: [permit ? `Paper: ${permit.text}` : 'Sense paper de sortida'], llibreta: me.llibreta });
  return me;
}

// =====================================================================
//  PROTOCOL D'EXEMPLE: cada estació deixa sortir els trens a l'hora de l'horari i prou.
// =====================================================================
PROTOCOLS.exemple = {
  name: "Exemple: l'horari i prou",
  central(K) {
    const me = { kind: 'central', llibretes: { A: [], B: [], C: [], D: [], E: [] }, general: [] };
    me.decide = () => [];
    me.view = () => ({ title: 'Central', pissarra: ['(La central no fa res en aquest protocol)'], llibretes: me.llibretes });
    return me;
  },
  chief(st, K) {
    const me = { kind: 'chief', st, llibreta: [] };
    const given = {}; const seen = {};
    let L = 0;
    const log = s => me.llibreta.push(`[${K.hm(L)}] ${s}`);
    me.decide = o => {
      L = o.clock; const acts = [];
      const present = {};
      o.vias.forEach(v => { if (v.train) present[v.train.id] = { ...v.train, via: v.via }; });
      for (const id of Object.keys(present)) if (!seen[id]) { seen[id] = true; log(`Tren ${id} a la via ${present[id].via}`); }
      for (const id of Object.keys(seen)) if (!present[id]) { delete seen[id]; log(`El tren ${id} ja no és a l'estació`); }
      const wantSide = {};
      for (const [id, p] of Object.entries(present)) {
        if (p.crashed || p.type !== 'P') continue;
        const nx = K.nextOf(id, st); if (!nx) continue;
        const dep = K.TIMETABLE[id].times[st].dep;
        if (L >= dep && !given[id]) {
          given[id] = L;
          const sec = K.sectionBetween(st, nx), track = K.trackName(sec, K.dirOf(st, nx));
          const paper = { kind: 'ordre', train: id, x: st, y: nx, track, hora: L, text: `Ordre de sortida: ${id} de ${st} cap a ${nx} a les ${K.hm(L)}` };
          acts.push({ type: 'paper', train: id, paper });
          log(`És l'hora de l'horari (${K.hm(dep)}): ordre de sortida al ${id} cap a ${nx}`);
        }
        if (given[id] != null) wantSide[K.dirOf(st, nx)] = p.via;
      }
      for (const side of K.STATIONS[st].sides) {
        let want = wantSide[side];
        if (want == null) want = defaultVia(side, freeThroughVias(K, st, o.vias, []));
        if (want != null && want !== o.switches[side]) { acts.push({ type: 'switch', side, via: want }); log(`Agulla ${K.sideName(side)} → via ${want}`); }
      }
      return acts;
    };
    me.view = () => ({ title: `Estació ${st}`, pissarra: [`Rellotge: ${K.hm(L)}`, ...Object.keys(seen).map(id => `${id}`)], llibreta: me.llibreta });
    return me;
  },
  driver(id, K) { return makeDriver(id, K, { handOver: false, messenger: false }); },
};

// =====================================================================
//  PROTOCOL DEL PAPER (Marc Rodríguez Camacho i Pol Piquet Las Heras, 26/11)
//  opts: correccions que el simulador ha fet necessàries (vegeu README).
// =====================================================================
function makePaperProtocol(name, opts) {
  return {
    name, opts,
    // ------------------------------- CENTRAL -------------------------------
    central(K) {
      const me = { kind: 'central', llibretes: { A: [], B: [], C: [], D: [], E: [] }, general: [] };
      const blocks = {};                                     // pissarra: estat de cada via de cada tram
      const at = {}, incoming = {};                          // pissarra: trens a cada estació i trens que hi van
      for (const st of K.ORDER) { at[st] = []; incoming[st] = []; }
      const queue = [];                                      // peticions en espera
      const removals = [];
      const previstos = new Set();
      let T = 0, horaSent = false;
      const log = (st, s) => me.llibretes[st].push(`[${K.hm(T)}] ${s}`);
      const glog = s => me.general.push(`[${K.hm(T)}] ${s}`);
      const tg = (st, kind, data) => { const text = K.fmt(kind, data, 'Central', st, T); log(st, '→ ' + text); return { type: 'telegram', to: st, kind, data, text }; };
      const key = (x, y) => K.trackName(K.sectionBetween(x, y), K.dirOf(x, y));
      const add = (arr, v) => { if (!arr.includes(v)) arr.push(v); };
      const del = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); };
      const free = st => K.STATIONS[st].through - at[st].length - incoming[st].length;
      const runOf = (train, x, y) => { const s = K.sectionBetween(x, y); return K.TIMETABLE[train] ? s.P : s.M; };
      const isFinal = (train, st) => { const r = K.routeOf(train); return r[r.length - 1] === st; };

      function grant(d, acts) {
        const k = key(d.x, d.y);
        blocks[k] = { train: d.train, x: d.x, y: d.y, track: k, authT: T };
        add(incoming[d.y], d.train);
        glog(`Pissarra: ${k} OCUPADA pel ${d.train} (${d.x}→${d.y})`);
        acts.push(tg(d.x, 'Autorització', { train: d.train, x: d.x, y: d.y, track: k }));
        acts.push(tg(d.y, 'Ocupat', { train: d.train, x: d.x, y: d.y, track: k }));
      }

      me.decide = o => {
        T = o.clock; const acts = [];
        // Procediment d'excepció "rellotge": a una hora determinada, missatge Hora a totes les estacions
        if (!horaSent) { horaSent = true; for (const st of K.ORDER) acts.push(tg(st, 'Hora', { train: '---', hora: T })); }
        // Pissarra: els trens de viatgers apareixen a l'origen 10 minuts abans (reglament de la companyia)
        for (const tr of Object.values(K.TIMETABLE)) {
          const o0 = tr.route[0];
          if (!previstos.has(tr.id) && T >= tr.times[o0].dep - 10) { previstos.add(tr.id); add(at[o0], tr.id); glog(`Pissarra: ${tr.id} previst a ${o0} (horari)`); }
        }
        for (let i = 0; i < removals.length; i++) if (T >= removals[i].t) { del(at[removals[i].st], removals[i].train); glog(`Pissarra: ${removals[i].train} retirat a cotxeres a ${removals[i].st}`); removals.splice(i--, 1); }

        for (const m of o.inbox) {
          const d = m.data; log(m.from, '← ' + m.text);
          if (m.kind === 'Petició') {
            const k = key(d.x, d.y), b = blocks[k];
            if (b && b.train === d.train) { glog(`Petició repetida del ${d.train}: es torna a enviar l'autorització`); acts.push(tg(d.x, 'Autorització', { ...d, track: k })); }
            else if (queue.find(q => q.train === d.train)) { acts.push(tg(d.x, 'Espera', d)); }
            else {
              if (!incoming[d.x].includes(d.train)) add(at[d.x], d.train);
              if (!b && free(d.y) > 0) grant(d, acts);
              else if (b) { queue.push({ ...d, reqT: T }); glog(`${k} ocupada: ${d.train} a la cua`); acts.push(tg(d.x, 'Espera', d)); }
              else { glog(`${d.y} sense vies lliures: es nega la petició del ${d.train}`); acts.push(tg(d.x, 'Negació', d)); }
            }
          } else if (m.kind === 'Sortida') {
            del(at[d.x], d.train);
            const b = blocks[key(d.x, d.y)];
            if (b && b.train === d.train) { b.depT = d.hora; b.expArr = d.hora + runOf(d.train, d.x, d.y); }
          } else if (m.kind === 'Arribada') {
            const k = key(d.x, d.y), b = blocks[k];
            if (b && b.train === d.train) {
              delete blocks[k]; del(incoming[d.y], d.train); del(at[d.x], d.train); add(at[d.y], d.train);
              glog(`Pissarra: ${k} LLIURE (arribada del ${d.train} a ${d.y})`);
              if (isFinal(d.train, d.y)) removals.push({ st: d.y, train: d.train, t: T + 5 });
              acts.push(tg(d.y, 'Rebut', d));
              acts.push(tg(d.x, 'Arribada', d));
            } else { acts.push(tg(d.y, 'Rebut', d)); }
          } else if (m.kind === 'Avaria') {
            const b = Object.values(blocks).find(b => b.train === d.train);
            glog(b ? `AVARIA del ${d.train} al tram ${d.sec}: la via queda bloquejada; es planeja un tren de socors`
                   : `Avaria del ${d.train} comunicada, però el tren ja ha arribat: no cal socors`);
          }
        }
        // cua d'espera, per ordre d'arribada
        for (let i = 0; i < queue.length; i++) {
          const q = queue[i];
          if (!blocks[key(q.x, q.y)] && free(q.y) > 0) { grant(q, acts); queue.splice(i--, 1); }
        }
        // tren endarrerit: avís de retard a l'estació de destí
        for (const b of Object.values(blocks)) {
          const exp = b.expArr != null ? b.expArr : b.authT + 5 + runOf(b.train, b.x, b.y);
          if (T > exp + 10 && !b.retard) { b.retard = true; glog(`${b.train} fa tard al tram ${b.track}`); acts.push(tg(b.y, 'Retard', { train: b.train, x: b.x, y: b.y, track: b.track, exp })); }
        }
        return acts;
      };
      me.view = () => {
        const p = ['TRAMS'];
        for (const s of K.SECTIONS) for (const dir of (s.double ? ['E', 'W'] : ['E'])) {
          const k = K.trackName(s, dir), b = blocks[k];
          p.push(`  ${k.padEnd(7)} ${b ? `OCUPADA · ${b.train} ${b.x}→${b.y} · aut ${K.hm(b.authT)}${b.depT != null ? ' · surt ' + K.hm(b.depT) : ''}${b.expArr != null ? ' · arr. prev. ' + K.hm(b.expArr) : ''}${b.retard ? ' · RETARD' : ''}` : 'lliure'}`);
        }
        p.push('ESTACIONS');
        for (const st of K.ORDER) p.push(`  ${st}: ${at[st].join(', ') || '—'}${incoming[st].length ? ' | venen: ' + incoming[st].join(', ') : ''} | vies lliures ${free(st)}/${K.STATIONS[st].through}`);
        p.push('CUA D\'ESPERA');
        p.push(queue.length ? queue.map(q => `  ${q.train} ${q.x}→${q.y} (${K.hm(q.reqT)})`).join('\n') : '  —');
        return { title: 'Central', pissarra: p, llibretes: me.llibretes, general: me.general };
      };
      return me;
    },

    // ----------------------------- CAP D'ESTACIÓ -----------------------------
    chief(st, K) {
      const me = { kind: 'chief', st, llibreta: [] };
      const recs = {};          // llibreta de trens: un registre per tren
      const expected = [];      // trens anunciats amb "Ocupat"
      let L = 0;
      const log = s => me.llibreta.push(`[${K.hm(L)}] ${s}`);
      const tg = (kind, data) => { const text = K.fmt(kind, data, st, 'Central', L); log('→ ' + text); return { type: 'telegram', to: 'Central', kind, data, text }; };
      const final = id => { const r = K.routeOf(id); return r[r.length - 1] === st; };

      me.decide = o => {
        L = o.clock; const acts = [];
        const present = {};
        o.vias.forEach(v => { if (v.train) present[v.train.id] = { ...v.train, via: v.via }; });

        for (const p of o.papers) { log(`Paper lliurat pel maquinista del ${p.train}: ${p.text}`); const r = recs[p.train] || (recs[p.train] = { id: p.train }); r.cameFrom = p.x; r.cameTrack = p.track; }

        for (const m of o.inbox) {
          const d = m.data; log('← ' + m.text);
          const r = recs[d.train];
          if (m.kind === 'Hora') {
            const nv = d.hora + (opts.horaPlus2 ? K.TELEGRAM_MIN : 0);
            if (nv !== L) { acts.push({ type: 'setClock', value: nv }); log(`Rellotge posat en hora: ${K.hm(L)} → ${K.hm(nv)}`); L = nv; }
            else log('Rellotge comprovat: coincideix');
          } else if (m.kind === 'Autorització') { if (r && ['peticio', 'espera', 'negat'].includes(r.phase)) { r.phase = 'autoritzat'; r.auth = d; } }
          else if (m.kind === 'Espera') { if (r && r.phase === 'peticio') { r.phase = 'espera'; r.esperaT = L; } }
          else if (m.kind === 'Negació') { if (r && ['peticio', 'espera'].includes(r.phase)) { r.phase = 'negat'; r.retryAt = L + 5; } }
          else if (m.kind === 'Ocupat') { if (!expected.find(e => e.train === d.train) && !(r && r.via)) expected.push({ train: d.train, x: d.x, side: K.dirOf(st, d.x), via: null, track: d.track }); }
          else if (m.kind === 'Rebut') { if (r && r.arrPending) { r.arrPending = null; log(`Arribada del ${d.train} confirmada`); if (r.phase === 'cotxeres') delete recs[d.train]; } }
          else if (m.kind === 'Arribada') { if (r && r.phase === 'sortit') delete recs[d.train]; }
        }
        for (const ms of o.messengers) {
          log(`Missatger: ${ms.text}`);
          if (ms.data.kind === 'avaria') acts.push(tg('Avaria', { train: ms.data.train, sec: ms.data.sec, x: ms.data.x, km: ms.data.km }));
        }

        // què veig a les vies
        for (const [id, p] of Object.entries(present)) {
          let r = recs[id];
          if (!r || r.via == null) {
            r = recs[id] = Object.assign(r || { id }, { via: p.via, type: p.type });
            const ei = expected.findIndex(e => e.train === id);
            const route = K.routeOf(id), ri = route.indexOf(st);
            // Si aquesta no és l'estació d'origen del tren, l'he vist entrar: és una arribada
            // (encara que l'avís "Ocupat" s'hagi perdut).
            if (r.cameFrom || ei >= 0 || ri > 0) {
              const x = r.cameFrom || (ei >= 0 ? expected[ei].x : route[ri - 1]);
              if (ei < 0) log(`El ${id} arriba sense que m'haguessin avisat (Ocupat no rebut)`);
              const track = r.cameTrack || K.trackName(K.sectionBetween(x, st), K.dirOf(x, st));
              if (ei >= 0) expected.splice(ei, 1);
              r.arrPending = { x, y: st, track, lastSent: L };
              r.phase = final(id) ? 'final' : 'arribat';
              log(`Arriba el tren ${id} a la via ${p.via}`);
              acts.push(tg('Arribada', { train: id, x, y: st, track }));
            } else { r.phase = final(id) ? 'final' : 'origen'; log(`Tren ${id} a la via ${p.via}, a punt per sortir`); }
          } else r.via = p.via;
          r.crashed = p.crashed;
        }
        // l'expected que ha arribat abans que el paper
        for (const [id, r] of Object.entries(recs)) {
          if (r.via != null && !present[id]) {
            if (r.phase === 'paper') { r.phase = 'sortit'; log(`Ha sortit el tren ${id} cap a ${r.auth.y}`); r.via = null; }
            else {
              log(`El tren ${id} ja no és a l'estació (cotxeres)`);
              // Pas 5 del procediment normal: si no arriba el rebut, es continua enviant l'arribada.
              if (r.arrPending) { r.via = null; r.phase = 'cotxeres'; } else delete recs[id];
            }
          }
        }

        // arribades no confirmades: es reenvien periòdicament
        for (const r of Object.values(recs)) if (r.arrPending && L - r.arrPending.lastSent >= 6) {
          log(`Sense rebut de l'arribada del ${r.id}: es torna a enviar`);
          acts.push(tg('Arribada', { train: r.id, x: r.arrPending.x, y: st, track: r.arrPending.track }));
          r.arrPending.lastSent = L;
        }

        // peticions de via
        for (const r of Object.values(recs)) {
          if (r.via == null || r.crashed) continue;
          const nx = K.nextOf(r.id, st); if (!nx) continue;
          const track = K.trackName(K.sectionBetween(st, nx), K.dirOf(st, nx));
          const d = { train: r.id, x: st, y: nx, track };
          const sched = K.TIMETABLE[r.id] ? K.TIMETABLE[r.id].times[st].dep : null;
          if (r.phase === 'origen' || r.phase === 'arribat' || (r.phase === 'negat' && L >= r.retryAt)) {
            if (sched != null && L < sched - 6) continue;
            acts.push(tg('Petició', d)); r.phase = 'peticio'; r.petT = L;
          } else if (r.phase === 'peticio' && L - r.petT >= 6) {
            log(`Petició del ${r.id} sense resposta: es repeteix`); acts.push(tg('Petició', d)); r.petT = L;
          } else if (opts.resendAfterEspera && r.phase === 'espera' && L - r.esperaT >= 10) {
            log(`Fa estona que el ${r.id} espera: es recorda la petició`); acts.push(tg('Petició', d)); r.esperaT = L;
          }
        }

        // autoritzats: preparar la via, avisar el maquinista i telegrafiar la sortida
        for (const r of Object.values(recs)) {
          if (r.phase !== 'autoritzat' || r.via == null || r.crashed) continue;
          const side = K.dirOf(st, r.auth.y);
          if (opts.sideRule && expected.some(e => e.side === side)) {
            if (!r.waitNoted) { log(`${r.id} autoritzat, però arriba un tren pel costat ${K.sideName(side)}: no surt fins que hagi entrat`); r.waitNoted = true; }
            continue;
          }
          const sched = K.TIMETABLE[r.id] ? K.TIMETABLE[r.id].times[st].dep : null;
          const target = Math.max(L + 1, sched != null ? sched : 0);
          if (target - L > 1) continue;
          const paper = { kind: 'permís', train: r.id, x: st, y: r.auth.y, track: r.auth.track, hora: target, text: `Permís: ${r.id} pot sortir de ${st} cap a ${r.auth.y} per la via ${r.auth.track} a les ${K.hm(target)}` };
          acts.push({ type: 'paper', train: r.id, paper });
          log(`Via preparada. Paper al maquinista del ${r.id}: sortida a les ${K.hm(target)}`);
          acts.push(tg('Sortida', { train: r.id, x: st, y: r.auth.y, track: r.auth.track, hora: target }));
          r.phase = 'paper'; r.paper = paper;
        }

        // agulles (encarregats ferroviaris)
        const reserved = () => expected.filter(e => e.via != null).map(e => e.via);
        for (const e of expected) {
          const ok = e.via != null && o.vias.find(v => v.via === e.via && !v.train);
          if (!ok) {
            const prev = e.via; e.via = null;
            const v = defaultVia(e.side, freeThroughVias(K, st, o.vias, reserved()));
            e.via = v;
            if (v == null) log(`ALERTA: no hi ha cap via lliure per rebre el ${e.train}`);
            else if (prev !== v) log(`Via ${v} reservada per al ${e.train}, que ve de ${e.x}`);
          }
        }
        for (const side of K.STATIONS[st].sides) {
          let want = null;
          const dep = Object.values(recs).find(r => r.phase === 'paper' && r.via != null && L >= r.paper.hora && K.dirOf(st, r.paper.y) === side);
          if (dep) want = dep.via;
          else { const e = expected.find(e => e.side === side && e.via != null); if (e) want = e.via; }
          if (want == null) want = defaultVia(side, freeThroughVias(K, st, o.vias, reserved()));
          if (want != null && want !== o.switches[side]) { acts.push({ type: 'switch', side, via: want }); log(`Agulla ${K.sideName(side)} → via ${want}`); }
        }
        me._L = L; me._o = o;
        return acts;
      };
      me.view = () => {
        const o = me._o; const p = [`Rellotge: ${K.hm(L)}`];
        if (o) {
          for (const v of o.vias) {
            const r = v.train && recs[v.train.id];
            const e = expected.find(e => e.via === v.via);
            const dead = v.via > K.STATIONS[st].through ? ' (morta)' : '';
            const PH = { origen: 'a punt', arribat: 'arribat', peticio: 'petició enviada', espera: 'en espera', negat: 'negat, cal tornar a demanar', autoritzat: 'autoritzat', final: 'final de trajecte' };
            const ph = r ? (r.phase === 'paper' ? `permís lliurat (${K.hm(r.paper.hora)})` : (PH[r.phase] || r.phase)) : '';
            p.push(`Via ${v.via}${dead}: ${v.train ? v.train.id + (ph ? ' — ' + ph : '') : 'lliure'}${e ? ' · reservada ' + e.train : ''}`);
          }
          p.push('Agulles: ' + Object.entries(o.switches).map(([s, v]) => `${K.sideName(s)}→${v}`).join(' · '));
        }
        p.push('Esperats: ' + (expected.map(e => `${e.train} de ${e.x}`).join(', ') || '—'));
        const pend = Object.values(recs).filter(r => r.arrPending);
        p.push('Arribades sense rebut: ' + (pend.map(r => r.id).join(', ') || '—'));
        return { title: `Estació ${st}`, pissarra: p, llibreta: me.llibreta };
      };
      return me;
    },
    // El maquinista rep l'avís (paper amb l'hora) i, si s'avaria, envia un tripulant a peu.
    driver(id, K) { return makeDriver(id, K, { handOver: false, messenger: true }); },
  };
}

// El disseny s'implementa tal com és al paper, sense correccions.
PROTOCOLS.nostre = makePaperProtocol('El nostre disseny (26/11)', { horaPlus2: false, resendAfterEspera: false, sideRule: false });

function runScenario(scnId, protocolId) { return new World(scnId, protocolId).runToEnd(); }

return { World, SCENARIOS, PROTOCOLS, STATIONS, SECTIONS, ORDER, TIMETABLE, hm, parseHM, trackName, runScenario, viasOf };
})();
if (typeof module !== 'undefined') module.exports = SIM;
