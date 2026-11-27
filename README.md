# Ferrocarril 1912 — simulador de circulació

Simulació minut a minut (06:30–12:30) del disseny del 26 de novembre de **Marc Rodríguez Camacho i Pol Piquet Las Heras**.

**Pàgina:** https://fibmixx.github.io/Exercici-CSI-Trens/ · també es pot obrir `index.html` amb doble clic (és un sol fitxer, sense servidor ni dependències).

## Estructura

| Fitxer | Contingut |
|---|---|
| `index.html` | La pàgina lliurable (generada). |
| `src/core.js` | El món (`class World`) i els actors (`PROTOCOLS`). |
| `src/ui.js`, `src/page.html`, `src/about.html` | Interfície. |
| `tools/build.py` | Ajunta `src/` en un sol `index.html`. |
| `tools/avalua.js` | Avaluació sense navegador: `node tools/avalua.js [exemple\|nostre] [escenari] [v]`. |

**El món i els actors estan separats.** Els actors no reben mai cap referència al món, només un objecte `obs` amb:
- el seu rellotge;
- els telegrames, papers i missatgers que els han arribat;
- el que veuen: el cap d'estació veu les vies i les agulles de la seva estació, i el maquinista veu on és el seu tren i si està avariat.

Tot el que recorden ho tenen a la llibreta o a la pissarra (`view()`), i la pàgina ho mostra.

## Protocols

- **Exemple**: cada estació deixa sortir els trens a l'hora de l'horari i prou. No té accidents en l'escenari normal, falla en els de retard, avaria i rellotge, i no fa sortir mai els mercaderies, tal com demana l'enunciat.
- **El nostre disseny (26/11)**: el disseny en paper tal com és, **sense corregir-ne els forats**.

## Resultats (`node tools/avalua.js`)

| Escenari | Accidents | Viatgers | Retard mitjà | Mercaderies |
|---|---|---|---|---|
| 1. Normal | cap | 8/8 | 16,1 min | 2/2 |
| 2. Retard | cap | 8/8 | 16,1 min | 2/2 |
| 3. Avaria | Descarrilament a D, 12:02 (T108) | 7/8 | 29,9 min | 1/2 |
| 4. Telègraf caigut | cap | 8/8 | 33,1 min | 2/2 |
| 5. Rellotge | cap | 8/8 | 16,1 min | 2/2 |
| 6. Tot alhora | Descarrilament a D, 12:02 (T108) | 7/8 | 42,7 min | 1/2 |

## Forats que el simulador troba al disseny

1. **Agulla compartida entre una sortida i una arribada** (escenaris 3 i 6, 12:02 a D).
   - Què passa: el T107 entra per l'agulla oest de D. En el mateix minut, el cap mou aquella agulla perquè surti el T108 cap a C, i el T108 descarrila.
   - Per què: el disseny bloqueja els trams, però no diu res de l'agulla d'una estació quan un tren hi entra i un altre en surt pel mateix costat. En via doble (C-D) això pot passar.
2. **El missatge «Hora» no compta el temps del telègraf.**
   - Què passa: el telegrama triga 2 minuts, i les estacions es posen a l'hora que diu el missatge. Totes queden 2 minuts endarrerides (el rellotge d'E, que anava 10 minuts avançat, també s'arregla). Es veu als rellotges del mapa: (−2).
   - Conseqüència: no causa accidents, perquè la seguretat no depèn de l'hora, però sí retards.
3. **Cada parada costa com a mínim 5 minuts.**
   - Per què: la petició només es pot fer quan el tren ja és a l'estació, i el cicle Petició → Autorització → paper suma 2 + 2 + 1 minuts.
   - Conseqüència: retard mitjà de 16 minuts fins i tot en l'escenari normal. Per això el retard de 25 minuts del T102 (escenari 2) queda absorbit i surt el mateix resultat que l'1.
4. **Telègraf caigut a C.**
   - Què passa: és segur (zero accidents, 33 telegrames perduts), però les vies B-C i C-D queden bloquejades fins a les 09:30 i els trens s'acumulen.
   - Risc: si s'hagués perdut una Autorització d'una petició a la qual la central ja havia respost «Espera», l'estació no tornaria a demanar. Hi hauria un bloqueig fins al final del dia.
5. **Avaria.** El tripulant triga 72 minuts a peu (6 km a 5 km/h), i el tren es repara abans (60 minuts). El missatge arriba quan ja no cal. El tren de socors només queda planejat.

## Decisions afegides en programar-lo (el paper no les concreta)

- Es demana via per tram (de cada estació a la següent).
- Quan es demana la via: un tren de viatgers, 6 minuts abans de l'hora de l'horari; un mercaderies, en quant el cap el veu.
- Les peticions i les arribades sense resposta es repeteixen cada 6 minuts. Després d'un «Espera», l'estació no torna a demanar.
- La central:
  - posa en una cua les peticions de trams ocupats;
  - respon «Negació» si l'estació de destí és plena, i l'estació torna a demanar al cap de 5 minuts;
  - compta els trens de cada estació amb els missatges i el reglament (aparicions a l'origen i retirada a cotxeres).
- Les agulles: amb l'«Ocupat», el cap reserva una via per al tren que arriba. Si no n'espera cap, l'agulla oest apunta a la via lliure més baixa i l'est a la més alta.
- Si un tren arriba sense «Ocupat» (s'ha perdut), el cap l'identifica per l'horari.
- Altres llindars:
  - l'avís de retard s'envia als 10 minuts de l'arribada prevista;
  - el missatge «Hora» s'envia a les 06:30;
  - el maquinista d'un tren avariat envia el tripulant al cap de 10 minuts.
- L'avís al maquinista es fa amb un paper amb l'hora de sortida.
