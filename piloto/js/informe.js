'use strict';
/* ================= Informe imprimible (PDF) del técnico =================
   Misma maqueta que v1. v2 añade los tipos de día (Vacaciones, Baja…) en la fila TOTAL DÍA
   y en TRABAJOS REALIZADOS, y el pie aprobado con la fecha de generación. */

const pieInforme = () => 'Parte generado el '+fmtCorta(HOY())+' · © 2026 SophieNexus · Todos los derechos reservados';

function construirInforme(clave){
  const dias=diasSemana(deIso(clave));
  const sem=semanas[clave]||{dias:{}};
  const emp=CONFIG.empresa;
  // Obras únicas de la semana
  const obras=[];
  dias.forEach(d=>{ const dd=sem.dias[iso(d)]; (dd?.entradas||[]).forEach(e=>{ if(!obras.includes(e.obra)) obras.push(e.obra); }); });

  let filas='';
  obras.forEach(o=>{
    let tot=0;
    const celdas=dias.map(d=>{
      const dd=sem.dias[iso(d)];
      const h=(dd?.entradas||[]).filter(e=>e.obra===o).reduce((a,e)=>a+e.horas,0);
      const hay=(dd?.entradas||[]).some(e=>e.obra===o);
      tot+=h;
      return '<td>'+(hay? fmtHoras(h).replace(' h','H'):'')+'</td>';
    }).join('');
    filas+='<tr><td class="obra">'+escapar(o)+'</td>'+celdas+'<td><b>'+fmtHoras(tot).replace(' h','H')+'</b></td></tr>';
  });
  if(!obras.length) filas='<tr><td class="obra">—</td>'+'<td></td>'.repeat(7)+'<td></td></tr>';

  // Fila de extras
  let totX=0;
  const celdasX=dias.map(d=>{
    const x=extrasDia(sem.dias[iso(d)]); totX+=x;
    return '<td>'+(x>0? '+'+fmtHoras(x).replace(' h','H'):'')+'</td>';
  }).join('');
  const filaExtras= totX>0 ? '<tr class="extras"><td class="obra">Horas extras</td>'+celdasX+'<td>+'+fmtHoras(totX).replace(' h','H')+'</td></tr>' : '';

  // Fila total por día: horas si es trabajado, el tipo si no, "—" si no se rellenó
  let totG=0;
  const celdasT=dias.map(d=>{
    const dd=sem.dias[iso(d)];
    if(dd && dd.tipo!=='trabajado') return '<td>'+TIPOS[dd.tipo]+'</td>';
    const t=horasDia(dd)+extrasDia(dd); totG+=t;
    return '<td>'+(dd? fmtHoras(t).replace(' h','H'):'—')+'</td>';
  }).join('');

  // Trabajos realizados
  const trabajos=dias.map(d=>{
    const dd=sem.dias[iso(d)];
    if(!dd) return '';
    if(dd.tipo!=='trabajado') return '<b>'+d.getDate()+':</b> '+TIPOS[dd.tipo];
    const partes=dd.entradas.map(e=>escapar(e.obra)+' ('+fmtHoras(e.horas).replace(' h','H')+')');
    const x=extrasDia(dd);
    if(x>0) partes.push('+'+fmtHoras(x).replace(' h','H')+' extras');
    return partes.length? '<b>'+d.getDate()+':</b> '+partes.join(' / ') : '';
  }).filter(Boolean).join(' &nbsp;·&nbsp; ');

  const t=totalesSemana(clave);
  $('informe').innerHTML=`
    <div class="inf-cab">
      <img src="assets/logo.jpg" alt="Instalaciones Vimeca">
      <div class="inf-emp">
        <b>${escapar(emp.nombre)}</b><br>
        NIF: ${escapar(emp.nif)}<br>
        Dirección: ${escapar(emp.direccionInforme)}<br>
        Persona de contacto: ${escapar(emp.contacto)} · Tel.: ${escapar(emp.telefono)}
      </div>
      <div class="inf-caja">
        <div><b>Fecha:</b> ${fmtCorta(dias[0])} al ${fmtCorta(dias[6])}</div>
        <div><b>Operario:</b> ${escapar(perfil.nombre+' '+perfil.apellidos)}</div>
        <div><b>Cliente:</b> ________________</div>
      </div>
    </div>
    <table class="inf-t">
      <tr>
        <th style="width:18%">OBRA</th>
        ${dias.map((d,i)=>'<th>'+DIAS[i].toUpperCase()+'<small>'+fmtCorta(d)+'</small></th>').join('')}
        <th style="width:9%">TOTAL</th>
      </tr>
      ${filas}
      ${filaExtras}
      <tr class="tot"><td class="obra">TOTAL DÍA</td>${celdasT}<td>${fmtHoras(totG).replace(' h','H')}</td></tr>
    </table>
    <div class="inf-sec">
      <h4>TRABAJOS REALIZADOS</h4>
      <div>${trabajos || 'Sin trabajos registrados esta semana.'}</div>
    </div>
    <div class="inf-sec">
      <h4>RESUMEN SEMANAL DEL OPERARIO</h4>
      <div>Horas normales: <b>${fmtHoras(t.normales)}</b> &nbsp;·&nbsp; Horas extras: <b>${fmtHoras(t.extras)}</b> &nbsp;·&nbsp; TOTAL: <b>${fmtHoras(t.total)}</b></div>
    </div>
    <div class="inf-firma"><br><br><span>FIRMA / SELLO DEL RESPONSABLE</span></div>
    <div class="inf-pie">${pieInforme()}</div>`;
}

/* v1 imprimía al instante porque el logo iba incrustado. Ahora es un fichero: se espera a que
   esté listo para que nunca salga el PDF sin logo. */
async function imprimirInforme(claveOConstructor){
  if(typeof claveOConstructor === 'function') claveOConstructor();
  else construirInforme(claveOConstructor);
  const img=$('informe').querySelector('img');
  try{ await img.decode(); }catch(e){}
  window.print();
}

/* ================= Informe global del encargado =================
   Maqueta del PDF del panel v1 (fila por operario). Las celdas usan celdaDia() de panel.js, igual
   que la tabla de pantalla: "8 +2", abreviatura del tipo de día o "—". */
function construirInformeGlobal(semana, filas){
  const dias=diasSemana(deIso(semana));
  const emp=CONFIG.empresa;
  let tN=0, tX=0;
  let cuerpo='';
  filas.forEach(f=>{
    tN+=f.normales; tX+=f.extras;
    const nota = !f.parte ? 'Pendiente' : f.parte.version>1 ? 'Modificado el '+fmtFechaHora(f.parte.modificado_at) : '';
    cuerpo+='<tr><td class="op">'+escapar(nombreCompleto(f.usuario))+(nota?'<small>'+nota+'</small>':'')+'</td>'
      +dias.map(d=>tdDia(f.dias[iso(d)])).join('')
      +'<td><b>'+fH(f.normales+f.extras)+'</b></td></tr>';
  });
  cuerpo+='<tr class="tot"><td class="op">TOTAL DÍA</td>'+dias.map(d=>'<td>'+celdaTotalDia(filas, iso(d))+'</td>').join('')+'<td>'+fH(tN+tX)+'</td></tr>';

  const trabajos=dias.map(d=>{
    const trozos=[];
    filas.forEach(f=>{
      const dd=f.dias[iso(d)];
      if(!dd) return;
      if(dd.tipo!=='trabajado'){ trozos.push(escapar(f.usuario.nombre)+': '+TIPOS[dd.tipo]); return; }
      const obras=dd.entradas.map(e=>escapar(e.obra)+' ('+fH(e.horas)+'H)');
      if(extrasDia(dd)>0) obras.push('+'+fH(extrasDia(dd))+'H extras');
      trozos.push(escapar(f.usuario.nombre)+': '+obras.join(', '));
    });
    return trozos.length? '<b>'+d.getDate()+':</b> '+trozos.join(' / ') : '';
  }).filter(Boolean).join(' &nbsp;·&nbsp; ');

  $('informe').innerHTML=`
    <div class="inf-cab">
      <img src="assets/logo.jpg" alt="Instalaciones Vimeca">
      <div class="inf-emp">
        <b>${escapar(emp.nombre)}</b><br>
        NIF: ${escapar(emp.nif)}<br>
        Dirección: ${escapar(emp.direccionInforme)}<br>
        Persona de contacto: ${escapar(emp.contacto)} · Tel.: ${escapar(emp.telefono)}
      </div>
      <div class="inf-caja">
        <div><b>Fecha:</b> ${fmtCorta(dias[0])} al ${fmtCorta(dias[6])}</div>
        <div><b>Operarios:</b> ${filas.length}</div>
        <div><b>Cliente:</b> ________________</div>
      </div>
    </div>
    <table class="inf-t">
      <tr><th style="width:16%">OPERARIO</th>
      ${dias.map((d,i)=>'<th>'+DIAS[i].toUpperCase()+'<small>'+fmtCorta(d)+'</small></th>').join('')}
      <th style="width:8%">TOTAL</th></tr>
      ${cuerpo}
    </table>
    <p class="inf-leyenda">${LEYENDA_CELDAS}</p>
    <div class="inf-sec"><h4>TRABAJOS REALIZADOS</h4><div>${trabajos||'Sin trabajos registrados.'}</div></div>
    <div class="inf-sec"><h4>RESUMEN SEMANAL</h4>
      <div>Horas normales: <b>${fH(tN)}H</b> &nbsp;·&nbsp; Horas extras: <b>${fH(tX)}H</b> &nbsp;·&nbsp; TOTAL PLANTILLA: <b>${fH(tN+tX)}H</b></div>
    </div>
    <div class="inf-firma"><br><br><span>FIRMA / SELLO DEL RESPONSABLE</span></div>
    <div class="inf-pie">${pieInforme()}</div>`;
}
