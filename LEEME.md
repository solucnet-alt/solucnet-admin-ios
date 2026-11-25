# SolucNet Admin para iPhone

Las mismas pantallas de la app Android de admin (chats, clientes, cobranza, mapa, OLT, ISP Guardian, visitas, verificación de
pagos…), como app NATIVA de iPhone (Capacitor 7). Habla con SolucWISP (https://cliente.solucnet.com), igual que la Android.

## Diferencias con Android
- Actualizaciones: por **TestFlight** (no hay APK). El aviso de "nueva versión" de la app está apagado en iPhone.
- Notificaciones: por Firebase → Apple (APNs). SolucWISP no cambia: manda por FCM como siempre.
- "Compartir hacia la app" (desde otras apps) no está en esta primera versión.

## Lo que se hace UNA vez en Apple (requiere cuenta Apple Developer, 99 USD/año)
1. developer.apple.com › Account: anotar el **Team ID**.
2. App Store Connect › Apps › **+ Nueva app**: iOS, nombre "SolucNet Admin", Bundle ID **com.solucnet.admin**, SKU solucnet-admin.
3. App Store Connect › Users and Access › Integrations › **App Store Connect API** › generar llave (rol *App Manager*):
   anotar **Key ID**, **Issuer ID** y descargar el **.p8** (solo se descarga una vez).
4. developer.apple.com › Keys › **+** › *Apple Push Notifications service (APNs)* → descargar el .p8 de APNs.
5. Firebase (el mismo proyecto de la app Android de admin) › Agregar app › **iOS** con bundle **com.solucnet.admin**:
   descargar **GoogleService-Info.plist**; en Configuración › Cloud Messaging › app iOS: subir la llave APNs del paso 4.

## Compilar (GitHub, sin Mac)
1. Subir esta carpeta a un repositorio de GitHub (rama `main`).
2. Settings › Secrets and variables › Actions: crear `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`
   (contenido del .p8) y `GOOGLE_SERVICE_INFO_PLIST` (`base64 -i GoogleService-Info.plist`).
3. Actions › **Build iOS** › Run workflow. En ~15 min la app aparece en App Store Connect › TestFlight.
4. TestFlight › agregar a los operadores (por correo). Ellos instalan la app **TestFlight** en el iPhone y aceptan la invitación.

## Nueva versión
Cambiar `version` en package.json (y lo que haga falta en `www/`), subir a `main`: se compila y sube sola a TestFlight.
