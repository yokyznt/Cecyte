// /api/firmware  -> actualización del ESP32 sin cable (OTA)
//
// El panel sube el .bin en trozos (un POST no puede llevar 1 MB de golpe) y al final lo "publica":
//   POST { action: 'chunk',  uploadId, index, total, data(base64) }   -> solo admin
//   POST { action: 'commit', uploadId, total, version }               -> solo admin: junta, revisa y publica
// El ESP32 se entera de la versión publicada por /api/bell (línea 9) y, si es mayor que la suya,
// descarga el binario con:
//   GET  ?key=BELL_DEVICE_KEY  -> binario completo (application/octet-stream) + cabecera x-md5
//
// Se guarda en Vercel KV (sin servicios nuevos): trozos "cecyte_fw_chunk_<id>_<n>" y el meta "cecyte_fw_meta".
// La duración máxima de esta función (60 s) se configura en vercel.json.

import crypto from 'crypto';
import { kv } from '@vercel/kv';
import { verifyToken, parseCookies } from '../lib/auth.js';

const FW_META_KEY = 'cecyte_fw_meta';
const MAX_CHUNKS = 12;
const MAX_CHUNK_B64 = 600_000;      // ~450 KB reales por trozo
const MIN_BYTES = 100_000;
const MAX_BYTES = 1_310_720;        // tamaño de la partición OTA del ESP32 (esquema por defecto, 4 MB)
const chunkKey = (id, i) => `cecyte_fw_chunk_${id}_${i}`;

function isAdmin(req) {
    return verifyToken(parseCookies(req).admin_token);
}

async function readFirmware(meta) {
    const keys = Array.from({ length: meta.total }, (_, i) => chunkKey(meta.uploadId, i));
    const parts = await kv.mget(...keys);
    if (parts.some(p => typeof p !== 'string')) return null;
    return Buffer.concat(parts.map(p => Buffer.from(p, 'base64')));
}

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const isDevice = !!process.env.BELL_DEVICE_KEY && req.query.key === process.env.BELL_DEVICE_KEY;
            if (!isDevice) return res.status(401).json({ error: 'No autorizado' });

            const meta = await kv.get(FW_META_KEY);
            if (!meta) return res.status(404).json({ error: 'No hay firmware publicado.' });
            const bin = await readFirmware(meta);
            if (!bin || bin.length !== meta.size) return res.status(500).json({ error: 'Firmware incompleto en la base de datos.' });

            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', bin.length);
            res.setHeader('x-md5', meta.md5);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).send(bin);
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
        if (!isAdmin(req)) return res.status(401).json({ error: 'No autorizado. Inicia sesión de nuevo.' });

        const body = req.body || {};
        const idOk = typeof body.uploadId === 'string' && /^[a-z0-9]{6,24}$/.test(body.uploadId);
        const total = Number(body.total);
        if (!idOk || !Number.isInteger(total) || total < 1 || total > MAX_CHUNKS) {
            return res.status(400).json({ error: 'Datos de subida inválidos.' });
        }

        if (body.action === 'chunk') {
            const index = Number(body.index);
            if (!Number.isInteger(index) || index < 0 || index >= total
                || typeof body.data !== 'string' || body.data.length > MAX_CHUNK_B64 || !/^[A-Za-z0-9+/=]+$/.test(body.data)) {
                return res.status(400).json({ error: 'Trozo inválido.' });
            }
            await kv.set(chunkKey(body.uploadId, index), body.data, { ex: 6 * 3600 }); // si nunca se publica, se borra solo
            return res.status(200).json({ ok: true });
        }

        if (body.action === 'commit') {
            const version = Number(body.version);
            if (!Number.isInteger(version) || version < 1 || version > 9999) {
                return res.status(400).json({ error: 'La versión debe ser un número entero de 1 a 9999.' });
            }
            const old = await kv.get(FW_META_KEY);
            const bin = await readFirmware({ uploadId: body.uploadId, total });
            if (!bin) return res.status(400).json({ error: 'Faltan trozos del archivo. Vuelve a subirlo.' });
            if (bin.length < MIN_BYTES || bin.length > MAX_BYTES) {
                return res.status(400).json({ error: `El archivo mide ${bin.length} bytes; debe estar entre ${MIN_BYTES} y ${MAX_BYTES}.` });
            }
            if (bin[0] !== 0xe9) {
                return res.status(400).json({ error: 'Ese archivo no es un firmware de ESP32. Usa el .ino.bin (no el bootloader, partitions ni merged).' });
            }

            // los trozos nuevos dejan de expirar y los de la versión anterior se borran
            const parts = await kv.mget(...Array.from({ length: total }, (_, i) => chunkKey(body.uploadId, i)));
            await Promise.all(parts.map((p, i) => kv.set(chunkKey(body.uploadId, i), p)));
            const done = {
                version,
                uploadId: body.uploadId,
                total,
                size: bin.length,
                md5: crypto.createHash('md5').update(bin).digest('hex'),
                ts: Date.now()
            };
            await kv.set(FW_META_KEY, done);
            if (old && old.uploadId && old.uploadId !== body.uploadId) {
                await Promise.all(Array.from({ length: old.total }, (_, i) => kv.del(chunkKey(old.uploadId, i))));
            }
            return res.status(200).json({ ok: true, version, size: done.size });
        }

        return res.status(400).json({ error: 'Acción desconocida.' });
    } catch (err) {
        return res.status(500).json({ error: 'No se pudo usar la base de datos (Vercel KV).' });
    }
}
