const wrap = (paths) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
export const icons = {
  home: wrap('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>'),
  invite: wrap('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.7 3-6 7-6s7 2.3 7 6"/><path d="M18 8v7M14.5 11.5h7"/>'),
  profile: wrap('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
  promo: wrap('<path d="m5 6 14 0 2 4-4 9H7L3 10z"/><path d="M8 11h8M9 15h6"/>'),
  leaderboard: wrap('<path d="M8 20V9h3v11M13 20V4h3v16M3 20v-6h3v6M3 20h18"/>'),
  task: wrap('<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>'),
  wallet: wrap('<path d="M4 6h15a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><path d="M4 6V4h13a2 2 0 0 1 2 2"/><path d="M16 13h3"/>'),
  convert: wrap('<path d="M7 7h10l-2-2M17 17H7l2 2"/><path d="M17 7a6 6 0 0 1 0 10M7 17A6 6 0 0 1 7 7"/>'),
  transfer: wrap('<path d="M7 7h13l-3-3M17 17H4l3 3"/><path d="M20 7H7M4 17h13"/>'),
  back: wrap('<path d="m15 5-7 7 7 7"/>'),
  copy: wrap('<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  settings: wrap('<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M4 12H2m20 0h-2M12 4V2m0 20v-2m5.7-14.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m15.2 14.2-1.4-1.4"/>')
};
