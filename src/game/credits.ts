
const MKK = 'Min Khant Ko';
const KKA = 'Kaung Khant Aung';
const SHT = 'Shin Htet Toe';
const KST = 'Kaung Si Thu';
const ATH = 'Aung Thet Hlyan Oo';
const PY = 'Paing Yamoun';

export const CREDITS: [string, string[]][] = [
  ['Project name', ['Lunar Recon']],
  ['Game Director', [SHT]],
  ['Gameplay Programmer', [MKK, KKA]],
  ['3D graphics', [MKK, SHT]],
  ['Sound and Music', [ATH]],
  ['Font and Language', [PY]],
  ['Data research', [KST, SHT]],
  ['Quality Tester', [PY, SHT]],
  
];

export const TOOL_CREDITS: [string, string[]][] = [
  ['Engine and code', ['three.js', 'postprocessing', 'Rapier physics', 'Preact', 'Vite', 'TypeScript']],
  ['3D tools', ['Blender', 'gltfpack']],
  ['Voices', ['Kokoro TTS']],
  ['Rocks and textures', ['Poly Haven (CC0)']],
  ['Earth image', ['NASA Blue Marble']],
  ['Fonts', ['Atkinson Hyperlegible Next', 'B612 Mono', 'Orbitron', 'Noto Sans Myanmar']],
  ['Video tools', ['ffmpeg']],
  ['Testing', ['Playwright', 'Chrome']],
];

/** Every source behind the game's facts and assets: [group, [label, link][]]. */
export const DATA_RESOURCES: [string, [string, string][]][] = [
  ['NASA', [
    ['Moon facts', 'https://science.nasa.gov/moon/'],
    ['Artemis (lunar south pole)', 'https://www.nasa.gov/artemis/'],
    ['Life Support Baseline Values and Assumptions Document', 'https://ntrs.nasa.gov'],
    ['ISS ECLSS overview and status reports', 'https://www.nasa.gov/international-space-station/'],
    ['NASA Glenn: photovoltaics and energy storage', 'https://www.nasa.gov/glenn-research-center/'],
    ['VSAT (Vertical Solar Array Technology)', 'https://www.nasa.gov/space-technology-mission-directorate/'],
    ['LRO Diviner', 'https://www.diviner.ucla.edu/'],
    ['Lunar Sample Compendium', 'https://curator.jsc.nasa.gov/lunar/'],
    ['Veggie (Vegetable Production System)', 'https://www.nasa.gov/'],
    ['NASA-STD-3001', 'https://standards.nasa.gov/'],
  ]],
  ['Other science sources', [
    ['NOAA Space Weather Prediction Center', 'https://www.swpc.noaa.gov/'],
    ['Zhang et al., Science Advances (2020)', 'https://www.science.org/journal/sciadv'],
    ['University of Arizona CEAC', 'https://ceac.arizona.edu/'],
    ['Cornell CEA', 'https://cea.cals.cornell.edu/'],
  ]],
  ['Images and models', [
    ['Poly Haven rocks and textures (CC0)', 'https://polyhaven.com'],
    ['NASA Blue Marble (Earth image)', 'https://visibleearth.nasa.gov/collection/1484/blue-marble'],
  ]],
];

/** How AI was used: [tool, what it did, optional link]. */
export const AI_USAGE: [string, string, string?][] = [
  [
    'Kokoro TTS (open-source text-to-speech model)',
    'Ran offline on our own computer to turn our written scripts into the English voice lines: 168 short MP3 clips for Mission Control, the crew (commander, medic, scientist) and the narration of every secret-discovery cutscene. We wrote all the words ourselves, picked a voice for each character and slowed the speech slightly so young players can follow it.',
    'https://github.com/hexgrad/kokoro',
  ],
  [
    'Free Text to Speech Online',
    'An online text-to-speech tool we used to turn our own written lines into extra spoken audio. The words come from the team; the tool only reads them aloud.',
    'https://www.text-to-speech.online/en/',
  ],
  [
    'Claude Code (Anthropic)',
    'An AI coding assistant that helped us write and fix the game code (TypeScript), the automated Playwright test scripts, the build and GitHub Pages publishing setup, and the project documents. The team decided what to build, ran the game and tested every mission.',
    'https://claude.com/claude-code',
  ],
];
