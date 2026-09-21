const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET; // set this in your .env file

// Email sender setup — uses a Gmail account + "App Password" (see setup notes below)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// SIGNUP — used by patients to create their own account.
// (Doctors/admins should NOT self-signup here — admin creates them, see admin routes.)
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'patient', // signup always creates a patient — safe default
    });

    res.status(201).json({ message: 'Account created', userId: user._id });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// LOGIN — same endpoint for patient, doctor, AND admin.
// The role is already stored on the user — we just read it and put it in the token.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    // The token carries the role — frontend reads this to decide which
    // dashboard to redirect to (patient / doctor / admin).
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({ token, role: user.role, name: user.name });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// FORGOT PASSWORD — generates a reset link and emails it to the user.
// Always responds the same way whether or not the email exists, so an
// attacker can't use this to figure out which emails are registered.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.resetToken = token;
      user.resetTokenExpiry = Date.now() + 30 * 60 * 1000; // valid for 30 minutes
      await user.save();

      // Change this URL if your frontend runs somewhere other than Live Server's default port
      const resetLink = `http://127.0.0.1:5500/Frontend/reset-password.html?token=${token}`;

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Reset your CarePulse password',
        html: `
          <p>Hi ${user.name},</p>
          <p>Click the link below to reset your password. This link expires in 30 minutes.</p>
          <p><a href="${resetLink}">${resetLink}</a></p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        `,
      });
    }

    res.json({ message: "If that email exists, we've sent a reset link." });
  } catch (err) {
    console.error('Forgot-password error:', err.message); // so we can see the real reason in the terminal
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// RESET PASSWORD — called from reset-password.html with the token from the email link.
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() }, // must not be expired
    });

    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired.' });

    user.password = await bcrypt.hash(password, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// LOGGED-IN USER: update their own profile (name/email/password)
// ─────────────────────────────────────────────
router.put('/profile', requireLogin, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (password) updates.password = await bcrypt.hash(password, 10);

    const updated = await User.findByIdAndUpdate(req.user.userId, updates, { new: true }).select('-password');
    if (!updated) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'Profile updated', user: updated });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

module.exports = router;