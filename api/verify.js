import { kv } from '@vercel/kv';

/**
 * مفاتيح التفعيل المسموح بها.
 * - lifetime: تفعيل مدى الحياة
 * - subscription: اشتراك 6 أشهر (للاختبار حالياً 5 دقائق)
 *
 * ⚠️ غيّر هذه القوائم عند إصدار مفاتيح جديدة للعملاء.
 */
const LIFETIME_KEYS = ["X7R9W2", "4B9Z1K"];
const SUBSCRIPTION_KEYS = ["SUB6M-TEST1", "SUB6M-TEST2", "SUB-6MONTH-01"];

/** مدة الاشتراك للاختبار: 5 دقائق. لاحقاً غيّرها إلى 6 أشهر:
 *  6 * 30 * 24 * 60 * 60 * 1000
 */
const SUBSCRIPTION_DURATION_MS = 5 * 60 * 1000; // 5 دقائق للاختبار

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(404).json({ status: 'error', message: 'Not Found' });
  }

  const { key, deviceId } = req.body || {};

  if (!key || !deviceId) {
    return res.status(400).json({
      status: 'error',
      message: 'بيانات ناقصة (المفتاح أو معرّف اللوحة الأم)',
    });
  }

  const normalizedKey = String(key).trim();

  const isLifetime = LIFETIME_KEYS.includes(normalizedKey);
  const isSubscription = SUBSCRIPTION_KEYS.includes(normalizedKey);

  if (!isLifetime && !isSubscription) {
    return res.status(401).json({ status: 'error', message: 'المفتاح غير صحيح' });
  }

  const licenseRecordKey = `license:${normalizedKey}`;
  const licenseType = isSubscription ? 'subscription' : 'lifetime';

  try {
    const existing = await kv.get(licenseRecordKey);

    // المفتاح مربوط بالفعل بلوحة أم / جهاز آخر
    if (existing && existing.deviceId && existing.deviceId !== deviceId) {
      return res.status(403).json({
        status: 'error',
        message: 'تم استخدام هذا المفتاح على جهاز آخر من قبل',
      });
    }

    if (existing && existing.revoked) {
      return res.status(403).json({
        status: 'error',
        message: 'تم إلغاء تفعيل هذا المفتاح',
      });
    }

    const now = Date.now();
    const record = {
      key: normalizedKey,
      deviceId,
      activatedAt: existing?.activatedAt || now,
      revoked: false,
      idType: 'motherboard',
      type: licenseType,
    };

    if (isSubscription) {
      // إذا كان موجوداً ولم ينتهِ بعد، لا نعيد تعيين المدة (نفس سلوك التجربة)
      if (existing && existing.expiresAt && existing.expiresAt > now && existing.deviceId === deviceId) {
        record.expiresAt = existing.expiresAt;
      } else {
        // تفعيل جديد أو تجديد بعد الانتهاء
        record.expiresAt = now + SUBSCRIPTION_DURATION_MS;
      }
    }
    // lifetime: لا يوجد expiresAt

    await kv.set(licenseRecordKey, record);
    await kv.set(`device:${deviceId}`, normalizedKey);

    const response = { status: 'success', type: licenseType };
    if (isSubscription) {
      response.expiresAt = record.expiresAt;
      response.remaining = Math.max(0, record.expiresAt - now);
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error('verify.js KV error:', err);
    return res.status(500).json({
      status: 'error',
      message:
        'فشل الاتصال بقاعدة بيانات KV: ' +
        (err && err.message ? err.message : String(err)),
    });
  }
}
