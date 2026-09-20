require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function listDoctors() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to database...\n');

    const doctors = await User.find({ role: 'doctor' }).select('name email specialization');

    if (doctors.length === 0) {
      console.log('❌ No doctor accounts exist at all. You need to create one via the admin panel.');
    } else {
      console.log(`Found ${doctors.length} doctor account(s):\n`);
      doctors.forEach(doc => {
        console.log(`- Name: ${doc.name} | Email: ${doc.email} | Specialization: ${doc.specialization || 'none'}`);
      });
    }

    process.exit(0);
  } catch (err) {
    console.error('Something went wrong:', err.message);
    process.exit(1);
  }
}

listDoctors();