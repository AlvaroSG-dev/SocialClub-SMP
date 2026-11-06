# Launcher propio (NeoForge 1.21.1, cuentas offline, mods incluidos)

Los jugadores descargan **un solo instalador**, ponen su nombre y pulsan JUGAR.
El launcher descarga Java 21, Minecraft, NeoForge, copia los mods incluidos en el instalador y entra directo al servidor.
No hace falta ningún hosting para los mods.

## 1. Configurar (una vez)

Edita `launcher.config.json`:

| Campo | Qué poner |
|---|---|
| `launcherName`, `dataFolderName` | Nombre visible y carpeta de datos (`%APPDATA%\<dataFolderName>`) |
| `server.host` / `server.port` | IP y puerto de tu servidor |
| `minecraftVersion` | `1.21.1` |
| `neoforgeVersion` | **La misma versión que usa tu servidor** (p. ej. `21.1.172`; míralo en el nombre del jar de NeoForge del servidor) |
| `news` | Novedades que se muestran en el launcher |

Opcional: copia una imagen de fondo a `renderer/assets/background.jpg`.

## 2. Añadir los mods

Copia **los mismos mods que tiene el servidor** a `modpack/mods/`.
Si tienes configs, shaders o resource packs que quieras repartir, ponlos en `modpack/config/`, `modpack/resourcepacks/`, etc. (misma estructura que `.minecraft`).

- `mods/` se mantiene **idéntico** al modpack: se borran los mods que sobren.
- El resto de carpetas solo se copian/actualizan; nunca se borra nada del jugador.

## 3. Probar y generar el instalador

```bash
npm install
npm start            # abre el launcher para probarlo
npm run dist:win     # genera dist/SocialClub SMP Setup x.y.z.exe  (hazlo en Windows)
```

(`dist:linux` genera un AppImage y `dist:mac` un dmg; cada uno se construye en su propio sistema.)

Sube el `.exe` a donde quieras repartirlo (GitHub Releases admite hasta 2 GB por archivo, Drive, tu web...).

## 4. Actualizar mods

Cambia el contenido de `modpack/`, sube la versión en `package.json` (`"version"`), ejecuta `npm run dist:win` y reparte el nuevo instalador.
Al abrirlo, el launcher sincroniza solo lo que cambió.

## Cuentas: offline y Microsoft (premium)

El launcher tiene dos pestañas:

- **Sin cuenta premium**: solo un nombre. El UUID se calcula igual que lo hace el servidor con `online-mode=false`, así que cada nombre conserva sus datos.
- **Cuenta Microsoft**: el jugador pulsa *Iniciar sesión*, el launcher abre `microsoft.com/link` con un código y el jugador entra ahí. El launcher nunca ve la contraseña, y las siguientes veces la sesión se renueva sola.

Como tu servidor es offline, los premium entran con su nombre real pero el servidor **no** los verifica: sirve para que usen su nombre/skin de siempre, no es seguridad.

**Sobre el identificador de Microsoft** (`microsoft.clientId` en `launcher.config.json`):
- Con `null` (por defecto) se usa un identificador público ya existente (el de Minecraft para Nintendo Switch, que usan muchos proyectos de código abierto). Funciona al momento, pero no es "tu" aplicación.
- Lo correcto a largo plazo es registrar tu propia app gratuita en Azure (cuenta personal, "public client", *Allow public client flows* = Sí) y pedir que Mojang la apruebe en `aka.ms/mce-reviewappid` (tarda días; hasta entonces da error "Invalid app registration"). Cuando te la aprueben, pon tu ID en `clientId` y el launcher usará el flujo `msal`.

## Skins

- **Jugadores premium**: botón *Skin* → *Elegir PNG* → *Subir a mi cuenta*. Se guarda en su cuenta de Minecraft.
- **Jugadores sin premium**: en un servidor offline las skins **no se ven si el servidor no las gestiona**, para nadie (ni premium). Hay que instalar en el **servidor** (solo ahí, no en el modpack) el mod **SkinRestorer** (Modrinth: `skinrestorer`, soporta NeoForge). En modo offline busca solo la skin de cada jugador por su nombre, y quien no sea premium se la pone con un comando en el chat, p. ej. `/skin set web "https://.../mi_skin.png"` (escribe `/skin` en el juego para ver todas las opciones). El panel *Skin* del launcher muestra y copia ese comando; puedes cambiar el texto en `skins.command` de `launcher.config.json`.
- Comprueba en la página del mod que existe versión para tu NeoForge 1.21.1 antes de instalarlo.

## Skins sin comandos (como TLauncher)

El jugador sin premium abre *Skin*, elige su PNG y pulsa **Aplicar mi skin**. Se sube a un pequeño servidor de skins tuyo y el juego la pide sola al entrar. Hace falta montarlo **una vez**:

1. **Servidor de skins** (gratis, Cloudflare): cuenta en cloudflare.com y, dentro de la carpeta `worker/`:
   ```bash
   npx wrangler login
   npx wrangler kv namespace create SKINS    # copia el id que muestra en wrangler.toml
   npx wrangler deploy                       # te da una URL tipo https://socialclub-skins.TU-USUARIO.workers.dev
   ```
2. Pon esa URL en `launcher.config.json` → `skins.serverUrl` (sin barra final).
3. Descarga **CustomSkinLoader** (Modrinth: `customskinloader`, versión *NeoForge 1.21.1*, 14.26.1 o posterior) y copia el `.jar` a `modpack/mods/`. Es solo del cliente: **no lo instales en el servidor**.
4. Genera el instalador como siempre. El launcher escribe solo la configuración de CustomSkinLoader (primero tu servidor de skins, luego Mojang para los premium).

Notas: cada nombre queda "reclamado" por el ordenador que subió su skin primero (token secreto guardado en el launcher), así nadie puede pisar la skin de otro desde otro launcher. Si el jugador no tiene skin subida se ve Steve/Alex. Los jugadores solo ven las skins si también usan este launcher (o tienen CustomSkinLoader). Si dejas `serverUrl` vacío se muestra el método antiguo con el comando de SkinRestorer.

## Aspecto y visor de skins

- **Icono y estética**: el icono del servidor se usa como logo y como icono de la app. La paleta (ciruela oscura y rosa cerezo) está en `renderer/theme.css` (variables al principio). Para cambiar el icono, sustituye `renderer/assets/icon-64.png` (64x64), `renderer/assets/icon-256.png` y `build/icon.png` (512x512, el del instalador).
- **Fondo animado**: pétalos de cerezo cayendo sobre un atardecer, dibujado por código en `renderer/bg.js` (no hay ningún vídeo ni imagen que descargar). Se pausa si la ventana no se ve y respeta la opción "reducir movimiento" del sistema.
- **Visor de skins** (botón *Skin*): personaje 3D en ángulo 3/4 sobre una escena, botón ▶ para animarlo, vistas (frente/3-4/lado/espalda), arrastrar para girar y selector de fondo (Cerezal, Pradera, Noche, Claro, Sin fondo; recuerda el último). Detecta solo si la skin es de brazos finos o anchos. Muestra la skin actual de la cuenta Microsoft, o la vista previa del PNG que elijas. Las escenas son pixel-art propio (`renderer/skin-scenes.js`).
- Licencias de terceros incluidas: fuente *Pixelify Sans* (SIL OFL, en `renderer/assets/fonts`) y *skinview3d* (MIT, en `renderer/vendor`).

## Notas

- **Cuentas offline**: en offline cualquiera puede entrar con el nombre de otro: usa un plugin/mod de login con contraseña.
- **Java**: se descarga un JRE 21 (Eclipse Temurin) la primera vez, en `%APPDATA%\<dataFolderName>\runtime`.
- La primera ejecución tarda varios minutos (Minecraft + NeoForge + librerías); las siguientes son rápidas.
- **Si el jugador ya tiene Minecraft/NeoForge**: el launcher busca en su Minecraft oficial (`.minecraft`) la versión exacta de `neoforgeVersion`. Si está completa y sana, la reutiliza y no descarga nada. Aun así, los mods, mundos y configuraciones van siempre a la carpeta propia del launcher, sin tocar su instalación. Si falta algo o está dañado, instala en la carpeta del launcher.
- Una vez preparado, no se vuelve a comprobar nada. Para forzar una reparación, borra `.launcher-state.json` de la carpeta del juego (`%APPDATA%\<dataFolderName>\minecraft`).
- Acuérdate de poner tu IP real en `server.host`: con el valor de ejemplo (`play.example.com`) el juego abre bien pero no puede conectar.
- Para ver qué pasa, abre el desplegable **Registro** del launcher.

## Estructura

```
main.js, preload.js      Proceso principal de Electron
lib/auth.js              Login offline (UUID)
lib/java.js              Descarga/localiza Java 21
lib/game.js              Instala Minecraft + NeoForge y lanza el juego
lib/modpack.js           Copia los mods incluidos en el instalador
lib/status.js            Estado del servidor
lib/microsoft.js         Login con cuenta Microsoft (código de dispositivo)
lib/skins.js             Validación, subida y descarga de skins
lib/skinserver.js        Cliente del servidor de skins + config de CustomSkinLoader
worker/                  Servidor de skins (Cloudflare Worker)
renderer/bg.js           Fondo animado (pétalos de cerezo)
renderer/skin-view.js    Visor 3D de skins (+ skin-scenes.js: escenas de fondo)
renderer/                Interfaz
modpack/                 Mods y configs que viajan dentro del instalador
test/logic.test.js       Pruebas (npm test)
```
