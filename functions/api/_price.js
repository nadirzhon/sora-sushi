/* Расчёт суммы заказа на сервере.
   ВАЖНО: клиентскому итогу доверять нельзя — сумму платежа считаем только здесь.
   Цены и акции продублированы из index.html; при правке меню обновляйте оба места. */

/* Валюта витрины. Меняете здесь — поменяйте CURRENCY в index.html. */
export const CURRENCY_LABEL = 'сом';
export const money = n => n.toLocaleString('ru-RU') + ' ' + CURRENCY_LABEL;

export const PROMO = {
  minOrder: 700,
  deliveryFee: 200,
  freeFrom: 1500,
  pickupOff: 0.10, pickupMax: 150,
  giftFromItems: 3,
  gift: { name: 'Чайник сенчи 500 мл', price: 190 },
  tiers: [{ from: 5000, off: 0.12 }, { from: 3000, off: 0.08 }, { from: 2000, off: 0.05 }],
};

const ITEMS = [
  { id: 'phila', name: 'Филадельфия', price: 390 },
  { id: 'california', name: 'Калифорния', price: 360 },
  { id: 'dragon', name: 'Дракон', price: 520 },
  { id: 'spicy', name: 'Спайси лосось', price: 340 },
  { id: 'tempura-roll', name: 'Темпура с креветкой', price: 450 },
  { id: 'veg', name: 'Овощной', price: 260 },
  { id: 'nig-salmon', name: 'Нигири лосось', price: 180 },
  { id: 'nig-tuna', name: 'Нигири тунец', price: 220 },
  { id: 'nig-eel', name: 'Нигири угорь', price: 240 },
  { id: 'gunkan', name: 'Гункан с икрой', price: 260 },
  { id: 'miso', name: 'Мисо-суп', price: 190 },
  { id: 'gyoza', name: 'Гёдза', price: 290 },
  { id: 'tempura', name: 'Темпура-креветки', price: 420 },
  { id: 'tea', name: 'Зелёный чай', price: 190 },
  { id: 'lemonade', name: 'Домашний лимонад', price: 220 },
  { id: 'sake', name: 'Саке', price: 390 },
  { id: 'set-lite', name: 'Сет Sora Lite', price: 1190, noDiscount: true },
  { id: 'set-big', name: 'Сет Sora Big', price: 2290, noDiscount: true },
  { id: 'set-yozora', name: 'Сет Yozora', price: 3690, noDiscount: true },
];

export const CATALOG = Object.fromEntries(ITEMS.map(i => [i.id, i]));

export function calcTotal(items, mode = 'Доставка') {
  const rows = (Array.isArray(items) ? items : [])
    .map(i => {
      const c = CATALOG[i && i.id];
      const qty = Math.min(50, Math.max(0, parseInt(i && i.qty, 10) || 0));
      return c && qty ? { ...c, qty } : null;
    })
    .filter(Boolean);

  const count = rows.reduce((s, r) => s + r.qty, 0);
  const subtotal = rows.reduce((s, r) => s + r.price * r.qty, 0);
  const base = rows.filter(r => !r.noDiscount).reduce((s, r) => s + r.price * r.qty, 0);

  const tier = PROMO.tiers.find(t => subtotal >= t.from) || null;
  const discount = tier ? Math.round(base * tier.off) : 0;

  const pickup = mode === 'Самовывоз';
  const booking = mode === 'Бронь стола';
  const pickupOff = pickup && subtotal > 0
    ? Math.min(PROMO.pickupMax, Math.round(subtotal * PROMO.pickupOff)) : 0;
  const delivery = (pickup || booking || subtotal === 0)
    ? 0 : (subtotal >= PROMO.freeFrom ? 0 : PROMO.deliveryFee);

  return {
    rows, count, subtotal, tier, discount, pickupOff, delivery,
    gift: count >= PROMO.giftFromItems ? PROMO.gift : null,
    total: Math.max(0, subtotal - discount - pickupOff) + delivery,
    belowMin: !pickup && !booking && subtotal > 0 && subtotal < PROMO.minOrder,
  };
}
