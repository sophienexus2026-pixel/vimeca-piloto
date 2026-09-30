'use strict';
/* ================= Utilidades de fechas (v1) ================= */
const DIAS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const p2 = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const deIso = s => { const [a,m,d]=s.split('-').map(Number); return new Date(a,m-1,d); };
const fmtCorta = d => p2(d.getDate())+'-'+p2(d.getMonth()+1)+'-'+d.getFullYear();
const fmtDM = d => p2(d.getDate())+'/'+p2(d.getMonth()+1);
function lunesDe(d){ const x=new Date(d); const dia=(x.getDay()+6)%7; x.setDate(x.getDate()-dia); x.setHours(0,0,0,0); return x; }
function diasSemana(lunes){ return Array.from({length:7},(_,i)=>{ const d=new Date(lunes); d.setDate(d.getDate()+i); return d; }); }
function fmtHoras(n){ return (Math.round(n*100)/100).toString().replace('.',',')+' h'; }

const HOY = () => new Date();
const claveActual = () => iso(lunesDe(HOY()));

/* ================= v2: semanas editables (últimos 4 meses) ================= */

/* Resta meses como Postgres ("interval '4 months'"): si el día no existe en el mes
   de destino, se queda en el último día de ese mes (30-06 → 28-02). */
function restarMeses(d, n){
  const x = new Date(d.getFullYear(), d.getMonth()-n, 1);
  const ultimo = new Date(x.getFullYear(), x.getMonth()+1, 0).getDate();
  x.setDate(Math.min(d.getDate(), ultimo));
  return x;
}
/* Misma regla que public.lunes_mas_antiguo_editable() en la base de datos. */
const claveMasAntigua = () => iso(lunesDe(restarMeses(HOY(), 4)));
const esEditable = clave => clave >= claveMasAntigua() && clave <= claveActual();

function sumarSemanas(clave, n){ const d=deIso(clave); d.setDate(d.getDate()+7*n); return iso(d); }

/* Lunes de las semanas editables, de la actual hacia atrás. */
function clavesEditables(){
  const lista=[], tope=claveMasAntigua();
  for(let k=claveActual(); k>=tope; k=sumarSemanas(k,-1)) lista.push(k);
  return lista;
}

/* "Martes 14-07-2026" a partir de "2026-07-14". */
function diaLargo(fIso){ const d=deIso(fIso); return DIAS[(d.getDay()+6)%7]+' '+fmtCorta(d); }
function rangoSemana(clave){ const d=diasSemana(deIso(clave)); return fmtDM(d[0])+' al '+fmtDM(d[6])+'/'+d[6].getFullYear(); }
/* "14-07-2026 17:30" a partir de una marca de tiempo del servidor. */
function fmtFechaHora(ts){ const d=new Date(ts); return fmtCorta(d)+' '+p2(d.getHours())+':'+p2(d.getMinutes()); }
