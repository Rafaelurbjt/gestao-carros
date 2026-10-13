// Roda DEPOIS de "expo export --platform web": transforma a pasta dist em um PWA
// (manifest, service worker para receber push, ícone e meta tags do iPhone).
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const dist = path.join(raiz, 'dist');
const indexPath = path.join(dist, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('dist/index.html não encontrado. Rode antes: npx.cmd expo export --platform web');
  process.exit(1);
}

// 1) Ícone do app
const icone = path.join(raiz, 'assets', 'images', 'icon.png');
if (fs.existsSync(icone)) {
  fs.copyFileSync(icone, path.join(dist, 'icon.png'));
  fs.copyFileSync(icone, path.join(dist, 'apple-touch-icon.png'));
} else {
  console.warn('Aviso: assets/images/icon.png não encontrado; o app ficará sem ícone.');
}

// 2) Manifest do PWA
const manifest = {
  name: 'Gestão de Carros',
  short_name: 'Gestão',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f3f4f6',
  theme_color: '#1d4ed8',
  icons: [
    { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
};
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 3) Service worker: recebe o push e mostra a notificação, mesmo com o app fechado
const sw = [
  "self.addEventListener('install', function () { self.skipWaiting(); });",
  "self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });",
  "",
  "self.addEventListener('push', function (event) {",
  "  var dados = {};",
  "  try { dados = event.data ? event.data.json() : {}; }",
  "  catch (e) { dados = { body: event.data ? event.data.text() : '' }; }",
  "  var titulo = dados.title || 'Entrada liberada';",
  "  event.waitUntil(self.registration.showNotification(titulo, {",
  "    body: dados.body || '',",
  "    icon: '/icon.png',",
  "    tag: dados.tag || undefined,",
  "    data: { url: '/' }",
  "  }));",
  "});",
  "",
  "self.addEventListener('notificationclick', function (event) {",
  "  event.notification.close();",
  "  event.waitUntil(",
  "    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (janelas) {",
  "      for (var i = 0; i < janelas.length; i++) {",
  "        if ('focus' in janelas[i]) return janelas[i].focus();",
  "      }",
  "      return self.clients.openWindow('/');",
  "    })",
  "  );",
  "});",
  "",
].join('\n');
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

// 4) Netlify: qualquer endereço abre o app
fs.writeFileSync(path.join(dist, '_redirects'), '/*    /index.html   200\n');

// 5) Meta tags no index.html (manifest + modo app no iPhone)
const tags = [
  '<link rel="manifest" href="/manifest.json">',
  '<meta name="theme-color" content="#1d4ed8">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Gestão">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
].join('\n');

let html = fs.readFileSync(indexPath, 'utf8');
if (html.includes('rel="manifest"')) {
  console.log('index.html já tem manifest; nada a alterar.');
} else if (!html.includes('</head>')) {
  console.error('Não achei </head> no index.html.');
  process.exit(1);
} else {
  html = html.replace('</head>', tags + '\n</head>');
  fs.writeFileSync(indexPath, html);
}

console.log('PWA pronto na pasta dist. Agora publique a pasta dist no Netlify.');
