// Límite de intentos fallidos por IP (en KV). Si KV falla, no se bloquea a nadie: el login sigue funcionando.

export function ipDe(req) {
    const h = req.headers && req.headers['x-forwarded-for'];
    const crudo = (Array.isArray(h) ? h[0] : h) || (req.socket && req.socket.remoteAddress) || 'sin-ip';
    return String(crudo).split(',')[0].trim().slice(0, 64);
}

export async function bloqueado(kv, clave, max) {
    try { return (Number(await kv.get(clave)) || 0) >= max; } catch (e) { return false; }
}

export async function anotarFallo(kv, clave, ventanaS) {
    try {
        const n = await kv.incr(clave);
        if (n === 1) await kv.expire(clave, ventanaS);
    } catch (e) { /* sin KV: no se cuenta */ }
}

export async function olvidar(kv, clave) {
    try { await kv.del(clave); } catch (e) { /* idem */ }
}
