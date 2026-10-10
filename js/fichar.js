'use strict';
/* ================= v2.2: pestañas del técnico y pantalla «Fichar» =================
   Barra inferior: Fichar · Semana · Histórico · Perfil. Fichar es la pestaña por defecto; la semana
   (con «Horas extras» y «Enviar») está en Semana, igual que antes.
   Diseños: docs/disenos/fichaje/Main.dc.html (en servicio), Pausa.dc.html (en una pausa) y la
   tarjeta «Consumo de la semana» de Contador.dc.html, debajo del fichaje.
   Fichar funciona sin cobertura: cada evento se guarda en el móvil y se manda en cuanto se puede.
   No hay avisos al acabar una pausa: la cuenta atrás es solo visual y la vuelta se ficha a mano. */

let pestanaTecnico = 'fichar';

function marcarBarra(nav, p){
  nav.querySelectorAll('[data-pestana]').forEach(b => {
    if(b.dataset.pestana === p) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}
function mostrarPestanaTecnico(p){
  pestanaTecnico = p;
  if(p === 'historico'){ mostrarVista('vHistorico'); pintarHistorico(); }
  else {
    mostrarVista('vApp');
    $('tabFichar').hidden = p !== 'fichar';
    $('tabSemana').hidden = p !== 'semana';
    if(p === 'fichar') pintarFichar(); else pintarSemana();
  }
  marcarBarra($('barraTecnico'), p);
  window.scrollTo(0, 0);
}
$('barraTecnico').querySelectorAll('[data-pestana]').forEach(b => b.addEventListener('click', () => {
  if(b.dataset.pestana === 'semana' && pestanaTecnico !== 'semana') semanaVista = claveActual();
  mostrarPestanaTecnico(b.dataset.pestana);
}));

/* ================= Iconos de los diseños ================= */
const ICONO_RAYO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>';
const ICONO_APAGAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v9"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/></svg>';
const ICONO_RELOJ_FX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICONO_AVISO_FX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>';

const ESTADOS_FICHAR = {
  fuera:     { pildora:'SIN FICHAR',        clase:'gris',  caja:'off',   led:'OFF' },
  servicio:  { pildora:'EN SERVICIO',       clase:'verde', caja:'on',    led:'ON' },
  descanso:  { pildora:'EN EL DESCANSO',    clase:'ambar', caja:'pausa', led:'PAUSA' },
  comida:    { pildora:'EN LA COMIDA',      clase:'ambar', caja:'pausa', led:'PAUSA' },
  terminada: { pildora:'JORNADA TERMINADA', clase:'gris',  caja:'off',   led:'OFF' }
};
const fechaMayus = fIso => { const d = deIso(fIso); return DIAS[(d.getDay()+6)%7].toUpperCase()+' '+fmtCorta(d); };
const reloj = min => { const s = Math.max(0, Math.floor(min*60)); return { hm:p2(Math.floor(s/3600))+':'+p2(Math.floor(s/60)%60), ss:':'+p2(s%60) }; };
const textoDuracion = min => min % 60 === 0 ? (min/60)+' h' : fmtMinutos(min);

/* ================= Pintar ================= */
let pintadoFichar = null;          // estado y fecha pintados, para saber si basta con mover los relojes

function pintarFichar(){
  if(!perfil) return;
  const sit = situacionActual(), j = sit.j, e = ESTADOS_FICHAR[j.estado];
  pintadoFichar = { estado:j.estado, fecha:sit.fecha, n:fichajes.length };
  $('fxFecha').textContent = fechaMayus(sit.fecha);
  $('fxPildora').className = 'fx-pildora '+e.clase;
  $('fxPildoraTexto').textContent = e.pildora;
  $('fxCaja').className = 'fx-caja '+e.caja;
  $('fxLed').textContent = e.led;
  document.querySelector('#vApp .cab').classList.toggle('en-pausa', e.caja === 'pausa');
  $('fxDatos').innerHTML = htmlDatos(sit);
  $('fxAcciones').innerHTML = htmlAcciones(sit);
  pintarPausasHoy(j);
  $('fxNota').textContent = {
    fuera:'Al fichar la salida, las horas pasan solas al parte de la semana. Puedes revisarlas antes de enviar.',
    servicio:'Al fichar la salida, las horas pasan solas al parte de la semana. Puedes revisarlas antes de enviar.',
    descanso:'Ficha tú la vuelta cuando termines. Si te pasas del tiempo, se guarda la hora real.',
    comida:'Ficha tú la vuelta cuando termines. Si te pasas del tiempo, se guarda la hora real.',
    terminada:'Las horas de hoy ya están en el parte de la semana. Revísalas y envíala desde Semana.'
  }[j.estado];
  pintarSinCerrar(sit);
  pintarSincFichajes();
  pintarConsumo();
  enlazarAcciones(sit);
}

function htmlDatos(sit){
  const j = sit.j;
  if(j.estado === 'servicio'){
    const r = reloj(j.trabajadoMin);
    return `<div class="fx-etq">Tiempo en servicio</div>
      <div class="fx-grande" id="fxReloj">${r.hm}<span class="fx-seg">${r.ss}</span></div>
      <div class="fx-etq fx-sep">Entrada</div><div class="fx-valor">${hhmm(j.entrada.hora)} h</div>
      <div class="fx-etq fx-sep2">Obra actual</div><div class="fx-obra">${escapar(j.obraActual || '—')}</div>`;
  }
  if(j.estado === 'descanso' || j.estado === 'comida'){
    const p = j.pausaAbierta;
    return `<div class="fx-etq" id="fxCuentaEtq"></div>
      <div class="fx-grande ambar" id="fxCuenta"></div>
      <div class="fx-etq">de ${textoDuracion(p.prevista || 0)} · desde las ${hhmm(p.inicio.hora)}</div>
      <div class="fx-barra"><div id="fxBarra"></div></div>
      <div class="fx-etq fx-sep">Trabajado hoy</div><div class="fx-valor" id="fxTrabajado"></div>`;
  }
  if(j.estado === 'terminada'){
    const r = reloj(j.trabajadoMin);
    return `<div class="fx-etq">Trabajado hoy</div>
      <div class="fx-grande">${r.hm}<span class="fx-seg"> h</span></div>
      <div class="fx-etq fx-sep">Entrada</div><div class="fx-valor">${hhmm(j.entrada.hora)} h</div>
      <div class="fx-etq fx-sep2">Salida</div><div class="fx-valor">${hhmm(j.salida.hora)} h</div>`;
  }
  return `<div class="fx-etq">Sin fichar</div>
    <div class="fx-grande gris">--:--</div>
    <div class="fx-etq fx-sep">Sube el interruptor para empezar la jornada.</div>`;
}

function htmlAcciones(sit){
  const j = sit.j, aj = ajustesPausas();
  if(j.estado === 'fuera'){
    const obras = obrasRecientes();
    return `<div class="campo fx-campo">
        <label for="inObraEntrada">OBRA / LUGAR</label>
        <input id="inObraEntrada" type="text" list="obrasRecientesLista" placeholder="Ej.: Moral, Cadlán…" autocomplete="off" value="${escapar(obras[0] || '')}">
      </div>
      ${htmlChips(obras, obras[0])}
      <span class="error" id="entradaError" role="alert" hidden></span>
      <button type="button" class="fx-boton verde" id="btnFicharEntrada">${ICONO_RAYO}Subir el interruptor · Fichar entrada</button>`;
  }
  if(j.estado === 'servicio'){
    const tomada = clase => j.pausas.some(p => p.clase === clase);
    const boton = (clase, texto) => `<button type="button" class="fx-pausa-b" data-pausa="${clase}"${tomada(clase) ? ' disabled' : ''}>
        <b>${PAUSAS[clase].nombre}</b><span>${tomada(clase) ? 'Ya tomado hoy' : texto}</span></button>`;
    return `<button type="button" class="fx-boton oscuro" id="btnFicharSalida">${ICONO_APAGAR}Bajar el interruptor · Fichar salida</button>
      <div class="fx-pausas-botones">
        ${boton('descanso', textoDuracion(aj.descanso_min)+' · cuenta')}
        ${boton('comida', textoDuracion(aj.comida_min)+' · no cuenta')}
      </div>
      <button type="button" class="fx-boton contorno" id="btnCambiarObra">Cambiar de obra</button>
      <button type="button" class="fx-enlace" data-corregir="${sit.fecha}">Corregir un fichaje</button>`;
  }
  if(j.estado === 'descanso' || j.estado === 'comida')
    return `<button type="button" class="fx-boton verde" id="btnVolverTrabajo">${ICONO_RAYO}Subir el interruptor · Volver al trabajo</button>`;
  // Jornada terminada: lo que ha pasado al parte y el enlace a la semana.
  const clave = iso(lunesDe(deIso(sit.fecha)));
  const dd = diaDe(clave, sit.fecha);
  const filas = dd?.tipo === 'trabajado'
    ? dd.entradas.map(e => `<div class="fx-fila"><span>${escapar(e.obra)}</span><b>${fmtHoras(e.horas)}</b></div>`).join('')
      + (extrasDia(dd) > 0 ? `<div class="fx-fila extra"><span>Horas extra</span><b>+${fmtHoras(extrasDia(dd))}</b></div>` : '')
    : `<div class="fx-fila"><span>${dd ? 'Día marcado como '+TIPOS[dd.tipo] : 'Sin pasar al parte'}</span></div>`;
  return `<section class="fx-tarjeta fx-resumen">
      <h2>En el parte de la semana</h2>${filas}
    </section>
    <button type="button" class="fx-boton contorno" id="btnVerSemana">Revisar en Semana</button>
    <button type="button" class="fx-enlace" data-corregir="${sit.fecha}">Corregir un fichaje</button>`;
}

function htmlChips(obras, elegida){
  if(!obras.length) return '';
  return '<div class="fx-chips">'+obras.slice(0,4).map(o =>
    `<button type="button" class="fx-chip" data-obra="${escapar(o)}" aria-pressed="${o===elegida}">${escapar(o)}</button>`).join('')+'</div>';
}
function enlazarChips(caja, input){
  caja.querySelectorAll('.fx-chip').forEach(c => c.addEventListener('click', () => {
    input.value = c.dataset.obra;
    caja.querySelectorAll('.fx-chip').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
  }));
  input.addEventListener('input', () => caja.querySelectorAll('.fx-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.obra === input.value.trim()))));
}

function pintarPausasHoy(j){
  const caja = $('fxPausasHoy');
  const ver = j.pausas.length && j.estado !== 'servicio';
  caja.hidden = !ver;
  if(!ver) return;
  caja.innerHTML = '<h2>Pausas de hoy</h2>' + j.pausas.map(p => {
    const fin = p.fin ? hhmm(p.fin.hora) : p.abierta ? '…' : hhmm(j.salida.hora);
    return `<div class="fx-pausa-fila ${p.clase}">
      <span class="fx-pausa-nombre"><span class="fx-punto"></span>${PAUSAS[p.clase].nombre} <span class="fx-mono">${hhmm(p.inicio.hora)} – ${fin}</span></span>
      <span class="fx-cuenta">${PAUSAS[p.clase].cuenta ? 'Cuenta' : 'No cuenta'}</span></div>`;
  }).join('');
}

/* Jornadas de días anteriores con entrada y sin salida: hay que corregirlas para que pasen al parte. */
function pintarSinCerrar(sit){
  const lista = sit.sinCerrar.filter(s => s.fecha >= claveMasAntigua()).slice(0, 3);
  $('fxSinCerrar').innerHTML = lista.map(s => `<div class="aviso-hist fx-aviso">
      <span>${diaLargo(s.fecha)}: fichaste la entrada a las ${hhmm(s.j.entrada.hora)} pero no la salida. Corrígelo para que ese día pase al parte.</span>
      <button type="button" data-corregir="${s.fecha}">Corregir</button></div>`).join('');
}

/* Fichajes guardados en el móvil que aún no han llegado al servidor, y los rechazados. */
function pintarSincFichajes(){
  const n = fichajesPendientes().length;
  const rech = fichajesRechazados().filter(e => e.fecha >= claveActual());
  const caja = $('fxSinc');
  caja.hidden = !n && !rech.length;
  let html = '';
  if(n) html += `<div class="fx-sinc-fila">${ICONO_RELOJ_FX}<span>${n === 1 ? '1 fichaje guardado en el móvil, pendiente de enviar.' : n+' fichajes guardados en el móvil, pendientes de enviar.'} Se ${n === 1 ? 'enviará solo' : 'enviarán solos'} en cuanto haya cobertura.</span><button type="button" id="btnReintentarFichajes">Reintentar</button></div>`;
  if(rech.length) html += `<div class="fx-sinc-fila error">${ICONO_AVISO_FX}<span>No se ${rech.length === 1 ? 'ha' : 'han'} podido guardar: ${rech.map(e => escapar(TIPOS_FICHAJE[e.tipo]+' '+hhmm(e.hora)+' ('+e.error+')')).join('; ')}. Avisa al encargado.</span></div>`;
  caja.innerHTML = html;
  $('btnReintentarFichajes')?.addEventListener('click', async () => {
    const r = await sincronizarFichajes();
    if(r.error?.tipo === 'sin_conexion') avisar('Sigue sin haber conexión. Se volverá a intentar sola.');
  });
}

/* ================= Consumo de la semana (Contador.dc.html, solo esta tarjeta) =================
   Lunes a domingo. Verde: horas normales; magenta: extra; rayado: hoy en curso; ámbar, aparte: la
   comida, que no cuenta. Las horas son las del parte de la semana (lo que se enviará). */
function pintarConsumo(){
  const clave = claveActual(), dias = diasSemana(deIso(clave));
  const sit = situacionActual(), hoyIso = iso(HOY());
  let descanso = 0, comida = 0;
  const barras = dias.map((d, i) => {
    const f = iso(d), dd = diaDe(clave, f), j = jornadaDe(f);
    descanso += j.descansoMin; comida += j.comidaMin;
    const enCurso = sit.fecha === f && ['servicio','descanso','comida'].includes(sit.j.estado);
    const b = { i, n:0, x:0, curso:0, comida:j.comidaMin/60, etiqueta:'—', hoy:f === hoyIso, tipo:null };
    if(enCurso){ b.curso = j.trabajadoMin/60; b.etiqueta = fH(Math.round(b.curso*10)/10); }
    else if(dd?.tipo === 'trabajado'){ b.n = horasDia(dd); b.x = extrasDia(dd); b.etiqueta = b.n+b.x > 0 ? fH(b.n+b.x) : '—'; }
    else if(dd){ b.etiqueta = ETIQUETA_CORTA[dd.tipo]; b.tipo = dd.tipo; }
    return b;
  });
  const maxH = Math.max(10, ...barras.map(b => b.n + b.x + b.curso + b.comida));
  const px = 116 / maxH;                            // 11,6 px por hora hasta 10 h (el diseño usa 12)
  const columnas = barras.map(b => {
    const h = b.n + b.x + b.curso;
    let barra;
    if(h > 0){
      const fondo = b.curso ? 'repeating-linear-gradient(45deg,#9FD3B2 0 6px,#2F9E5B 6px 12px)'
        : b.x > 0 ? `linear-gradient(#C438B8 0 ${Math.round(b.x/h*100)}%,#2F9E5B ${Math.round(b.x/h*100)}% 100%)` : '#2F9E5B';
      barra = `<div class="fx-col-barra" style="height:${Math.max(3, Math.round(h*px))}px;background:${fondo}"></div>`;
    } else barra = '<div class="fx-col-vacia"></div>';
    const comidaHtml = b.comida > 0 && h > 0 ? `<div class="fx-col-comida" style="height:${Math.max(3, Math.round(b.comida*px))}px"></div>` : '';
    const vacia = h <= 0;
    return `<div class="fx-col" title="${DIAS[b.i]}"><span class="fx-col-num${vacia ? ' gris' : ''}">${b.etiqueta}</span>${comidaHtml}${barra}</div>`;
  }).join('');
  const nombres = DIAS_CORTOS.map((n, i) => `<span${barras[i].hoy ? ' class="hoy"' : ''}>${n}</span>`).join('');
  const trozos = [descanso >= 1 ? 'descanso '+fmtMinutos(descanso)+' (incluido en las horas)' : '', comida >= 1 ? 'comida '+fmtMinutos(comida) : ''].filter(Boolean);
  const pausas = '<strong>Pausas de la semana:</strong> '+(trozos.join(' · ') || 'todavía ninguna');
  $('fxConsumo').innerHTML = `<div class="fx-consumo-cab"><h2>Consumo de la semana</h2></div>
    <div class="fx-grafica">${columnas}</div>
    <div class="fx-dias">${nombres}</div>
    <div class="fx-leyenda">
      <span><i style="background:#2F9E5B"></i>Normales</span>
      <span><i style="background:#C438B8"></i>Extra</span>
      <span><i style="background:repeating-linear-gradient(45deg,#9FD3B2 0 3px,#2F9E5B 3px 6px)"></i>En curso</span>
      <span><i style="background:#D99A1E"></i>Comida (no cuenta)</span>
    </div>
    <div class="fx-pausas-semana">${ICONO_RELOJ_FX}<span>${pausas}</span></div>`;
}

/* ================= Relojes (cada segundo, sin repintar la pantalla) ================= */
function moverRelojes(){
  const sit = situacionActual(), j = sit.j;
  if(!pintadoFichar || j.estado !== pintadoFichar.estado || sit.fecha !== pintadoFichar.fecha || fichajes.length !== pintadoFichar.n){ pintarFichar(); return; }
  if(j.estado === 'servicio'){
    const r = reloj(j.trabajadoMin);
    $('fxReloj').innerHTML = r.hm+'<span class="fx-seg">'+r.ss+'</span>';
  } else if(j.estado === 'descanso' || j.estado === 'comida'){
    const p = j.pausaAbierta, prevista = (p.prevista || 0) * 60;
    const pasado = Math.max(0, (Date.now() - p.desde) / 1000), quedan = prevista - pasado;
    const nombre = PAUSAS[p.clase].nombre;
    if(quedan >= 0){
      $('fxCuentaEtq').textContent = nombre+' · quedan';
      $('fxCuenta').textContent = Math.floor(quedan/60)+':'+p2(Math.floor(quedan)%60);
      $('fxCuenta').classList.remove('pasado');
    } else {
      $('fxCuentaEtq').textContent = nombre+' · te has pasado';
      $('fxCuenta').textContent = '+'+Math.max(1, Math.floor(-quedan/60))+' min';
      $('fxCuenta').classList.add('pasado');
    }
    $('fxBarra').style.width = (prevista ? Math.min(100, pasado/prevista*100) : 100)+'%';
    $('fxTrabajado').textContent = fmtMinutos(Math.floor(j.trabajadoMin));
  }
}
let segundosFichar = 0;
setInterval(() => {
  if(!uid || $('vApp').hidden || $('tabFichar').hidden || document.hidden) return;
  if(++segundosFichar % 60 === 0) pintarConsumo();
  moverRelojes();
}, 1000);

/* ================= Acciones ================= */
function enlazarAcciones(sit){
  const j = sit.j;
  document.querySelectorAll('#tabFichar [data-corregir]').forEach(b => b.addEventListener('click', () => abrirCorreccion(b.dataset.corregir)));
  $('obrasRecientesLista').innerHTML = obrasRecientes().map(o => `<option value="${escapar(o)}">`).join('');
  if(j.estado === 'fuera'){
    enlazarChips($('fxAcciones'), $('inObraEntrada'));
    $('btnFicharEntrada').addEventListener('click', ficharEntrada);
  }
  if(j.estado === 'servicio'){
    $('btnFicharSalida').addEventListener('click', () => ficharSalida(sit));
    document.querySelectorAll('#fxAcciones [data-pausa]').forEach(b => b.addEventListener('click', () => empezarPausa(sit, b.dataset.pausa)));
    $('btnCambiarObra').addEventListener('click', () => abrirCambioObra(sit));
  }
  if(j.estado === 'descanso' || j.estado === 'comida') $('btnVolverTrabajo').addEventListener('click', () => volverAlTrabajo(sit));
  if(j.estado === 'terminada') $('btnVerSemana').addEventListener('click', () => { semanaVista = iso(lunesDe(deIso(sit.fecha))); mostrarPestanaTecnico('semana'); });
  if(j.estado === 'descanso' || j.estado === 'comida') moverRelojes();
}

/* Tras cada fichaje: pintar, avisar y mandarlo (si no hay cobertura, se queda en el móvil). */
function trasFichar(texto){
  pintarFichar();
  const sinRed = !apiDisponible() || navigator.onLine === false;
  avisar(texto + (sinRed ? ' Sin cobertura: se enviará sola.' : ''));
  sincronizarFichajes();
}

function ficharEntrada(){
  const obra = $('inObraEntrada').value.trim();
  if(!obra){ errorDialogo('entradaError', 'Indica la obra o el lugar de trabajo.'); $('inObraEntrada').focus(); return; }
  if(obra.length > 200){ errorDialogo('entradaError', 'El nombre de la obra es demasiado largo.'); return; }
  const e = anadirFichaje('entrada', { fecha:iso(HOY()), obra });
  trasFichar('Entrada fichada a las '+hhmm(e.hora)+'.');
}

function ficharSalida(sit){
  confirmar('Fichar la salida', 'Vas a fichar la salida a las '+hhmm(new Date())+'. Las horas de hoy pasarán al parte de la semana.', () => {
    const e = anadirFichaje('salida', { fecha:sit.fecha, obra:sit.j.obraActual });
    trasFichar('Salida fichada a las '+hhmm(e.hora)+'.');
    pasarAlParte(sit.fecha);
  }, 'Sí, fichar salida');
}

function empezarPausa(sit, clase){
  if(sit.j.pausas.some(p => p.clase === clase)){ avisar('Ya has tomado el '+PAUSAS[clase].nombre.toLowerCase()+' hoy.'); return; }
  const e = anadirFichaje(PAUSAS[clase].inicio, { fecha:sit.fecha, duracionPrevistaMin:ajustesPausas()[clase+'_min'] });
  trasFichar(PAUSAS[clase].nombre+' desde las '+hhmm(e.hora)+'.');
}

function volverAlTrabajo(sit){
  const p = sit.j.pausaAbierta;
  const e = anadirFichaje(PAUSAS[p.clase].fin, { fecha:sit.fecha });
  trasFichar('De vuelta al trabajo a las '+hhmm(e.hora)+'.');
}

/* ================= Cambiar de obra ================= */
let ctxCambioObra = null;
function abrirCambioObra(sit){
  ctxCambioObra = sit;
  const obras = obrasRecientes().filter(o => o !== sit.j.obraActual);
  $('cambioObraSub').textContent = 'Ahora: '+(sit.j.obraActual || '—')+'. Las horas desde este momento irán a la obra nueva.';
  $('inCambioObra').value = '';
  $('chipsCambioObra').innerHTML = htmlChips(obras, null).replace(/^<div class="fx-chips">|<\/div>$/g, '');
  enlazarChips($('chipsCambioObra'), $('inCambioObra'));
  errorDialogo('cambioObraError', '');
  $('dlgCambioObra').showModal();
}
$('dlgCambioObraOk').addEventListener('click', () => {
  const obra = $('inCambioObra').value.trim(), sit = ctxCambioObra;
  if(!obra){ errorDialogo('cambioObraError', 'Indica la obra nueva.'); return; }
  if(obra.length > 200){ errorDialogo('cambioObraError', 'El nombre de la obra es demasiado largo.'); return; }
  if(obra === sit.j.obraActual){ errorDialogo('cambioObraError', 'Ya estás en '+obra+'.'); return; }
  $('dlgCambioObra').close();
  const e = anadirFichaje('cambio_obra', { fecha:sit.fecha, obra });
  trasFichar('Cambio a '+obra+' a las '+hhmm(e.hora)+'.');
});

/* ================= Del fichaje al parte ================= */
const describirDia = d => !d ? 'nada' : d.tipo !== 'trabajado' ? TIPOS[d.tipo]
  : (d.entradas.map(e => e.obra+' '+fmtHoras(e.horas)).join(', ') || 'Trabajado sin obras')
    + (d.horaInicio ? ' ('+d.horaInicio+' a '+d.horaFin+')' : '');

/* Pone en el parte la jornada terminada de esa fecha. Si el técnico ya había apuntado otra cosa
   ese día, se lo pregunta: nunca se sustituye sin avisar. */
function pasarAlParte(fecha){
  const p = propuestaParte(fecha);
  if(!p || p.igual || !esEditable(p.clave)) return;
  const repintar = () => { if(!$('tabSemana').hidden) pintarSemana(); if(!$('tabFichar').hidden) pintarFichar(); };
  if(!p.pregunta){ aplicarPropuesta(p); repintar(); return; }
  confirmar('Este día ya tenía horas apuntadas',
    diaLargo(fecha)+' tenía: '+describirDia(p.actual)+'.\n\nEl fichaje da: '+describirDia(p.nuevo)+'.\n\n¿Lo cambio por lo del fichaje? Las horas extra se mantienen.',
    () => { aplicarPropuesta(p); repintar(); avisar('Día actualizado con el fichaje.'); },
    'Sí, usar el fichaje', 'Dejar como estaba');
}

/* Línea del fichaje en la tarjeta del día (pestaña Semana). */
function lineaFichajeDia(fIso, editable){
  if(!hayFichajes(fIso)) return null;
  const j = jornadaDe(fIso), sit = situacionActual();
  const abierta = sit.fecha === fIso && j.entrada && !j.salida;
  const caja = document.createElement('div');
  caja.className = 'dia-fichaje';
  const partes = ['Fichaje: '+(j.entrada ? hhmm(j.entrada.hora) : '—')+' a '+(j.salida ? hhmm(j.salida.hora) : abierta ? 'en curso' : 'sin salida')];
  if(j.descansoMin) partes.push('descanso '+fmtMinutos(j.descansoMin));
  if(j.comidaMin) partes.push('comida '+fmtMinutos(j.comidaMin));
  caja.innerHTML = '<span class="dia-fichaje-texto">'+escapar(partes.join(' · '))+'</span>'
    + (j.corregida ? '<span class="marca-corregido" title="'+escapar(j.motivos.join(' · '))+'">Corregido</span>' : '');
  if(editable){
    const p = j.salida ? propuestaParte(fIso) : null;
    if(p && !p.igual){
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'dia-fichaje-b'; b.textContent = 'Pasar al parte';
      b.addEventListener('click', () => pasarAlParte(fIso));
      caja.appendChild(b);
    }
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'dia-fichaje-b'; c.textContent = 'Corregir';
    c.addEventListener('click', () => abrirCorreccion(fIso));
    caja.appendChild(c);
  }
  return caja;
}

/* ================= Corregir un fichaje =================
   No se modifica nada: se añade un evento con el motivo. Si corrige la hora de otro, apunta a él
   (correccionDe) y el original se queda guardado. «Falta la salida» añade la salida olvidada. */
let ctxCorr = null;
function abrirCorreccion(fecha){
  const ev = eventosEfectivos(fichajes.filter(e => e.fecha === fecha));
  const j = calcularJornada(ev, Date.now());
  const sit = situacionActual();
  const enCurso = sit.fecha === fecha && j.entrada && !j.salida;
  const opciones = ev.map(e => ({ valor:(e.original || e).id, tipo:e.tipo, hora:e.hora, obra:e.obra,
    texto:TIPOS_FICHAJE[e.tipo]+' · '+hhmm(e.hora)+(e.obra && e.tipo !== 'salida' ? ' · '+e.obra : '')+(e.motivo ? ' (ya corregido)' : '') }));
  if(j.entrada && !j.salida && !enCurso) opciones.unshift({ valor:'falta', tipo:'salida', hora:null, obra:j.obraActual, texto:'Falta la salida (no la fiché)' });
  if(!opciones.length){ informar('Corregir un fichaje', 'Este día no tiene fichajes. Puedes apuntar las horas a mano en Semana.'); return; }
  ctxCorr = { fecha, opciones };
  $('corrSub').textContent = diaLargo(fecha);
  $('inCorrEvento').innerHTML = opciones.map((o,i) => `<option value="${i}">${escapar(o.texto)}</option>`).join('');
  $('motivosCorreccion').innerHTML = MOTIVOS_SUGERIDOS.map(m => `<option value="${escapar(m)}">`).join('');
  elegirCorreccion();
  errorDialogo('corrError', '');
  $('dlgCorregir').showModal();
}
function elegirCorreccion(){
  const o = ctxCorr.opciones[Number($('inCorrEvento').value) || 0];
  $('inCorrHora').value = o.hora ? hhmm(o.hora) : '';
  $('inCorrMotivo').value = o.valor === 'falta' ? 'Olvidé fichar la salida' : '';
}
$('inCorrEvento').addEventListener('change', elegirCorreccion);

$('dlgCorrOk').addEventListener('click', () => {
  const { fecha, opciones } = ctxCorr;
  const o = opciones[Number($('inCorrEvento').value) || 0];
  const valor = $('inCorrHora').value, motivo = $('inCorrMotivo').value.trim();
  if(!/^\d{2}:\d{2}$/.test(valor)){ errorDialogo('corrError', 'Indica la hora correcta.'); return; }
  if(motivo.length < 3){ errorDialogo('corrError', 'Escribe el motivo de la corrección (por ejemplo: Olvidé fichar la salida).'); return; }
  const [h, m] = valor.split(':').map(Number);
  const hora = deIso(fecha); hora.setHours(h, m, 0, 0);
  // Una salida o una vuelta anterior a la entrada es de madrugada: del día siguiente.
  const entrada = eventosEfectivos(fichajes.filter(e => e.fecha === fecha)).find(e => e.tipo === 'entrada');
  if(o.tipo !== 'entrada' && entrada && hora.getTime() < msDe(entrada.hora)) hora.setDate(hora.getDate()+1);
  if(hora.getTime() > Date.now() + 60000){ errorDialogo('corrError', 'La hora no puede ser posterior a ahora.'); return; }
  if(o.hora && hhmm(o.hora) === valor){ errorDialogo('corrError', 'Esa es la hora que ya tiene. Cambia la hora o cancela.'); return; }
  const nuevo = { id:'nuevo', fecha, tipo:o.tipo, hora:hora.toISOString(), obra:o.obra, correccionDe:o.valor === 'falta' ? null : o.valor, motivo, estado:'pendiente' };
  const problema = ordenNoValido(eventosEfectivos([...fichajes.filter(e => e.fecha === fecha), nuevo]));
  if(problema){ errorDialogo('corrError', 'Con esa hora no cuadra: '+problema); return; }
  $('dlgCorregir').close();
  anadirFichaje(o.tipo, { fecha, hora:nuevo.hora, obra:o.obra, correccionDe:nuevo.correccionDe, motivo });
  trasFichar('Corrección guardada.');
  if(jornadaDe(fecha).salida) pasarAlParte(fecha);
  if(!$('tabSemana').hidden) pintarSemana();
});

/* La sincronización de fichajes ha terminado (fichaje.js). */
function alCambiarFichajes(r){
  if(!uid || !perfil) return;
  if(!$('vApp').hidden && !$('tabFichar').hidden) pintarSincFichajes();
  if(r.rechazados) informar('Un fichaje no se ha podido guardar',
    'El servidor no ha aceptado '+(r.rechazados === 1 ? 'un fichaje' : r.rechazados+' fichajes')+'. Lo tienes en Fichar. Avisa al encargado para revisarlo.');
}
