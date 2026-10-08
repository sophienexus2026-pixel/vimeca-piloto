'use strict';
/* ================= Arranque, sesión y vistas =================
   La app arranca sin conexión: la sesión y el perfil se guardan en el móvil al entrar y
   se usan para decidir qué pantalla mostrar. Con conexión se refrescan en segundo plano. */

const VISTAS = ['vAcceso','vConsentimiento','vPendiente','vDesactivada','vPanel','vApp','vHistorico'];
function mostrarVista(id){ for(const v of VISTAS) $(v).hidden = v!==id; }

/* Datos de empresa de config.js en la cabecera. */
function pintarEmpresa(){
  if(CONFIG.entorno==='piloto' && !document.querySelector('.banda-piloto')){
    document.body.insertAdjacentHTML('afterbegin','<div class="banda-piloto">VERSIÓN PILOTO · solo para pruebas</div>');
    document.title='PILOTO · '+document.title;
    document.body.classList.add('con-banda');
  }
  const e=CONFIG.empresa;
  document.querySelectorAll('.emp-nombre').forEach(n=>n.textContent=e.nombre);
  document.querySelectorAll('.emp-datos').forEach(n=>n.textContent='NIF: '+e.nif+' · '+e.direccion);
  document.querySelectorAll('.emp-contacto').forEach(n=>n.textContent=e.contacto+' · Tel.: '+e.telefono);
}

/* Decide la pantalla según el perfil guardado. La privacidad se acepta antes que nada más
   (también con la cuenta pendiente de aprobación). */
function enrutar(){
  if(!perfil){ mostrarAcceso(); return; }
  pintarCabeceraUsuario();
  if(!perfil.active) mostrarVista('vDesactivada');
  else if(necesitaConsentimiento()) mostrarConsentimiento();
  else if(!perfil.approved) mostrarVista('vPendiente');
  else if(perfil.role==='encargado') mostrarPanel();
  else mostrarApp();
}

/* ================= Acceso: entrar / crear cuenta ================= */
function mostrarAcceso(motivo){
  mostrarVista('vAcceso');
  ponerPestana('entrar');
  const ses=cargar(K.sesion,null);
  if(ses?.email) $('accEmail').value=ses.email;
  mostrarErrorAcceso(motivo==='caducada' ? 'Tu sesión ha caducado. Vuelve a entrar: tus semanas siguen guardadas en este móvil.' : '');
  if(!apiConfigurada()) mostrarErrorAcceso('La app todavía no está conectada a la base de datos (falta configurar config.js).');
}
function mostrarErrorAcceso(msg){ $('accError').textContent=msg; $('accError').hidden=!msg; }

let pestana='entrar';
function ponerPestana(p){
  pestana=p;
  $('pestEntrar').classList.toggle('activa', p==='entrar');
  $('pestCrear').classList.toggle('activa', p==='crear');
  $('pestEntrar').setAttribute('aria-selected', String(p==='entrar'));
  $('pestCrear').setAttribute('aria-selected', String(p==='crear'));
  $('camposNombre').hidden = p!=='crear';
  $('camposConsentimiento').hidden = p!=='crear';
  $('regAcepto').checked = false;
  $('btnAcceso').textContent = p==='crear' ? 'Crear mi cuenta' : 'Entrar';
  $('accClave').autocomplete = p==='crear' ? 'new-password' : 'current-password';
  $('accNota').textContent = p==='crear'
    ? 'Cuando crees tu cuenta, el encargado tendrá que aprobarla antes de que puedas enviar partes.'
    : '';
  mostrarErrorAcceso('');
}
$('pestEntrar').addEventListener('click',()=>ponerPestana('entrar'));
$('pestCrear').addEventListener('click',()=>ponerPestana('crear'));

$('formAcceso').addEventListener('submit', async ev=>{
  ev.preventDefault();
  const email=$('accEmail').value.trim(), clave=$('accClave').value;
  const nombre=$('regNombre').value.trim(), apellidos=$('regApellidos').value.trim();
  if(pestana==='crear' && (!nombre || !apellidos)){ mostrarErrorAcceso('Escribe tu nombre y tus apellidos.'); return; }
  if(!email || !clave){ mostrarErrorAcceso('Escribe tu email y tu contraseña.'); return; }
  if(pestana==='crear' && !$('regAcepto').checked){ mostrarErrorAcceso('Para crear la cuenta tienes que aceptar la política de privacidad.'); return; }
  if(!apiDisponible()){ mostrarErrorAcceso(apiConfigurada() ? 'Sin conexión. Para entrar o crear la cuenta hace falta cobertura.' : 'La app todavía no está conectada a la base de datos.'); return; }
  const btn=$('btnAcceso'); btn.disabled=true; mostrarErrorAcceso('');
  try{
    const ses = pestana==='crear' ? await registrar(nombre, apellidos, email, clave) : await entrar(email, clave);
    abrirAlmacen(ses.uid);
    if(pestana==='crear'){ try{ await registrarAceptacion(); }catch(e){ /* se volverá a pedir */ } }
    try{ guardarPerfil(await leerPerfil()); }
    catch(e){ if(!perfil) throw e; }        // sin perfil guardado no se puede seguir
    guardar(K.sesion, ses);
    $('accClave').value='';
    semanaVista=claveActual();
    enrutar();
    refrescarDesdeServidor();
  }catch(e){
    const previa=cargar(K.sesion,null);      // volver al usuario que ya estaba, si lo había
    if(previa) abrirAlmacen(previa.uid); else cerrarAlmacen();
    mostrarErrorAcceso(e.message || 'No se ha podido entrar.');
  }finally{ btn.disabled=false; }
});

/* ================= Pendiente de aprobación / desactivada ================= */
$('btnComprobar').addEventListener('click', async ()=>{
  try{
    guardarPerfil(await leerPerfil());
    if(!perfil.approved) avisar('Tu cuenta sigue pendiente de aprobación.');
    enrutar();
    if(perfil.approved) refrescarDesdeServidor();
  }catch(e){
    if(e.tipo==='sesion') marcarSesionCaducada();
    else avisar(e.tipo==='sin_conexion' ? 'Sin conexión. Inténtalo cuando tengas cobertura.' : e.message);
  }
});
document.querySelectorAll('.btn-salir').forEach(b=>b.addEventListener('click', cerrarSesion));

/* ================= Sesión ================= */
async function cerrarSesion(){
  await salirApi();
  localStorage.removeItem(K.sesion);
  cerrarAlmacen();
  semanaVista=null;
  programarReintento();
  mostrarAcceso();
}
/* El servidor ya no acepta la sesión: hay que volver a entrar. Los datos del usuario se quedan. */
function marcarSesionCaducada(){
  if(!$('vAcceso').hidden) return;
  mostrarAcceso('caducada');
}

/* Con conexión: perfil al día, semanas enviadas desde otro móvil y envíos pendientes. */
let refrescando=false;
async function refrescarDesdeServidor(){
  if(!uid || !apiDisponible() || navigator.onLine===false || refrescando) return;
  refrescando=true;
  try{
    const antes=JSON.stringify(perfil);
    await enviarAceptacionPendiente();
    guardarPerfil(await leerPerfil());
    if(JSON.stringify(perfil)!==antes) enrutar();
    sincronizarFotoPropia();
    if(perfil.role==='tecnico' && perfil.approved && perfil.active){
      if(fusionarServidor(await leerMisPartes(claveMasAntigua())) && !$('vApp').hidden) pintarSemana();
      await procesarCola();
    }
  }catch(e){
    if(e.tipo==='sesion') marcarSesionCaducada();
  }finally{ refrescando=false; }
}

/* ================= Arranque ================= */
function arrancar(){
  pintarEmpresa();
  const ses=cargar(K.sesion,null);
  if(!ses){ mostrarAcceso(); return; }
  abrirAlmacen(ses.uid);
  semanaVista=claveActual();
  enrutar();
  programarReintento();
  refrescarDesdeServidor();
}

/* Refrescar al volver a la app (cambio de día/semana, reintentar envíos) */
document.addEventListener('visibilitychange',()=>{
  if(document.hidden || !uid) return;
  if(!$('vApp').hidden) pintarSemana();
  refrescarDesdeServidor();
});

arrancar();
