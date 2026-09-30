'use strict';
/* ================= Conexión con Supabase =================
   Toda llamada al servidor pasa por aquí. Los errores se convierten en ErrorApi con un
   "tipo" que decide qué hace la app:
     sin_conexion → se reintenta más tarde, sin perder nada
     sesion       → hay que volver a entrar (los datos siguen en el móvil)
     rechazo      → el servidor no acepta los datos; no se reintenta solo
     otro         → error inesperado */

class ErrorApi extends Error {
  constructor(tipo, mensaje, extra){ super(mensaje); this.tipo = tipo; this.extra = extra || {}; }
}

let clienteSb = null;
const apiConfigurada = () => !String(CONFIG.supabaseUrl).includes('PENDIENTE');
const apiDisponible = () => apiConfigurada() && !!window.supabase;

/* Con poca cobertura una petición puede quedarse colgada: se corta a los 20 s. */
function fetchConLimite(url, opciones = {}){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  if(opciones.signal) opciones.signal.addEventListener('abort', () => ctrl.abort());
  return fetch(url, {...opciones, signal: ctrl.signal}).finally(() => clearTimeout(t));
}

function cliente(){
  if(!apiDisponible()) throw new ErrorApi('sin_conexion', 'Sin conexión con el servidor.');
  if(!clienteSb){
    clienteSb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseClaveAnon, {
      auth: { storageKey:K.auth, persistSession:true, autoRefreshToken:true, detectSessionInUrl:false },
      global: { fetch: fetchConLimite }
    });
  }
  return clienteSb;
}

const esErrorDeRed = (error, status) =>
  status === 0 || error?.name === 'AuthRetryableFetchError' || error?.status === 0 ||
  /Failed to fetch|NetworkError|AbortError|Load failed|network/i.test(error?.message || '');

/* ================= Cuentas ================= */
const MENSAJES_AUTH = {
  invalid_credentials: 'Email o contraseña incorrectos.',
  user_already_exists: 'Ya existe una cuenta con ese email. Usa «Entrar».',
  email_exists: 'Ya existe una cuenta con ese email. Usa «Entrar».',
  weak_password: 'La contraseña es demasiado corta (mínimo 6 caracteres).',
  email_address_invalid: 'El email no es válido.',
  validation_failed: 'Revisa el email y la contraseña.',
  over_request_rate_limit: 'Demasiados intentos seguidos. Espera unos minutos.',
  over_email_send_rate_limit: 'Demasiados intentos seguidos. Espera unos minutos.',
  email_not_confirmed: 'Tu cuenta aún no está activada. Avisa al encargado.',
  signup_disabled: 'El registro de cuentas nuevas está desactivado. Avisa al encargado.',
  email_provider_disabled: 'El registro de cuentas nuevas está desactivado. Avisa al encargado.'
};
function errorAuth(error){
  if(esErrorDeRed(error)) return new ErrorApi('sin_conexion', 'Sin conexión. Para entrar o crear la cuenta hace falta cobertura.');
  if(/already registered/i.test(error.message)) return new ErrorApi('rechazo', MENSAJES_AUTH.user_already_exists);
  return new ErrorApi('rechazo', MENSAJES_AUTH[error.code] || ('No se ha podido completar: '+error.message));
}

async function entrar(email, clave){
  const { data, error } = await cliente().auth.signInWithPassword({ email, password: clave });
  if(error) throw errorAuth(error);
  return { uid: data.user.id, email: data.user.email };
}

/* Sin confirmación por email: Supabase devuelve la sesión al registrarse. El perfil lo crea
   el trigger de la base de datos con nombre y apellidos. */
async function registrar(nombre, apellidos, email, clave){
  const { data, error } = await cliente().auth.signUp({ email, password: clave, options: { data: { nombre, apellidos } } });
  if(error) throw errorAuth(error);
  if(!data.session) return entrar(email, clave);
  return { uid: data.user.id, email: data.user.email };
}

/* Cierra la sesión solo en este móvil; no necesita conexión. */
async function salirApi(){
  if(!apiDisponible()) return;
  try{ await cliente().auth.signOut({ scope:'local' }); }catch(e){}
}

/* ================= Datos ================= */
function errorDatos(error, status){
  if(esErrorDeRed(error, status)) return new ErrorApi('sin_conexion', 'Sin conexión.');
  if(status === 401 || /JWT|token/i.test(error.message||'') || error.code === 'PGRST301' || error.code === 'PGRST303')
    return new ErrorApi('sesion', 'Tu sesión ha caducado. Vuelve a entrar para enviar.');
  if(error.code === 'P0001' || /^2[23]/.test(error.code||''))
    return new ErrorApi('rechazo', mensajeRechazo(error), { codigo: error.message, detalle: error.details });
  return new ErrorApi('otro', 'Error del servidor: '+(error.message||status));
}

/* Traduce los rechazos de enviar_parte() a un mensaje claro, indicando el día. */
function mensajeRechazo(error){
  const fIso = /^\d{4}-\d{2}-\d{2}$/.test(error.details||'') ? error.details : null;
  switch(error.message){
    case 'dia_trabajado_sin_horas': return fIso ? textoSinHoras(fIso) : error.hint;
    case 'dia_trabajado_sin_obras': return fIso ? textoSinObras(fIso) : error.hint;
    case 'dia_no_trabajado_con_obras': return (fIso ? diaLargo(fIso)+': ' : '')+'solo los días marcados como Trabajado pueden llevar obras.';
    case 'semana_demasiado_antigua': return 'Esta semana tiene más de 4 meses y ya no se puede enviar. Habla con el encargado.';
    case 'semana_futura': return 'No se puede enviar una semana que todavía no ha empezado.';
    case 'cuenta_no_autorizada': return 'Tu cuenta no está aprobada o está desactivada. Habla con el encargado.';
    case 'fecha_fuera_de_la_semana': return 'Hay un día que no pertenece a esta semana.';
    case 'no_puedes_modificar_tu_propia_cuenta': return 'No puedes aprobar ni desactivar tu propia cuenta.';
    default: return 'El servidor no ha aceptado la semana ('+(error.message||'error desconocido')+').';
  }
}

async function leerPerfil(){
  const { data, error, status } = await cliente().from('profiles').select('*').eq('id', uid).single();
  if(error) throw errorDatos(error, status);
  return data;
}

async function enviarParteApi(semana, dias, envioId){
  const { data, error, status } = await cliente().rpc('enviar_parte', { p_semana: semana, p_dias: dias, p_envio_id: envioId });
  if(error) throw errorDatos(error, status);
  return data;
}

async function leerMisPartes(desde){
  const { data, error, status } = await cliente().rpc('leer_mis_partes', { p_desde: desde });
  if(error) throw errorDatos(error, status);
  return data || [];
}

/* ================= Panel del encargado =================
   El encargado lee todos los perfiles y partes (políticas RLS de schema.sql). */
const CAMPOS_PARTE = 'id,user_id,semana,estado,version,enviado_at,modificado_at,dias(fecha,tipo,horas_extra,entradas(obra,horas,orden))';

async function leerPerfiles(){
  const { data, error, status } = await cliente().from('profiles')
    .select('id,email,nombre,apellidos,role,approved,active,created_at').order('created_at');
  if(error) throw errorDatos(error, status);
  return data;
}

async function leerPartesSemana(semana){
  const { data, error, status } = await cliente().from('partes').select(CAMPOS_PARTE).eq('semana', semana);
  if(error) throw errorDatos(error, status);
  return data;
}

/* Todos los partes de todos los técnicos, por páginas (Supabase devuelve como mucho 1000 filas). */
async function leerTodosLosPartes(){
  const todos = [], paso = 500;
  for(let desde = 0; ; desde += paso){
    const { data, error, status } = await cliente().from('partes').select(CAMPOS_PARTE)
      .order('semana').order('user_id').range(desde, desde + paso - 1);
    if(error) throw errorDatos(error, status);
    todos.push(...data);
    if(data.length < paso) return todos;
  }
}

/* Aprobar / desactivar / reactivar. Solo approved y active se pueden cambiar (schema.sql, sección 7). */
async function cambiarCuenta(id, cambios){
  const { data, error, status } = await cliente().from('profiles').update(cambios).eq('id', id).select();
  if(error) throw errorDatos(error, status);
  if(!data?.length) throw new ErrorApi('rechazo', 'No se ha podido modificar la cuenta (sin permiso).');
  return data[0];
}
