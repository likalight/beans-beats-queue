// Starting menu (Beans&Beats WIP menu, Nov 2026). Loaded on first boot only;
// change it live from the Menu screen. Prices in cents (SGD).
// Iced surcharge (+$1) lives in settings.icedSurcharge; oat milk is +$1.
// "Black" drinks (espresso, americano, pourover) have no milk option.
module.exports = [
  { kind: 'item', id: 'espresso', data: { name: 'Espresso', price: 300, temps: ['hot'], milk: false, sort: 1, soldOut: false } },
  { kind: 'item', id: 'americano', data: { name: 'Americano', price: 600, temps: ['hot', 'iced'], milk: false, sort: 2, soldOut: false } },
  { kind: 'item', id: 'latte', data: { name: 'Latte', price: 800, temps: ['hot', 'iced'], milk: true, sort: 3, soldOut: false } },
  { kind: 'item', id: 'flatwhite', data: { name: 'Flat White', price: 800, temps: ['hot', 'iced'], milk: true, sort: 4, soldOut: false } },
  { kind: 'item', id: 'pourover', data: { name: 'Pourover', price: 1000, temps: ['hot', 'iced'], milk: false, sort: 5, soldOut: false } },
  { kind: 'milk', id: 'milk', data: { name: 'Milk', surcharge: 0, sort: 1, soldOut: false } },
  { kind: 'milk', id: 'oat', data: { name: 'Oat', surcharge: 100, sort: 2, soldOut: false } },
];
