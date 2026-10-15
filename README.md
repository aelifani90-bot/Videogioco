# Gran Galoppo

Gioco manageriale di corse di cavalli al galoppo, con la gara in 3D. Si gioca nel browser.

Gestisci la scuderia, allena i cavalli, compra al mercato e corri cinque livelli di gare.
Scommetti sulle corse con quote a totalizzatore: vincente, piazzato, accoppiata e tris.
Puoi tenere tre carriere in tre slot, con quattro livelli di difficoltà, ed esportare il salvataggio su file.
In gara usa i tasti 1, 2 e 3 per il ritmo, le frecce sinistra e destra per cambiare corsia e il tasto C per cambiare telecamera.

Il gioco usa moduli JavaScript, quindi va aperto da un server web (per esempio GitHub Pages) e non con doppio clic sul file.
Per provarlo sul tuo computer lancia `python3 -m http.server` nella cartella e apri http://localhost:8000

## Crediti

La grafica 3D usa [three.js](https://threejs.org), licenza MIT (vedi `lib/three/LICENSE`).
Il modello del cavallo al galoppo `models/Horse.glb` viene dagli esempi ufficiali di three.js, creato da mirada per il progetto "ROME".
