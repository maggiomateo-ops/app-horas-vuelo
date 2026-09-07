# Google Apps Script

Esta carpeta contiene el código de Google Apps Script utilizado como backend de App Horas.

## Script Properties requeridas

El proyecto de Apps Script requiere las siguientes Script Properties:

- `APP_SECRET`: secreto compartido con las funciones serverless de Vercel. No debe incluirse en el código ni en el repositorio.
- `ADMIN_SPREADSHEET_ID`: ID de la Google Sheet central `App Horas - Administracion`.

Los valores de estas propiedades deben configurarse manualmente desde la administración del proyecto de Google Apps Script.

## Hoja administrativa

La Google Sheet central se denomina:

`App Horas - Administracion`

Debe contener las siguientes hojas:

- `USUARIOS`
- `AERONAVES`
- `PERMISOS`
- `CONFIG_APP`

La hoja `AERONAVES` relaciona cada `aircraft_id` con el `spreadsheet_id` de su Google Sheet.

## Hojas por aeronave

Cada aeronave tiene su propia Google Sheet. Todas las planillas de aeronave deben conservar la estructura de hojas y columnas esperada por `Code.gs`.

El campo `spreadsheet_id` es información interna del backend y nunca debe exponerse al frontend. React trabaja con `aircraft_id`; la resolución hacia el Spreadsheet correspondiente debe realizarse en Apps Script después de validar usuario, permiso y aeronave.

## Deployment

El deployment actual de Google Apps Script todavía se administra manualmente desde Google Apps Script.

Esta carpeta no utiliza `clasp` por el momento. Después de modificar `Code.gs`, los cambios deben copiarse y desplegarse manualmente siguiendo el procedimiento vigente. Los secretos y las credenciales nunca deben copiarse al repositorio.
