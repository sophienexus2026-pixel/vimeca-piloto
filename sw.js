/* Service worker: la app funciona sin cobertura (network-first con copia en caché).
   Las peticiones a Supabase (datos, sesión, tokens) y todo lo que no sea GET NO pasan por
   la caché: nunca se guardan respuestas de la API ni tokens.

   La caché lleva el ámbito (scope) de la app en el nombre, y este service worker solo borra y
   lee SUS cachés. En GitHub Pages la v1 (/partesvimeca-/) y el piloto (/vimeca-piloto/) comparten
   dominio y, por tanto, Cache Storage: así ninguno borra ni sirve los ficheros del otro. */
importScripts('./config.js');

const VERSION_CACHE='pv2-app-5';   // v2.2.0: subir este número en cada versión para que los móviles se actualicen
const AMBITO=self.registration.scope;
const CACHE=VERSION_CACHE+'@'+AMBITO;
const SUPABASE_JS='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js';
const FICHEROS=[
  './','./index.html','./config.js','./css/app.css',
  './js/fechas.js','./js/almacen.js','./js/api.js','./js/sincronizacion.js','./js/fichaje.js',
  './js/informe.js','./js/tecnico.js','./js/fichar.js','./js/terminos.js','./js/perfil.js','./js/libro-excel.js','./js/exportar-excel.js','./js/panel.js','./js/cuadro.js','./js/app.js',
  './manifest.webmanifest','./icon-192.png','./icon-512.png','./assets/logo.jpg',
  './assets/fuentes/barlow-400.woff2','./assets/fuentes/barlow-500.woff2','./assets/fuentes/barlow-600.woff2','./assets/fuentes/barlow-700.woff2',
  './assets/fuentes/barlow-condensed-500.woff2','./assets/fuentes/barlow-condensed-600.woff2','./assets/fuentes/barlow-condensed-700.woff2',
  './assets/fuentes/share-tech-mono-400.woff2'
];
const ORIGEN_SUPABASE=(()=>{ try{ return new URL(CONFIG.supabaseUrl).origin; }catch(e){ return null; } })();

/* Cada fichero se guarda por separado: con addAll, UN solo fichero que falte (404) hacía fallar la
   instalación entera y la app se quedaba sin modo sin cobertura (pasó en el piloto: faltaba
   legal/privacy-terms.md). Los que falten se avisan en la consola. */
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE)
    .then(c=>Promise.all([...FICHEROS, SUPABASE_JS].map(f=>c.add(f).catch(err=>console.warn('SW: no se pudo guardar',f,err)))))
    .then(()=>self.skipWaiting()));
});
/* Solo se borran versiones anteriores de ESTA app en ESTE ámbito. */
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k.startsWith('pv2-app-') && k.endsWith('@'+AMBITO) && k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

function esSupabase(url){
  return url.origin===ORIGEN_SUPABASE || url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in');
}

self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET' || esSupabase(url)) return;          // directo a la red
  if(url.origin!==self.location.origin && url.href!==SUPABASE_JS) return;
  e.respondWith(
    fetch(e.request).then(r=>{
      if(r.ok){
        const copia=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copia)).catch(()=>{});
      }
      return r;
    }).catch(()=>caches.open(CACHE).then(c=>c.match(e.request,{ignoreSearch:true})))
  );
});
