// src/utils/imageUrl.js

// Returns the full image URL, using the backend URL from env if needed
export function getImageUrl(path) {
  if (!path) return '';
  // If already absolute (http/https/blob/data), return as is
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  // Use VITE_BACKEND_URL as backend base
  const backend = import.meta.env.VITE_BACKEND_URL || '';
  // Remove trailing slash from backend, leading slash from path
  return backend.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}
