/* Уведомление об оплате. Cloudflare Pages Function → POST /api/pay-webhook
 *
 * Freedom Pay шлёт форму и ждёт XML-ответ; ЮKassa шлёт JSON и ждёт 200.
 * Подпись Freedom Pay проверяем — без этого кто угодно может прислать
 * «оплачено». Для ЮKassa подписи нет, поэтому статус перезапрашиваем у API.
 *
 * Если заданы TELEGRAM_TOKEN и TELEGRAM_CHAT — присылаем уведомление в чат.
 */
import { fpSign } from './pay.js';

const xml = (body) =>
  new Response(`<?xml version="1.0" encoding="utf-8"?><response>${body}</response>`,
    { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });

async function notify(env, text) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT, text }),
  }).catch(() => {});
}

export async function onRequestPost({ request, env }) {
  const type = request.headers.get('content-type') || '';

  /* ——— Freedom Pay ——— */
  if (type.includes('form')) {
    const form = Object.fromEntries(await request.formData());
    const got = form.pg_sig;
    delete form.pg_sig;
    const want = fpSign('pay-webhook', form, env.FREEDOMPAY_SECRET || '');
    const salt = form.pg_salt || '';

    if (!got || got !== want) {
      const body = `<pg_status>error</pg_status><pg_error_description>Неверная подпись</pg_error_description>`;
      return xml(body + `<pg_salt>${salt}</pg_salt>`);
    }
    if (form.pg_result === '1') {
      await notify(env,
        `Оплачен заказ ${form.pg_order_id}\nСумма: ${form.pg_amount} ${form.pg_currency || ''}\n` +
        `Платёж: ${form.pg_payment_id}\nСпособ: ${form.pg_payment_system_name || form.pg_payment_method || '—'}`);
    } else {
      await notify(env, `Оплата не прошла по заказу ${form.pg_order_id}: ${form.pg_failure_description || '—'}`);
    }
    const out = { pg_status: 'ok', pg_description: 'Заказ принят', pg_salt: salt };
    const sig = fpSign('pay-webhook', out, env.FREEDOMPAY_SECRET || '');
    return xml(Object.entries(out).map(([k, v]) => `<${k}>${v}</${k}>`).join('') + `<pg_sig>${sig}</pg_sig>`);
  }

  /* ——— ЮKassa ——— */
  let ev;
  try { ev = await request.json(); } catch { return new Response('bad request', { status: 400 }); }
  if (ev.event === 'payment.succeeded' && env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET) {
    const id = ev.object && ev.object.id;
    /* перезапрашиваем платёж у ЮKassa — уведомление само по себе не доказательство */
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${id}`, {
      headers: { Authorization: 'Basic ' + btoa(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET}`) },
    });
    const p = await res.json().catch(() => ({}));
    if (p.status === 'succeeded') {
      await notify(env,
        `Оплачен заказ ${(p.metadata && p.metadata.order) || '—'}\n` +
        `Сумма: ${p.amount && p.amount.value} ${p.amount && p.amount.currency}\nПлатёж: ${p.id}`);
    }
  }
  return new Response('ok');
}
