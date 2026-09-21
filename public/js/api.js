// ───────────────────────────────────────────────
// Shared helper for talking to the backend API.
//
// IMPORTANT: your frontend is served by Live Server (127.0.0.1:5500),
// which is NOT your Express backend. SERVER_ORIGIN must point at
// wherever `node server.js` is actually listening — check server.js
// for `app.listen(PORT)` and match the port below.
// ───────────────────────────────────────────────
const SERVER_ORIGIN = window.location.origin; // ← change 5000 if your server.js listens on a different port
const API_BASE = `${SERVER_ORIGIN}/api`;

// Wraps fetch() and automatically attaches the login token (if we have one).
async function apiRequest(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (networkErr) {
    // fetch() itself failed — backend not running, wrong port, or CORS blocked it
    throw new Error('Could not reach the server. Is the backend running?');
  }

  return parseJsonResponse(response, path);
}

// For uploading files (FormData) — no Content-Type header, the browser sets it automatically.
async function apiUpload(path, formData) {
  const headers = {};
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData,
      cache: 'no-store',
    });
  } catch (networkErr) {
    throw new Error('Could not reach the server. Is the backend running?');
  }

  return parseJsonResponse(response, path);
}

// Reads the response as text first (never throws on an empty body), then
// parses it — so a blank/non-JSON response gives a clear error instead of
// the cryptic "Unexpected end of JSON input".
async function parseJsonResponse(response, path) {
  const rawText = await response.text();

  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      console.error(`Non-JSON response from ${path}:`, rawText.slice(0, 300));
      throw new Error(`Server error (${response.status}) — check that the backend route exists and is running.`);
    }
  }

  if (!response.ok) {
    throw new Error((data && data.message) || `Request failed (${response.status})`);
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

async function deleteReport(appointmentId, reportId) {
  return apiRequest(`/appointments/${appointmentId}/reports/${reportId}`, { method: 'DELETE' });
}

function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}