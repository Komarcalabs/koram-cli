# Guía de Monitoreo de VPS (Koram Monitor)

`koram monitor` te permite centralizar el monitoreo de recursos del sistema (CPU, RAM, disco) y procesos PM2 de múltiples servidores VPS remotos en una sola interfaz web unificada.

---

## Arquitectura de Monitoreo

El sistema de monitoreo de Koram se basa en una topología de tipo Hub-and-Spoke:

```
           ┌───────────────────────┐
           │   EL GRAN OJO (Hub)   │ <─── Interfaz Web (Dashboard)
           │    Servidor Central   │
           └───────────────────────┘
             ▲         ▲         ▲
             │         │         │  (HTTP / Envío de reportes)
             │         │         │
       ┌─────┴──┐  ┌───┴────┐  ┌─┴──────┐
       │ AGENTE │  │ AGENTE │  │ AGENTE │  <─── Centinelas remotos en cada VPS
       │  VPS 1 │  │  VPS 2 │  │  VPS 3 │
       └────────┘  └────────┘  └────────┘
```

1.  **El Gran Ojo (Servidor Central)**: Actúa como el concentrador de datos. Recibe los informes métricos de salud de todos los agentes. Se instala solo **una vez** en el servidor que elijas como tu central de mando.
2.  **El Centinela (Agente)**: Un agente liviano de monitoreo que se instala en **cada VPS** que desees vigilar. Se encarga de enviar paquetes de datos cada N segundos de forma constante.

---

## A. Despliegue Automático (Recomendado)

Si ya tienes las credenciales SSH registradas en la bóveda de Koram (con `koram creds:add`), puedes aprovisionar tanto el **Servidor Central** como los **Agentes** remotamente con un solo comando interactivo:

```bash
koram monitor:setup mi-vps-alias
```

### ¿Qué hace este comando?
1. Se conecta de forma segura por SSH.
2. Verifica e instala **Node.js >= 20** si no está disponible en la máquina remota.
3. Instala `koram` de forma global en el VPS.
4. Genera los archivos de arranque e inicia el servicio (Servidor o Agente) en **PM2** con auto-inicio activado en el arranque del sistema.

---

## B. Despliegue Manual y Personalizado

Si prefieres realizar la configuración de forma manual directamente en cada máquina:

### 1. Inicializar el Servidor Central (El Gran Ojo)
Corre el servidor en el VPS central que centralizará el Dashboard:

```bash
koram monitor:server --port 3000 --key <tu_secret_key>
```
*   **Acceso**: Disponible de inmediato en `http://<ip-servidor>:3000/`.
*   **Autenticación**: Por defecto es abierto al público. Puedes bloquearlo activando la bandera de seguridad:
    ```bash
    koram monitor:server --port 3000 --key <tu_secret_key> --auth --user admin --pass secreto123
    ```

#### Flags del Servidor Central:
| Flag | Atajo | Descripción | Por defecto |
| --- | --- | --- | --- |
| `--port` | `-p` | Puerto HTTP donde escuchará el Dashboard central | `3000` |
| `--key` | `-k` | Clave secreta que los agentes deben enviar para autorizar el reporte | *Requerido* |
| `--auth` | `-a` | Si se pasa, activa la pantalla de login (Basic Auth) en el Dashboard | `false` |
| `--user` | | Usuario personalizado para el login del Dashboard | `koram` |
| `--pass` | | Contraseña personalizada para el login del Dashboard | `API_KEY` |

---

### 2. Inicializar los Agentes (Centinelas)
En cada VPS que desees vigilar, instala Koram de manera global e inicializa el agente:

```bash
koram monitor:agent --url http://tu-servidor-central.com:3000 --key <tu_secret_key> --name vps-staging
```

#### Flags del Agente:
| Flag | Atajo | Descripción | Por defecto |
| --- | --- | --- | --- |
| `--url` | `-u` | Dirección HTTP del Servidor Central (El Gran Ojo) | *Requerido* |
| `--key` | `-k` | Clave secreta para poder reportar datos al Servidor Central | *Requerido* |
| `--name` | `-n` | Nombre representativo del VPS (usa el hostname por defecto) | Hostname |
| `--interval`| `-i` | Intervalo de envío de reportes de salud en segundos | `60` |

---

## C. Configurar Persistencia en Segundo Plano (PM2)

Para asegurarte de que tanto el servidor central como los agentes sigan activos indefinidamente en segundo plano tras cerrar la sesión de terminal, usa **PM2**:

### En el Servidor Central:
```bash
pm2 start "koram monitor:server --port 3000 --key <tu_clave> --auth" --name koram-server
```

### En cada VPS de los Agentes:
```bash
pm2 start "koram monitor:agent --url http://monitor.tu-dominio.com --key <tu_clave> --name VPS-1" --name koram-agent
```

### Guardar Lista de Procesos:
```bash
pm2 save
```
Esto asegurará que los procesos se reanuden automáticamente si el servidor se reinicia.
