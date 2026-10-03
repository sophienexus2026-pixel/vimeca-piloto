'use strict';
/* ================= Vista del técnico ================= */
const $ = id => document.getElementById(id);
function escapar(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

let semanaVista = null;       // clave ISO del lunes que se está viendo

/* ================= Avisos ================= */
function avisar(msg){
  const a=$('aviso'); a.textContent=msg; a.classList.add('ver');
  clearTimeout(a._t); a._t=setTimeout(()=>a.classList.remove('ver'),3800);
}
function informar(titulo, texto){
  $('infoTitulo').textContent=titulo;
  $('infoTexto').textContent=texto;
  $('dlgInfo').showModal();
}

/* ================= Confirmación genérica (v1) ================= */
let accionConf=null, accionCancelar=null;
function confirmar(titulo,texto,fn,textoBoton,textoCancelar,alCancelar){
  $('confTitulo').textContent=titulo;
  $('confTexto').textContent=texto;
  $('confOk').textContent=textoBoton||'Sí, eliminar';
  $('confCancelar').textContent=textoCancelar||'Cancelar';
  accionConf=fn; accionCancelar=alCancelar||null;
  $('dlgConfirmar').returnValue='';
  $('dlgConfirmar').showModal();
}
$('confOk').addEventListener('click',()=>{ const fn=accionConf; accionConf=accionCancelar=null; $('dlgConfirmar').close(); if(fn) fn(); });
$('dlgConfirmar').addEventListener('close',()=>{
  if($('dlgConfirmar').returnValue!=='cancel') return;
  const fn=accionCancelar;
  accionConf=accionCancelar=null;
  if(fn) fn();
});

/* ================= Vista principal ================= */
function mostrarApp(){
  if(!semanaVista) semanaVista=claveActual();
  mostrarVista('vApp');
  pintarSemana();
  ofrecerImportacionV1();
}

const TEXTO_ESTADO = {
  vacia:      'Semana sin rellenar',
  sin_enviar: 'Sin enviar',
  cambios:    'Tienes cambios sin enviar',
  en_cola:    'En cola: se enviará sola en cuanto haya cobertura',
  rechazada:  'No se ha podido enviar'
};
function textoEstado(clave){
  const est=estadoSemana(clave), s=semanas[clave];
  if(est==='enviada'){
    const sv=s.servidor;
    return sv.modificadoAt ? 'Enviada · corregida el '+fmtFechaHora(sv.modificadoAt) : 'Enviada el '+fmtFechaHora(sv.enviadoAt);
  }
  if(est==='rechazada') return TEXTO_ESTADO.rechazada+': '+cola.find(c=>c.semana===clave).rechazo;
  return TEXTO_ESTADO[est];
}

function pintarSemana(){
  const clave = semanaVista || claveActual();
  const esActual = clave === claveActual();
  const editable = esEditable(clave);
  const dias = diasSemana(deIso(clave));
  const hoyIso = iso(HOY());

  $('cabFecha').textContent = 'Semana '+rangoSemana(clave);
  pintarCabeceraUsuario();
  $('btnSemAnt').disabled = sumarSemanas(clave,-1) < claveMasAntigua();
  $('btnSemSig').disabled = clave >= claveActual();

  $('avisoHist').hidden = esActual;
  $('avisoHistTexto').textContent = editable
    ? 'Estás viendo una semana anterior. Puedes rellenarla y enviarla.'
    : 'Esta semana tiene más de 4 meses: solo lectura.';

  pintarEstadoSemana(clave, editable);
  pintarAvisoCola();

  const zona=$('zonaSemana'); zona.innerHTML='';
  dias.forEach((d,i)=>{
    const fIso=iso(d);
    const dd=diaDe(clave,fIso);
    const trabajado=dd?.tipo==='trabajado';
    const hN=horasDia(dd), hX=extrasDia(dd);
    const card=document.createElement('div');
    card.className='dia'+(esActual && fIso===hoyIso ? ' hoy':'')+(dd && !trabajado ? ' no-trabajado':'');
    const resumen = !dd ? 'Sin rellenar'
      : !trabajado ? TIPOS[dd.tipo]
      : dd.entradas.length ? dd.entradas.length+' trabajo'+(dd.entradas.length>1?'s':'') : 'Trabajado · sin obras';
    const horas = dd && !trabajado
      ? `<span class="tipo-etq">${TIPOS[dd.tipo]}</span>`
      : `<b>${trabajado? fmtHoras(hN+hX):'—'}</b>${hX>0?`<small>+${fmtHoras(hX)} extra</small>`:''}`;
    card.innerHTML=`
      <div class="dia-cab">
        <span class="dia-letra">${DIAS[i][0]}</span>
        <span class="dia-info"><b>${DIAS[i]} ${fmtCorta(d)}</b>
          <small>${resumen}${esActual && fIso===hoyIso ? ' · HOY':''}</small>
        </span>
        <span class="dia-horas">${horas}</span>
      </div>
      <div class="dia-cuerpo"></div>`;
    const cuerpo=card.querySelector('.dia-cuerpo');

    if(editable) cuerpo.appendChild(selectorTipo(clave, fIso, dd, DIAS[i]));

    if(!dd) cuerpo.insertAdjacentHTML('beforeend','<div class="dia-vacio">Ningún trabajo registrado este día.</div>');
    else if(!trabajado) cuerpo.insertAdjacentHTML('beforeend','<div class="dia-vacio">Día marcado como '+TIPOS[dd.tipo]+'.</div>');
    else if(!dd.entradas.length && !hX) cuerpo.insertAdjacentHTML('beforeend','<div class="dia-vacio">Añade al menos una obra con sus horas.</div>');

    (dd?.entradas||[]).forEach((e,idx)=>{
      const fila=document.createElement('div');
      fila.className='entrada';
      fila.innerHTML=`<span class="punto"></span><span class="eobra">${escapar(e.obra)}</span><span class="ehoras">${fmtHoras(e.horas)}</span>`;
      if(editable){
        const del=document.createElement('button');
        del.className='eborrar'; del.textContent='✕'; del.title='Eliminar';
        del.addEventListener('click',()=>confirmar('Eliminar trabajo','Se eliminará "'+e.obra+'" ('+fmtHoras(e.horas)+') del '+DIAS[i]+'.',()=>{
          borrarEntrada(clave,fIso,idx); pintarSemana();
        }));
        fila.appendChild(del);
      }
      cuerpo.appendChild(fila);
    });
    if(hX>0){
      const fila=document.createElement('div');
      fila.className='entrada extra';
      fila.innerHTML=`<span class="punto"></span><span class="eobra">Horas extras</span><span class="ehoras">+${fmtHoras(hX)}</span>`;
      if(editable){
        const del=document.createElement('button');
        del.className='eborrar'; del.textContent='✕'; del.title='Eliminar';
        del.addEventListener('click',()=>confirmar('Eliminar horas extras','Se eliminarán +'+fmtHoras(hX)+' del '+DIAS[i]+'.',()=>{
          quitarExtras(clave,fIso); pintarSemana();
        }));
        fila.appendChild(del);
      }
      cuerpo.appendChild(fila);
    }
    if(editable && (!dd || trabajado)){
      const add=document.createElement('button');
      add.className='dia-add'; add.textContent='+ Añadir obra y horas';
      add.addEventListener('click',()=>abrirObra(clave, fIso, DIAS[i]+' '+fmtCorta(d)));
      cuerpo.appendChild(add);
    }
    zona.appendChild(card);
  });

  const t=totalesSemana(clave);
  $('totSemana').textContent = fmtHoras(t.total);
  $('totDesglose').innerHTML = 'Normales: '+fmtHoras(t.normales)+'<br>Extras: <i>'+fmtHoras(t.extras)+'</i>';
}

/* ================= Estado de envío de la semana =================
   Una banda a todo lo ancho con icono, texto y detalle: el estado nunca depende solo del color.
   Con cambios sin enviar lleva el botón «Enviar ahora» (mismo envío que la barra inferior). */
const ICONOS_ESTADO = {
  ok:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/></svg>',
  reloj:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  error:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  vacia:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>'
};
function pintarEstadoSemana(clave, editable){
  const est=estadoSemana(clave), sv=semanas[clave]?.servidor;
  let icono, texto, detalle, boton=false;
  if(est==='enviada'){
    icono='ok'; texto='Semana enviada';
    detalle = sv.modificadoAt ? 'Corregida el '+fmtFechaHora(sv.modificadoAt) : 'El '+fmtFechaHora(sv.enviadoAt);
  } else if(est==='cambios' || est==='sin_enviar'){
    icono='alerta'; texto=TEXTO_ESTADO.cambios; boton=editable;
    detalle = est==='cambios'
      ? 'La enviaste el '+fmtFechaHora(sv.modificadoAt||sv.enviadoAt)+'. El encargado no verá los cambios hasta que la envíes otra vez.'
      : 'El encargado todavía no ha recibido esta semana.';
  } else if(est==='en_cola'){
    icono='reloj'; texto='Pendiente de cobertura'; detalle='Se enviará sola en cuanto haya conexión.';
  } else if(est==='rechazada'){
    icono='error'; texto=TEXTO_ESTADO.rechazada; boton=editable;
    detalle=cola.find(c=>c.semana===clave).rechazo;
  } else {
    icono='vacia'; texto=TEXTO_ESTADO.vacia; detalle='Marca el tipo de cada día o añade obras y horas.';
  }
  $('estadoSemana').className='estado-sem '+est;
  $('estadoSemanaIcono').innerHTML=ICONOS_ESTADO[icono];
  $('estadoSemanaTexto').textContent=texto;
  $('estadoSemanaDetalle').textContent=detalle;
  $('btnEnviarAhora').hidden=!boton;
}
$('btnEnviarAhora').addEventListener('click',()=>enviarSemana(semanaVista || claveActual()));

/* Botones de tipo de día. Pulsar el tipo ya marcado deja el día sin rellenar. */
function selectorTipo(clave, fIso, dd, nombreDia){
  const caja=document.createElement('div');
  caja.className='tipos';
  for(const [tipo, etiqueta] of Object.entries(TIPOS)){
    const b=document.createElement('button');
    const activo = dd?.tipo===tipo;
    b.className=(activo?'activo ':'')+tipo;
    b.textContent=etiqueta;
    b.setAttribute('aria-pressed', activo);
    b.addEventListener('click',()=>{
      const nuevo = activo ? null : tipo;
      const pierde = dd?.tipo==='trabajado' && nuevo!=='trabajado' && (dd.entradas.length || dd.horasExtra);
      const aplicar = () => { ponerTipo(clave, fIso, nuevo); pintarSemana(); };
      if(pierde) confirmar('Cambiar el tipo de día',
        'El '+nombreDia+' tiene obras u horas extra apuntadas. Si lo marcas como '+(nuevo? TIPOS[nuevo] : 'sin rellenar')+' se eliminarán.',
        aplicar, 'Sí, cambiar');
      else aplicar();
    });
    caja.appendChild(b);
  }
  return caja;
}

/* ================= Aviso de envíos pendientes ================= */
function pintarAvisoCola(){
  const n=pendientesEnCola().length;
  $('avisoCola').hidden = !n;
  $('avisoColaTexto').textContent = n===1
    ? '1 semana pendiente de enviar. Se enviará sola en cuanto haya cobertura.'
    : n+' semanas pendientes de enviar. Se enviarán solas en cuanto haya cobertura.';
}
$('btnReintentar').addEventListener('click', async ()=>{
  const r=await procesarCola();
  if(r.error?.tipo==='sin_conexion') avisar('Sigue sin haber conexión. Se volverá a intentar sola.');
});

/* La cola ha cambiado (envío correcto, rechazo o sin conexión): repintar y avisar. */
function alCambiarCola(r){
  if(!uid || !perfil) return;
  if(!$('vApp').hidden) pintarSemana();
  if(!$('vHistorico').hidden) pintarHistorico();
  if(r.enviadas.length) avisar(r.enviadas.length===1
    ? 'Semana del '+rangoSemana(r.enviadas[0])+' enviada correctamente.'
    : r.enviadas.length+' semanas enviadas correctamente.');
}

/* ================= Navegación por semanas ================= */
function irASemana(clave){ semanaVista=clave; mostrarVista('vApp'); pintarSemana(); window.scrollTo(0,0); }
$('btnSemAnt').addEventListener('click',()=>{ const k=sumarSemanas(semanaVista,-1); if(k>=claveMasAntigua()) irASemana(k); });
$('btnSemSig').addEventListener('click',()=>{ const k=sumarSemanas(semanaVista,1); if(k<=claveActual()) irASemana(k); });
$('btnVolverActual').addEventListener('click',()=>irASemana(claveActual()));

/* ================= Diálogo obra ================= */
let ctxObra=null;
function abrirObra(clave,fIso,etiqueta){
  ctxObra={clave,fIso};
  $('dlgObraSub').textContent=etiqueta;
  $('inObra').value=''; $('inHoras').value='';
  $('obrasPrevias').innerHTML=obrasUsadas().map(o=>`<option value="${escapar(o)}">`).join('');
  $('dlgObra').showModal();
}
/* Horas válidas: de 0 a 24 en tramos de media hora. */
function leerHoras(valor){
  const h=parseFloat(String(valor).replace(',','.'));
  if(!(h>=0)) return {error:'vacio'};
  if(h>24) return {error:'Como máximo 24 horas.'};
  if(Math.round(h*2)!==h*2) return {error:'Las horas van en tramos de media hora (por ejemplo 7,5).'};
  return {horas:h};
}
$('dlgObraOk').addEventListener('click',()=>{
  const obra=$('inObra').value.trim();
  const r=leerHoras($('inHoras').value);
  if(!obra){ alert('Indica la obra o el lugar de trabajo.'); return; }
  if(r.error==='vacio'){ alert('Indica las horas realizadas (por ejemplo 8).'); return; }
  if(r.error){ alert(r.error); return; }
  anadirEntrada(ctxObra.clave, ctxObra.fIso, obra, r.horas);
  $('dlgObra').close(); pintarSemana();
});

/* ================= Horas extras =================
   Solo en días trabajados que ya tienen alguna obra. Se suman al número del día. */
$('btnExtras').addEventListener('click',()=>{
  const clave=semanaVista||claveActual();
  if(!esEditable(clave)){ avisar('Esta semana ya no se puede modificar.'); return; }
  const dias=diasSemana(deIso(clave));
  const hoyIso=iso(HOY());
  const validos=dias.map((d,i)=>({d,i,fIso:iso(d)})).filter(x=>{ const dd=diaDe(clave,x.fIso); return dd?.tipo==='trabajado' && dd.entradas.length; });
  if(!validos.length){
    informar('Horas extras','Las horas extras solo se pueden añadir a un día trabajado que tenga alguna obra. Añade primero la obra de ese día.');
    return;
  }
  const sel=$('inExtraDia'); sel.innerHTML='';
  validos.forEach(({d,i,fIso})=>{
    const o=document.createElement('option');
    o.value=fIso;
    o.textContent=DIAS[i]+' '+fmtCorta(d)+(fIso===hoyIso?' (hoy)':'');
    if(fIso===hoyIso) o.selected=true;
    sel.appendChild(o);
  });
  const t=totalesSemana(clave);
  const esta = clave===claveActual() ? 'esta semana' : 'la semana del '+rangoSemana(clave);
  $('extrasResumen').textContent=perfil.nombre+', '+esta+' llevas '+fmtHoras(t.total)+' ('+fmtHoras(t.extras)+' extras). Hoy es '+DIAS[(HOY().getDay()+6)%7]+' '+fmtCorta(HOY())+'.';
  $('inExtraHoras').value='';
  $('dlgExtras').showModal();
});
$('dlgExtrasOk').addEventListener('click',()=>{
  const r=leerHoras($('inExtraHoras').value);
  if(r.error==='vacio' || r.horas===0){ alert('Indica cuántas horas extras quieres añadir.'); return; }
  if(r.error){ alert(r.error); return; }
  const clave=semanaVista||claveActual(), fIso=$('inExtraDia').value;
  if(extrasDia(diaDe(clave,fIso))+r.horas>24){ alert('Como máximo 24 horas extra en un día.'); return; }
  anadirExtras(clave, fIso, r.horas);
  $('dlgExtras').close(); pintarSemana();
});

/* ================= Histórico: las semanas de los últimos 4 meses ================= */
function pintarHistorico(){
  const lista=$('listaHist'); lista.innerHTML='';
  // Semanas editables más cualquier semana antigua que aún tenga algo sin enviar.
  const claves=new Set(clavesEditables());
  for(const k of Object.keys(semanas)) if(tieneCambiosSinEnviar(semanas[k])) claves.add(k);
  [...claves].sort().reverse().forEach(k=>{
    const t=totalesSemana(k);
    const est=estadoSemana(k);
    const b=document.createElement('button');
    b.className='hist-item';
    b.innerHTML=`<span><b>Semana ${rangoSemana(k)}${k===claveActual()?' (actual)':''}</b>
      <small>Normales ${fmtHoras(t.normales)} · Extras ${fmtHoras(t.extras)}</small>
      <small class="est ${est}">${escapar(est==='enviada'? textoEstado(k) : TEXTO_ESTADO[est])}</small></span>
      <span class="h">${fmtHoras(t.total)}</span>`;
    b.addEventListener('click',()=>irASemana(k));
    lista.appendChild(b);
  });
}
$('btnHistorico').addEventListener('click',()=>{ mostrarVista('vHistorico'); pintarHistorico(); window.scrollTo(0,0); });
$('btnHistVolver').addEventListener('click',()=>{ mostrarVista('vApp'); pintarSemana(); });

/* ================= Enviar ================= */
$('btnEnviar').addEventListener('click',()=>{
  const clave=semanaVista || claveActual();
  $('envSub').textContent='Semana '+rangoSemana(clave)+' · '+textoEstado(clave);
  $('btnEnviarSemana').hidden=!esEditable(clave);
  $('dlgEnviar').showModal();
});
$('btnDescargarPDF').addEventListener('click',()=>{
  $('dlgEnviar').close();
  imprimirInforme(semanaVista || claveActual());
});
$('btnEnviarSemana').addEventListener('click',()=>{
  $('dlgEnviar').close();
  enviarSemana(semanaVista || claveActual());
});
/* Enviar una semana: desde el diálogo de la barra inferior o desde «Enviar ahora». */
async function enviarSemana(clave){
  const errores=validarSemana(clave);
  if(errores.length){ informar('Revisa la semana antes de enviarla', errores.join('\n\n')); return; }
  if(estadoSemana(clave)==='enviada'){ avisar('Esta semana ya está enviada y no tiene cambios.'); return; }
  const btns=[$('btnEnviar'), $('btnEnviarAhora')];
  btns.forEach(b=>b.disabled=true);
  try{
    const r=await encolarEnvio(clave);
    if(r.estado==='enviada') avisar('Semana enviada correctamente.');
    else if(r.estado==='en_cola') informar('Sin conexión','La semana se ha guardado en el móvil y se enviará sola en cuanto haya cobertura. No hace falta que hagas nada más.');
    else if(r.estado==='rechazada') informar('No se ha podido enviar', r.mensaje+'\n\nCorrígelo y vuelve a pulsar Enviar.');
    // r.estado==='sesion': ya se muestra la pantalla de acceso explicando que hay que volver a entrar.
  } finally { btns.forEach(b=>b.disabled=false); pintarSemana(); }
}

/* El perfil (hoja, foto, privacidad, cerrar sesión) está en perfil.js. */

/* ================= Partes de la versión anterior ================= */
let importacionPreguntada=false;
function ofrecerImportacionV1(){
  if(importacionPreguntada || cargar(K.importadoV1(uid), false)) return;
  const v1=datosV1();
  if(!v1) return;
  importacionPreguntada=true;
  const n=Object.keys(v1.semanas).length;
  const nombre=v1.perfil ? v1.perfil.nombre+' '+v1.perfil.apellidos : 'otra persona';
  confirmar('Partes de la versión anterior',
    'En este móvil hay '+n+' semana'+(n>1?'s':'')+' de la versión anterior de la app, a nombre de '+nombre+'. ¿Son tuyas? Si lo son, se copiarán a tu cuenta como semanas sin enviar.',
    ()=>{
      const r=importarV1(v1);
      pintarSemana();
      let texto='Semanas copiadas: '+r.importadas+'.';
      if(r.yaExistian) texto+='\nYa tenías datos en '+r.yaExistian+' de ellas y se han dejado como estaban.';
      if(r.omitidos.length){
        texto+='\n\nEstos días tenían horas extra pero ninguna obra y NO se han copiado. Vuelve a apuntarlos indicando la obra:\n'
          + r.omitidos.map(o=>'• '+diaLargo(o.fecha)+': '+fmtHoras(o.extras)+' extra').join('\n');
      }
      texto+='\n\nRevísalas y envíalas desde el Histórico.';
      informar('Importación terminada', texto);
    }, 'Sí, son mías', 'No son mías', ()=>guardar(K.importadoV1(uid), 'rechazado'));
}
