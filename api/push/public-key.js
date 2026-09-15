// GET /api/push/public-key — le da al navegador la llave publica VAPID
// (esta llave NO es secreta, es la que necesita el navegador para suscribirse).

export default function handler(req, res) {
    return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
}
