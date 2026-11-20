// Ricalcola l'impronta SHA-256 dello script e la scrive nella Content-Security-Policy
const fs = require('fs'), crypto = require('crypto');
const p = process.argv[2], s = fs.readFileSync(p, 'utf8');
const scripts = [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error('attesi 1 script, trovati ' + scripts.length);
const h = crypto.createHash('sha256').update(scripts[0][1], 'utf8').digest('base64');
const out = s.replace(/script-src 'sha256-[^']*'/, `script-src 'sha256-${h}'`);
fs.writeFileSync(p, out); console.log('impronta:', h);
