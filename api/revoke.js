import { kv } from '@vercel/kv';

/**
 * إلغاء تفعيل جهاز معين (Unbind + تحرير المفتاح).
 *
 * الحماية: يتطلب adminSecret في الـ body يطابق ADMIN_SECRET
 *
 * الاستخدام عبر Postman:
 *   POST /api/revoke
 *   Body (JSON):
 *   {
 *     "adminSecret": "القيمة_السرية_اللي_حطيتها_في_ENV",
 *     "deviceId": "hash_معرّف_اللوحة_الأم"
 *   }
 *
 * اختياري:
 *   "revokeKey": true   ← لو حابب تلغي المفتاح نهائياً (revoked: true)
 *                         بدل ما تحرره لجهاز آخر
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(404).json({ success: false, message: 'Not Found' });
  }

  const { adminSecret, deviceId, revokeKey = false } = req.body || {};
  const expectedSecret = process.env.ADMIN_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({
      success: false,
      message: 'ADMIN_SECRET غير مضبوط في متغيرات البيئة',
    });
  }

  if (!adminSecret || adminSecret !== expectedSecret) {
    return res.status(403).json({
      success: false,
      message: 'مفتاح الإدارة غير صحيح',
    });
  }

  if (!deviceId) {
    return res.status(400).json({
      success: false,
      message: 'معرّف اللوحة الأم (deviceId) مطلوب',
    });
  }

  try {
    const deviceKey = `device:${deviceId}`;
    const boundKey = await kv.get(deviceKey);

    if (!boundKey) {
      return res.status(200).json({
        success: true,
        message: 'الجهاز غير مفعّل أصلاً (لا يوجد ربط)',
        deviceId,
        unbound: false,
      });
    }

    const licenseKey = `license:${boundKey}`;
    const license = await kv.get(licenseKey);

    // 1) حذف ربط الجهاز
    await kv.del(deviceKey);

    // 2) تحديث سجل الرخصة
    if (license) {
      if (revokeKey) {
        // إلغاء نهائي للمفتاح
        await kv.set(licenseKey, {
          ...license,
          revoked: true,
          revokedAt: Date.now(),
          revokedDeviceId: deviceId,
        });
      } else {
        // تحرير المفتاح عشان يقدر يتفعل على جهاز آخر
        const { deviceId: _, ...rest } = license;
        await kv.set(licenseKey, {
          ...rest,
          deviceId: null,
          unboundAt: Date.now(),
          previousDeviceId: deviceId,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: revokeKey
        ? 'تم إلغاء تفعيل الجهاز وإلغاء المفتاح نهائياً'
        : 'تم إلغاء تفعيل الجهاز وتحرير المفتاح',
      deviceId,
      previousKey: boundKey,
      revokedKey: !!revokeKey,
      unbound: true,
    });
  } catch (err) {
    console.error('revoke.js KV error:', err);
    return res.status(500).json({
      success: false,
      message:
        'فشل الاتصال بقاعدة بيانات KV: ' +
        (err && err.message ? err.message : String(err)),
    });
  }
}
