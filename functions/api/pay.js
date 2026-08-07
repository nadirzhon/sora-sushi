/* Создание платежа. Cloudflare Pages Function → POST /api/pay
 *
 * Провайдер выбирается переменной окружения PAY_PROVIDER:
 *   freedompay — Кыргызстан. Одна интеграция даёт Visa/Mastercard/Элкарт,
 *                О!Деньги, Balance.kg, MegaPay, MBank и Optima24.
 *                Нужны: FREEDOMPAY_MERCHANT_ID, FREEDOMPAY_SECRET
 *                (необязательно FREEDOMPAY_TEST=1 — тестовый режим)
 *   yookassa   — Россия. Нужны: YOOKASSA_SHOP_ID, YOOKASSA_SECRET
 *   link       — любой провайдер, выдающий платёжную ссылку с параметрами.
 *                Нужна: PAY_LINK, например
 *                https://example.kg/pay?amount={sum}&order={order}
 *
 * Сумму ВСЕГДА считаем здесь заново: присланному с клиента итогу доверять нельзя.
 */
import { PROMO, calcTotal, money } from './_price.js';
import { md5 } from './_md5.js';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const xmlValue = (xml, tag) => {
  const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  return m ? m[1].trim() : '';
};

/* Подпись Freedom Pay: md5(имя_скрипта; значения параметров по алфавиту имён; секрет) */
export function fpSign(script, params, secret) {
  const values = Object.keys(params).sort().map(k => params[k]);
  return md5([script, ...values, secret].join(';'));
}

/* GET /api/pay — сайт спрашивает, настроена ли оплата, и только тогда
   показывает способ «Онлайн-картой». Ключи наружу не отдаём. */
export function onRequestGet({ env }) {
  const provider = (env.PAY_PROVIDER || 'freedompay').toLowerCase();
  const ready = {
    freedompay: !!(env.FREEDOMPAY_MERCHANT_ID && env.FREEDOMPAY_SECRET),
    yookassa: !!(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET),
    link: !!env.PAY_LINK,
  }[provider] || false;
  return json({ enabled: ready, provider, test: env.FREEDOMPAY_TEST === '1' });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Некорректный запрос' }, 400); }

  const t = calcTotal(body.items, body.mode);
  if (!t.rows.length) return json({ error: 'Корзина пуста' }, 400);
  if (t.belowMin) return json({ error: `Минимальный заказ на доставку — ${money(PROMO.minOrder)}` }, 400);
  if (t.total <= 0) return json({ error: 'Сумма заказа нулевая' }, 400);

  const order = (String(body.order || '').match(/^[A-Za-z0-9-]{1,20}$/) || [])[0]
    || 'SR-' + Math.abs(Date.now() % 1e9).toString(36).toUpperCase();
  const phone = String((body.customer && body.customer.phone) || '').slice(0, 20);

  const site = new URL(request.url);
  const back = (q) => `${site.origin}/?${q}=${encodeURIComponent(order)}`;

  const provider = (env.PAY_PROVIDER || 'freedompay').toLowerCase();
  const currency = env.PAY_CURRENCY || (provider === 'yookassa' ? 'RUB' : 'KGS');

  try {
    if (provider === 'freedompay') {
      if (!env.FREEDOMPAY_MERCHANT_ID || !env.FREEDOMPAY_SECRET)
        return json({ error: 'Оплата не настроена: нет FREEDOMPAY_MERCHANT_ID / FREEDOMPAY_SECRET' }, 503);

      const params = {
        pg_order_id: order,
        pg_merchant_id: String(env.FREEDOMPAY_MERCHANT_ID),
        pg_amount: t.total.toFixed(2),
        pg_currency: currency,
        pg_description: `Заказ ${order} — Sora Sushi`,
        pg_salt: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        pg_success_url: back('paid'),
        pg_failure_url: back('failed'),
        pg_result_url: `${site.origin}/api/pay-webhook`,
        pg_request_method: 'POST',
        pg_success_url_method: 'GET',
        pg_failure_url_method: 'GET',
        pg_lifetime: '3600',
        pg_language: 'ru',
      };
      if (phone) params.pg_user_phone = phone.replace(/\D/g, '');
      if (env.FREEDOMPAY_TEST === '1') params.pg_testing_mode = '1';
      params.pg_sig = fpSign('init_payment.php', params, env.FREEDOMPAY_SECRET);

      const res = await fetch('https://api.freedompay.kg/init_payment.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
      const xml = await res.text();
      const url = xmlValue(xml, 'pg_redirect_url');
      if (xmlValue(xml, 'pg_status') !== 'ok' || !url)
        return json({ error: xmlValue(xml, 'pg_error_description') || 'Платёж не создан' }, 502);
      return json({ url, total: t.total, currency, payment: xmlValue(xml, 'pg_payment_id') });
    }

    if (provider === 'yookassa') {
      if (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET)
        return json({ error: 'Оплата не настроена: нет YOOKASSA_SHOP_ID / YOOKASSA_SECRET' }, 503);

      const res = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotence-Key': crypto.randomUUID(),
          Authorization: 'Basic ' + btoa(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET}`),
        },
        body: JSON.stringify({
          amount: { value: t.total.toFixed(2), currency },
          capture: true,
          confirmation: { type: 'redirect', return_url: back('paid') },
          description: `Заказ ${order} — Sora Sushi`,
          metadata: { order, phone, mode: String(body.mode || '') },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.confirmation || !data.confirmation.confirmation_url)
        return json({ error: data.description || 'Платёж не создан' }, 502);
      return json({ url: data.confirmation.confirmation_url, total: t.total, currency, payment: data.id });
    }

    if (provider === 'link') {
      if (!env.PAY_LINK) return json({ error: 'Оплата не настроена: нет PAY_LINK' }, 503);
      const url = env.PAY_LINK
        .replace('{sum}', t.total.toFixed(2))
        .replace('{order}', encodeURIComponent(order));
      return json({ url, total: t.total, currency });
    }

    return json({ error: `Неизвестный провайдер: ${provider}` }, 500);
  } catch (err) {
    return json({ error: 'Платёжный сервис недоступен: ' + err.message }, 502);
  }
}
