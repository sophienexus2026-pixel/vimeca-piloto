'use strict';
/* ================= v2.2: fichaje y pausas (datos y cálculo) =================
   Eventos: entrada, salida, inicio/fin de descanso, inicio/fin de comida y cambio de obra.
   - Se guardan primero en el móvil (funciona sin cobertura) y se mandan con registrar_fichajes().
     Cada evento lleva un id propio: reintentar no lo duplica.
   - Solo se añaden: una corrección es un evento nuevo con motivo. Si corrige la hora de otro evento,
     correccionDe apunta a él y lo sustituye en los cálculos; el original se queda.
   - Una jornada es la fecha de su entrada (fecha de cada evento). La salida puede pasar la medianoche.

   Regla de horas (confirmada por el cliente):
     trabajado = (salida − entrada) − comida tomada. El descanso cuenta como trabajado.
   Las pausas guardan la duración que estaba en vigor (duracionPrevistaMin): si el encargado la
   cambia, las pausas anteriores conservan la suya. La duración es orientativa: lo que cuenta es la
   hora real de vuelta.

   Al fichar la salida el día pasa al parte de la semana: tipo Trabajado, hora de inicio y fin y una
   obra por cada tramo de «cambio de obra», en medias horas. Las horas extra siguen siendo a mano.

   La parte de cálculo (eventosEfectivos, calcularJornada, repartirHoras…) son funciones puras:
   las prueba herramientas/probar-fichaje.js. */

const TIPOS_FICHAJE = {
  entrada:'Entrada', salida:'Salida',
  inicio_descanso:'Inicio de descanso', fin_descanso:'Fin de descanso',
  inicio_comida:'Inicio de comida', fin_comida:'Fin de comida',
  cambio_obra:'Cambio de obra'
};
const PAUSAS = {
  descanso: { nombre:'Descanso', inicio:'inicio_descanso', fin:'fin_descanso', cuenta:true,  min:5,  max:60 },
  comida:   { nombre:'Comida',   inicio:'inicio_comida',   fin:'fin_comida',   cuenta:false, min:15, max:120 }
};
const PASO_PAUSAS = 5;
const AJUSTES_PAUSAS_INICIALES = { descanso_min:15, comida_min:60, modificado_por:null, modificado_at:null };
const HORAS_JORNADA_ABIERTA = 16;      // una entrada sin salida de hace más de 16 h es un olvido
const MOTIVOS_SUGERIDOS = ['Olvidé fichar la salida', 'Olvidé fichar la entrada', 'Fiché a una hora equivocada', 'Olvidé fichar la vuelta de la pausa'];

const msDe = h => new Date(h).getTime();
const hhmm = h => { const d = new Date(h); return p2(d.getHours())+':'+p2(d.getMinutes()); };

/* "1 h", "45 min", "3 h 05 min" */
function fmtMinutos(min){
  const m = Math.round(min);
  if(m < 60) return m+' min';
  return Math.floor(m/60)+' h'+(m%60 ? ' '+p2(m%60)+' min' : '');
}

/* ================= Cálculo (funciones puras) ================= */

/* Eventos que valen, ordenados por hora. Cada corrección con correccionDe sustituye a su original;
   si hay varias, vale la más reciente (la última guardada en el servidor o, sin guardar, la última
   creada en el móvil). Los eventos rechazados por el servidor no cuentan. */
function eventosEfectivos(lista){
  const validos = lista.filter(e => e.estado !== 'rechazado');
  const orden = new Map(validos.map((e,i) => [e.id, i]));
  const reciente = (a,b) => {
    const ra = a.recibidoEn ? msDe(a.recibidoEn) : Infinity, rb = b.recibidoEn ? msDe(b.recibidoEn) : Infinity;
    return ra !== rb ? ra - rb : orden.get(a.id) - orden.get(b.id);
  };
  const sustituto = new Map();
  for(const e of validos.filter(e => e.correccionDe).sort(reciente)) sustituto.set(e.correccionDe, e);
  return validos
    .filter(e => !e.correccionDe)
    .map(e => sustituto.has(e.id) ? { ...sustituto.get(e.id), original:e } : e)
    .sort((a,b) => msDe(a.hora) - msDe(b.hora) || orden.get(a.id) - orden.get(b.id));
}

/* Minutos de [a,b] que caen dentro de los intervalos dados. */
function solape(a, b, intervalos){
  let ms = 0;
  for(const [x,y] of intervalos) ms += Math.max(0, Math.min(b,y) - Math.max(a,x));
  return ms;
}

/* Resumen de una jornada a partir de sus eventos efectivos (los de una fecha).
   ahora (ms): hasta dónde contar una jornada o una pausa abiertas. */
function calcularJornada(eventos, ahora){
  const entrada = eventos.find(e => e.tipo === 'entrada') || null;
  const salida = entrada ? [...eventos].reverse().find(e => e.tipo === 'salida' && msDe(e.hora) >= msDe(entrada.hora)) || null : null;
  const r = { estado:'fuera', entrada, salida, pausas:[], obras:[], obraActual:null,
              trabajadoMin:0, descansoMin:0, comidaMin:0, corregida:false, motivos:[] };
  for(const e of eventos) if(e.motivo && !r.motivos.includes(e.motivo)) r.motivos.push(e.motivo);
  r.corregida = r.motivos.length > 0;
  if(!entrada) return r;

  const t0 = msDe(entrada.hora);
  const t1 = salida ? msDe(salida.hora) : Math.max(t0, ahora);

  // Pausas: cada inicio con el primer fin de su tipo que venga después. Sin fin: abierta hasta la
  // salida (o hasta ahora).
  for(const [clase, p] of Object.entries(PAUSAS)){
    const usados = new Set();
    for(const ini of eventos.filter(e => e.tipo === p.inicio)){
      const fin = eventos.find(e => e.tipo === p.fin && !usados.has(e.id) && msDe(e.hora) >= msDe(ini.hora)) || null;
      if(fin) usados.add(fin.id);
      const desde = Math.max(t0, msDe(ini.hora)), hasta = Math.min(t1, fin ? msDe(fin.hora) : t1);
      r.pausas.push({ clase, inicio:ini, fin, abierta:!fin && !salida,
        prevista:ini.duracionPrevistaMin || null, desde, hasta:Math.max(desde, hasta) });
    }
  }
  r.pausas.sort((a,b) => a.desde - b.desde);
  const comidas = r.pausas.filter(p => p.clase === 'comida').map(p => [p.desde, p.hasta]);
  r.comidaMin = solape(t0, t1, comidas) / 60000;
  r.descansoMin = solape(t0, t1, r.pausas.filter(p => p.clase === 'descanso').map(p => [p.desde, p.hasta])) / 60000;
  r.trabajadoMin = Math.max(0, (t1 - t0) / 60000 - r.comidaMin);

  // Tramos de obra: la de la entrada y cada cambio de obra, hasta el siguiente o hasta el final.
  const puntos = [entrada, ...eventos.filter(e => e.tipo === 'cambio_obra' && msDe(e.hora) >= t0 && msDe(e.hora) <= t1)];
  const porObra = new Map();
  puntos.forEach((p, i) => {
    const a = msDe(p.hora), b = i+1 < puntos.length ? msDe(puntos[i+1].hora) : t1;
    const min = Math.max(0, (b - a - solape(a, b, comidas)) / 60000);
    const obra = (p.obra || '').trim() || 'Sin obra';
    porObra.set(obra, (porObra.get(obra) || 0) + min);
  });
  r.obras = [...porObra].map(([obra, min]) => ({ obra, min }));
  r.obraActual = (puntos[puntos.length-1].obra || '').trim() || null;

  const abierta = r.pausas.find(p => p.abierta);
  r.estado = salida ? 'terminada' : abierta ? abierta.clase : 'servicio';
  r.pausaAbierta = abierta || null;
  return r;
}

/* Minutos de cada obra → horas en medias horas. El total se redondea a la media hora más próxima
   (7 h 44 → 7,5; 7 h 45 → 8) y se reparte entre las obras por el método del mayor resto, para que
   la suma de las obras sea siempre el total redondeado. Las obras que se quedan en 0 no se ponen
   (salvo que todo sea 0: entonces queda la primera, y el envío pedirá revisar ese día). */
function repartirHoras(obras){
  if(!obras.length) return [];
  const totalMedias = Math.round(obras.reduce((a,o) => a + o.min, 0) / 30);
  const filas = obras.map((o,i) => ({ obra:o.obra, i, medias:Math.floor(o.min/30), resto:o.min/30 - Math.floor(o.min/30) }));
  let faltan = totalMedias - filas.reduce((a,f) => a + f.medias, 0);
  for(const f of [...filas].sort((a,b) => b.resto - a.resto || a.i - b.i)){
    if(faltan <= 0) break;
    f.medias++; faltan--;
  }
  const conHoras = filas.filter(f => f.medias > 0);
  return (conHoras.length ? conHoras : filas.slice(0,1)).map(f => ({ obra:f.obra, horas:f.medias/2 }));
}

/* ¿Tienen sentido los eventos en este orden? entrada → (pausas y cambios de obra) → salida, sin
   pausas cruzadas. Devuelve null si cuadra o un texto que explica el problema. Se usa antes de
   guardar una corrección. */
function ordenNoValido(eventos){
  let estado = 'fuera', pausa = null;
  const nombre = e => TIPOS_FICHAJE[e.tipo].toLowerCase()+' ('+hhmm(e.hora)+')';
  for(const e of eventos){
    const t = e.tipo;
    if(estado === 'fuera'){
      if(t !== 'entrada') return 'hay un fichaje, '+nombre(e)+', antes de la entrada.';
      estado = 'servicio';
    } else if(estado === 'terminada'){
      return 'hay un fichaje, '+nombre(e)+', después de la salida.';
    } else if(estado === 'servicio'){
      if(t === 'salida') estado = 'terminada';
      else if(t === 'inicio_descanso' || t === 'inicio_comida'){ estado = 'pausa'; pausa = t.slice(7); }
      else if(t === 'entrada') return 'hay dos entradas en la misma jornada.';
      else if(t !== 'cambio_obra') return 'el '+nombre(e)+' no tiene su inicio antes.';
    } else {
      if(t === 'fin_'+pausa){ estado = 'servicio'; pausa = null; }
      else if(t === 'salida') estado = 'terminada';            // la pausa termina con la salida
      else return 'el '+nombre(e)+' queda en medio de la pausa de '+pausa+'.';
    }
  }
  return null;
}

/* Lo que el fichaje pone en el parte para una jornada terminada. */
function diaDesdeJornada(j){
  return { tipo:'trabajado', entradas:repartirHoras(j.obras), horaInicio:hhmm(j.entrada.hora), horaFin:hhmm(j.salida.hora) };
}
const firmaDia = d => JSON.stringify([d.tipo, (d.entradas||[]).map(e => [e.obra, e.horas]), d.horaInicio||null, d.horaFin||null]);

/* Eventos efectivos agrupados por fecha de jornada. */
function jornadasPorFecha(lista){
  const mapa = new Map();
  for(const e of eventosEfectivos(lista)){
    if(!mapa.has(e.fecha)) mapa.set(e.fecha, []);
    mapa.get(e.fecha).push(e);
  }
  return mapa;
}

/* La jornada que se muestra en «Fichar»: una abierta reciente (también la de ayer si la salida pasa
   la medianoche) o, si no, la de hoy. Las abiertas más antiguas son olvidos: van en sinCerrar. */
function situacionFichaje(lista, ahora, hoyIso){
  const mapa = jornadasPorFecha(lista);
  let actual = null;
  const sinCerrar = [];
  for(const fecha of [...mapa.keys()].sort().reverse()){
    const j = calcularJornada(mapa.get(fecha), ahora);
    if(!j.entrada || j.salida) continue;
    if(!actual && ahora - msDe(j.entrada.hora) < HORAS_JORNADA_ABIERTA*3600000) actual = { fecha, j };
    else sinCerrar.push({ fecha, j });
  }
  if(!actual) actual = { fecha:hoyIso, j:calcularJornada(mapa.get(hoyIso) || [], ahora) };
  return { ...actual, sinCerrar:sinCerrar.filter(s => s.fecha !== actual.fecha) };
}

/* ================= En el móvil ================= */
function ajustesPausas(){ return { ...AJUSTES_PAUSAS_INICIALES, ...cargar(K.ajustesPausas, {}) }; }
function guardarAjustesPausas(a){ if(a) guardar(K.ajustesPausas, { descanso_min:a.descanso_min, comida_min:a.comida_min, modificado_por:a.modificado_por||null, modificado_at:a.modificado_at||null }); }

const situacionActual = () => situacionFichaje(fichajes, Date.now(), iso(HOY()));
const jornadaDe = fecha => calcularJornada(eventosEfectivos(fichajes.filter(e => e.fecha === fecha)), Date.now());
const hayFichajes = fecha => fichajes.some(e => e.fecha === fecha && e.estado !== 'rechazado');

function anadirFichaje(tipo, datos){
  const e = { id:nuevoId(), fecha:datos.fecha, tipo, hora:datos.hora || new Date().toISOString(),
    obra:datos.obra || null, duracionPrevistaMin:datos.duracionPrevistaMin || null,
    correccionDe:datos.correccionDe || null, motivo:datos.motivo || null,
    estado:'pendiente', error:null, recibidoEn:null, relojDesfasado:false };
  fichajes.push(e);
  guardarFichajes();
  return e;
}

/* Obras recientes primero: fichajes y semanas, de lo más nuevo a lo más viejo. */
function obrasRecientes(){
  const vistas = new Map();
  const ver = (obra, cuando) => { obra = (obra||'').trim(); if(obra && !(vistas.get(obra) >= cuando)) vistas.set(obra, cuando); };
  for(const e of fichajes) if(e.obra) ver(e.obra, msDe(e.hora));
  for(const s of Object.values(semanas)) for(const [f, d] of Object.entries(s.dias)) for(const en of d.entradas||[]) ver(en.obra, deIso(f).getTime());
  return [...vistas].sort((a,b) => b[1] - a[1]).map(([o]) => o);
}

/* ================= Del fichaje al parte de la semana =================
   Si el día está vacío o tiene exactamente lo que puso el fichaje la última vez, se rellena solo.
   Si el técnico ya había apuntado otra cosa, devuelve { pregunta } y la pantalla le pregunta. */
function propuestaParte(fecha){
  const j = jornadaDe(fecha);
  if(!j.entrada || !j.salida) return null;
  const clave = iso(lunesDe(deIso(fecha)));
  const nuevo = diaDesdeJornada(j);
  const actual = diaDe(clave, fecha);
  const igual = actual && firmaDia(actual) === firmaDia(nuevo);
  const libre = !actual || (actual.tipo === 'trabajado' && !actual.entradas.length) || (actual.firmaFichaje && actual.firmaFichaje === firmaDia(actual));
  return { clave, fecha, nuevo, actual, igual, pregunta: !igual && !libre };
}
function aplicarPropuesta(p){
  if(!p || p.igual || !esEditable(p.clave)) return false;
  const s = semanaObj(p.clave);
  s.dias[p.fecha] = { ...p.nuevo, horasExtra: p.actual?.tipo === 'trabajado' ? (p.actual.horasExtra||0) : 0, firmaFichaje: firmaDia(p.nuevo) };
  tocarSemana(p.clave);
  return true;
}

/* ================= Envío al servidor =================
   Igual que las semanas: se intenta al fichar, al volver la conexión, al volver a la app y cada
   minuto mientras quede algo. Un evento que el servidor rechaza no se reintenta: se avisa. */
let promesaFichajes = null, temporizadorFichajes = null;
const fichajesPendientes = () => fichajes.filter(e => e.estado === 'pendiente');
const fichajesRechazados = () => fichajes.filter(e => e.estado === 'rechazado');

const aServidor = e => ({ id:e.id, fecha:e.fecha, tipo:e.tipo, hora:e.hora, obra:e.obra,
  duracion_prevista_min:e.duracionPrevistaMin, correccion_de:e.correccionDe, motivo:e.motivo });

const MENSAJES_FICHAJE = {
  fecha_no_valida: 'la fecha está fuera de plazo',
  hora_no_valida: 'la hora no corresponde a ese día',
  duracion_no_valida: 'la duración de la pausa no es válida',
  falta_motivo: 'falta el motivo de la corrección',
  correccion_no_valida: 'no se puede corregir ese fichaje',
  fichaje_incompleto: 'faltan datos',
  fichaje_no_valido: 'no es válido'
};

async function sincronizarFichajes(){
  while(promesaFichajes) await promesaFichajes.catch(() => {});
  promesaFichajes = sincronizarFichajesUnaVez();
  try{ return await promesaFichajes; } finally { promesaFichajes = null; }
}

async function sincronizarFichajesUnaVez(){
  const r = { guardados:0, rechazados:0, error:null };
  const lote = fichajesPendientes().slice(0, 200);
  if(!uid || !lote.length) return r;
  if(!apiDisponible() || navigator.onLine === false){ r.error = new ErrorApi('sin_conexion','Sin conexión.'); programarFichajes(); return r; }
  const uidInicial = uid;
  try{
    const res = await registrarFichajesApi(lote.map(aServidor), new Date().toISOString());
    if(uid !== uidInicial) return r;
    for(const x of res){
      const e = fichajes.find(f => f.id === x.id);
      if(!e) continue;
      if(x.ok){ e.estado = 'guardado'; e.recibidoEn = x.recibido_en; e.relojDesfasado = !!x.reloj_desfasado; r.guardados++; }
      else { e.estado = 'rechazado'; e.error = MENSAJES_FICHAJE[x.error] || x.error || 'no es válido'; r.rechazados++; }
    }
    guardarFichajes();
  }catch(e){
    r.error = e instanceof ErrorApi ? e : new ErrorApi('sin_conexion', String(e?.message||e));
    if(r.error.tipo === 'sesion') marcarSesionCaducada();
  }finally{
    programarFichajes();
    if(typeof alCambiarFichajes === 'function') alCambiarFichajes(r);
  }
  return r;
}

function programarFichajes(){
  clearInterval(temporizadorFichajes); temporizadorFichajes = null;
  if(uid && fichajesPendientes().length) temporizadorFichajes = setInterval(sincronizarFichajes, 60000);
}

/* Fichajes guardados en el servidor que este móvil no tiene (móvil nuevo, otro dispositivo). */
function fusionarFichajesServidor(lista){
  const tengo = new Set(fichajes.map(e => e.id));
  const nuevos = lista.filter(x => !tengo.has(x.id)).map(x => ({
    id:x.id, fecha:x.fecha, tipo:x.tipo, hora:new Date(x.hora).toISOString(), obra:x.obra,
    duracionPrevistaMin:x.duracion_prevista_min, correccionDe:x.correccion_de, motivo:x.motivo,
    estado:'guardado', error:null, recibidoEn:x.recibido_en, relojDesfasado:!!x.reloj_desfasado }));
  if(!nuevos.length) return false;
  fichajes = [...nuevos, ...fichajes];
  guardarFichajes();
  return true;
}

/* Fichajes del servidor (encargado) con la misma forma que en el móvil, para usar los cálculos. */
const fichajeDeServidor = x => ({ id:x.id, fecha:x.fecha, tipo:x.tipo, hora:new Date(x.hora).toISOString(), obra:x.obra,
  duracionPrevistaMin:x.duracion_prevista_min, correccionDe:x.correccion_de, motivo:x.motivo,
  estado:'guardado', recibidoEn:x.recibido_en, relojDesfasado:!!x.reloj_desfasado, userId:x.user_id });

/* { user_id: { fecha: jornada } } para el panel y las exportaciones. */
function jornadasPorUsuario(listaServidor, ahora = Date.now()){
  const porUsuario = new Map();
  for(const x of listaServidor){
    if(!porUsuario.has(x.user_id)) porUsuario.set(x.user_id, []);
    porUsuario.get(x.user_id).push(fichajeDeServidor(x));
  }
  const salida = {};
  for(const [u, lista] of porUsuario){
    salida[u] = {};
    for(const [fecha, ev] of jornadasPorFecha(lista)) salida[u][fecha] = calcularJornada(ev, ahora);
  }
  return salida;
}
