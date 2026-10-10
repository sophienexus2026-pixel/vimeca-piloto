'use strict';
/* ================= Libro Excel (.xlsx) mínimo =================
   Escribe ficheros .xlsx en el propio móvil, sin librerías externas ni CDN (funciona sin cobertura:
   el service worker guarda este fichero). Un .xlsx es un ZIP con varios XML; aquí solo se usa lo
   necesario: varias hojas, textos, números, fechas, fórmulas con su valor ya calculado (los visores
   de Android que no calculan muestran el valor), negrita y relleno de cabecera, filas/columnas
   congeladas, autofiltro, ancho de columnas e impresión apaisada. herramientas/probar-excel.js lo
   comprueba con dos lectores (SheetJS y ExcelJS).

   Uso:
     const bytes = await crearLibroExcel([{
       nombre: 'Resumen',                         // máx. 31 caracteres
       anchos: [30, 10, …],                       // ancho de cada columna (caracteres)
       filas: [ [celda, celda, …], … ],
       congelar: { filas: 5, columnas: 1 },       // opcional
       filtro: { desde: 5, hasta: 9, columnas: 12 },  // opcional: filas 1-based, incluida la cabecera
       horizontal: true                           // opcional: imprimir apaisado y a una página de ancho
     }]);
   Celda: null | texto | número | Date (fecha) | { v, tipo, f, estilo }
     tipo:   'texto' | 'numero' | 'fecha' | 'fechaHora' | 'hora' (v = "HH:MM", celda de hora hh:mm)
     f:      fórmula sin «=» (p. ej. 'SUM(B6:B9)'); v es el valor ya calculado
     estilo: 'cabecera' | 'titulo' | 'subtitulo' | 'negrita' | 'total' | 'nota' | 'centro' | 'totalCentro'
   Los textos se limpian: los saltos de línea y tabuladores pasan a espacios y se quitan los
   caracteres de control, así ningún valor puede partir una fila. */

const ESTILOS_EXCEL = { normal:0, cabecera:1, fecha:2, fechaHora:3, titulo:4, negrita:5, total:6, nota:7, subtitulo:8, totalFecha:9, centro:10, totalCentro:11, hora:12 };

function limpiarTextoExcel(v){
  return String(v ?? '')
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F\uFFFE\uFFFF]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 32000);                 // límite de Excel por celda: 32767
}
const xmlEsc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function letraColumna(i){            // 0 → A, 25 → Z, 26 → AA
  let s = ''; i++;
  while(i > 0){ const r = (i-1) % 26; s = String.fromCharCode(65+r) + s; i = Math.floor((i-1)/26); }
  return s;
}
/* Fecha → número de serie de Excel, con la hora local del móvil (España). */
function serieExcel(d){
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

function xmlHoja(hoja, textos){
  const indice = s => { if(!textos.mapa.has(s)){ textos.mapa.set(s, textos.lista.length); textos.lista.push(s); } return textos.mapa.get(s); };
  let filasXml = '';
  hoja.filas.forEach((fila, i) => {
    const r = i + 1;
    let celdas = '';
    (fila || []).forEach((c, j) => {
      if(c === null || c === undefined || c === '') return;
      if(typeof c !== 'object' || c instanceof Date) c = { v:c };
      let { v, tipo, f, estilo } = c;
      if(!tipo) tipo = v instanceof Date ? 'fecha' : typeof v === 'number' ? 'numero' : 'texto';
      let s = ESTILOS_EXCEL[estilo || 'normal'] || 0;
      if(tipo === 'fecha' || tipo === 'fechaHora'){
        if(!(v instanceof Date) || isNaN(v)) return;
        s = estilo === 'total' ? ESTILOS_EXCEL.totalFecha : ESTILOS_EXCEL[tipo];
        v = serieExcel(v);
        if(tipo === 'fecha') v = Math.round(v);
        tipo = 'numero';
      } else if(tipo === 'hora'){
        const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ''));
        if(!m) return;
        s = ESTILOS_EXCEL.hora;
        v = (Number(m[1])*60 + Number(m[2])) / 1440;      // fracción del día
        tipo = 'numero';
      }
      const ref = letraColumna(j) + r;
      const fXml = f ? '<f>'+xmlEsc(limpiarTextoExcel(f))+'</f>' : '';
      if(tipo === 'numero'){
        const n = Number(v);
        celdas += '<c r="'+ref+'" s="'+s+'">'+fXml+(Number.isFinite(n) ? '<v>'+n+'</v>' : '')+'</c>';
      } else if(f){
        celdas += '<c r="'+ref+'" s="'+s+'" t="str">'+fXml+'<v>'+xmlEsc(limpiarTextoExcel(v))+'</v></c>';
      } else {
        const t = limpiarTextoExcel(v);
        if(t) celdas += '<c r="'+ref+'" s="'+s+'" t="s"><v>'+indice(t)+'</v></c>';
      }
    });
    filasXml += '<row r="'+r+'">'+celdas+'</row>';
  });

  let vista = '<sheetView workbookViewId="0"/>';
  const cf = hoja.congelar?.filas || 0, cc = hoja.congelar?.columnas || 0;
  if(cf || cc){
    const panel = cf && cc ? 'bottomRight' : cf ? 'bottomLeft' : 'topRight';
    vista = '<sheetView workbookViewId="0"><pane'+(cc ? ' xSplit="'+cc+'"' : '')+(cf ? ' ySplit="'+cf+'"' : '')
      +' topLeftCell="'+letraColumna(cc)+(cf+1)+'" activePane="'+panel+'" state="frozen"/>'
      +'<selection pane="'+panel+'" activeCell="'+letraColumna(cc)+(cf+1)+'" sqref="'+letraColumna(cc)+(cf+1)+'"/></sheetView>';
  }
  const cols = (hoja.anchos || []).map((a,i) => '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+a+'" customWidth="1"/>').join('');
  const filtro = hoja.filtro && hoja.filtro.hasta > hoja.filtro.desde
    ? '<autoFilter ref="'+rangoFiltro(hoja.filtro)+'"/>' : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + (hoja.horizontal ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '')
    + '<sheetViews>'+vista+'</sheetViews><sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? '<cols>'+cols+'</cols>' : '')
    + '<sheetData>'+filasXml+'</sheetData>'+filtro
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + (hoja.horizontal ? '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : '')
    + '</worksheet>';
}
const rangoFiltro = f => letraColumna(0)+f.desde+':'+letraColumna(f.columnas-1)+f.hasta;
const rangoAbsoluto = (nombre, f) => "'"+nombre.replace(/'/g,"''")+"'!$A$"+f.desde+':$'+letraColumna(f.columnas-1)+'$'+f.hasta;

const XML_ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="166" formatCode="hh:mm"/></numFmts>'
  + '<fonts count="5">'
  +   '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
  +   '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
  +   '<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>'
  +   '<font><i/><sz val="10"/><color rgb="FF7A7580"/><name val="Calibri"/><family val="2"/></font>'
  +   '<font><sz val="11"/><color rgb="FF55505A"/><name val="Calibri"/><family val="2"/></font>'
  + '</fonts>'
  + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  +   '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEFE3"/><bgColor indexed="64"/></patternFill></fill>'
  +   '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF6EE"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>'
  +   '<border><left/><right/><top/><bottom style="thin"><color rgb="FF2F9E5B"/></bottom><diagonal/></border>'
  +   '<border><left/><right/><top style="thin"><color rgb="FF2F9E5B"/></top><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="13">'
  +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'                                                      // 0 normal
  +   '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'         // 1 cabecera
  +   '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'                               // 2 fecha
  +   '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'                               // 3 fecha y hora
  +   '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                         // 4 título
  +   '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                         // 5 negrita
  +   '<xf numFmtId="0" fontId="1" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'         // 6 total
  +   '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                         // 7 nota
  +   '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                         // 8 subtítulo
  +   '<xf numFmtId="164" fontId="1" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' // 9 total fecha
  +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>'  // 10 centrado
  +   '<xf numFmtId="0" fontId="1" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' // 11 total centrado
  +   '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'                               // 12 hora
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/* Devuelve los bytes (Uint8Array) del .xlsx. */
async function crearLibroExcel(hojas){
  const textos = { lista:[], mapa:new Map() };
  const nombres = hojas.map(h => limpiarTextoExcel(h.nombre).replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Hoja');
  const xmlHojas = hojas.map(h => xmlHoja(h, textos));
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const nombresFiltro = hojas.map((h,i) => h.filtro && h.filtro.hasta > h.filtro.desde
    ? '<definedName name="_xlnm._FilterDatabase" localSheetId="'+i+'" hidden="1">'+xmlEsc(rangoAbsoluto(nombres[i], h.filtro))+'</definedName>' : '').join('');
  const ficheros = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + hojas.map((h,i) => '<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="'+REL+'/extended-properties" Target="docProps/app.xml"/>'
      + '</Relationships>'],
    ['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + '<dc:title>Partes de trabajo Vimeca</dc:title><dc:creator>Partes de Trabajo Vimeca</dc:creator>'
      + '<dcterms:created xsi:type="dcterms:W3CDTF">'+new Date().toISOString().slice(0,19)+'Z</dcterms:created></cp:coreProperties>'],
    ['docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Partes de Trabajo Vimeca</Application></Properties>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<workbook '+NS+' xmlns:r="'+REL+'"><bookViews><workbookView activeTab="0"/></bookViews><sheets>'
      + nombres.map((n,i) => '<sheet name="'+xmlEsc(n)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')
      + '</sheets>'+(nombresFiltro ? '<definedNames>'+nombresFiltro+'</definedNames>' : '')
      + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + hojas.map((h,i) => '<Relationship Id="rId'+(i+1)+'" Type="'+REL+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')
      + '<Relationship Id="rId'+(hojas.length+1)+'" Type="'+REL+'/styles" Target="styles.xml"/>'
      + '<Relationship Id="rId'+(hojas.length+2)+'" Type="'+REL+'/sharedStrings" Target="sharedStrings.xml"/>'
      + '</Relationships>'],
    ['xl/styles.xml', XML_ESTILOS],
    ...xmlHojas.map((x,i) => ['xl/worksheets/sheet'+(i+1)+'.xml', x]),
    ['xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<sst '+NS+' count="'+textos.lista.length+'" uniqueCount="'+textos.lista.length+'">'
      + textos.lista.map(t => '<si><t xml:space="preserve">'+xmlEsc(t)+'</t></si>').join('') + '</sst>']
  ];
  return crearZip(ficheros.map(([n, x]) => [n, new TextEncoder().encode(x)]));
}

/* ================= ZIP =================
   Comprime con «deflate» si el navegador lo permite (CompressionStream); si no, guarda sin
   comprimir, que Excel también acepta. */
const TABLA_CRC = (() => { const t = new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
function crc32(d){ let c = 0xFFFFFFFF; for(let i=0;i<d.length;i++) c = TABLA_CRC[(c^d[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }

async function comprimir(datos){
  if(typeof CompressionStream === 'undefined') return null;
  try{
    const flujo = new Blob([datos]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(flujo).arrayBuffer());
  }catch(e){ return null; }
}

async function crearZip(entradas){
  const partes = [], central = [];
  let desplazamiento = 0;
  const ahora = new Date();
  const hora = (ahora.getHours()<<11)|(ahora.getMinutes()<<5)|(ahora.getSeconds()>>1);
  const fecha = ((ahora.getFullYear()-1980)<<9)|((ahora.getMonth()+1)<<5)|ahora.getDate();
  for(const [nombre, datos] of entradas){
    const nb = new TextEncoder().encode(nombre);
    const crc = crc32(datos);
    const comp = await comprimir(datos);
    const usarComp = comp && comp.length < datos.length;
    const cuerpo = usarComp ? comp : datos, metodo = usarComp ? 8 : 0;
    const cab = new DataView(new ArrayBuffer(30));
    cab.setUint32(0, 0x04034b50, true); cab.setUint16(4, 20, true); cab.setUint16(6, 0x0800, true);
    cab.setUint16(8, metodo, true); cab.setUint16(10, hora, true); cab.setUint16(12, fecha, true);
    cab.setUint32(14, crc, true); cab.setUint32(18, cuerpo.length, true); cab.setUint32(22, datos.length, true);
    cab.setUint16(26, nb.length, true); cab.setUint16(28, 0, true);
    partes.push(new Uint8Array(cab.buffer), nb, cuerpo);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, metodo, true); cd.setUint16(12, hora, true); cd.setUint16(14, fecha, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, cuerpo.length, true); cd.setUint32(24, datos.length, true);
    cd.setUint16(28, nb.length, true); cd.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(cd.buffer), nb);
    desplazamiento += 30 + nb.length + cuerpo.length;
  }
  const tamCentral = central.reduce((a,b)=>a+b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, entradas.length, true); fin.setUint16(10, entradas.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, desplazamiento, true);
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const salida = new Uint8Array(todo.reduce((a,b)=>a+b.length, 0));
  let p = 0; for(const t of todo){ salida.set(t, p); p += t.length; }
  return salida;
}
