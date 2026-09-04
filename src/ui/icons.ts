import checkCircle from "@phosphor-icons/core/assets/fill/check-circle-fill.svg?raw";
import warning from "@phosphor-icons/core/assets/fill/warning-fill.svg?raw";
import camera from "@phosphor-icons/core/assets/light/camera-light.svg?raw";
import gameController from "@phosphor-icons/core/assets/light/game-controller-light.svg?raw";
import handPalm from "@phosphor-icons/core/assets/light/hand-palm-light.svg?raw";
import handPeace from "@phosphor-icons/core/assets/light/hand-peace-light.svg?raw";

/**
 * Phosphor Icons (MIT), inlined from the package at build time.
 *
 * A drawn set rather than hand-rolled paths, because this UI has no words left
 * in it: every affordance is carried by its icon, and an icon family that was
 * designed together is the only way two of them read as the same voice. It also
 * has the two gestures the station actually teaches - hand-peace and hand-palm -
 * which is rare, and worth more than a smaller download.
 *
 * `?raw` keeps them on-device: the SVG source is inlined into the bundle, so
 * nothing is fetched at runtime. See docs/adr/0010-reactive-glass-menu.md.
 *
 * Light weight for the large mode glyphs, where a hairline reads as glass over
 * a moving picture. Filled for the small status glyphs, where a hairline at
 * 22 px over a face simply disappears.
 */
export const ICON = {
  camera,
  gameController,
  handPalm,
  handPeace,
  checkCircle,
  warning,
} as const;

export type IconName = keyof typeof ICON;
