# Guía Sagrada del Servidor Web (Nginx) y Automatizaciones

Esta guía describe cómo `koram-cli` automatiza la configuración de servidores web Nginx, la gestión de certificados SSL con Certbot (Let's Encrypt), y la infraestructura como código (IaC) integrada directamente con tus despliegues.

---

## 1. Concepto de Arquitectura: Infraestructura como Código (IaC)

`koram-cli` implementa un mapeo simétrico 1-a-1 entre tus archivos locales y el servidor remoto. Todo se organiza a través del nombre de la aplicación (`appName`) y su entorno (`<env>`):

```
mi-proyecto/
├── .koram/
│   └── webserver/
│       ├── mi-app-production.conf   <-- Plantilla local de Nginx (Fuente de verdad)
│       ├── mi-app-staging.conf      <-- Plantilla local de Nginx (Fuente de verdad)
│       └── mi-app-develop.conf      <-- Plantilla local de Nginx (Fuente de verdad)
├── .koram-rc.production.json
├── .koram-rc.staging.json
└── package.json
```

### Reglas de Sincronización
* **Local $\rightarrow$ Remoto:** El archivo local se llama exactamente igual que el archivo remoto en Nginx:
  - Local: `.koram/webserver/${appName}-${env}.conf`
  - Remoto: `/etc/nginx/sites-available/${appName}-${env}.conf`
* **Edición Avanzada:** Puedes abrir el archivo `.conf` local en tu IDE y modificar cualquier directiva de Nginx (límites de subida, cabeceras, compresión). El CLI respetará tus cambios y los subirá directamente al servidor remoto sin sobrescribirlos, a menos que uses un flag para forzar la regeneración.
* **Cabecera de Trazabilidad:** Al inicio de cada archivo generado se inyecta un bloque de comentarios que registra la app, entorno, origen local y fecha de sincronización, facilitando auditorías y migraciones de servidores.

---

## 2. Comandos del Servidor Web

### A. Agregar o Actualizar Configuración Local (`koram add:webserver`)
Inicializa o actualiza el bloque de configuración del servidor web en tu archivo `.koram-rc.<env>.json` y genera la plantilla Nginx local en `.koram/webserver/`.

```bash
koram add:webserver [flags]
```

#### Flags de `add:webserver`
| Flag | Atajo | Descripción | Por defecto |
| --- | --- | --- | --- |
| `--env` | `-e` | Entorno para aplicar la configuración (production, staging, develop) | *Interactivo* |
| `--type` | `-t` | Tipo de servidor web (`nginx`, `caddy`, `apache`) | `nginx` |
| `--serverName`| `-s` | Nombre de dominio del servidor (ej: `mi-app.com`) | `example.com` |
| `--port` | `-p` | Puerto HTTP público de escucha en el servidor | `80` |
| `--ssl` | | Habilita configuración de HTTPS (puerto 443) | `false` |
| `--certPath` | | Ruta al certificado fullchain en el servidor remoto | `/etc/letsencrypt/live/<domain>/fullchain.pem` |
| `--keyPath` | | Ruta a la clave privada en el servidor remoto | `/etc/letsencrypt/live/<domain>/privkey.pem` |
| `--proxyPass` | | URL interna de proxy reverso (para Node/Nuxt/PM2) | Autodetectado o `http://127.0.0.1:3000` |
| `--redirectToSsl`| | Crea una redirección automática del puerto 80 al puerto 443 | `false` |
| `--force` | `-f` | Sobrescribe las configuraciones previas (tanto en el JSON como en la plantilla local) | `false` |

#### Soporte Inteligente para SPA (Sitios Estáticos)
Si el archivo `.koram-rc.<env>.json` tiene configurado el parámetro `"type": "spa"`, `koram add:webserver` automáticamente omitirá el bloque `proxyPass` de la raíz `/` y en su lugar generará una plantilla de sitio estático que sirve archivos directamente desde el directorio de despliegue:
```nginx
root /var/www/mi-app/current;
index index.html;
location / {
    try_files $uri $uri/ /index.html;
}
```

---

### B. Generar Configuración Local (`koram infra:webserver:gen`)
Genera la configuración Nginx basándose únicamente en los datos actuales del archivo `.koram-rc.<env>.json`.

```bash
koram infra:webserver:gen [flags]
```

#### Flags de `infra:webserver:gen`
| Flag | Atajo | Descripción |
| --- | --- | --- |
| `--env` | `-e` | Entorno a utilizar (ej: `production`, `staging`). |
| `--out` | `-o` | Guarda el archivo Nginx en una ruta alternativa en lugar de `.koram/webserver/`. |

---

### C. Aplicar Configuración en el Servidor Remoto (`koram infra:webserver`)
Toma la configuración local `.koram/webserver/${appName}-${env}.conf` como la **fuente de verdad**, la sube de forma segura por SSH/SFTP al servidor, crea el enlace simbólico activo en `sites-enabled` y recarga Nginx.

```bash
koram infra:webserver [flags]
```

#### Flags de `infra:webserver`
| Flag | Atajo | Descripción |
| --- | --- | --- |
| `--env` | `-e` | Entorno del servidor a aplicar. |
| `--regenerate`| `-r` | Fuerza la regeneración del archivo local a partir de la configuración JSON antes de sincronizar. |

---

## 3. Certificación SSL Let's Encrypt / Certbot Automática

Cuando ejecutas `koram infra:webserver` (o se ejecuta al finalizar un deploy) con SSL habilitado (`ssl.enabled: true`), el CLI realiza un aprovisionamiento seguro en dos fases para evitar caídas del servidor web:

1. **Chequeo de Certificados:** El CLI verifica vía SSH si los archivos de claves definidos en `ssl.certPath` ya existen en el servidor.
2. **Fase de Bootstrap (Si no existen):**
   * El CLI genera y sube una configuración de bootstrap temporal que escucha **únicamente en el puerto 80** y expone el dominio.
   * Recarga Nginx para aplicar el cambio.
   * Ejecuta en el servidor remoto el comando oficial de Certbot:
     ```bash
     sudo certbot --nginx -d mi-app.com --non-interactive --agree-tos -m contacto@mi-app.com
     ```
     *(Si falla, utiliza un fallback inteligente `certbot certonly --webroot`).*
3. **Fase HTTPS Final:**
   * Una vez que Certbot crea los certificados exitosamente en el servidor remoto, el CLI sube la configuración final HTTPS de la carpeta `.koram/` (con puerto 443 SSL y redirección automática 80 $\rightarrow$ 443) y recarga Nginx por segunda vez.

---

## 4. Integración Declarativa en el Despliegue (`koram deploy`)

> [!IMPORTANT]
> **Diferencia entre los dos bloques de Servidor Web**:
> *   **`webserver` (en la Raíz):** Define las especificaciones de **infraestructura física y ruteo** de Nginx (nombre del dominio, puerto, redirección SSL, certificados y opcionalmente un VPS secundario `webserver.server`).
> *   **`deploy.webserver` (dentro de `deploy`):** Define las **opciones de automatización del flujo del deployer** (si se auto-aplica la sincronización al finalizar el deploy, qué correo usar de contacto en Certbot y si se autoejecuta Certbot).

Puedes programar que el servidor web se sincronice automáticamente al finalizar cada despliegue de código exitoso agregando el bloque `webserver` bajo el apartado `deploy` en tu `.koram-rc.<env>.json`:

```json
{
  "name": "mi-app",
  "type": "spa",
  "deploy": {
    "path": "/var/www/mi-app",
    "webserver": {
      "autoApply": true,
      "certbotEmail": "admin@komarca.com",
      "certbotAutoRun": true
    }
  }
}
```

* `autoApply`: Activa la sincronización del Nginx local al terminar el deploy.
* `certbotEmail`: Email que utilizará Certbot en el servidor para Let's Encrypt.
* `certbotAutoRun`: Activa la auto-creación del certificado si no existe en el VPS.

### Flags en Deploy
Puedes forzar u omitir este comportamiento en consola usando:
```bash
# Fuerza la sincronización de Nginx
koram deploy:spa --webserver

# Evita sincronizar Nginx aunque esté configurado en autoApply
koram deploy:spa --no-webserver
```

---

## 5. Control desde el Dashboard de Despliegue

Al lanzar el Dashboard interactivo (ej. con `koram deploy:spa` o `koram deploy:nuxt`), verás una sección llamada **Servidor Web (Nginx)**:

* **Auto-aplicar Nginx al finalizar:** Un checkbox reactivo enlazado con la configuración de tu archivo para habilitar/deshabilitar la sincronización automática.
* **Email & SSL:** Campos editables para definir el email de registro de Certbot y activar la auto-certificación SSL.
* **Botón "Sincronizar Nginx":** Te permite resincronizar en caliente la configuración de Nginx y validar el estado del servidor remoto en cualquier momento con un solo clic, sin necesidad de redesplegar el código de tu aplicación.

---

## 6. Despliegue en Servidores Separados (Código vs Webserver)

En arquitecturas de producción avanzadas, es común tener el servidor donde corre el código (backend/PM2/Node) en un VPS interno, y el servidor Nginx (como Gateway o Balanceador de carga frontal) en otro VPS público.

`koram-cli` soporta esta arquitectura de forma nativa. Puedes definir credenciales independientes para el despliegue y para Nginx dentro de tu `.koram-rc.<env>.json` utilizando el bloque `webserver.server`:

```json
{
  "name": "mi-app",
  "type": "nuxt",
  "server": {
    "host": "10.0.0.5",
    "user": "ubuntu",
    "port": 22
  },
  "webserver": {
    "server": {
      "host": "64.23.174.86",
      "user": "root",
      "port": 22
    },
    "configs": [
      {
        "serverName": "mi-sitio.com",
        "listen": 80
      }
    ]
  }
}
```

### Comportamiento Automático:
* **Despliegue del código:** Se conectará a `server` (`10.0.0.5`) para compilar y subir los archivos de tu app.
* **Sincronización de Nginx:** Al finalizar, el CLI detectará que `webserver.server` es diferente. Automáticamente abrirá una **segunda conexión SSH independiente** hacia `64.23.174.86`, resolviendo el password de tu bóveda de credenciales, subirá la plantilla Nginx y recargará el servicio Nginx en el servidor frontal.

