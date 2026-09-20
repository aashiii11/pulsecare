// ONE-TIME SCRIPT — resets Dr. Sharma's password to a known value so we can
// confirm login works, ruling out any typo or mismatch.

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');

async function resetDoctorPassword() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to database...');

    const email = 'drsharma@clinic.com'; // change this if your doctor's email is different
    const newPassword = 'doctor123';

    const doctor = await User.findOne({ email, role: 'doctor' });
    if (!doctor) {
      console.log('❌ No doctor found with that email. Check the email spelling.');
      process.exit(0);
    }

    doctor.password = await bcrypt.hash(newPassword, 10);
    await doctor.save();

    console.log('✅ Password reset successfully!');
    console.log('Email:', email);
    console.log('Password:', newPassword);
    process.exit(0);
  } catch (err) {
    console.error('Something went wrong:', err.message);
    process.exit(1);
  }
}

resetDoctorPassword();