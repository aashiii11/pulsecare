const mongoose = require('mongoose');

// One User model for ALL three roles.
// The "role" field is what decides what someone can see/do.
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // stored as a hash, never plain text
  role: {
    type: String,
    enum: ['patient', 'doctor', 'admin'], // only these 3 values allowed
    default: 'patient',
    required: true,
  },
  // doctor-only fields (ignored for patients/admins)
  specialization: { type: String },
  isQueuePaused: { type: Boolean, default: false }, // doctor can pause/resume their queue
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);