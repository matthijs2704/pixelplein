// Chrome overlay — adds channel badge, like counter, and occasional
// comment popup on top of any visible photo, regardless of which layout
// rendered it. Subscribes to layout:cycle events from the base lifecycle
// + hype state changes.
//
// Strategy: walk the live DOM for <img data-photo-id="..."> nodes each
// cycle, attach a badge to each photo's parent if not already there,
// and update like counters in place when state changes.

import { onScreenEvent } from '/screen/module-registry.js';
import {
  getChannel,
  getChannels,
  getPhotoChannel,
  getPhotoLikes,
  getPhotoViral,
  getRecentComments,
  onHypeChange,
} from './state-client.js';

const ATTR_OWNED = 'data-hype-chrome';
let _mounted = false;
let _offEvent = null;
let _offState = null;
let _commentTimer = null;

function _fmtLikes(n) {
  if (n >= 10_000) return Math.round(n / 1000) + 'K';
  if (n >= 1000)   return (n / 1000).toFixed(1) + 'K';
  return String(n | 0);
}

function _resolveChannel(photoId) {
  const id = getPhotoChannel(photoId);
  if (id) return getChannel(id);
  const channels = getChannels();
  return channels[0] || null;
}

function _ensureBadge(img) {
  const photoId = img.dataset.photoId;
  if (!photoId) return;
  const parent = img.parentElement;
  if (!parent) return;

  // Re-use the slot wrapper, set position relative if needed.
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

  let badge = parent.querySelector(`:scope > [${ATTR_OWNED}="badge"]`);
  if (!badge) {
    badge = document.createElement('div');
    badge.setAttribute(ATTR_OWNED, 'badge');
    badge.className = 'hype-chrome-badge';
    parent.appendChild(badge);
  }
  const ch = _resolveChannel(photoId);
  if (ch) {
    badge.style.setProperty('--ch-color', ch.color || '#7c5cff');
    badge.innerHTML = `<span class="hype-chrome-badge-emoji">${ch.emoji || '✨'}</span>` +
                      `<span class="hype-chrome-badge-handle">${escapeHtml(ch.handle || '')}</span>`;
  }

  let counter = parent.querySelector(`:scope > [${ATTR_OWNED}="likes"]`);
  if (!counter) {
    counter = document.createElement('div');
    counter.setAttribute(ATTR_OWNED, 'likes');
    counter.className = 'hype-chrome-likes';
    counter.innerHTML = `<span class="hype-chrome-heart">♥</span><span class="hype-chrome-likes-num"></span>`;
    parent.appendChild(counter);
  }
  const num = counter.querySelector('.hype-chrome-likes-num');
  if (num) num.textContent = _fmtLikes(getPhotoLikes(photoId));

  // Viral badge
  const isViral = getPhotoViral(photoId);
  let viral = parent.querySelector(`:scope > [${ATTR_OWNED}="viral"]`);
  if (isViral && !viral) {
    viral = document.createElement('div');
    viral.setAttribute(ATTR_OWNED, 'viral');
    viral.className = 'hype-chrome-viral';
    viral.textContent = '🔥 viral';
    parent.appendChild(viral);
  } else if (!isViral && viral) {
    viral.remove();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _refreshAll() {
  const imgs = document.querySelectorAll('img[data-photo-id]');
  for (const img of imgs) _ensureBadge(img);
}

function _scheduleCommentPopup() {
  if (_commentTimer) return;
  _commentTimer = setInterval(() => {
    const imgs = Array.from(document.querySelectorAll('img[data-photo-id]'));
    if (!imgs.length) return;
    const img = imgs[Math.floor(Math.random() * imgs.length)];
    const photoId = img.dataset.photoId;
    const comments = getRecentComments(photoId, 3);
    if (!comments.length) return;
    const comment = comments[Math.floor(Math.random() * comments.length)];
    _popComment(img, comment);
  }, 6000);
}

function _popComment(img, comment) {
  const parent = img.parentElement;
  if (!parent) return;
  const ch = _resolveChannel(img.dataset.photoId);
  const node = document.createElement('div');
  node.className = 'hype-chrome-comment';
  node.style.setProperty('--ch-color', ch?.color || '#7c5cff');
  node.innerHTML = `<span class="hype-chrome-comment-author">${escapeHtml(comment.author)}</span>` +
                   `<span class="hype-chrome-comment-text">${escapeHtml(comment.text)}</span>`;
  parent.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 400);
  }, 3500);
}

export const overlay = {
  id: 'hype:chrome',
  applies: () => true,
  mount() {
    if (_mounted) return;
    _mounted = true;
    document.body.classList.add('hype-active');
    _offEvent = onScreenEvent('layout:cycle', () => {
      // Slight delay so layout DOM is settled.
      setTimeout(_refreshAll, 60);
    });
    _offState = onHypeChange(() => _refreshAll());
    _scheduleCommentPopup();
    _refreshAll();
  },
  remove() {
    if (!_mounted) return;
    _mounted = false;
    document.body.classList.remove('hype-active');
    if (_offEvent) { _offEvent(); _offEvent = null; }
    if (_offState) { _offState(); _offState = null; }
    if (_commentTimer) { clearInterval(_commentTimer); _commentTimer = null; }
    // Strip badges
    for (const node of document.querySelectorAll(`[${ATTR_OWNED}]`)) node.remove();
  },
};
