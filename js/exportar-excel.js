'use strict';
/* ================= Exportar a Excel (encargado) =================
   Sustituye a la exportación CSV: el CSV con «;» se abría con todo en la columna A en los visores
   de Android. Genera un .xlsx con tres hojas:
     Resumen   una fila por técnico (y semana, en la exportación completa), horas de cada día,
               normales, extra, total y estado, más la fila TOTAL EQUIPO con fórmulas
     Detalle   una fila por obra; los días sin obras (vacaciones, baja…) llevan una fila con su tipo
     Técnicos  nombre, email, teléfono, DNI/NIF, alta y si está activo
   Los desactivados se incluyen siempre, marcados «Desactivado»: es el registro de jornada.
   Solo funciones puras (sin pantalla): las usa panel.js y las prueba herramientas/probar-excel.js. */

const nombreCompleto = u => u.nombre+' '+u.apellidos;

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

const ETIQUETA_EXCEL = { vacaciones:'VAC', baja:'BAJA', festivo:'FEST', sin_trabajo:'S/T' };
const DIAS_EXCEL = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const fechaBarras = d => fmtCorta(d).replace(/-/g,'/');
const fechaHoraBarras = ts => fmtFechaHora(ts).replace(/-/g,'/');
const redondear = n => Math.round(n*100)/100;
const nombreExcel = u => nombreCompleto(u) + (u.active ? '' : ' (Desactivado)');
const porNombre = (a,b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es');

function estadoExcel(p){
  if(!p) return 'Pendiente';
  return p.version > 1 ? 'Modificado '+fechaHoraBarras(p.modificado_at) : 'Enviado';
}
const fechaDe = ts => ts ? new Date(ts) : null;

/* Fila de una semana de un técnico: celdas de los 7 días (número de horas o tipo) y totales. */
function resumenParte(parte, lunes){
  const dias = diasDeParte(parte);
  let normales = 0, extras = 0;
  const celdas = diasSemana(deIso(lunes)).map(d => {
    const dd = dias[iso(d)];
    if(!dd) return '—';
    if(dd.tipo !== 'trabajado') return ETIQUETA_EXCEL[dd.tipo];
    const n = horasDia(dd), x = extrasDia(dd);
    normales += n; extras += x;
    return redondear(n + x);
  });
  return { celdas, normales: redondear(normales), extras: redondear(extras) };
}

/* ---------- Hoja Resumen ---------- */
function hojaResumen(filas, titulo, conSemana, dias){
  const cab = ['Técnico', ...(conSemana ? ['Semana'] : []),
    ...DIAS_EXCEL.map((n,i) => dias ? n+' '+fmtDM(dias[i]) : n),
    'Horas normales', 'Horas extra', 'Total', 'Estado'];
  const c0 = conSemana ? 2 : 1;                         // primera columna de días
  const cN = c0 + 7, cX = cN + 1, cT = cX + 1;           // normales, extra, total
  const L = letraColumna;
  const PRIMERA = 6;                                     // fila de Excel del primer técnico
  const salida = [
    [{ v:CONFIG.empresa.nombre, estilo:'titulo' }],
    [{ v:'NIF: '+CONFIG.empresa.nif, estilo:'subtitulo' }],
    [{ v:titulo, estilo:'negrita' }],
    [],
    cab.map(v => ({ v, estilo:'cabecera' }))
  ];
  filas.forEach((f, i) => {
    const r = PRIMERA + i;
    salida.push([
      nombreExcel(f.usuario),
      ...(conSemana ? [{ v:deIso(f.semana), tipo:'fecha' }] : []),
      ...f.celdas.map(v => ({ v, estilo:'centro' })),
      f.normales, f.extras,
      { v:redondear(f.normales + f.extras), f:L(cN)+r+'+'+L(cX)+r },
      f.estado
    ]);
  });
  const ultima = PRIMERA + filas.length - 1;
  const suma = (col, valor, estilo = 'total') => filas.length
    ? { v:redondear(valor), f:'SUBTOTAL(9,'+L(col)+PRIMERA+':'+L(col)+ultima+')', estilo }
    : { v:0, estilo };
  const total = [{ v:'TOTAL EQUIPO', estilo:'total' }];
  if(conSemana) total.push({ v:'', estilo:'total' });
  for(let d = 0; d < 7; d++){
    const valor = filas.reduce((a,f) => a + (typeof f.celdas[d] === 'number' ? f.celdas[d] : 0), 0);
    total.push(suma(c0 + d, valor, 'totalCentro'));
  }
  const tN = filas.reduce((a,f)=>a+f.normales,0), tX = filas.reduce((a,f)=>a+f.extras,0);
  total.push(suma(cN, tN), suma(cX, tX), suma(cT, tN + tX), { v:'', estilo:'total' });
  salida.push(total, [],
    [{ v:'Horas de cada día = normales + extra. VAC Vacaciones · BAJA Baja · FEST Festivo · S/T Sin trabajo · — Sin rellenar.', estilo:'nota' }],
    [{ v:'Los totales suman solo las filas visibles si se filtra. El detalle por obra está en la hoja «Detalle».', estilo:'nota' }]);
  return {
    nombre:'Resumen', filas:salida,
    anchos:[42, ...(conSemana ? [12] : []), ...Array(7).fill(conSemana ? 7 : 10), 15, 13, 10, 30],
    congelar:{ filas:5, columnas:1 }, horizontal:true,
    filtro: filas.length ? { desde:5, hasta:ultima, columnas:cab.length } : null
  };
}

/* ---------- Hoja Detalle ---------- */
function hojaDetalle(partes, porId, conSemana){
  const cab = ['Técnico', ...(conSemana ? ['Semana'] : []), 'Fecha', 'Día', 'Tipo de día', 'Obra', 'Horas', 'Horas extra', 'Estado', 'Enviado el', 'Modificado el'];
  const salida = [cab.map(v => ({ v, estilo:'cabecera' }))];
  let tH = 0, tX = 0;
  for(const p of partes){
    const u = porId.get(p.user_id);
    const comun = [u ? nombreExcel(u) : p.user_id, ...(conSemana ? [{ v:deIso(p.semana), tipo:'fecha' }] : [])];
    const cola = [estadoExcel(p), { v:fechaDe(p.enviado_at), tipo:'fechaHora' }, { v:fechaDe(p.modificado_at), tipo:'fechaHora' }];
    for(const [fIso, dd] of Object.entries(diasDeParte(p)).sort(([a],[b]) => a<b ? -1 : 1)){
      const f = deIso(fIso);
      const base = [...comun, { v:f, tipo:'fecha' }, DIAS[(f.getDay()+6)%7], TIPOS[dd.tipo]];
      if(dd.tipo !== 'trabajado' || !dd.entradas.length){
        salida.push([...base, '', 0, dd.tipo === 'trabajado' ? dd.horasExtra : 0, ...cola]);
        if(dd.tipo === 'trabajado') tX += dd.horasExtra;
        continue;
      }
      // Las extras del día van en la primera obra (0 en las demás) para no contarlas dos veces.
      dd.entradas.forEach((e, i) => {
        const x = i === 0 ? dd.horasExtra : 0;
        tH += e.horas; tX += x;
        salida.push([...base, e.obra, e.horas, x, ...cola]);
      });
    }
  }
  const ultima = salida.length;                          // fila de Excel de la última línea
  const cH = cab.indexOf('Horas'), cX = cab.indexOf('Horas extra');
  if(ultima > 1){
    const fila = cab.map(() => ({ v:'', estilo:'total' }));
    fila[0] = { v:'TOTAL', estilo:'total' };
    fila[cH] = { v:redondear(tH), f:'SUBTOTAL(9,'+letraColumna(cH)+'2:'+letraColumna(cH)+ultima+')', estilo:'total' };
    fila[cX] = { v:redondear(tX), f:'SUBTOTAL(9,'+letraColumna(cX)+'2:'+letraColumna(cX)+ultima+')', estilo:'total' };
    salida.push(fila);
  }
  return {
    nombre:'Detalle', filas:salida,
    anchos:[42, ...(conSemana ? [12] : []), 12, 11, 13, 34, 8, 11, 28, 17, 17],
    congelar:{ filas:1, columnas:1 }, horizontal:true,
    filtro: ultima > 1 ? { desde:1, hasta:ultima, columnas:cab.length } : null
  };
}

/* ---------- Hoja Técnicos ---------- */
function hojaTecnicos(perfiles){
  const cab = ['Nombre', 'Email', 'Teléfono', 'DNI/NIF', 'Alta', 'Activo'];
  const lista = perfiles.filter(u => u.role === 'tecnico').sort(porNombre);
  const salida = [cab.map(v => ({ v, estilo:'cabecera' }))];
  for(const u of lista){
    salida.push([nombreCompleto(u), u.email || '', u.telefono || '', u.dni_nif || '',
      { v:fechaDe(u.created_at), tipo:'fecha' },
      !u.active ? 'No (Desactivado)' : !u.approved ? 'Pendiente de aprobación' : 'Sí']);
  }
  return {
    nombre:'Técnicos', filas:salida, anchos:[34, 32, 17, 12, 12, 24],
    congelar:{ filas:1, columnas:1 },
    filtro: lista.length ? { desde:1, hasta:lista.length + 1, columnas:cab.length } : null
  };
}

/* Una semana: todos los técnicos aprobados (también los pendientes de enviar) y los
   desactivados que enviaron algo esa semana. Misma lista que el PDF. */
function hojasExcelSemana(perfiles, partes, semana){
  const porUsuario = new Map(partes.map(p => [p.user_id, p]));
  const porId = new Map(perfiles.map(u => [u.id, u]));
  const filas = perfiles
    .filter(u => u.role === 'tecnico' && u.approved && (u.active || porUsuario.has(u.id)))
    .sort(porNombre)
    .map(u => { const p = porUsuario.get(u.id); return { usuario:u, ...resumenParte(p, semana), estado:estadoExcel(p) }; });
  const dias = diasSemana(deIso(semana));
  const ordenados = [...partes].sort((a,b) => porNombre(porId.get(a.user_id) || {nombre:'',apellidos:''}, porId.get(b.user_id) || {nombre:'',apellidos:''}));
  return [
    hojaResumen(filas, 'Semana '+fechaBarras(dias[0])+' al '+fechaBarras(dias[6]), false, dias),
    hojaDetalle(ordenados, porId, false),
    hojaTecnicos(perfiles)
  ];
}

/* Todo lo enviado: una fila por técnico y semana, de la más antigua a la más reciente. */
function hojasExcelCompleto(perfiles, partes, ahora = new Date()){
  const porId = new Map(perfiles.map(u => [u.id, u]));
  const nadie = { nombre:'', apellidos:'' };
  const ordenados = [...partes].sort((a,b) => a.semana < b.semana ? -1 : a.semana > b.semana ? 1
    : porNombre(porId.get(a.user_id) || nadie, porId.get(b.user_id) || nadie));
  const filas = ordenados.map(p => ({
    usuario: porId.get(p.user_id) || { nombre:p.user_id, apellidos:'', active:true },
    semana: p.semana, ...resumenParte(p, p.semana), estado: estadoExcel(p)
  }));
  const titulo = ordenados.length
    ? 'Todos los partes enviados: semanas del '+fechaBarras(deIso(ordenados[0].semana))+' al '+fechaBarras(diasSemana(deIso(ordenados[ordenados.length-1].semana))[6])
      +' · exportado el '+fechaHoraBarras(ahora)
    : 'Todavía no hay partes enviados · exportado el '+fechaHoraBarras(ahora);
  return [hojaResumen(filas, titulo, true, null), hojaDetalle(ordenados, porId, true), hojaTecnicos(perfiles)];
}
