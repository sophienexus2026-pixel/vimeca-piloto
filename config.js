/* Configuración de Partes de Trabajo Vimeca.
   La clave anon es pública por diseño: la seguridad está en las políticas RLS de
   supabase/schema.sql. Nunca poner aquí la clave service_role / secret.
   Se declara con "var" para que también la lea el service worker (importScripts). */
var CONFIG = {
  supabaseUrl: 'https://bymojtalvbnektyuwulp.supabase.co',
  supabaseClaveAnon: 'sb_publishable_QhXJYJABgI6knunOS8mFdA_b0W6ek3C',
  versionApp: '2.1.1',
  versionTerminos: '1.0-borrador',  // = «version:» de legal/privacy-terms.md. Si cambia, todos vuelven a aceptar
  entorno: 'piloto',        // 'piloto' muestra una banda «VERSIÓN PILOTO» en todas las pantallas
  empresa: {
    nombre: 'INSTALACIONES VIMECA, S.L.U',
    nif: 'B-67614305',
    direccion: 'C/ Ecuador nº16, Collado Mediano, C.P. 28450, Madrid',
    direccionInforme: 'C/ Ecuador nº16 · Collado Mediano · C.P. 28450 · Madrid',
    contacto: 'Víctor Méndez',
    telefono: '+34 664 153 720'
  }
};
