'use strict';
/* ================= v2.1: perfil, foto y privacidad =================
   - Hoja de perfil (técnico y encargado): foto, teléfono y DNI/NIE/NIF opcionales, privacidad,
     datos de la empresa y cerrar sesión.
   - Pantalla de privacidad y condiciones: al crear la cuenta y cada vez que cambia la versión
     (CONFIG.versionTerminos). Se puede aceptar sin cobertura: se guarda en el móvil y se manda luego.
   - Ficha de un técnico para el encargado (solo lectura). */

/* ================= Avatares ================= */
const ICONO_PERSONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>';

function iniciales(u){
  const t = ((u?.nombre||'').trim()[0]||'') + ((u?.apellidos||'').trim()[0]||'');
  return t.toUpperCase();
}
/* Foto si hay enlace; si no, las iniciales; si tampoco, el icono de persona. */
function pintarAvatar(el, u, url){
  el.innerHTML = '';
  el.classList.toggle('con-foto', !!url);
  if(url){
    const img = document.createElement('img');
    img.src = url; img.alt = ''; img.decoding = 'async';
    img.onerror = () => { el.classList.remove('con-foto'); el.innerHTML = iniciales(u) ? escapar(iniciales(u)) : ICONO_PERSONA; };
    el.appendChild(img);
  } else if(iniciales(u)) el.textContent = iniciales(u);
  else el.innerHTML = ICONO_PERSONA;
}

/* Mi foto se guarda reducida en el móvil para verla sin cobertura. */
const fotoPropia = () => { const f = uid ? cargar(K.foto(uid), null) : null; return f && f.ruta === perfil?.avatar_path ? f.datos : null; };

function pintarCabeceraUsuario(){
  if(!perfil) return;
  $('cabOperario').textContent = perfil.nombre+' '+perfil.apellidos;
  document.querySelectorAll('[data-avatar-propio]').forEach(el => pintarAvatar(el, perfil, fotoPropia()));
}

/* Si mi perfil tiene foto y este móvil aún no la tiene (otro dispositivo, móvil nuevo), se descarga. */
async function sincronizarFotoPropia(){
  if(!uid || !perfil) return;
  if(!perfil.avatar_path){ localStorage.removeItem(K.foto(uid)); pintarCabeceraUsuario(); return; }
  if(fotoPropia()) return;
  try{
    const enlaces = await enlacesFotosApi([perfil.avatar_path]);
    const url = enlaces[perfil.avatar_path];
    if(!url) return;
    const datos = await blobADatos(await (await fetch(url)).blob());
    try{ localStorage.setItem(K.foto(uid), JSON.stringify({ ruta: perfil.avatar_path, datos })); }catch(e){}
    pintarCabeceraUsuario();
  }catch(e){ /* sin foto hasta la próxima vez */ }
}

const blobADatos = blob => new Promise((ok, mal) => {
  const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(r.error); r.readAsDataURL(blob);
});

/* Reduce la foto a 400 px como mucho (lado mayor) y la pasa a JPEG, en el propio móvil. */
async function reducirFoto(fichero){
  let fuente;
  try{ fuente = await createImageBitmap(fichero, { imageOrientation:'from-image' }); }
  catch(e){
    fuente = await new Promise((ok, mal) => {
      const img = new Image(); const u = URL.createObjectURL(fichero);
      img.onload = () => { URL.revokeObjectURL(u); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(u); mal(new Error('imagen')); };
      img.src = u;
    });
  }
  const ancho = fuente.width, alto = fuente.height;
  const escala = Math.min(1, 400 / Math.max(ancho, alto));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(ancho*escala); lienzo.height = Math.round(alto*escala);
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lienzo.width, lienzo.height);   // PNG transparente → fondo blanco
  ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  for(const calidad of [0.82, 0.7, 0.55]){
    const blob = await new Promise(ok => lienzo.toBlob(ok, 'image/jpeg', calidad));
    if(blob && blob.size <= 1024*1024) return blob;
  }
  throw new Error('grande');
}

/* ================= Validación de teléfono y DNI / NIE / NIF ================= */
/* Devuelve el teléfono como "+34 600 123 456", '' si está vacío o null si no es válido. */
function normalizarTelefono(valor){
  let t = String(valor||'').replace(/[\s().-]/g, '');
  if(!t) return '';
  if(t.startsWith('+34')) t = t.slice(3); else if(t.startsWith('0034')) t = t.slice(4);
  if(!/^[6789]\d{8}$/.test(t)) return null;
  return '+34 '+t.slice(0,3)+' '+t.slice(3,6)+' '+t.slice(6);
}
/* DNI (8 cifras + letra), NIE (X/Y/Z + 7 cifras + letra) o NIF K/L/M. Comprueba la letra de control.
   Devuelve el valor limpio, '' si está vacío o null si no es válido. Misma regla que dni_nif_valido(). */
function normalizarDni(valor){
  const d = String(valor||'').toUpperCase().replace(/[\s.-]/g, '');
  if(!d) return '';
  if(!/^(\d{8}|[XYZKLM]\d{7})[A-Z]$/.test(d)) return null;
  const num = Number(({X:'0',Y:'1',Z:'2',K:'0',L:'0',M:'0'}[d[0]] ?? d[0]) + d.slice(1,8));
  return 'TRWAGMYFPDXBNJZSQVHLCKE'[num % 23] === d[8] ? d : null;
}

/* ================= Hoja de perfil ================= */
const AYUDA = { tel:'Móvil o fijo de España, 9 cifras.', dni:'Con la letra final.' };
let edicionFoto = { blob:null, datos:null, quitar:false };

function abrirPerfil(){
  if(!perfil) return;
  $('perfilNombre').textContent = perfil.nombre+' '+perfil.apellidos;
  $('perfilEmail').textContent = perfil.email || '';
  $('perfilVersion').textContent = 'Partes de Trabajo v'+CONFIG.versionApp;
  $('inTelefono').value = perfil.telefono || '';
  $('inDni').value = perfil.dni_nif || '';
  edicionFoto = { blob:null, datos:null, quitar:false };
  marcarCampo('inTelefono', 'ayudaTelefono', AYUDA.tel, false);
  marcarCampo('inDni', 'ayudaDni', AYUDA.dni, false);
  mostrarErrorPerfil('');
  pintarFotoPerfil();
  $('dlgPerfil').showModal();
}
document.querySelectorAll('.btn-perfil').forEach(b => b.addEventListener('click', abrirPerfil));

function pintarFotoPerfil(){
  const url = edicionFoto.quitar ? null : (edicionFoto.datos || fotoPropia());
  const el = $('perfilAvatar');
  if(url) pintarAvatar(el, perfil, url);
  else { el.classList.remove('con-foto'); el.innerHTML = ICONO_PERSONA; }
  const hayFoto = !!url || (!edicionFoto.quitar && !!perfil.avatar_path);
  $('btnQuitarFoto').hidden = !hayFoto;
  document.querySelector('label[for="inFoto"]').textContent = hayFoto ? 'Cambiar foto' : 'Elegir foto';
}

function marcarCampo(idInput, idAyuda, texto, mal){
  $(idInput).classList.toggle('mal', mal);
  $(idInput).setAttribute('aria-invalid', mal);
  $(idAyuda).textContent = texto;
  $(idAyuda).classList.toggle('mal', mal);
}
function mostrarErrorPerfil(msg){ $('perfilError').textContent = msg; $('perfilError').hidden = !msg; }

function comprobarTelefono(){
  const ok = normalizarTelefono($('inTelefono').value) !== null;
  marcarCampo('inTelefono', 'ayudaTelefono', ok ? AYUDA.tel : 'Teléfono no válido: escribe 9 cifras, por ejemplo 600 123 456.', !ok);
  return ok;
}
function comprobarDni(){
  const ok = normalizarDni($('inDni').value) !== null;
  marcarCampo('inDni', 'ayudaDni', ok ? AYUDA.dni : 'No es válido: revisa los números y la letra.', !ok);
  return ok;
}
$('inTelefono').addEventListener('blur', comprobarTelefono);
$('inDni').addEventListener('blur', comprobarDni);

$('inFoto').addEventListener('change', async ev => {
  const fichero = ev.target.files?.[0];
  ev.target.value = '';
  if(!fichero) return;
  mostrarErrorPerfil('');
  try{
    const blob = await reducirFoto(fichero);
    edicionFoto = { blob, datos: await blobADatos(blob), quitar:false };
    pintarFotoPerfil();
  }catch(e){
    mostrarErrorPerfil('No se ha podido leer esa imagen. Prueba con otra foto (JPG o PNG).');
  }
});
$('btnQuitarFoto').addEventListener('click', () => { edicionFoto = { blob:null, datos:null, quitar:true }; pintarFotoPerfil(); });

$('btnGuardarPerfil').addEventListener('click', async () => {
  const okTel = comprobarTelefono(), okDni = comprobarDni();
  if(!okTel || !okDni){ mostrarErrorPerfil('Revisa los campos marcados en rojo.'); return; }
  if(!apiDisponible() || navigator.onLine === false){ mostrarErrorPerfil('Sin conexión. Para guardar el perfil hace falta cobertura.'); return; }
  const btn = $('btnGuardarPerfil'); btn.disabled = true; btn.textContent = 'Guardando…';
  mostrarErrorPerfil('');
  try{
    let ruta = perfil.avatar_path || null;
    if(edicionFoto.blob) ruta = await subirFotoApi(edicionFoto.blob);
    else if(edicionFoto.quitar && ruta){ await borrarFotoApi(); ruta = null; }
    guardarPerfil(await guardarMiPerfilApi(normalizarTelefono($('inTelefono').value), normalizarDni($('inDni').value), ruta));
    if(edicionFoto.blob){
      try{ localStorage.setItem(K.foto(uid), JSON.stringify({ ruta, datos: edicionFoto.datos })); }catch(e){}
    } else if(!ruta) localStorage.removeItem(K.foto(uid));
    pintarCabeceraUsuario();
    if(!$('vPanel').hidden && panel.semanaCargada) cargarSemanaPanel();
    $('dlgPerfil').close();
    avisar('Perfil guardado.');
  }catch(e){
    if(e.tipo === 'sesion'){ $('dlgPerfil').close(); marcarSesionCaducada(); return; }
    mostrarErrorPerfil(e.tipo === 'sin_conexion' ? 'Sin conexión. Para guardar el perfil hace falta cobertura.' : e.message);
  }finally{ btn.disabled = false; btn.textContent = 'Guardar'; }
});

$('btnCerrarSesion').addEventListener('click', () => {
  $('dlgPerfil').close();
  const sinEnviar = Object.keys(semanas).filter(k=>tieneCambiosSinEnviar(semanas[k])).length;
  const texto = perfil?.role === 'encargado' ? 'Se cerrará la sesión en este dispositivo.'
    : sinEnviar
    ? 'Tienes '+sinEnviar+' semana'+(sinEnviar>1?'s':'')+' con datos sin enviar. Se quedan guardadas en este móvil y podrás enviarlas cuando vuelvas a entrar con tu cuenta.'
    : 'Tus semanas enviadas están guardadas en el servidor.';
  confirmar('Cerrar sesión', texto, cerrarSesion, 'Cerrar sesión');
});

/* ================= Texto de privacidad (legal/privacy-terms.md) =================
   Es un BORRADOR pendiente de revisión legal. Se muestra tal cual con un conversor mínimo de
   Markdown: títulos, párrafos, listas, citas y negritas. */
let promesaTerminos = null;
function cargarTerminos(){
  if(!promesaTerminos){
    promesaTerminos = fetch('legal/privacy-terms.md', { cache:'no-cache' })
      .then(r => { if(!r.ok) throw new Error(r.status); return r.text(); })
      .then(leerTerminos)
      .catch(e => { promesaTerminos = null; throw e; });
  }
  return promesaTerminos;
}
function leerTerminos(texto){
  texto = texto.replace(/\r\n/g, '\n');
  const cab = /^---\n([\s\S]*?)\n---\n/.exec(texto);
  const version = cab ? (/^version:\s*(.+)$/m.exec(cab[1])?.[1] || '').trim() : '';
  const cuerpo = (cab ? texto.slice(cab[0].length) : texto).replace(/<!--[\s\S]*?-->/g, '');
  return { version, html: markdownAHtml(cuerpo) };
}
function markdownAHtml(md){
  const enLinea = s => escapar(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let html = '', parrafo = [], lista = null, cita = [];
  const cerrar = () => {
    if(parrafo.length){ html += '<p>'+enLinea(parrafo.join(' '))+'</p>'; parrafo = []; }
    if(lista){ html += '<ul>'+lista.map(li=>'<li>'+enLinea(li)+'</li>').join('')+'</ul>'; lista = null; }
    if(cita.length){ html += '<blockquote>'+enLinea(cita.join(' '))+'</blockquote>'; cita = []; }
  };
  for(const linea of md.split('\n')){
    let m;
    if(!linea.trim()){ cerrar(); continue; }
    if((m = /^(#{1,3})\s+(.*)$/.exec(linea))){ cerrar(); const n = m[1].length + 1; html += '<h'+n+'>'+enLinea(m[2])+'</h'+n+'>'; continue; }
    if((m = /^>\s?(.*)$/.exec(linea))){ if(parrafo.length || lista) cerrar(); cita.push(m[1]); continue; }
    if((m = /^[-*]\s+(.*)$/.exec(linea))){ if(parrafo.length || cita.length) cerrar(); (lista ||= []).push(m[1]); continue; }
    if(lista && /^\s+\S/.test(linea)){ lista[lista.length-1] += ' '+linea.trim(); continue; }
    if(lista || cita.length) cerrar();
    parrafo.push(linea.trim());
  }
  cerrar();
  return html;
}
async function pintarTerminos(el){
  el.innerHTML = '<p class="gris">Cargando…</p>';
  try{
    const t = await cargarTerminos();
    el.innerHTML = t.html + '<p class="version-terminos">Versión '+escapar(t.version || CONFIG.versionTerminos)+'</p>';
    return true;
  }catch(e){
    el.innerHTML = '<p class="error">No se ha podido cargar el texto. Comprueba la conexión y vuelve a intentarlo.</p>';
    return false;
  }
}

$('btnVerTerminos').addEventListener('click', () => {
  const pend = cargar(K.terminos(uid), null);
  $('terminosAceptados').textContent =
      perfil?.terms_version === CONFIG.versionTerminos && perfil.terms_accepted_at
        ? 'Aceptada el '+fmtFechaHora(perfil.terms_accepted_at)+' (versión '+perfil.terms_version+').'
    : pend ? 'Aceptada el '+fmtFechaHora(pend.aceptadoAt)+' en este móvil; se guardará en el servidor cuando haya cobertura.'
    : '';
  pintarTerminos($('terminosTexto'));
  $('dlgTerminos').showModal();
});
$('btnLeerTerminosReg').addEventListener('click', () => {
  $('terminosAceptados').textContent = '';
  pintarTerminos($('terminosTexto'));
  $('dlgTerminos').showModal();
});

/* ================= Aceptación ================= */
function necesitaConsentimiento(){
  if(!perfil || perfil.terms_version === CONFIG.versionTerminos) return false;
  return cargar(K.terminos(uid), null)?.version !== CONFIG.versionTerminos;
}

async function mostrarConsentimiento(){
  mostrarVista('vConsentimiento');
  $('consIntro').textContent = perfil?.terms_version
    ? 'La política de privacidad ha cambiado. Léela y acéptala para seguir usando la app.'
    : 'Antes de seguir, lee cómo se tratan tus datos.';
  $('consAcepto').checked = false;
  $('consAcepto').disabled = true;
  $('btnAceptarTerminos').disabled = true;
  $('consError').hidden = true;
  $('consAcepto').disabled = !(await pintarTerminos($('consTexto')));
}
$('consAcepto').addEventListener('change', e => { $('btnAceptarTerminos').disabled = !e.target.checked; });

/* Guarda la aceptación: en el servidor si hay cobertura; si no, en el móvil para mandarla después. */
async function registrarAceptacion(){
  const aceptadoAt = new Date().toISOString();
  try{
    guardarPerfil(await aceptarTerminosApi(CONFIG.versionTerminos, aceptadoAt));
    localStorage.removeItem(K.terminos(uid));
  }catch(e){
    if(e.tipo !== 'sin_conexion') throw e;
    guardar(K.terminos(uid), { version: CONFIG.versionTerminos, aceptadoAt });
  }
}
/* Con cobertura: manda la aceptación que se hizo sin conexión. */
async function enviarAceptacionPendiente(){
  const pend = uid ? cargar(K.terminos(uid), null) : null;
  if(!pend) return;
  if(pend.version !== CONFIG.versionTerminos){ localStorage.removeItem(K.terminos(uid)); return; }
  guardarPerfil(await aceptarTerminosApi(pend.version, pend.aceptadoAt));
  localStorage.removeItem(K.terminos(uid));
}

$('btnAceptarTerminos').addEventListener('click', async () => {
  if(!$('consAcepto').checked) return;
  const btn = $('btnAceptarTerminos'); btn.disabled = true;
  $('consError').hidden = true;
  try{
    await registrarAceptacion();
    enrutar();
  }catch(e){
    if(e.tipo === 'sesion'){ marcarSesionCaducada(); return; }
    $('consError').textContent = e.message || 'No se ha podido guardar. Inténtalo otra vez.';
    $('consError').hidden = false;
  }finally{ btn.disabled = !$('consAcepto').checked; }
});

/* ================= Ficha de un técnico (encargado, solo lectura) ================= */
function abrirFicha(u, urlFoto){
  const el = $('fichaAvatar');
  if(urlFoto) pintarAvatar(el, u, urlFoto); else { el.classList.remove('con-foto'); el.innerHTML = ICONO_PERSONA; }
  $('fichaNombre').textContent = u.nombre+' '+u.apellidos;
  $('fichaEstado').textContent = !u.active ? 'Cuenta desactivada' : !u.approved ? 'Pendiente de aprobación'
    : u.role === 'encargado' ? 'Encargado' : 'Técnico activo';
  const fila = (t, v) => '<dt>'+t+'</dt><dd>'+(v ? escapar(v) : '<span class="gris">No indicado</span>')+'</dd>';
  $('fichaDatos').innerHTML =
      fila('Email', u.email)
    + fila('Teléfono', u.telefono)
    + fila('DNI / NIE / NIF', u.dni_nif)
    + fila('Alta', u.created_at ? fmtCorta(new Date(u.created_at)) : '')
    + fila('Privacidad', u.terms_version ? 'Aceptada el '+fmtFechaHora(u.terms_accepted_at)+' (versión '+u.terms_version+')'
                                         : 'Todavía no la ha aceptado');
  $('dlgFicha').showModal();
}
