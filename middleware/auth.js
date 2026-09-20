const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function requireLogin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Not logged in' });

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid or expired session' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission for this action' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };