// Avalua els sis escenaris amb cada protocol, sense navegador:  node tools/avalua.js [protocol] [escenari]
const SIM = require('../src/core.js');
const [, , onlyP, onlyS, verbose] = process.argv;
for (const pid of Object.keys(SIM.PROTOCOLS)) {
  if (onlyP && onlyP !== pid) continue;
  console.log(`\n=== ${SIM.PROTOCOLS[pid].name} ===`);
  for (const s of SIM.SCENARIOS) {
    if (onlyS && Number(onlyS) !== s.id) continue;
    const w = SIM.runScenario(s.id, pid);
    const r = w.results();
    const acc = r.accidents.map(a => `${a.type} ${a.where} ${SIM.hm(a.t)} (${a.trains.join(',')})`).join('; ') || 'cap';
    console.log(`${s.id}. ${s.name.padEnd(16)} accidents: ${acc} | viatgers ${r.paxArrived}/8 | retard ${r.avgDelay == null ? '-' : r.avgDelay.toFixed(1)} | mercaderies ${r.freightArrived}/2 | perduts ${w.telegrams.filter(g => g.status === 'perdut').length}`);
    if (verbose) console.log(w.events.join('\n'));
  }
}
