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
  getGeneralAccount,
  getPhotoChannel,
  getPhotoLikes,
  getPhotoViral,
  getRecentComments,
  onHypeChange,
} from './state-client.js';
import { icon, monogramAvatar } from './icons.js';
import { fmtCount } from './format.js';

const ATTR_OWNED = 'data-hype-chrome';
let _mounted = false;
let _offEvent = null;
let _offState = null;
let _commentTimer = null;

function _resolveChannel(photoId) {
  const id = getPhotoChannel(photoId);
  if (id) return getChannel(id);
  return getGeneralAccount();
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
    badge.innerHTML = monogramAvatar(ch.name, ch.color, 28, ch.avatar_url || ch.avatarUrl || '') +
      `<span class="hype-chrome-badge-handle">${escapeHtml(ch.handle || '')}</span>` +
      `<span class="hype-chrome-verified">${icon.verified(14)}</span>`;
  }

  let counter = parent.querySelector(`:scope > [${ATTR_OWNED}="likes"]`);
  if (!counter) {
    counter = document.createElement('div');
    counter.setAttribute(ATTR_OWNED, 'likes');
    counter.className = 'hype-chrome-likes';
    counter.innerHTML = `<span class="hype-chrome-heart">${icon.heartFill(16)}</span><span class="hype-chrome-likes-num"></span>`;
    parent.appendChild(counter);
  }
  const num = counter.querySelector('.hype-chrome-likes-num');
  if (num) num.textContent = fmtCount(getPhotoLikes(photoId));

  // Viral badge uses the module icon set.
  const isViral = getPhotoViral(photoId);
  let viral = parent.querySelector(`:scope > [${ATTR_OWNED}="viral"]`);
  if (isViral && !viral) {
    viral = document.createElement('div');
    viral.setAttribute(ATTR_OWNED, 'viral');
    viral.className = 'hype-chrome-viral';
    viral.innerHTML = `${icon.flame(14)}<span>viral</span>`;
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

// Layouts with their own channel/like chrome (post card, story, reels, …)
// opt out via data-hype-chrome-skip so identity isn't shown twice.
const IMG_SELECTOR = 'img[data-photo-id]:not([data-hype-chrome-skip])';

function _refreshAll() {
  const imgs = document.querySelectorAll(IMG_SELECTOR);
  for (const img of imgs) _ensureBadge(img);
}

function _scheduleCommentPopup() {
  if (_commentTimer) return;
  _commentTimer = setInterval(() => {
    // Only pick photos that actually have comments — a random pick used to
    // land on commentless photos most rounds, so popups almost never showed.
    const candidates = Array.from(document.querySelectorAll(IMG_SELECTOR))
      .map(img => ({ img, comments: getRecentComments(img.dataset.photoId, 3) }))
      .filter(x => x.comments.length);
    if (!candidates.length) return;
    const { img, comments } = candidates[Math.floor(Math.random() * candidates.length)];
    _popComment(img, comments[Math.floor(Math.random() * comments.length)]);
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
