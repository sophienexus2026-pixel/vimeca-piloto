'use strict';
/* ================= v2.2: pestañas del encargado, Cuadro general y Ajustes =================
   Barra inferior: Cuadro · Semana · Equipo · Ajustes. El perfil del encargado sigue en su avatar
   de la cabecera.
   - Cuadro (docs/disenos/fichaje/Cuadro.dc.html): un «interruptor» por técnico activo con su estado
     de hoy. Se actualiza con «Actualizar» y solo cada 60 s mientras está a la vista.
   - Semana: el panel de v2 (panel.js). Equipo: las cuentas (panel.js).
   - Ajustes › Pausas (Ajustes.dc.html): solo las dos duraciones. La regla «el descanso cuenta, la
     comida no» no se puede cambiar. Los límites se comprueban aquí y otra vez en la base de datos. */

let pestanaPanel = 'cuadro';
let temporizadorCuadro = null;

function mostrarPestanaPanel(p){
  pestanaPanel = p;
  for(const [id, nombre] of [['pCuadro','cuadro'], ['pSemana','semana'], ['pEquipo','equipo'], ['pAjustes','ajustes']]) $(id).hidden = nombre !== p;
  marcarBarra($('barraEncargado'), p);
  clearInterval(temporizadorCuadro); temporizadorCuadro = null;
  if(p === 'cuadro'){ cargarCuadro(); temporizadorCuadro = setInterval(() => { if(!document.hidden && !$('vPanel').hidden) cargarCuadro(); }, 60000); }
  if(p === 'semana') cargarSemanaPanel();
  if(p === 'equipo') cargarEquipo();
  if(p === 'ajustes') cargarAjustes();
  window.scrollTo(0, 0);
}
$('barraEncargado').querySelectorAll('[data-pestana]').forEach(b => b.addEventListener('click', () => mostrarPestanaPanel(b.dataset.pestana)));
document.addEventListener('visibilitychange', () => { if(!document.hidden && !$('vPanel').hidden && pestanaPanel === 'cuadro') cargarCuadro(); });

const nombreCorto = u => (u.nombre || '').trim()+((u.apellidos || '').trim() ? ' '+u.apellidos.trim()[0]+'.' : '');
const tecnicosActivos = perfiles => perfiles.filter(u => u.role === 'tecnico' && u.approved && u.active)
  .sort((a,b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es'));

/* Avisa de un error de carga y deja a la vista los últimos datos. */
function errorCarga(idCaja, idTexto, e, hayDatos){
  if(e.tipo === 'sesion'){ marcarSesionCaducada(); return; }
  $(idCaja).hidden = false;
  $(idTexto).textContent = (e.tipo === 'sin_conexion' ? 'Sin conexión.' : e.message) + (hayDatos ? ' Se muestran los últimos datos cargados.' : '');
}

/* ================= Cuadro general ================= */
let cuadro = { cargado:false, perfiles:[], fichajes:[], partes:[], hora:null };
let cargandoCuadro = false;

async function cargarCuadro(){
  if(cargandoCuadro) return;
  cargandoCuadro = true;
  const ayer = new Date(HOY()); ayer.setDate(ayer.getDate()-1);
  try{
    const [perfiles, fich, partes] = await Promise.all([leerPerfiles(), fichajesOVacio(leerFichajesApi({ desde:iso(ayer) })), leerPartesSemana(claveActual())]);
    cuadro = { cargado:true, perfiles, fichajes:fich, partes, hora:new Date() };
    panel.perfiles = perfiles;
    $('cuadroSinConexion').hidden = true;
  }catch(e){
    errorCarga('cuadroSinConexion', 'cuadroSinConexionTexto', e, cuadro.cargado);
  }finally{ cargandoCuadro = false; }
  pintarCuadro();
}
$('btnActualizarCuadro').addEventListener('click', () => cargarCuadro());
$('btnReintentarCuadro').addEventListener('click', () => cargarCuadro());

/* Estado de hoy de cada técnico: el mismo cálculo que en su móvil (fichaje.js). */
function estadoTecnicoHoy(u, ahora, hoyIso){
  const lista = cuadro.fichajes.filter(x => x.user_id === u.id).map(fichajeDeServidor);
  const sit = situacionFichaje(lista, ahora, hoyIso);
  const parte = cuadro.partes.find(p => p.user_id === u.id);
  const tipoDia = diasDeParte(parte)[hoyIso]?.tipo || null;
  return { u, ...sit, tipoDia };
}

function pintarCuadro(){
  const ahora = Date.now(), hoyIso = iso(HOY()), hoy = HOY();
  $('cuadroFecha').textContent = fechaMayus(hoyIso)+' · '+hhmm(hoy);
  if(!cuadro.cargado){ $('cuadroTecnicos').innerHTML = '<p class="fx-vacio">Cargando…</p>'; return; }
  const estados = tecnicosActivos(cuadro.perfiles).map(u => estadoTecnicoHoy(u, ahora, hoyIso));
  const cuenta = c => estados.filter(s => c.includes(s.j.estado)).length;
  $('cntServicio').textContent = cuenta(['servicio']);
  $('cntPausa').textContent = cuenta(['descanso','comida']);
  $('cntFuera').textContent = cuenta(['fuera']);

  $('cuadroTecnicos').innerHTML = estados.length ? estados.map(s => {
    const j = s.j;
    let clase, linea, detalle;
    if(j.estado === 'servicio'){ clase = 'on'; linea = 'ON · '+hhmm(j.entrada.hora); detalle = escapar(j.obraActual || ''); }
    else if(j.estado === 'descanso' || j.estado === 'comida'){
      const p = j.pausaAbierta, vuelta = p.desde + (p.prevista || 0)*60000;
      clase = 'pausa';
      linea = PAUSAS[p.clase].nombre.toUpperCase()+' · '+(ahora <= vuelta ? 'vuelve '+hhmm(vuelta) : '+'+Math.max(1, Math.floor((ahora - vuelta)/60000))+' min');
      detalle = escapar(j.obraActual || '');
    }
    else if(j.estado === 'terminada'){ clase = 'off'; linea = 'OFF · salida '+hhmm(j.salida.hora); detalle = 'Jornada terminada'; }
    else { clase = 'off'; linea = 'OFF · sin fichar'; detalle = s.tipoDia && s.tipoDia !== 'trabajado' ? TIPOS[s.tipoDia] : 'Sin aviso'; }
    return `<div class="fx-tec ${clase}">
        <div class="fx-tec-caja" aria-hidden="true"><div class="fx-tec-palanca"></div></div>
        <div class="fx-tec-datos"><b>${escapar(nombreCorto(s.u))}</b><span class="fx-tec-estado">${linea}</span><span class="fx-tec-detalle">${detalle}</span></div>
      </div>`;
  }).join('') : '<p class="fx-vacio">Todavía no hay técnicos aprobados.</p>';

  // Aviso: sin fichar después de las 09:00 y sin tipo de día en su semana enviada.
  const sinAviso = hoy.getHours() >= 9 ? estados.filter(s => s.j.estado === 'fuera' && !s.tipoDia) : [];
  const nombres = sinAviso.map(s => '<strong>'+escapar(nombreCorto(s.u))+'</strong>');
  const lista = nombres.length > 1 ? nombres.slice(0,-1).join(', ')+' y '+nombres[nombres.length-1] : nombres[0];
  $('cuadroAvisos').innerHTML = sinAviso.length ? `<div class="fx-banda">${ICONO_AVISO_FX}<div>${lista} ${sinAviso.length === 1
    ? 'no ha fichado y no tiene día marcado. ¿Le escribes?' : 'no han fichado y no tienen día marcado. ¿Les escribes?'}</div></div>` : '';
  $('cuadroActualizado').textContent = cuadro.hora ? 'Actualizado a las '+hhmm(cuadro.hora)+'. Se actualiza solo cada minuto.' : '';
}

/* ================= Equipo: cuentas ================= */
async function cargarEquipo(){
  pintarCuentas();
  try{ panel.perfiles = await leerPerfiles(); pintarCuentas(); }
  catch(e){ if(e.tipo === 'sesion') marcarSesionCaducada(); else avisar(e.tipo === 'sin_conexion' ? 'Sin conexión. Se muestran los últimos datos cargados.' : e.message); }
}

/* ================= Ajustes › Pausas ================= */
let ajustesEdicion = null, ajustesGuardados = null;

async function cargarAjustes(){
  ajustesGuardados = ajustesPausas();
  ajustesEdicion = { descanso:ajustesGuardados.descanso_min, comida:ajustesGuardados.comida_min };
  pintarAjustes();
  try{
    const [a, perfiles] = await Promise.all([leerAjustesPausasApi(), leerPerfiles()]);
    guardarAjustesPausas(a); panel.perfiles = perfiles;
    ajustesGuardados = ajustesPausas();
    ajustesEdicion = { descanso:a.descanso_min, comida:a.comida_min };
    $('ajustesSinConexion').hidden = true;
  }catch(e){ errorCarga('ajustesSinConexion', 'ajustesSinConexionTexto', e, true); }
  pintarAjustes();
}
$('btnReintentarAjustes').addEventListener('click', () => cargarAjustes());

function pintarAjustes(){
  $('valDescanso').textContent = ajustesEdicion.descanso;
  $('valComida').textContent = ajustesEdicion.comida;
  document.querySelectorAll('#pAjustes .fx-ajuste').forEach(sec => {
    const clase = sec.dataset.pausa, v = ajustesEdicion[clase];
    sec.querySelector('[data-paso="-1"]').disabled = v <= PAUSAS[clase].min;
    sec.querySelector('[data-paso="1"]').disabled = v >= PAUSAS[clase].max;
  });
  const cambiado = ajustesEdicion.descanso !== ajustesGuardados.descanso_min || ajustesEdicion.comida !== ajustesGuardados.comida_min;
  $('btnGuardarAjustes').disabled = !cambiado;
  const quien = panel.perfiles.find(u => u.id === ajustesGuardados.modificado_por);
  $('ajustesUltimo').textContent = ajustesGuardados.modificado_at
    ? 'Último cambio: '+fmtCorta(new Date(ajustesGuardados.modificado_at))+(quien ? ' · '+nombreCorto(quien) : '')
    : 'Último cambio: ninguno (valores iniciales).';
}
document.querySelectorAll('#pAjustes .fx-ajuste').forEach(sec => sec.querySelectorAll('[data-paso]').forEach(b => b.addEventListener('click', () => {
  const clase = sec.dataset.pausa, lim = PAUSAS[clase];
  ajustesEdicion[clase] = Math.min(lim.max, Math.max(lim.min, ajustesEdicion[clase] + Number(b.dataset.paso) * PASO_PAUSAS));
  pintarAjustes();
})));

$('btnGuardarAjustes').addEventListener('click', async () => {
  const b = $('btnGuardarAjustes');
  b.disabled = true;
  try{
    guardarAjustesPausas(await cambiarAjustesPausasApi(ajustesEdicion.descanso, ajustesEdicion.comida));
    ajustesGuardados = ajustesPausas();
    avisar('Duraciones guardadas: descanso '+ajustesGuardados.descanso_min+' min y comida '+ajustesGuardados.comida_min+' min, desde ahora.');
  }catch(e){
    if(e.tipo === 'sesion'){ marcarSesionCaducada(); return; }
    informar('No se han podido guardar', e.tipo === 'sin_conexion' ? 'Sin conexión. Para cambiar las duraciones hace falta cobertura.' : e.message);
  }
  pintarAjustes();
});
