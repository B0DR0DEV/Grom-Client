export interface ModPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  mods: { slug: string; name: string }[];
}

export const MOD_PRESETS: ModPreset[] = [
  {
    id: 'optimization',
    name: 'Оптимизация',
    icon: '⚡',
    description: 'Максимум FPS для слабых ПК',
    mods: [
      { slug: 'sodium', name: 'Sodium' },
      { slug: 'lithium', name: 'Lithium' },
      { slug: 'ferrite-core', name: 'FerriteCore' },
      { slug: 'immediately-fast', name: 'ImmediatelyFast' },
      { slug: 'krypton', name: 'Krypton' },
      { slug: 'memoryleakfix', name: 'Memory Leak Fix' },
    ],
  },
  {
    id: 'pvp',
    name: 'PvP',
    icon: '⚔️',
    description: 'Для боевых серверов',
    mods: [
      { slug: 'sodium', name: 'Sodium' },
      { slug: 'lithium', name: 'Lithium' },
      { slug: 'appleskin', name: 'AppleSkin' },
      { slug: 'better-hurt-cam', name: 'Better Hurt Cam' },
      { slug: 'no-telemetry', name: 'No Telemetry' },
    ],
  },
  {
    id: 'survival',
    name: 'Выживание',
    icon: '🌲',
    description: 'Улучшения для одиночной игры',
    mods: [
      { slug: 'sodium', name: 'Sodium' },
      { slug: 'lithium', name: 'Lithium' },
      { slug: 'appleskin', name: 'AppleSkin' },
      { slug: 'roughly-enough-items', name: 'REI' },
      { slug: 'xaeros-minimap', name: "Xaero's Minimap" },
      { slug: 'jei', name: 'JEI' },
    ],
  },
  {
    id: 'tech',
    name: 'Техно',
    icon: '⚙️',
    description: 'Create, механизмы, автоматизация',
    mods: [
      { slug: 'sodium', name: 'Sodium' },
      { slug: 'create', name: 'Create' },
      { slug: 'jei', name: 'JEI' },
      { slug: 'jade', name: 'Jade' },
      { slug: 'roughly-enough-items', name: 'REI' },
    ],
  },
];