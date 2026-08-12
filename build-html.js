// Minifie index.html -> dist/index.html SANS changer le rendu :
// - protège le contenu sensible aux blancs (<script>/<style>/<pre>/<textarea>),
// - retire les commentaires HTML,
// - réduit tout enchaînement de blancs (2+) à UN espace — le navigateur réduit
//   déjà ces blancs en rendu, donc aucun changement visuel.
// (esbuild ne minifie pas le HTML ; ce petit script s'en charge.)
const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
const stash = [];
const NUL = String.fromCharCode(0);        // sentinelle jamais présente dans le HTML,
                                           // et que \s (collapse des blancs) ne touche pas
html = html.replace(/<(script|style|pre|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi,
  m => { stash.push(m); return NUL + (stash.length - 1) + NUL; });
html = html.replace(/<!--[\s\S]*?-->/g, '');
html = html.replace(/\s{2,}/g, ' ').trim();
html = html.replace(new RegExp(NUL + '(\\d+)' + NUL, 'g'), (_, i) => stash[+i]);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('index.html minifié.');
