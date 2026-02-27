// Smart object-fit selection based on photo aspect ratio and slot orientation

/**
 * Apply smart fit to an img element inside a slot.
 *
 * Rules:
 *  - Portrait photo in a portrait slot → cover (both tall, fills the slot)
 *  - Portrait photo in a landscape slot → contain (avoid cropping faces)
 *  - Landscape / square photo → always cover (slight edge crop is fine)
 *
 * @param {HTMLImageElement} img
 * @param {Object}  photo         - serialized photo object with displayWidth/displayHeight
 * @param {boolean} slotIsPortrait - true if the slot is taller than wide
 */
export function applySmartFit(img, photo, slotIsPortrait) {
  const w = photo.displayWidth  || photo.width  || 1;
  const h = photo.displayHeight || photo.height || 1;
  const photoIsPortrait = w / h < 1.0;

  if (photoIsPortrait && !slotIsPortrait) {
    // Portrait photo in a landscape slot: contain to avoid cropping the top/bottom
    img.style.objectFit  = 'contain';
    img.style.background = '#000';
  } else {
    // All other combos: cover
    img.style.objectFit  = 'cover';
    img.style.background = '';
  }
}
