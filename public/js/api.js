// ───────────────────────────────────────────────
// Shared helper for talking to the backend API.
// Change this if your backend runs on a different port.
// ───────────────────────────────────────────────
const SERVER_ORIGIN = '';
const API_BASE = `${SERVER_ORIGIN}/api`;

// Wraps fetch() and automatically attaches the login token (if we have one).
async function apiRequest(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Something went wrong');
  }
  return data;
}

// For uploading files (FormData) — no Content-Type header, the browser sets it automatically.
async function apiUpload(path, formData) {
  const headers = {};
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Something went wrong');
  }
  return data;
}

// Saves login info and sends the person to the right dashboard.
function loginSuccess(data) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('role', data.role);
  localStorage.setItem('name', data.name);

  if (data.role === 'patient') window.location.href = 'patient.html';
  else if (data.role === 'doctor') window.location.href = 'doctor.html';
  else if (data.role === 'admin') window.location.href = 'admin.html';
}

// Checks that someone is logged in with the expected role — otherwise sends them back to login.
function requireRoleOrRedirect(expectedRole) {
  const role = localStorage.getItem('role');
  const token = localStorage.getItem('token');
  if (!token || role !== expectedRole) {
    window.location.href = 'index.html';
  }
}

function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}