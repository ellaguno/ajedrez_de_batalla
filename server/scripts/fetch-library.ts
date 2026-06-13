/**
 * Descarga colecciones grandes de partidas (cientos por jugador) desde
 * pgnmentor.com y las importa a la biblioteca. Las jugadas de ajedrez son
 * hechos (sin copyright), así que estas colecciones son de libre distribución.
 *
 * Uso:
 *   npm run library:fetch                  # lista por defecto (clásicos)
 *   npm run library:fetch -- Kasparov Tal  # jugadores concretos
 *
 * Cada jugador se importa con fuente "pgnmentor:<Jugador>". Re-ejecutar
 * reemplaza esa colección (borra e inserta), así que es idempotente.
 */
import AdmZip from 'adm-zip';
import { db } from '../src/db.js';
import { parseCollection } from '../src/pgn.js';
import { importGames } from '../src/library.js';

const DEFAULT_PLAYERS = [
  'Kasparov',
  'Fischer',
  'Morphy',
  'Capablanca',
  'Tal',
  'Alekhine',
  'Carlsen',
];

const players = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const list = players.length ? players : DEFAULT_PLAYERS;

async function fetchPlayer(name: string): Promise<void> {
  const url = `https://www.pgnmentor.com/players/${name}.zip`;
  process.stdout.write(`· ${name}: descargando ${url} … `);
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`falló (HTTP ${res.status})`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let text = '';
  try {
    const zip = new AdmZip(buf);
    for (const entry of zip.getEntries()) {
      if (entry.entryName.toLowerCase().endsWith('.pgn')) {
        text += '\n' + entry.getData().toString('utf8');
      }
    }
  } catch {
    console.log('falló (ZIP inválido)');
    return;
  }

  const games = parseCollection(text, 'famous');
  if (games.length === 0) {
    console.log('sin partidas válidas');
    return;
  }
  const source = `pgnmentor:${name}`;
  db.prepare('DELETE FROM library_games WHERE source = ? AND builtin = 0').run(source);
  const added = importGames(games, source, 0);
  console.log(`${added} partidas importadas`);
}

console.log(`Importando ${list.length} jugador(es) a la biblioteca…`);
for (const name of list) {
  try {
    await fetchPlayer(name);
  } catch (err) {
    console.log(`· ${name}: error — ${(err as Error).message}`);
  }
}
const total = (db.prepare('SELECT COUNT(*) AS n FROM library_games').get() as { n: number }).n;
console.log(`\nListo. La biblioteca tiene ahora ${total} partidas en total.`);
