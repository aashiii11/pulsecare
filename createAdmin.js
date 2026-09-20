// ONE-TIME SCRIPT — run this once to create your first admin account.
// After running it, you can delete this file or keep it for creating more admins later.

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to database...');

    // CHANGE these details before running:
    const adminDetails = {
      name: 'Admin',
      email: 'admin@clinic.com',
      password: 'admin123', // change this to something secure
      role: 'admin',
    };

    const existing = await User.findOne({ email: adminDetails.email });
    if (existing) {
      console.log('An account with this email already exists. Nothing created.');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(adminDetails.password, 10);
    await User.create({ ...adminDetails, password: hashedPassword });

    console.log('✅ Admin account created successfully!');
    console.log('Email:', adminDetails.email);
    console.log('Password:', adminDetails.password, '(the one you set above)');
    process.exit(0);
  } catch (err) {
    console.error('Something went wrong:', err.message);
    process.exit(1);
  }
}

createAdmin();