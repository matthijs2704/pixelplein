// Slide renderer: webpage (sandboxed iframe)

/**
 * @param {object} slide
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export function buildWebpageSlide(slide) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;background:#000;';

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
  iframe.sandbox = 'allow-scripts allow-same-origin allow-forms';
  iframe.src     = slide.src || 'about:blank';

  wrap.appendChild(iframe);

  const durationMs = (slide.durationSec || 15) * 1000;

  function play() {
    return new Promise(resolve => setTimeout(resolve, durationMs));
  }

  return { el: wrap, play };
}
