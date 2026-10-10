'use strict';
/* ================= Panel del encargado =================
   Sustituye a panel.html (v1). Lee directamente de la base de datos: ya no hay que importar ficheros.
   Cada celda de día se pinta igual en pantalla y en el PDF (celdaDia):
     trabajado     → horas normales y, en magenta, las extra: "8 +2"
     otro tipo     → abreviatura (VAC, BAJA, FEST, S/T) sobre fondo gris
     sin rellenar  → "—" sobre fondo rayado
   Los tres casos se distinguen por el texto, no solo por el color. */

const ETIQUETA_CORTA = { vacaciones:'VAC', baja:'BAJA', festivo:'FEST', sin_trabajo:'S/T' };
const LEYENDA_CELDAS = '8 +2 = 8 h normales y 2 h extra · VAC Vacaciones · BAJA Baja · FEST Festivo · S/T Sin trabajo · — Sin rellenar';
const fH = n => (Math.round(n*100)/100).toString().replace('.',',');
/* nombreCompleto() y diasDeParte() están en exportar-excel.js (se cargan antes que este fichero). */

let panel = { semana:null, semanaCargada:null, perfiles:[], partes:[], fichajes:[], jornadas:{}, verDesactivados:false, fotos:{} };

/* v2.2: los fichajes son un añadido. Si la base de datos aún no tiene la migración v2.2 (la tabla no
   existe), el panel sigue funcionando sin ellos. Sin conexión o con la sesión caducada, sí falla. */
const fichajesOVacio = promesa => promesa.catch(e => { if(e.tipo === 'sin_conexion' || e.tipo === 'sesion') throw e; return []; });

/* Una fila por técnico aprobado. Los desactivados solo salen en las semanas en que enviaron algo.
   En pantalla, además, solo si está marcado «Mostrar desactivados». El PDF los incluye siempre:
   es el registro de jornada de la semana. */
function filasSemana(conDesactivados = true){
  const porUsuario = new Map(panel.partes.map(p=>[p.user_id, p]));
  return panel.perfiles
    .filter(u => u.role==='tecnico' && u.approved && (u.active || (conDesactivados && porUsuario.has(u.id))))
    .sort((a,b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es'))
    .map(u => {
      const parte = porUsuario.get(u.id) || null;
      const dias = diasDeParte(parte);
      let normales = 0, extras = 0;
      for(const d of Object.values(dias)){ normales += horasDia(d); extras += extrasDia(d); }
      return { usuario:u, parte, dias, normales, extras, jornadas: panel.jornadas[u.id] || {} };
    });
}

function celdaDia(dd){
  if(!dd) return { clase:'c-vacia', titulo:'Sin rellenar', html:'—' };
  if(dd.tipo !== 'trabajado') return { clase:'c-tipo', titulo:TIPOS[dd.tipo], html:ETIQUETA_CORTA[dd.tipo] };
  const x = extrasDia(dd);
  return { clase:'c-trab', titulo:'Trabajado', html:'<b>'+fH(horasDia(dd))+'</b>'+(x>0 ? ' <span class="x">+'+fH(x)+'</span>' : '') };
}
const tdDia = dd => { const c = celdaDia(dd); return `<td class="${c.clase}" title="${c.titulo}">${c.html}</td>`; };

/* Suma del equipo para un día, en el mismo formato "46 +4". */
function celdaTotalDia(filas, fIso){
  let n = 0, x = 0, hay = false;
  for(const f of filas){ const dd = f.dias[fIso]; if(dd?.tipo==='trabajado'){ hay = true; n += horasDia(dd); x += extrasDia(dd); } }
  return hay ? '<b>'+fH(n)+'</b>'+(x>0 ? ' <span class="x">+'+fH(x)+'</span>' : '') : '—';
}

function estadoParte(p){
  if(!p) return { clase:'pendiente', texto:'Pendiente' };
  if(p.version > 1) return { clase:'modificado', texto:'Modificado ('+fmtFechaHora(p.modificado_at)+')' };
  return { clase:'enviado', texto:'Enviado', detalle: fmtFechaHora(p.enviado_at) };
}

/* "Lunes 28-09: Moral 8 h · Cadlán 2 h · +2 h extra" — los trabajos realizados de un técnico.
   v2.2: con fichaje, delante la entrada y la salida y detrás las pausas; si se corrigió algún
   fichaje, la marca «Corregido» con el motivo. jornadas = { fecha: calcularJornada() }. */
function lineasDetalle(dias, semana, jornadas = {}){
  return diasSemana(deIso(semana)).map((d,i)=>{
    const dd = dias[iso(d)], j = jornadas[iso(d)];
    let texto;
    if(!dd) texto = '<span class="gris">Sin rellenar</span>';
    else if(dd.tipo !== 'trabajado') texto = TIPOS[dd.tipo];
    else {
      const partes = dd.entradas.map(e=>escapar(e.obra)+' '+fmtHoras(e.horas));
      if(extrasDia(dd) > 0) partes.push('<span class="x">+'+fmtHoras(extrasDia(dd))+' extra</span>');
      texto = partes.join(' · ');
    }
    const horario = dd?.horaInicio ? dd.horaInicio+' a '+dd.horaFin
      : j?.entrada ? hhmm(j.entrada.hora)+' a '+(j.salida ? hhmm(j.salida.hora) : '…') : '';
    const pausas = [j?.descansoMin ? 'descanso '+fmtMinutos(j.descansoMin) : '', j?.comidaMin ? 'comida '+fmtMinutos(j.comidaMin) : ''].filter(Boolean);
    const corregido = j?.corregida ? ' <span class="marca-corregido">Corregido</span> <span class="gris">('+escapar(j.motivos.join(' · '))+')</span>' : '';
    return '<div><b>'+DIAS[i]+' '+fmtDM(d)+':</b> '+(horario ? '<span class="horario">'+horario+'</span> · ' : '')+texto
      +(pausas.length ? ' <span class="gris">· '+pausas.join(' · ')+'</span>' : '')+corregido+'</div>';
  }).join('');
}
const detalleTecnico = (f, semana) => f.parte ? lineasDetalle(f.dias, semana, f.jornadas)
  : '<span class="gris">No ha enviado esta semana.</span>'+(Object.keys(f.jornadas).length ? lineasDetalle({}, semana, f.jornadas) : '');

/* ================= Carga y pintado ================= */
/* v2.2: el panel tiene pestañas (Cuadro · Semana · Equipo · Ajustes, en cuadro.js). Este fichero
   es la pestaña Semana (el panel de v2) y la lista de cuentas de Equipo. */
function mostrarPanel(){
  mostrarVista('vPanel');
  if(!panel.semana) panel.semana = claveActual();
  pintarSelectorSemanas();
  mostrarPestanaPanel(pestanaPanel);
}

function pintarSelectorSemanas(){
  const sel = $('selSemana');
  sel.innerHTML = clavesEditables().map(k =>
    `<option value="${k}">Semana ${rangoSemana(k)}${k===claveActual()?' (actual)':''}</option>`).join('');
  sel.value = panel.semana;
}
$('selSemana').addEventListener('change', e => { panel.semana = e.target.value; cargarSemanaPanel(); });
$('btnActualizar').addEventListener('click', () => { cerrarMenuMas(); cargarSemanaPanel(); });
function verDesactivados(si){
  panel.verDesactivados = si;
  $('chkDesactivados').checked = si; $('chkDesactivadosEquipo').checked = si;
  if(panel.semanaCargada) pintarPanel(); else pintarCuentas();
}
$('chkDesactivados').addEventListener('change', e => verDesactivados(e.target.checked));
$('chkDesactivadosEquipo').addEventListener('change', e => verDesactivados(e.target.checked));

/* «⋯ Más acciones»: se cierra al elegir, al pulsar fuera o con Escape. */
function cerrarMenuMas(){ $('menuMas').hidden = true; $('btnMas').setAttribute('aria-expanded', 'false'); }
$('btnMas').addEventListener('click', e => {
  e.stopPropagation();
  const abrir = $('menuMas').hidden;
  $('menuMas').hidden = !abrir; $('btnMas').setAttribute('aria-expanded', String(abrir));
});
document.addEventListener('click', e => { if(!e.target.closest('.menu-mas')) cerrarMenuMas(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') cerrarMenuMas(); });
$('btnReintentarPanel').addEventListener('click', () => cargarSemanaPanel());

async function cargarSemanaPanel(){
  const semana = panel.semana;
  $('panelCargando').hidden = false;
  try{
    const domingo = iso(diasSemana(deIso(semana))[6]);
    const [perfiles, partes, fich] = await Promise.all([leerPerfiles(), leerPartesSemana(semana),
      fichajesOVacio(leerFichajesApi({ desde:semana, hasta:domingo }))]);
    if(semana !== panel.semana) return;            // el encargado ya ha cambiado de semana
    panel.perfiles = perfiles; panel.partes = partes; panel.semanaCargada = semana;
    panel.fichajes = fich; panel.jornadas = jornadasPorUsuario(fich);
    $('panelSinConexion').hidden = true;
    cargarFotosPanel();
  }catch(e){
    if(e.tipo === 'sesion'){ marcarSesionCaducada(); return; }
    $('panelSinConexion').hidden = false;
    $('panelSinConexionTexto').textContent = (e.tipo==='sin_conexion' ? 'Sin conexión.' : e.message)
      + (panel.semanaCargada ? ' Se muestran los últimos datos cargados (semana '+rangoSemana(panel.semanaCargada)+').' : '');
    panel.semana = panel.semanaCargada || panel.semana;
    $('selSemana').value = panel.semana;
    if(!panel.semanaCargada) return;
  }finally{ $('panelCargando').hidden = true; }
  pintarPanel();
}

/* Fotos de los técnicos: enlaces firmados (1 hora) pedidos de una vez. Sin foto o sin conexión
   se ven las iniciales. */
async function cargarFotosPanel(){
  const ahora = Date.now();
  const rutas = panel.perfiles.map(u=>u.avatar_path).filter(r => r && !(panel.fotos[r]?.hasta > ahora));
  if(!rutas.length) return;
  try{
    const enlaces = await enlacesFotosApi(rutas);
    for(const [r, url] of Object.entries(enlaces)) panel.fotos[r] = { url, hasta: ahora + 50*60*1000 };
    document.querySelectorAll('#vPanel [data-foto-de]').forEach(el => {
      const u = panel.perfiles.find(p=>p.id===el.dataset.fotoDe);
      if(u) pintarAvatar(el, u, urlFoto(u));
    });
  }catch(e){ /* se quedan las iniciales */ }
}
const urlFoto = u => (u.avatar_path && u.id === uid && fotoPropia()) || panel.fotos[u.avatar_path]?.url || null;
function avatarDe(u){
  const el = document.createElement('span');
  el.className = 'avatar'; el.dataset.fotoDe = u.id;
  pintarAvatar(el, u, urlFoto(u));
  return el.outerHTML;
}
const verFicha = id => { const u = panel.perfiles.find(p=>p.id===id); if(u) abrirFicha(u, urlFoto(u)); };
const DIAS_CORTOS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

function pintarPanel(){
  const semana = panel.semanaCargada;
  const dias = diasSemana(deIso(semana));
  const filas = filasSemana(panel.verDesactivados);
  const ocultos = filasSemana(true).length - filas.length;
  $('tituloSemana').textContent = fmtCorta(dias[0])+' al '+fmtCorta(dias[6]);
  const tN = filas.reduce((a,f)=>a+f.normales,0), tX = filas.reduce((a,f)=>a+f.extras,0);

  /* ---- Tabla (pantallas de 768 px o más) ---- */
  let html = '<thead><tr><th class="op">OPERARIO</th>'
    + dias.map((d,i)=>'<th>'+DIAS[i].toUpperCase().slice(0,3)+'<small>'+fmtDM(d)+'</small></th>').join('')
    + '<th>HORAS<br>NORMALES</th><th>HORAS<br>EXTRA</th><th>TOTAL</th><th>ESTADO</th></tr></thead><tbody>';
  filas.forEach((f,idx)=>{
    const est = estadoParte(f.parte);
    html += `<tr class="fila-op">
      <td class="op"><button type="button" class="desplegar" data-i="${idx}" aria-expanded="false" aria-controls="detalle-${idx}"><span class="flecha">▸</span> ${escapar(nombreCompleto(f.usuario))}</button>${f.usuario.active ? '' : '<small class="inactivo">Desactivado</small>'}</td>
      ${dias.map(d=>tdDia(f.dias[iso(d)])).join('')}
      <td class="tcol">${fH(f.normales)}</td>
      <td class="tcol xcol">${fH(f.extras)}</td>
      <td class="tcol">${fH(f.normales+f.extras)}</td>
      <td class="estado"><span class="est ${est.clase}">${est.texto}</span>${est.detalle ? '<small>'+est.detalle+'</small>' : ''}</td>
    </tr>
    <tr class="detalle" id="detalle-${idx}" hidden><td class="op-detalle" colspan="12">${detalleTecnico(f, semana)}
      <button type="button" class="b-ficha" data-ficha="${f.usuario.id}">Ver ficha</button></td></tr>`;
  });
  if(!filas.length) html += '<tr><td colspan="12" class="vacio">Todavía no hay técnicos aprobados.</td></tr>';
  html += '<tr class="tot"><td class="op">TOTAL</td>'+dias.map(d=>'<td>'+celdaTotalDia(filas, iso(d))+'</td>').join('')
    + `<td>${fH(tN)}</td><td class="xcol">${fH(tX)}</td><td>${fH(tN+tX)}</td><td></td></tr></tbody>`;
  $('tablaResumen').innerHTML = html;
  $('tablaResumen').querySelectorAll('.desplegar').forEach(b => b.addEventListener('click', () => {
    const abierto = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', !abierto);
    b.querySelector('.flecha').textContent = abierto ? '▸' : '▾';
    $('detalle-'+b.dataset.i).hidden = abierto;
  }));

  /* ---- Tarjetas (móvil, menos de 768 px): una por técnico y una con el total del equipo ---- */
  const tira = celdas => '<div class="tec-dias">'+celdas.map((c,i)=>
    `<div class="tec-dia ${c.clase}" title="${DIAS[i]}: ${c.titulo}"><small>${DIAS_CORTOS[i]} ${dias[i].getDate()}</small><span>${c.html}</span></div>`).join('')+'</div>';
  const totales = (n, x) => `<div class="tec-totales"><span>Normales <b>${fH(n)}</b></span><span>Extra <b class="x">${fH(x)}</b></span><span>Total <b>${fH(n+x)}</b></span></div>`;
  let tarjetas = '';
  filas.forEach((f,idx)=>{
    const est = estadoParte(f.parte);
    tarjetas += `<article class="tec-tarjeta${f.usuario.active ? '' : ' inactivo'}">
      <button type="button" class="tec-cab" aria-expanded="false" aria-controls="tdet-${idx}">
        ${avatarDe(f.usuario)}
        <span class="tec-nombre"><b>${escapar(nombreCompleto(f.usuario))}</b>${f.usuario.active ? '' : '<small class="inactivo">Desactivado</small>'}
          <span class="est ${est.clase}">${est.texto}</span>${est.detalle ? '<small>'+est.detalle+'</small>' : ''}</span>
        <svg class="tec-flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      ${totales(f.normales, f.extras)}
      ${tira(dias.map(d=>celdaDia(f.dias[iso(d)])))}
      <div class="tec-detalle" id="tdet-${idx}" hidden>
        ${detalleTecnico(f, semana)}
        <button type="button" class="b-ficha" data-ficha="${f.usuario.id}">Ver ficha</button>
      </div>
    </article>`;
  });
  if(!filas.length) tarjetas += '<p class="vacio">Todavía no hay técnicos aprobados.</p>';
  else tarjetas += `<article class="tec-tarjeta total">
      <div class="tec-cab"><span class="tec-nombre"><b>Total equipo</b><small>${filas.length} técnico${filas.length!==1?'s':''}</small></span></div>
      ${totales(tN, tX)}
      ${tira(dias.map(d=>{ const h = celdaTotalDia(filas, iso(d)); return { clase: h==='—' ? 'c-vacia' : 'c-trab', titulo:'Total', html:h }; }))}
    </article>`;
  $('tarjetasTecnicos').innerHTML = tarjetas;
  $('tarjetasTecnicos').querySelectorAll('.tec-tarjeta:not(.total)').forEach(card => {
    const cab = card.querySelector('.tec-cab'), det = card.querySelector('.tec-detalle');
    const alternar = () => {
      const abrir = det.hidden;
      det.hidden = !abrir; cab.setAttribute('aria-expanded', String(abrir)); card.classList.toggle('abierta', abrir);
    };
    cab.addEventListener('click', alternar);
    card.querySelector('.tec-dias').addEventListener('click', alternar);
  });
  document.querySelectorAll('#vPanel .b-ficha').forEach(b => b.addEventListener('click', () => verFicha(b.dataset.ficha)));

  const enviados = filas.filter(f=>f.parte).length;
  $('resumenEnvios').textContent = enviados+' de '+filas.length+' técnico'+(filas.length!==1?'s':'')+' han enviado esta semana.'
    + (ocultos ? ' ('+ocultos+' desactivado'+(ocultos>1?'s':'')+' con horas esta semana, oculto'+(ocultos>1?'s':'')+'.)' : '');
  pintarCuentas();
}

/* ================= Cuentas ================= */
function pintarCuentas(){
  const tecnicos = panel.perfiles.filter(u => u.role==='tecnico').sort((a,b)=>nombreCompleto(a).localeCompare(nombreCompleto(b),'es'));
  const grupos = [
    { titulo:'Pendientes de aprobación', lista: tecnicos.filter(u=>!u.approved && u.active), boton:'Aprobar', clase:'b-verde',
      accion: u => cambiarYRecargar(u, {approved:true}, nombreCompleto(u)+' ya puede enviar partes.') },
    { titulo:'Técnicos activos', lista: tecnicos.filter(u=>u.approved && u.active), boton:'Desactivar', clase:'b-quitar',
      accion: u => confirmar('Desactivar cuenta', 'Se desactivará la cuenta de '+nombreCompleto(u)+'. No podrá enviar partes, pero sus semanas enviadas se conservan.',
        () => cambiarYRecargar(u, {active:false}, 'Cuenta de '+nombreCompleto(u)+' desactivada.'), 'Sí, desactivar') },
    { titulo:'Desactivados', lista: tecnicos.filter(u=>!u.active), boton:'Reactivar', clase:'b-gris',
      accion: u => cambiarYRecargar(u, {active:true}, 'Cuenta de '+nombreCompleto(u)+' reactivada.') }
  ];
  const nDesactivados = grupos[2].lista.length;
  if(!panel.verDesactivados) grupos.pop();
  const zona = $('zonaCuentas'); zona.innerHTML = '';
  for(const g of grupos){
    const h = document.createElement('h3'); h.textContent = g.titulo+' ('+g.lista.length+')'; zona.appendChild(h);
    if(!g.lista.length){ zona.insertAdjacentHTML('beforeend','<p class="gris ninguno">Ninguno.</p>'); continue; }
    for(const u of g.lista){
      const fila = document.createElement('div');
      fila.className = 'parte-item';
      fila.innerHTML = avatarDe(u)+'<button type="button" class="cuenta-datos" title="Ver ficha"><span class="n">'+escapar(nombreCompleto(u))+'</span><small>'+escapar(u.email)+' · alta el '+fmtCorta(new Date(u.created_at))+'</small></button>';
      fila.querySelector('.cuenta-datos').addEventListener('click', () => verFicha(u.id));
      const b = document.createElement('button');
      b.type = 'button'; b.className = g.clase; b.textContent = g.boton;
      b.addEventListener('click', () => g.accion(u));
      fila.appendChild(b);
      zona.appendChild(fila);
    }
  }
  if(!panel.verDesactivados && nDesactivados)
    zona.insertAdjacentHTML('beforeend', '<p class="gris ninguno">'+(nDesactivados===1 ? '1 cuenta desactivada oculta' : nDesactivados+' cuentas desactivadas ocultas')+'. Marca «Mostrar desactivados» para verlas.</p>');
}

async function cambiarYRecargar(u, cambios, mensaje){
  try{
    await cambiarCuenta(u.id, cambios);
    avisar(mensaje);
  }catch(e){
    if(e.tipo === 'sesion'){ marcarSesionCaducada(); return; }
    informar('No se ha podido cambiar la cuenta', e.tipo==='sin_conexion' ? 'Sin conexión. Inténtalo cuando tengas cobertura.' : e.message);
  }
  await cargarSemanaPanel();
}

/* ================= PDF de la semana ================= */
$('btnPDFSemana').addEventListener('click', () => {
  if(!panel.semanaCargada){ avisar('Todavía no hay datos cargados.'); return; }
  imprimirInforme(() => construirInformeGlobal(panel.semanaCargada, filasSemana(true)));
});

/* ================= Exportar a Excel (.xlsx) =================
   La hoja de cálculo se genera en el móvil con js/libro-excel.js (sin CDN) y las hojas con
   js/exportar-excel.js. La de la semana funciona sin cobertura con los datos ya cargados.
   «Todos los datos» descarga del servidor todo lo enviado: es la copia de seguridad del
   registro de jornada (el plan gratuito de Supabase no guarda copias descargables). */
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function descargarFichero(bytes, nombre, tipo){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type:tipo }));
  a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function exportarExcel(boton, generar){
  cerrarMenuMas();
  const texto = boton.textContent; boton.disabled = true; boton.textContent = 'Preparando…';
  try{
    const { hojas, nombre, resumen } = await generar();
    descargarFichero(await crearLibroExcel(hojas), nombre, TIPO_XLSX);
    avisar('Descargado '+nombre+(resumen ? ': '+resumen : '')+'.');
  }catch(e){
    if(e.tipo === 'sesion'){ marcarSesionCaducada(); return; }
    informar('No se ha podido exportar', e.tipo==='sin_conexion' ? 'Sin conexión. Para exportar todos los datos hace falta cobertura.' : (e.message || String(e)));
  }finally{ boton.disabled = false; boton.textContent = texto; }
}

$('btnExcelSemana').addEventListener('click', () => {
  if(!panel.semanaCargada){ cerrarMenuMas(); avisar('Todavía no hay datos cargados.'); return; }
  exportarExcel($('btnExcelSemana'), async () => ({
    hojas: hojasExcelSemana(panel.perfiles, panel.partes, panel.semanaCargada, panel.fichajes),
    nombre: 'vimeca_partes_semana_'+panel.semanaCargada+'.xlsx',
    resumen: panel.partes.length+' parte'+(panel.partes.length!==1?'s':'')+' enviado'+(panel.partes.length!==1?'s':'')
  }));
});

$('btnExportarTodo').addEventListener('click', () => exportarExcel($('btnExportarTodo'), async () => {
  const [perfiles, partes, fich] = await Promise.all([leerPerfiles(), leerTodosLosPartes(), fichajesOVacio(leerFichajesApi())]);
  return { hojas: hojasExcelCompleto(perfiles, partes, new Date(), fich), nombre: 'vimeca_partes_completo_'+iso(HOY())+'.xlsx',
           resumen: partes.length+' semana'+(partes.length!==1?'s':'')+' de partes y '+fich.length+' fichaje'+(fich.length!==1?'s':'') };
}));
