'use strict';

// ---------------------------------------------------------------------------
// Slide & playlist store — thin helpers that operate on config.slides /
// config.playlists and call saveConfig() after mutations.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const { getConfig, saveConfig, defaultSlide, defaultPlaylist } = require('../../config');

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

function getSlides() {
  return getConfig().slides;
}

function getSlideById(id) {
  return getConfig().slides.find(s => s.id === id) || null;
}

function createSlide(type, overrides = {}) {
  const slide = { id: crypto.randomUUID(), ...defaultSlide(type), ...overrides };
  getConfig().slides.push(slide);
  saveConfig();
  return slide;
}

function updateSlide(id, patch) {
  const cfg = getConfig();
  const idx = cfg.slides.findIndex(s => s.id === id);
  if (idx === -1) return null;
  cfg.slides[idx] = { ...cfg.slides[idx], ...patch, id };
  saveConfig();
  return cfg.slides[idx];
}

function deleteSlide(id) {
  const cfg = getConfig();
  const idx = cfg.slides.findIndex(s => s.id === id);
  if (idx === -1) return false;
  cfg.slides.splice(idx, 1);
  // Remove from all playlists
  for (const pl of cfg.playlists) {
    pl.slideIds = pl.slideIds.filter(sid => sid !== id);
  }
  saveConfig();
  return true;
}

// ---------------------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------------------

function getPlaylists() {
  return getConfig().playlists;
}

function getPlaylistById(id) {
  return getConfig().playlists.find(p => p.id === id) || null;
}

function createPlaylist(overrides = {}) {
  const playlist = { id: crypto.randomUUID(), ...defaultPlaylist(), ...overrides };
  getConfig().playlists.push(playlist);
  saveConfig();
  return playlist;
}

function updatePlaylist(id, patch) {
  const cfg = getConfig();
  const idx = cfg.playlists.findIndex(p => p.id === id);
  if (idx === -1) return null;
  // Don't allow overwriting id; validate slideIds if provided
  const { id: _id, ...rest } = patch;
  if (rest.slideIds !== undefined) {
    if (!Array.isArray(rest.slideIds)) return null;
    // Only keep IDs that actually exist in the library
    const validIds = new Set(cfg.slides.map(s => s.id));
    rest.slideIds = rest.slideIds.filter(sid => validIds.has(sid));
  }
  cfg.playlists[idx] = { ...cfg.playlists[idx], ...rest, id };
  saveConfig();
  return cfg.playlists[idx];
}

function deletePlaylist(id) {
  const cfg = getConfig();
  const idx = cfg.playlists.findIndex(p => p.id === id);
  if (idx === -1) return false;
  cfg.playlists.splice(idx, 1);
  // Clear any screen references to this playlist
  for (const screenId of Object.keys(cfg.screens || {})) {
    if (cfg.screens[screenId]?.playlistId === id) cfg.screens[screenId].playlistId = null;
  }
  saveConfig();
  return true;
}

module.exports = {
  getSlides, getSlideById, createSlide, updateSlide, deleteSlide,
  getPlaylists, getPlaylistById, createPlaylist, updatePlaylist, deletePlaylist,
};
