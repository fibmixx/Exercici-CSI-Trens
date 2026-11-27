// =====================================================================
//  INTERFÍCIE (només dibuixa; no intervé en la simulació)
// =====================================================================
(() => {
const { World, SCENARIOS, PROTOCOLS, STATIONS, SECTIONS, ORDER, hm, viasOf } = SIM;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

for (const [id, p] of Object.entries(PROTOCOLS)) $('protocol').insertAdjacentHTML('beforeend', `<option value="${id}">${esc(p.name)}</option>`);
$('protocol').value = 'nostre';
for (const s of SCENARIOS) $('scenario').insertAdjacentHTML('beforeend', `<option value="${s.id}">${s.id}. ${esc(s.name)}</option>`);

let world, timer = null, centralTab = 'general', driverSel = null;

// ---------------- geometria del mapa ----------------
const X = km => 70 + km * (1060 / 36);
const HW = 46, VIA_Y = { 1: 150, 2: 176, 3: 202 }, MID = 163, T1 = 156, T2 = 170, TS = 163;
const CEN = { x: 600, y: 32 };
const edge = (st, side) => X(STATIONS[st].km) + (side === 'E' ? HW : -HW);

function reset() {
  stop();
  world = new World(Number($('scenario').value), $('protocol').value);
  driverSel = null;
  render();
}
function stop() { if (timer) { clearInterval(timer); timer = null; $('play').textContent = '⏵ Reprodueix'; } }
function play() {
  if (timer) return stop();
  $('play').textContent = '⏸ Pausa';
  const tick = () => { const n = 1; for (let i = 0; i < n && !world.done; i++) world.step(); render(); if (world.done) stop(); };
  const restart = () => { clearInterval(timer); timer = setInterval(tick, Math.round(1000 / Number($('speed').value))); };
  restart();
  $('speed').oninput = () => { if (timer) restart(); };
}

function trainRect(tr, x, y) {
  const fill = tr.state === 'crashed' ? 'var(--red)' : tr.state === 'broken' ? 'var(--amber)' : tr.type === 'P' ? 'var(--blue)' : 'var(--brown)';
  return `<g><rect x="${x - 21}" y="${y - 7}" width="42" height="14" rx="3" fill="${fill}" stroke="#1d1a16" stroke-width="0.8"/>` +
    `<text x="${x}" y="${y + 4}" font-size="10" text-anchor="middle" fill="#fff" font-family="Courier New" font-weight="bold">${tr.id}${tr.state === 'crashed' ? '✖' : ''}</text></g>`;
}

function renderMap() {
  const w = world, t = w.t - (w.done ? 1 : 0);
  let s = '';
  // central i cables de telègraf
  s += `<rect x="${CEN.x - 60}" y="${CEN.y - 18}" width="120" height="30" fill="#fff" stroke="var(--ink)"/><text x="${CEN.x}" y="${CEN.y + 2}" text-anchor="middle" font-size="13" font-weight="bold">CENTRAL ${hm(t)}</text>`;
  for (const st of ORDER) {
    const x = X(STATIONS[st].km);
    const up = w.lineUp(st, t);
    s += `<line x1="${CEN.x}" y1="${CEN.y + 12}" x2="${x}" y2="118" stroke="${up ? '#a99d88' : 'var(--red)'}" stroke-dasharray="${up ? '3 3' : '2 6'}"/>`;
  }
  // trams
  for (const sec of SECTIONS) {
    const x1 = edge(sec.w, 'E'), x2 = edge(sec.e, 'W');
    if (sec.double) {
      s += `<line x1="${x1}" y1="${T1}" x2="${x2}" y2="${T1}" stroke="var(--rail)" stroke-width="3"/><line x1="${x1}" y1="${T2}" x2="${x2}" y2="${T2}" stroke="var(--rail)" stroke-width="3"/>`;
      s += `<text x="${x1 + 6}" y="${T1 - 5}" font-size="9" fill="var(--muted)">via 1 →</text><text x="${x2 - 6}" y="${T2 + 13}" font-size="9" fill="var(--muted)" text-anchor="end">← via 2</text>`;
      for (const [xe, d] of [[x1, 1], [x2, -1]]) s += `<path d="M${xe + 14 * d} ${T1} L${xe} ${MID} L${xe + 14 * d} ${T2}" stroke="var(--rail)" stroke-width="3" fill="none"/>`;
    } else {
      s += `<line x1="${x1}" y1="${TS}" x2="${x2}" y2="${TS}" stroke="var(--rail)" stroke-width="3"/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${TS - 8}" font-size="9" fill="var(--muted)" text-anchor="middle">via única</text>`;
    }
    s += `<text x="${(x1 + x2) / 2}" y="${TS + 32}" font-size="11" text-anchor="middle" fill="var(--muted)">${sec.id} · ${sec.km} km</text>`;
  }
  // estacions
  for (const st of ORDER) {
    const S = STATIONS[st], cx = X(S.km), xl = cx - HW, xr = cx + HW;
    s += `<rect x="${xl}" y="132" width="${2 * HW}" height="${S.dead ? 84 : (S.through === 3 ? 84 : 58)}" fill="#fff8e8" stroke="var(--line)"/>`;
    s += `<text x="${cx}" y="127" text-anchor="middle" font-size="16" font-weight="bold">${st}</text>`;
    for (const v of viasOf(st)) {
      const y = VIA_Y[v];
      let a = xl + 18, b = xr - 18;
      if (S.dead && v === S.dead.via) { if (S.dead.side === 'E') a = cx - 10; else b = cx + 10; s += `<line x1="${S.dead.side === 'E' ? a : b}" y1="${y - 5}" x2="${S.dead.side === 'E' ? a : b}" y2="${y + 5}" stroke="var(--rail)" stroke-width="3"/>`; }
      s += `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" stroke="var(--rail)" stroke-width="2"/><text x="${xl + 3}" y="${y + 3}" font-size="8" fill="var(--muted)">${v}</text>`;
    }
    // agulles: línia del tram cap a la via on apunten
    for (const side of S.sides) {
      const v = w.switches[st][side], xe = side === 'E' ? xr : xl, xi = side === 'E' ? xr - 18 : xl + 18;
      s += `<line x1="${xe}" y1="${MID}" x2="${xi}" y2="${VIA_Y[v]}" stroke="#7b2d26" stroke-width="3"/><circle cx="${xe}" cy="${MID}" r="3" fill="#7b2d26"/>`;
    }
    const lt = t + w.clockOff[st], off = w.clockOff[st];
    s += `<text x="${cx}" y="234" text-anchor="middle" font-size="12" font-family="Courier New" fill="${off ? 'var(--red)' : 'var(--ink)'}">⏱ ${hm(lt)}${off ? ` (${off > 0 ? '+' : ''}${off})` : ''}</text>`;
    if (!w.lineUp(st, t)) s += `<text x="${cx}" y="248" text-anchor="middle" font-size="11" fill="var(--red)">telègraf caigut</text>`;
  }
  // trens
  const perVia = {};
  for (const tr of Object.values(w.trains)) {
    if (tr.loc === 'station') {
      const k = tr.st + tr.via; const n = perVia[k] = (perVia[k] || 0) + 1;
      s += trainRect(tr, X(STATIONS[tr.st].km) + (n - 1) * 12, VIA_Y[tr.via] - (n - 1) * 4);
    } else if (tr.loc === 'section') {
      const sec = SECTIONS.find(x => x.id === tr.sec);
      const km = STATIONS[sec.w].km + w.xOf(tr, sec);
      const y = sec.double ? (tr.track === 1 ? T1 : T2) : TS;
      s += trainRect(tr, Math.min(Math.max(X(km), edge(sec.w, 'E') + 21), edge(sec.e, 'W') - 21), y);
    }
  }
  // telegrames en camí / perduts fa poc
  for (const g of w.telegrams) {
    const stn = g.from === 'Central' ? g.to : g.from;
    const sx = X(STATIONS[stn].km), sy = 118;
    const [ax, ay, bx, by] = g.from === 'Central' ? [CEN.x, CEN.y + 12, sx, sy] : [sx, sy, CEN.x, CEN.y + 12];
    if (g.status === 'en camí' && g.sentT <= t) {
      const p = Math.min(1, (t - g.sentT + 0.5) / 2);
      s += `<circle cx="${ax + (bx - ax) * p}" cy="${ay + (by - ay) * p}" r="4" fill="var(--blue)"><title>${esc(g.text)}</title></circle>`;
    } else if (g.status === 'perdut' && t - g.lostAt <= 2) {
      const p = g.lostAt === g.sentT ? 0.2 : 0.85;
      s += `<text x="${ax + (bx - ax) * p}" y="${ay + (by - ay) * p + 5}" text-anchor="middle" font-size="15" fill="var(--red)" font-weight="bold">✖<title>${esc(g.text)}</title></text>`;
    }
  }
  for (const m of w.messengers) {
    if (m.status !== 'en camí') continue;
    const p = (t - m.sentT) / (m.arriveT - m.sentT);
    const km = m.fromKm + (STATIONS[m.to].km - m.fromKm) * p;
    s += `<text x="${X(km)}" y="275" text-anchor="middle" font-size="16">🚶<title>${esc(m.text)}</title></text>`;
  }
  $('map').innerHTML = s;
}

function renderLogs() {
  const w = world;
  const rows = [
    ...w.telegrams.map(g => ({ ...g, kindLabel: g.kind })),
    ...w.messengers.map(m => ({ ...m, kindLabel: 'Missatger' })),
  ].sort((a, b) => b.sentT - a.sentT || b.id - a.id);
  $('tglog').innerHTML = rows.map(g => {
    const st = g.status === 'perdut' ? 'PERDUT' : g.status === 'lliurat' ? `lliurat ${hm(g.deliveredAt)}` : `en camí (${hm(g.arriveT)})`;
    const cls = g.status === 'perdut' ? 'lost' : g.status === 'en camí' ? 'transit' : '';
    const txt = g.kindLabel === 'Missatger' ? `🚶 ${g.text}` : g.text.replace(' | ', '<br>');
    return `<tr class="${cls}"><td>${g.id}</td><td class="mono">${hm(g.sentT)}</td><td>${esc(g.from)} → ${esc(g.to)}</td><td class="mono">${g.kindLabel === 'Missatger' ? esc(txt) : txt.split('<br>').map(esc).join('<br>')}</td><td class="st">${st}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="sub">Encara no s\'ha enviat res.</td></tr>';
  const ev = $('events');
  const atBottom = ev.scrollTop + ev.clientHeight >= ev.scrollHeight - 5;
  ev.innerHTML = w.events.map(e => `<div class="${e.includes('ACCIDENT') ? 'acc' : ''}">${esc(e)}</div>`).join('') || '<span class="sub">—</span>';
  if (atBottom) ev.scrollTop = ev.scrollHeight;
}

function notebookHtml(lines) { return esc(lines.join('\n')) || '<span class="sub">(buida)</span>'; }

function renderBooks() {
  const w = world;
  const keep = {};
  document.querySelectorAll('.notebook').forEach(n => { keep[n.dataset.k] = { top: n.scrollTop, bottom: n.scrollTop + n.clientHeight >= n.scrollHeight - 5 }; });
  let h = '';
  const cv = w.central.view();
  const cl = centralTab === 'general' ? (cv.general || []) : cv.llibretes[centralTab];
  h += `<div class="book"><h3>Central <span class="tabs">${['general', ...ORDER].map(k => `<button data-ct="${k}" class="${k === centralTab ? 'on' : ''}">${k === 'general' ? 'Registre' : 'Llibreta ' + k}</button>`).join('')}</span></h3>
    <div class="lbl">Pissarra</div><div class="board">${esc(cv.pissarra.join('\n'))}</div>
    <div class="lbl">${centralTab === 'general' ? 'Registre del cap de circulació' : 'Llibreta de l\'estació ' + centralTab}</div><div class="notebook" data-k="central">${notebookHtml(cl)}</div></div>`;
  for (const st of ORDER) {
    const v = w.chiefs[st].view();
    h += `<div class="book"><h3>${esc(v.title)}</h3><div class="lbl">Pissarra</div><div class="board">${esc(v.pissarra.join('\n'))}</div><div class="lbl">Llibreta</div><div class="notebook" data-k="${st}">${notebookHtml(v.llibreta)}</div></div>`;
  }
  const ids = Object.keys(w.drivers);
  if (!driverSel || !ids.includes(driverSel)) driverSel = ids[0] || null;
  h += `<div class="book"><h3>Maquinistes <select id="drvsel">${ids.map(i => `<option ${i === driverSel ? 'selected' : ''}>${i}</option>`).join('')}</select></h3>`;
  if (driverSel) { const v = w.drivers[driverSel].view(); h += `<div class="lbl">Butxaca</div><div class="board">${esc(v.pissarra.join('\n'))}</div><div class="lbl">Llibreta</div><div class="notebook" data-k="drv">${notebookHtml(v.llibreta)}</div>`; }
  else h += '<div class="sub">Encara no ha aparegut cap tren.</div>';
  h += '</div>';
  $('books').innerHTML = h;
  document.querySelectorAll('.notebook').forEach(n => { const k = keep[n.dataset.k]; n.scrollTop = !k || k.bottom ? n.scrollHeight : k.top; });
  document.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => { centralTab = b.dataset.ct; renderBooks(); });
  const ds = $('drvsel'); if (ds) ds.onchange = () => { driverSel = ds.value; renderBooks(); };
}

function accText(a) { return `${a.type} · ${a.where} · ${hm(a.t)} (${a.trains.join(' i ')})`; }

function render() {
  const w = world, r = w.results();
  $('bigclock').textContent = hm(w.done ? w.tEnd : w.t) + (w.done ? ' · fi del dia' : '');
  $('sPax').textContent = `${r.paxArrived}/8`;
  $('sFr').textContent = `${r.freightArrived}/2`;
  $('sLost').textContent = w.telegrams.filter(g => g.status === 'perdut').length;
  $('sAcc').textContent = r.accidents.length;
  $('accidents').innerHTML = r.accidents.map(a => `<div class="acc">⚠ ${esc(accText(a))}</div>`).join('');
  renderMap(); renderLogs(); renderBooks();
}

function evaluate() {
  stop();
  $('evalcard').style.display = '';
  $('evalout').innerHTML = '<span class="sub">Calculant…</span>';
  setTimeout(() => {
    let h = '';
    for (const [pid, p] of Object.entries(PROTOCOLS)) {
      h += `<h3 style="margin:10px 0 4px">${esc(p.name)}</h3><table class="evtable"><thead><tr><th>Escenari</th><th>Accidents (quins, on i a quina hora)</th><th>Viatgers arribats</th><th>Retard mitjà</th><th>Mercaderies arribats</th><th>Telegrames perduts</th></tr></thead><tbody>`;
      for (const s of SCENARIOS) {
        const w = SIM.runScenario(s.id, pid), r = w.results();
        h += `<tr><td>${s.id}. ${esc(s.name)}</td><td>${r.accidents.length ? r.accidents.map(a => `<div class="acc">${esc(accText(a))}</div>`).join('') : '<span class="ok">cap</span>'}</td><td>${r.paxArrived}/8</td><td>${r.avgDelay == null ? '—' : r.avgDelay.toFixed(1).replace('.', ',') + ' min'}</td><td>${r.freightArrived}/2</td><td>${w.telegrams.filter(g => g.status === 'perdut').length}</td></tr>`;
      }
      h += '</tbody></table>';
    }
    h += '<p class="sub">El retard mitjà es calcula sobre els trens de viatgers que arriben a destí (els avançaments compten com a 0).</p>';
    $('evalout').innerHTML = h;
    $('evalcard').scrollIntoView({ behavior: 'smooth' });
  }, 30);
}

$('reset').onclick = reset;
$('protocol').onchange = reset;
$('scenario').onchange = reset;
$('step').onclick = () => { stop(); world.step(); render(); };
$('play').onclick = play;
$('all').onclick = () => { stop(); world.runToEnd(); render(); };
$('eval').onclick = evaluate;

$('about').innerHTML = ABOUT_HTML;
reset();
})();
