'use strict';
/* ================= Cola de envíos =================
   Enviar = guardar una copia de la semana en la cola (en el móvil) y probar a mandarla.
   Si no hay cobertura se queda en la cola y se reintenta sola: al abrir la app, al volver
   la conexión, al volver a la app y cada minuto mientras quede algo pendiente.
   Cada intento repite el mismo envioId, así que si el servidor ya la había guardado
   (se perdió la respuesta) no cuenta como modificación. */

let promesaCola = null;
let temporizadorCola = null;

function nuevoId(){
  if(window.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}

const pendientesEnCola = () => cola.filter(c => !c.rechazo);

/* Pone la semana en la cola (sustituyendo un envío anterior de la misma semana) y la intenta mandar. */
async function encolarEnvio(clave){
  const s = semanas[clave];
  const item = {
    semana: clave, envioId: nuevoId(), datos: datosEnvio(clave), revLocal: s.revLocal,
    encoladoAt: new Date().toISOString(), intentos: 0, ultimoError: null, rechazo: null
  };
  cola = cola.filter(c => c.semana !== clave).concat(item);
  if(!guardarCola()) return { estado:'error_local' };
  const r = await procesarCola();
  if(r.enviadas.includes(clave)) return { estado:'enviada' };
  const actual = cola.find(c => c.envioId === item.envioId);
  if(actual?.rechazo) return { estado:'rechazada', mensaje: actual.rechazo };
  if(r.error?.tipo === 'sesion') return { estado:'sesion', mensaje: r.error.message };
  return { estado:'en_cola' };
}

/* Si ya hay una pasada en marcha, espera a que termine y hace otra: así un envío recién
   encolado no se queda esperando al siguiente reintento. */
async function procesarCola(){
  while(promesaCola) await promesaCola.catch(() => {});
  promesaCola = procesarColaUnaVez();
  try{ return await promesaCola; } finally { promesaCola = null; }
}

async function procesarColaUnaVez(){
  const r = { enviadas:[], rechazadas:[], error:null };
  if(!uid || !pendientesEnCola().length) return r;
  if(!apiDisponible() || navigator.onLine === false){ r.error = new ErrorApi('sin_conexion','Sin conexión.'); return r; }
  const uidInicial = uid;
  try{
    for(const item of pendientesEnCola()){
      try{
        const res = await enviarParteApi(item.semana, item.datos, item.envioId);
        if(uid !== uidInicial) break;   // se cerró la sesión mientras tanto
        // Confirmado por el servidor: ahora sí se marca como enviada y sale de la cola.
        const s = semanaObj(item.semana);
        s.revEnviada = item.revLocal;
        s.servidor = { version: res.version, enviadoAt: res.enviado_at, modificadoAt: res.modificado_at };
        guardarSemanas();
        cola = cola.filter(c => c.envioId !== item.envioId);
        guardarCola();
        r.enviadas.push(item.semana);
      }catch(e){
        const err = e instanceof ErrorApi ? e : new ErrorApi('sin_conexion', String(e?.message||e));
        item.intentos++;
        item.ultimoError = err.tipo;
        if(err.tipo === 'rechazo'){ item.rechazo = err.message; r.rechazadas.push(item.semana); }
        guardarCola();
        if(err.tipo !== 'rechazo'){ r.error = err; break; }
      }
    }
  } finally {
    programarReintento();
    if(r.error?.tipo === 'sesion') marcarSesionCaducada();
    alCambiarCola(r);
  }
  return r;
}

function programarReintento(){
  clearInterval(temporizadorCola); temporizadorCola = null;
  if(uid && pendientesEnCola().length) temporizadorCola = setInterval(procesarCola, 60000);
}

window.addEventListener('online', () => { procesarCola(); refrescarDesdeServidor(); });
