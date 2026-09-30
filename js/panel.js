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
const nombreCompleto = u => u.nombre+' '+u.apellidos;

let panel = { semana:null, semanaCargada:null, perfiles:[], partes:[] };

/* Días de un parte del servidor con la misma forma que usa el técnico en el móvil. */
function diasDeParte(p){
  const dias = {};
  for(const d of p?.dias || []){
    dias[d.fecha] = {
      tipo: d.tipo,
      entradas: [...d.entradas].sort((a,b)=>a.orden-b.orden).map(e=>({obra:e.obra, horas:Number(e.horas)})),
      horasExtra: Number(d.horas_extra) || 0
    };
  }
  return dias;
}

/* Una fila por técnico aprobado. Los desactivados solo salen en las semanas en que enviaron algo. */
function filasSemana(){
  const porUsuario = new Map(panel.partes.map(p=>[p.user_id, p]));
  return panel.perfiles
    .filter(u => u.role==='tecnico' && u.approved && (u.active || porUsuario.has(u.id)))
    .sort((a,b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es'))
    .map(u => {
      const parte = porUsuario.get(u.id) || null;
      const dias = diasDeParte(parte);
      let normales = 0, extras = 0;
      for(const d of Object.values(dias)){ normales += horasDia(d); extras += extrasDia(d); }
      return { usuario:u, parte, dias, normales, extras };
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

/* "Lunes 28-09: Moral 8 h · Cadlán 2 h · +2 h extra" — los trabajos realizados de un técnico. */
function lineasDetalle(dias, semana){
  return diasSemana(deIso(semana)).map((d,i)=>{
    const dd = dias[iso(d)];
    let texto;
    if(!dd) texto = '<span class="gris">Sin rellenar</span>';
    else if(dd.tipo !== 'trabajado') texto = TIPOS[dd.tipo];
    else {
      const partes = dd.entradas.map(e=>escapar(e.obra)+' '+fmtHoras(e.horas));
      if(extrasDia(dd) > 0) partes.push('<span class="x">+'+fmtHoras(extrasDia(dd))+' extra</span>');
      texto = partes.join(' · ');
    }
    return '<div><b>'+DIAS[i]+' '+fmtDM(d)+':</b> '+texto+'</div>';
  }).join('');
}

/* ================= Carga y pintado ================= */
async function mostrarPanel(){
  mostrarVista('vPanel');
  if(!panel.semana) panel.semana = claveActual();
  pintarSelectorSemanas();
  await cargarSemanaPanel();
}

function pintarSelectorSemanas(){
  const sel = $('selSemana');
  sel.innerHTML = clavesEditables().map(k =>
    `<option value="${k}">Semana ${rangoSemana(k)}${k===claveActual()?' (actual)':''}</option>`).join('');
  sel.value = panel.semana;
}
$('selSemana').addEventListener('change', e => { panel.semana = e.target.value; cargarSemanaPanel(); });
$('btnActualizar').addEventListener('click', () => cargarSemanaPanel());
$('btnReintentarPanel').addEventListener('click', () => cargarSemanaPanel());

async function cargarSemanaPanel(){
  const semana = panel.semana;
  $('panelCargando').hidden = false;
  try{
    const [perfiles, partes] = await Promise.all([leerPerfiles(), leerPartesSemana(semana)]);
    if(semana !== panel.semana) return;            // el encargado ya ha cambiado de semana
    panel.perfiles = perfiles; panel.partes = partes; panel.semanaCargada = semana;
    $('panelSinConexion').hidden = true;
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

function pintarPanel(){
  const semana = panel.semanaCargada;
  const dias = diasSemana(deIso(semana));
  const filas = filasSemana();
  $('tituloSemana').textContent = fmtCorta(dias[0])+' al '+fmtCorta(dias[6]);

  let html = '<thead><tr><th style="text-align:left">OPERARIO</th>'
    + dias.map((d,i)=>'<th>'+DIAS[i].toUpperCase().slice(0,3)+'<small>'+fmtDM(d)+'</small></th>').join('')
    + '<th>HORAS<br>NORMALES</th><th>HORAS<br>EXTRA</th><th>TOTAL</th><th>ESTADO</th></tr></thead><tbody>';
  filas.forEach((f,idx)=>{
    const est = estadoParte(f.parte);
    html += `<tr class="fila-op">
      <td class="op"><button type="button" class="desplegar" data-i="${idx}" aria-expanded="false"><span class="flecha">▸</span> ${escapar(nombreCompleto(f.usuario))}</button>${f.usuario.active ? '' : '<small class="inactivo">Desactivado</small>'}</td>
      ${dias.map(d=>tdDia(f.dias[iso(d)])).join('')}
      <td class="tcol">${fH(f.normales)}</td>
      <td class="tcol xcol">${fH(f.extras)}</td>
      <td class="tcol">${fH(f.normales+f.extras)}</td>
      <td class="estado"><span class="est ${est.clase}">${est.texto}</span>${est.detalle ? '<small>'+est.detalle+'</small>' : ''}</td>
    </tr>
    <tr class="detalle" id="detalle-${idx}" hidden><td colspan="12">${f.parte ? lineasDetalle(f.dias, semana) : '<span class="gris">No ha enviado esta semana.</span>'}</td></tr>`;
  });
  if(!filas.length) html += '<tr><td colspan="12" class="vacio">Todavía no hay técnicos aprobados.</td></tr>';
  const tN = filas.reduce((a,f)=>a+f.normales,0), tX = filas.reduce((a,f)=>a+f.extras,0);
  html += '<tr class="tot"><td class="op">TOTAL</td>'+dias.map(d=>'<td>'+celdaTotalDia(filas, iso(d))+'</td>').join('')
    + `<td>${fH(tN)}</td><td class="xcol">${fH(tX)}</td><td>${fH(tN+tX)}</td><td></td></tr></tbody>`;
  $('tablaResumen').innerHTML = html;
  $('tablaResumen').querySelectorAll('.desplegar').forEach(b => b.addEventListener('click', () => {
    const abierto = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', !abierto);
    b.querySelector('.flecha').textContent = abierto ? '▸' : '▾';
    $('detalle-'+b.dataset.i).hidden = abierto;
  }));
  const enviados = filas.filter(f=>f.parte).length;
  $('resumenEnvios').textContent = enviados+' de '+filas.length+' técnico'+(filas.length!==1?'s':'')+' han enviado esta semana.';
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
  const zona = $('zonaCuentas'); zona.innerHTML = '';
  for(const g of grupos){
    const h = document.createElement('h3'); h.textContent = g.titulo+' ('+g.lista.length+')'; zona.appendChild(h);
    if(!g.lista.length){ zona.insertAdjacentHTML('beforeend','<p class="gris ninguno">Ninguno.</p>'); continue; }
    for(const u of g.lista){
      const fila = document.createElement('div');
      fila.className = 'parte-item';
      fila.innerHTML = '<span class="n">'+escapar(nombreCompleto(u))+'</span><small>'+escapar(u.email)+' · alta el '+fmtCorta(new Date(u.created_at))+'</small>';
      const b = document.createElement('button');
      b.type = 'button'; b.className = g.clase; b.textContent = g.boton;
      b.addEventListener('click', () => g.accion(u));
      fila.appendChild(b);
      zona.appendChild(fila);
    }
  }
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
  imprimirInforme(() => construirInformeGlobal(panel.semanaCargada, filasSemana()));
});

/* ================= Exportar todos los datos (CSV) =================
   Copia de seguridad del registro de jornada: el plan gratuito de Supabase no guarda copias
   descargables. Una fila por obra y una por cada día no trabajado; cada fila se entiende sola.
   Las horas extra de un día van en la primera fila de obra de ese día (0 en las demás), para que
   al sumar la columna en Excel no se cuenten dos veces. */
const COLUMNAS_CSV = ['técnico','semana','fecha','día de la semana','tipo de día','obra','horas','horas extra','estado','fecha de envío','fecha de modificación','versión'];
const celdaCsv = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
const fechaCsv = fIso => fmtCorta(deIso(fIso)).replace(/-/g,'/');
const numCsv = n => String(Math.round(n*100)/100).replace('.',',');
const fechaHoraCsv = ts => ts ? fmtFechaHora(ts).replace(/-/g,'/') : '';

function filasCsv(perfiles, partes){
  const porId = new Map(perfiles.map(u=>[u.id, u]));
  const filas = [];
  const ordenados = [...partes].sort((a,b)=> a.semana<b.semana ? -1 : a.semana>b.semana ? 1
    : nombreCompleto(porId.get(a.user_id)||{nombre:'',apellidos:''}).localeCompare(nombreCompleto(porId.get(b.user_id)||{nombre:'',apellidos:''}),'es'));
  for(const p of ordenados){
    const u = porId.get(p.user_id);
    const comun = {
      tecnico: u ? nombreCompleto(u) : p.user_id, semana: fechaCsv(p.semana),
      estado: p.version>1 ? 'Modificado' : 'Enviado', envio: fechaHoraCsv(p.enviado_at),
      modif: fechaHoraCsv(p.modificado_at), version: p.version
    };
    for(const [fIso, dd] of Object.entries(diasDeParte(p)).sort(([a],[b])=>a<b?-1:1)){
      const dia = DIAS[(deIso(fIso).getDay()+6)%7];
      const base = [comun.tecnico, comun.semana, fechaCsv(fIso), dia, TIPOS[dd.tipo]];
      const cola = [comun.estado, comun.envio, comun.modif, comun.version];
      if(dd.tipo !== 'trabajado') filas.push([...base, '', '0', '0', ...cola]);
      else dd.entradas.forEach((e,i) => filas.push([...base, e.obra, numCsv(e.horas), i===0 ? numCsv(dd.horasExtra) : '0', ...cola]));
    }
  }
  return filas;
}

$('btnExportarTodo').addEventListener('click', async () => {
  const b = $('btnExportarTodo'); b.disabled = true; const texto = b.textContent; b.textContent = 'Preparando…';
  try{
    const [perfiles, partes] = await Promise.all([leerPerfiles(), leerTodosLosPartes()]);
    const filas = filasCsv(perfiles, partes);
    const csv = '﻿' + [COLUMNAS_CSV, ...filas].map(f=>f.map(celdaCsv).join(';')).join('\r\n') + '\r\n';
    const nombre = 'vimeca_partes_'+iso(HOY())+'.csv';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    avisar('Descargado '+nombre+': '+partes.length+' semanas, '+filas.length+' filas.');
  }catch(e){
    if(e.tipo === 'sesion'){ marcarSesionCaducada(); return; }
    informar('No se ha podido exportar', e.tipo==='sin_conexion' ? 'Sin conexión. Para exportar hace falta cobertura.' : e.message);
  }finally{ b.disabled = false; b.textContent = texto; }
});
