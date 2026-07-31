# Guía del Túnel de Infraestructura (Koram Tunnel)

`koram infra:tunnel` te permite exponer instantáneamente cualquier puerto local de tu máquina de desarrollo (localhost) a Internet, utilizando uno de tus propios servidores VPS como un proxy inverso seguro sobre SSH.

Esto es extremadamente útil para probar webhooks (como Stripe o pasarelas de pago), mostrar avances a clientes en vivo, o testear integraciones móviles directamente contra tu entorno local.

---

## ¿Cómo funciona?

1.  **Eliges un Servidor VPS**: Seleccionas uno de tus servidores ya registrados en Koram (ej: `production`, `staging`).
2.  **Conexión SSH Inversa**: Koram abre un canal SSH seguro y redirige un puerto público del VPS hacia tu puerto local.
3.  **Proxy Inverso**: El VPS actúa como puente. Todo el tráfico que llegue al puerto del VPS se enviará automáticamente a tu máquina local.
4.  **Acceso Público**: Koram te entrega la URL pública (ej: `http://mi-vps.com:8080`) que puedes compartir o configurar en servicios externos.

---

## Uso del Comando

```bash
koram infra:tunnel [ALIAS] [FLAGS]
```

### Argumentos y Flags

| Argumento / Flag | Descripción |
| --- | --- |
| **ALIAS** | El alias del servidor registrado que actuará como proxy. |
| `-l, --localPort` | El puerto en tu máquina local que quieres exponer (ej. `3000`). |
| `-p, --remotePort` | El puerto en el VPS que se abrirá al público (ej. `8080`). |
| `-k, --sshKey` | Bandera para usar tu llave SSH en lugar de la contraseña. |

---

## Ejemplos de Flujos

### A. Modo Interactivo (Recomendado)
Solo indica el alias del servidor proxy. Koram te guiará y te preguntará de forma interactiva qué puertos deseas utilizar:

```bash
koram infra:tunnel staging
```

### B. Modo Directo y Rápido
Expone directamente el puerto local `3000` en el puerto público `8080` de tu VPS con alias `prod`:

```bash
koram infra:tunnel prod -l 3000 -p 8080
```

---

## Notas de Seguridad y Operatividad

> [!NOTE]
> **Liberación Automática de Puertos**: Koram detecta de forma automática si el puerto remoto en el VPS ya está en uso. Si está ocupado por un proceso huérfano o un túnel anterior, te ofrecerá matarlo y liberarlo en el acto, o en su defecto seleccionar un puerto alternativo.
