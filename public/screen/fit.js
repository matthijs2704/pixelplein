// Smart object-fit selection based on photo aspect ratio and slot orientation

/**
 * Apply smart fit to an img element inside a slot.
 *
 * Rules:
 *  - Use cover for all slot/photo combinations so tiles never show letterboxing.
 *  - Keep a stable center crop to avoid visible jump during swaps.
 *
 * @param {HTMLImageElement} img
 * @param {Object}  photo         - serialized photo object with displayWidth/displayHeight
 * @param {boolean} slotIsPortrait - true if the slot is taller than wide
 */
export function applySmartFit(img, photo, slotIsPortrait) {
  void photo;
  void slotIsPortrait;

  img.style.objectFit = 'cover';
  img.style.objectPosition = '50% 50%';
  img.style.background = '';
}
