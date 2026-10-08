# Partes Vimeca — PILOTO v2

Versión de prueba. No es la app oficial: la de todos los días sigue en
https://sophienexus2026-pixel.github.io/partesvimeca-/

Generado desde el repositorio principal con `herramientas/preparar-piloto.js`.

## Qué subir al repositorio vimeca-piloto

TODO el contenido de esta carpeta: 21 ficheros, con las subcarpetas assets/, css/, js/.
Si falta uno, la app falla en el móvil.

- `README.md`
- `assets/logo.jpg`
- `config.js`
- `css/app.css`
- `icon-192.png`
- `icon-512.png`
- `index.html`
- `js/almacen.js`
- `js/api.js`
- `js/app.js`
- `js/exportar-excel.js`
- `js/fechas.js`
- `js/informe.js`
- `js/libro-excel.js`
- `js/panel.js`
- `js/perfil.js`
- `js/sincronizacion.js`
- `js/tecnico.js`
- `js/terminos.js`
- `manifest.webmanifest`
- `sw.js`

Después de subirlo, comprueba desde el repositorio principal que todo está publicado:

    node herramientas/comprobar-publicado.js https://sophienexus2026-pixel.github.io/vimeca-piloto/
