
const MKK = 'Min Khant Ko';
const KKA = 'Kaung Khant Aung';
const SHT = 'Shin Htet Toe';
const KST = 'Kaung Si Thu';
const ATH = 'Aung Thet Hlyan Oo';
const PY = 'Paing Yamoun';

export const CREDITS: [string, string[]][] = [
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
