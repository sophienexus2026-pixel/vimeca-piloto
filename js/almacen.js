'use strict';
/* ================= Almacenamiento local =================
   Todo se guarda por usuario, para que un móvil compartido no mezcle personas, y con la ruta de
   la app delante (PREFIJO), para que la v1, el piloto y la v2 no se mezclen aunque compartan
   dominio en GitHub Pages. Con la app en /vimeca-piloto/ las claves son "pv2/vimeca-piloto/…":

   …sesion              → { uid, email }            sesión abierta en este móvil
   …perfil:<uid>        → fila de profiles           para arrancar sin conexión
   …semanas:<uid>       → { "2026-07-13": {
                              dias: { "2026-07-14": { tipo, entradas:[{obra,horas}], horasExtra } },
                              revLocal,               sube con cada cambio
                              revEnviada,             revLocal que el servidor confirmó (null = nunca)
                              servidor: { version, enviadoAt, modificadoAt } } }
   …cola:<uid>          → [ { semana, envioId, datos, revLocal, encoladoAt, intentos, ultimoError, rechazo } ]
   …foto:<uid>          → { ruta, datos }            mi foto reducida (data URL) para verla sin cobertura
   …terminos_pendiente:<uid> → { version, aceptadoAt } privacidad aceptada sin cobertura, por mandar
   …fichajes:<uid>      → [ { id, fecha, tipo, hora, obra, duracionPrevistaMin, correccionDe, motivo,
                              estado: 'pendiente'|'guardado'|'rechazado', error, recibidoEn, relojDesfasado } ]
                              en orden de creación (v2.2, ver fichaje.js)
   …ajustes_pausas      → { descanso_min, comida_min, modificado_por, modificado_at }  últimas duraciones leídas

   v2.2: un día trabajado puede llevar también horaInicio / horaFin ("HH:MM") y firmaFichaje: los pone
   el fichaje al fichar la salida.

   Un día que no está en "dias" es un día sin rellenar (null), que no es lo mismo que "sin_trabajo".
   Los datos locales solo se borran cuando el servidor ha confirmado la semana (ver purgar). */

const cargar = (k,def) => { try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch(e){ return def; } };
function guardar(k,v){
  try{ localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch(e){
    alert('No se ha podido guardar en el móvil (almacenamiento lleno o bloqueado). No cierres la app y avisa al encargado.');
    return false;
  }
}

const PREFIJO = 'pv2' + new URL('./', location.href).pathname;
const K = {
  sesion: PREFIJO+'sesion',
  auth: PREFIJO+'auth',
  perfil: u => PREFIJO+'perfil:'+u,
  semanas: u => PREFIJO+'semanas:'+u,
  cola: u => PREFIJO+'cola:'+u,
  importadoV1: u => PREFIJO+'importado_v1:'+u,
  foto: u => PREFIJO+'foto:'+u,                        // mi foto (data URL), para verla sin cobertura
  terminos: u => PREFIJO+'terminos_pendiente:'+u,      // aceptación hecha sin cobertura, por mandar
  fichajes: u => PREFIJO+'fichajes:'+u,                // v2.2: entrada, salida, pausas y cambios de obra
  ajustesPausas: PREFIJO+'ajustes_pausas'              // v2.2: duraciones de las pausas, para fichar sin cobertura
};
const TIPOS = {
  trabajado:   'Trabajado',
  vacaciones:  'Vacaciones',
  baja:        'Baja',
  festivo:     'Festivo',
  sin_trabajo: 'Sin trabajo'
};

let uid = null;
let perfil = null;
let semanas = {};
let cola = [];
let fichajes = [];

function abrirAlmacen(u){
  uid = u;
  perfil = cargar(K.perfil(u), null);
  semanas = cargar(K.semanas(u), {});
  cola = cargar(K.cola(u), []);
  fichajes = cargar(K.fichajes(u), []);
  purgar();
}
function cerrarAlmacen(){ uid=null; perfil=null; semanas={}; cola=[]; fichajes=[]; }
const guardarSemanas = () => guardar(K.semanas(uid), semanas);
const guardarCola = () => guardar(K.cola(uid), cola);
const guardarFichajes = () => guardar(K.fichajes(uid), fichajes);
function guardarPerfil(p){ perfil=p; guardar(K.perfil(uid), p); }

/* Solo se borran semanas fuera de plazo que el servidor ya confirmó y no están en la cola. */
function purgar(){
  const tope = claveMasAntigua();
  let cambio = false;
  for(const k of Object.keys(semanas)){
    if(k < tope && !tieneCambiosSinEnviar(semanas[k]) && !cola.some(c=>c.semana===k)){
      delete semanas[k]; cambio = true;
    }
  }
  if(cambio) guardarSemanas();
  // Fichajes: igual, solo los que el servidor ya guardó y son de antes del plazo.
  const quedan = fichajes.filter(e => e.fecha >= tope || e.estado !== 'guardado');
  if(quedan.length !== fichajes.length){ fichajes = quedan; guardarFichajes(); }
}

/* ================= Semanas y días ================= */
function semanaObj(clave){
  if(!semanas[clave]) semanas[clave] = { dias:{}, revLocal:0, revEnviada:null, servidor:null };
  return semanas[clave];
}
const diaDe = (clave, fIso) => semanas[clave]?.dias?.[fIso] || null;

function tocarSemana(clave){
  const s = semanaObj(clave);
  s.revLocal = (s.revLocal||0) + 1;
  guardarSemanas();
}
/* Hay algo que el servidor no tiene: días rellenados nunca enviados, o cambios tras el último envío. */
function tieneCambiosSinEnviar(s){
  if(!s || s.revLocal === s.revEnviada) return false;
  return Object.keys(s.dias).length > 0 || !!s.servidor;
}

/* tipo = null deja el día sin rellenar. Al pasar a un tipo no trabajado se quitan obras y extras. */
function ponerTipo(clave, fIso, tipo){
  const s = semanaObj(clave);
  const antes = s.dias[fIso];
  if(!tipo) delete s.dias[fIso];
  else if(tipo === 'trabajado') s.dias[fIso] = antes?.tipo === 'trabajado' ? antes : { tipo, entradas: [], horasExtra: 0 };
  else s.dias[fIso] = { tipo, entradas: [], horasExtra: 0 };
  tocarSemana(clave);
}
function anadirEntrada(clave, fIso, obra, horas){
  const s = semanaObj(clave);
  if(!s.dias[fIso] || s.dias[fIso].tipo !== 'trabajado') s.dias[fIso] = { tipo:'trabajado', entradas:[], horasExtra:0 };
  s.dias[fIso].entradas.push({obra, horas});
  tocarSemana(clave);
}
function borrarEntrada(clave, fIso, idx){ semanaObj(clave).dias[fIso].entradas.splice(idx,1); tocarSemana(clave); }
function anadirExtras(clave, fIso, horas){ const d = semanaObj(clave).dias[fIso]; d.horasExtra = (d.horasExtra||0) + horas; tocarSemana(clave); }
function quitarExtras(clave, fIso){ semanaObj(clave).dias[fIso].horasExtra = 0; tocarSemana(clave); }

function horasDia(d){ return (d?.entradas||[]).reduce((a,e)=>a+e.horas,0); }
function extrasDia(d){ return d?.horasExtra || 0; }
function totalesSemana(clave){
  const s = semanas[clave] || {dias:{}};
  let n=0, x=0;
  for(const d of Object.values(s.dias)){ n+=horasDia(d); x+=extrasDia(d); }
  return {normales:n, extras:x, total:n+x};
}
/* Obras usadas antes, para el autocompletado. */
function obrasUsadas(){
  const set = new Set();
  for(const s of Object.values(semanas)) for(const d of Object.values(s.dias)) for(const e of d.entradas) set.add(e.obra);
  return [...set];
}

/* Estado de envío de una semana, para la cabecera y el histórico. */
function estadoSemana(clave){
  const s = semanas[clave];
  const enCola = cola.find(c=>c.semana===clave);
  if(enCola) return enCola.rechazo ? 'rechazada' : 'en_cola';
  if(!s || (!Object.keys(s.dias).length && !s.servidor)) return 'vacia';
  if(!s.servidor) return 'sin_enviar';
  if(tieneCambiosSinEnviar(s)) return 'cambios';
  return 'enviada';
}

/* ================= Validación antes de enviar =================
   Mismas reglas que public.enviar_parte(). Devuelve una lista de mensajes; vacía = se puede enviar. */
const textoSinObras = fIso => diaLargo(fIso)+': está marcado como Trabajado pero no tiene ninguna obra. Añade la obra o elige otro tipo de día.';
const textoSinHoras = fIso => diaLargo(fIso)+': está marcado como Trabajado pero suma 0 horas. Añade las horas o, si no se trabajó, elige otro tipo de día (por ejemplo, Sin trabajo).';

function validarSemana(clave){
  const s = semanas[clave];
  const errores = [];
  if(!esEditable(clave)) errores.push('Esta semana tiene más de 4 meses y ya no se puede enviar.');
  if(!s || !Object.keys(s.dias).length) errores.push('No has rellenado ningún día de esta semana.');
  for(const [fIso, d] of Object.entries(s?.dias||{}).sort()){
    if(d.tipo !== 'trabajado') continue;
    if(!d.entradas.length) errores.push(textoSinObras(fIso));
    else if(horasDia(d) + extrasDia(d) <= 0) errores.push(textoSinHoras(fIso));
  }
  return errores;
}

/* Datos que recibe enviar_parte(). v2.2: los días fichados llevan también hora_inicio / hora_fin. */
function datosEnvio(clave){
  return Object.entries(semanas[clave].dias).sort(([a],[b])=>a<b?-1:1).map(([fecha, d]) =>
    d.tipo === 'trabajado'
      ? { fecha, tipo:d.tipo, horas_extra:d.horasExtra||0, entradas:d.entradas.map(e=>({obra:e.obra, horas:e.horas})),
          ...(d.horaInicio && d.horaFin ? { hora_inicio:d.horaInicio, hora_fin:d.horaFin } : {}) }
      : { fecha, tipo:d.tipo });
}

/* ================= Semanas guardadas en el servidor =================
   Si el móvil no tiene cambios pendientes de esa semana, se queda con la versión del servidor
   (móvil nuevo, o enviada desde otro dispositivo). Si hay cambios sin enviar, manda el móvil. */
function fusionarServidor(lista){
  let cambio = false;
  for(const p of lista){
    const s = semanas[p.semana];
    const servidor = { version:p.version, enviadoAt:p.enviado_at, modificadoAt:p.modificado_at };
    if(tieneCambiosSinEnviar(s) || cola.some(c=>c.semana===p.semana)) continue;
    if(s?.servidor && s.servidor.version === p.version) continue;
    const dias = {};
    for(const d of p.dias){
      dias[d.fecha] = { tipo:d.tipo, entradas:d.entradas.map(e=>({obra:e.obra, horas:Number(e.horas)})), horasExtra:Number(d.horas_extra)||0 };
      if(d.hora_inicio && d.hora_fin){ dias[d.fecha].horaInicio = d.hora_inicio.slice(0,5); dias[d.fecha].horaFin = d.hora_fin.slice(0,5); }
    }
    const rev = (s?.revLocal||0) + 1;
    semanas[p.semana] = { dias, revLocal:rev, revEnviada:rev, servidor };
    cambio = true;
  }
  if(cambio) guardarSemanas();
  return cambio;
}

/* ================= Datos de la v1 en este móvil =================
   v1 guardaba pv_perfil y pv_semanas. Se copian como semanas sin enviar; nunca se borran.
   Un día con horas extra pero sin obras no se puede migrar (en v2 las extras van en días
   trabajados con obra): se deja fuera y se informa al usuario. */
function datosV1(){
  const sem = cargar('pv_semanas', null);
  if(!sem || !Object.keys(sem).length) return null;
  return { perfil: cargar('pv_perfil', null), semanas: sem };
}
function importarV1(v1){
  const r = { importadas:0, yaExistian:0, omitidos:[] };
  for(const [clave, semV1] of Object.entries(v1.semanas)){
    const dias = {};
    for(const [fIso, d] of Object.entries(semV1.dias||{})){
      const entradas = (d.entradas||[]).map(e=>({obra:String(e.obra), horas:Number(e.horas)}));
      const extras = (d.extras||[]).reduce((a,e)=>a+Number(e.horas),0);
      if(entradas.length) dias[fIso] = { tipo:'trabajado', entradas, horasExtra:extras };
      else if(extras > 0) r.omitidos.push({ fecha:fIso, extras });
    }
    if(!Object.keys(dias).length) continue;
    const s = semanas[clave];
    if(s && (Object.keys(s.dias).length || s.servidor)){ r.yaExistian++; continue; }
    semanas[clave] = { dias, revLocal:1, revEnviada:null, servidor:null };
    r.importadas++;
  }
  guardarSemanas();
  guardar(K.importadoV1(uid), true);
  return r;
}
