// Shared lifecycle manager for screen renderables (photo layouts + slides).
// Owns transition handoff and cancellation/cleanup semantics.

import { runTransition } from './transitions.js';

function _safeCall(fn, arg) {
  if (typeof fn !== 'function') return;
  try { fn(arg); } catch {}
}

async function _safeCallAsync(fn, arg) {
  if (typeof fn !== 'function') return;
  try { await fn(arg); } catch {}
}

export function createLayoutLifecycle(container) {
  /** @type {{ el: HTMLElement, controller: AbortController, onWillShow?: Function, onDidShow?: Function, onWillHide?: Function, destroy?: Function }|null} */
  let _current = null;
  let _version = 0;

  function _isActive(version, entry) {
    return _version === version && _current === entry && !entry.controller.signal.aborted;
  }

  async function showRenderable(renderable, transitionType, transitionMs) {
    if (!renderable?.el) return false;

    const version = ++_version;
    const prev    = _current;

    if (prev) {
      if (prev.el?.querySelector?.('video')) {
        console.warn('[layout-lifecycle] replacing a renderable that contains a <video> before it finished — this is what cuts video playback short.');
      }
      _safeCall(prev.onWillHide, { reason: 'replace', signal: prev.controller.signal });
      prev.controller.abort();
    }

    const next = {
      el: renderable.el,
      controller: new AbortController(),
      onWillShow: renderable.onWillShow,
      onDidShow:  renderable.onDidShow,
      onWillHide: renderable.onWillHide,
      destroy:    renderable.destroy,
    };
    _current = next;

    if (!next.el.isConnected) container.appendChild(next.el);

    await _safeCallAsync(next.onWillShow, { reason: 'show', signal: next.controller.signal });
    if (!_isActive(version, next)) {
      _safeCall(next.destroy);
      if (next.el.isConnected) next.el.remove();
      return false;
    }

    await runTransition(prev?.el || null, next.el, transitionType || 'fade', transitionMs || 800);

    if (!_isActive(version, next)) {
      _safeCall(next.destroy);
      if (next.el.isConnected) next.el.remove();
      return false;
    }

    if (prev) _safeCall(prev.destroy);

    // Defensive cleanup: keep only the active element.
    for (const child of Array.from(container.children)) {
      if (child !== next.el) child.remove();
    }

    await _safeCallAsync(next.onDidShow, { reason: 'shown', signal: next.controller.signal });
    return _isActive(version, next);
  }

  function clear(reason = 'stop') {
    _version += 1;
    const current = _current;
    _current = null;
    if (!current) return;

    _safeCall(current.onWillHide, { reason, signal: current.controller.signal });
    current.controller.abort();
    _safeCall(current.destroy);
    if (current.el?.isConnected) current.el.remove();

    for (const child of Array.from(container.children)) child.remove();
  }

  function getCurrentElement() {
    return _current?.el || null;
  }

  return {
    showRenderable,
    clear,
    getCurrentElement,
  };
}
